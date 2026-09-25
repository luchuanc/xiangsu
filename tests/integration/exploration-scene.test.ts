import { describe, expect, it, vi } from "vitest";

import type { MapDefinition } from "../../src/content/contracts";
import { createExplorationState } from "../../src/domain/exploration/ExplorationState";
import { ActorView } from "../../src/scenes/exploration/ActorView";
import { ExplorationScene } from "../../src/scenes/exploration/ExplorationScene";
import type { FieldHudStatus, FieldInputAction, FieldSceneFrame, FieldSceneView } from "../../src/scenes/exploration/FieldSceneView";
import { selectInteraction } from "../../src/scenes/exploration/InteractionSystem";
import { TileMapView } from "../../src/scenes/exploration/TileMapView";
import { calculateViewport } from "../../src/app/ViewportService";

function map(objects: MapDefinition["objects"]): MapDefinition {
  const layer = new Array(16).fill(0);
  return {
    id: "map_test",
    nameKey: "map.test",
    widthTiles: 4,
    heightTiles: 4,
    tileSize: 16,
    assetBundleId: "floor_test",
    spawnPoint: { x: 16, y: 16 },
    groundLayer: [...layer],
    decorBackLayer: [...layer],
    decorFrontLayer: [...layer],
    collisionLayer: [...layer] as Array<0 | 1>,
    objects,
  };
}

function status(mapId = "map_test"): FieldHudStatus {
  return Object.freeze({
    sceneKind: "exploration",
    mapId,
    mapDisplayName: "测试荒野",
    partySlots: Object.freeze([
      Object.freeze({ slot: 0, member: Object.freeze({ characterId: "char_protagonist", displayName: "主角", currentHp: 100, maxHp: 100 }) }),
      Object.freeze({ slot: 1, member: null }),
      Object.freeze({ slot: 2, member: null }),
      Object.freeze({ slot: 3, member: null }),
    ]) as FieldHudStatus["partySlots"],
  });
}

class FakeFieldView implements FieldSceneView {
  public readonly calls: string[] = [];
  public readonly preparedFrames: FieldSceneFrame[] = [];
  public readonly enteredFrames: FieldSceneFrame[] = [];
  public readonly updatedFrames: FieldSceneFrame[] = [];
  public readonly resumedFrames: FieldSceneFrame[] = [];
  public readonly viewports: unknown[] = [];
  public prepareError: Error | null = null;
  public prepareGate: Promise<void> | null = null;

  public prepare(frame: FieldSceneFrame): void | Promise<void> {
    this.calls.push("prepare");
    this.preparedFrames.push(frame);
    if (this.prepareError) throw this.prepareError;
    if (this.prepareGate) return this.prepareGate;
  }

  public enter(frame: FieldSceneFrame): void { this.calls.push("enter"); this.enteredFrames.push(frame); }
  public update(frame: FieldSceneFrame): void { this.calls.push("update"); this.updatedFrames.push(frame); }
  public setViewport(viewport: unknown): void { this.calls.push("setViewport"); this.viewports.push(viewport); }
  public pause(): void { this.calls.push("pause"); }
  public resume(frame: FieldSceneFrame): void { this.calls.push("resume"); this.resumedFrames.push(frame); }
  public destroy(): void { this.calls.push("destroy"); }
}

function fullFieldOptions(overrides: Record<string, unknown> = {}) {
  const view = new FakeFieldView();
  const snapshots: Array<Readonly<{ frameNo: number; move: { x: number; y: number }; actions: readonly string[] }>> = [];
  const options = {
    root: { parent: null },
    map: map([]),
    viewport: calculateViewport({ width: 568, height: 320 }),
    resources: { hasBundle: () => true, hasAsset: () => true, hasFieldSprite: () => true, hasCoreFrame: () => true },
    tilesetAssetId: "tileset_map_test",
    input: {
      snapshot: () => {
        const snapshot = snapshots.shift() ?? { frameNo: 1, move: { x: 0, y: 0 }, actions: [] as readonly string[] };
        return Object.freeze(snapshot);
      },
      setEnabled: () => undefined,
      resetAll: () => undefined,
    },
    playerFieldSpriteId: "sprite_field_char",
    encounterFieldSpriteId: () => "sprite_encounter",
    view,
    getHudStatus: () => status(),
    npcPresentation: () => ({ spriteId: "sprite_npc", displayName: "巡林者" }),
    ...overrides,
  } as unknown as ConstructorParameters<typeof ExplorationScene>[0];
  return { options, view, snapshots };
}

