import type { InputSnapshot } from "../../app/input/InputState";
import type { Scene, SceneRootLike } from "../../app/Scene";
import type { ViewportResult } from "../../app/ViewportService";
import type { MapDefinition, Vector2 } from "../../content/contracts";
import { CollisionGrid } from "../../domain/exploration/CollisionGrid";
import {
  advanceExplorationFrame,
  createExplorationRuntime,
  type EncounterContact,
  type EncounterRuntime,
} from "../../domain/exploration/EncounterAi";
import {
  createExplorationState,
  type ExplorationState,
} from "../../domain/exploration/ExplorationState";
import { movePlayer } from "../../domain/exploration/MovementSystem";
import { SeededRng } from "../../domain/common/SeededRng";
import { CameraSystem, type CameraPosition } from "../../domain/exploration/CameraSystem";
import { ActorView, type ActorResourceSource } from "./ActorView";
import { ExplorationHud } from "./ExplorationHud";
import { InteractionSystem, type InteractionTarget } from "./InteractionSystem";
import { TileMapView, type TileMapResourceSource } from "./TileMapView";
import type { FieldHudStatus, FieldInputAction, FieldSceneFrame, FieldSceneView } from "./FieldSceneView";

export interface ExplorationInputSource {
  snapshot(): InputSnapshot;
  setEnabled(enabled: boolean): void;
  resetAll?(): void;
}

export interface ExplorationAssetLease {
  release(options?: { beforeUnload?: () => void | Promise<void> }): Promise<void>;
}

export interface ExplorationAssetService {
  acquire(bundleId: string): Promise<{ ok: true; value: ExplorationAssetLease } | { ok: false; error: unknown }>;
}

export interface ExplorationSceneAudio {
  /** 场景调用方按已解析的 FloorDefinition 显式传入 field/abyss，不从 mapId 猜测。 */
  setMusic?(id: "bgm_field" | "bgm_abyss", sceneGainBps: number): void;
  playSfx(id: "sfx_step"): boolean;
}

export interface ExplorationSceneResources extends TileMapResourceSource, ActorResourceSource {}

interface ExplorationSceneBaseOptions {
  readonly root: SceneRootLike;
  readonly map: Readonly<MapDefinition>;
  readonly viewport: ViewportResult;
  readonly resources: ExplorationSceneResources;
  readonly tilesetAssetId: string;
  readonly input: ExplorationInputSource;
  readonly assetService?: ExplorationAssetService;
  readonly playerFieldSpriteId: string;
  readonly encounterFieldSpriteId: (encounterId: string) => string;
  readonly musicId?: "bgm_field" | "bgm_abyss";
  readonly onContact?: (contact: EncounterContact) => void | Promise<void>;
  readonly onInteraction?: (target: InteractionTarget) => void | Promise<void>;
  readonly onFieldAction?: (action: Exclude<FieldInputAction, "interact">) => void | Promise<void>;
  /** 由应用层注入 RewardService dry-run/提交；返回 true 才把宝箱标记为已开。 */
  readonly onOpenChest?: (objectId: string) => boolean | Promise<boolean>;
  readonly audio?: ExplorationSceneAudio;
  readonly openedChestObjectIds?: readonly string[];
  readonly initialState?: ExplorationState;
  readonly initialRngSeed?: number;
}

interface ExplorationFullPresentationOptions {
  readonly view: FieldSceneView;
  readonly getHudStatus: () => Readonly<FieldHudStatus>;
  readonly npcPresentation: (npcId: string) => Readonly<{ spriteId: string; displayName: string }>;
  readonly npcFieldSpriteId?: never;
}

interface ExplorationLegacyPresentationOptions {
  readonly view?: undefined;
  readonly getHudStatus?: undefined;
  readonly npcPresentation?: undefined;
  readonly npcFieldSpriteId: (npcId: string) => string;
}

/** 旧逻辑适配器与完整 field view 适配器严格二选一，禁止半套配置悄悄降级。 */
export type ExplorationSceneOptions = ExplorationSceneBaseOptions & (
  | ExplorationFullPresentationOptions
  | ExplorationLegacyPresentationOptions
);

