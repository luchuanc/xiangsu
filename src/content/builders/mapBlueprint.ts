/**
 * WORLD-1.2 2.4 的纯碰撞蓝图构建器。
 * 视觉 layer 不参与这里的 hash；运行时 MapDefinition 也不保存蓝图字段。
 */
import type { MapDefinition } from "../contracts";

export interface MapBlueprint {
  mapId: string;
  widthTiles: number;
  heightTiles: number;
  collisionLayer: Array<0 | 1>;
  walkableTiles: number;
  collisionSha256: string;
  /** 仅供构建期验证，运行时 MapDefinition 不保存这些字段。 */
  validation: {
    anchors: Readonly<Record<string, Point>>;
    routePaths: readonly (readonly string[])[];
  };
}

/** WORLD-1.2 2.3 的空旷测试地图，只供领域单测和 E2E 使用。 */
export const openFieldFixture: MapDefinition = (() => {
  const widthTiles = 32;
  const heightTiles = 20;
  const collisionLayer: Array<0 | 1> = new Array(widthTiles * heightTiles).fill(0);
  for (let x = 0; x < widthTiles; x += 1) {
    collisionLayer[x] = 1;
    collisionLayer[(heightTiles - 1) * widthTiles + x] = 1;
  }
  for (let y = 0; y < heightTiles; y += 1) {
    collisionLayer[y * widthTiles] = 1;
    collisionLayer[y * widthTiles + widthTiles - 1] = 1;
  }
  return {
    id: "map_open_field_fixture",
    nameKey: "map.map_town.name",
    widthTiles,
    heightTiles,
    tileSize: 16,
    assetBundleId: "fixture",
    spawnPoint: { x: 16 * 16, y: 10 * 16 },
    groundLayer: new Array(widthTiles * heightTiles).fill(0),
    decorBackLayer: new Array(widthTiles * heightTiles).fill(0),
    decorFrontLayer: new Array(widthTiles * heightTiles).fill(0),
    collisionLayer,
    objects: [],
  };
})();

export type Point = { x: number; y: number };
const floorNodes: Record<string, Point> = {
  S: { x: 6, y: 56 }, R: { x: 4, y: 58 }, N1: { x: 16, y: 50 }, N2: { x: 30, y: 54 }, N3: { x: 46, y: 46 }, N4: { x: 64, y: 52 }, N5: { x: 78, y: 44 }, N6: { x: 22, y: 32 }, N7: { x: 50, y: 30 }, N8: { x: 74, y: 28 }, E1: { x: 36, y: 18 }, E2: { x: 70, y: 16 }, C1: { x: 12, y: 20 }, C2: { x: 48, y: 10 }, C3: { x: 84, y: 22 }, B: { x: 88, y: 8 },
};
const paths: Record<number, string[][]> = {
  1: [["S", "N1", "N2", "N3", "N4", "N5", "N8", "E2", "B"], ["N1", "C1", "N6", "E1", "C2", "N7", "N3"], ["N5", "C3", "N8"], ["S", "R"]],
  2: [["S", "N2", "N3", "N4", "N5", "N8", "E2", "B"], ["N2", "N1", "C1", "N6", "E1", "N7", "C2", "N3"], ["N5", "C3", "B"], ["S", "R"]],
  3: [["S", "N1", "N2", "N3", "N7", "N4", "N5", "N8", "E2", "B"], ["N1", "N6", "C1", "E1", "C2", "N7"], ["N8", "C3", "B"], ["S", "R"]],
  4: [["S", "N2", "N3", "N4", "N7", "N5", "N8", "E2", "B"], ["N2", "N1", "C1", "N6", "E1", "C2", "N7"], ["N5", "C3", "B"], ["S", "R"]],
  5: [["S", "N1", "N2", "N3", "N7", "N4", "N5", "N8", "E2", "B"], ["N2", "N6", "C1", "E1", "C2", "N7"], ["N5", "C3", "N8"], ["S", "R"]],
  6: [["S", "N2", "N3", "N4", "N5", "N8", "E2", "B"], ["N2", "N1", "C1", "N6", "E1", "C2", "N3"], ["N5", "C3", "N8"], ["S", "R"]],
  7: [["S", "N1", "N2", "N3", "N4", "N5", "N8", "E2", "B"], ["N2", "N6", "C1", "E1", "C2", "N7", "N4"], ["N8", "C3", "B"], ["S", "R"]],
  8: [["S", "N2", "N3", "N4", "N5", "N8", "E2", "B"], ["N2", "N1", "N6", "E1", "C1", "C2", "N3"], ["N5", "C3", "N8"], ["S", "R"]],
  9: [["S", "N1", "N2", "N3", "N7", "N4", "N5", "N8", "E2", "B"], ["N2", "N6", "E1", "C1", "C2", "N7"], ["N8", "C3", "B"], ["S", "R"]],
  10: [["S", "N2", "N3", "N7", "N4", "N5", "N8", "E2", "B"], ["N2", "N1", "C1", "N6", "E1", "C2", "N7"], ["N5", "C3", "E2"], ["S", "R"]],
};

