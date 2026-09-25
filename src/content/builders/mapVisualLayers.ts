import type { MapBlueprint, Point } from "./mapBlueprint";

export interface MapVisualLayers {
  groundLayer: number[];
  decorBackLayer: number[];
  decorFrontLayer: number[];
}

/** decor layer 的 0 是独立空位编码，不能由业务 tile encoder 产生。 */
export const EMPTY_DECOR_TILE = 0 as const;

const TOWN_SEED = 0x544f574e;
const FLOOR01_SEED = 0x46303031;

/** decor layer 用 0 表示空位；业务 tile N 写成 N+1，避免和空位混淆。 */
export function encodeDecorTile(tile: number): number {
  if (!Number.isInteger(tile) || tile < 0 || tile > 95) throw new RangeError("MAP_VISUAL_TILE_INVALID");
  return tile + 1;
}

function index(x: number, y: number, width: number): number { return y * width + x; }
function isWalkable(blueprint: MapBlueprint, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < blueprint.widthTiles && y < blueprint.heightTiles && blueprint.collisionLayer[index(x, y, blueprint.widthTiles)] === 0;
}

/** WORLD-1.2 冻结的无随机稳定 hash，不能改成 Math.random。 */
function visualHash(x: number, y: number, seed: number): number {
  return (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ seed) >>> 0;
}

function maskFor(blueprint: MapBlueprint, x: number, y: number): number {
  const exposed = (column: number, row: number): boolean => isWalkable(blueprint, column, row);
  return (exposed(x, y - 1) ? 1 : 0) | (exposed(x + 1, y) ? 2 : 0) | (exposed(x, y + 1) ? 4 : 0) | (exposed(x - 1, y) ? 8 : 0);
}

function distanceToAnchors(x: number, y: number, anchors: readonly Point[]): number {
  return Math.min(...anchors.map((anchor) => Math.abs(anchor.x - x) + Math.abs(anchor.y - y)));
}

const townBuildings = [
  [5, 5, 15, 13], [18, 5, 28, 13], [31, 5, 41, 13], [44, 5, 54, 13], [57, 5, 69, 13],
  [5, 25, 18, 33], [31, 25, 48, 33], [61, 25, 74, 33], [8, 43, 24, 52], [55, 43, 71, 52],
] as const;

export const TOWN_BUILDING_RECTS = townBuildings;