function isFieldInputAction(action: string): action is FieldInputAction {
  return action === "interact"
    || action === "map"
    || action === "inventory"
    || action === "party"
    || action === "settings"
    || action === "menu";
}

function freezeViewport(viewport: ViewportResult): ViewportResult {
  return Object.freeze({
    ...viewport,
    safeRect: Object.freeze({ ...viewport.safeRect }),
  });
}

function freezeHudStatus(status: Readonly<FieldHudStatus>): Readonly<FieldHudStatus> {
  const partySlots = status.partySlots.map((slot) => Object.freeze({
    slot: slot.slot,
    member: slot.member === null ? null : Object.freeze({ ...slot.member }),
  })) as unknown as FieldHudStatus["partySlots"];
  return Object.freeze({
    sceneKind: status.sceneKind,
    mapId: status.mapId,
    mapDisplayName: status.mapDisplayName,
    partySlots: Object.freeze(partySlots),
  });
}

/**
 * 野外 Scene 只拥有 View 和固定步适配器；探索/战斗存档仍由应用层事务服务负责。
 * Node 测试可注入 fake root、资源和 InputSource，不需要初始化 Pixi。
 */
export class ExplorationScene implements Scene<unknown> {
  public readonly root: SceneRootLike;
  private readonly options: ExplorationSceneOptions;
  private readonly grid: CollisionGrid;
  private readonly interaction = new InteractionSystem(28);
  private readonly camera: CameraSystem;
  private viewportValue: ViewportResult;
  private stateValue: ExplorationState;
  private runtimes: EncounterRuntime[] = [];
  private tileMap: TileMapView | null = null;
  private hudValue: ExplorationHud | null = null;
  private actors: ActorView[] = [];
  private lease: ExplorationAssetLease | null = null;
  private prepareInFlight: Promise<void> | null = null;
  private releaseInFlight: Promise<void> | null = null;
  private destroyInFlight: Promise<void> | null = null;
  private lifecycleGeneration = 0;
  private prepared = false;
  private entered = false;
  private pausedValue = false;
  private destroyed = false;
  private cameraValue: CameraPosition | null = null;
  private interactionTargetValue: InteractionTarget | null = null;
  private animationStepValue = 0;
  private stepDistance = 0;
  private actionInFlight: Promise<void> | null = null;
  private readonly openedChestObjectIdsValue: Set<string>;
  private readonly openingChestObjectIds = new Set<string>();
  private readonly npcPresentationValues = new Map<string, Readonly<{ spriteId: string; displayName: string }>>();
  private presentationModeValue: "legacy" | "full" | null = null;
  private viewOwnedValue = false;
  private viewDestroyedValue = false;

  public constructor(options: ExplorationSceneOptions) {
    this.root = options.root;
    this.options = options;
    this.grid = new CollisionGrid(options.map);
    this.camera = new CameraSystem(options.map);
    this.viewportValue = freezeViewport(options.viewport);
    this.stateValue = options.initialState ?? createExplorationState(options.map);
    this.openedChestObjectIdsValue = new Set(options.openedChestObjectIds ?? []);
  }

  public get state(): ExplorationState { return this.stateValue; }
  public get hud(): ExplorationHud | null { return this.hudValue; }
  public get actorViews(): readonly ActorView[] { return this.actors; }
  public get mapView(): TileMapView | null { return this.tileMap; }
  public get cameraPosition(): CameraPosition | null { return this.cameraValue; }
  public get interactionTarget(): InteractionTarget | null { return this.interactionTargetValue; }
  public get openedChestObjectIds(): readonly string[] { return [...this.openedChestObjectIdsValue]; }

  public async prepare(): Promise<void> {
    if (this.destroyed) throw new Error("EXPLORATION_SCENE_DESTROYED");
    if (this.prepared) return;
    if (this.prepareInFlight) return this.prepareInFlight;
    this.validatePresentationOptions();
    const operation = this.prepareInternal();
    this.prepareInFlight = operation;
    void operation.then(
      () => { if (this.prepareInFlight === operation) this.prepareInFlight = null; },
      () => { if (this.prepareInFlight === operation) this.prepareInFlight = null; },
    );
    return operation;
  }

