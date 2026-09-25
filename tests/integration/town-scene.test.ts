import { describe, expect, it, vi } from "vitest";
import { calculateViewport } from "../../src/app/ViewportService";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { fixtureContentRoot } from "../../src/content/data";
import { abyssEchoContentRoot } from "../../src/content/data/abyssEchoes";
import { npcs } from "../../src/content/data/npcs";
import { townMap } from "../../src/content/data/maps/town";
import { CollisionGrid, FOOT_AABB_HEIGHT, FOOT_AABB_WIDTH } from "../../src/domain/exploration/CollisionGrid";
import type { InputSnapshot } from "../../src/app/input/InputState";
import type { GameSaveV1 } from "../../src/content/contracts";
import type { FieldHudStatus, FieldInputAction, FieldSceneFrame, FieldSceneView } from "../../src/scenes/exploration/FieldSceneView";
import type { InteractionTarget } from "../../src/scenes/exploration/InteractionSystem";
import { TownScene } from "../../src/scenes/town/TownScene";
import { TitleScene } from "../../src/scenes/title/TitleScene";

function input() {
  let enabled = false;
  return { value: { snapshot: () => Object.freeze({ frameNo: 1, move: { x: 0, y: 0 }, actions: [] }), setEnabled: (next: boolean) => { enabled = next; }, resetAll: vi.fn() }, get enabled() { return enabled; } };
}

function npcContent() {
  return { getNpc: (id: string) => { const value = npcs.find((npc) => npc.id === id); return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: id, issueKey: "missing" } } }; } };
}

function fieldInput(initial: InputSnapshot = Object.freeze({ frameNo: 1, move: { x: 0, y: 0 }, actions: [] })) {
  let current = initial;
  let enabled = false;
  const snapshots: InputSnapshot[] = [];
  const source = {
    snapshot: vi.fn(() => { snapshots.push(current); return current; }),
    setEnabled: vi.fn((value: boolean) => { enabled = value; }),
    resetAll: vi.fn(),
  };
  return {
    source,
    snapshots,
    setSnapshot(next: InputSnapshot) { current = next; },
    get enabled() { return enabled; },
  };
}

function fieldView() {
  const frames: FieldSceneFrame[] = [];
  const calls = { prepare: 0, enter: 0, update: 0, setViewport: 0, pause: 0, resume: 0, destroy: 0 };
  const view: FieldSceneView = {
    prepare: vi.fn((frame) => { calls.prepare += 1; frames.push(frame); }),
    enter: vi.fn((frame) => { calls.enter += 1; frames.push(frame); }),
    update: vi.fn((frame) => { calls.update += 1; frames.push(frame); }),
    setViewport: vi.fn(() => { calls.setViewport += 1; }),
    pause: vi.fn(() => { calls.pause += 1; }),
    resume: vi.fn((frame) => { calls.resume += 1; frames.push(frame); }),
    destroy: vi.fn(() => { calls.destroy += 1; }),
  };
  return { view, frames, calls };
}

function fieldHudStatus(): FieldHudStatus {
  return {
    sceneKind: "town",
    mapId: "map_town",
    mapDisplayName: "边境营地",
    partySlots: [
      { slot: 0, member: null },
      { slot: 1, member: null },
      { slot: 2, member: null },
      { slot: 3, member: null },
    ],
  };
}

function fieldOptions(overrides: Record<string, unknown> = {}) {
  const controls = fieldInput();
  const rendered = fieldView();
  const presentations = new Map(npcs.map((npc) => [npc.id, { spriteId: npc.spriteId, displayName: `NPC:${npc.id}` }]));
  const resources = {
    hasBundle: (id: string) => id === "town",
    hasAsset: (id: string) => id === "tileset_map_town",
    hasFieldSprite: (id: string) => id === "sprite_field_char_wanderer" || [...presentations.values()].some((value) => value.spriteId === id),
    hasCoreFrame: (id: string) => id === "object_portal_floor",
  };
  const options = {
    root: { parent: null },
    viewport: calculateViewport({ width: 568, height: 320 }),
    input: controls.source,
    npcContent: npcContent(),
    currentSave: () => createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z"),
    map: townMap,
    resources,
    tilesetAssetId: "tileset_map_town",
    playerFieldSpriteId: "sprite_field_char_wanderer",
    npcPresentation: (npcId: string) => presentations.get(npcId) ?? { spriteId: "", displayName: "" },
    view: rendered.view,
    getHudStatus: fieldHudStatus,
    ...overrides,
  };
  return { options, controls, rendered };
}