const frozenHashes: Record<string, { walkableTiles: number; hash: string }> = {
  map_town: { walkableTiles: 3266, hash: "bf421d7a56f0afb60dfb2a5c72f3ccf5233d2d540a11bde32fe1ea748a7754de" },
  map_floor_01: { walkableTiles: 1073, hash: "dbb7994555dda3ef12fa669075d86a62630ca7d9b85cbf43b3eccf259ebd81c0" },
  map_floor_02: { walkableTiles: 1131, hash: "3f724a632713fe3bd6672335713be75dcad0f6e057978951240a9a728c7d2533" },
  map_floor_03: { walkableTiles: 1077, hash: "4c125ac8f277d70f5bfc606dc5dd99d5464e9d03fe97b9969bc16430f3273d8f" },
  map_floor_04: { walkableTiles: 1161, hash: "27d00d4976c98c6e10cbcf8fa4e5e234d40be0de88c0bb5a39dafa13a6448572" },
  map_floor_05: { walkableTiles: 1072, hash: "a1c5b9c21f4da9287c30e744ad8e35fddf46bd2e95a2a82b2be35e844d0e1c02" },
  map_floor_06: { walkableTiles: 1133, hash: "2a291e49028044be0a052afb47a857893724438097a62fbd28eb17749036a9c7" },
  map_floor_07: { walkableTiles: 1067, hash: "03f960c9b69424fb304c082d276812bbb31a76a40ef8a66d21ed0257e87d026b" },
  map_floor_08: { walkableTiles: 1169, hash: "7a2568f02ceced11ce69104615fa25247eaeafbb9c8c26276af20c0df3c46734" },
  map_floor_09: { walkableTiles: 1182, hash: "381c7066ed671590fd4acf8d1c0f9980d7e28288f8aed43233e0e61f76adca07" },
  map_floor_10: { walkableTiles: 1161, hash: "482e11862ec1c049212293a7384c427a6e3d62b8560d5c31127fcfc7e10cfeca" },
};

function index(x: number, y: number, width: number): number { return y * width + x; }
function isWalkable(blueprint: MapBlueprint, point: Point): boolean {
  return point.x >= 0 && point.x < blueprint.widthTiles && point.y >= 0 && point.y < blueprint.heightTiles
    && blueprint.collisionLayer[index(point.x, point.y, blueprint.widthTiles)] === 0;
}

function reachableKeys(blueprint: MapBlueprint, start: Point): Set<number> {
  const visited = new Set<number>();
  const queue: Point[] = [start];
  while (queue.length > 0) {
    const point = queue.shift()!;
    const key = index(point.x, point.y, blueprint.widthTiles);
    if (visited.has(key) || !isWalkable(blueprint, point)) continue;
    visited.add(key);
    queue.push({ x: point.x + 1, y: point.y }, { x: point.x - 1, y: point.y }, { x: point.x, y: point.y + 1 }, { x: point.x, y: point.y - 1 });
  }
  return visited;
}
function markWalkable(layer: Array<0 | 1>, width: number, height: number, x: number, y: number): void {
  if (x > 0 && x < width - 1 && y > 0 && y < height - 1) layer[index(x, y, width)] = 0;
}
function clearRoom(layer: Array<0 | 1>, width: number, height: number, center: Point, radius: number): void {
  for (let y = center.y - radius; y <= center.y + radius; y += 1) for (let x = center.x - radius; x <= center.x + radius; x += 1) markWalkable(layer, width, height, x, y);
}
function clearCorridor(layer: Array<0 | 1>, width: number, height: number, from: Point, to: Point, xFirst: boolean): void {
  const points: Point[] = [];
  let x = from.x; let y = from.y;
  points.push({ x, y });
  // 使用显式 while，避免转向时把端点重复解释为另一段起点。
  points.length = 0; x = from.x; y = from.y; points.push({ x, y });
  const moveX = () => { while (x !== to.x) { x += x < to.x ? 1 : -1; points.push({ x, y }); } };
  const moveY = () => { while (y !== to.y) { y += y < to.y ? 1 : -1; points.push({ x, y }); } };
  if (xFirst) { moveX(); moveY(); } else { moveY(); moveX(); }
  for (const point of points) {
    markWalkable(layer, width, height, point.x, point.y);
    markWalkable(layer, width, height, point.x + 1, point.y); markWalkable(layer, width, height, point.x - 1, point.y);
    markWalkable(layer, width, height, point.x, point.y + 1); markWalkable(layer, width, height, point.x, point.y - 1);
  }
}