  private async prepareInternal(): Promise<void> {
    const generation = this.lifecycleGeneration;
    try {
      if (this.options.assetService) {
        const acquired = await this.options.assetService.acquire(this.options.map.assetBundleId);
        if (!acquired.ok) throw acquired.error;
        this.lease = acquired.value;
      }
      this.assertNotDestroying(generation);
      this.tileMap = new TileMapView({ map: this.options.map, tilesetAssetId: this.options.tilesetAssetId, resources: this.options.resources });
      this.hudValue = new ExplorationHud(this.viewportValue.safeRect);
      this.hudValue.setViewport(this.viewportValue);
      this.runtimes = createExplorationRuntime(this.options.map.objects, new SeededRng(this.options.initialRngSeed ?? 1));
      this.camera.reset();
      this.cameraValue = this.camera.update(this.stateValue.playerPosition);
      this.animationStepValue = 0;
      this.interactionTargetValue = null;
      this.buildActors();
      this.refreshInteractionTarget();
      const full = this.fullPresentationOptions();
      if (full) {
        // view.prepare 可能只完成部分 Pixi 对象，调用前即登记销毁责任。
        this.viewOwnedValue = true;
        await full.view.prepare(this.createFrame());
      }
      this.assertNotDestroying(generation);
      this.prepared = true;
      this.pausedValue = false;
    } catch (error) {
      this.prepared = false;
      let cleanupFailed = false;
      try {
        await this.releaseViewAndLease(false);
      } catch {
        // 清理失败不能覆盖原始 prepare 错误；场景随后保持不可运行，交由 destroy 重试 lease。
        cleanupFailed = true;
      }
      this.clearProjection();
      if (cleanupFailed || this.viewDestroyedValue) this.markDestroyedForCleanup();
      throw error;
    }
  }

  public enter(): void {
    if (this.destroyed) throw new Error("EXPLORATION_SCENE_DESTROYED");
    if (!this.prepared) throw new Error("EXPLORATION_SCENE_NOT_PREPARED");
    if (this.entered) return;
    this.entered = true;
    this.pausedValue = false;
    this.options.input.setEnabled(true);
    this.hudValue?.setEnabled(true);
    if (this.options.musicId) this.options.audio?.setMusic?.(this.options.musicId, 10_000);
    this.fullPresentationOptions()?.view.enter(this.createFrame());
  }

  public pause(): void {
    if (this.destroyed || this.pausedValue) return;
    this.options.input.setEnabled(false);
    this.options.input.resetAll?.();
    this.hudValue?.setEnabled(false);
    this.pausedValue = true;
    if (this.prepared) this.fullPresentationOptions()?.view.pause();
  }

  public resume(): void {
    if (this.destroyed || !this.entered || this.stateValue.phase === "CONTACT_LOCKED" || !this.pausedValue) return;
    this.pausedValue = false;
    this.options.input.setEnabled(true);
    this.hudValue?.setEnabled(true);
    if (this.options.musicId) this.options.audio?.setMusic?.(this.options.musicId, 10_000);
    this.fullPresentationOptions()?.view.resume(this.createFrame());
  }

  public setViewport(viewport: ViewportResult): void {
    if (this.destroyed) return;
    this.validatePresentationOptions();
    this.viewportValue = freezeViewport(viewport);
    this.hudValue?.setViewport(this.viewportValue);
    if (this.presentationModeValue === "full") {
      this.fullPresentationOptions()?.view.setViewport(this.viewportValue);
    }
  }

  public async exit(): Promise<void> {
    this.pause();
    this.entered = false;
  }

