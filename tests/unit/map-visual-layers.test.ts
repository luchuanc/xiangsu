import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import mapArtGolden from "../../art/visual/v1/map-art.golden.json";
import { buildMapBlueprint } from "../../src/content/builders/mapBlueprint";
import { buildMapVisualLayers, EMPTY_DECOR_TILE, encodeDecorTile, TOWN_BUILDING_RECTS } from "../../src/content/builders/mapVisualLayers";
import { townMap } from "../../src/content/data/maps/town";

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function assertGolden(actual: string, expected: string): void {
  if (actual !== expected) throw new Error("MAP_VISUAL_GOLDEN_MISMATCH");
}

describe("VIS-002C 地图视觉层 builder", () => {
  it("只生成 town/floor01 视觉层，不改变碰撞蓝图", () => {
    for (const mapId of ["map_town", "map_floor_01"] as const) {
      const blueprint = buildMapBlueprint(mapId);
      const collision = [...blueprint.collisionLayer];
      const layers = buildMapVisualLayers(blueprint);
      expect(layers.groundLayer).toHaveLength(blueprint.widthTiles * blueprint.heightTiles);
      expect(layers.decorBackLayer).toHaveLength(collision.length);
      expect(layers.decorFrontLayer).toHaveLength(collision.length);
      expect(blueprint.collisionLayer).toEqual(collision);
      expect(layers.decorBackLayer.every((tile) => Number.isInteger(tile) && tile >= 0 && tile <= 256)).toBe(true);
      expect(layers.decorFrontLayer.every((tile) => Number.isInteger(tile) && tile >= 0 && tile <= 256)).toBe(true);
      expect(layers.groundLayer.every((tile) => tile <= 95)).toBe(true);
      expect(layers.decorBackLayer.every((tile) => tile === 0 || tile - 1 <= 95)).toBe(true);
      expect(layers.decorFrontLayer.every((tile) => tile === 0 || tile - 1 <= 95)).toBe(true);
    }
  });

  it("固定道路/门/节点和编码规则，不把碰撞/对象语义混入视觉层", () => {
    const blueprint = buildMapBlueprint("map_town");
    const layers = buildMapVisualLayers(blueprint);
    const at = (x: number, y: number, layer: readonly number[] = layers.groundLayer) => layer[y * blueprint.widthTiles + x];
    expect(at(40, 8)).toBe(20);
    expect(at(40, 20)).toBeGreaterThanOrEqual(4);
    expect(at(40, 50)).toBe(25);
    expect(encodeDecorTile(0)).toBe(1);
    expect(encodeDecorTile(64)).toBe(65);
    expect(encodeDecorTile(95)).toBe(96);
    expect(EMPTY_DECOR_TILE).toBe(0);
  });

  it("十栋建筑南侧屋檐连续，且不覆盖出生点/NPC/传送门对象格", () => {
    const blueprint = buildMapBlueprint("map_town");
    const layers = buildMapVisualLayers(blueprint);
    const at = (x: number, y: number) => layers.decorFrontLayer[y * blueprint.widthTiles + x];
    for (const [minX, , maxX, maxY] of TOWN_BUILDING_RECTS) {
      const roofY = maxY + 1;
      for (let x = minX; x <= maxX; x += 1) {
        const expectedTile = x === minX ? 80 : x === maxX ? 82 : 81;
        expect(at(x, roofY), `roof ${minX},${maxY} x=${x}`).toBe(encodeDecorTile(expectedTile));
      }
    }
    for (const object of townMap.objects) {
      const x = Math.floor(object.position.x / townMap.tileSize);
      const y = Math.floor(object.position.y / townMap.tileSize);
      expect(at(x, y), object.objectId).toBe(EMPTY_DECOR_TILE);
    }
    expect(at(Math.floor(townMap.spawnPoint.x / townMap.tileSize), Math.floor(townMap.spawnPoint.y / townMap.tileSize))).toBe(EMPTY_DECOR_TILE);
  });

  it("三层 canonical hash 固定，节点/建筑视觉变异不能静默通过", () => {
    const townBlueprint = buildMapBlueprint("map_town");
    const floorBlueprint = buildMapBlueprint("map_floor_01");
    const town = buildMapVisualLayers(townBlueprint);
    const floor = buildMapVisualLayers(floorBlueprint);
    expect(() => assertGolden(sha256(JSON.stringify(town)), mapArtGolden.visualLayers.map_town.sha256)).not.toThrow();
    expect(() => assertGolden(sha256(JSON.stringify(floor)), mapArtGolden.visualLayers.map_floor_01.sha256)).not.toThrow();
    const nodeMutation = { ...town, groundLayer: [...town.groundLayer] };
    nodeMutation.groundLayer[8 * townBlueprint.widthTiles + 40] = 21;
    expect(() => assertGolden(sha256(JSON.stringify(nodeMutation)), mapArtGolden.visualLayers.map_town.sha256)).toThrow("MAP_VISUAL_GOLDEN_MISMATCH");
    const buildingMutation = { ...town, decorFrontLayer: [...town.decorFrontLayer] };
    buildingMutation.decorFrontLayer[(TOWN_BUILDING_RECTS[0]![3] + 1) * townBlueprint.widthTiles + TOWN_BUILDING_RECTS[0]![0]] = EMPTY_DECOR_TILE;
    expect(() => assertGolden(sha256(JSON.stringify(buildingMutation)), mapArtGolden.visualLayers.map_town.sha256)).toThrow("MAP_VISUAL_GOLDEN_MISMATCH");
  });

  it("每次严格读取 blueprint 的 anchors/collision，输入变异不得命中旧结果且不改原 blueprint", () => {
    const blueprint = buildMapBlueprint("map_floor_01");
    const originalAnchors = JSON.stringify(blueprint.validation.anchors);
    const originalCollision = [...blueprint.collisionLayer];
    const baseline = buildMapVisualLayers(blueprint);
    const boss = blueprint.validation.anchors.B!;
    const node = blueprint.validation.anchors.N1!;
    const movedAnchors = {
      ...blueprint.validation.anchors,
      B: { x: boss.x - 1, y: boss.y },
      N1: { x: node.x + 1, y: node.y },
    };
    const movedBlueprint = {
      ...blueprint,
      validation: { ...blueprint.validation, anchors: movedAnchors },
    };
    const moved = buildMapVisualLayers(movedBlueprint);
    expect(JSON.stringify(moved)).not.toBe(JSON.stringify(baseline));
    expect(JSON.stringify(blueprint.validation.anchors)).toBe(originalAnchors);
    expect(blueprint.collisionLayer).toEqual(originalCollision);

    const collisionIndex = blueprint.collisionLayer.findIndex((tile) => tile === 0);
    expect(collisionIndex).toBeGreaterThanOrEqual(0);
    const changedCollision = [...blueprint.collisionLayer];
    changedCollision[collisionIndex] = 1;
    const collisionBlueprint = { ...blueprint, collisionLayer: changedCollision };
    const changed = buildMapVisualLayers(collisionBlueprint);
    expect(JSON.stringify(changed)).not.toBe(JSON.stringify(baseline));
    expect(blueprint.collisionLayer).toEqual(originalCollision);
  });

  it("拒绝未冻结的地图", () => {
    expect(() => buildMapVisualLayers(buildMapBlueprint("map_floor_02"))).toThrow("MAP_VISUAL_UNSUPPORTED");
  });
});
