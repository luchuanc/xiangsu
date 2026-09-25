import { describe, expect, it, vi } from "vitest";

// PixiJS 的正式显示对象在 Node 中只需要一个最小 navigator；纹理和 Spritesheet 仍然使用 Pixi 真实实例。
vi.hoisted(() => {
  vi.stubGlobal("navigator", {});
});

import { Container, Spritesheet, Texture, type FederatedPointerEvent } from "pixi.js";
import type { MapDefinition } from "../../src/content/contracts";
import { calculateCameraPosition } from "../../src/domain/exploration/CameraSystem";
import { InputState } from "../../src/app/input/InputState";
import { createPixiSceneRoot } from "../../src/app/PixiSceneRoot";
import { calculateViewport } from "../../src/app/ViewportService";
import { ActorView } from "../../src/scenes/exploration/ActorView";
import { ExplorationHud, type ExplorationHudLayout } from "../../src/scenes/exploration/ExplorationHud";
import { TileMapView } from "../../src/scenes/exploration/TileMapView";
import { FieldSceneRenderer } from "../../src/ui/rendering/FieldSceneRenderer";
import type { PixiRenderAssetSource } from "../../src/ui/rendering/PixiAssetResolver";
import type { AssetEntryV1, FieldActorClipsV1 } from "../../src/content/data/assets.manifest";
import type { FieldSceneFrame } from "../../src/scenes/exploration/FieldSceneView";

const source = {
  sourceKind: "generated" as const,
  sourceNote: "renderer test",
  licenseId: "test",
};