  public async destroy(): Promise<void> {
    if (!this.destroyed) {
      // destroy 请求同步冻结输入与进入/固定步门禁；后续异步清理不能让场景复活。
      this.destroyed = true;
      this.lifecycleGeneration += 1;
      this.entered = false;
      this.pausedValue = true;
      this.options.input.setEnabled(false);
      this.options.input.resetAll?.();
      this.hudValue?.setEnabled(false);
    }
    if (this.destroyInFlight) return this.destroyInFlight;
    const operation = this.destroyInternal();
    this.destroyInFlight = operation;
    void operation.then(
      () => { if (this.destroyInFlight === operation) this.destroyInFlight = null; },
      () => { if (this.destroyInFlight === operation) this.destroyInFlight = null; },
    );
    return operation;
  }

  private async destroyInternal(): Promise<void> {
    const preparation = this.prepareInFlight;
    if (preparation) {
      try {
        await preparation;
      } catch {
        // prepare 的原始错误由其调用方观察；destroy 继续完成 lease/view 清理。
      }
    }
    try {
      await this.releaseViewAndLease(true);
    } finally {
      this.clearProjection();
    }
  }

  /** 每次调用只消费一个 InputSnapshot；GameApp fixed ticker 负责调用频率。 */
  public fixedUpdate(): EncounterContact | null {
    if (!this.entered || this.destroyed || this.pausedValue || this.stateValue.phase === "CONTACT_LOCKED") return null;
    const snapshot = this.options.input.snapshot();
    const previousPosition = this.stateValue.playerPosition;
    const moved = movePlayer(previousPosition, snapshot, this.grid).position;
    const frame = advanceExplorationFrame({
      state: this.stateValue,
      runtimes: this.runtimes,
      mapObjects: this.options.map.objects,
      playerPosition: moved,
      grid: this.grid,
    });
    this.stateValue = frame.state;
    this.runtimes = [...frame.runtimes];
    this.syncActors(moved);
    this.cameraValue = this.camera.update(moved);
    // 步长音效必须按本次 fixed-step 的前后脚底位置累计，不能读取已更新的 state。
    this.stepDistance += Math.hypot(moved.x - previousPosition.x, moved.y - previousPosition.y);
    while (this.stepDistance >= 24) {
      this.stepDistance -= 24;
      this.options.audio?.playSfx("sfx_step");
    }
    this.refreshInteractionTarget();
    this.animationStepValue += 1;
    this.fullPresentationOptions()?.view.update(this.createFrame());
    if (frame.contact) {
      this.options.input.setEnabled(false);
      this.options.input.resetAll?.();
      this.hudValue?.setEnabled(false);
      this.pausedValue = true;
      this.fullPresentationOptions()?.view.pause();
      void Promise.resolve(this.options.onContact?.(frame.contact)).catch(() => undefined);
      return frame.contact;
    }
    this.dispatchFieldAction(snapshot);
    return null;
  }

  private validatePresentationOptions(): void {
    if (this.presentationModeValue !== null) return;
    const options = this.options as unknown as {
      readonly view?: FieldSceneView;
      readonly getHudStatus?: () => Readonly<FieldHudStatus>;
      readonly npcPresentation?: (npcId: string) => Readonly<{ spriteId: string; displayName: string }>;
      readonly npcFieldSpriteId?: (npcId: string) => string;
    };
    const fullValues = [options.view, options.getHudStatus, options.npcPresentation];
    const presentFullCount = fullValues.filter((value) => value !== undefined).length;
    if (presentFullCount === 0 && typeof options.npcFieldSpriteId === "function") {
      this.presentationModeValue = "legacy";
      return;
    }
    if (presentFullCount === 3
      && options.npcFieldSpriteId === undefined
      && options.view !== undefined
      && typeof options.view.prepare === "function"
      && typeof options.view.enter === "function"
      && typeof options.view.update === "function"
      && typeof options.view.setViewport === "function"
      && typeof options.view.pause === "function"
      && typeof options.view.resume === "function"
      && typeof options.view.destroy === "function"
      && typeof options.getHudStatus === "function"
      && typeof options.npcPresentation === "function") {
      this.presentationModeValue = "full";
      return;
    }
    throw new Error("EXPLORATION_FIELD_OPTIONS_INCOMPLETE");
  }

