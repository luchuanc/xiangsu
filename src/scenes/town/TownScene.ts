import type { GameSaveV1, FloorDefinition, MapDefinition, Vector2 } from "../../content/contracts";
import type { InputSnapshot } from "../../app/input/InputState";
import type { Scene, SceneRootLike } from "../../app/Scene";
import type { ViewportResult } from "../../app/ViewportService";
import { createDomainError, failure, success, type DomainErrorV1, type DomainResult } from "../../domain/common/DomainResult";
import { CameraSystem, type CameraPosition } from "../../domain/exploration/CameraSystem";
import { CollisionGrid } from "../../domain/exploration/CollisionGrid";
import { movePlayer } from "../../domain/exploration/MovementSystem";
import { NpcService, type NpcContentSource, type NpcResolution } from "../../domain/town/NpcService";
import { DialoguePanel } from "../../ui/components/DialoguePanel";
import { FloorSelectPanel, buildFloorEntries, type FloorEntryMode } from "../../ui/components/FloorSelectPanel";
import { MerchantPanel } from "../../ui/components/MerchantPanel";
import { BestiaryPanel } from "../../ui/components/BestiaryPanel";
import { AbyssEchoPanel } from "../../ui/components/AbyssEchoPanel";
import { ActorView, type ActorResourceSource } from "../exploration/ActorView";
import { ExplorationHud } from "../exploration/ExplorationHud";
import { InteractionSystem, type InteractionTarget } from "../exploration/InteractionSystem";
import { TileMapView, type TileMapResourceSource } from "../exploration/TileMapView";
import type { FieldHudStatus, FieldInputAction, FieldSceneFrame, FieldSceneView } from "../exploration/FieldSceneView";
import type { TownModalState } from "../../ui/rendering/TownModalRenderer";

export interface TownInputSource {
  snapshot(): InputSnapshot;
  setEnabled(enabled: boolean): void;
  resetAll?(): void;
}

export interface TownSceneAudio {
  setMusic?(id: "bgm_town", sceneGainBps: number): void;
}

export interface TownSceneResources extends TileMapResourceSource, ActorResourceSource {}

export interface TownDepartureInput {
  readonly floor: Readonly<FloorDefinition>;
  readonly mode: "exploration" | "shortFarm" | "bossRetry" | "abyssEcho";
}

export interface TownDepartureService {
  depart(input: TownDepartureInput, save: Readonly<GameSaveV1>): Promise<DomainResult<GameSaveV1>>;
}

/** 离城前的门禁只读 Store/world；真正的远征创建与商店刷新仍由事务服务提交。 */
export function validateTownDeparture(input: TownDepartureInput, save: Readonly<GameSaveV1>): DomainResult<true> {
  if (save.expedition !== null || save.battle !== null) return failure(createDomainError("NOT_IN_TOWN", null));
  if (input.mode === "abyssEcho") return failure(createDomainError("INVALID_CONTENT", { path: "departure.mode", issueKey: "abyss_echo_requires_explicit_echo_id" }));
  if (input.floor.floorNumber > save.world.highestUnlockedFloor) return failure(createDomainError("FLOOR_LOCKED", { floorNumber: input.floor.floorNumber }));
  const cleared = save.world.clearedBossEncounterIds.includes(input.floor.bossEncounterId);
  if (input.mode === "shortFarm" && !cleared) return failure(createDomainError("EXPEDITION_MODE_LOCKED", { mode: input.mode, floorId: input.floor.id, reason: "FLOOR_NOT_CLEARED" }));
  if (input.mode === "bossRetry") {
    if (cleared) return failure(createDomainError("EXPEDITION_MODE_LOCKED", { mode: input.mode, floorId: input.floor.id, reason: "BOSS_ALREADY_CLEARED" }));
    if (!save.world.bossRetryUnlockedFloorIds.includes(input.floor.id)) return failure(createDomainError("EXPEDITION_MODE_LOCKED", { mode: input.mode, floorId: input.floor.id, reason: "BOSS_NOT_CONTACTED" }));
  }
  return success(true);
}