function insideBuilding(x: number, y: number): readonly [number, number, number, number] | undefined {
  return townBuildings.find(([minX, minY, maxX, maxY]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
}

function onTownRoad(x: number, y: number): boolean {
  return (x >= 25 && x <= 55 && y >= 15 && y <= 42)
    || (x >= 36 && x <= 44 && y >= 9 && y <= 58)
    || (x >= 2 && x <= 77 && y >= 18 && y <= 22)
    || (x >= 2 && x <= 77 && y >= 35 && y <= 39);
}

function buildTownVisualLayers(blueprint: MapBlueprint): MapVisualLayers {
  const length = blueprint.widthTiles * blueprint.heightTiles;
  const groundLayer = new Array<number>(length).fill(0);
  const decorBackLayer = new Array<number>(length).fill(0);
  const decorFrontLayer = new Array<number>(length).fill(0);
  const anchors = Object.values(blueprint.validation.anchors);
  const anchorCells = new Set(anchors.map((anchor) => `${anchor.x},${anchor.y}`));
  for (let y = 0; y < blueprint.heightTiles; y += 1) for (let x = 0; x < blueprint.widthTiles; x += 1) {
    const offset = index(x, y, blueprint.widthTiles);
    const building = insideBuilding(x, y);
    const road = onTownRoad(x, y);
    const hash = visualHash(x, y, TOWN_SEED);
    if (x >= 39 && x <= 41 && y >= 7 && y <= 9) {
      groundLayer[offset] = 16 + (y - 7) * 3 + (x - 39);
    } else if (x === 40 && y === 50) {
      groundLayer[offset] = 25;
    } else if (building) {
      const bottom = y >= building[3] - 1;
      if (bottom) groundLayer[offset] = x === Math.floor((building[0] + building[2]) / 2) && y === building[3] ? 52 : (x + y) % 2 === 0 ? 48 : 49;
      else groundLayer[offset] = 32 + maskFor(blueprint, x, y);
      // 屋檐在建筑南侧下一行，左右/中间固定使用 80/81/82；不写入建筑本体。
      if (y >= building[3] - 1 && (x - building[0]) % 4 === 1) groundLayer[offset] = 50;
    } else if (road) {
      groundLayer[offset] = 4 + (hash & 3);
    } else if (blueprint.collisionLayer[offset] === 1) {
      const boundary = x === 0 || y === 0 || x === blueprint.widthTiles - 1 || y === blueprint.heightTiles - 1;
      groundLayer[offset] = boundary ? 56 + (hash & 7) : 8 + (hash & 1);
      if (!boundary && maskFor(blueprint, x, y) !== 0) decorBackLayer[offset] = encodeDecorTile(56 + (hash & 7));
    } else {
      groundLayer[offset] = hash & 3;
      if (distanceToAnchors(x, y, anchors) > 2) {
        if (hash % 47 === 0) decorBackLayer[offset] = encodeDecorTile(64);
        else if (hash % 71 === 0) decorBackLayer[offset] = encodeDecorTile(65);
        else if (hash % 101 === 0) decorBackLayer[offset] = encodeDecorTile(66);
      }
    }
    const roof = insideBuilding(x, y - 1);
    if (roof && y === roof[3] + 1 && x >= roof[0] && x <= roof[2] && !anchorCells.has(`${x},${y}`)) {
      const roofPosition = x === roof[0] ? 0 : x === roof[2] ? 2 : 1;
      decorFrontLayer[offset] = encodeDecorTile(80 + roofPosition);
    }
    if (x === 39 && y === 8) decorFrontLayer[offset] = encodeDecorTile(91);
  }
  return { groundLayer, decorBackLayer, decorFrontLayer };
}

function buildFloor01VisualLayers(blueprint: MapBlueprint): MapVisualLayers {
  const length = blueprint.widthTiles * blueprint.heightTiles;
  const groundLayer = new Array<number>(length).fill(0);
  const decorBackLayer = new Array<number>(length).fill(0);
  const decorFrontLayer = new Array<number>(length).fill(0);
  const anchors = Object.values(blueprint.validation.anchors);
  const nodeTiles = new Map<string, number>([
    ["S", 25], ["R", 26], ["E1", 27], ["E2", 27], ["C1", 28], ["C2", 28], ["C3", 28], ["B", 25],
  ]);
  for (let y = 0; y < blueprint.heightTiles; y += 1) for (let x = 0; x < blueprint.widthTiles; x += 1) {
    const offset = index(x, y, blueprint.widthTiles);
    const hash = visualHash(x, y, FLOOR01_SEED);
    const anchorName = Object.entries(blueprint.validation.anchors).find(([, point]) => point.x === x && point.y === y)?.[0];
    const nodeTile = anchorName ? nodeTiles.get(anchorName) : undefined;
    const boss = blueprint.validation.anchors.B;
    if (Math.abs(x - boss.x) <= 1 && Math.abs(y - boss.y) <= 1) {
      groundLayer[offset] = 16 + (y - boss.y + 1) * 3 + (x - boss.x + 1);
    } else if (nodeTile !== undefined) {
      groundLayer[offset] = nodeTile;
    } else if (blueprint.collisionLayer[offset] === 1) {
      groundLayer[offset] = 8 + (hash & 1);
      const mask = maskFor(blueprint, x, y);
      if (mask !== 0) decorBackLayer[offset] = encodeDecorTile(32 + mask);
    } else {
      groundLayer[offset] = hash & 3;
      if (distanceToAnchors(x, y, anchors) > 2) {
        if (hash % 43 === 0) decorBackLayer[offset] = encodeDecorTile(64);
        else if (hash % 67 === 0) decorBackLayer[offset] = encodeDecorTile(65);
        else if (hash % 97 === 0) decorBackLayer[offset] = encodeDecorTile(66);
        else if (hash % 131 === 0) decorBackLayer[offset] = encodeDecorTile(67);
      }
    }
    if (blueprint.collisionLayer[offset] === 1 && isWalkable(blueprint, x, y - 1)) decorFrontLayer[offset] = encodeDecorTile(80 + (hash % 3));
  }
  return { groundLayer, decorBackLayer, decorFrontLayer };
}

export function buildMapVisualLayers(blueprint: MapBlueprint): MapVisualLayers {
  if (blueprint.mapId !== "map_town" && blueprint.mapId !== "map_floor_01") throw new Error(`MAP_VISUAL_UNSUPPORTED:${blueprint.mapId}`);
  // 构建结果严格依赖本次传入的 collision 与 anchors，不缓存不完整的 blueprint key。
  return blueprint.mapId === "map_town" ? buildTownVisualLayers(blueprint) : buildFloor01VisualLayers(blueprint);
}