  private fullPresentationOptions(): ExplorationFullPresentationOptions | null {
    if (this.presentationModeValue !== "full") return null;
    return this.options as unknown as ExplorationFullPresentationOptions;
  }

  private legacyPresentationOptions(): ExplorationLegacyPresentationOptions {
    return this.options as unknown as ExplorationLegacyPresentationOptions;
  }

  private buildActors(): void {
    const actors: ActorView[] = [new ActorView({ objectId: "player", resource: { kind: "player", fieldSpriteId: this.options.playerFieldSpriteId }, resources: this.options.resources, position: this.stateValue.playerPosition })];
    this.npcPresentationValues.clear();
    for (const object of this.options.map.objects) {
      if (object.kind === "npc") {
        if (this.presentationModeValue === "full") {
          const full = this.fullPresentationOptions();
          if (!full) throw new Error("EXPLORATION_FIELD_OPTIONS_INCOMPLETE");
          const cached = this.npcPresentationValues.get(object.npcId);
          const presentation = cached ?? full.npcPresentation(object.npcId);
          if (!presentation
            || typeof presentation.spriteId !== "string"
            || presentation.spriteId.trim().length === 0
            || typeof presentation.displayName !== "string"
            || presentation.displayName.trim().length === 0) {
            throw new Error(`EXPLORATION_NPC_PRESENTATION_INVALID:${object.npcId}`);
          }
          const stablePresentation = cached ?? Object.freeze({
            spriteId: presentation.spriteId,
            displayName: presentation.displayName,
          });
          this.npcPresentationValues.set(object.npcId, stablePresentation);
          actors.push(new ActorView({
            objectId: object.objectId,
            resource: { kind: "npc", spriteId: stablePresentation.spriteId },
            displayName: stablePresentation.displayName,
            resources: this.options.resources,
            position: object.position,
          }));
        } else {
          actors.push(new ActorView({
            objectId: object.objectId,
            resource: { kind: "npc", spriteId: this.legacyPresentationOptions().npcFieldSpriteId(object.npcId) },
            resources: this.options.resources,
            position: object.position,
          }));
        }
      } else if (object.kind === "encounter") {
        actors.push(new ActorView({ objectId: object.objectId, resource: { kind: "encounter", fieldSpriteId: this.options.encounterFieldSpriteId(object.encounterId) }, resources: this.options.resources, position: object.position }));
      } else {
        actors.push(new ActorView({ objectId: object.objectId, resource: { kind: "object", frameId: object.frameId }, resources: this.options.resources, position: object.position }));
      }
    }
    this.actors = actors;
  }

  private syncActors(playerPosition: Vector2): void {
    const player = this.actors.find((actor) => actor.objectId === "player");
    player?.setPosition(playerPosition);
    for (const runtime of this.runtimes) this.actors.find((actor) => actor.objectId === runtime.objectId)?.setPosition(runtime.position);
  }

  private refreshInteractionTarget(): void {
    const selected = this.interaction.select({
      playerPosition: this.stateValue.playerPosition,
      objects: this.options.map.objects,
      openedChestObjectIds: [...this.openedChestObjectIdsValue],
    });
    this.interactionTargetValue = selected.target;
    this.hudValue?.setInteractionEnabled(selected.enabled);
  }

  private createFrame(): FieldSceneFrame {
    const full = this.fullPresentationOptions();
    if (!full || !this.tileMap || !this.hudValue || !this.cameraValue) throw new Error("EXPLORATION_FIELD_NOT_PREPARED");
    const hidden = [...this.stateValue.defeatedEncounterObjectIds];
    for (const objectId of this.openedChestObjectIdsValue) {
      if (!hidden.includes(objectId)) hidden.push(objectId);
    }
    const frame: FieldSceneFrame = {
      map: this.tileMap,
      actors: Object.freeze([...this.actors]),
      camera: Object.freeze({ ...this.cameraValue }),
      hud: this.hudValue.getLayout(),
      hudStatus: freezeHudStatus(full.getHudStatus()),
      interactionTarget: this.interactionTargetValue === null ? null : Object.freeze({ ...this.interactionTargetValue }),
      hiddenObjectIds: Object.freeze(hidden),
      animationStep: this.animationStepValue,
    };
    return Object.freeze(frame);
  }