interface TownSceneBaseOptions {
  readonly root: SceneRootLike;
  readonly viewport: ViewportResult;
  readonly input: TownInputSource;
  readonly npcContent: NpcContentSource;
  readonly currentSave: () => Readonly<GameSaveV1>;
  readonly floors?: readonly FloorDefinition[];
  readonly departure?: TownDepartureService;
  readonly onNpcRoute?: (resolution: NpcResolution) => void | Promise<void>;
  readonly onNpcError?: (npcId: string, error: DomainErrorV1) => void | Promise<void>;
  readonly onPanelStateChange?: (kind: TownPanelKind) => void | Promise<void>;
  readonly onFloorSelectRequest?: () => void | Promise<void>;
  readonly modal?: TownModalLike;
  readonly onDepartureCommitted?: (save: Readonly<GameSaveV1>, input: TownDepartureInput) => void | Promise<void>;
  readonly audio?: TownSceneAudio;
}

/** GameFlow 注入的模态适配器只负责显示与输入门禁，不持有城镇业务状态。 */
export interface TownModalLike {
  render(state: TownModalState): void;
  setViewport(viewport: ViewportResult): void;
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export interface TownFieldRuntimeOptions {
  readonly map: Readonly<MapDefinition>;
  readonly resources: TownSceneResources;
  readonly tilesetAssetId: string;
  readonly playerFieldSpriteId: string;
  readonly npcPresentation: (npcId: string) => Readonly<{ spriteId: string; displayName: string }>;
  readonly view: FieldSceneView;
  readonly getHudStatus: () => Readonly<FieldHudStatus>;
  readonly onInteraction?: (target: InteractionTarget) => void | Promise<void>;
  readonly onFieldAction?: (action: Exclude<FieldInputAction, "interact">) => void | Promise<void>;
}

interface TownLegacyOptions {
  readonly map?: undefined;
  readonly resources?: undefined;
  readonly tilesetAssetId?: undefined;
  readonly playerFieldSpriteId?: undefined;
  readonly npcPresentation?: undefined;
  readonly view?: undefined;
  readonly getHudStatus?: undefined;
  readonly onInteraction?: undefined;
  readonly onFieldAction?: undefined;
}

/** 旧城镇适配器与完整 field 适配器组成严格联合，禁止半套运行时配置悄悄进入。 */
export type TownSceneOptions = TownSceneBaseOptions & (TownFieldRuntimeOptions | TownLegacyOptions);

type TownPanelKind = "dialogue" | "floorSelect" | null;

const TOWN_FIELD_REQUIRED_KEYS = 7;

function isFieldInputAction(action: string): action is FieldInputAction {
  return action === "interact"
    || action === "map"
    || action === "inventory"
    || action === "party"
    || action === "settings"
    || action === "menu";
}

function freezePosition(position: Vector2): Vector2 {
  return Object.freeze({ x: position.x, y: position.y });
}

/** 城镇场景只编排 UI/输入生命周期；NPC、商店和离城保存仍由显式服务注入。 */
export class TownScene implements Scene<unknown> {
  public readonly root: SceneRootLike;
  public readonly dialogue = new DialoguePanel();
  public readonly floorSelect = new FloorSelectPanel();
  public readonly merchant = new MerchantPanel();
  public readonly bestiary = new BestiaryPanel();
  public readonly abyssEcho = new AbyssEchoPanel();
  private readonly options: TownSceneOptions;
  private readonly npcService: NpcService;
  private readonly fieldMode: boolean;
  private readonly fieldOptions: TownFieldRuntimeOptions | null;
  private viewportValue: ViewportResult;
  private prepareInFlight: Promise<void> | null = null;
  private prepared = false;
  private entered = false;
  private destroyed = false;
  private panelOpen = false;
  private paused = false;
  private inputFrozen = false;
  private fieldViewPaused = false;
  private panelKindValue: TownPanelKind = null;
  private actionInFlight: Promise<void> | null = null;
  private departureInFlight: Promise<DomainResult<GameSaveV1>> | null = null;
  private tileMapValue: TileMapView | null = null;
  private collisionGridValue: CollisionGrid | null = null;
  private cameraSystemValue: CameraSystem | null = null;
  private interactionSystemValue: InteractionSystem | null = null;
  private hudValue: ExplorationHud | null = null;
  private actorViewsValue: ActorView[] = [];
  private playerPositionValue: Vector2 | null = null;
  private cameraPositionValue: CameraPosition | null = null;
  private interactionTargetValue: InteractionTarget | null = null;
  private animationStepValue = 0;
  private readonly npcPresentationValues = new Map<string, Readonly<{ spriteId: string; displayName: string }>>();