export function collisionHash(collisionLayer: readonly (0 | 1)[]): string {
  // 使用同步、无运行时依赖的 SHA-256，保证浏览器构建与 Node 校验得到同一字节结果。
  // collisionLayer 的输入语义保持为 Node createHash 原先接收的原始 0/1 字节。
  const bytes = Uint8Array.from(collisionLayer);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const highLength = Math.floor(bitLength / 0x1_0000_0000);
  const lowLength = bitLength >>> 0;
  const lengthOffset = paddedLength - 8;
  padded[lengthOffset] = (highLength >>> 24) & 0xff;
  padded[lengthOffset + 1] = (highLength >>> 16) & 0xff;
  padded[lengthOffset + 2] = (highLength >>> 8) & 0xff;
  padded[lengthOffset + 3] = highLength & 0xff;
  padded[lengthOffset + 4] = (lowLength >>> 24) & 0xff;
  padded[lengthOffset + 5] = (lowLength >>> 16) & 0xff;
  padded[lengthOffset + 6] = (lowLength >>> 8) & 0xff;
  padded[lengthOffset + 7] = lowLength & 0xff;

  const roundConstants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const schedule = new Uint32Array(64);
  const rotateRight = (value: number, amount: number): number => (value >>> amount) | (value << (32 - amount));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      schedule[index] = (
        (padded[position] << 24)
        | (padded[position + 1] << 16)
        | (padded[position + 2] << 8)
        | padded[position + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const first = rotateRight(schedule[index - 15], 7) ^ rotateRight(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3);
      const second = rotateRight(schedule[index - 2], 17) ^ rotateRight(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10);
      schedule[index] = (schedule[index - 16] + first + schedule[index - 7] + second) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigmaOne = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sigmaOne + choice + roundConstants[index] + schedule[index]) >>> 0;
      const sigmaZero = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sigmaZero + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    hash = [
      (hash[0] + a) >>> 0,
      (hash[1] + b) >>> 0,
      (hash[2] + c) >>> 0,
      (hash[3] + d) >>> 0,
      (hash[4] + e) >>> 0,
      (hash[5] + f) >>> 0,
      (hash[6] + g) >>> 0,
      (hash[7] + h) >>> 0,
    ];
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

function buildTown(): MapBlueprint {
  const widthTiles = 80; const heightTiles = 60; const layer: Array<0 | 1> = new Array(widthTiles * heightTiles).fill(0);
  for (let x = 0; x < widthTiles; x += 1) { layer[index(x, 0, widthTiles)] = 1; layer[index(x, heightTiles - 1, widthTiles)] = 1; }
  for (let y = 0; y < heightTiles; y += 1) { layer[index(0, y, widthTiles)] = 1; layer[index(widthTiles - 1, y, widthTiles)] = 1; }
  const rectangles = [[5, 5, 15, 13], [18, 5, 28, 13], [31, 5, 41, 13], [44, 5, 54, 13], [57, 5, 69, 13], [5, 25, 18, 33], [31, 25, 48, 33], [61, 25, 74, 33], [8, 43, 24, 52], [55, 43, 71, 52]];
  for (const [minX, minY, maxX, maxY] of rectangles) for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) layer[index(x, y, widthTiles)] = 1;
  const anchors: Record<string, Point> = {
    spawn: { x: 40, y: 50 }, portal: { x: 40, y: 8 }, tavern: { x: 20, y: 20 }, blacksmith: { x: 32, y: 20 },
    mentor: { x: 44, y: 20 }, merchant: { x: 56, y: 20 }, inn: { x: 26, y: 36 }, cartographer: { x: 44, y: 36 }, abyssWatcher: { x: 62, y: 36 },
  };
  for (const anchor of Object.values(anchors)) clearRoom(layer, widthTiles, heightTiles, anchor, 1);
  return { mapId: "map_town", widthTiles, heightTiles, collisionLayer: layer, walkableTiles: layer.filter((value) => value === 0).length, collisionSha256: collisionHash(layer), validation: { anchors, routePaths: [] } };
}

function buildFloor(floorNumber: number): MapBlueprint {
  const widthTiles = 96; const heightTiles = 64; const layer: Array<0 | 1> = new Array(widthTiles * heightTiles).fill(1);
  for (const point of Object.values(floorNodes)) clearRoom(layer, widthTiles, heightTiles, point, 2);
  let edgeIndex = 0;
  for (const path of paths[floorNumber]) {
    for (let i = 0; i < path.length - 1; i += 1) {
      const from = floorNodes[path[i]]; const to = floorNodes[path[i + 1]];
      clearCorridor(layer, widthTiles, heightTiles, from, to, (floorNumber + edgeIndex) % 2 === 0);
      edgeIndex += 1;
    }
  }
  for (let x = 0; x < widthTiles; x += 1) { layer[index(x, 0, widthTiles)] = 1; layer[index(x, heightTiles - 1, widthTiles)] = 1; }
  for (let y = 0; y < heightTiles; y += 1) { layer[index(0, y, widthTiles)] = 1; layer[index(widthTiles - 1, y, widthTiles)] = 1; }
  const mapId = `map_floor_${String(floorNumber).padStart(2, "0")}`;
  return {
    mapId,
    widthTiles,
    heightTiles,
    collisionLayer: layer,
    walkableTiles: layer.filter((value) => value === 0).length,
    collisionSha256: collisionHash(layer),
    validation: {
      anchors: Object.fromEntries(Object.entries(floorNodes).map(([key, point]) => [key, { ...point }])),
      routePaths: paths[floorNumber].map((path) => [...path]),
    },
  };
}

export function buildMapBlueprint(mapId: string): MapBlueprint {
  if (mapId === "map_town") return buildTown();
  const match = /^map_floor_(0[1-9]|10)$/.exec(mapId);
  if (!match) throw new RangeError(`未知地图蓝图: ${mapId}`);
  return buildFloor(Number(match[1]));
}

export function buildAllMapBlueprints(): MapBlueprint[] {
  return ["map_town", ...Array.from({ length: 10 }, (_, index) => `map_floor_${String(index + 1).padStart(2, "0")}`)].map(buildMapBlueprint);
}

export function assertFrozenBlueprint(blueprint: MapBlueprint): void {
  const frozen = frozenHashes[blueprint.mapId];
  if (!frozen || blueprint.walkableTiles !== frozen.walkableTiles || blueprint.collisionSha256 !== frozen.hash) throw new Error(`地图蓝图快照不匹配: ${blueprint.mapId}`);
  const anchors = blueprint.validation.anchors;
  const start = anchors.S ?? anchors.spawn;
  if (!start || !isWalkable(blueprint, start)) throw new Error(`地图起点不可行走: ${blueprint.mapId}`);
  const reachable = reachableKeys(blueprint, start);
  for (const [anchorId, point] of Object.entries(anchors)) {
    if (!isWalkable(blueprint, point) || !reachable.has(index(point.x, point.y, blueprint.widthTiles))) throw new Error(`地图锚点不可达: ${blueprint.mapId}:${anchorId}`);
  }

  if (blueprint.mapId === "map_town") return;
  const floorNumber = Number(blueprint.mapId.slice(-2));
  const expectedRoutes = paths[floorNumber];
  if (JSON.stringify(blueprint.validation.routePaths) !== JSON.stringify(expectedRoutes)) throw new Error(`地图路径定义不匹配: ${blueprint.mapId}`);
  const [mainRoute, eliteBranch, chestBranch, returnBranch] = blueprint.validation.routePaths;
  if (!mainRoute?.includes("B") || !mainRoute.includes("E2") || !eliteBranch?.includes("E1") || mainRoute.includes("E1") || !eliteBranch.includes("C1") || !eliteBranch.includes("C2") || !chestBranch?.includes("C3") || JSON.stringify(returnBranch) !== JSON.stringify(["S", "R"])) throw new Error(`地图主路或支路不匹配: ${blueprint.mapId}`);

  const boss = anchors.B;
  const bossContacts = [
    { x: boss.x + 1, y: boss.y }, { x: boss.x - 1, y: boss.y }, { x: boss.x, y: boss.y + 1 }, { x: boss.x, y: boss.y - 1 },
  ].filter((point) => isWalkable(blueprint, point));
  if (bossContacts.length < 2 || bossContacts.some((point) => !reachable.has(index(point.x, point.y, blueprint.widthTiles)))) throw new Error(`层主接触位不足: ${blueprint.mapId}`);
}