const clips: FieldActorClipsV1 = {
  down: { row: 0, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
  left: { row: 1, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
  right: { row: 2, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
  up: { row: 3, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
};

const tileEntry: AssetEntryV1 = {
  kind: "mapTileset",
  id: "tileset_test",
  bundleId: "map_test",
  src: "/tileset.png",
  tileSize: 16,
  columns: 2,
  rows: 2,
  source,
};

function fieldEntry(id: string): AssetEntryV1 {
  return {
    kind: "fieldActorSheet",
    id,
    bundleId: "actors",
    src: `/${id}.png`,
    frameWidth: 24,
    frameHeight: 32,
    columns: 10,
    rows: 4,
    clips,
    source,
  };
}

function objectSheet(): Spritesheet {
  const sheet = new Spritesheet(Texture.WHITE, {
    frames: {
      object_chest_closed: { frame: { x: 0, y: 0, w: 16, h: 16 } },
    },
    meta: { scale: 1 },
  });
  sheet.parseSync();
  return sheet;
}

const atlasEntry: AssetEntryV1 = {
  kind: "atlas",
  id: "atlas_objects",
  bundleId: "core",
  imageSrc: "/objects.png",
  dataSrc: "/objects.json",
  requiredFrames: ["object_chest_closed"],
  source,
};

function mapDefinition(overrides: Partial<MapDefinition> = {}): MapDefinition {
  return {
    id: "map_test",
    nameKey: "map.test",
    widthTiles: 2,
    heightTiles: 2,
    tileSize: 16,
    assetBundleId: "map_test",
    spawnPoint: { x: 16, y: 16 },
    groundLayer: [0, 1, 0, 1],
    decorBackLayer: [0, 1, 0, 0],
    decorFrontLayer: [1, 0, 0, 0],
    collisionLayer: [0, 0, 0, 0],
    objects: [],
    ...overrides,
  };
}

function makeAssets(tileTexture: Texture, actorTexture: Texture, objectFrame: Texture): PixiRenderAssetSource {
  const entries = new Map<string, AssetEntryV1>([
    [tileEntry.id, tileEntry],
    ["sprite_player", fieldEntry("sprite_player")],
    ["sprite_npc", fieldEntry("sprite_npc")],
    ["sprite_encounter", fieldEntry("sprite_encounter")],
    [atlasEntry.id, atlasEntry],
  ]);
  return {
    requireEntry: (assetId) => {
      const entry = entries.get(assetId);
      if (!entry) throw new Error(`missing:${assetId}`);
      return entry;
    },
    requireTexture: (assetId) => assetId === tileEntry.id ? tileTexture : actorTexture,
    requireAtlasFrame: (atlasId, frameId) => {
      if (atlasId !== atlasEntry.id || frameId !== "object_chest_closed") throw new Error("unexpected frame");
      return objectFrame;
    },
  };
}

function makeActor(
  objectId: string,
  resource: ConstructorParameters<typeof ActorView>[0]["resource"],
  position: { x: number; y: number },
  displayName?: string,
): ActorView {
  return new ActorView({
    objectId,
    resource,
    ...(displayName === undefined ? {} : { displayName }),
    resources: { hasFieldSprite: () => true, hasCoreFrame: () => true },
    position,
  });
}

function makeFrame(
  map: MapDefinition,
  actors: readonly ActorView[],
  inputHud: ExplorationHud,
  overrides: Partial<FieldSceneFrame> = {},
): FieldSceneFrame {
  return {
    map: new TileMapView({
      map,
      tilesetAssetId: "tileset_test",
      resources: { hasBundle: () => true, hasAsset: () => true },
    }),
    actors,
    camera: calculateCameraPosition({ x: 16, y: 16 }, map),
    hud: inputHud.getLayout(),
    hudStatus: {
      sceneKind: "town",
      mapId: map.id,
      mapDisplayName: "星火镇",
      partySlots: [
        { slot: 0, member: { characterId: "char_wanderer", displayName: "流浪者", currentHp: 80, maxHp: 100 } },
        { slot: 1, member: null },
        { slot: 2, member: { characterId: "char_guard", displayName: "铁卫", currentHp: 140, maxHp: 120 } },
        { slot: 3, member: { characterId: "char_zero", displayName: "倒下者", currentHp: 0, maxHp: 100 } },
      ],
    },
    interactionTarget: null,
    hiddenObjectIds: [],
    animationStep: 0,
    ...overrides,
  };
}

function textValues(node: Container): string[] {
  const values: string[] = [];
  for (const child of node.children) {
    const candidate = child as Container & { text?: unknown };
    if (typeof candidate.text === "string") values.push(candidate.text);
    if (candidate.children.length > 0) values.push(...textValues(candidate));
  }
  return values;
}

function pointerEvent(value: Record<string, unknown>): FederatedPointerEvent {
  return value as unknown as FederatedPointerEvent;
}

function compactHudLayout(safeRect: ReturnType<typeof calculateViewport>["safeRect"]): ExplorationHudLayout {
  const controls = [
    { id: "map" as const, x: 0, y: 0, width: 40, height: 40, interactive: true },
    { id: "inventory" as const, x: 48, y: 0, width: 40, height: 40, interactive: true },
    { id: "party" as const, x: 96, y: 0, width: 40, height: 40, interactive: true },
    { id: "settings" as const, x: 144, y: 0, width: 40, height: 40, interactive: true },
    { id: "joystick" as const, x: 0, y: 220, width: 104, height: 104, interactive: true },
    { id: "interaction" as const, x: 480, y: 260, width: 40, height: 40, interactive: true },
    { id: "menu" as const, x: 432, y: 260, width: 40, height: 40, interactive: true },
  ];
  return Object.freeze({ safeRect, controls: Object.freeze(controls) });
}

describe("FieldSceneRenderer", () => {
  it("按 0-based ground/decor 索引渲染到精确根层并拒绝越界", () => {
    const root = createPixiSceneRoot();
    const tileTexture = new Texture({ source: Texture.WHITE.source });
    const assets = makeAssets(tileTexture, Texture.WHITE, Texture.WHITE);
    const input = new InputState();
    const hud = new ExplorationHud(calculateViewport({ width: 640, height: 360 }).safeRect);
    const renderer = new FieldSceneRenderer({ root, assets, objectAtlasId: "atlas_objects", inputState: input, viewport: calculateViewport({ width: 640, height: 360 }) });
    const frame = makeFrame(mapDefinition(), [], hud);

    renderer.prepare(frame);
    renderer.enter(frame);

    expect(root.mapBack.children).toHaveLength(5);
    expect(root.mapFront.children).toHaveLength(1);
    expect(root.actors.children).toHaveLength(0);
    expect(root.mapBack.children.every((child) => child.parent === root.mapBack)).toBe(true);
    expect(((root.mapBack.children[0] as unknown) as { texture: Texture }).texture.frame.x).toBe(0);
    expect(((root.mapBack.children[1] as unknown) as { texture: Texture }).texture.frame.x).toBe(16);
    expect(((root.mapBack.children[4] as unknown) as { texture: Texture }).texture.frame.x).toBe(0);
    const derivedTile = ((root.mapBack.children[0] as unknown) as { texture: Texture }).texture;

    const invalidMap = mapDefinition({ groundLayer: [0, 4, 0, 0] });
    const invalidFrame = makeFrame(invalidMap, [], hud);
    const invalidRenderer = new FieldSceneRenderer({ root: createPixiSceneRoot(), assets, objectAtlasId: "atlas_objects", inputState: new InputState(), viewport: calculateViewport({ width: 640, height: 360 }) });
    expect(() => invalidRenderer.prepare(invalidFrame)).toThrow("PIXEL_TILE_INDEX_OUT_OF_RANGE:map_test/ground/1/4");
    renderer.destroy();
    expect(derivedTile.destroyed).toBe(true);
    expect(tileTexture.destroyed).toBe(false);
    invalidRenderer.destroy();
  });

  it("严格 dispatch 角色资源、脚锚点/排序/动画、对象 atlas 与隐藏对象", () => {
    const root = createPixiSceneRoot();
    const sourceTexture = new Texture({ source: Texture.WHITE.source });
    const objectFrame = objectSheet().textures.object_chest_closed;
    const assets = makeAssets(sourceTexture, sourceTexture, objectFrame);
    const input = new InputState();
    const hud = new ExplorationHud(calculateViewport({ width: 640, height: 360 }).safeRect);
    const actors = [
      makeActor("player", { kind: "player", fieldSpriteId: "sprite_player" }, { x: 16, y: 32 }, "主角"),
      makeActor("npc", { kind: "npc", spriteId: "sprite_npc" }, { x: 32, y: 48 }, "  铁匠  "),
      makeActor("encounter", { kind: "encounter", fieldSpriteId: "sprite_encounter" }, { x: 48, y: 64 }),
      makeActor("object", { kind: "object", frameId: "object_chest_closed" }, { x: 64, y: 80 }),
    ];
    const viewport = calculateViewport({ width: 640, height: 360 });
    const renderer = new FieldSceneRenderer({ root, assets, objectAtlasId: "atlas_objects", inputState: input, viewport });
    const frame = makeFrame(mapDefinition(), actors, hud, {
      camera: { x: 11, y: 13, rootOffsetX: -11, rootOffsetY: -13 },
      hiddenObjectIds: ["object"],
      animationStep: 12,
    });
    renderer.prepare(frame);
    renderer.enter(frame);

    expect(root.mapBack.x).toBe(-11);
    expect(root.actors.x).toBe(-11);
    expect(root.mapFront.x).toBe(-11);
    expect(root.worldFx.x).toBe(-11);
    expect(root.hud.x).toBe(0);
    expect(root.actors.children).toHaveLength(3);
    const playerSprite = renderer.actorSprites.get("player");
    expect(playerSprite).toBeDefined();
    if (!playerSprite) throw new Error("player sprite missing");
    const playerFrameTexture = playerSprite.texture;
    const playerGroup = playerSprite?.parent as unknown as { x: number; y: number; zIndex: number };
    expect(playerSprite.anchor.x).toBe(12 / 24);
    expect(playerSprite.anchor.y).toBe(28 / 32);
    expect(playerGroup.x).toBe(16);
    expect(playerGroup.y).toBe(32);
    expect(playerGroup.zIndex).toBe(32);
    expect(playerSprite.texture.frame.x).toBe(24);
    expect(playerSprite.texture.frame.y).toBe(0);
    expect(textValues(root.actors)).toContain("铁匠");

    const nextActors = actors.map((actor) => actor.objectId === "player" ? (() => { actor.setPosition({ x: 30, y: 40 }); return actor; })() : actor);
    renderer.update(makeFrame(mapDefinition(), nextActors, hud, { animationStep: 60 }));
    const movedSprite = renderer.actorSprites.get("player");
    expect(movedSprite).toBeDefined();
    expect(movedSprite?.texture.frame.y).toBe(64);
    renderer.update(makeFrame(mapDefinition(), actors, hud, { animationStep: 61, hiddenObjectIds: [] }));
    expect(root.actors.children.length).toBeGreaterThanOrEqual(4);
    expect(renderer.actorSprites.get("player")?.texture.frame.y).toBe(64);
    expect(renderer.actorSprites.get("player")?.texture.frame.x).toBe(48);
    expect((root.actors.children.find((child) => (child as { children?: unknown[] }).children?.some((nested) => (nested as { text?: string }).text === "铁匠")) as unknown as { children: Array<{ text?: string }> }).children.some((child) => child.text === "铁匠")).toBe(true);
    expect(renderer.actorSprites.get("object")?.texture).toBe(objectFrame);
    const renamedPlayer = makeActor("player", { kind: "player", fieldSpriteId: "sprite_player" }, { x: 30, y: 40 }, "新称号");
    const tieActor = makeActor("tie", { kind: "player", fieldSpriteId: "sprite_player" }, { x: 100, y: 100 });
    renderer.update(makeFrame(mapDefinition(), [renamedPlayer, actors[1], actors[2], actors[3], tieActor], hud, { animationStep: 62, hiddenObjectIds: [] }));
    expect(textValues(root.actors)).toContain("新称号");
    const tieMoved = makeActor("tie", { kind: "player", fieldSpriteId: "sprite_player" }, { x: 110, y: 110 });
    renderer.update(makeFrame(mapDefinition(), [renamedPlayer, actors[1], actors[2], actors[3], tieMoved], hud, { animationStep: 63, hiddenObjectIds: [] }));
    expect(renderer.actorSprites.get("tie")?.texture.frame.y).toBe(0);
    renderer.destroy();
    expect(objectFrame.destroyed).toBe(false);
    expect(playerFrameTexture.destroyed).toBe(true);
    expect(root.mapBack.children).toHaveLength(0);
    expect(root.mapFront.children).toHaveLength(0);
    expect(root.actors.children).toHaveLength(0);
    expect(root.worldFx.children).toHaveLength(0);
  });

  it("渲染地图名、四个稳定队伍槽位和 clamp 后的血条，不改变投影", () => {
    const root = createPixiSceneRoot();
    const input = new InputState();
    const viewport = calculateViewport({ width: 640, height: 360 });
    const hud = new ExplorationHud(viewport.safeRect);
    const renderer = new FieldSceneRenderer({ root, assets: makeAssets(Texture.WHITE, Texture.WHITE, Texture.WHITE), objectAtlasId: "atlas_objects", inputState: input, viewport });
    const frame = makeFrame(mapDefinition(), [], hud);
    renderer.prepare(frame);
    renderer.enter(frame);
    const before = JSON.stringify(frame.hudStatus);
    const labels = textValues(root.hud);
    expect(labels).toEqual(expect.arrayContaining(["星火镇", "流浪者", "空槽", "铁卫", "倒下者", "地图", "背包", "队伍", "设置", "交互", "菜单"]));
    expect(root.hud.children.length).toBeGreaterThan(0);
    expect(renderer.hudRenderer.layer.children[0]).toBe(renderer.hudRenderer.statusPanel);
    expect(renderer.hudRenderer.layer.children[1]).toBe(renderer.hudRenderer.mapNameText);
    expect(renderer.hudRenderer.layer.children.slice(2, 6)).toEqual([...renderer.hudRenderer.partyRowDisplays]);
    expect(renderer.hudRenderer.statusPanel.visible).toBe(true);
    expect(renderer.hudRenderer.partyBarFractions).toEqual([0.8, 0, 1, 0]);
    expect(renderer.hudRenderer.partyBarWidths).toEqual([67, 0, 84, 0]);
    renderer.update(frame);
    expect(JSON.stringify(frame.hudStatus)).toBe(before);

    const insetViewport = calculateViewport({ width: 640, height: 360 }, { top: 4, right: 32, bottom: 12, left: 24 });
    const insetHud = new ExplorationHud(insetViewport.safeRect);
    insetHud.setViewport(insetViewport);
    renderer.setViewport(insetViewport);
    renderer.update(makeFrame(mapDefinition(), [], insetHud, { camera: { x: 0, y: 0, rootOffsetX: 0, rootOffsetY: 0 } }));
    expect(renderer.hudRenderer.statusPanel.x).toBe(Math.round(insetViewport.safeRect.x + 8));
    expect(renderer.hudRenderer.statusPanel.y).toBe(Math.round(insetViewport.safeRect.y + 8));
    expect(renderer.hudRenderer.mapNameText.x).toBe(Math.round(insetViewport.safeRect.x + 16));
    renderer.destroy();
  });

  it("所有按钮和摇杆写入同一 InputState，并在禁用/暂停/销毁时清理指针", () => {
    const root = createPixiSceneRoot();
    const input = new InputState();
    const viewport = calculateViewport({ width: 568, height: 320 });
    const hud = new ExplorationHud(viewport.safeRect);
    hud.setInteractionEnabled(true);
    const renderer = new FieldSceneRenderer({ root, assets: makeAssets(Texture.WHITE, Texture.WHITE, Texture.WHITE), objectAtlasId: "atlas_objects", inputState: input, viewport });
    const frame = makeFrame(mapDefinition(), [], hud, { interactionTarget: { object: { kind: "npc", objectId: "npc", npcId: "npc", position: { x: 0, y: 0 }, blocking: true }, action: "talk", distanceSquared: 0 } });
    renderer.prepare(frame);
    renderer.enter(frame);

    renderer.hudRenderer.joystickDisplay.emit("pointerdown", pointerEvent({ pointerId: 1, global: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    renderer.hudRenderer.joystickDisplay.emit("globalpointermove", pointerEvent({ pointerId: 1, global: { x: 68, y: 20 }, preventDefault: vi.fn() }));
    expect(input.snapshot().move.x).toBeGreaterThan(0);
    renderer.hudRenderer.joystickDisplay.emit("pointerout", pointerEvent({ pointerId: 1, global: { x: 200, y: 20 }, preventDefault: vi.fn() }));
    expect(input.activePointerCount).toBe(0);

    renderer.hudRenderer.buttonDisplays.get("map")?.emit("pointerdown", pointerEvent({ pointerId: 2, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    renderer.hudRenderer.buttonDisplays.get("map")?.emit("pointerup", pointerEvent({ pointerId: 2, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    expect(input.snapshot().actions).toEqual(["map"]);
    for (const [pointerId, id] of [
      [3, "inventory"], [4, "party"], [5, "settings"], [6, "interaction"], [7, "menu"],
    ] as const) {
      renderer.hudRenderer.buttonDisplays.get(id)?.emit("pointerdown", pointerEvent({ pointerId, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
      renderer.hudRenderer.buttonDisplays.get(id)?.emit("pointerup", pointerEvent({ pointerId, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
      expect(input.snapshot().actions).toEqual([id === "interaction" ? "interact" : id]);
    }

    renderer.update(makeFrame(mapDefinition(), [], hud, { interactionTarget: null }));
    renderer.hudRenderer.buttonDisplays.get("interaction")?.emit("pointerdown", pointerEvent({ pointerId: 8, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    renderer.hudRenderer.buttonDisplays.get("interaction")?.emit("pointerup", pointerEvent({ pointerId: 8, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    expect(input.snapshot().actions).toEqual([]);

    renderer.update(frame);
    renderer.hudRenderer.buttonDisplays.get("menu")?.emit("pointerdown", pointerEvent({ pointerId: 9, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    renderer.hudRenderer.buttonDisplays.get("menu")?.emit("pointercancel", pointerEvent({ pointerId: 9, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    expect(input.activePointerCount).toBe(0);
    expect(input.snapshot().actions).toEqual([]);
    renderer.hudRenderer.buttonDisplays.get("menu")?.emit("pointerdown", pointerEvent({ pointerId: 10, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    renderer.hudRenderer.buttonDisplays.get("menu")?.emit("pointerupoutside", pointerEvent({ pointerId: 10, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    expect(input.activePointerCount).toBe(0);
    expect(input.snapshot().actions).toEqual([]);
    renderer.hudRenderer.buttonDisplays.get("menu")?.emit("pointerdown", pointerEvent({ pointerId: 11, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    renderer.hudRenderer.buttonDisplays.get("menu")?.emit("pointerout", pointerEvent({ pointerId: 11, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    expect(input.activePointerCount).toBe(0);
    expect(input.snapshot().actions).toEqual([]);

    const menuDisplayBeforeDestroy = renderer.hudRenderer.buttonDisplays.get("menu");
    renderer.pause();
    renderer.hudRenderer.buttonDisplays.get("menu")?.emit("pointerdown", pointerEvent({ pointerId: 4, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    expect(input.activePointerCount).toBe(0);
    renderer.destroy();
    renderer.destroy();
    expect(root.hud.children).toHaveLength(0);
    menuDisplayBeforeDestroy?.emit("pointerdown", pointerEvent({ pointerId: 12, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    expect(input.activePointerCount).toBe(0);
    expect(input.snapshot().actions).toEqual([]);
  });

  it("prepare 只建一次地图，resume 完整刷新，来源纹理不由 renderer 销毁", () => {
    const root = createPixiSceneRoot();
    const tileTexture = new Texture({ source: Texture.WHITE.source });
    const renderer = new FieldSceneRenderer({ root, assets: makeAssets(tileTexture, Texture.WHITE, Texture.WHITE), objectAtlasId: "atlas_objects", inputState: new InputState(), viewport: calculateViewport({ width: 640, height: 360 }) });
    const hud = new ExplorationHud(calculateViewport({ width: 640, height: 360 }).safeRect);
    const frame = makeFrame(mapDefinition(), [], hud);
    renderer.prepare(frame);
    const firstChildren = [...root.mapBack.children];
    renderer.prepare(frame);
    expect(root.mapBack.children).toEqual(firstChildren);
    renderer.update(frame);
    expect(root.mapBack.children).toEqual(firstChildren);
    renderer.pause();
    renderer.resume(frame);
    expect(root.mapBack.children).toEqual(firstChildren);
    renderer.destroy();
    expect(tileTexture.destroyed).toBe(false);
  });

  it("setViewport 在相同布局下按新 scale 重建命中几何并清空活动指针", () => {
    const root = createPixiSceneRoot();
    const input = new InputState();
    const initialViewport = calculateViewport({ width: 640, height: 360 });
    const hud = new ExplorationHud(initialViewport.safeRect);
    const renderer = new FieldSceneRenderer({
      root,
      assets: makeAssets(Texture.WHITE, Texture.WHITE, Texture.WHITE),
      objectAtlasId: "atlas_objects",
      inputState: input,
      viewport: initialViewport,
    });
    const frame = makeFrame(mapDefinition(), [], hud, { hud: compactHudLayout(initialViewport.safeRect) });
    renderer.prepare(frame);
    renderer.enter(frame);
    const firstButton = renderer.hudRenderer.buttons.get("map");
    const firstDisplay = renderer.hudRenderer.buttonDisplays.get("map");
    if (!firstButton || !firstDisplay) throw new Error("map control missing");
    expect(firstButton.hitArea.width).toBe(48);
    firstDisplay.emit("pointerdown", pointerEvent({ pointerId: 99, client: { x: 2, y: 2 }, preventDefault: vi.fn() }));
    expect(input.activePointerCount).toBe(1);

    const largerViewport = calculateViewport({ width: 900, height: 700 });
    renderer.setViewport(largerViewport);
    renderer.update(frame);
    const secondButton = renderer.hudRenderer.buttons.get("map");
    if (!secondButton) throw new Error("recreated map control missing");
    expect(secondButton).not.toBe(firstButton);
    expect(secondButton.hitArea.width).toBe(40);
    expect(input.activePointerCount).toBe(0);
    renderer.destroy();
  });

  it("拒绝角色字段资源的错误 entry kind 和缺失 entry", () => {
    const mapValue = mapDefinition();
    const viewport = calculateViewport({ width: 640, height: 360 });
    const hud = new ExplorationHud(viewport.safeRect);
    const npc = makeActor("npc", { kind: "npc", spriteId: "sprite_npc" }, { x: 16, y: 16 }, "铁匠");
    const baseAssets = makeAssets(Texture.WHITE, Texture.WHITE, Texture.WHITE);
    const wrongKindAssets: PixiRenderAssetSource = {
      ...baseAssets,
      requireEntry: (assetId) => assetId === "sprite_npc" ? atlasEntry : baseAssets.requireEntry(assetId),
    };
    const wrongKindRenderer = new FieldSceneRenderer({
      root: createPixiSceneRoot(),
      assets: wrongKindAssets,
      objectAtlasId: "atlas_objects",
      inputState: new InputState(),
      viewport,
    });
    expect(() => wrongKindRenderer.prepare(makeFrame(mapValue, [npc], hud))).toThrow("PIXEL_FIELD_ACTOR_ENTRY_KIND_INVALID:sprite_npc");
    wrongKindRenderer.destroy();

    const missingAssets: PixiRenderAssetSource = {
      ...baseAssets,
      requireEntry: (assetId) => {
        if (assetId === "sprite_npc") throw new Error("PIXEL_ASSET_ENTRY_MISSING:sprite_npc");
        return baseAssets.requireEntry(assetId);
      },
    };
    const missingRenderer = new FieldSceneRenderer({
      root: createPixiSceneRoot(),
      assets: missingAssets,
      objectAtlasId: "atlas_objects",
      inputState: new InputState(),
      viewport,
    });
    expect(() => missingRenderer.prepare(makeFrame(mapValue, [npc], hud))).toThrow("PIXEL_ASSET_ENTRY_MISSING:sprite_npc");
    missingRenderer.destroy();
  });

  it("为摇杆拇指和按钮按压态提供独立视觉反馈且不移动命中矩形", () => {
    const root = createPixiSceneRoot();
    const input = new InputState();
    const viewport = calculateViewport({ width: 568, height: 320 });
    const hud = new ExplorationHud(viewport.safeRect);
    const renderer = new FieldSceneRenderer({
      root,
      assets: makeAssets(Texture.WHITE, Texture.WHITE, Texture.WHITE),
      objectAtlasId: "atlas_objects",
      inputState: input,
      viewport,
    });
    const frame = makeFrame(mapDefinition(), [], hud, { hud: compactHudLayout(viewport.safeRect) });
    renderer.prepare(frame);
    renderer.enter(frame);

    const thumb = renderer.hudRenderer.joystickThumbDisplay;
    expect(thumb).toBeDefined();
    if (!thumb) throw new Error("joystick thumb missing");
    const joystickCenter = { x: thumb.x, y: thumb.y };
    renderer.hudRenderer.joystickDisplay.emit("pointerdown", pointerEvent({ pointerId: 21, global: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    renderer.hudRenderer.joystickDisplay.emit("globalpointermove", pointerEvent({ pointerId: 21, global: { x: 68, y: 20 }, preventDefault: vi.fn() }));
    expect(thumb.x).toBeGreaterThan(joystickCenter.x);
    expect(Math.hypot(thumb.x - joystickCenter.x, thumb.y - joystickCenter.y)).toBeLessThanOrEqual(48);
    renderer.hudRenderer.joystickDisplay.emit("pointerup", pointerEvent({ pointerId: 21, global: { x: 68, y: 20 }, preventDefault: vi.fn() }));
    expect(thumb.x).toBe(joystickCenter.x);
    expect(thumb.y).toBe(joystickCenter.y);

    const mapDisplay = renderer.hudRenderer.buttonDisplays.get("map");
    const mapVisual = renderer.hudRenderer.buttonVisualDisplays.get("map");
    const mapButton = renderer.hudRenderer.buttons.get("map");
    if (!mapDisplay || !mapVisual || !mapButton) throw new Error("map control missing");
    const hitArea = { ...mapButton.hitArea };
    const displayY = mapDisplay.y;
    mapDisplay.emit("pointerdown", pointerEvent({ pointerId: 22, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    expect(mapDisplay.y).toBe(displayY);
    expect(mapVisual.y).toBeGreaterThan(0);
    expect(mapButton.hitArea).toEqual(hitArea);
    mapDisplay.emit("pointercancel", pointerEvent({ pointerId: 22, client: { x: 20, y: 20 }, preventDefault: vi.fn() }));
    expect(mapVisual.y).toBe(0);
    renderer.destroy();
  });

  it("给主角挂低矮脚影和高对比定位标记，并以最近 NPC 生成稳定边缘路标", () => {
    const root = createPixiSceneRoot();
    const viewport = calculateViewport({ width: 640, height: 360 });
    const hud = new ExplorationHud(viewport.safeRect);
    const renderer = new FieldSceneRenderer({
      root,
      assets: makeAssets(Texture.WHITE, Texture.WHITE, Texture.WHITE),
      objectAtlasId: "atlas_objects",
      inputState: new InputState(),
      viewport,
    });
    const player = makeActor("player", { kind: "player", fieldSpriteId: "sprite_player" }, { x: 640, y: 800 });
    const cartographer = makeActor("obj_town_cartographer", { kind: "npc", spriteId: "sprite_npc" }, { x: 704, y: 576 }, "地图学家");
    const blacksmith = makeActor("obj_town_blacksmith", { kind: "npc", spriteId: "sprite_npc" }, { x: 512, y: 320 }, "铁匠");
    const frame = makeFrame(mapDefinition(), [player, cartographer, blacksmith], hud, {
      camera: { x: 320, y: 620, rootOffsetX: -320, rootOffsetY: -620 },
    });
    renderer.prepare(frame);
    renderer.enter(frame);
    expect(renderer.playerShadowDisplays.get("player")).toBeDefined();
    expect(renderer.playerMarkerDisplays.get("player")).toBeDefined();
    expect(renderer.nearestNpcSignpost.visible).toBe(true);
    expect(renderer.nearestNpcSignpostLabel.text).toBe("制图师 ↑");
    expect(Number.isFinite(renderer.nearestNpcSignpost.x)).toBe(true);
    expect(Number.isFinite(renderer.nearestNpcSignpost.y)).toBe(true);

    const nearCartographer = makeActor("player", { kind: "player", fieldSpriteId: "sprite_player" }, { x: 704, y: 576 });
    renderer.update(makeFrame(mapDefinition(), [nearCartographer, cartographer, blacksmith], hud, {
      camera: { x: 384, y: 396, rootOffsetX: -384, rootOffsetY: -396 },
      interactionTarget: {
        object: { kind: "npc", objectId: "obj_town_cartographer", position: { x: 704, y: 576 }, npcId: "npc_cartographer", blocking: true },
        action: "talk",
        distanceSquared: 0,
      },
    }));
    expect(renderer.nearestNpcSignpost.visible).toBe(false);
    expect(textValues(root.hud)).toContain("交谈");
    renderer.destroy();
  });
});