  public constructor(options: TownSceneOptions) {
    this.root = options.root;
    this.options = options;
    this.npcService = new NpcService(options.npcContent);
    this.viewportValue = options.viewport;
    const requiredValues = [
      options.map,
      options.resources,
      options.tilesetAssetId,
      options.playerFieldSpriteId,
      options.npcPresentation,
      options.view,
      options.getHudStatus,
    ];
    const optionalValues = [options.onInteraction, options.onFieldAction];
    const presentFieldValues = [...requiredValues, ...optionalValues].filter((value) => value !== undefined).length;
    const presentRequiredValues = requiredValues.filter((value) => value !== undefined).length;
    this.fieldMode = presentFieldValues > 0;
    this.fieldOptions = presentRequiredValues === TOWN_FIELD_REQUIRED_KEYS
      ? options as TownFieldRuntimeOptions
      : null;
    if (options.floors) this.floorSelect.setEntries(buildFloorEntries(options.floors, options.currentSave().world));
  }

  public get mapView(): TileMapView | null { return this.tileMapValue; }
  public get hud(): ExplorationHud | null { return this.hudValue; }
  public get actorViews(): readonly ActorView[] { return this.actorViewsValue; }
  public get playerPosition(): Vector2 | null { return this.playerPositionValue; }
  public get cameraPosition(): CameraPosition | null { return this.cameraPositionValue; }
  public get interactionTarget(): InteractionTarget | null { return this.interactionTargetValue; }
  public get activePanelKind(): TownPanelKind { return this.panelKindValue; }