describe("RPG-018 exploration adapters", () => {
  it("28 逻辑像素内按距离和 UTF-16 objectId 稳定选择，并排除 encounter/已开宝箱", () => {
    const result = selectInteraction({
      playerPosition: { x: 0, y: 0 },
      objects: [
        { kind: "encounter", objectId: "a-enc", encounterId: "enc", position: { x: 0, y: 0 }, behavior: { mode: "stationary", patrolPoints: [], wanderRadius: 0, detectionRadius: 0, leashRadius: 0, moveSpeed: 0 } },
        { kind: "chest", objectId: "chest-open", dropTableId: "drop", frameId: "object_chest_closed", position: { x: 1, y: 0 } },
        { kind: "npc", objectId: "z-npc", npcId: "npc", position: { x: 4, y: 0 }, blocking: true },
        { kind: "npc", objectId: "a-npc", npcId: "npc", position: { x: -4, y: 0 }, blocking: true },
        { kind: "portal", objectId: "far", position: { x: 29, y: 0 }, action: { kind: "returnTown" }, frameId: "object_portal_return" },
      ],
      openedChestObjectIds: ["chest-open"],
    });
    expect(result.target?.object.objectId).toBe("a-npc");
    expect(result.target?.action).toBe("talk");
    expect(result.target?.distanceSquared).toBe(16);
    expect(result.enabled).toBe(true);
  });

  it("同距离 portal 保留显式动作，超过半径则禁用", () => {
    const objects: MapDefinition["objects"] = [
      { kind: "portal", objectId: "portal-floor", position: { x: 28, y: 0 }, action: { kind: "openFloorSelect" }, frameId: "object_portal_floor" },
    ];
    expect(selectInteraction({ playerPosition: { x: 0, y: 0 }, objects, openedChestObjectIds: [] }).target?.action).toBe("openFloorSelect");
    expect(selectInteraction({ playerPosition: { x: 0, y: 0 }, objects, openedChestObjectIds: [], radius: 27 }).enabled).toBe(false);
  });

  it("TileMapView 严格保留四层并阻断缺 bundle/tileset", () => {
    const value = new TileMapView({
      map: map([]),
      tilesetAssetId: "tileset_map_floor_test",
      resources: { hasBundle: (id) => id === "floor_test", hasAsset: (id) => id === "tileset_map_floor_test" },
    });
    expect(value.getLayers().map((layer) => layer.name)).toEqual(["ground", "decorBack", "collision", "decorFront"]);
    expect(() => new TileMapView({ map: map([]), tilesetAssetId: "missing", resources: { hasBundle: () => true, hasAsset: () => false } })).toThrow("ASSET_MISSING");
  });

  it("ActorView 只接受显式资源 ID，脚底 Y 过整数才标记排序", () => {
    const resources = { hasFieldSprite: (id: string) => id === "sprite_field_char", hasCoreFrame: (id: string) => id === "object_chest_closed" };
    const playerResource = { kind: "player", fieldSpriteId: "sprite_field_char" } as const;
    const actor = new ActorView({ objectId: "player", resource: playerResource, displayName: "  主角  ", resources, position: { x: 12, y: 20.1 } });
    expect(actor.resourceId).toBe("sprite_field_char");
    expect(actor.resource).toEqual(playerResource);
    expect(actor.resource).not.toBe(playerResource);
    expect(Object.isFrozen(actor.resource)).toBe(true);
    expect(actor.displayName).toBe("主角");
    expect(actor.footAnchor).toEqual({ x: 12, y: 28 });
    expect(actor.zIndex).toBe(20);
    actor.clearSortDirty();
    expect(actor.setPosition({ x: 14, y: 20.9 })).toBe(false);
    expect(actor.sortDirty).toBe(false);
    expect(actor.setPosition({ x: 14, y: 21 })).toBe(true);
    expect(actor.zIndex).toBe(21);
    const blankLabel = new ActorView({ objectId: "npc", resource: { kind: "npc", spriteId: "sprite_field_char" }, displayName: "  ", resources, position: { x: 0, y: 0 } });
    expect(blankLabel.displayName).toBeNull();
    expect(() => new ActorView({ objectId: "bad", resource: { kind: "player", fieldSpriteId: "sprite_field_missing" }, resources, position: { x: 0, y: 0 } })).toThrow("ASSET_FIELD_SPRITE_MISSING");
  });

  it("Scene fixed step 只消费一个 InputSnapshot，暂停/销毁会禁用输入并释放资源", async () => {
    let snapshots = 0;
    let enabled = false;
    const mapValue = map([{ kind: "npc", objectId: "npc-1", npcId: "npc", position: { x: 48, y: 48 }, blocking: true }]);
    const scene = new ExplorationScene({
      root: { parent: null },
      map: mapValue,
      viewport: calculateViewport({ width: 568, height: 320 }),
      resources: { hasBundle: () => true, hasAsset: () => true, hasFieldSprite: () => true, hasCoreFrame: () => true },
      tilesetAssetId: "tileset_map_test",
      input: { snapshot: () => { snapshots += 1; return Object.freeze({ frameNo: snapshots, move: { x: 0, y: 0 }, actions: [] }); }, setEnabled: (value) => { enabled = value; }, resetAll: () => undefined },
      playerFieldSpriteId: "sprite_field_char",
      npcFieldSpriteId: () => "sprite_npc",
      encounterFieldSpriteId: () => "sprite_encounter",
    });
    await scene.prepare();
    scene.enter();
    scene.fixedUpdate();
    expect(snapshots).toBe(1);
    expect(enabled).toBe(true);
    await scene.exit();
    expect(enabled).toBe(false);
    await scene.destroy();
    expect(scene.mapView).toBeNull();
  });

  it("步长音效按实际 fixed-step 位移累计到 24 逻辑像素", async () => {
    const playSfx = vi.fn(() => true);
    const setMusic = vi.fn();
    const scene = new ExplorationScene({
      root: { parent: null },
      map: map([]),
      viewport: calculateViewport({ width: 568, height: 320 }),
      resources: { hasBundle: () => true, hasAsset: () => true, hasFieldSprite: () => true, hasCoreFrame: () => true },
      tilesetAssetId: "tileset_map_test",
      input: { snapshot: () => Object.freeze({ frameNo: 1, move: { x: 1, y: 0 }, actions: [] }), setEnabled: () => undefined },
      playerFieldSpriteId: "sprite_field_char",
      npcFieldSpriteId: () => "sprite_npc",
      encounterFieldSpriteId: () => "sprite_encounter",
      musicId: "bgm_field",
      audio: { playSfx, setMusic },
    });
    await scene.prepare();
    scene.enter();
    expect(setMusic).toHaveBeenCalledWith("bgm_field", 10_000);
    for (let step = 0; step < 20; step += 1) scene.fixedUpdate();
    expect(playSfx).toHaveBeenCalledWith("sfx_step");
    expect(playSfx).toHaveBeenCalledTimes(1);
  });

  it("宝箱只有 RewardService 回调成功后才从交互候选移除，并防止同帧重复提交", async () => {
    let opens = 0;
    const chestMap = map([{ kind: "chest", objectId: "chest-1", dropTableId: "drop", frameId: "object_chest_closed", position: { x: 16, y: 16 } }]);
    const scene = new ExplorationScene({
      root: { parent: null }, map: chestMap, viewport: calculateViewport({ width: 568, height: 320 }),
      resources: { hasBundle: () => true, hasAsset: () => true, hasFieldSprite: () => true, hasCoreFrame: () => true },
      tilesetAssetId: "tileset_map_test",
      input: { snapshot: () => Object.freeze({ frameNo: ++opens, move: { x: 0, y: 0 }, actions: ["interact"] as const }), setEnabled: () => undefined },
      playerFieldSpriteId: "sprite_field_char", npcFieldSpriteId: () => "sprite_npc", encounterFieldSpriteId: () => "sprite_encounter",
      onOpenChest: async () => { opens += 100; return true; },
    });
    await scene.prepare();
    scene.enter();
    scene.fixedUpdate();
    scene.fixedUpdate();
    await Promise.resolve();
    expect(scene.openedChestObjectIds).toEqual(["chest-1"]);
  });

  it("full field prepare 先校验 presentation，再一次 acquire 并投影完整首帧", async () => {
    const events: string[] = [];
    const view = new FakeFieldView();
    const mapValue = map([
      { kind: "npc", objectId: "npc-1", npcId: "npc", position: { x: 16, y: 16 }, blocking: true },
      { kind: "chest", objectId: "chest-1", dropTableId: "drop", frameId: "object_chest_closed", position: { x: 48, y: 48 } },
      { kind: "encounter", objectId: "enc-1", encounterId: "enc", position: { x: 80, y: 80 }, behavior: { mode: "stationary", patrolPoints: [], wanderRadius: 0, detectionRadius: 0, leashRadius: 0, moveSpeed: 0 } },
    ]);
    const base = fullFieldOptions({ map: mapValue, view });
    const acquired = { release: async () => { events.push("release"); } };
    const options = {
      ...base.options,
      initialState: createExplorationState(mapValue, { defeatedEncounterObjectIds: ["enc-1", "enc-1"] }),
      openedChestObjectIds: ["chest-1"],
      assetService: {
        acquire: vi.fn(async () => { events.push("acquire"); return { ok: true as const, value: acquired }; }),
      },
    } as ConstructorParameters<typeof ExplorationScene>[0];
    const scene = new ExplorationScene(options);
    await scene.prepare();
    expect(events).toEqual(["acquire"]);
    expect(view.calls).toEqual(["prepare"]);
    const frame = view.preparedFrames[0];
    expect(frame.animationStep).toBe(0);
    expect(frame.camera).toEqual(scene.cameraPosition);
    expect(frame.hudStatus.mapDisplayName).toBe("测试荒野");
    expect(frame.actors.find((actor) => actor.objectId === "npc-1")?.displayName).toBe("巡林者");
    expect(frame.interactionTarget?.object.objectId).toBe("npc-1");
    expect(frame.hiddenObjectIds).toEqual(["enc-1", "chest-1"]);
    await scene.destroy();
  });

  it("full fixed step 只取一个 snapshot，更新 frame 后转发第一个合法 action", async () => {
    const forwarded: FieldInputAction[] = [];
    const { options, view, snapshots } = fullFieldOptions({ onFieldAction: (action: Exclude<FieldInputAction, "interact">) => { forwarded.push(action); } });
    snapshots.push({ frameNo: 1, move: { x: 1, y: 0 }, actions: ["unknown", "inventory", "menu"] });
    const scene = new ExplorationScene(options);
    await scene.prepare();
    scene.enter();
    scene.fixedUpdate();
    expect(view.updatedFrames).toHaveLength(1);
    expect(view.updatedFrames[0].animationStep).toBe(1);
    expect(view.updatedFrames[0].actors.find((actor) => actor.objectId === "player")?.position.x).toBeGreaterThan(16);
    expect(forwarded).toEqual(["inventory"]);
    await scene.destroy();
  });

  it("五类 field action 均从同一 snapshot 严格转发，错误 interaction token 被忽略", async () => {
    const forwarded: FieldInputAction[] = [];
    const { options, snapshots } = fullFieldOptions({ onFieldAction: (action: Exclude<FieldInputAction, "interact">) => { forwarded.push(action); } });
    const scene = new ExplorationScene(options);
    await scene.prepare();
    scene.enter();
    const actions: readonly string[][] = [["map"], ["inventory"], ["party"], ["settings"], ["menu"], ["interaction"]];
    for (let index = 0; index < actions.length; index += 1) {
      snapshots.push({ frameNo: index + 1, move: { x: 0, y: 0 }, actions: actions[index] });
      scene.fixedUpdate();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(forwarded).toEqual(["map", "inventory", "party", "settings", "menu"]);
    await scene.destroy();
  });

  it("contact 优先于同一 snapshot 的 field action，并暂停 view/input", async () => {
    const forwarded: FieldInputAction[] = [];
    const contacts: string[] = [];
    const mapValue = map([{ kind: "encounter", objectId: "enc-1", encounterId: "enc", position: { x: 16, y: 16 }, behavior: { mode: "stationary", patrolPoints: [], wanderRadius: 0, detectionRadius: 0, leashRadius: 0, moveSpeed: 0 } }]);
    const { options, view, snapshots } = fullFieldOptions({ map: mapValue, onFieldAction: (action: Exclude<FieldInputAction, "interact">) => { forwarded.push(action); }, onContact: (contact: { objectId: string }) => { contacts.push(contact.objectId); } });
    snapshots.push({ frameNo: 1, move: { x: 0, y: 0 }, actions: ["menu"] });
    let enabled = false;
    (options.input as { setEnabled: (value: boolean) => void }).setEnabled = (value: boolean) => { enabled = value; };
    const scene = new ExplorationScene(options);
    await scene.prepare();
    scene.enter();
    scene.fixedUpdate();
    scene.fixedUpdate();
    expect(contacts).toEqual(["enc-1"]);
    expect(forwarded).toEqual([]);
    expect(view.calls).toContain("pause");
    expect(enabled).toBe(false);
    await scene.destroy();
  });

  it("strict presentation 半套配置在 acquire 前失败", async () => {
    const acquire = vi.fn(async () => ({ ok: true as const, value: { release: async () => undefined } }));
    const { options } = fullFieldOptions({ getHudStatus: undefined, assetService: { acquire } });
    await expect(new ExplorationScene(options).prepare()).rejects.toThrow("EXPLORATION_FIELD_OPTIONS_INCOMPLETE");
    expect(acquire).not.toHaveBeenCalled();
  });

  it("NPC presentation 不接受空名称或空 sprite", async () => {
    const { options } = fullFieldOptions({
      map: map([{ kind: "npc", objectId: "npc-1", npcId: "npc", position: { x: 16, y: 16 }, blocking: true }]),
      npcPresentation: () => ({ spriteId: "", displayName: " " }),
    });
    await expect(new ExplorationScene(options).prepare()).rejects.toThrow("EXPLORATION_NPC_PRESENTATION_INVALID:npc");
  });

  it("NPC presentation getter 的真实异常不降级为 raw ID", async () => {
    const { options } = fullFieldOptions({
      map: map([{ kind: "npc", objectId: "npc-1", npcId: "npc_throw", position: { x: 16, y: 16 }, blocking: true }]),
      npcPresentation: () => { throw new Error("NPC_LOOKUP_FAILED"); },
    });
    await expect(new ExplorationScene(options).prepare()).rejects.toThrow("NPC_LOOKUP_FAILED");
  });

  it("view destroy 在 lease release 前后都只发生一次", async () => {
    const events: string[] = [];
    const view = new FakeFieldView();
    const { options } = fullFieldOptions({ view, assetService: { acquire: async () => ({ ok: true as const, value: { release: async (releaseOptions?: { beforeUnload?: () => void }) => { releaseOptions?.beforeUnload?.(); events.push("release"); } } }) } });
    const originalDestroy = view.destroy.bind(view);
    view.destroy = () => { events.push("destroy"); originalDestroy(); };
    const scene = new ExplorationScene(options);
    await scene.prepare();
    await scene.destroy();
    await scene.destroy();
    expect(events).toEqual(["destroy", "release"]);
  });

  it("viewport 与 enter/pause/resume/exit 都按有效状态转发一次", async () => {
    const { options, view } = fullFieldOptions();
    const scene = new ExplorationScene(options);
    const nextViewport = calculateViewport({ width: 844, height: 390 });
    scene.setViewport(nextViewport);
    expect(view.calls).toEqual(["setViewport"]);
    await scene.prepare();
    scene.enter();
    scene.enter();
    scene.pause();
    scene.pause();
    scene.resume();
    scene.resume();
    await scene.exit();
    await scene.exit();
    expect(view.calls).toEqual(["setViewport", "prepare", "enter", "pause", "resume", "pause"]);
    await scene.destroy();
  });

  it("宝箱 rejection 保持可见并释放 action latch，成功后下一帧隐藏", async () => {
    let resolveOpen: ((opened: boolean) => void) | null = null;
    let rejectOpen: ((reason: Error) => void) | null = null;
    let attempt = 0;
    const opens: string[] = [];
    const chestMap = map([{ kind: "chest", objectId: "chest-1", dropTableId: "drop", frameId: "object_chest_closed", position: { x: 16, y: 16 } }]);
    const { options, view, snapshots } = fullFieldOptions({
      map: chestMap,
      onOpenChest: () => {
        opens.push("open");
        attempt += 1;
        return new Promise<boolean>((resolve, reject) => {
          if (attempt === 1) rejectOpen = reject;
          else resolveOpen = resolve;
        });
      },
    });
    const scene = new ExplorationScene(options);
    await scene.prepare();
    scene.enter();
    snapshots.push({ frameNo: 1, move: { x: 0, y: 0 }, actions: ["interact"] });
    scene.fixedUpdate();
    snapshots.push({ frameNo: 2, move: { x: 0, y: 0 }, actions: ["interact"] });
    scene.fixedUpdate();
    expect(opens).toEqual(["open"]);
    (rejectOpen as ((reason: Error) => void) | null)?.(new Error("REWARD_REJECTED"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    snapshots.push({ frameNo: 3, move: { x: 0, y: 0 }, actions: ["interact"] });
    scene.fixedUpdate();
    expect(opens).toEqual(["open", "open"]);
    (resolveOpen as ((opened: boolean) => void) | null)?.(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    snapshots.push({ frameNo: 4, move: { x: 0, y: 0 }, actions: [] });
    scene.fixedUpdate();
    expect(scene.openedChestObjectIds).toEqual(["chest-1"]);
    expect(view.updatedFrames.at(-1)?.hiddenObjectIds).toEqual(["chest-1"]);
    await scene.destroy();
  });

  it("prepare 失败时先销毁已创建 view，再释放 lease，并允许 acquire 失败后重试", async () => {
    const events: string[] = [];
    const view = new FakeFieldView();
    view.prepareError = new Error("VIEW_PREPARE_FAILED");
    const { options } = fullFieldOptions({
      view,
      assetService: {
        acquire: async () => ({ ok: true as const, value: {
          release: async (releaseOptions?: { beforeUnload?: () => void }) => {
            releaseOptions?.beforeUnload?.();
            events.push("release");
          },
        } }),
      },
    });
    const originalDestroy = view.destroy.bind(view);
    view.destroy = () => { events.push("destroy"); originalDestroy(); };
    const scene = new ExplorationScene(options);
    await expect(scene.prepare()).rejects.toThrow("VIEW_PREPARE_FAILED");
    expect(events).toEqual(["destroy", "release"]);
    await scene.destroy();
  });

  it("同一实例 acquire 首次失败后，第二次 prepare 可成功并只建立一次 view", async () => {
    const acquire = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, error: new Error("ASSET_RETRY") })
      .mockResolvedValueOnce({ ok: true as const, value: { release: async () => undefined } });
    const { options, view } = fullFieldOptions({ assetService: { acquire } });
    const scene = new ExplorationScene(options);
    await expect(scene.prepare()).rejects.toThrow("ASSET_RETRY");
    expect(view.calls).toEqual([]);
    await scene.prepare();
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(view.calls).toEqual(["prepare"]);
    await scene.destroy();
  });

  it("release 首次 rejection 保留 lease，首次 destroy 失败后第二次 destroy 可重试且 view 只销毁一次", async () => {
    const events: string[] = [];
    let releaseCount = 0;
    const view = new FakeFieldView();
    const { options } = fullFieldOptions({
      view,
      assetService: {
        acquire: async () => ({ ok: true as const, value: {
          release: async (releaseOptions?: { beforeUnload?: () => void }) => {
            releaseCount += 1;
            if (releaseCount === 1) throw new Error("RELEASE_REJECTED");
            releaseOptions?.beforeUnload?.();
            events.push("release-success");
          },
        } }),
      },
    });
    const originalDestroy = view.destroy.bind(view);
    view.destroy = () => { events.push("destroy"); originalDestroy(); };
    const scene = new ExplorationScene(options);
    await scene.prepare();
    await expect(scene.destroy()).rejects.toThrow("RELEASE_REJECTED");
    expect(events).toEqual(["destroy"]);
    await scene.destroy();
    expect(releaseCount).toBe(2);
    expect(events).toEqual(["destroy", "release-success"]);
  });

  it("prepare 清理 release 失败不会遗失 lease，后续 destroy 能再次释放", async () => {
    let releaseCount = 0;
    const events: string[] = [];
    const view = new FakeFieldView();
    view.prepareError = new Error("VIEW_PREPARE_FAILED");
    const { options } = fullFieldOptions({
      view,
      assetService: {
        acquire: async () => ({ ok: true as const, value: {
          release: async (releaseOptions?: { beforeUnload?: () => void }) => {
            releaseCount += 1;
            if (releaseCount === 1) throw new Error("RELEASE_REJECTED");
            releaseOptions?.beforeUnload?.();
            events.push("release-success");
          },
        } }),
      },
    });
    const originalDestroy = view.destroy.bind(view);
    view.destroy = () => { events.push("destroy"); originalDestroy(); };
    const scene = new ExplorationScene(options);
    await expect(scene.prepare()).rejects.toThrow("VIEW_PREPARE_FAILED");
    await scene.destroy();
    expect(releaseCount).toBe(2);
    expect(events).toEqual(["destroy", "release-success"]);
  });

  it("destroy 请求会冻结输入并等待 deferred view.prepare，完成后不复活资源", async () => {
    let resolvePrepare: (() => void) | null = null;
    const events: string[] = [];
    const view = new FakeFieldView();
    view.prepareGate = new Promise<void>((resolve) => { resolvePrepare = resolve; });
    const { options } = fullFieldOptions({
      view,
      assetService: {
        acquire: async () => ({ ok: true as const, value: {
          release: async (releaseOptions?: { beforeUnload?: () => void }) => {
            releaseOptions?.beforeUnload?.();
            events.push("release");
          },
        } }),
      },
    });
    const originalDestroy = view.destroy.bind(view);
    view.destroy = () => { events.push("destroy"); originalDestroy(); };
    let enabled = true;
    (options.input as { setEnabled: (value: boolean) => void }).setEnabled = (value: boolean) => { enabled = value; };
    const scene = new ExplorationScene(options);
    const preparePromise = scene.prepare();
    await Promise.resolve();
    const destroyPromise = scene.destroy();
    expect(enabled).toBe(false);
    expect(() => scene.enter()).toThrow("EXPLORATION_SCENE_DESTROYED");
    expect(scene.fixedUpdate()).toBeNull();
    (resolvePrepare as (() => void) | null)?.();
    await expect(preparePromise).rejects.toThrow("EXPLORATION_SCENE_DESTROYED");
    await destroyPromise;
    expect(events).toEqual(["destroy", "release"]);
    expect(view.calls.filter((call) => call === "destroy")).toHaveLength(1);
  });

  it("shared lease 未触发 beforeUnload 时 finally 仍销毁 view，且无 lease 也销毁", async () => {
    const sharedEvents: string[] = [];
    const sharedView = new FakeFieldView();
    const shared = fullFieldOptions({
      view: sharedView,
      assetService: { acquire: async () => ({ ok: true as const, value: { release: async () => { sharedEvents.push("release"); } } }) },
    });
    const sharedDestroy = sharedView.destroy.bind(sharedView);
    sharedView.destroy = () => { sharedEvents.push("destroy"); sharedDestroy(); };
    const sharedScene = new ExplorationScene(shared.options);
    await sharedScene.prepare();
    await sharedScene.destroy();
    expect(sharedEvents).toEqual(["release", "destroy"]);

    const noLeaseEvents: string[] = [];
    const noLeaseView = new FakeFieldView();
    const noLease = fullFieldOptions({ view: noLeaseView });
    const noLeaseDestroy = noLeaseView.destroy.bind(noLeaseView);
    noLeaseView.destroy = () => { noLeaseEvents.push("destroy"); noLeaseDestroy(); };
    const noLeaseScene = new ExplorationScene(noLease.options);
    await noLeaseScene.prepare();
    await noLeaseScene.destroy();
    expect(noLeaseEvents).toEqual(["destroy"]);
  });
});
