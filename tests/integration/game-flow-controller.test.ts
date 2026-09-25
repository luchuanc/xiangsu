import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "node" } });
  }
});
import { GameFlowController, selectAutoEncounterTarget, type GameFlowBattleStartValue, type GameFlowSceneFactories } from "../../src/app/GameFlowController";
import type { Scene } from "../../src/app/Scene";
import { createDomainError, failure, success, type DomainResult } from "../../src/domain/common/DomainResult";
import type { BattleCommandV1, BattleDomainEventV1, BattleSnapshotV1, BattleUnitStateV1, EquipmentInstance, GameSaveV1, StatBlock, Vector2 } from "../../src/content/contracts";
import type { AssetLease } from "../../src/app/AssetService";
import { ExplorationScene, type ExplorationSceneResources } from "../../src/scenes/exploration/ExplorationScene";
import { CollisionGrid } from "../../src/domain/exploration/CollisionGrid";
import { movePlayer } from "../../src/domain/exploration/MovementSystem";
import { DomainContext, SequentialIdFactory } from "../../src/domain/common/DomainContext";
import { abyssEchoContentRoot } from "../../src/content/data/abyssEchoes";
import { ContentCatalog } from "../../src/content/Catalog";
import { floors06To10AssetManifest } from "../../src/content/data/assets.manifest";
import { createNewGameSave, validateGameSave } from "../../src/domain/save/GameSave";
import { calculateEquipmentStatModifiers, type EquipmentServiceContent } from "../../src/domain/inventory/EquipmentService";
import { ProgressionService } from "../../src/domain/character/ProgressionService";
import { calculateViewport } from "../../src/app/ViewportService";
import { layoutTitleButtons, TITLE_BUTTON_RECTS } from "../../src/ui/rendering/TitleSceneRenderer";
import { getTownModalPageSize } from "../../src/ui/rendering/TownModalRenderer";
import { Container, Spritesheet, Texture } from "pixi.js";
import { createPixiSceneRoot } from "../../src/app/PixiSceneRoot";
import { SceneRouter } from "../../src/app/SceneRouter";
import type { FieldHudStatus } from "../../src/scenes/exploration/FieldSceneView";

/** 生产 field 路径使用真实 Pixi Texture/Spritesheet，不用普通对象冒充资源。 */
function productionAssetService(loadedBundleIds: readonly string[] = ["boot", "core_ui", "player_common"]): {
  readonly service: {
    acquire: ReturnType<typeof vi.fn>;
    getReferenceCount: ReturnType<typeof vi.fn>;
    getLoadedBundleIds: ReturnType<typeof vi.fn>;
    getLoadedResource: ReturnType<typeof vi.fn>;
    restoreLoadedBundles: ReturnType<typeof vi.fn>;
  };
  readonly events: string[];
} {
  const loaded = new Set(loadedBundleIds);
  const events: string[] = [];
  const assets = new Map(floors06To10AssetManifest.assets.map((entry) => [entry.id, entry]));
  const coreAtlasEntry = assets.get("atlas_core_ui");
  const requiredFrames = coreAtlasEntry?.kind === "atlas" ? coreAtlasEntry.requiredFrames : [];
  const coreFrames = Object.fromEntries(
    requiredFrames.map((frameId) => [frameId, { frame: { x: 0, y: 0, w: 16, h: 16 } }]),
  );
  const coreAtlas = new Spritesheet(Texture.WHITE, { frames: coreFrames, meta: { scale: 1 } });
  coreAtlas.parseSync();
  const resources = new Map<string, Record<string, unknown>>();
  for (const bundle of floors06To10AssetManifest.bundles) {
    const aliases: Record<string, unknown> = {};
    for (const assetId of bundle.assetIds) {
      const entry = assets.get(assetId);
      if (!entry || entry.kind === "audio") continue;
      aliases[assetId] = entry.kind === "atlas" ? coreAtlas : new Texture({ source: Texture.WHITE.source });
    }
    resources.set(bundle.id, aliases);
  }
  const service = {
    acquire: vi.fn(async (bundleId: string) => {
      events.push(`acquire:${bundleId}`);
      loaded.add(bundleId);
      return success<AssetLease>({
        bundleId,
        release: async (options) => {
          options?.beforeUnload?.();
          events.push(`release:${bundleId}`);
          loaded.delete(bundleId);
        },
      });
    }),
    getReferenceCount: vi.fn((bundleId: string) => loaded.has(bundleId) ? 1 : 0),
    getLoadedBundleIds: vi.fn(() => [...loaded]),
    getLoadedResource: vi.fn((bundleId: string) => loaded.has(bundleId) ? resources.get(bundleId) : undefined),
    restoreLoadedBundles: vi.fn(async () => undefined),
  };
  return { service, events };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolvePromise: ((value: T) => void) | null = null;
  let rejectPromise: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => { resolvePromise?.(value); },
    reject: (error) => { rejectPromise?.(error); },
  };
}

function scene(label: string): Scene<unknown> & { readonly label: string } {
  return {
    label,
    root: { parent: null },
    prepare: vi.fn(async () => undefined),
    enter: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    exit: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  };
}

function save(): GameSaveV1 {
  return structuredClone({
    schemaVersion: 1,
    contentVersion: "content-1.2.0",
    saveId: "slot_1",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    gold: 200,
    skillStoneFocusCharacterId: "char_wanderer",
    characters: {},
    party: { slots: ["char_wanderer", null, null, null] },
    inventory: { equipment: [], skillStones: [], stackables: { item_minor_potion: 3 }, overflowEquipment: [], overflowSkillStones: [] },
    shop: { stockRevision: 1, generatedFromExpeditionId: null, offers: [] },
    world: { highestUnlockedFloor: 1, clearedBossEncounterIds: [], bossRetryUnlockedFloorIds: [], completedQuestIds: [], discoveredComboIds: [], discoveredEnemyIds: [], echoCharges: 0, echoAttemptSequence: 0, clearedEchoIds: [], storyCompleted: false },
    expedition: null,
    battle: null,
    battleAssist: { enabled: false, lastActionByCharacter: {} },
    settings: { qualityPreset: "standard", battleAnimationSpeed: 1, musicVolume: 80, sfxVolume: 80, reducedFlashes: false, reducedScreenShake: false },
    claimedRewardTransactionIds: [],
  });
}

function terminalSave(): GameSaveV1 {
  return createNewGameSave(abyssEchoContentRoot, "2026-01-01T00:00:00.000Z", {
    newGameSeed: 1,
    idFactory: new SequentialIdFactory(),
  });
}

function managementSave(): GameSaveV1 {
  const value = terminalSave();
  const base = abyssEchoContentRoot.equipmentBases.find((candidate) => candidate.slot === "weapon" && candidate.weaponType === "sword");
  if (!base) throw new Error("管理页夹具缺少剑类底材");
  const instance: EquipmentInstance = {
    instanceId: "eq_management_test",
    baseId: base.id,
    itemLevel: base.minItemLevel,
    quality: "common",
    craftGrade: "ordinary",
    affixes: [],
    abyssAffix: null,
    locked: false,
    acquiredAt: "2026-01-01T00:00:00.000Z",
    sourceTransactionId: "tx_management_test",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
  value.inventory.equipment.push(instance);
  return value;
}

function equipmentInstance(
  instanceId: string,
  baseId: string,
  overrides: Partial<EquipmentInstance> = {},
): EquipmentInstance {
  return {
    instanceId,
    baseId,
    itemLevel: 1,
    quality: "common",
    craftGrade: "ordinary",
    affixes: [],
    abyssAffix: null,
    locked: false,
    acquiredAt: "2026-01-01T00:00:00.000Z",
    sourceTransactionId: `tx_${instanceId}`,
    reforgeLockedIndex: null,
    reforgeCount: 0,
    ...overrides,
  };
}

function expedition(): NonNullable<GameSaveV1["expedition"]> {
  return {
    expeditionId: "exp_terminal",
    expeditionSeed: 1,
    mode: "exploration",
    abyssEchoId: null,
    floorId: "floor_01",
    mapId: "map_floor_01",
    playerPosition: { x: 16, y: 16 },
    safePosition: { x: 16, y: 16 },
    defeatedEncounterObjectIds: [],
    openedChestObjectIds: [],
    encounterProtectionStepsRemaining: 0,
    focusedEliteStoneConsumed: false,
    startedAt: "2026-01-01T00:00:00.000Z",
  };
}

function battleUnit(definitionId: string, currentHp: number, maxHp = 100): BattleUnitStateV1 {
  const stats: StatBlock = { maxHp, attack: 20, defense: 10, speed: 20, critRateBps: 0, critDamageBps: 15000, effectHitBps: 0, effectResistBps: 0 };
  return {
    unitId: `party:${definitionId}`,
    definitionId,
    faction: "party",
    slot: 0,
    level: 1,
    prePercentStats: { ...stats },
    staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
    stats,
    currentHp,
    energy: 0,
    cooldowns: {},
    statuses: [],
    eligibleRound: 1,
    usedExtraTurnThisRound: false,
    directHitEnergyRootActionIds: [],
  };
}

function battleSnapshot(phase: "REWARD_PENDING" | "DEFEAT" | "RETREAT", units: BattleUnitStateV1[]): BattleSnapshotV1 {
  return {
    battleId: "battle_terminal",
    expeditionId: "exp_terminal",
    battleRevision: 1,
    encounterId: "encounter_floor_01_normal_c",
    encounterObjectId: "obj_f01_n03",
    phase,
    outcome: phase === "DEFEAT" ? "defeat" : phase === "RETREAT" ? "retreat" : "victory",
    round: 1,
    units,
    initiativeQueueUnitIds: units.map((unit) => unit.unitId),
    currentUnitId: null,
    pendingEvents: [],
    pendingBossIntents: [],
    successfulItemUses: 0,
    abyssEchoOutcome: "notApplicable",
    rngState: [1, 2, 3, 4],
    firedComboKeys: [],
    roundTriggerCounts: {},
    battleTriggerCounts: {},
    metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 },
    reward: null,
    returnMapId: "map_floor_01",
    returnSafePosition: { x: 80, y: 96 },
  };
}

function testDomain(): DomainContext {
  return new DomainContext({ clock: { now: () => "2026-01-01T00:00:00.000Z" }, idFactory: new SequentialIdFactory(), seedFactory: { nextUint32: () => 1 } });
}

function rewardTransaction(): NonNullable<BattleSnapshotV1["reward"]> {
  return {
    transactionId: "reward_terminal",
    source: { kind: "encounter", encounterId: "encounter_floor_01_normal_c", mapId: "map_floor_01", objectId: "obj_f01_n03" },
    gold: 0,
    xp: 10,
    stackables: {},
    stackableCapConversions: [],
    equipment: [],
    skillStones: [],
    instanceOrder: [],
    claimed: false,
  };
}

function terminalSceneFactories(): GameFlowSceneFactories {
  const scenes = { title: scene("title"), town: scene("town"), exploration: scene("exploration"), battle: scene("battle") };
  return { title: () => scenes.title, town: () => scenes.town, exploration: () => scenes.exploration, battle: () => scenes.battle };
}

class FlowFakeElement {
  public readonly dataset: Record<string, string> = {};
  public readonly children: FlowFakeElement[] = [];
  public readonly listeners = new Map<string, (event?: FlowPointerEvent) => void>();
  public readonly attributes = new Map<string, string>();
  public ownerDocument!: FlowFakeDocument;
  public textContent = "";
  public id = "";
  public type = "";
  public disabled = false;
  public hidden = false;
  public className = "";
  public readonly style: Record<string, string> = {};
  public readonly classList = {
    contains: (name: string): boolean => this.className.split(/\s+/u).includes(name),
  };

  public appendChild(child: FlowFakeElement): FlowFakeElement { this.children.push(child); return child; }
  public replaceChildren(...children: FlowFakeElement[]): void { this.children.splice(0, this.children.length, ...children); }
  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "class") this.className = value;
  }
  public getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  public addEventListener(type: string, listener: (event?: FlowPointerEvent) => void): void { this.listeners.set(type, listener); }
  public removeEventListener(type: string): void { this.listeners.delete(type); }
  public remove(): void { /* fake DOM */ }
  public find(testId: string): FlowFakeElement | undefined {
    if (this.dataset.testid === testId) return this;
    for (const child of this.children) {
      const found = child.find(testId);
      if (found) return found;
    }
    return undefined;
  }
}

function collectFakeElements(root: FlowFakeElement): FlowFakeElement[] {
  return [root, ...root.children.flatMap((child) => collectFakeElements(child))];
}

interface FlowPointerEvent {
  readonly pointerId: number;
  preventDefault(): void;
}

class FlowFakeDocument {
  public readonly root = new FlowFakeElement();
  public readonly placeholder: FlowFakeElement;

  public constructor() {
    this.root.ownerDocument = this;
    this.placeholder = this.createElement();
    this.placeholder.id = "startup-placeholder";
    this.placeholder.textContent = "像素远征 · 正在点亮篝火";
    this.root.appendChild(this.placeholder);
  }

  public createElement(): FlowFakeElement {
    const element = new FlowFakeElement();
    element.ownerDocument = this;
    return element;
  }
  public querySelector(selector: string): FlowFakeElement | null {
    if (selector === "#game-root") return this.root;
    if (selector === "#startup-placeholder") return this.placeholder;
    if (selector === "#game-flow-ui") return this.findById(this.root, "game-flow-ui");
    const match = selector.match(/^\[data-testid="([^"]+)"\]$/u);
    return match ? this.root.find(match[1]) ?? null : this.root;
  }

  private findById(node: FlowFakeElement, id: string): FlowFakeElement | null {
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = this.findById(child, id);
      if (found) return found;
    }
    return null;
  }
}