function isolatedTownMap(objects: typeof townMap.objects, spawnPoint: { x: number; y: number }) {
  return {
    ...townMap,
    spawnPoint,
    objects,
    collisionLayer: new Array(townMap.widthTiles * townMap.heightTiles).fill(0) as Array<0 | 1>,
  };
}

describe("RPG-019 town/title adapters", () => {
  it("未注入可视化 view 时保留旧 TitleScene 行为", async () => {
    const save = createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z");
    const music = vi.fn();
    const destination = vi.fn();
    const title = new TitleScene({
      root: { parent: null },
      audio: { setMusic: music },
      createNewGame: async () => ({ ok: true as const, value: save }),
      onDestination: destination,
    });

    await title.prepare();
    title.enter();
    title.requestNewGame();
    expect(title.isConfirmingNewGame).toBe(true);
    expect((await title.confirmNewGame()).ok).toBe(true);
    expect(music).toHaveBeenCalledWith("bgm_title", 10_000);
    expect(destination).toHaveBeenCalledWith({ kind: "town" }, save);
  });

  it("NPC 面板打开时冻结输入，关闭后恢复；锁定守望者不打开空白页", async () => {
    const save = createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z");
    const controls = input();
    const route = vi.fn();
    const scene = new TownScene({ root: { parent: null }, viewport: calculateViewport({ width: 568, height: 320 }), input: controls.value, npcContent: npcContent(), currentSave: () => save, onNpcRoute: route });
    await scene.prepare();
    scene.enter();
    const opened = await scene.interactNpc("npc_tavern_keeper");
    expect(opened.ok).toBe(true);
    expect(controls.enabled).toBe(false);
    expect(scene.dialogue.isOpen).toBe(true);
    expect(route).toHaveBeenCalledTimes(1);
    scene.closePanel();
    expect(controls.enabled).toBe(true);

    const locked = await scene.interactNpc("npc_abyss_watcher");
    expect(locked.ok).toBe(false);
    expect(scene.dialogue.state.kind).toBe("error");
  });

  it("离城保存失败不调用提交后回调，成功后才通知场景切换", async () => {
    const save = createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z");
    const controls = input();
    const committed = vi.fn();
    const floor = { id: "floor_01", nameKey: "floor.01.name", floorNumber: 1, mapId: "map_floor_01", bossEncounterId: "boss_floor_01", assetBundleId: "floor_01", minItemLevel: 1, maxItemLevel: 5, recommendedBossLevel: 3, recommendedItemLevel: 1, bossEnrageRound: 14, bossGateType: "tutorial" as const, bossPhaseThresholdBps: [], shortRouteObjectIds: [], isAbyss: false, firstClearRewardTableId: "drop_floor_01_first_clear" };
    const scene = new TownScene({ root: { parent: null }, viewport: calculateViewport({ width: 568, height: 320 }), input: controls.value, npcContent: npcContent(), currentSave: () => save, departure: { depart: vi.fn(async () => ({ ok: false as const, error: { code: "SAVE_FAILED" as const, details: { operation: "save" as const } } })) }, onDepartureCommitted: committed });
    await scene.prepare();
    scene.enter();
    const failed = await scene.depart({ floor, mode: "exploration" });
    expect(failed.ok).toBe(false);
    expect(committed).not.toHaveBeenCalled();

    const successScene = new TownScene({ root: { parent: null }, viewport: calculateViewport({ width: 568, height: 320 }), input: input().value, npcContent: npcContent(), currentSave: () => save, departure: { depart: vi.fn(async (_input, current) => ({ ok: true as const, value: structuredClone(current) })) }, onDepartureCommitted: committed });
    await successScene.prepare();
    successScene.enter();
    expect((await successScene.depart({ floor, mode: "exploration" })).ok).toBe(true);
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it("继续游戏按 battle/reward、远征模式和 COMPLETE cleanup 严格选择目的地", async () => {
    const save = createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z");
    const destinations: string[] = [];
    const title = new TitleScene({ root: { parent: null }, createNewGame: async () => ({ ok: true as const, value: save }), cleanupComplete: async () => ({ ok: true as const, value: save }), onDestination: (destination) => { destinations.push(destination.kind); } });
    await title.prepare();
    title.enter();
    const town = await title.continue(save);
    expect(town.ok).toBe(true);
    if (town.ok) expect(town.value).toEqual({ kind: "town" });
    save.expedition = { expeditionId: "exp", expeditionSeed: 1, mode: "shortFarm", abyssEchoId: null, floorId: "floor_01", mapId: "map_floor_01", playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: "2026-01-01T00:00:00.000Z" };
    const exploration = await title.continue(save);
    expect(exploration.ok).toBe(true);
    if (exploration.ok) expect(exploration.value).toEqual({ kind: "exploration", mode: "shortFarm", mapId: "map_floor_01" });
    expect(destinations).toEqual(["town", "exploration"]);
  });
});

describe("VIS-003 TownScene field runtime", () => {
  it("完整 field prepare 构造真实 town 的地图、九个 actor、相机和严格 HUD frame", async () => {
    const { options, rendered } = fieldOptions();
    const scene = new TownScene(options);

    await scene.prepare();

    expect(scene.mapView?.mapId).toBe("map_town");
    expect(scene.mapView?.widthTiles).toBe(80);
    expect(scene.mapView?.heightTiles).toBe(60);
    expect(scene.actorViews).toHaveLength(9);
    expect(scene.actorViews[0].resource).toEqual({ kind: "player", fieldSpriteId: "sprite_field_char_wanderer" });
    expect(scene.actorViews.slice(1, 8).map((actor) => actor.objectId)).toEqual(townMap.objects.filter((object) => object.kind === "npc").map((object) => object.objectId));
    expect(scene.actorViews.slice(1, 8).every((actor) => actor.displayName?.startsWith("NPC:"))).toBe(true);
    expect(scene.actorViews[8].resource).toEqual({ kind: "object", frameId: "object_portal_floor" });
    expect(scene.playerPosition).toEqual({ x: 640, y: 800 });
    expect(scene.cameraPosition).toEqual({ x: 320, y: 600, rootOffsetX: -320, rootOffsetY: -600 });
    expect(rendered.calls.prepare).toBe(1);
    expect(rendered.frames[0].animationStep).toBe(0);
    expect(rendered.frames[0].hiddenObjectIds).toEqual([]);
    expect(rendered.frames[0].hud.controls).toHaveLength(7);
    expect(rendered.frames[0].hudStatus.partySlots).toHaveLength(4);
    expect(Object.isFrozen(rendered.frames[0].hiddenObjectIds)).toBe(true);
  });

  it("field options 必须完整，失败后可修正资源并重试，legacy 仍保持旧路径", async () => {
    const { options } = fieldOptions({ map: undefined });
    const partial = new TownScene(options as never);
    await expect(partial.prepare()).rejects.toThrow("TOWN_FIELD_OPTIONS_INCOMPLETE");

    const callbackOnly = new TownScene({
      ...options,
      map: undefined,
      resources: undefined,
      tilesetAssetId: undefined,
      playerFieldSpriteId: undefined,
      npcPresentation: undefined,
      view: undefined,
      getHudStatus: undefined,
      onInteraction: vi.fn(),
    } as never);
    await expect(callbackOnly.prepare()).rejects.toThrow("TOWN_FIELD_OPTIONS_INCOMPLETE");

    const { options: retryOptions } = fieldOptions();
    const retryScene = new TownScene(retryOptions);
    await expect(retryScene.prepare()).resolves.toBeUndefined();

    const save = createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z");
    const legacy = new TownScene({ root: { parent: null }, viewport: calculateViewport({ width: 568, height: 320 }), input: input().value, npcContent: npcContent(), currentSave: () => save });
    await expect(legacy.prepare()).resolves.toBeUndefined();
  });

  it("并发 prepare 复用同一个 Promise，未完成前不能 enter，失败清理后可重试且不泄漏输入状态", async () => {
    const { options, controls, rendered } = fieldOptions();
    let releasePrepare!: () => void;
    const prepareGate = new Promise<void>((resolve) => { releasePrepare = resolve; });
    rendered.view.prepare = vi.fn(() => prepareGate);
    const scene = new TownScene(options);
    const first = scene.prepare();
    const second = scene.prepare();
    expect(second).toBe(first);
    expect(rendered.calls.prepare).toBe(0);
    expect(() => scene.enter()).toThrow("TOWN_SCENE_NOT_PREPARED");
    releasePrepare();
    await first;
    expect(rendered.view.prepare).toHaveBeenCalledTimes(1);
    scene.enter();
    expect(controls.enabled).toBe(true);

    const retry = fieldOptions();
    let fail = true;
    retry.rendered.view.prepare = vi.fn(async () => { if (fail) throw new Error("VIEW_PREPARE_FAILED"); });
    const retryScene = new TownScene(retry.options);
    await expect(retryScene.prepare()).rejects.toThrow("VIEW_PREPARE_FAILED");
    expect(retryScene.mapView).toBeNull();
    expect(retryScene.actorViews).toEqual([]);
    expect(retry.controls.enabled).toBe(false);
    fail = false;
    await expect(retryScene.prepare()).resolves.toBeUndefined();
    retryScene.enter();
    expect(retry.controls.enabled).toBe(true);
  });

  it("每个 fixed step 只 snapshot 一次，按既有移动/相机/交互/HUD 顺序更新一次 frame", async () => {
    const controls = fieldInput(Object.freeze({ frameNo: 7, move: { x: 1, y: 0 }, actions: [] }));
    const rendered = fieldView();
    const options = fieldOptions({ input: controls.source, view: rendered.view, getHudStatus: fieldHudStatus });
    const scene = new TownScene(options.options);
    await scene.prepare();
    scene.enter();
    scene.fixedUpdate();

    expect(controls.source.snapshot).toHaveBeenCalledTimes(1);
    expect(controls.snapshots).toHaveLength(1);
    expect(scene.playerPosition).toEqual({ x: 641.2, y: 800 });
    expect(scene.actorViews[0].position).toEqual({ x: 641.2, y: 800 });
    expect(scene.cameraPosition).toEqual({ x: 320, y: 600, rootOffsetX: -320, rootOffsetY: -600 });
    expect(rendered.calls.update).toBe(1);
    expect(rendered.frames.at(-1)?.animationStep).toBe(1);
    expect(rendered.frames.at(-1)?.interactionTarget).toBeNull();
  });

  it("沿用 CollisionGrid 阻挡地图边界与七个 blocking NPC，不复制碰撞公式", async () => {
    const wallControls = fieldInput(Object.freeze({ frameNo: 1, move: { x: -1, y: 0 }, actions: [] }));
    const wallMap = { ...townMap, spawnPoint: { x: 20, y: 16 } };
    const wallOptions = fieldOptions({ map: wallMap, input: wallControls.source });
    const wallScene = new TownScene(wallOptions.options);
    await wallScene.prepare();
    wallScene.enter();
    for (let step = 0; step < 10; step += 1) wallScene.fixedUpdate();
    expect(wallScene.playerPosition?.x).toBeGreaterThanOrEqual(16);

    const npcMap = { ...townMap, spawnPoint: { x: 976, y: 576 } };
    const npcControls = fieldInput(Object.freeze({ frameNo: 1, move: { x: 1, y: 0 }, actions: [] }));
    const npcScene = new TownScene(fieldOptions({ map: npcMap, input: npcControls.source }).options);
    await npcScene.prepare();
    npcScene.enter();
    for (let step = 0; step < 10; step += 1) npcScene.fixedUpdate();
    expect(npcScene.playerPosition?.x).toBeLessThanOrEqual(980);
  });

  it("相机沿用 dead-zone，越过死区后跟随并在 town 右下边界 clamp", async () => {
    const controls = fieldInput();
    const map = isolatedTownMap([], { x: 640, y: 800 });
    const scene = new TownScene(fieldOptions({ map, input: controls.source }).options);
    await scene.prepare();
    scene.enter();
    const initialCamera = scene.cameraPosition;

    // 1.2px 的首次移动仍在 96px dead-zone 内，相机不应抖动。
    controls.setSnapshot(Object.freeze({ frameNo: 2, move: { x: 1, y: 0 }, actions: [] }));
    scene.fixedUpdate();
    expect(scene.cameraPosition).toEqual(initialCamera);

    // 持续越过右侧 dead-zone 后，相机才开始跟随玩家。
    for (let step = 0; step < 80; step += 1) scene.fixedUpdate();
    expect(scene.cameraPosition?.x).toBeGreaterThan(initialCamera?.x ?? 0);

    // 继续向右下移动，最终相机位置由既有 CameraSystem clamp 到地图右下。
    controls.setSnapshot(Object.freeze({ frameNo: 3, move: { x: 1, y: 1 }, actions: [] }));
    for (let step = 0; step < 800; step += 1) scene.fixedUpdate();
    expect(scene.playerPosition?.x).toBeLessThan(1280);
    expect(scene.playerPosition?.y).toBeLessThan(960);
    expect(scene.cameraPosition?.x).toBe(640);
    expect(scene.cameraPosition?.y).toBe(600);
  });

  it("40px 交互边界选择 NPC/portal，interact 只 resolve 一次并冻结，关闭后 fresh resume", async () => {
    const controls = fieldInput(Object.freeze({ frameNo: 1, move: { x: 0, y: 0 }, actions: ["interact"] }));
    const rendered = fieldView();
    const route = vi.fn(async () => undefined);
    const options = fieldOptions({
      map: { ...townMap, spawnPoint: { x: 292, y: 320 } },
      input: controls.source,
      view: rendered.view,
      onNpcRoute: route,
    });
    const scene = new TownScene(options.options);
    await scene.prepare();
    scene.enter();
    scene.fixedUpdate();
    scene.fixedUpdate();
    await Promise.resolve();

    expect(controls.source.snapshot).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledTimes(1);
    expect(scene.dialogue.isOpen).toBe(true);
    expect(controls.enabled).toBe(false);
    expect(rendered.calls.pause).toBe(1);
    scene.closePanel();
    expect(controls.enabled).toBe(true);
    expect(rendered.calls.resume).toBe(1);
    expect(rendered.frames.at(-1)?.animationStep).toBe(1);
  });

  it("NPC presentation 每个 ID 在 prepare 只读取一次，actor 使用缓存的精确资源和名称", async () => {
    const calls = new Map<string, number>();
    const { options } = fieldOptions({
      npcPresentation: (npcId: string) => {
        calls.set(npcId, (calls.get(npcId) ?? 0) + 1);
        return { spriteId: `sprite_${npcId}`, displayName: `显示:${npcId}` };
      },
      resources: {
        hasBundle: () => true,
        hasAsset: () => true,
        hasFieldSprite: () => true,
        hasCoreFrame: () => true,
      },
    });
    const scene = new TownScene(options);
    await scene.prepare();
    expect([...calls.values()]).toEqual(new Array(7).fill(1));
    expect(scene.actorViews.slice(1, 8).map((actor) => actor.resourceId)).toEqual(townMap.objects.filter((object) => object.kind === "npc").map((object) => `sprite_${object.npcId}`));
    expect(scene.actorViews.slice(1, 8).map((actor) => actor.displayName)).toEqual(townMap.objects.filter((object) => object.kind === "npc").map((object) => `显示:${object.npcId}`));
  });

  it("七个 blocking NPC 均从脚底盒外持续逼近后被同一 CollisionGrid 阻挡", async () => {
    const blockingNpcs = townMap.objects.filter((object): object is Extract<typeof townMap.objects[number], { kind: "npc" }> => object.kind === "npc");
    expect(blockingNpcs).toHaveLength(7);
    for (const npc of blockingNpcs) {
      // 单独注入当前 NPC 与空碰撞层，确保测试路径不会先被其他 NPC 或墙截断。
      // 起点距脚底盒仍有 4px 间隙，连续 fixed step 才能证明实际阻挡而非静止 target。
      const start = { x: npc.position.x - FOOT_AABB_WIDTH - 4, y: npc.position.y };
      const map = isolatedTownMap([npc], start);
      const grid = new CollisionGrid(map);
      expect(grid.isWalkable(start, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)).toBe(true);
      const controls = fieldInput(Object.freeze({ frameNo: 1, move: { x: 1, y: 0 }, actions: [] }));
      const scene = new TownScene(fieldOptions({ map, input: controls.source }).options);
      await scene.prepare();
      scene.enter();
      const initial = scene.playerPosition!;
      for (let step = 0; step < 40; step += 1) scene.fixedUpdate();
      const final = scene.playerPosition!;

      expect(final.x).toBeGreaterThan(initial.x);
      // 触碰 NPC 的脚底盒边界只能相切，不能穿过进入盒内；若移除 blocking，断言会落到 NPC 右侧而失败。
      expect(final.x).toBeLessThanOrEqual(npc.position.x - FOOT_AABB_WIDTH + 1e-6);
      expect(grid.isWalkable(final, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)).toBe(true);

      // 对照向量：同一路径移除 blocking NPC 后必须穿过该位置，证明上面的边界断言确实由 NPC 阻挡提供。
      const unblockedScene = new TownScene(fieldOptions({
        map: isolatedTownMap([], start),
        input: fieldInput(Object.freeze({ frameNo: 1, move: { x: 1, y: 0 }, actions: [] })).source,
      }).options);
      await unblockedScene.prepare();
      unblockedScene.enter();
      for (let step = 0; step < 40; step += 1) unblockedScene.fixedUpdate();
      expect(unblockedScene.playerPosition!.x).toBeGreaterThan(npc.position.x - FOOT_AABB_WIDTH + 1e-6);
    }
  });

  it("NPC 与 portal 各自在 40px 正边界启用、41px 外部禁用，且不受其它对象抢占", async () => {
    const npc = townMap.objects.find((object): object is Extract<typeof townMap.objects[number], { kind: "npc" }> => object.kind === "npc");
    const portal = townMap.objects.find((object): object is Extract<typeof townMap.objects[number], { kind: "portal" }> => object.kind === "portal");
    if (!npc || !portal) throw new Error("town map 必须包含 NPC 与 portal");

    const checkBoundary = async (object: typeof npc | typeof portal, distance: number) => {
      const controls = fieldInput(Object.freeze({ frameNo: 1, move: { x: 0, y: 0 }, actions: [] }));
      const scene = new TownScene(fieldOptions({
        map: isolatedTownMap([object], { x: object.position.x - distance, y: object.position.y }),
        input: controls.source,
      }).options);
      await scene.prepare();
      scene.enter();
      scene.fixedUpdate();
      return scene.interactionTarget?.object.objectId ?? null;
    };

    await expect(checkBoundary(npc, 40)).resolves.toBe(npc.objectId);
    await expect(checkBoundary(npc, 41)).resolves.toBeNull();
    await expect(checkBoundary(portal, 40)).resolves.toBe(portal.objectId);
    await expect(checkBoundary(portal, 41)).resolves.toBeNull();
  });

  it("floor portal 触发独立 floorSelect panel，不离城、不改存档，并只调用 onInteraction 一次", async () => {
    const controls = fieldInput(Object.freeze({ frameNo: 1, move: { x: 0, y: 0 }, actions: ["interact"] }));
    const rendered = fieldView();
    const save = createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z");
    const interacted = vi.fn(async (_target: InteractionTarget) => { void _target; });
    const departure = vi.fn(async () => ({ ok: true as const, value: save }));
    const options = fieldOptions({
      map: { ...townMap, spawnPoint: { x: 612, y: 128 } },
      input: controls.source,
      view: rendered.view,
      currentSave: () => save,
      departure: { depart: departure },
      onInteraction: interacted,
    });
    const scene = new TownScene(options.options);
    await scene.prepare();
    scene.enter();
    scene.fixedUpdate();
    await Promise.resolve();

    expect(interacted).toHaveBeenCalledTimes(1);
    expect(interacted.mock.calls[0][0].action).toBe("openFloorSelect");
    expect(scene.activePanelKind).toBe("floorSelect");
    expect(controls.enabled).toBe(false);
    expect(rendered.calls.pause).toBe(1);
    expect(departure).not.toHaveBeenCalled();
    expect(save.expedition).toBeNull();
    scene.closePanel();
    expect(rendered.calls.resume).toBe(1);
  });

  it("同一 snapshot 的五个 action 按顺序最多转发一个，unknown 与 interaction token 被忽略", async () => {
    const controls = fieldInput(Object.freeze({ frameNo: 1, move: { x: 0, y: 0 }, actions: ["map", "inventory", "interaction", "unknown"] }));
    const forwarded: string[] = [];
    const scene = new TownScene(fieldOptions({ input: controls.source, onFieldAction: (action: Exclude<FieldInputAction, "interact">) => { forwarded.push(action); } }).options);
    await scene.prepare();
    scene.enter();
    scene.fixedUpdate();
    expect(forwarded).toEqual(["map"]);
    expect(controls.source.snapshot).toHaveBeenCalledTimes(1);
  });

  it("map/inventory/party/settings/menu 分别从同一个 snapshot 转发，异步回调拒绝不产生未处理错误", async () => {
    for (const action of ["map", "inventory", "party", "settings", "menu"] as const) {
      const controls = fieldInput(Object.freeze({ frameNo: 1, move: { x: 0, y: 0 }, actions: [action] }));
      const forwarded: string[] = [];
      const scene = new TownScene(fieldOptions({
        input: controls.source,
        onFieldAction: async (next: Exclude<FieldInputAction, "interact">) => {
          forwarded.push(next);
          throw new Error("route failed");
        },
      }).options);
      await scene.prepare();
      scene.enter();
      scene.fixedUpdate();
      await Promise.resolve();
      expect(forwarded).toEqual([action]);
      expect(controls.source.snapshot).toHaveBeenCalledTimes(1);
    }
  });

  it("NPC 异步 route pending/rejected 都只执行一次且保持冻结，关闭后可重试", async () => {
    const controls = fieldInput(Object.freeze({ frameNo: 1, move: { x: 0, y: 0 }, actions: ["interact"] }));
    const rendered = fieldView();
    let rejectRoute!: () => void;
    const route = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectRoute = reject; }));
    const scene = new TownScene(fieldOptions({
      map: { ...townMap, spawnPoint: { x: 292, y: 320 } },
      input: controls.source,
      view: rendered.view,
      onNpcRoute: route,
    }).options);
    await scene.prepare();
    scene.enter();
    scene.fixedUpdate();
    scene.fixedUpdate();
    expect(route).toHaveBeenCalledTimes(1);
    expect(controls.enabled).toBe(false);
    scene.resume();
    expect(controls.enabled).toBe(false);
    rejectRoute();
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.dialogue.state.kind).toBe("error");
    scene.closePanel();
    expect(controls.enabled).toBe(true);
    scene.fixedUpdate();
    expect(route).toHaveBeenCalledTimes(2);
  });

  it("生命周期与 viewport/view 调用幂等，panel 打开时 resume 不重新启用输入，destroy 不重复销毁", async () => {
    const controls = fieldInput();
    const rendered = fieldView();
    const scene = new TownScene(fieldOptions({ input: controls.source, view: rendered.view }).options);
    await scene.prepare();
    await scene.prepare();
    scene.enter();
    scene.enter();
    scene.pause();
    scene.pause();
    expect(controls.source.resetAll).toHaveBeenCalledTimes(1);
    expect(rendered.calls.pause).toBe(1);
    scene.resume();
    scene.resume();
    expect(rendered.calls.resume).toBe(1);
    scene.setViewport(calculateViewport({ width: 844, height: 390 }));
    expect(rendered.calls.setViewport).toBe(1);
    await scene.destroy();
    await scene.destroy();
    expect(rendered.calls.destroy).toBe(1);
    expect(controls.enabled).toBe(false);
  });

  it("缺资源、空 NPC 展示名与 town 非法对象在 visible entry 前显式失败", async () => {
    await expect(new TownScene(fieldOptions({ resources: { hasBundle: () => false, hasAsset: () => true, hasFieldSprite: () => true, hasCoreFrame: () => true } }).options).prepare()).rejects.toThrow("ASSET_BUNDLE_MISSING:town");
    await expect(new TownScene(fieldOptions({ npcPresentation: () => ({ spriteId: "sprite_npc", displayName: " " }) }).options).prepare()).rejects.toThrow("TOWN_NPC_PRESENTATION_INVALID");
    const unsupportedMap = { ...townMap, objects: [...townMap.objects, { kind: "chest", objectId: "obj_bad_chest", position: { x: 1, y: 1 }, dropTableId: "drop_floor_01_normal", frameId: "object_chest_closed" }] };
    await expect(new TownScene(fieldOptions({ map: unsupportedMap as never }).options).prepare()).rejects.toThrow("TOWN_MAP_OBJECT_UNSUPPORTED:obj_bad_chest/chest");
  });

  it("tileset、player、NPC 和 portal frame 资源逐项缺失时分别在 prepare 阻断", async () => {
    const base = fieldOptions().options;
    await expect(new TownScene({ ...base, resources: { ...base.resources, hasAsset: () => false } }).prepare()).rejects.toThrow("ASSET_MISSING:tileset_map_town");
    await expect(new TownScene({ ...base, resources: { ...base.resources, hasFieldSprite: (id: string) => id !== "sprite_field_char_wanderer" } }).prepare()).rejects.toThrow("ASSET_FIELD_SPRITE_MISSING:sprite_field_char_wanderer");
    await expect(new TownScene({ ...base, resources: { ...base.resources, hasFieldSprite: (id: string) => id === "sprite_field_char_wanderer" } }).prepare()).rejects.toThrow("ASSET_FIELD_SPRITE_MISSING");
    await expect(new TownScene({ ...base, resources: { ...base.resources, hasCoreFrame: () => false } }).prepare()).rejects.toThrow("ASSET_FRAME_MISSING:object_portal_floor");
  });

  it("地图学家面板可原地切换 floorSelect，面板内合法 departure 不被 panelOpen 拒绝", async () => {
    const save = createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z");
    const floor = abyssEchoContentRoot.floors.find((candidate) => candidate.id === "floor_01");
    if (!floor) throw new Error("测试内容缺少 floor_01");
    const controls = input();
    const departure = vi.fn(async (_input: unknown, current: GameSaveV1) => ({ ok: true as const, value: structuredClone(current) }));
    const scene = new TownScene({
      root: { parent: null },
      viewport: calculateViewport({ width: 568, height: 320 }),
      input: controls.value,
      npcContent: npcContent(),
      currentSave: () => save,
      floors: [floor],
      departure: { depart: departure },
    });
    await scene.prepare();
    scene.enter();
    expect((await scene.interactNpc("npc_cartographer")).ok).toBe(true);
    expect(scene.openFloorSelectFromPanel()).toBe(true);
    expect(scene.activePanelKind).toBe("floorSelect");
    expect((await scene.departFromFloorPanel("floor_01", "exploration")).ok).toBe(true);
    expect(departure).toHaveBeenCalledTimes(1);
  });

  it("锁定 NPC 只通过一次错误回调投影锁定面板，不要求 GameFlow 二次 resolve", async () => {
    const errors: string[] = [];
    const scene = new TownScene({
      root: { parent: null },
      viewport: calculateViewport({ width: 568, height: 320 }),
      input: input().value,
      npcContent: npcContent(),
      currentSave: () => createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z"),
      onNpcError: (npcId, error) => { errors.push(`${npcId}:${error.code}`); },
    });
    await scene.prepare();
    scene.enter();
    const result = await scene.interactNpc("npc_abyss_watcher");
    expect(result.ok).toBe(false);
    expect(errors).toEqual(["npc_abyss_watcher:NPC_LOCKED"]);
    expect(scene.dialogue.isOpen).toBe(true);
    expect(scene.dialogue.state.kind).toBe("error");
  });
});