  public prepare(): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error("TOWN_SCENE_DESTROYED"));
    if (this.prepared) return Promise.resolve();
    if (this.prepareInFlight) return this.prepareInFlight;
    const operation = this.prepareInternal();
    this.prepareInFlight = operation;
    void operation.then(
      () => { if (this.prepareInFlight === operation) this.prepareInFlight = null; },
      () => { if (this.prepareInFlight === operation) this.prepareInFlight = null; },
    );
    return operation;
  }

  private async prepareInternal(): Promise<void> {
    this.assertViewport(this.viewportValue);
    if (!this.fieldMode) {
      this.prepared = true;
      return;
    }
    const field = this.requireFieldOptions();
    try {
      this.validateTownObjects(field);
      this.tileMapValue = new TileMapView({ map: field.map, tilesetAssetId: field.tilesetAssetId, resources: field.resources });
      this.collisionGridValue = new CollisionGrid(field.map);
      this.cameraSystemValue = new CameraSystem(field.map);
      this.interactionSystemValue = new InteractionSystem(40);
      this.hudValue = new ExplorationHud(this.viewportValue.safeRect);
      this.hudValue.setViewport(this.viewportValue);
      this.playerPositionValue = freezePosition(field.map.spawnPoint);
      this.cameraPositionValue = this.cameraSystemValue.update(this.playerPositionValue);
      this.animationStepValue = 0;
      this.interactionTargetValue = null;
      this.buildActors(field);
      this.refreshInteractionTarget();
      await field.view.prepare(this.createFrame());
      this.prepared = true;
    } catch (error) {
      this.clearFieldProjection();
      this.prepared = false;
      throw error;
    }
  }

  public enter(): void {
    if (!this.prepared) throw new Error("TOWN_SCENE_NOT_PREPARED");
    if (this.destroyed) throw new Error("TOWN_SCENE_DESTROYED");
    if (this.entered) return;
    this.entered = true;
    this.paused = false;
    this.fieldViewPaused = false;
    this.options.input.setEnabled(true);
    this.inputFrozen = false;
    this.hudValue?.setEnabled(true);
    this.options.audio?.setMusic?.("bgm_town", 10_000);
    if (this.fieldMode) this.fieldOptions?.view.enter(this.createFrame());
  }

  public fixedUpdate(): InputSnapshot | null {
    if (!this.entered || this.destroyed || this.paused || this.panelOpen) return null;
    const snapshot = this.options.input.snapshot();
    if (!this.fieldMode) return snapshot;
    const field = this.requireFieldOptions();
    const grid = this.collisionGridValue;
    const camera = this.cameraSystemValue;
    const interaction = this.interactionSystemValue;
    const playerPosition = this.playerPositionValue;
    if (!grid || !camera || !interaction || !playerPosition || !this.hudValue) return snapshot;
    const moved = movePlayer(playerPosition, snapshot, grid).position;
    this.playerPositionValue = freezePosition(moved);
    this.actorViewsValue[0]?.setPosition(this.playerPositionValue);
    this.cameraPositionValue = camera.update(this.playerPositionValue);
    this.refreshInteractionTarget();
    this.animationStepValue += 1;
    field.view.update(this.createFrame());
    this.dispatchFieldAction(snapshot);
    return snapshot;
  }

  public async interactNpc(npcId: string): Promise<DomainResult<NpcResolution>> {
    if (!this.entered || this.destroyed || this.panelOpen) return failure(createDomainError("INVALID_BATTLE_PHASE", { expected: ["INIT"], actual: "INIT" }));
    const resolved = this.npcService.resolve(npcId, { world: this.options.currentSave().world });
    if (!resolved.ok) {
      // 锁定与内容错误只在这里投影一次；GameFlow 不再重新 resolve 同一个 NPC。
      this.openPanel("dialogue");
      const details = resolved.error.details;
      const lockReasonKey = details && "lockReasonKey" in details && typeof details.lockReasonKey === "string"
        ? details.lockReasonKey
        : resolved.error.code;
      this.dialogue.showError(lockReasonKey);
      try { await this.options.onNpcError?.(npcId, resolved.error); } catch { /* 错误投影失败不能解除冻结 */ }
      return resolved;
    }
    this.openPanel("dialogue");
    this.dialogue.show(resolved.value.route.dialogueId, 0);
    try {
      await this.options.onNpcRoute?.(resolved.value);
    } catch {
      // 路由失败时保留对话面板与冻结状态，用户可关闭后重试，不能让移动在后台继续。
      this.dialogue.showError("npc.route_failed");
      return failure(createDomainError("INVALID_CONTENT", { path: `npcs.${npcId}.route`, issueKey: "callback_failed" }));
    }
    return success(resolved.value);
  }

  public closePanel(): void {
    this.options.modal?.setEnabled(false);
    this.dialogue.close();
    this.panelOpen = false;
    this.panelKindValue = null;
    this.actionInFlight = null;
    if (this.entered && !this.destroyed && !this.paused) {
      this.refreshInteractionTarget();
      this.enableInput();
      this.hudValue?.setEnabled(true);
      if (this.fieldMode && this.fieldViewPaused) {
        this.fieldViewPaused = false;
        this.fieldOptions?.view.resume(this.createFrame());
      }
    }
    void this.options.onPanelStateChange?.(null);
  }

  /** 地图学家在已打开对话中原地切换，不能再次走会被 panelOpen 拒绝的通用入口。 */
  public openFloorSelectFromPanel(): boolean {
    if (!this.panelOpen || this.panelKindValue !== "dialogue" || this.destroyed) return false;
    this.panelKindValue = "floorSelect";
    this.dialogue.close();
    this.options.modal?.setEnabled(!this.paused);
    void this.options.onPanelStateChange?.("floorSelect");
    void this.options.onFloorSelectRequest?.();
    return true;
  }

  /** floorSelect 内唯一合法离城入口；失败保留面板、页码和选中项，允许重试。 */
  public departFromFloorPanel(floorId: string, mode: TownDepartureInput["mode"]): Promise<DomainResult<GameSaveV1>> {
    if (this.departureInFlight) return this.departureInFlight;
    if (!this.panelOpen || this.panelKindValue !== "floorSelect") {
      return Promise.resolve(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
    }
    const entry = this.floorSelect.entries.find((candidate) => candidate.floor.id === floorId);
    if (!entry || !entry.modes.includes(mode as FloorEntryMode)) {
      return Promise.resolve(failure(createDomainError("INVALID_CONTENT", { path: `floorSelect.${floorId}`, issueKey: "invalid_floor_entry" })));
    }
    const input: TownDepartureInput = { floor: entry.floor, mode };
    const gate = validateTownDeparture(input, this.options.currentSave());
    if (!gate.ok) return Promise.resolve(gate);
    if (!this.options.departure) return Promise.resolve(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
    const request = this.options.departure.depart(input, this.options.currentSave())
      .then(async (result) => {
        if (!result.ok) {
          this.dialogue.showError(result.error.code);
          return result;
        }
        await this.options.onDepartureCommitted?.(result.value, input);
        this.closePanel();
        return result;
      })
      .catch(() => failure(createDomainError("SAVE_FAILED", { operation: "save" })) as DomainResult<GameSaveV1>)
      .finally(() => { if (this.departureInFlight === request) this.departureInFlight = null; });
    this.departureInFlight = request;
    return request;
  }

  public async depart(input: TownDepartureInput): Promise<DomainResult<GameSaveV1>> {
    if (!this.options.departure) return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
    if (this.panelOpen) return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
    const gate = validateTownDeparture(input, this.options.currentSave());
    if (!gate.ok) return gate;
    const result = await this.options.departure.depart(input, this.options.currentSave());
    if (!result.ok) return result;
    await this.options.onDepartureCommitted?.(result.value, input);
    return result;
  }

  public async exit(): Promise<void> {
    this.pause();
    this.options.modal?.setEnabled(false);
    this.entered = false;
    this.panelOpen = false;
    this.panelKindValue = null;
    this.actionInFlight = null;
    this.departureInFlight = null;
    this.dialogue.close();
  }

  public pause(): void {
    if (this.destroyed) return;
    if (this.paused) return;
    this.freezeInput();
    this.options.modal?.setEnabled(false);
    this.hudValue?.setEnabled(false);
    this.paused = true;
    if (this.fieldMode && !this.fieldViewPaused) {
      this.fieldOptions?.view.pause();
      this.fieldViewPaused = true;
    }
  }

  public resume(): void {
    if (this.destroyed || !this.entered || !this.paused) return;
    this.paused = false;
    if (this.panelOpen) {
      // 系统暂停期间保持世界与 HUD 冻结，只恢复当前模态的输入。
      this.options.modal?.setEnabled(true);
      return;
    }
    this.enableInput();
    this.hudValue?.setEnabled(true);
    this.options.audio?.setMusic?.("bgm_town", 10_000);
    if (this.fieldMode && this.fieldViewPaused) {
      this.fieldViewPaused = false;
      this.fieldOptions?.view.resume(this.createFrame());
    }
  }

  public setViewport(viewport: ViewportResult): void {
    this.assertViewport(viewport);
    this.viewportValue = viewport;
    this.options.modal?.setViewport(viewport);
    if (!this.fieldMode || this.destroyed) return;
    this.hudValue?.setViewport(viewport);
    this.fieldOptions?.view.setViewport(viewport);
  }

  public async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.entered = false;
    this.paused = true;
    this.freezeInput();
    this.hudValue?.setEnabled(false);
    this.actionInFlight = null;
    this.departureInFlight = null;
    this.panelOpen = false;
    this.panelKindValue = null;
    this.dialogue.close();
    this.options.modal?.destroy();
    if (this.fieldMode) this.fieldOptions?.view.destroy();
    this.clearFieldProjection();
  }

  public get modeChoices(): readonly FloorEntryMode[] { return this.floorSelect.entries.flatMap((entry) => entry.modes); }

  private assertViewport(viewport: ViewportResult): void {
    if (!viewport.safeRect || viewport.safeRect.width <= 0 || viewport.safeRect.height <= 0) throw new Error("TOWN_VIEWPORT_INVALID");
  }

  private requireFieldOptions(): TownFieldRuntimeOptions {
    const field = this.fieldOptions;
    if (!field
      || !field.map
      || !field.resources
      || typeof field.tilesetAssetId !== "string"
      || typeof field.playerFieldSpriteId !== "string"
      || typeof field.npcPresentation !== "function"
      || !field.view
      || typeof field.view.prepare !== "function"
      || typeof field.view.enter !== "function"
      || typeof field.view.update !== "function"
      || typeof field.view.setViewport !== "function"
      || typeof field.view.pause !== "function"
      || typeof field.view.resume !== "function"
      || typeof field.view.destroy !== "function"
      || typeof field.resources.hasBundle !== "function"
      || typeof field.resources.hasAsset !== "function"
      || typeof field.resources.hasFieldSprite !== "function"
      || typeof field.resources.hasCoreFrame !== "function"
      || typeof field.getHudStatus !== "function"
      || (field.onInteraction !== undefined && typeof field.onInteraction !== "function")
      || (field.onFieldAction !== undefined && typeof field.onFieldAction !== "function")) {
      throw new Error("TOWN_FIELD_OPTIONS_INCOMPLETE");
    }
    return field;
  }

  private validateTownObjects(field: TownFieldRuntimeOptions): void {
    this.npcPresentationValues.clear();
    for (const object of field.map.objects) {
      if (object.kind === "npc") {
        const cached = this.npcPresentationValues.get(object.npcId);
        if (cached) continue;
        const presentation = field.npcPresentation(object.npcId);
        if (!presentation
          || typeof presentation.spriteId !== "string"
          || presentation.spriteId.trim().length === 0
          || typeof presentation.displayName !== "string"
          || presentation.displayName.trim().length === 0) {
          throw new Error(`TOWN_NPC_PRESENTATION_INVALID:${object.objectId}`);
        }
        this.npcPresentationValues.set(object.npcId, Object.freeze({
          spriteId: presentation.spriteId,
          displayName: presentation.displayName,
        }));
        continue;
      }
      if (object.kind === "portal" && object.action.kind === "openFloorSelect" && object.frameId === "object_portal_floor") continue;
      const unsupportedPart = object.kind === "portal" ? object.action.kind : object.kind;
      throw new Error(`TOWN_MAP_OBJECT_UNSUPPORTED:${object.objectId}/${unsupportedPart}`);
    }
  }

  private buildActors(field: TownFieldRuntimeOptions): void {
    const actors: ActorView[] = [new ActorView({
      objectId: "player",
      resource: { kind: "player", fieldSpriteId: field.playerFieldSpriteId },
      resources: field.resources,
      position: field.map.spawnPoint,
    })];
    for (const object of field.map.objects) {
      if (object.kind === "npc") {
        const presentation = this.npcPresentationValues.get(object.npcId);
        if (!presentation) throw new Error(`TOWN_NPC_PRESENTATION_MISSING:${object.objectId}`);
        actors.push(new ActorView({
          objectId: object.objectId,
          resource: { kind: "npc", spriteId: presentation.spriteId },
          displayName: presentation.displayName,
          resources: field.resources,
          position: object.position,
        }));
      } else {
        actors.push(new ActorView({
          objectId: object.objectId,
          resource: { kind: "object", frameId: "object_portal_floor" },
          resources: field.resources,
          position: object.position,
        }));
      }
    }
    this.actorViewsValue = actors;
  }

  private refreshInteractionTarget(): void {
    const field = this.fieldOptions;
    const playerPosition = this.playerPositionValue;
    const interaction = this.interactionSystemValue;
    const hud = this.hudValue;
    if (!field || !playerPosition || !interaction || !hud) return;
    const result = interaction.select({ playerPosition, objects: field.map.objects, openedChestObjectIds: [] });
    this.interactionTargetValue = result.target;
    hud.setInteractionEnabled(result.enabled);
  }

  private createFrame(): FieldSceneFrame {
    const field = this.requireFieldOptions();
    if (!this.tileMapValue || !this.cameraPositionValue || !this.playerPositionValue || !this.hudValue) throw new Error("TOWN_FIELD_NOT_PREPARED");
    const frame: FieldSceneFrame = {
      map: this.tileMapValue,
      actors: Object.freeze([...this.actorViewsValue]),
      camera: Object.freeze({ ...this.cameraPositionValue }),
      hud: this.hudValue.getLayout(),
      hudStatus: field.getHudStatus(),
      interactionTarget: this.interactionTargetValue,
      hiddenObjectIds: Object.freeze([]),
      animationStep: this.animationStepValue,
    };
    return Object.freeze(frame);
  }

  private openPanel(kind: Exclude<TownPanelKind, null>): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.panelKindValue = kind;
    this.freezeInput();
    this.options.modal?.setEnabled(!this.paused);
    this.hudValue?.setEnabled(false);
    if (this.fieldMode && !this.fieldViewPaused) {
      this.fieldOptions?.view.pause();
      this.fieldViewPaused = true;
    }
    void this.options.onPanelStateChange?.(kind);
  }

  private dispatchFieldAction(snapshot: InputSnapshot): void {
    if (this.actionInFlight) return;
    for (const action of snapshot.actions) {
      if (!isFieldInputAction(action)) continue;
      if (action === "interact") {
        const target = this.interactionTargetValue;
        if (!target) return;
        if (target.object.kind === "npc") {
          this.trackAction(this.interactNpc(target.object.npcId));
        } else if (target.object.kind === "portal" && target.action === "openFloorSelect") {
          this.openPanel("floorSelect");
          this.trackCallback(async () => {
            await this.fieldOptions?.onInteraction?.(target);
            await this.options.onFloorSelectRequest?.();
          });
        }
        return;
      }
      this.trackCallback(() => this.fieldOptions?.onFieldAction?.(action));
      return;
    }
  }

  private trackCallback(callback: () => void | Promise<void>): void {
    try {
      this.trackAction(callback());
    } catch {
      // 异步路由或同步适配器失败都不能冒泡到 ticker，也不能解除当前面板的冻结。
    }
  }

  private trackAction(task: Promise<unknown> | void): void {
    const settled: Promise<void> = Promise.resolve(task).then(() => undefined, () => undefined);
    this.actionInFlight = settled;
    void settled.then(() => {
      if (this.actionInFlight === settled) this.actionInFlight = null;
    });
  }

  private freezeInput(): void {
    if (this.inputFrozen) return;
    this.options.input.setEnabled(false);
    this.options.input.resetAll?.();
    this.inputFrozen = true;
  }

  private enableInput(): void {
    if (!this.inputFrozen) return;
    this.options.input.setEnabled(true);
    this.inputFrozen = false;
  }

  private clearFieldProjection(): void {
    this.tileMapValue = null;
    this.collisionGridValue = null;
    this.cameraSystemValue = null;
    this.interactionSystemValue = null;
    this.hudValue = null;
    this.actorViewsValue = [];
    this.playerPositionValue = null;
    this.cameraPositionValue = null;
    this.interactionTargetValue = null;
    this.animationStepValue = 0;
    this.npcPresentationValues.clear();
    this.fieldViewPaused = false;
  }
}