describe("GameFlowController", () => {
  it("初始 blocked 时挂载语义根立即继承输入门禁", async () => {
    const documentValue = new FlowFakeDocument();
    const viewport = calculateViewport({ width: 320, height: 568 });
    const listeners = new Set<(value: typeof viewport) => void>();
    const flow = new GameFlowController({
      runtime: {
        lastViewport: viewport,
        isInputEnabled: false,
        subscribeViewport: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success(next),
        replaceAfterConfirmation: async (next) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      rootFactory: () => ({ parent: null }),
    });

    await flow.start();
    const ui = documentValue.querySelector("#game-flow-ui");
    expect((ui as unknown as { inert?: boolean }).inert).toBe(true);
    expect(ui?.getAttribute("aria-disabled")).toBe("true");
    for (const listener of listeners) listener(calculateViewport({ width: 640, height: 360 }));
    expect((ui as unknown as { inert?: boolean }).inert).toBe(true);
    flow.destroy();
  });

  it("标题语义按钮按 contain canvas 和逻辑矩形对齐，resize 只重算样式", async () => {
    const documentValue = new FlowFakeDocument();
    const listeners = new Set<(value: ReturnType<typeof calculateViewport>) => void>();
    const viewport = calculateViewport({ width: 844, height: 390 });
    const flow = new GameFlowController({
      runtime: {
        lastViewport: viewport,
        isInputEnabled: true,
        subscribeViewport: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success(next),
        replaceAfterConfirmation: async (next) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      rootFactory: () => ({ parent: null }),
    });

    await flow.start();
    const button = documentValue.querySelector('[data-testid="new-game"]');
    const logicalScale = viewport.scale;
    const ui = documentValue.querySelector("#game-flow-ui");
    expect(ui?.style.left).toBe(`${viewport.offsetX}px`);
    expect(ui?.style.top).toBe(`${viewport.offsetY}px`);
    expect(ui?.style.width).toBe(`${viewport.cssWidth}px`);
    expect(ui?.style.height).toBe(`${viewport.cssHeight}px`);
    expect(button?.style.left).toBe(`${TITLE_BUTTON_RECTS.newGame.x * logicalScale}px`);
    expect(button?.style.top).toBe(`${TITLE_BUTTON_RECTS.newGame.y * logicalScale}px`);
    expect(Number.parseFloat(button?.style.height ?? "0")).toBeGreaterThanOrEqual(48);

    const resized = calculateViewport({ width: 568, height: 320 });
    for (const listener of listeners) listener(resized);
    expect(ui?.style.left).toBe(`${resized.offsetX}px`);
    expect(ui?.style.top).toBe(`${resized.offsetY}px`);
    expect(button?.style.left).toBe(`${TITLE_BUTTON_RECTS.newGame.x * resized.scale}px`);
    expect(button?.style.top).toBe(`${TITLE_BUTTON_RECTS.newGame.y * resized.scale}px`);
    const standard = calculateViewport({ width: 640, height: 360 });
    for (const listener of listeners) listener(standard);
    expect(ui?.style.left).toBe(`${standard.offsetX}px`);
    expect(ui?.style.top).toBe(`${standard.offsetY}px`);
    expect(button?.style.left).toBe(`${TITLE_BUTTON_RECTS.newGame.x * standard.scale}px`);
    expect(button?.style.top).toBe(`${TITLE_BUTTON_RECTS.newGame.y * standard.scale}px`);
    flow.destroy();
  });

  it("标题语义按钮与 Pixi 使用同一安全区布局，窄安全区仍完整落入且恢复基准", async () => {
    const documentValue = new FlowFakeDocument();
    const listeners = new Set<(value: ReturnType<typeof calculateViewport>) => void>();
    const narrowSafeViewport = calculateViewport(
      { width: 640, height: 360 },
      { top: 0, right: 340, bottom: 0, left: 0 },
    );
    expect(narrowSafeViewport.blockedReason).toBeNull();
    const narrowLayout = layoutTitleButtons(narrowSafeViewport.safeRect);
    const flow = new GameFlowController({
      runtime: {
        lastViewport: narrowSafeViewport,
        isInputEnabled: true,
        subscribeViewport: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      viewport: narrowSafeViewport,
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success(next),
        replaceAfterConfirmation: async (next) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      rootFactory: () => ({ parent: null }),
    });

    await flow.start();
    const buttonRects = [
      ["continue", narrowLayout.continue],
      ["new-game", narrowLayout.newGame],
    ] as const;
    for (const [testId, rect] of buttonRects) {
      const button = documentValue.querySelector(`[data-testid="${testId}"]`);
      const left = Number.parseFloat(button?.style.left ?? "NaN");
      const top = Number.parseFloat(button?.style.top ?? "NaN");
      const width = Number.parseFloat(button?.style.width ?? "NaN");
      const height = Number.parseFloat(button?.style.height ?? "NaN");
      expect(left).toBe(rect.x * narrowSafeViewport.scale);
      expect(top).toBe(rect.y * narrowSafeViewport.scale);
      expect(left).toBeGreaterThanOrEqual(narrowSafeViewport.safeRect.x * narrowSafeViewport.scale);
      expect(top).toBeGreaterThanOrEqual(narrowSafeViewport.safeRect.y * narrowSafeViewport.scale);
      expect(left + width).toBeLessThanOrEqual(narrowSafeViewport.safeRect.right * narrowSafeViewport.scale);
      expect(top + height).toBeLessThanOrEqual(narrowSafeViewport.safeRect.bottom * narrowSafeViewport.scale);
    }

    const normalViewport = calculateViewport({ width: 640, height: 360 });
    for (const listener of listeners) listener(normalViewport);
    const normalButton = documentValue.querySelector('[data-testid="new-game"]');
    expect(normalButton?.style.left).toBe(`${TITLE_BUTTON_RECTS.newGame.x * normalViewport.scale}px`);
    expect(normalButton?.style.top).toBe(`${TITLE_BUTTON_RECTS.newGame.y * normalViewport.scale}px`);
    flow.destroy();
  });

  it("订阅 runtime viewport 并转发给活动场景，不重建存档或路由", async () => {
    const documentValue = new FlowFakeDocument();
    const initialViewport = calculateViewport({ width: 640, height: 360 });
    const nextViewport = calculateViewport({ width: 568, height: 320 });
    const listeners = new Set<(viewport: typeof initialViewport) => void>();
    const activeScene = Object.assign(scene("title"), { setViewport: vi.fn() });
    let transitions = 0;
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(null)),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
      save: vi.fn(async (_expectedRevision: number, next: GameSaveV1) => success(next)),
    };
    const flow = new GameFlowController({
      runtime: {
        lastViewport: initialViewport,
        subscribeViewport: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: {
        transition: async <Params>(target: Scene<Params>, params: Params) => {
          transitions += 1;
          await target.prepare(params);
          await target.enter(params);
        },
      },
      repository,
      sceneFactories: {
        title: () => activeScene,
        town: () => scene("town"),
        exploration: () => scene("exploration"),
        battle: () => scene("battle"),
      },
      rootFactory: () => ({ parent: null }),
    });

    await flow.start();
    const saveBefore = flow.save;
    expect(transitions).toBe(1);
    expect(activeScene.setViewport).toHaveBeenCalledWith(initialViewport);

    for (const listener of listeners) listener(nextViewport);
    expect(activeScene.setViewport).toHaveBeenCalledWith(nextViewport);
    expect(flow.save).toBe(saveBefore);
    expect(transitions).toBe(1);

    flow.destroy();
    for (const listener of listeners) listener(initialViewport);
    expect(activeScene.setViewport).toHaveBeenCalledTimes(2);
  });

  it("成功启动后隐藏加载占位，销毁恢复显示且新控制器可再次隐藏", async () => {
    const documentValue = new FlowFakeDocument();
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(null)),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
      save: vi.fn(async (_expectedRevision: number, next: GameSaveV1) => success({ ...next, revision: next.revision + 1 })),
    };
    const options = {
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      rootFactory: () => ({ parent: null }),
    };
    const first = new GameFlowController(options);

    await first.start();
    expect(documentValue.placeholder.hidden).toBe(true);

    first.destroy();
    expect(documentValue.placeholder.hidden).toBe(false);

    const second = new GameFlowController(options);
    await second.start();
    expect(documentValue.placeholder.hidden).toBe(true);
    second.destroy();
  });

  it("存档读取失败时保持加载占位可见", async () => {
    const documentValue = new FlowFakeDocument();
    const repository = {
      get: vi.fn(async () => failure(createDomainError("SAVE_FAILED", { operation: "load" }))),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
      save: vi.fn(async (_expectedRevision: number, next: GameSaveV1) => success({ ...next, revision: next.revision + 1 })),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      rootFactory: () => ({ parent: null }),
    });

    await expect(flow.start()).rejects.toThrow("存档读取失败");
    expect(documentValue.placeholder.hidden).toBe(false);
    flow.destroy();
  });

  it("默认真实 Pixi 根在标题路由挂载标题构图并保留语义按钮", async () => {
    const documentValue = new FlowFakeDocument();
    const { createPixiSceneRoot } = await import("../../src/app/PixiSceneRoot");
    const root = createPixiSceneRoot();
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(null)),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
      save: vi.fn(async (_expectedRevision: number, next: GameSaveV1) => success({ ...next, revision: next.revision + 1 })),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      rootFactory: () => root,
    });

    await flow.start();

    expect(flow.state).toBe("title");
    expect(root.screen.children.length).toBeGreaterThan(0);
    expect(documentValue.querySelector('[data-testid="new-game"]')?.getAttribute("aria-label"))
      .toBe("开始新游戏");
    expect(documentValue.querySelector("#game-flow-ui")?.classList.contains("semantic-ui"))
      .toBe(true);

    flow.destroy();
  });

  it("城镇商人面板列出报价并通过 CAS 完成购买", async () => {
    const initial = terminalSave();
    const documentValue = new FlowFakeDocument();
    const merchant = abyssEchoContentRoot.npcs.find((npc) => npc.function === "merchant");
    if (!merchant) throw new Error("测试内容缺少商人 NPC");
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: vi.fn(async (_expectedRevision: number, next: GameSaveV1) => success({ ...next, revision: next.revision + 1 })),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { townScene: unknown }).townScene = {
      interactNpc: async () => success({
        npc: merchant,
        route: { npcId: merchant.id, function: merchant.function, dialogueId: merchant.dialogueId, spriteId: merchant.spriteId },
        locked: false,
        lockReasonKey: null,
      }),
      closePanel: vi.fn(),
      dialogue: { isOpen: true },
    };
    documentValue.root.find("npc-npc_merchant")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(documentValue.root.find("merchant-panel")).toBeDefined();
    const offer = initial.shop.offers[0];
    expect(offer).toBeDefined();
    expect(documentValue.root.find(`merchant-offer-${offer.offerId}`)).toBeDefined();
    const beforeGold = flow.save?.gold ?? 0;
    documentValue.root.find(`merchant-buy-${offer.offerId}`)?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.save?.gold).toBe(beforeGold - offer.goldPrice);
    expect(flow.save?.shop.offers.find((candidate) => candidate.offerId === offer.offerId)?.sold).toBe(true);
    expect(repository.save).toHaveBeenCalledTimes(1);
    flow.destroy();
  });

  it("商人购买保存失败保留面板和权威存档并可重试，奖励失败显示可重试错误", async () => {
    const initial = terminalSave();
    const documentValue = new FlowFakeDocument();
    const merchant = abyssEchoContentRoot.npcs.find((npc) => npc.function === "merchant");
    if (!merchant) throw new Error("测试内容缺少商人 NPC");
    let failMerchantSave = true;
    let failReward = true;
    const rewardSave = structuredClone(initial);
    rewardSave.expedition = expedition();
    const rewardBattle = battleSnapshot("REWARD_PENDING", [battleUnit("char_wanderer", 80, 100)]);
    rewardBattle.reward = rewardTransaction();
    rewardSave.battle = rewardBattle;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: vi.fn(async (_expectedRevision: number, next: GameSaveV1) => failMerchantSave
        ? failure(createDomainError("SAVE_FAILED", { operation: "save" }))
        : success({ ...next, revision: next.revision + 1 })),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      settleReward: async (saveValue) => failReward
        ? failure(createDomainError("SAVE_FAILED", { operation: "save" }))
        : success({ ...saveValue, battle: null, expedition: null }),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { townScene: unknown }).townScene = {
      interactNpc: async () => success({
        npc: merchant,
        route: { npcId: merchant.id, function: merchant.function, dialogueId: merchant.dialogueId, spriteId: merchant.spriteId },
        locked: false,
        lockReasonKey: null,
      }),
      closePanel: vi.fn(),
      dialogue: { isOpen: true },
    };
    documentValue.root.find("npc-npc_merchant")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const offer = initial.shop.offers[0];
    const before = structuredClone(flow.save);
    documentValue.root.find(`merchant-buy-${offer.offerId}`)?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.save).toEqual(before);
    expect(documentValue.root.find("merchant-panel")).toBeDefined();
    expect(documentValue.root.find("merchant-error")?.textContent).toBe("SAVE_FAILED");
    failMerchantSave = false;
    documentValue.root.find(`merchant-buy-${offer.offerId}`)?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.save?.shop.offers.find((candidate) => candidate.offerId === offer.offerId)?.sold).toBe(true);

    (flow as unknown as { setSave: (saveValue: GameSaveV1) => void }).setSave(rewardSave);
    (flow as unknown as { setState: (state: "reward") => void }).setState("reward");
    expect(documentValue.root.find("reward-currencies")?.textContent).toContain(`金币 +${rewardBattle.reward.gold}`);
    expect(documentValue.root.find("reward-currencies")?.textContent).toContain(`经验 +${rewardBattle.reward.xp}`);
    expect(documentValue.root.find("reward-loot")).toBeDefined();
    expect(documentValue.root.find("claim-reward")?.textContent).toBe("领取战利品");
    documentValue.root.find("claim-reward")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.state).toBe("reward");
    expect(documentValue.root.find("reward-error")?.textContent).toBe("SAVE_FAILED");
    expect(documentValue.root.find("claim-reward")).toBeDefined();
    failReward = false;
    flow.destroy();
  });

  it("新游戏为三名教程成员各装备第一主动技能并初始化到 1 级", () => {
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) return;
    const flow = new GameFlowController({ content: catalogResult.value, domainContext: testDomain() });
    const created = (flow as unknown as { createInitialSave: () => ReturnType<typeof success<GameSaveV1>> }).createInitialSave();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.value.party.slots).toEqual(["char_wanderer", "char_iron_guard", "char_ember_mage", null]);
    expect(created.value.characters.char_ember_mage?.recruited).toBe(true);
    expect(created.value.characters.char_ranger?.recruited).toBe(false);
    for (const characterId of ["char_wanderer", "char_iron_guard", "char_ember_mage"] as const) {
      const character = catalogResult.value.getCharacter(characterId);
      expect(character.ok).toBe(true);
      if (!character.ok) continue;
      const progress = created.value.characters[characterId];
      const starterSkillId = character.value.activeSkillIds[0];
      expect(progress.equippedActiveSkillIds).toEqual([starterSkillId, null]);
      expect(progress.skillLevels[starterSkillId]).toBe(1);
    }
  });

  it("内置队伍页按指定槽位交换编队，确认前不写权威存档", async () => {
    const documentValue = new FlowFakeDocument();
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(null)),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
      save: vi.fn(async (_expectedRevision: number, next: GameSaveV1) => success({ ...next, revision: next.revision + 1 })),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    const management = documentValue.root.find("management-party");
    expect(management).toBeDefined();
    management?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(documentValue.root.find("management-party-place-char_iron_guard-slot-0")).toBeDefined();
    expect(documentValue.root.find("management-party-slot-0")?.textContent).toContain("流浪剑士");
    expect(documentValue.root.find("management-party-slot-1")?.textContent).toContain("铁卫");
    expect(documentValue.root.find("management-party-slot-2")?.textContent).toContain("炎术师");
    expect(documentValue.root.find("management-party-slot-3")?.textContent).toContain("空位");

    const authoritativeBefore = structuredClone(flow.save);
    documentValue.root.find("management-party-place-char_iron_guard-slot-0")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(documentValue.root.find("management-party-slot-0")?.textContent).toContain("铁卫");
    expect(documentValue.root.find("management-party-slot-1")?.textContent).toContain("流浪剑士");
    expect(documentValue.root.find("management-summary")?.textContent).toContain("铁卫 / 流浪剑士 / 炎术师 / 空位");
    expect(flow.save).toEqual(authoritativeBefore);
    expect(repository.save).not.toHaveBeenCalled();

    documentValue.root.find("management-party-confirm")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.save?.party.slots).toEqual(["char_iron_guard", "char_wanderer", "char_ember_mage", null]);
    expect(repository.save).toHaveBeenCalledTimes(1);
    flow.destroy();
  });

  it("管理页使用可见像素 UI 外壳而不是透明 legacy 调试层", async () => {
    const documentValue = new FlowFakeDocument();
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success({ ...next, revision: next.revision + 1 }),
        replaceAfterConfirmation: async (next) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    documentValue.root.find("management-inventory")?.listeners.get("click")?.();
    await Promise.resolve();

    const ui = documentValue.querySelector("#game-flow-ui");
    expect(ui?.className).toContain("management-ui");
    expect(ui?.className).not.toContain("legacy-debug-ui");
    expect(documentValue.root.find("management-title")?.textContent).toContain("背包");
    expect(documentValue.root.find("management-summary")?.className).toContain("management-summary");
    const firstEquipment = documentValue.root.find("management-inventory-select-first");
    if (firstEquipment) expect(firstEquipment.className).toContain("management-action");
    else expect(documentValue.root.find("management-inventory-empty-state")).toBeDefined();
    expect(documentValue.root.find("return-town")?.className).toContain("management-return");
    flow.destroy();
  });

  it("内置技能页提供已招募角色切换入口并更新当前角色", async () => {
    const documentValue = new FlowFakeDocument();
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success({ ...next, revision: next.revision + 1 }),
        replaceAfterConfirmation: async (next) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    documentValue.root.find("management-skill")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const emberMage = documentValue.root.find("management-skill-character-char_ember_mage");
    expect(emberMage).toBeDefined();
    expect(emberMage?.disabled).toBe(false);
    emberMage?.listeners.get("click")?.();
    await Promise.resolve();
    expect(documentValue.root.find("management-summary")?.textContent).toContain("炎术师");
    flow.destroy();
  });

  it("招募评估失败时展示队伍错误并保持精确确认门禁", async () => {
    const documentValue = new FlowFakeDocument();
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success({ ...next, revision: next.revision + 1 }),
        replaceAfterConfirmation: async (next) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    documentValue.root.find("management-party")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const confirm = documentValue.root.find("management-party-confirm-recruitment");
    expect(confirm?.disabled).toBe(true);
    documentValue.root.find("management-party-evaluate-recruitment")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(documentValue.root.find("management-party-error")?.textContent).toBe("RECRUITMENT_LOCKED");
    expect(documentValue.root.find("management-party-confirm-recruitment")?.disabled).toBe(true);
    flow.destroy();
  });

  it("城镇背包选择装备后显示可读底材、数值和普通/深渊词条，切换选择会更新详情", async () => {
    const documentValue = new FlowFakeDocument();
    const initial = terminalSave();
    const abyssBase = abyssEchoContentRoot.equipmentBases.find((value) => value.id === "eq_armor_t5_frost");
    const swordBase = abyssEchoContentRoot.equipmentBases.find((value) => value.id === "eq_sword_t1_windblade");
    const vitalityAffix = abyssEchoContentRoot.equipmentAffixes.find((value) => value.id === "af_vitality");
    if (!abyssBase || !swordBase) throw new Error("测试内容缺少背包详情底材");
    expect(vitalityAffix?.nameKey).toBe("equipment_affix.af_vitality.name");
    expect(vitalityAffix?.descriptionKey).toBe("equipment_affix.af_vitality.description");
    initial.inventory.equipment.push(equipmentInstance("eq_inventory_abyss", abyssBase.id, {
      itemLevel: 31,
      quality: "abyss",
      affixes: [
        { affixId: "af_vitality", tier: 4, roll: 135, craftEmpowered: false, reforged: false },
        { affixId: "af_guard", tier: 4, roll: 11, craftEmpowered: false, reforged: false },
        { affixId: "af_resolve", tier: 4, roll: 950, craftEmpowered: false, reforged: false },
        { affixId: "af_last_stand", tier: 4, roll: 11, craftEmpowered: false, reforged: false },
      ],
      abyssAffix: { affixId: "af_abyss_bloodmoon", tier: 1, roll: 7000, craftEmpowered: false, reforged: false },
    }));
    initial.inventory.equipment.push(equipmentInstance("eq_inventory_sword", swordBase.id));
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision: number, next: GameSaveV1) => success({ ...next, revision: next.revision + 1 }),
        replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    documentValue.root.find("management-inventory")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const abyssSelect = documentValue.root.find("management-inventory-select-eq_inventory_abyss");
    expect(abyssSelect).toBeDefined();
    abyssSelect?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const abyssDetail = documentValue.root.find("management-inventory-detail");
    expect(abyssDetail?.textContent).toContain("寒狱重甲");
    expect(abyssDetail?.textContent).toContain("深渊");
    expect(abyssDetail?.textContent).toContain("物品等级 31");
    expect(abyssDetail?.textContent).toContain("防御 +72");
    expect(abyssDetail?.textContent).toContain("强健");
    expect(abyssDetail?.textContent).toContain("T4");
    expect(abyssDetail?.textContent).toContain("roll=135");
    expect(abyssDetail?.textContent).toContain("深渊·血月");
    expect(abyssDetail?.textContent).toContain("roll=7000");

    documentValue.root.find("management-inventory-select-eq_inventory_sword")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const swordDetail = documentValue.root.find("management-inventory-detail");
    expect(swordDetail?.textContent).toContain("青风短剑");
    expect(swordDetail?.textContent).toContain("攻击 +12");
    expect(swordDetail?.textContent).not.toContain("寒狱重甲");
    flow.destroy();
  });

  it("背包按角色展示同槽属性差异，武器类型不兼容时禁用并保留明确原因", async () => {
    const documentValue = new FlowFakeDocument();
    const initial = terminalSave();
    initial.characters.char_iron_guard.recruited = true;
    initial.characters.char_ember_mage.recruited = true;
    initial.party.slots = ["char_wanderer", "char_iron_guard", "char_ember_mage", null];
    const currentBase = abyssEchoContentRoot.equipmentBases.find((value) => value.id === "eq_sword_t1_windblade");
    const candidateBase = abyssEchoContentRoot.equipmentBases.find((value) => value.id === "eq_sword_t2_bloodiron");
    if (!currentBase || !candidateBase) throw new Error("测试内容缺少换装底材");
    const current = equipmentInstance("eq_current_wanderer", currentBase.id);
    const candidate = equipmentInstance("eq_candidate_wanderer", candidateBase.id, { itemLevel: 11 });
    initial.inventory.equipment.push(current, candidate);
    initial.characters.char_wanderer.equipmentBySlot.weapon = current.instanceId;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => success({ ...next, revision: next.revision + 1 })),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    documentValue.root.find("management-inventory")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    documentValue.root.find("management-inventory-select-eq_candidate_wanderer")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const wandererEquip = documentValue.root.find("management-inventory-equip-char_wanderer");
    expect(wandererEquip).toBeDefined();
    expect(wandererEquip?.disabled).toBe(false);
    expect(documentValue.root.find("management-inventory-compare-char_wanderer")?.textContent).toContain("攻击");
    expect(documentValue.root.find("management-inventory-compare-char_wanderer")?.textContent).toContain("+22");
    const guardEquip = documentValue.root.find("management-inventory-equip-char_iron_guard");
    expect(guardEquip?.disabled).toBe(true);
    expect(documentValue.root.find("management-inventory-equip-char_iron_guard-disabled-reason")?.textContent).toContain("WEAPON_NOT_ALLOWED");

    const before = structuredClone(flow.save);
    wandererEquip?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.save).not.toEqual(before);
    expect(flow.save?.characters.char_wanderer.equipmentBySlot.weapon).toBe(candidate.instanceId);
    expect(repository.save).toHaveBeenCalledTimes(1);
    flow.destroy();
  });

  it("装备保存失败时详情和选择态可重试，装备成功后可按角色槽位卸下", async () => {
    const documentValue = new FlowFakeDocument();
    const initial = terminalSave();
    const base = abyssEchoContentRoot.equipmentBases.find((value) => value.id === "eq_sword_t1_windblade");
    if (!base) throw new Error("测试内容缺少卸下底材");
    const current = equipmentInstance("eq_retry_current", base.id);
    const candidate = equipmentInstance("eq_retry_candidate", base.id);
    initial.inventory.equipment.push(current, candidate);
    initial.characters.char_wanderer.equipmentBySlot.weapon = current.instanceId;
    let failSave = true;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => failSave
        ? failure(createDomainError("SAVE_FAILED", { operation: "save" }))
        : success({ ...next, revision: next.revision + 1 })),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    documentValue.root.find("management-inventory")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    documentValue.root.find("management-inventory-select-eq_retry_candidate")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const before = structuredClone(flow.save);
    documentValue.root.find("management-inventory-equip-char_wanderer")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.save).toEqual(before);
    expect(documentValue.root.find("management-inventory-detail")).toBeDefined();
    expect(documentValue.root.find("management-inventory-error")?.textContent).toBe("SAVE_FAILED");

    failSave = false;
    documentValue.root.find("management-inventory-equip-char_wanderer")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.save?.characters.char_wanderer.equipmentBySlot.weapon).toBe(candidate.instanceId);
    const unequip = documentValue.root.find("management-inventory-unequip-char_wanderer-weapon");
    expect(unequip).toBeDefined();
    unequip?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.save?.characters.char_wanderer.equipmentBySlot.weapon).toBeNull();
    expect(repository.save).toHaveBeenCalledTimes(3);
    flow.destroy();
  });

  it("新游戏→城镇→第1层→接触→真实指令→奖励回城按路由串行", async () => {
    const scenes = {
      title: scene("title"),
      town: scene("town"),
      exploration: scene("exploration"),
      battle: scene("battle"),
    } as const;
    const factories: GameFlowSceneFactories = {
      title: () => scenes.title as never,
      town: () => scenes.town as never,
      exploration: () => scenes.exploration as never,
      battle: () => scenes.battle as never,
    };
    const routeLog: string[] = [];
    const router = {
      transition: async <Params>(target: Scene<Params>, params: Params): Promise<void> => {
        await target.prepare(params);
        await target.enter(params);
        routeLog.push(target === scenes.title ? "title" : target === scenes.town ? "town" : target === scenes.exploration ? "exploration" : "battle");
      },
    };
    let saveWrites = 0;
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(null)),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => { saveWrites += 1; return success(next); }),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => { saveWrites += 1; return success({ ...next, revision: next.revision + 1 }); }),
    };
    const nextSave = save();
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router,
      repository,
      sceneFactories: factories,
      createNewGame: async () => success(nextSave),
      departFloor: async () => success({ ...nextSave, expedition: { ...nextSave.expedition, expeditionId: "exp_1" } as never }),
      transitionEncounter: async () => success({ battle: { battleId: "battle_1", phase: "AWAIT_COMMAND" } as never, save: { ...nextSave, battle: { battleId: "battle_1", phase: "AWAIT_COMMAND" } as never }, candidateId: "candidate_1" }),
      submitBasicAttack: async () => success({ snapshot: { phase: "VICTORY" } as never, save: nextSave, events: [], candidateId: "candidate_2" }),
      settleReward: async () => success({ ...nextSave, battle: null, expedition: null }),
      rootFactory: () => ({ parent: null }),
    });

    await flow.start();
    expect(flow.state).toBe("title");
    await flow.newGame();
    expect(flow.state).toBe("town");
    await flow.enterFloor("floor_01");
    expect(flow.state).toBe("exploration");
    await flow.triggerEncounter();
    expect(flow.state).toBe("battle");
    await flow.useBasicAttack();
    expect(flow.state).toBe("reward");
    await flow.claimRewardAndReturnTown();
    expect(flow.state).toBe("town");
    expect(routeLog).toEqual(["title", "town", "exploration", "battle", "town"]);
    expect(saveWrites).toBeGreaterThan(0);
  });

  it("探索资源适配器读取 prepare acquire 后的最新 bundle", () => {
    const loadedBundles = ["boot", "core_ui"];
    const assetService = {
      acquire: vi.fn(async (): Promise<{ ok: true; value: AssetLease }> => success({
        bundleId: "floor_01",
        release: async () => undefined,
      })),
      restoreLoadedBundles: vi.fn(async () => undefined),
      getReferenceCount: vi.fn(() => 1),
      getLoadedBundleIds: vi.fn(() => loadedBundles),
    };
    const flow = new GameFlowController({
      runtime: { assetService },
      router: { transition: async () => undefined },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success(next),
        replaceAfterConfirmation: async (next) => success(next),
      },
    });

    const resources = (flow as unknown as { resources: () => ExplorationSceneResources }).resources();
    expect(resources.hasBundle("floor_01")).toBe(false);
    loadedBundles.push("floor_01");
    expect(resources.hasBundle("floor_01")).toBe(true);
    expect(resources.hasAsset("tileset_map_floor_01")).toBe(true);
  });

  it("继续远征时恢复位置、已击败遭遇和保护步数", async () => {
    const stored = terminalSave();
    stored.expedition = {
      expeditionId: "exp_resume",
      expeditionSeed: 1,
      mode: "exploration",
      abyssEchoId: null,
      floorId: "floor_01",
      mapId: "map_floor_01",
      playerPosition: { x: 736, y: 736 },
      safePosition: { x: 480, y: 864 },
      defeatedEncounterObjectIds: ["obj_f01_n03", "obj_f01_n01"],
      openedChestObjectIds: [],
      encounterProtectionStepsRemaining: 37,
      focusedEliteStoneConsumed: false,
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    const loadedBundles = floors06To10AssetManifest.bundles.map((bundle) => bundle.id);
    const assetService = {
      acquire: vi.fn(async (): Promise<{ ok: true; value: AssetLease }> => success({
        bundleId: "floor_01",
        release: async () => undefined,
      })),
      restoreLoadedBundles: vi.fn(async () => undefined),
      getReferenceCount: vi.fn(() => 1),
      getLoadedBundleIds: vi.fn(() => loadedBundles),
    };
    const flow = new GameFlowController({
      runtime: { assetService },
      router: {
        transition: async <Params>(target: Scene<Params>, params: Params): Promise<void> => {
          await target.prepare(params);
          await target.enter(params);
        },
      },
      repository: {
        get: async () => success<GameSaveV1 | null>(stored),
        save: async (_revision, next) => success(next),
        replaceAfterConfirmation: async (next) => success(next),
      },
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    const continued = await flow.continueGame();
    expect(continued.ok).toBe(true);
    expect(flow.state).toBe("exploration");
    const scene = (flow as unknown as { explorationScene: ExplorationScene | null }).explorationScene;
    expect(scene?.state.playerPosition).toEqual({ x: 736, y: 736 });
    expect(scene?.state.safePosition).toEqual({ x: 480, y: 864 });
    expect(scene?.state.defeatedEncounterObjectIds).toEqual(["obj_f01_n01", "obj_f01_n03"]);
    expect(scene?.state.encounterProtectionStepsRemaining).toBe(37);
    flow.destroy();
  });

  it("探索奖励保留远征，明确返回城镇时只清除 expedition", async () => {
    const routeLog: string[] = [];
    const router = {
      transition: async <Params>(target: Scene<Params>, params: Params): Promise<void> => {
        await target.prepare(params);
        await target.enter(params);
        routeLog.push((target as Scene<unknown> & { label: string }).label);
      },
    };
    const retained = {
      ...save(),
      expedition: {
        expeditionId: "exp_1", expeditionSeed: 1, mode: "exploration", abyssEchoId: null,
        floorId: "floor_01", mapId: "map_floor_01", playerPosition: { x: 16, y: 16 }, safePosition: { x: 16, y: 16 },
        defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0,
        focusedEliteStoneConsumed: false, startedAt: "2026-01-01T00:00:00.000Z",
      } as never,
    } as GameSaveV1;
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(null)),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => success({ ...next, revision: next.revision + 1 })),
    };
    const scenes = { title: scene("title"), town: scene("town"), exploration: scene("exploration"), battle: scene("battle") };
    const flow = new GameFlowController({
      router,
      repository,
      domainContext: new DomainContext({ clock: { now: () => "2026-01-01T00:00:00.000Z" }, idFactory: new SequentialIdFactory(), seedFactory: { nextUint32: () => 1 } }),
      sceneFactories: {
        title: () => scenes.title,
        town: () => scenes.town,
        exploration: () => scenes.exploration,
        battle: () => scenes.battle,
      },
      createNewGame: async () => success(retained),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    expect(flow.save?.expedition?.expeditionId).toBe("exp_1");
    expect(flow.state).toBe("town");
    const returned = await flow.returnToTown();
    expect(returned.ok).toBe(true);
    expect(flow.save?.expedition).toBeNull();
    expect(routeLog).toEqual(["title", "town", "town"]);
  });

  it("继续游戏遇到 COMPLETE 且无远征时先幂等清理 battle 再回城", async () => {
    const stored = { ...save(), battle: { phase: "COMPLETE" } as never } as GameSaveV1;
    const scenes = { title: scene("title"), town: scene("town"), exploration: scene("exploration"), battle: scene("battle") };
    const routeLog: string[] = [];
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(stored)),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => success({ ...next, revision: next.revision + 1 })),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
    };
    const router = {
      transition: async <Params>(target: Scene<Params>, params: Params): Promise<void> => {
        await target.prepare(params);
        await target.enter(params);
        routeLog.push((target as Scene<unknown> & { label: string }).label);
      },
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router,
      repository,
      sceneFactories: { title: () => scenes.title, town: () => scenes.town, exploration: () => scenes.exploration, battle: () => scenes.battle },
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    const continued = await flow.continueGame();
    expect(continued.ok).toBe(true);
    expect(flow.state).toBe("town");
    expect(flow.save?.battle).toBeNull();
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(routeLog).toEqual(["title", "town"]);
  });

  it.each([false, true])("COMPLETE cleanup 失败可重试，成功后按远征是否保留（%s）恢复场景", async (retained) => {
    const stored = { ...save(), expedition: retained ? expedition() : null, battle: { phase: "COMPLETE" } as never } as GameSaveV1;
    stored.claimedRewardTransactionIds = ["reward_terminal"];
    if (stored.expedition) stored.expedition.defeatedEncounterObjectIds = ["obj_f01_n03"];
    const documentValue = new FlowFakeDocument();
    let failCleanup = true;
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(stored)),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => failCleanup
        ? failure(createDomainError("SAVE_FAILED", { operation: "save" }))
        : success({ ...next, revision: next.revision + 1 })),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    const first = await flow.continueGame();
    expect(first.ok).toBe(false);
    expect(flow.state).toBe("town");
    expect(flow.save?.battle?.phase).toBe("COMPLETE");
    expect(documentValue.root.find("complete-battle-cleanup")).toBeDefined();
    expect(documentValue.root.find("complete-battle-cleanup-error")?.textContent).toBe("SAVE_FAILED");
    expect(documentValue.root.find("management-inventory")?.disabled).toBe(true);
    expect(documentValue.root.find("enter-floor")?.disabled).toBe(true);

    failCleanup = false;
    documentValue.root.find("complete-battle-cleanup")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.save?.battle).toBeNull();
    expect(documentValue.root.find("complete-battle-cleanup")).toBeUndefined();
    expect(flow.state).toBe(retained ? "exploration" : "town");
    expect(flow.save?.claimedRewardTransactionIds).toEqual(["reward_terminal"]);
    if (retained) {
      expect(flow.save?.expedition).toEqual(stored.expedition);
    } else {
      expect(documentValue.root.find("management-inventory")?.disabled).toBe(false);
      expect(documentValue.root.find("enter-floor")?.disabled).toBe(false);
    }
    expect(repository.save).toHaveBeenCalledTimes(2);
    flow.destroy();
  });

  it("回响终局 COMPLETE 且远征已清理时，指令回调后回城", async () => {
    const scenes = { title: scene("title"), town: scene("town"), exploration: scene("exploration"), battle: scene("battle") };
    const routeLog: string[] = [];
    const router = {
      transition: async <Params>(target: Scene<Params>, params: Params): Promise<void> => {
        await target.prepare(params);
        await target.enter(params);
        routeLog.push((target as Scene<unknown> & { label: string }).label);
      },
    };
    const current = save();
    const flow = new GameFlowController({
      router,
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success(next),
        replaceAfterConfirmation: async (next) => success(next),
      },
      sceneFactories: { title: () => scenes.title, town: () => scenes.town, exploration: () => scenes.exploration, battle: () => scenes.battle },
      createNewGame: async () => success(current),
      submitBasicAttack: async () => success({ snapshot: { phase: "COMPLETE" } as never, save: { ...current, battle: null, expedition: null }, events: [] }),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.useBasicAttack();
    expect(flow.state).toBe("town");
    expect(routeLog).toEqual(["title", "town", "town"]);
  });

  it("没有外部管理路由时，内置管理按钮仍投影真实摘要", async () => {
    class FakeElement {
      public readonly dataset: Record<string, string> = {};
      public readonly children: FakeElement[] = [];
      public readonly listeners = new Map<string, () => void>();
      public ownerDocument!: FakeDocument;
      public textContent = "";
      public id = "";
      public type = "";
      public disabled = false;
      public appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
      public replaceChildren(...children: FakeElement[]): void { this.children.splice(0, this.children.length, ...children); }
      public setAttribute(): void { /* fake DOM */ }
      public addEventListener(type: string, listener: () => void): void { this.listeners.set(type, listener); }
      public removeEventListener(type: string): void { this.listeners.delete(type); }
      public remove(): void { /* fake DOM */ }
      public find(testId: string): FakeElement | undefined {
        if (this.dataset.testid === testId) return this;
        for (const child of this.children) { const found = child.find(testId); if (found) return found; }
        return undefined;
      }
    }
    class FakeDocument {
      public readonly root = new FakeElement();
      public createElement(): FakeElement { const element = new FakeElement(); element.ownerDocument = this; return element; }
      public querySelector(): FakeElement { return this.root; }
    }
    const documentValue = new FakeDocument();
    const scenes = { title: scene("title"), town: scene("town"), exploration: scene("exploration"), battle: scene("battle") };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: new DomainContext({
        clock: { now: () => "2026-01-01T00:00:00.000Z" },
        idFactory: new SequentialIdFactory(),
        seedFactory: { nextUint32: () => 1 },
      }),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success(next),
        replaceAfterConfirmation: async (next) => success(next),
      },
      sceneFactories: { title: () => scenes.title, town: () => scenes.town, exploration: () => scenes.exploration, battle: () => scenes.battle },
      createNewGame: async () => success(managementSave()),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    const management = documentValue.root.find("management-inventory");
    expect(management).toBeDefined();
    management?.listeners.get("click")?.();
    await Promise.resolve();
    expect(documentValue.root.find("management-summary")?.textContent).toContain("背包");
    const lock = documentValue.root.find("management-inventory-lock");
    expect(lock).toBeDefined();
    lock?.listeners.get("click")?.();
    // DOM 事件本身不等待 listener；保存事务和 screen 回调各自经过异步边界。
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flow.save?.inventory.equipment[0]?.locked).toBe(true);
    const potion = documentValue.root.find("management-inventory-use-potion");
    expect(potion?.disabled).toBe(true);
    expect(documentValue.root.find("inventory-field-item-disabled-reason")?.dataset.reason).toBe("inventory.field_item_requires_expedition");
    expect(documentValue.root.find("inventory-field-item-disabled-reason")?.textContent).toContain("远征");
    documentValue.root.find("return-town")?.listeners.get("click")?.();
    documentValue.root.find("management-party")?.listeners.get("click")?.();
    await Promise.resolve();
    const recruitmentConfirmBeforeEvaluate = documentValue.root.find("management-party-confirm-recruitment");
    expect(recruitmentConfirmBeforeEvaluate?.disabled).toBe(true);
    documentValue.root.find("management-party-evaluate-recruitment")?.listeners.get("click")?.();
    await Promise.resolve();
    expect(documentValue.root.find("management-party-confirm-recruitment")?.disabled).toBe(false);
  });

  it("探索态野外药水按队伍顺序治疗并复用同一提交 Promise", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    initial.characters[protagonistId].currentHp = 100;
    const documentValue = new FlowFakeDocument();
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: vi.fn(async (_expectedRevision: number, next: GameSaveV1) => success(next)),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();
    expect(flow.state).toBe("exploration");
    expect(documentValue.root.find("field-potion")?.disabled).toBe(false);

    const first = flow.useFieldPotion();
    const second = flow.useFieldPotion();
    expect(second).toBe(first);
    const used = await first;
    expect(used.ok).toBe(true);
    expect(flow.save?.inventory.stackables.item_minor_potion).toBe(2);
    expect(flow.save?.characters[protagonistId].currentHp).toBeGreaterThan(100);
    expect(flow.save?.revision).toBe(2);
    expect(repository.save).toHaveBeenCalledTimes(1);
    flow.destroy();
  });

  it("野外药水保存失败保留权威存档并可重试，非法场景和满血目标禁用", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    initial.characters[protagonistId].currentHp = 100;
    const documentValue = new FlowFakeDocument();
    let failSave = true;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: vi.fn(async (_expectedRevision: number, next: GameSaveV1) => failSave
        ? failure(createDomainError("SAVE_FAILED", { operation: "save" }))
        : success(next)),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();
    const before = structuredClone(flow.save);
    const failed = await flow.useFieldPotion();
    expect(failed).toMatchObject({ ok: false, error: { code: "SAVE_FAILED" } });
    expect(flow.save).toEqual(before);
    expect(documentValue.root.find("field-potion-error")?.textContent).toBe("SAVE_FAILED");

    failSave = false;
    const retried = await flow.useFieldPotion();
    expect(retried.ok).toBe(true);
    expect(flow.save?.inventory.stackables.item_minor_potion).toBe(2);

    const full = structuredClone(flow.save) as GameSaveV1;
    full.characters[protagonistId].currentHp = 9999;
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(full);
    (flow as unknown as { setState: (value: "exploration") => void }).setState("exploration");
    expect(documentValue.root.find("field-potion")?.disabled).toBe(true);

    const battle = structuredClone(full);
    battle.battle = { phase: "AWAIT_COMMAND" } as never;
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(battle);
    (flow as unknown as { setState: (value: "exploration") => void }).setState("exploration");
    expect(documentValue.root.find("field-potion")?.disabled).toBe(true);
    flow.destroy();
  });

  it("野外药水提交期间自动遭遇等待并禁用，完成后只启动一次", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const documentValue = new FlowFakeDocument();
    let releaseFieldItem!: () => void;
    const transitionEncounter = vi.fn(async () => success({
      battle: { battleId: "battle_after_item", phase: "AWAIT_COMMAND" } as never,
      save: { ...initial, battle: { battleId: "battle_after_item", phase: "AWAIT_COMMAND" } as never },
      candidateId: "candidate_after_item",
    }));
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: vi.fn(async (_expectedRevision: number, next: GameSaveV1) => success(next)),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      transitionEncounter,
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const internals = flow as unknown as {
      fieldItemInFlight: Promise<unknown> | null;
      renderUi: () => void;
    };
    const fieldItemPending = new Promise<void>((resolve) => {
      releaseFieldItem = () => {
        internals.fieldItemInFlight = null;
        resolve();
      };
    });
    internals.fieldItemInFlight = fieldItemPending;
    internals.renderUi();
    expect(documentValue.root.find("auto-encounter")?.disabled).toBe(true);

    const request = flow.triggerEncounter();
    expect(transitionEncounter).not.toHaveBeenCalled();
    releaseFieldItem();
    const result = await request;
    expect(result.ok).toBe(true);
    expect(transitionEncounter).toHaveBeenCalledTimes(1);
    flow.destroy();
  });

  it("自动遭遇重复调用复用同一 Promise，不重复启动接触提交", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const documentValue = new FlowFakeDocument();
    let releaseTransition!: (result: DomainResult<GameFlowBattleStartValue>) => void;
    const transitionPending = new Promise<DomainResult<GameFlowBattleStartValue>>((resolve) => {
      releaseTransition = resolve;
    });
    const transitionEncounter = vi.fn(() => transitionPending);
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
        save: async (_expectedRevision: number, next: GameSaveV1) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      transitionEncounter,
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const first = flow.triggerEncounter();
    const second = flow.triggerEncounter();
    expect(second).toBe(first);
    expect(transitionEncounter).toHaveBeenCalledTimes(1);
    releaseTransition(success({
      battle: { battleId: "battle_once", phase: "AWAIT_COMMAND" } as never,
      save: { ...initial, battle: { battleId: "battle_once", phase: "AWAIT_COMMAND" } as never },
      candidateId: "candidate_once",
    }));
    const result = await first;
    expect(result.ok).toBe(true);
    flow.destroy();
  });

  it("自动遭遇失败投影错误码，重试成功后清理错误", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const documentValue = new FlowFakeDocument();
    let attempts = 0;
    const transitionEncounter = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return failure(createDomainError("INVALID_TARGET", { reason: "UNKNOWN", targetUnitId: null }));
      }
      return success({
        battle: { battleId: "battle_retry", phase: "AWAIT_COMMAND" } as never,
        save: { ...initial, battle: { battleId: "battle_retry", phase: "AWAIT_COMMAND" } as never },
        candidateId: "candidate_retry",
      });
    });
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
        save: async (_revision: number, next: GameSaveV1) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      transitionEncounter,
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const failed = await flow.triggerEncounter();
    expect(failed).toMatchObject({ ok: false, error: { code: "INVALID_TARGET" } });
    expect(documentValue.root.find("auto-encounter-error")?.textContent).toContain("INVALID_TARGET");

    const retried = await flow.triggerEncounter();
    expect(retried.ok).toBe(true);
    expect(documentValue.root.find("auto-encounter-error")).toBeUndefined();
    expect(transitionEncounter).toHaveBeenCalledTimes(2);
    flow.destroy();
  });

  it("自动遭遇 INVALID_CONTENT 投影严格路径和问题键", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const documentValue = new FlowFakeDocument();
    const transitionEncounter = vi.fn(async () => failure(createDomainError("INVALID_CONTENT", {
      path: "characters.char_priest.currentHp",
      issueKey: "hp_range",
    })));
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
        save: async (_revision: number, next: GameSaveV1) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      transitionEncounter,
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const result = await flow.triggerEncounter();
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
    const diagnostic = documentValue.root.find("auto-encounter-error");
    expect(diagnostic?.textContent).toContain("INVALID_CONTENT");
    expect(diagnostic?.textContent).toContain("path=characters.char_priest.currentHp");
    expect(diagnostic?.textContent).toContain("issueKey=hp_range");
    expect(transitionEncounter).toHaveBeenCalledTimes(1);
    flow.destroy();
  });

  it("空背包时管理页展示中文引导且固定返回栏独立可见", async () => {
    const documentValue = new FlowFakeDocument();
    const initial = terminalSave();
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_expectedRevision: number, next: GameSaveV1) => success(next),
        replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    documentValue.root.find("management-inventory")?.listeners.get("click")?.();
    await Promise.resolve();
    const emptyState = documentValue.root.find("management-inventory-empty-state");
    expect(emptyState).toBeDefined();
    expect(emptyState?.textContent).toContain("装备");
    expect(emptyState?.textContent).toContain("探索");
    expect(emptyState?.textContent).not.toContain("empty");
    expect(documentValue.root.find("management-summary")?.textContent).not.toContain("empty");
    expect(documentValue.root.find("management-inventory-select-first")).toBeUndefined();
    expect(documentValue.root.find("management-inventory-lock")).toBeUndefined();
    expect(documentValue.root.find("management-inventory-equip")).toBeUndefined();
    expect(documentValue.root.find("management-inventory-disassemble")).toBeUndefined();
    expect(documentValue.root.find("management-footer")).toBeDefined();
    expect(documentValue.root.find("return-town")?.className).toContain("management-return");
    flow.destroy();
  });

  it.each(["exploration", "shortFarm"] as const)("%s 胜利领取后继续原楼层，保留奖励、进度和安全点", async (mode) => {
    const initial = terminalSave();
    initial.expedition = expedition();
    initial.expedition.mode = mode;
    const protagonistId = initial.party.slots[0]!;
    initial.characters[protagonistId].currentHp = 0;
    const battle = battleSnapshot("REWARD_PENDING", [battleUnit(protagonistId, 0, 100)]);
    battle.reward = rewardTransaction();
    const next = structuredClone(initial);
    next.battle = battle;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (saveValue: GameSaveV1) => success(saveValue),
      save: vi.fn(async (_revision: number, saveValue: GameSaveV1) => success({ ...saveValue, revision: saveValue.revision + 1 })),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(next);
    const claimed = await flow.claimRewardAndReturnTown();
    expect(claimed.ok).toBe(true);
    expect(flow.save?.characters[protagonistId].currentHp).toBe(1);
    expect(flow.save?.characters[protagonistId].xp).toBe(10);
    expect(flow.save?.expedition?.playerPosition).toEqual({ x: 80, y: 96 });
    expect(flow.save?.expedition?.safePosition).toEqual({ x: 80, y: 96 });
    expect(flow.save?.expedition?.encounterProtectionStepsRemaining).toBe(180);
    expect(flow.save?.battle).toBeNull();
    expect(flow.state).toBe("exploration");
    expect(flow.save?.expedition?.expeditionId).toBe("exp_terminal");
    expect(flow.save?.expedition?.defeatedEncounterObjectIds).toEqual([battle.encounterObjectId]);
    expect(flow.save?.claimedRewardTransactionIds).toEqual(["reward_terminal"]);
    const settled = structuredClone(flow.save);
    expect((await flow.claimRewardAndReturnTown()).ok).toBe(false);
    expect(flow.save).toEqual(settled);
    expect(repository.save).toHaveBeenCalledTimes(2);

    // 明确结束远征后才回城，随后能够再次进入完整远征。
    expect((await flow.returnToTown()).ok).toBe(true);
    expect(flow.state).toBe("town");
    expect(flow.save?.expedition).toBeNull();
    expect((await flow.enterFloor()).ok).toBe(true);
    expect(flow.state).toBe("exploration");
    flow.destroy();
  });

  it("领取奖励前按地图 encounter 顺序整理已击败对象", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    initial.expedition.playerPosition = { x: 96, y: 896 };
    initial.expedition.safePosition = { x: 96, y: 896 };
    initial.expedition.defeatedEncounterObjectIds = ["obj_f01_n02", "obj_f01_n03"];
    const battle = battleSnapshot("REWARD_PENDING", [battleUnit("char_wanderer", 80, 100)]);
    battle.returnSafePosition = { x: 96, y: 896 };
    battle.encounterId = "encounter_floor_01_normal_a";
    battle.encounterObjectId = "obj_f01_n01";
    if (battle.reward === null) battle.reward = rewardTransaction();
    battle.reward.source = {
      kind: "encounter",
      encounterId: "encounter_floor_01_normal_a",
      mapId: "map_floor_01",
      objectId: "obj_f01_n01",
    };
    const current = structuredClone(initial);
    current.battle = battle;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (saveValue: GameSaveV1) => success(saveValue),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => {
        return validateGameSave(next, abyssEchoContentRoot);
      }),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(current);
    const claimed = await flow.claimRewardAndReturnTown();
    expect(claimed.ok).toBe(true);
    expect(flow.save?.expedition?.defeatedEncounterObjectIds).toEqual(["obj_f01_n01", "obj_f01_n02", "obj_f01_n03"]);
    expect(repository.save).toHaveBeenCalledTimes(2);
    flow.destroy();
  });

  it("奖励领取保存失败时保留权威存档", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const battle = battleSnapshot("REWARD_PENDING", [battleUnit("char_wanderer", 80, 100)]);
    battle.encounterId = "encounter_floor_01_normal_a";
    battle.encounterObjectId = "obj_f01_n01";
    if (battle.reward === null) battle.reward = rewardTransaction();
    battle.reward.source = {
      kind: "encounter",
      encounterId: "encounter_floor_01_normal_a",
      mapId: "map_floor_01",
      objectId: "obj_f01_n01",
    };
    const current = structuredClone(initial);
    current.battle = battle;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (saveValue: GameSaveV1) => success(saveValue),
      save: vi.fn(async () => failure(createDomainError("SAVE_FAILED", { operation: "save" }))),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(current);
    const before = structuredClone(flow.save);
    const failed = await flow.claimRewardAndReturnTown();
    expect(failed).toMatchObject({ ok: false, error: { code: "SAVE_FAILED" } });
    expect(flow.save).toEqual(before);
    expect(repository.save).toHaveBeenCalledTimes(1);
    flow.destroy();
  });

  it("撤退终局保留远征并写回原 HP、安全点和保护步数", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const battle = battleSnapshot("RETREAT", [battleUnit(protagonistId, 0, 100)]);
    const current = { ...initial, battle } as GameSaveV1;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (saveValue: GameSaveV1) => success(saveValue),
      save: vi.fn(async (_revision: number, saveValue: GameSaveV1) => success({ ...saveValue, revision: saveValue.revision + 1 })),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(current);
    const committed = await (flow as unknown as { commitTerminalWithoutReward: (value: BattleSnapshotV1) => Promise<{ ok: boolean; save?: GameSaveV1 }> }).commitTerminalWithoutReward(battle);
    expect(committed.ok).toBe(true);
    expect(flow.save?.characters[protagonistId].currentHp).toBe(0);
    expect(flow.save?.expedition?.playerPosition).toEqual({ x: 80, y: 96 });
    expect(flow.save?.expedition?.safePosition).toEqual({ x: 80, y: 96 });
    expect(flow.save?.expedition?.encounterProtectionStepsRemaining).toBe(180);
    expect(flow.save?.battle?.phase).toBe("COMPLETE");
  });

  it("战败终局按 COMPLETE 哨兵和独立 cleanup 顺序提交，不重复结算", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const battle = battleSnapshot("DEFEAT", [battleUnit(protagonistId, 0, 200)]);
    const current = { ...initial, battle } as GameSaveV1;
    const writes: GameSaveV1[] = [];
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => {
        writes.push(structuredClone(next));
        return success({ ...next, revision: next.revision + 1 });
      }),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(current);
    await (flow as unknown as { finishBattleTerminal: (value: BattleSnapshotV1) => Promise<void> }).finishBattleTerminal(battle);

    expect(writes).toHaveLength(2);
    expect(writes[0]?.battle?.phase).toBe("COMPLETE");
    expect(writes[0]?.expedition).toBeNull();
    expect(writes[1]?.battle).toBeNull();
    expect(writes[1]?.expedition).toBeNull();
    expect(flow.save?.battle).toBeNull();
    expect(flow.save?.characters[protagonistId].currentHp).toBe(100);
    expect(flow.state).toBe("town");
    flow.destroy();
  });

  it("真实战败 cleanup 失败仍回城可重试，成功后解除 COMPLETE 门禁", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const battle = battleSnapshot("DEFEAT", [battleUnit(protagonistId, 0, 100)]);
    const current = { ...initial, battle } as GameSaveV1;
    let failCleanup = true;
    const writes: GameSaveV1[] = [];
    const documentValue = new FlowFakeDocument();
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => {
        writes.push(structuredClone(next));
        return failCleanup && writes.length === 2
          ? failure(createDomainError("SAVE_FAILED", { operation: "save" }))
          : success({ ...next, revision: next.revision + 1 });
      }),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(current);
    await (flow as unknown as { finishBattleTerminal: (value: BattleSnapshotV1) => Promise<void> }).finishBattleTerminal(battle);

    expect(writes).toHaveLength(2);
    expect(writes[0]?.battle?.phase).toBe("COMPLETE");
    expect(writes[0]?.expedition).toBeNull();
    expect(flow.state).toBe("town");
    expect(flow.save?.battle?.phase).toBe("COMPLETE");
    expect(documentValue.root.find("complete-battle-cleanup-error")?.textContent).toBe("SAVE_FAILED");
    expect(documentValue.root.find("complete-battle-cleanup")).toBeDefined();
    expect(documentValue.root.find("management-party")?.disabled).toBe(true);

    failCleanup = false;
    documentValue.root.find("complete-battle-cleanup")?.listeners.get("click")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toHaveLength(3);
    expect(writes[2]?.battle).toBeNull();
    expect(flow.save?.battle).toBeNull();
    expect(documentValue.root.find("management-party")?.disabled).toBe(false);
    expect(documentValue.root.find("enter-floor")?.disabled).toBe(false);
    flow.destroy();
  });

  it("撤退终局先写 COMPLETE，独立清理后返回保留的远征", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const battle = battleSnapshot("RETREAT", [battleUnit(protagonistId, 37, 100)]);
    const current = { ...initial, battle } as GameSaveV1;
    const writes: GameSaveV1[] = [];
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => {
        writes.push(structuredClone(next));
        return success({ ...next, revision: next.revision + 1 });
      }),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(current);
    await (flow as unknown as { finishBattleTerminal: (value: BattleSnapshotV1) => Promise<void> }).finishBattleTerminal(battle);

    expect(writes).toHaveLength(2);
    expect(writes[0]?.battle?.phase).toBe("COMPLETE");
    expect(writes[0]?.expedition?.expeditionId).toBe("exp_terminal");
    expect(writes[1]?.battle).toBeNull();
    expect(writes[1]?.expedition?.expeditionId).toBe("exp_terminal");
    expect(flow.save?.battle).toBeNull();
    expect(flow.save?.expedition?.expeditionId).toBe("exp_terminal");
    expect(flow.save?.characters[protagonistId].currentHp).toBe(37);
    expect(flow.state).toBe("exploration");
    flow.destroy();
  });

  it("战败终局按当前最大生命的一半复苏全部已招募角色并清理远征", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const benchId = "char_iron_guard";
    initial.characters[benchId].recruited = true;
    initial.characters[protagonistId].currentHp = 0;
    initial.characters[benchId].currentHp = 0;
    const battle = battleSnapshot("DEFEAT", [battleUnit(protagonistId, 0, 200)]);
    const current = { ...initial, battle } as GameSaveV1;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (saveValue: GameSaveV1) => success(saveValue),
      save: vi.fn(async (_revision: number, saveValue: GameSaveV1) => success({ ...saveValue, revision: saveValue.revision + 1 })),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(current);
    const committed = await (flow as unknown as { commitTerminalWithoutReward: (value: BattleSnapshotV1) => Promise<{ ok: boolean; save?: GameSaveV1 }> }).commitTerminalWithoutReward(battle);
    expect(committed.ok).toBe(true);
    expect(flow.save?.characters[protagonistId].currentHp).toBe(100);
    expect(flow.save?.characters[benchId].currentHp).toBeGreaterThanOrEqual(1);
    expect(flow.save?.expedition).toBeNull();
    expect(flow.save?.battle?.phase).toBe("COMPLETE");
  });

  it("战后保存失败不改变权威存档", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const battle = battleSnapshot("RETREAT", [battleUnit(protagonistId, 0, 100)]);
    const current = { ...initial, battle } as GameSaveV1;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (saveValue: GameSaveV1) => success(saveValue),
      save: vi.fn(async () => failure(createDomainError("SAVE_FAILED", { operation: "save" }))),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(current);
    const before = structuredClone(flow.save);
    const committed = await (flow as unknown as { commitTerminalWithoutReward: (value: BattleSnapshotV1) => Promise<{ ok: boolean }> }).commitTerminalWithoutReward(battle);
    expect(committed.ok).toBe(false);
    expect(flow.save).toEqual(before);
  });

  it("装备底材与 flat/percent 词条进入可解释战斗基线，并保留固定被动", () => {
    const base = abyssEchoContentRoot.equipmentBases.find((value) => value.baseStat === "attack");
    const flatAffix = abyssEchoContentRoot.equipmentAffixes.find((value) => value.modifiers.some((modifier) => modifier.kind === "flatStat" && modifier.stat === "attack"));
    // 正式首层内容当前没有无条件 percent 装备词条；测试使用同一合同构造
    // 一个明确的 percentStat 定义，确保 adapter 不把它误当成伤害词条。
    const percentAffix = flatAffix ? {
      ...flatAffix,
      id: "af_test_attack_percent",
      modifiers: [{ kind: "percentStat" as const, stat: "attack" as const, rollScaleBps: 10_000 }],
    } : undefined;
    expect(base).toBeDefined();
    expect(flatAffix).toBeDefined();
    expect(percentAffix).toBeDefined();
    if (!base || !flatAffix || !percentAffix) return;
    const content: EquipmentServiceContent = {
      equipmentBases: abyssEchoContentRoot.equipmentBases,
      equipmentAffixes: [...abyssEchoContentRoot.equipmentAffixes, percentAffix],
      economy: abyssEchoContentRoot.economy,
      characters: abyssEchoContentRoot.characters,
      skills: abyssEchoContentRoot.skills,
      getCharacter: (id) => success(abyssEchoContentRoot.characters.find((value) => value.id === id)!),
      getSkill: (id) => success(abyssEchoContentRoot.skills.find((value) => value.id === id)!),
    };
    const saveValue = terminalSave();
    const characterId = saveValue.party.slots[0]!;
    const instance: EquipmentInstance = {
      instanceId: "eq_baseline_test",
      baseId: base.id,
      itemLevel: base.minItemLevel,
      quality: "magic",
      craftGrade: "ordinary",
      affixes: [
        { affixId: flatAffix.id, tier: 1, roll: 100, craftEmpowered: false, reforged: false },
        { affixId: percentAffix.id, tier: 1, roll: 100, craftEmpowered: false, reforged: false },
      ],
      abyssAffix: null,
      locked: false,
      acquiredAt: "2026-01-01T00:00:00.000Z",
      sourceTransactionId: "tx_baseline_test",
      reforgeLockedIndex: null,
      reforgeCount: 0,
    };
    saveValue.inventory.equipment.push(instance);
    saveValue.characters[characterId].equipmentBySlot[base.slot] = instance.instanceId;
    const modifiers = calculateEquipmentStatModifiers(content, saveValue, characterId);
    expect(modifiers.ok).toBe(true);
    if (!modifiers.ok) return;
    const progression = new ProgressionService({
      getCharacter: (id) => success(abyssEchoContentRoot.characters.find((value) => value.id === id)!),
      getSkill: (id) => success(abyssEchoContentRoot.skills.find((value) => value.id === id)!),
    });
    const baseline = progression.calculateStats(characterId, 1, modifiers.value);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    expect(baseline.value.prePercentStats.attack).toBeGreaterThan(abyssEchoContentRoot.characters.find((value) => value.id === characterId)!.baseStats.attack);
    expect(baseline.value.staticPercentByStatBps.attack).toBeGreaterThanOrEqual(800);
    expect(baseline.value.stats.attack).toBeGreaterThan(baseline.value.prePercentStats.attack);
  });

  it("防御与撤退入口向 Gateway 发送当前我方行动者命令", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const currentBattle = battleSnapshot("REWARD_PENDING", [battleUnit(protagonistId, 100, 100)]);
    currentBattle.phase = "AWAIT_COMMAND";
    currentBattle.outcome = "ongoing";
    currentBattle.currentUnitId = `party:${protagonistId}`;
    const saved = { ...initial, battle: currentBattle } as GameSaveV1;
    const commands: unknown[] = [];
    const nextSnapshot = structuredClone(currentBattle);
    nextSnapshot.battleRevision += 1;
    nextSnapshot.units[0].statuses = [{ stackId: "status_stack_test", statusId: "status_guard_30", sourceUnitId: `party:${protagonistId}`, remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 0, shieldRemaining: 0 }];
    const gateway = {
      execute: vi.fn(async (command: unknown) => {
        commands.push(command);
        return { ok: true as const, value: { snapshot: nextSnapshot, events: [], consumedItem: null }, save: { ...saved, battle: nextSnapshot }, events: [], candidateId: "candidate_test" };
      }),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: { get: async () => success<GameSaveV1 | null>(null), save: async (_revision, value) => success(value), replaceAfterConfirmation: async (value) => success(value) },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(saved);
    (flow as unknown as { gateway: typeof gateway }).gateway = gateway;
    const defended = await flow.useDefend();
    expect(defended.ok).toBe(true);
    expect(commands[0]).toMatchObject({ type: "DEFEND", expectedBattleRevision: 1, actorUnitId: `party:${protagonistId}` });
    expect(defended.ok && defended.value.units[0].statuses[0]?.statusId).toBe("status_guard_30");
    const retreated = await flow.useRetreat();
    expect(retreated.ok).toBe(true);
    expect(commands[1]).toMatchObject({ type: "RETREAT", expectedBattleRevision: 2, actorUnitId: `party:${protagonistId}` });
  });

  it("玩家与敌方 AI 均经当前 BattleScene 的提交后事件入口，不重复调用 Gateway", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const enemy = abyssEchoContentRoot.enemies[0];
    expect(enemy).toBeDefined();
    if (!enemy) return;
    const enemyUnit: BattleUnitStateV1 = {
      ...battleUnit(enemy.id, enemy.stats.maxHp, enemy.stats.maxHp),
      unitId: `enemy:${enemy.id}`,
      definitionId: enemy.id,
      faction: "enemy",
      slot: 0,
    };
    const committedEvent = (actorUnitId: string, targetUnitId: string): BattleDomainEventV1 => ({
      type: "ACTION_STARTED",
      eventId: `event_${actorUnitId}`,
      sequence: 1,
      battleId: "battle_terminal",
      round: 1,
      rootActionId: "root_post_commit",
      rootActionDefinitionId: "skill_basic_attack",
      chainDepth: 0,
      triggerSource: null,
      visualSkillId: null,
      contextSkillKind: "basic",
      effect: null,
      actorUnitId,
      actionKind: "basic",
      targetUnitIds: [targetUnitId],
    });
    const baseBattle = battleSnapshot("REWARD_PENDING", [battleUnit(protagonistId, 100, 100), enemyUnit]);
    baseBattle.phase = "AWAIT_COMMAND";
    baseBattle.outcome = "ongoing";
    baseBattle.currentUnitId = `party:${protagonistId}`;
    baseBattle.initiativeQueueUnitIds = [`party:${protagonistId}`, enemyUnit.unitId];
    const saved = { ...initial, battle: baseBattle } as GameSaveV1;
    const presentedCommands: BattleCommandV1[] = [];
    const gatewayExecute = vi.fn(async () => {
      throw new Error("GameFlow 不应绕过 BattleScene 直接执行 Gateway");
    });
    const committedSnapshots: BattleSnapshotV1[] = [];
    const battleScene = {
      submitGatewayCommand: vi.fn(async (command: BattleCommandV1) => {
        presentedCommands.push(command);
        const next = structuredClone(baseBattle);
        next.battleRevision += committedSnapshots.length + 1;
        next.phase = "AWAIT_COMMAND";
        next.currentUnitId = command.actorUnitId.startsWith("enemy:") ? `party:${protagonistId}` : command.actorUnitId;
        const targetUnitId = "targetUnitIds" in command
          ? command.targetUnitIds[0] ?? `party:${protagonistId}`
          : `party:${protagonistId}`;
        const events = [committedEvent(command.actorUnitId, targetUnitId)];
        committedSnapshots.push(next);
        return {
          ok: true as const,
          value: { snapshot: next, events, consumedItem: null },
          save: { ...saved, battle: next },
          events,
          candidateId: `candidate_${committedSnapshots.length}`,
        };
      }),
      submitControlSkip: vi.fn(),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: { get: async () => success<GameSaveV1 | null>(null), save: async (_revision, value) => success(value), replaceAfterConfirmation: async (value) => success(value) },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    const internals = flow as unknown as {
      setSave: (value: GameSaveV1) => void;
      gateway: { execute: typeof gatewayExecute };
      battleScene: typeof battleScene | null;
      executeBasicAttack: () => Promise<DomainResult<BattleSnapshotV1>>;
      advanceBattleToAwait: () => Promise<void>;
    };
    internals.setSave(saved);
    internals.gateway = { execute: gatewayExecute };
    internals.battleScene = battleScene;

    const playerResult = await internals.executeBasicAttack();
    expect(playerResult.ok).toBe(true);
    expect(battleScene.submitGatewayCommand).toHaveBeenCalledTimes(1);
    expect(presentedCommands[0]).toMatchObject({ type: "USE_BASIC", actorUnitId: `party:${protagonistId}` });
    expect(gatewayExecute).not.toHaveBeenCalled();

    const aiBattle = structuredClone(baseBattle);
    aiBattle.phase = "AI_DECIDE";
    aiBattle.currentUnitId = enemyUnit.unitId;
    aiBattle.initiativeQueueUnitIds = [enemyUnit.unitId, `party:${protagonistId}`];
    internals.setSave({ ...saved, battle: aiBattle });
    await internals.advanceBattleToAwait();
    expect(battleScene.submitGatewayCommand).toHaveBeenCalledTimes(2);
    expect(presentedCommands[1]?.actorUnitId).toBe(enemyUnit.unitId);
    expect(gatewayExecute).not.toHaveBeenCalled();
    internals.battleScene = null;
    flow.destroy();
  });

  it("advanceBattleToAwait 消费 TURN_START 并进入我方待命", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const currentBattle = battleSnapshot("REWARD_PENDING", [battleUnit(protagonistId, 100, 100)]);
    currentBattle.phase = "TURN_START";
    currentBattle.outcome = "ongoing";
    currentBattle.round = 1;
    currentBattle.currentUnitId = null;
    currentBattle.initiativeQueueUnitIds = [`party:${protagonistId}`];
    const current = { ...initial, battle: currentBattle } as GameSaveV1;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (nextSave: GameSaveV1) => success(nextSave),
      save: vi.fn(async (_expectedRevision: number, nextSave: GameSaveV1) => success({ ...nextSave, revision: nextSave.revision + 1 })),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (saveValue: GameSaveV1) => void }).setSave(current);

    await (flow as unknown as { advanceBattleToAwait: () => Promise<void> }).advanceBattleToAwait();

    expect(flow.save?.battle?.phase).toBe("AWAIT_COMMAND");
    expect(flow.save?.battle?.currentUnitId).toBe(`party:${protagonistId}`);
    expect(repository.save).toHaveBeenCalledTimes(1);
    flow.destroy();
  });

  it("advanceBattleToAwait 驱动 RESOLVE_ACTION 的完整事件链", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const currentBattle = battleSnapshot("REWARD_PENDING", [battleUnit(protagonistId, 100, 100)]);
    const enemy = abyssEchoContentRoot.enemies[0];
    expect(enemy).toBeDefined();
    if (!enemy) return;
    const enemyUnit: BattleUnitStateV1 = {
      ...battleUnit(enemy.id, 100, enemy.stats.maxHp),
      unitId: `enemy:${enemy.id}`,
      definitionId: enemy.id,
      faction: "enemy",
      slot: 0,
    };
    // 这是受控跳过回合后已落在 RESOLVE_ACTION 的合法快照，必须继续消费正式阶段链。
    currentBattle.units[0].statuses = [{
      stackId: "freeze:terminal",
      statusId: "status_freeze",
      sourceUnitId: enemyUnit.unitId,
      remainingOwnerTurns: 1,
      skipNextOwnerTurnEndDecrement: false,
      sourceAttackSnapshot: enemyUnit.stats.attack,
      shieldRemaining: 0,
    }];
    currentBattle.units.push(enemyUnit);
    currentBattle.phase = "RESOLVE_ACTION";
    currentBattle.outcome = "ongoing";
    currentBattle.round = 1;
    currentBattle.currentUnitId = `party:${protagonistId}`;
    currentBattle.initiativeQueueUnitIds = [`party:${protagonistId}`];
    const current = { ...initial, battle: currentBattle } as GameSaveV1;
    const savedPhases: string[] = [];
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (nextSave: GameSaveV1) => success(nextSave),
      save: vi.fn(async (_expectedRevision: number, nextSave: GameSaveV1) => {
        savedPhases.push(nextSave.battle?.phase ?? "null");
        return success({ ...nextSave, revision: nextSave.revision + 1 });
      }),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (saveValue: GameSaveV1) => void }).setSave(current);

    await (flow as unknown as { advanceBattleToAwait: () => Promise<void> }).advanceBattleToAwait();

    expect(flow.save?.battle?.phase).toBe("AWAIT_COMMAND");
    expect(flow.save?.battle?.currentUnitId).toBe(`party:${protagonistId}`);
    expect(savedPhases).toEqual(["TURN_END", "TURN_START", "AWAIT_COMMAND"]);
    expect(flow.state).not.toBe("error");
    flow.destroy();
  });

  it("advanceBattleToAwait 在 TURN_END 递减当前单位冷却并清理行动者", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const nextCharacterId = "char_iron_guard";
    const protagonist = battleUnit(protagonistId, 100, 100);
    protagonist.cooldowns = { skill_test: 2 };
    const nextUnit = battleUnit(nextCharacterId, 100, 100);
    nextUnit.unitId = `party:${nextCharacterId}`;
    nextUnit.slot = 1;
    const currentBattle = battleSnapshot("REWARD_PENDING", [protagonist, nextUnit]);
    currentBattle.phase = "TURN_END";
    currentBattle.outcome = "ongoing";
    currentBattle.round = 1;
    currentBattle.currentUnitId = protagonist.unitId;
    currentBattle.initiativeQueueUnitIds = [nextUnit.unitId];
    const current = { ...initial, battle: currentBattle } as GameSaveV1;
    const savedPhases: string[] = [];
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (nextSave: GameSaveV1) => success(nextSave),
      save: vi.fn(async (_expectedRevision: number, nextSave: GameSaveV1) => {
        savedPhases.push(nextSave.battle?.phase ?? "null");
        return success({ ...nextSave, revision: nextSave.revision + 1 });
      }),
    };
    const flow = new GameFlowController({
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (saveValue: GameSaveV1) => void }).setSave(current);

    await (flow as unknown as { advanceBattleToAwait: () => Promise<void> }).advanceBattleToAwait();

    const savedProtagonist = flow.save?.battle?.units.find((unit) => unit.unitId === protagonist.unitId);
    expect(savedProtagonist?.cooldowns.skill_test).toBe(1);
    expect(flow.save?.battle?.currentUnitId).toBe(nextUnit.unitId);
    expect(flow.save?.battle?.phase).toBe("AWAIT_COMMAND");
    expect(savedPhases).toEqual(["TURN_START", "AWAIT_COMMAND"]);
    expect(flow.state).not.toBe("error");
    flow.destroy();
  });

  it("敌方回合 Gateway 失败时投影受控错误详情", async () => {
    const initial = terminalSave();
    const protagonistId = initial.party.slots[0]!;
    const enemy = abyssEchoContentRoot.enemies[0];
    expect(enemy).toBeDefined();
    if (!enemy) return;
    const currentBattle = battleSnapshot("REWARD_PENDING", [battleUnit(protagonistId, 100, 100)]);
    const enemyUnit: BattleUnitStateV1 = {
      ...battleUnit(enemy.id, 100, enemy.stats.maxHp),
      unitId: `enemy:${enemy.id}`,
      definitionId: enemy.id,
      faction: "enemy",
      slot: 0,
    };
    currentBattle.units.push(enemyUnit);
    currentBattle.phase = "AI_DECIDE";
    currentBattle.outcome = "ongoing";
    currentBattle.currentUnitId = enemyUnit.unitId;
    currentBattle.initiativeQueueUnitIds = [enemyUnit.unitId, `party:${protagonistId}`];
    const current = { ...initial, battle: currentBattle } as GameSaveV1;
    const gateway = {
      execute: vi.fn(async () => failure(createDomainError("INVALID_TARGET", {
        reason: "UNKNOWN",
        targetUnitId: `party:${protagonistId}`,
      }))),
    };
    const documentValue = new FlowFakeDocument();
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success(next),
        replaceAfterConfirmation: async (next) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(current);
    (flow as unknown as { gateway: typeof gateway }).gateway = gateway;
    (flow as unknown as { setState: (state: "battle") => void }).setState("battle");

    await (flow as unknown as { afterBattleCommand: (value: unknown) => Promise<void> }).afterBattleCommand({
      ok: true,
      value: { snapshot: currentBattle, events: [], consumedItem: null },
      save: current,
      events: [],
      candidateId: "candidate_enemy_gateway_failure",
    });

    expect(gateway.execute).toHaveBeenCalledTimes(1);
    expect(flow.state).toBe("error");
    expect(documentValue.root.find("flow-error-detail")?.textContent).toContain("enemy_gateway:INVALID_TARGET");
    flow.destroy();
  });

  it("胜利奖励准备失败时停留错误态且不显示领取入口", async () => {
    const initial = terminalSave();
    const protagonistId = initial.party.slots[0]!;
    const currentBattle = battleSnapshot("REWARD_PENDING", [battleUnit(protagonistId, 100, 100)]);
    currentBattle.phase = "VICTORY";
    currentBattle.outcome = "victory";
    const current = { ...initial, battle: currentBattle } as GameSaveV1;
    const documentValue = new FlowFakeDocument();
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success(next),
        replaceAfterConfirmation: async (next) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (value: GameSaveV1) => void }).setSave(current);
    (flow as unknown as { setState: (state: "battle") => void }).setState("battle");

    await (flow as unknown as { afterBattleCommand: (value: unknown) => Promise<void> }).afterBattleCommand({
      ok: true,
      value: { snapshot: currentBattle, events: [], consumedItem: null },
      save: current,
      events: [],
      candidateId: "candidate_reward_prepare_failure",
    });

    expect(flow.state).toBe("error");
    expect(documentValue.root.find("flow-error-detail")?.textContent).toContain("reward_prepare:SAVE_FAILED");
    expect(documentValue.root.find("claim-reward")).toBeUndefined();
    flow.destroy();
  });

  it("afterBattleCommand 在推进中完成胜利奖励时投影 reward 状态", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const protagonistId = initial.party.slots[0]!;
    const enemy = abyssEchoContentRoot.enemies[0];
    expect(enemy).toBeDefined();
    if (!enemy) return;

    const currentBattle = battleSnapshot("REWARD_PENDING", [battleUnit(protagonistId, 100, 100)]);
    const enemyUnit: BattleUnitStateV1 = {
      ...battleUnit(enemy.id, 0, enemy.stats.maxHp),
      unitId: `enemy:${enemy.id}`,
      definitionId: enemy.id,
      faction: "enemy",
      slot: 0,
    };
    currentBattle.units.push(enemyUnit);
    // 玩家指令本身只把快照推进到 DRAIN_TRIGGERS；敌方/终局推进由
    // afterBattleCommand 真实调用 advanceBattleToAwait 完成，不能直接伪造 VICTORY。
    currentBattle.phase = "DRAIN_TRIGGERS";
    currentBattle.outcome = "ongoing";
    currentBattle.currentUnitId = null;
    currentBattle.initiativeQueueUnitIds = [];
    const current = { ...initial, battle: currentBattle } as GameSaveV1;
    const documentValue = new FlowFakeDocument();
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (nextSave: GameSaveV1) => success(nextSave),
      save: vi.fn(async (_expectedRevision: number, nextSave: GameSaveV1) => success({ ...nextSave, revision: nextSave.revision + 1 })),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setSave: (saveValue: GameSaveV1) => void }).setSave(current);
    (flow as unknown as { setState: (state: "battle") => void }).setState("battle");

    await (flow as unknown as { afterBattleCommand: (value: unknown) => Promise<void> }).afterBattleCommand({
      ok: true,
      value: { snapshot: currentBattle, events: [], consumedItem: null },
      save: current,
      events: [],
      candidateId: "candidate_reward_after_advance",
    });

    expect(flow.state).toBe("reward");
    expect(flow.save?.battle?.phase).toBe("REWARD_PENDING");
    expect(documentValue.root.find("claim-reward")).toBeDefined();
    expect(documentValue.root.find("flow-error-detail")).toBeUndefined();
    expect(repository.save).toHaveBeenCalledTimes(2);
    flow.destroy();
  });

  it("探索移动按钮支持按住、双指斜向、释放取消并在离开探索时清零", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const documentValue = new FlowFakeDocument();
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(null)),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => success(next)),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const internals = flow as unknown as {
      input: {
        inputState: {
          snapshot: () => { move: { x: number; y: number }; actions: readonly string[] };
          setMove: (x: number, y: number) => void;
          activePointerCount: number;
        };
      };
      explorationScene: ExplorationScene | null;
      renderUi: () => void;
      fixedUpdateStep: () => void;
      setState: (state: "town" | "exploration") => void;
    };
    let position = { x: 100, y: 100 };
    const moves: Array<{ x: number; y: number }> = [];
    const fakeScene = {
      get state() { return { playerPosition: position } as unknown as ExplorationScene["state"]; },
      actorViews: [],
      fixedUpdate: vi.fn(() => {
        const snapshot = internals.input.inputState.snapshot();
        moves.push(snapshot.move);
        position = { x: position.x + snapshot.move.x * 10, y: position.y + snapshot.move.y * 10 };
        return null;
      }),
    } as unknown as ExplorationScene;
    internals.explorationScene = fakeScene;
    internals.input.inputState.setMove(0, 0);
    internals.renderUi();

    const right = documentValue.root.find("move-right");
    const down = documentValue.root.find("move-down");
    expect(right).toBeDefined();
    expect(down).toBeDefined();
    const pointer = (pointerId: number): FlowPointerEvent => ({ pointerId, preventDefault: vi.fn() });

    right?.listeners.get("pointerdown")?.(pointer(1));
    internals.fixedUpdateStep();
    expect(position.x).toBeGreaterThan(100);
    expect(moves.at(-1)).toEqual({ x: 1, y: 0 });

    down?.listeners.get("pointerdown")?.(pointer(2));
    internals.fixedUpdateStep();
    expect(moves.at(-1)?.x).toBeCloseTo(Math.SQRT1_2);
    expect(moves.at(-1)?.y).toBeCloseTo(Math.SQRT1_2);

    right?.listeners.get("pointerup")?.(pointer(1));
    internals.fixedUpdateStep();
    expect(moves.at(-1)).toEqual({ x: 0, y: 1 });

    down?.listeners.get("pointercancel")?.(pointer(2));
    internals.fixedUpdateStep();
    expect(moves.at(-1)).toEqual({ x: 0, y: 0 });
    expect(internals.input.inputState.activePointerCount).toBe(0);

    right?.listeners.get("pointerdown")?.(pointer(3));
    expect(internals.input.inputState.activePointerCount).toBe(1);
    internals.setState("town");
    expect(internals.input.inputState.activePointerCount).toBe(0);
    expect(internals.input.inputState.snapshot().move).toEqual({ x: 0, y: 0 });
    flow.destroy();
  });

  it("自动前往移动中的巡逻遭遇时按 actorViews 当前坐标持续重规划", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    initial.expedition.playerPosition = { x: 112, y: 891 };
    initial.expedition.safePosition = { x: 112, y: 891 };
    const documentValue = new FlowFakeDocument();
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) return;
    const floorMap = abyssEchoContentRoot.maps.find((candidate) => candidate.id === "map_floor_01");
    expect(floorMap).toBeDefined();
    if (!floorMap) return;
    const grid = new CollisionGrid(floorMap);
    const startPosition = { x: 112, y: 891 };
    const movedTargetPosition = { x: 64, y: 896 };
    expect(grid.isWalkable(startPosition)).toBe(true);
    expect(grid.isWalkable(movedTargetPosition)).toBe(true);
    expect(Math.hypot(startPosition.x - Math.round(startPosition.x / 16) * 16, startPosition.y - Math.round(startPosition.y / 16) * 16)).toBeLessThan(8);
    let fixedHandler: ((deltaMs: number) => void) | null = null;
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(null)),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => success(next)),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      runtime: { setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
      content: catalogResult.value,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const internals = flow as unknown as {
      input: { inputState: { snapshot: () => { frameNo: number; move: { x: number; y: number }; actions: readonly string[] } } };
      explorationScene: ExplorationScene | null;
    };
    let playerPosition = startPosition;
    let targetPosition = { x: 256, y: 800 };
    const moves: Array<{ x: number; y: number }> = [];
    let fixedSteps = 0;
    const targetActor = {
      objectId: "obj_f01_n01",
      get position() { return targetPosition; },
    };
    const fakeScene = {
      get state() { return { playerPosition } as unknown as ExplorationScene["state"]; },
      actorViews: [targetActor],
      fixedUpdate: vi.fn(() => {
        const snapshot = internals.input.inputState.snapshot();
        moves.push(snapshot.move);
        playerPosition = movePlayer(playerPosition, snapshot, grid).position;
        fixedSteps += 1;
        if (fixedSteps === 16) {
          return { objectId: "obj_f01_n01", encounterId: "encounter_floor_01_normal_a", position: targetPosition };
        }
        targetPosition = fixedSteps === 1 ? movedTargetPosition : targetPosition;
        return null;
      }),
    } as unknown as ExplorationScene;
    internals.explorationScene = fakeScene;

    const request = flow.triggerEncounter();
    const driveTick = (): void => { if (!fixedHandler) throw new Error("fixed handler 未注入"); fixedHandler(50); };
    for (let tick = 0; tick < 16; tick += 1) driveTick();
    const result = await request;
    expect(result.ok).toBe(false);
    expect(fixedSteps).toBe(16);
    expect(moves.length).toBe(16);
    // 当前点与吸附格相差不到 8px 时，首步也应朝 BFS 下一节点而非回拉吸附格。
    expect(moves[0].y).toBeLessThan(0);
    expect(moves[8].x).toBeLessThan(0);
    flow.destroy();
  });

  it("自动路径到达遭遇原始坐标，避免网格终点与遭遇盒仅相切", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    initial.expedition.playerPosition = { x: 96, y: 896 };
    initial.expedition.safePosition = { x: 96, y: 896 };
    const documentValue = new FlowFakeDocument();
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) return;
    let fixedHandler: ((deltaMs: number) => void) | null = null;
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      runtime: { setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
      content: catalogResult.value,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
        save: async (_revision: number, next: GameSaveV1) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const internals = flow as unknown as {
      input: { inputState: { snapshot: () => { frameNo: number; move: { x: number; y: number }; actions: readonly string[] } } };
      explorationScene: ExplorationScene | null;
    };
    const targetPosition = { x: 504, y: 808 };
    let playerPosition = { x: 96, y: 896 };
    let fixedSteps = 0;
    let contacted = false;
    const targetActor = {
      objectId: "obj_f01_n01",
      get position() { return targetPosition; },
    };
    const floorMap = abyssEchoContentRoot.maps.find((candidate) => candidate.id === "map_floor_01");
    expect(floorMap).toBeDefined();
    if (!floorMap) return;
    const grid = new CollisionGrid(floorMap);
    expect(grid.isWalkable(targetPosition)).toBe(true);
    expect(grid.isWalkable({ x: 512, y: 816 })).toBe(false);
    const fakeScene = {
      get state() { return { playerPosition } as unknown as ExplorationScene["state"]; },
      actorViews: [targetActor],
      fixedUpdate: vi.fn(() => {
        const snapshot = internals.input.inputState.snapshot();
        playerPosition = movePlayer(playerPosition, snapshot, grid, 240).position;
        fixedSteps += 1;
        const overlapsX = Math.abs(playerPosition.x - targetPosition.x) < 6;
        const overlapsY = playerPosition.y < targetPosition.y + 8 && playerPosition.y + 8 > targetPosition.y;
        if (overlapsX && overlapsY) {
          contacted = true;
          return { objectId: "obj_f01_n01", encounterId: "encounter_floor_01_normal_a", position: targetPosition };
        }
        return null;
      }),
    } as unknown as ExplorationScene;
    internals.explorationScene = fakeScene;

    const request = flow.triggerEncounter();
    const driveTick = (): void => { if (!fixedHandler) throw new Error("fixed handler 未注入"); fixedHandler(50); };
    for (let tick = 0; tick < 1_200 && !contacted; tick += 1) driveTick();
    const result = await request;
    if (!result.ok) expect(result.error.code).not.toBe("INVALID_TARGET");
    expect(contacted).toBe(true);
    expect(fixedSteps).toBeLessThan(1_200);
    flow.destroy();
  });

  it("自动寻怪在格线前先精确落到 waypoint 再继续转向", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const startPosition = { x: 778, y: 719.999999 };
    initial.expedition.playerPosition = startPosition;
    initial.expedition.safePosition = startPosition;
    initial.expedition.defeatedEncounterObjectIds = [
      "obj_f01_n01", "obj_f01_n02", "obj_f01_n03", "obj_f01_n04",
      "obj_f01_n05", "obj_f01_n06", "obj_f01_n07",
    ];
    const documentValue = new FlowFakeDocument();
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) return;
    const floorMap = abyssEchoContentRoot.maps.find((candidate) => candidate.id === "map_floor_01");
    expect(floorMap).toBeDefined();
    if (!floorMap) return;
    const grid = new CollisionGrid(floorMap);
    expect(grid.isWalkable(startPosition)).toBe(true);
    let fixedHandler: ((deltaMs: number) => void) | null = null;
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      runtime: { setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
      content: catalogResult.value,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
        save: async (_revision: number, next: GameSaveV1) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const internals = flow as unknown as {
      input: { inputState: { snapshot: () => { frameNo: number; move: { x: number; y: number }; actions: readonly string[] } } };
      explorationScene: ExplorationScene | null;
      autoTarget: Vector2 | null;
      autoPath: Vector2[];
    };
    let playerPosition = { ...startPosition };
    const targetPosition = { x: 1184, y: 448 };
    const positions: Array<{ before: Vector2; after: Vector2; move: Vector2 }> = [];
    const targetActor = { objectId: "obj_f01_n08", get position() { return targetPosition; } };
    const fakeScene = {
      get state() { return { playerPosition } as unknown as ExplorationScene["state"]; },
      actorViews: [targetActor],
      fixedUpdate: vi.fn(() => {
        const snapshot = internals.input.inputState.snapshot();
        const before = { ...playerPosition };
        playerPosition = movePlayer(playerPosition, snapshot, grid).position;
        positions.push({ before, after: { ...playerPosition }, move: { ...snapshot.move } });
        return null;
      }),
    } as unknown as ExplorationScene;
    internals.explorationScene = fakeScene;

    const request = flow.triggerEncounter();
    const driveTick = (): void => { if (!fixedHandler) throw new Error("fixed handler 未注入"); fixedHandler(50); };
    // 让真实寻路会话落在 floor01 的拐角前，随后仍通过 fixedUpdate 消费真实碰撞。
    // 这里仅固定当前会话的已计算 waypoint，避免测试退化为复制 BFS 实现。
    internals.autoTarget = { x: 779, y: 720 };
    internals.autoPath = [{ x: 800, y: 720 }];
    driveTick();

    // waypoint 距离不足一个固定步时必须按比例输入，下一步直接落在 y=720；
    // 随后仍沿当前路径的横向段前进，不能在旧格线一侧反复重规划。
    expect(positions[0]?.before.y).toBeLessThan(720);
    expect(positions[0]?.after.y).toBeCloseTo(720, 8);
    expect(positions[0]?.after.x).toBeCloseTo(startPosition.x, 8);
    expect(internals.autoTarget).toEqual({ x: 779, y: 720 });
    driveTick();
    expect(playerPosition.x).toBeCloseTo(779, 8);
    expect(playerPosition.y).toBeCloseTo(720, 8);
    expect(internals.autoTarget).toEqual({ x: 779, y: 720 });
    driveTick();
    expect(playerPosition.x).toBeGreaterThan(779);
    flow.destroy();
    await request;
  });

  it("自动寻怪达到步数上限时投影现场诊断，重试成功后清理旧现场", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const documentValue = new FlowFakeDocument();
    let fixedHandler: ((deltaMs: number) => void) | null = null;
    let returnContact = false;
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) return;
    const floorMap = abyssEchoContentRoot.maps.find((map) => map.id === "map_floor_01");
    expect(floorMap).toBeDefined();
    if (!floorMap) return;
    const grid = new CollisionGrid(floorMap);
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: async (_revision: number, next: GameSaveV1) => success(next),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      runtime: { setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
      content: catalogResult.value,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const internals = flow as unknown as {
      input: {
        inputState: { snapshot: () => { frameNo: number; move: { x: number; y: number }; actions: readonly string[] } };
        setEnabled: (enabled: boolean) => void;
      };
      explorationScene: ExplorationScene | null;
      handleEncounterContact: (value: { objectId: string; encounterId: string; position: Vector2 }) => Promise<void>;
      saveValue: GameSaveV1 | null;
    };
    let playerPosition = { x: 96, y: 896 };
    const targetPosition = { x: 256, y: 800 };
    const contact = { objectId: "obj_f01_n01", encounterId: "encounter_floor_01_normal_a", position: targetPosition };
    const targetActor = { objectId: "obj_f01_n01", get position() { return targetPosition; } };
    const fakeScene = {
      get state() { return { phase: "ACTIVE", playerPosition } as unknown as ExplorationScene["state"]; },
      actorViews: [targetActor],
      fixedUpdate: vi.fn(() => {
        const snapshot = internals.input.inputState.snapshot();
        playerPosition = movePlayer(playerPosition, snapshot, grid).position;
        if (returnContact) {
          returnContact = false;
          return contact;
        }
        return null;
      }),
    } as unknown as ExplorationScene;
    internals.explorationScene = fakeScene;
    internals.input.setEnabled(true);

    const failedRequest = flow.triggerEncounter();
    const driveTick = (): void => { if (!fixedHandler) throw new Error("fixed handler 未注入"); fixedHandler(50); };
    for (let tick = 0; tick < 1_201; tick += 1) driveTick();
    const failed = await failedRequest;
    expect(failed).toMatchObject({ ok: false, error: { code: "INVALID_TARGET" } });
    const diagnostic = documentValue.root.find("auto-encounter-error");
    expect(diagnostic?.textContent).toContain("INVALID_TARGET");
    expect(diagnostic?.textContent).toContain("target=obj_f01_n01");
    expect(diagnostic?.textContent).toContain("steps=1201");
    expect(diagnostic?.textContent).toContain("player=");
    expect(diagnostic?.textContent).toContain("actor=");
    expect(diagnostic?.textContent).toContain("waypoint=");
    expect(diagnostic?.textContent).toContain("pathRemaining=");
    expect(diagnostic?.textContent).toContain("phase=ACTIVE");
    expect(diagnostic?.textContent).toContain("inputEnabled=true");
    expect(diagnostic?.textContent).toContain("commandedMove=");
    expect(diagnostic?.textContent).toContain("playerBeforeFixed=");
    expect(diagnostic?.textContent).toContain("playerAfterFixed=");
    expect(diagnostic?.textContent).toContain("stalledSteps=");
    expect(diagnostic?.textContent).toContain("maxSteps=1200");

    internals.handleEncounterContact = vi.fn(async () => {
      internals.saveValue = { ...initial, battle: { battleId: "battle_diag_retry" } as never };
    });
    returnContact = true;
    const retriedRequest = flow.triggerEncounter();
    driveTick();
    const retried = await retriedRequest;
    expect(retried.ok).toBe(true);
    expect(documentValue.root.find("auto-encounter-error")).toBeUndefined();
    flow.destroy();
  });

  it("自动寻怪长路线超过最小预算后仍继续消费真实碰撞固定步", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    initial.expedition.playerPosition = { x: 96, y: 896 };
    initial.expedition.safePosition = { x: 96, y: 896 };
    initial.expedition.defeatedEncounterObjectIds = [
      "obj_f01_n01", "obj_f01_n02", "obj_f01_n03", "obj_f01_n04",
      "obj_f01_n05", "obj_f01_n06", "obj_f01_n07",
    ];
    const documentValue = new FlowFakeDocument();
    let fixedHandler: ((deltaMs: number) => void) | null = null;
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) return;
    const floorMap = abyssEchoContentRoot.maps.find((map) => map.id === "map_floor_01");
    expect(floorMap).toBeDefined();
    if (!floorMap) return;
    const grid = new CollisionGrid(floorMap);
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: async (_revision: number, next: GameSaveV1) => success(next),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      runtime: { setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
      content: catalogResult.value,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const internals = flow as unknown as {
      input: {
        inputState: { snapshot: () => { frameNo: number; move: { x: number; y: number }; actions: readonly string[] } };
        setEnabled: (enabled: boolean) => void;
      };
      explorationScene: ExplorationScene | null;
      autoEncounterSession: { readonly steps: number; readonly maxSteps: number } | null;
    };
    let playerPosition = { x: 96, y: 896 };
    const targetPosition = { x: 1184, y: 448 };
    const targetActor = { objectId: "obj_f01_n08", get position() { return targetPosition; } };
    const fakeScene = {
      get state() { return { phase: "ACTIVE", playerPosition } as unknown as ExplorationScene["state"]; },
      actorViews: [targetActor],
      fixedUpdate: vi.fn(() => {
        const snapshot = internals.input.inputState.snapshot();
        playerPosition = movePlayer(playerPosition, snapshot, grid).position;
        return null;
      }),
    } as unknown as ExplorationScene;
    internals.explorationScene = fakeScene;
    internals.input.setEnabled(true);

    const request = flow.triggerEncounter();
    const session = internals.autoEncounterSession;
    expect(session).not.toBeNull();
    expect(session?.maxSteps).toBeGreaterThan(1_200);
    const startPosition = { ...playerPosition };
    const driveTick = (): void => { if (!fixedHandler) throw new Error("fixed handler 未注入"); fixedHandler(50); };
    for (let tick = 0; tick < 1_201; tick += 1) driveTick();

    expect(internals.autoEncounterSession?.steps).toBe(1_201);
    expect(playerPosition).not.toEqual(startPosition);
    expect(documentValue.root.find("auto-encounter-error")).toBeUndefined();
    flow.destroy();
    await request;
  });

  it("自动寻怪连续 180 步无位移时提前失败并保留停滞诊断", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    initial.expedition.playerPosition = { x: 96, y: 896 };
    initial.expedition.safePosition = { x: 96, y: 896 };
    const documentValue = new FlowFakeDocument();
    let fixedHandler: ((deltaMs: number) => void) | null = null;
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) return;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: async (_revision: number, next: GameSaveV1) => success(next),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      runtime: { setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
      content: catalogResult.value,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const internals = flow as unknown as {
      input: {
        inputState: { snapshot: () => { frameNo: number; move: { x: number; y: number }; actions: readonly string[] } };
        setEnabled: (enabled: boolean) => void;
      };
      explorationScene: ExplorationScene | null;
    };
    const playerPosition = { x: 96, y: 896 };
    const targetPosition = { x: 256, y: 800 };
    const targetActor = { objectId: "obj_f01_n01", get position() { return targetPosition; } };
    const fakeScene = {
      get state() { return { phase: "ACTIVE", playerPosition } as unknown as ExplorationScene["state"]; },
      actorViews: [targetActor],
      fixedUpdate: vi.fn(() => null),
    } as unknown as ExplorationScene;
    internals.explorationScene = fakeScene;
    internals.input.setEnabled(true);

    const request = flow.triggerEncounter();
    const driveTick = (): void => { if (!fixedHandler) throw new Error("fixed handler 未注入"); fixedHandler(50); };
    for (let tick = 0; tick < 181; tick += 1) driveTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      const failed = documentValue.root.find("auto-encounter-error");
      expect(failed?.textContent).toContain("INVALID_TARGET");
      expect(failed?.textContent).toContain("steps=181");
      expect(failed?.textContent).toContain("maxSteps=1200");
      expect(failed?.textContent).toContain("stalledSteps=180");
    } finally {
      flow.destroy();
      await request;
    }
  });

  it("自动寻怪按 normal→elite→boss 分层并保持地图对象顺序", () => {
    const map = abyssEchoContentRoot.maps.find((candidate) => candidate.id === "map_floor_01");
    expect(map).toBeDefined();
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) return;
    const resolveEncounter = (encounterId: string) => catalogResult.value.getEncounter(encounterId);
    const normalObjectIds = [
      "obj_f01_n01", "obj_f01_n02", "obj_f01_n03", "obj_f01_n04",
      "obj_f01_n05", "obj_f01_n06", "obj_f01_n07", "obj_f01_n08",
    ];

    const remainingNormal = selectAutoEncounterTarget(map?.objects ?? [], ["obj_f01_n03", "obj_f01_n06"], resolveEncounter);
    expect(remainingNormal.ok).toBe(true);
    if (!remainingNormal.ok) return;
    expect(remainingNormal.value?.objectId).toBe("obj_f01_n01");

    const firstElite = selectAutoEncounterTarget(map?.objects ?? [], normalObjectIds, resolveEncounter);
    expect(firstElite.ok).toBe(true);
    if (!firstElite.ok) return;
    expect(firstElite.value?.objectId).toBe("obj_f01_e01");

    const secondElite = selectAutoEncounterTarget(map?.objects ?? [], [...normalObjectIds, "obj_f01_e01"], resolveEncounter);
    expect(secondElite.ok).toBe(true);
    if (!secondElite.ok) return;
    expect(secondElite.value?.objectId).toBe("obj_f01_e02");

    const boss = selectAutoEncounterTarget(map?.objects ?? [], [...normalObjectIds, "obj_f01_e01", "obj_f01_e02"], resolveEncounter);
    expect(boss.ok).toBe(true);
    if (!boss.ok) return;
    expect(boss.value?.objectId).toBe("obj_f01_boss");
  });

  it("探索宝箱奖励与 opened 状态在同一 CAS 候选中提交，重复开箱不重复发奖", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const documentValue = new FlowFakeDocument();
    const saves: GameSaveV1[] = [];
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(null)),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => {
        saves.push(structuredClone(next));
        return success(next);
      }),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setState: (state: "exploration") => void }).setState("exploration");

    const internals = flow as unknown as {
      openChest: (objectId: string) => Promise<DomainResult<GameSaveV1>>;
    };
    const opened = await internals.openChest("obj_f01_chest01");
    expect(opened.ok).toBe(true);
    expect(flow.save?.expedition?.openedChestObjectIds).toEqual(["obj_f01_chest01"]);
    expect(flow.save?.claimedRewardTransactionIds).toContain("reward_exp_terminal_obj_f01_chest01");
    expect(saves).toHaveLength(1);
    expect(saves[0]?.expedition?.openedChestObjectIds).toEqual(["obj_f01_chest01"]);
    expect(documentValue.root.find("exploration-message")?.textContent).toContain("宝箱");

    const duplicate = await internals.openChest("obj_f01_chest01");
    expect(duplicate.ok).toBe(false);
    expect(duplicate.ok || duplicate.error.code).toBe("REWARD_ALREADY_CLAIMED");
    expect(saves).toHaveLength(1);
    flow.destroy();
  });

  it("宝箱保存失败不改变权威 opened 状态，重试复用同一奖励候选并成功", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const documentValue = new FlowFakeDocument();
    let fail = true;
    const saves: GameSaveV1[] = [];
    const repository = {
      get: vi.fn(async () => success<GameSaveV1 | null>(null)),
      replaceAfterConfirmation: vi.fn(async (next: GameSaveV1) => success(next)),
      save: vi.fn(async (_revision: number, next: GameSaveV1) => {
        if (fail) return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
        saves.push(structuredClone(next));
        return success(next);
      }),
    };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    (flow as unknown as { setState: (state: "exploration") => void }).setState("exploration");
    const internals = flow as unknown as {
      openChest: (objectId: string) => Promise<DomainResult<GameSaveV1>>;
    };
    const before = structuredClone(flow.save);
    const first = await internals.openChest("obj_f01_chest01");
    expect(first.ok).toBe(false);
    expect(first.ok || first.error.code).toBe("SAVE_FAILED");
    expect(flow.save).toEqual(before);
    expect(flow.save?.expedition?.openedChestObjectIds).toEqual([]);
    expect(documentValue.root.find("exploration-message")?.textContent).toContain("SAVE_FAILED");

    fail = false;
    const retried = await internals.openChest("obj_f01_chest01");
    expect(retried.ok).toBe(true);
    expect(saves).toHaveLength(1);
    expect(saves[0]?.claimedRewardTransactionIds).toContain("reward_exp_terminal_obj_f01_chest01");
    expect(flow.save?.expedition?.openedChestObjectIds).toEqual(["obj_f01_chest01"]);
    flow.destroy();
  });

  it("探索场景注入权威宝箱状态与传送门回城回调", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    initial.expedition.openedChestObjectIds = ["obj_f01_chest02"];
    const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
    expect(catalogResult.ok).toBe(true);
    if (!catalogResult.ok) return;
    const loadedBundles = floors06To10AssetManifest.bundles.map((bundle) => bundle.id);
    const flow = new GameFlowController({
      content: catalogResult.value,
      runtime: { assetService: {
        acquire: vi.fn(async () => success({ bundleId: "floor_01", release: async () => undefined })),
        restoreLoadedBundles: vi.fn(async () => undefined),
        getReferenceCount: vi.fn(() => 1),
        getLoadedBundleIds: vi.fn(() => loadedBundles),
      } },
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        save: async (_revision, next) => success(next),
        replaceAfterConfirmation: async (next) => success(next),
      },
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();
    const scene = (flow as unknown as { explorationScene: ExplorationScene | null }).explorationScene;
    expect(scene).toBeInstanceOf(ExplorationScene);
    expect(scene?.openedChestObjectIds).toEqual(["obj_f01_chest02"]);
    flow.destroy();
  });

  it("自动遭遇只登记 fixed 会话，逐 tick 移动并在接触后完成原 Promise", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const documentValue = new FlowFakeDocument();
    let fixedHandler: ((deltaMs: number) => void) | null = null;
    let fixedUpdates = 0;
    const repository = {
      get: async () => success<GameSaveV1 | null>(null),
      replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
      save: async (_revision: number, next: GameSaveV1) => success(next),
    };
    const scenes = { title: scene("title"), town: scene("town"), exploration: scene("exploration"), battle: scene("battle") };
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      runtime: { setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository,
      sceneFactories: { title: () => scenes.title, town: () => scenes.town, exploration: () => scenes.exploration, battle: () => scenes.battle },
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();

    const contact = { objectId: "obj_f01_n01", encounterId: "encounter_floor_01_normal_a", position: { x: 256, y: 800 } };
    const internals = flow as unknown as {
      explorationScene: ExplorationScene | null;
      handleEncounterContact: (value: typeof contact) => Promise<void>;
      saveValue: GameSaveV1 | null;
      autoMoving: boolean;
      autoTarget: Vector2 | null;
      autoPath: Vector2[];
    };
    internals.explorationScene = {
      get state() { return { playerPosition: { x: 96, y: 896 } } as unknown as ExplorationScene["state"]; },
      actorViews: [{ objectId: "obj_f01_n01", position: { x: 256, y: 800 } }],
      fixedUpdate: vi.fn(() => {
        fixedUpdates += 1;
        return contact;
      }),
    } as unknown as ExplorationScene;
    internals.handleEncounterContact = vi.fn(async () => {
      internals.saveValue = { ...initial, battle: { battleId: "battle_fixed_tick" } as never };
    });
    const request = flow.triggerEncounter();
    expect(fixedUpdates).toBe(0);
    expect(fixedHandler).not.toBeNull();
    expect(internals.autoMoving).toBe(true);
    expect(internals.autoTarget).not.toBeNull();

    if (!fixedHandler) throw new Error("fixed handler 未注入");
    (fixedHandler as (deltaMs: number) => void)(50);
    const result = await request;
    expect(fixedUpdates).toBe(1);
    expect(result.ok).toBe(true);
    expect(internals.autoMoving).toBe(false);
    expect(internals.autoTarget).toBeNull();
    expect(internals.autoPath).toEqual([]);
    flow.destroy();
  });

  it("自动遭遇目标会话在销毁时有界结束并清理输入", async () => {
    const initial = terminalSave();
    initial.expedition = expedition();
    const documentValue = new FlowFakeDocument();
    let fixedHandler: ((deltaMs: number) => void) | null = null;
    const flow = new GameFlowController({
      document: documentValue as unknown as Document,
      gameRoot: documentValue.root as unknown as HTMLElement,
      runtime: { setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
      domainContext: testDomain(),
      router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
      repository: {
        get: async () => success<GameSaveV1 | null>(null),
        replaceAfterConfirmation: async (next: GameSaveV1) => success(next),
        save: async (_revision: number, next: GameSaveV1) => success(next),
      },
      sceneFactories: terminalSceneFactories(),
      createNewGame: async () => success(initial),
      rootFactory: () => ({ parent: null }),
    });
    await flow.start();
    await flow.newGame();
    await flow.continueGame();
    const internals = flow as unknown as {
      explorationScene: ExplorationScene | null;
      autoMoving: boolean;
      autoTarget: Vector2 | null;
      autoPath: Vector2[];
    };
    internals.explorationScene = {
      get state() { return { playerPosition: { x: 96, y: 896 } } as unknown as ExplorationScene["state"]; },
      actorViews: [{ objectId: "obj_f01_n01", position: { x: 256, y: 800 } }],
      fixedUpdate: vi.fn(() => null),
    } as unknown as ExplorationScene;
    const request = flow.triggerEncounter();
    expect(fixedHandler).not.toBeNull();
    expect(internals.autoMoving).toBe(true);
    flow.destroy();
    const result = await request;
    expect(result.ok).toBe(false);
    expect(result.ok || result.error.code).toBe("INVALID_TARGET");
    expect(internals.autoMoving).toBe(false);
    expect(internals.autoTarget).toBeNull();
    expect(internals.autoPath).toEqual([]);
  });

  describe("VIS-003 production GameFlow field wiring", () => {
    it("fake root/custom factory 不走 Pixi field 分支，也不 acquire town bundle", async () => {
      const { service, events } = productionAssetService();
      const flow = new GameFlowController({
        runtime: { assetService: service },
        domainContext: testDomain(),
        router: { transition: async <Params>(target: Scene<Params>, params: Params) => { await target.prepare(params); await target.enter(params); } },
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        sceneFactories: terminalSceneFactories(),
        rootFactory: () => ({ parent: null }),
      });

      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      expect(events).toEqual([]);
      flow.destroy();
    });

    it("真实 Pixi field 缺少 provider 或 atlas frame 时在 detached prepare 失败并释放候选 town lease", async () => {
      const { service, events } = productionAssetService();
      service.getLoadedResource.mockImplementation((bundleId: string) => {
        if (bundleId === "core_ui") return {};
        return undefined;
      });
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const flow = new GameFlowController({
        runtime: { assetService: service },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      await expect(flow.newGame()).rejects.toThrow("PIXEL_ASSET_BUNDLE_NOT_LOADED:town");
      expect(events).toEqual(["acquire:town", "release:town"]);
      flow.destroy();
    });

    it("真实 Pixi field 缺少 getLoadedResource capability 时抛稳定 provider 错误", async () => {
      const { service, events } = productionAssetService();
      const withoutProvider = { ...service, getLoadedResource: undefined } as unknown as typeof service;
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const flow = new GameFlowController({
        runtime: { assetService: withoutProvider },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      await expect(flow.newGame()).rejects.toThrow("PIXEL_FIELD_ASSET_SERVICE_MISSING");
      expect(events).toEqual(["acquire:town", "release:town"]);
      flow.destroy();
    });

    it("真实 Pixi 根的城镇路径先 acquire，再构造九个 actor、地图和 HUD，并安装 town fixed handler", async () => {
      const { service, events } = productionAssetService();
      let fixedHandler: ((deltaMs: number) => void) | null = null;
      const stage = new Container();
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const flow = new GameFlowController({
        runtime: { assetService: service, setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      const started = await flow.newGame();
      expect(started.ok).toBe(true);
      expect(flow.state).toBe("town");
      expect(events[0]).toBe("acquire:town");
      expect(fixedHandler).not.toBeNull();
      const internals = flow as unknown as { townScene: import("../../src/scenes/town/TownScene").TownScene | null };
      expect(internals.townScene?.mapView?.mapId).toBe("map_town");
      expect(internals.townScene?.actorViews).toHaveLength(9);
      expect(internals.townScene?.hud).not.toBeNull();
      expect((internals.townScene?.root as import("../../src/app/PixiSceneRoot").PixiSceneRoot).mapBack.children.length).toBeGreaterThan(0);

      const before = internals.townScene?.playerPosition;
      (flow as unknown as { input: { inputState: { setMove(x: number, y: number): void } } }).input.inputState.setMove(1, 0);
      const handler = fixedHandler as ((deltaMs: number) => void) | null;
      if (handler) handler(16.67);
      expect(internals.townScene?.playerPosition).not.toEqual(before);
      flow.destroy();
    });

    it("真实 Pixi 根的探索路径传入完整 renderer，使用 exact floor tileset 和 actor sources", async () => {
      const { service } = productionAssetService();
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const stage = new Container();
      const flow = new GameFlowController({
        runtime: { assetService: service },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      expect((await flow.enterFloor("floor_01")).ok).toBe(true);
      expect(flow.state).toBe("exploration");
      const internals = flow as unknown as { explorationScene: ExplorationScene | null };
      expect(internals.explorationScene?.mapView?.mapId).toBe("map_floor_01");
      expect(internals.explorationScene?.mapView?.tilesetAssetId).toBe("tileset_map_floor_01");
      expect(internals.explorationScene?.actorViews[0]?.resource).toEqual({ kind: "player", fieldSpriteId: "sprite_field_char_wanderer" });
      expect((internals.explorationScene?.root as import("../../src/app/PixiSceneRoot").PixiSceneRoot).mapBack.children.length).toBeGreaterThan(0);
      expect((internals.explorationScene?.root as import("../../src/app/PixiSceneRoot").PixiSceneRoot).actors.children.length).toBeGreaterThan(0);
      flow.destroy();
    });

    it("field world NPC 只 resolve 一次，且同一 fixed snapshot 的管理/地图动作进入 GameFlow", async () => {
      const { service } = productionAssetService();
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const npcGetter = vi.spyOn(finalCatalog.value, "getNpc");
      let fixedHandler: ((deltaMs: number) => void) | null = null;
      const flow = new GameFlowController({
        runtime: { assetService: service, setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      const town = (flow as unknown as { townScene: import("../../src/scenes/town/TownScene").TownScene }).townScene;
      const internals = flow as unknown as {
        input: { inputState: { press(action: string): void; frameNo: number } };
        npcRouteMessage: string | null;
        managementPage: string | null;
        pendingFieldAction: string | null;
      };
      (town as unknown as { playerPositionValue: Vector2 }).playerPositionValue = { x: 320, y: 320 };
      npcGetter.mockClear();
      internals.input.inputState.press("interact");
      const npcFrame = fixedHandler as ((deltaMs: number) => void) | null;
      if (!npcFrame) throw new Error("town fixed handler 未安装");
      npcFrame(16.67);
      await Promise.resolve();
      await Promise.resolve();
      expect(npcGetter).toHaveBeenCalledTimes(1);
      expect(internals.npcRouteMessage).toContain("酒馆");

      // NPC 面板打开时 TownScene 会暂停固定步输入；关闭面板后再验证同一快照的动作转发。
      town.closePanel();
      const beforeFrame = internals.input.inputState.frameNo;
      internals.input.inputState.press("inventory");
      npcFrame(16.67);
      await Promise.resolve();
      expect(internals.input.inputState.frameNo).toBe(beforeFrame + 1);
      expect(internals.managementPage).toBe("inventory");
      // TownScene 以 in-flight guard 串行化异步 field action，等待清理后再消费下一帧动作。
      await vi.waitFor(() => expect((town as unknown as { actionInFlight: Promise<void> | null }).actionInFlight).toBeNull());
      internals.input.inputState.press("map");
      npcFrame(16.67);
      await Promise.resolve();
      await Promise.resolve();
      expect(internals.pendingFieldAction).toBe("map");
      flow.destroy();
    });

    it("并发 town route 串行消费各自 lease，不互换也不泄漏", async () => {
      const { service } = productionAssetService();
      const releaseIds: number[] = [];
      let leaseId = 0;
      const acquire = service.acquire;
      service.acquire = vi.fn(async (bundleId: string) => {
        const result = await acquire(bundleId);
        if (!result.ok) return result;
        const id = ++leaseId;
        const lease = result.value;
        return success<AssetLease>({
          bundleId: lease.bundleId,
          release: async (options) => {
            releaseIds.push(id);
            await lease.release(options);
          },
        });
      });
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const flow = new GameFlowController({
        runtime: { assetService: service },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      const first = (flow as unknown as { route(kind: "town"): Promise<void> }).route("town");
      const second = (flow as unknown as { route(kind: "town"): Promise<void> }).route("town");
      await Promise.all([first, second]);
      const internals = flow as unknown as { townLease: AssetLease | null };
      expect(releaseIds).toEqual([1, 2]);
      expect(internals.townLease).not.toBeNull();
      flow.destroy();
    }, 30_000);

    it("destroy 发生在 town acquire 期间时取消 route 并释放本次局部 lease", async () => {
      const { service } = productionAssetService();
      const acquireGate = deferred<DomainResult<AssetLease>>();
      const initialAcquire = service.acquire;
      let holdAcquire = false;
      service.acquire = vi.fn(async (bundleId: string) => holdAcquire ? acquireGate.promise : initialAcquire(bundleId));
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const flow = new GameFlowController({
        runtime: { assetService: service },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      holdAcquire = true;
      const route = (flow as unknown as { route(kind: "town"): Promise<void> }).route("town");
      await vi.waitFor(() => expect(service.acquire).toHaveBeenCalledTimes(2));
      const release = vi.fn(async () => undefined);
      flow.destroy();
      acquireGate.resolve(success<AssetLease>({ bundleId: "town", release }));
      await expect(route).rejects.toThrow("GAME_FLOW_DESTROYED");
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("destroy 发生在 transition 期间时不写回已销毁 controller 并释放候选 lease", async () => {
      const { service } = productionAssetService();
      const transitionGate = deferred<void>();
      let holdTransition = false;
      let useCandidateLease = false;
      const candidateRelease = vi.fn(async () => undefined);
      const acquire = service.acquire;
      service.acquire = vi.fn(async (bundleId: string) => {
        const result = await acquire(bundleId);
        if (!result.ok || !useCandidateLease) return result;
        return success<AssetLease>({ bundleId, release: candidateRelease });
      });
      const router = {
        transition: vi.fn(async <Params>(scene: Scene<Params>, params: Params) => {
          if (holdTransition) await transitionGate.promise;
          await scene.prepare(params);
          await scene.enter(params);
        }),
      };
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const flow = new GameFlowController({
        runtime: { assetService: service },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router,
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      const lease = (flow as unknown as { townLease: AssetLease | null }).townLease;
      expect(lease).not.toBeNull();
      const release = vi.spyOn(lease!, "release");
      holdTransition = true;
      useCandidateLease = true;
      const route = (flow as unknown as { route(kind: "town"): Promise<void> }).route("town");
      await vi.waitFor(() => expect(service.acquire).toHaveBeenCalledTimes(2));
      flow.destroy();
      transitionGate.resolve(undefined);
      await expect(route).rejects.toThrow("GAME_FLOW_DESTROYED");
      expect(release).not.toHaveBeenCalled();
      expect(candidateRelease).toHaveBeenCalledTimes(1);
    });

    it("destroy 发生在 transition 后必须先清理目标 scene 再释放候选 town lease", async () => {
      const { service } = productionAssetService();
      const transitionGate = deferred<void>();
      let holdTransition = false;
      let activeTarget: Scene<unknown> | null = null;
      const cleanupEvents: string[] = [];
      const initialAcquire = service.acquire;
      service.acquire = vi.fn(async (bundleId: string) => {
        const result = await initialAcquire(bundleId);
        if (!result.ok || bundleId !== "town") return result;
        return success<AssetLease>({
          bundleId: result.value.bundleId,
          release: async (options) => {
            cleanupEvents.push("lease.release");
            await result.value.release(options);
          },
        });
      });
      const router = {
        transition: vi.fn(async <Params>(target: Scene<Params>, params: Params) => {
          activeTarget = target as Scene<unknown>;
          if (holdTransition) await transitionGate.promise;
          await target.prepare(params);
          await target.enter(params);
        }),
        destroy: vi.fn(async () => {
          const target = activeTarget;
          if (!target) return;
          cleanupEvents.push("target.exit");
          await target.exit();
          target.root.parent = null;
          cleanupEvents.push("target.detach");
          cleanupEvents.push("target.destroy");
          await target.destroy();
        }),
      };
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const flow = new GameFlowController({
        runtime: { assetService: service },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router,
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      holdTransition = true;
      const route = (flow as unknown as { route(kind: "town"): Promise<void> }).route("town");
      await vi.waitFor(() => expect(service.acquire).toHaveBeenCalledTimes(2));
      flow.destroy();
      transitionGate.resolve(undefined);

      await expect(route).rejects.toThrow("GAME_FLOW_DESTROYED");
      expect(router.destroy).toHaveBeenCalledTimes(1);
      const cleanedTarget = activeTarget as Scene<unknown> | null;
      expect(cleanedTarget).not.toBeNull();
      expect(cleanedTarget?.root.parent).toBeNull();
      expect(cleanupEvents).toEqual(["target.exit", "target.detach", "target.destroy", "lease.release"]);
    });

    it("town lease release 失败会在下一次安全 route 重试并移出清理队列", async () => {
      const { service } = productionAssetService();
      const acquire = service.acquire;
      let townLeaseNumber = 0;
      let releaseAttempts = 0;
      service.acquire = vi.fn(async (bundleId: string) => {
        const result = await acquire(bundleId);
        if (!result.ok) return result;
        const lease = result.value;
        const id = ++townLeaseNumber;
        return success<AssetLease>({
          bundleId: lease.bundleId,
          release: async (options) => {
            if (id === 1 && releaseAttempts++ === 0) throw new Error("LEASE_RELEASE_RETRYABLE");
            await lease.release(options);
          },
        });
      });
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const flow = new GameFlowController({
        runtime: { assetService: service },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      await (flow as unknown as { route(kind: "title"): Promise<void> }).route("title");
      const internals = flow as unknown as { townLeaseCleanup: Set<AssetLease>; townLeaseDiagnostic: string | null };
      expect(releaseAttempts).toBe(1);
      expect(internals.townLeaseCleanup.size).toBe(1);
      expect(internals.townLeaseDiagnostic).toBe("LEASE_RELEASE_RETRYABLE");
      await (flow as unknown as { route(kind: "town"): Promise<void> }).route("town");
      expect(releaseAttempts).toBe(2);
      expect(internals.townLeaseCleanup.size).toBe(0);
      expect(internals.townLeaseDiagnostic).toBeNull();
      flow.destroy();
    });

    it("HUD preflight 在 transition 前阻止缺少本地化的 field scene，并缓存同 revision 投影", async () => {
      const { service } = productionAssetService();
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const originalGetMap = finalCatalog.value.getMap.bind(finalCatalog.value);
      const mapResult = originalGetMap("map_town");
      expect(mapResult.ok).toBe(true);
      if (!mapResult.ok) return;
      const invalidMap = { ...mapResult.value, nameKey: "missing.map.name" } as typeof mapResult.value;
      vi.spyOn(finalCatalog.value, "getMap").mockImplementation((mapId) => mapId === "map_town" ? success(invalidMap) : originalGetMap(mapId));
      const router = { transition: vi.fn(async <Params>(scene: Scene<Params>, params: Params) => { await scene.prepare(params); await scene.enter(params); }) };
      const flow = new GameFlowController({
        runtime: { assetService: service },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router,
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      await expect(flow.newGame()).rejects.toThrow("FIELD_HUD_CONTENT_INVALID:maps.map_town.nameKey");
      expect(router.transition).toHaveBeenCalledTimes(1);
      flow.destroy();

      const normal = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(normal.ok).toBe(true);
      if (!normal.ok) return;
      const secondFlow = new GameFlowController({
        runtime: { assetService: productionAssetService().service },
        content: normal.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });
      await secondFlow.start();
      expect((await secondFlow.newGame()).ok).toBe(true);
      const cacheFlow = secondFlow as unknown as { fieldHudCache: unknown; buildFieldHudStatus: (kind: "town" | "exploration", mapId: string) => Readonly<FieldHudStatus> };
      cacheFlow.fieldHudCache = null;
      const getCharacter = vi.spyOn(normal.value, "getCharacter");
      const first = cacheFlow.buildFieldHudStatus("town", "map_town");
      const second = cacheFlow.buildFieldHudStatus("town", "map_town");
      expect(second).toBe(first);
      expect(getCharacter).toHaveBeenCalledTimes(6);
      secondFlow.destroy();
    });

    it("field management action 复用 onManagementRoute，拒绝时保留稳定诊断且不抛出", async () => {
      const { service } = productionAssetService();
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const documentValue = new FlowFakeDocument();
      const routes: string[] = [];
      let fixedHandler: ((deltaMs: number) => void) | null = null;
      const flow = new GameFlowController({
        runtime: { assetService: service, setFixedUpdateHandler: (handler) => { fixedHandler = handler; } },
        document: documentValue as unknown as Document,
        gameRoot: documentValue.root as unknown as HTMLElement,
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        onManagementRoute: async (route) => { routes.push(route); },
        rootFactory: () => createPixiSceneRoot(),
      });

      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      const input = (flow as unknown as { input: { inputState: { press(action: string): void } } }).input.inputState;
      input.press("inventory");
      const townFixed = fixedHandler as ((deltaMs: number) => void) | null;
      townFixed?.(16.67);
      await Promise.resolve();
      await Promise.resolve();
      expect(routes).toEqual(["inventory"]);
      expect((flow as unknown as { managementPage: string | null }).managementPage).toBe("inventory");
      // 生产 TownScene 会保留 TownModalRenderer；FieldHud 管理动作仍必须投影真实管理页。
      expect(documentValue.root.find("management-title")?.textContent).toContain("背包");
      expect(documentValue.root.find("management-summary")).toBeDefined();
      expect(documentValue.querySelector("#game-flow-ui")?.className).not.toContain("legacy-debug-ui");
      flow.destroy();

      let rejectedHandler: ((deltaMs: number) => void) | null = null;
      const rejectedFlow = new GameFlowController({
        runtime: { assetService: productionAssetService().service, setFixedUpdateHandler: (handler) => { rejectedHandler = handler; } },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        onManagementRoute: async () => { throw new Error("MANAGEMENT_ROUTE_DOWN"); },
        rootFactory: () => createPixiSceneRoot(),
      });
      await rejectedFlow.start();
      expect((await rejectedFlow.newGame()).ok).toBe(true);
      const rejectedInput = (rejectedFlow as unknown as { input: { inputState: { press(action: string): void } } }).input.inputState;
      rejectedInput.press("inventory");
      const rejectedFixed = rejectedHandler as ((deltaMs: number) => void) | null;
      rejectedFixed?.(16.67);
      await Promise.resolve();
      await Promise.resolve();
      expect((rejectedFlow as unknown as { managementRouteDiagnostic: string | null }).managementRouteDiagnostic).toBe("MANAGEMENT_ROUTE_FAILED:inventory");
      rejectedFlow.destroy();
    });

    it("legacy resources 的 core frame 只接受 atlas_core_ui.requiredFrames", () => {
      const { service } = productionAssetService();
      const flow = new GameFlowController({ runtime: { assetService: service } });
      const resources = (flow as unknown as { resources(): ExplorationSceneResources }).resources();
      expect(resources.hasCoreFrame("object_portal_floor")).toBe(true);
      expect(resources.hasCoreFrame("frame_not_in_atlas")).toBe(false);
      flow.destroy();
    });

    it("production Pixi 城镇 NPC 打开画布内 modal，并把同一 command 镜像到 semanticControls", async () => {
      const { service } = productionAssetService();
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const flow = new GameFlowController({
        runtime: { assetService: service },
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });
      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      const internals = flow as unknown as {
        townScene: { interactNpc(npcId: string): Promise<DomainResult<unknown>> };
        townModalRenderer: { semanticControls: readonly { testId: string; command: { kind: string } }[] } | null;
      };
      await internals.townScene.interactNpc("npc_merchant");
      await Promise.resolve();
      expect(internals.townModalRenderer).not.toBeNull();
      expect(internals.townModalRenderer?.semanticControls.some((control) => control.command.kind === "close")).toBe(true);
      expect(internals.townModalRenderer?.semanticControls.some((control) => control.command.kind === "buyOffer")).toBe(true);
      flow.destroy();
    });

    it("production modal resize 复用 renderer page size，并规范化 stale pageIndex 后重新投影", async () => {
      const { service } = productionAssetService();
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const initialViewport = calculateViewport({ width: 568, height: 320 });
      const insetViewport = calculateViewport({ width: 568, height: 320 }, { top: 20, right: 0, bottom: 24, left: 0 });
      let viewportListener: ((viewport: ReturnType<typeof calculateViewport>) => void) | null = null;
      const flow = new GameFlowController({
        runtime: {
          assetService: service,
          lastViewport: initialViewport,
          subscribeViewport: (listener) => { viewportListener = listener; return () => { viewportListener = null; }; },
        },
        document: new FlowFakeDocument() as unknown as Document,
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });
      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      const internals = flow as unknown as {
        townScene: { interactNpc(npcId: string): Promise<DomainResult<unknown>> };
        townModalPageIndex: number;
        townModalRenderer: { state: { kind: string; pageIndex: number; pageCount: number } } | null;
      };
      await internals.townScene.interactNpc("npc_merchant");
      await Promise.resolve();
      const offers = flow.save?.shop.offers.length ?? 0;
      expect(internals.townModalRenderer?.state.pageCount).toBe(Math.max(1, Math.ceil(offers / getTownModalPageSize(initialViewport))));
      internals.townModalPageIndex = 99;
      if (typeof viewportListener !== "function") throw new Error("VIEWPORT_LISTENER_NOT_INSTALLED");
      (viewportListener as (viewport: ReturnType<typeof calculateViewport>) => void)(insetViewport);
      await Promise.resolve();
      const resized = internals.townModalRenderer?.state;
      const resizedPageCount = Math.max(1, Math.ceil(offers / getTownModalPageSize(insetViewport)));
      expect(resized?.pageCount).toBe(resizedPageCount);
      expect(resized?.pageIndex).toBe(resizedPageCount - 1);
      flow.destroy();
    });

    it("production Pixi 城镇 modal 只保留透明 semantic DOM，不再创建 legacy NPC/商店/楼层入口", async () => {
      const { service } = productionAssetService();
      const finalCatalog = ContentCatalog.create(abyssEchoContentRoot, "final");
      expect(finalCatalog.ok).toBe(true);
      if (!finalCatalog.ok) return;
      const documentValue = new FlowFakeDocument();
      const flow = new GameFlowController({
        runtime: { assetService: service },
        document: documentValue as unknown as Document,
        gameRoot: documentValue.root as unknown as HTMLElement,
        content: finalCatalog.value,
        domainContext: testDomain(),
        router: new SceneRouter({ stage: new Container() }),
        repository: {
          get: async () => success<GameSaveV1 | null>(null),
          replaceAfterConfirmation: async (next) => success(next),
          save: async (_revision, next) => success(next),
        },
        rootFactory: () => createPixiSceneRoot(),
      });
      await flow.start();
      expect((await flow.newGame()).ok).toBe(true);
      const internals = flow as unknown as {
        townScene: { interactNpc(npcId: string): Promise<DomainResult<unknown>> };
      };
      await internals.townScene.interactNpc("npc_merchant");
      await Promise.resolve();
      const ui = documentValue.querySelector("#game-flow-ui");
      expect(ui).not.toBeNull();
      const elements = collectFakeElements(ui!);
      const testIds = elements.map((element) => element.dataset.testid).filter((value): value is string => Boolean(value));
      expect(testIds.some((value) => value === "merchant-panel" || value === "close-npc-panel" || value === "enter-floor" || value.startsWith("npc-") || value.startsWith("merchant-buy-") || value.startsWith("merchant-offer-"))).toBe(false);
      const semanticButtons = elements.filter((element) => element.className === "town-modal-semantic");
      expect(semanticButtons.length).toBeGreaterThan(0);
      expect(new Set(semanticButtons.map((button) => button.dataset.testid)).size).toBe(semanticButtons.length);
      expect(semanticButtons.every((button) => button.textContent === "")).toBe(true);
      flow.destroy();
    });
  });
});