  private dispatchFieldAction(snapshot: InputSnapshot): void {
    if (this.actionInFlight) return;
    for (const action of snapshot.actions) {
      if (!isFieldInputAction(action)) continue;
      if (action === "interact") {
        const target = this.interactionTargetValue;
        if (!target) return;
        if (target.action === "openChest" && this.options.onOpenChest) {
          const objectId = target.object.objectId;
          if (this.openingChestObjectIds.has(objectId)) return;
          this.openingChestObjectIds.add(objectId);
          this.trackAction(async () => {
            try {
              const opened = await this.options.onOpenChest?.(objectId);
              if (opened) this.openedChestObjectIdsValue.add(objectId);
            } finally {
              this.openingChestObjectIds.delete(objectId);
            }
          });
        } else {
          this.trackAction(() => this.options.onInteraction?.(target));
        }
        return;
      }
      this.trackAction(() => this.options.onFieldAction?.(action));
      return;
    }
  }

  private trackAction(callback: () => void | Promise<void>): void {
    if (this.actionInFlight) return;
    let task: void | Promise<void>;
    try {
      task = callback();
    } catch {
      return;
    }
    const settled = Promise.resolve(task).then(() => undefined, () => undefined);
    this.actionInFlight = settled;
    void settled.then(() => {
      if (this.actionInFlight === settled) this.actionInFlight = null;
    });
  }

  private assertNotDestroying(generation: number): void {
    if (this.destroyed || this.lifecycleGeneration !== generation) {
      throw new Error("EXPLORATION_SCENE_DESTROYED");
    }
  }

  private markDestroyedForCleanup(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lifecycleGeneration += 1;
    this.entered = false;
    this.pausedValue = true;
    this.options.input.setEnabled(false);
    this.options.input.resetAll?.();
  }

  private async releaseViewAndLease(forceViewDestroy: boolean): Promise<void> {
    const existing = this.releaseInFlight;
    if (existing) {
      return existing.then(
        () => { this.destroyViewOnce(forceViewDestroy); },
        (error) => {
          this.destroyViewOnce(forceViewDestroy);
          throw error;
        },
      );
    }
    const operation = this.releaseViewAndLeaseInternal(forceViewDestroy);
    this.releaseInFlight = operation;
    void operation.then(
      () => { if (this.releaseInFlight === operation) this.releaseInFlight = null; },
      () => { if (this.releaseInFlight === operation) this.releaseInFlight = null; },
    );
    return operation;
  }

  private async releaseViewAndLeaseInternal(forceViewDestroy: boolean): Promise<void> {
    const lease = this.lease;
    try {
      if (lease) {
        await lease.release({ beforeUnload: () => this.destroyViewOnce(forceViewDestroy) });
        // 只有 release 成功后才丢弃 lease；失败时保留同一引用供 destroy 重试。
        this.lease = null;
      }
    } finally {
      this.destroyViewOnce(forceViewDestroy);
    }
  }

  private destroyViewOnce(forceViewDestroy: boolean): void {
    if (this.viewDestroyedValue || (!forceViewDestroy && !this.viewOwnedValue)) return;
    if (this.presentationModeValue === null) {
      try {
        this.validatePresentationOptions();
      } catch {
        return;
      }
    }
    this.viewDestroyedValue = true;
    this.fullPresentationOptions()?.view.destroy();
  }

  private clearProjection(): void {
    this.actors = [];
    this.tileMap = null;
    this.hudValue = null;
    this.runtimes = [];
    this.cameraValue = null;
    this.interactionTargetValue = null;
    this.animationStepValue = 0;
    this.stepDistance = 0;
    this.openingChestObjectIds.clear();
    this.npcPresentationValues.clear();
    this.prepared = false;
  }
}
