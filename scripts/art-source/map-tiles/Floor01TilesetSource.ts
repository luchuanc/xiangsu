import { createPixelSurface, fillRect } from "./PixelSurface";
import { assertMapTilesetContract, assertTilesTransparent, MAP_TILESET_HEIGHT, MAP_TILESET_WIDTH, TILE_SIZE } from "./MapTilesetContract";
import { color, frameTile, glyphTile, lineTile, speckleTile, tilePixel } from "./TilePrimitives";
import type { PixelSurface } from "./PixelSurface";

export const FLOOR01_UNALLOCATED_TILE_RANGES = [[72, 79], [91, 95]] as const;
let cachedFloor01Tileset: PixelSurface | undefined;
let floor01ContractVerified = false;

function drawFloorSpecial(surface: PixelSurface): void {
  for (let tile = 16; tile <= 24; tile += 1) {
    const local = tile - 16;
    const x = local % 3;
    const y = Math.floor(local / 3);
    frameTile(surface, tile, 25, 28, 1);
    if (x === 1 && y === 1) glyphTile(surface, tile, 29, [[7, 2], [6, 3], [7, 3], [8, 3], [7, 4], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [7, 8], [7, 9], [4, 11], [5, 11], [9, 11], [10, 11]]);
    else for (let i = 2; i < 14; i += 1) tilePixel(surface, tile, x === 0 ? 13 : x === 2 ? 2 : i, y === 0 ? 13 : y === 2 ? 2 : i, color(30));
  }
}

function drawFloorAutotiles(surface: PixelSurface): void {
  for (let mask = 0; mask < 16; mask += 1) {
    const tile = 32 + mask;
    speckleTile(surface, tile, 3, 5, 0x46303031 ^ tile, 10);
    const rectX = (tile % 16) * TILE_SIZE;
    const rectY = Math.floor(tile / 16) * TILE_SIZE;
    if (mask & 1) fillRect(surface, rectX + 2, rectY, 12, 2, color(24));
    if (mask & 2) fillRect(surface, rectX + 14, rectY + 2, 2, 12, color(24));
    if (mask & 4) fillRect(surface, rectX + 2, rectY + 14, 12, 2, color(24));
    if (mask & 8) fillRect(surface, rectX, rectY + 2, 2, 12, color(24));
    if (mask === 0) lineTile(surface, tile, [1, 12], [14, 3], 5);
  }
}

function drawFloorStructures(surface: PixelSurface): void {
  for (let tile = 48; tile <= 63; tile += 1) {
    const variant = tile - 48;
    if (variant < 3) { frameTile(surface, tile, 2 + variant, 5, 2); lineTile(surface, tile, [2, 4 + variant], [13, 12 - variant], 6); }
    else if (variant < 6) { speckleTile(surface, tile, 5 + variant % 2, 6, 0x4800 + tile, 20); frameTile(surface, tile, 5 + variant % 2, 4, 1); }
    else if (variant < 9) { frameTile(surface, tile, 1 + variant % 3, 7, 1); glyphTile(surface, tile, 6, [[3, 12], [5, 9], [7, 3], [9, 9], [12, 12]]); }
    else if (variant < 12) { speckleTile(surface, tile, 12 + variant % 3, 14, 0x4a00 + tile, 13); lineTile(surface, tile, [3, 13], [12, 3], 15); }
    else { frameTile(surface, tile, 4, 5, 2); glyphTile(surface, tile, 6, [[7, 2], [6, 3], [8, 3], [5, 4], [9, 4], [4, 5], [10, 5], [3, 6], [11, 6]]); }
  }
}

function drawFloorDecor(surface: PixelSurface): void {
  const decor = [
    [64, 20, 21, 22], [65, 21, 22, 23], [66, 22, 23, 24], [67, 23, 24, 25],
    [68, 11, 12, 13], [69, 12, 13, 14], [70, 14, 15, 16], [71, 5, 6, 7],
    [80, 5, 6, 7], [81, 6, 7, 8], [82, 7, 8, 9], [83, 19, 20, 21],
    [84, 20, 21, 22], [85, 21, 22, 23], [86, 14, 15, 16], [87, 15, 16, 17],
    [88, 16, 17, 18], [89, 3, 4, 5], [90, 5, 6, 7],
  ] as const;
  for (const [tile, base, speck, accent] of decor) {
    speckleTile(surface, tile, base, speck, 0x5100 + tile, 11);
    lineTile(surface, tile, [2, 13], [13, 2], accent);
  }
}

function buildFloor01Tileset(): PixelSurface {
  const surface = createPixelSurface(MAP_TILESET_WIDTH, MAP_TILESET_HEIGHT);
  for (let tile = 0; tile <= 3; tile += 1) speckleTile(surface, tile, 2 + tile, 5 + tile % 2, 0x46303031 + tile, 16);
  for (let tile = 4; tile <= 7; tile += 1) { speckleTile(surface, tile, 3 + tile % 2, 6, 0x4000 + tile, 18); lineTile(surface, tile, [2, 2 + tile % 4], [13, 13], 5); }
  for (let tile = 8; tile <= 15; tile += 1) { frameTile(surface, tile, 1 + tile % 3, 4, 1); lineTile(surface, tile, [2, 13], [13, 2], 5); }
  drawFloorSpecial(surface);
  for (let tile = 25; tile <= 31; tile += 1) {
    speckleTile(surface, tile, tile === 27 ? 29 : 14 + tile % 3, 30, 0x5200 + tile, 8);
    glyphTile(surface, tile, tile === 28 ? 17 : 10, [[7, 3], [7, 4], [7, 5], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [7, 9], [7, 10], [7, 11]]);
  }
  drawFloorAutotiles(surface);
  drawFloorStructures(surface);
  drawFloorDecor(surface);
  return surface;
}

export function assertFloor01TilesetContract(surface: PixelSurface = ensureFloor01Tileset()): void {
  assertMapTilesetContract(surface);
  assertTilesTransparent(surface, FLOOR01_UNALLOCATED_TILE_RANGES);
}

function ensureFloor01Tileset(): PixelSurface {
  if (!cachedFloor01Tileset) {
    cachedFloor01Tileset = buildFloor01Tileset();
    assertFloor01TilesetContract(cachedFloor01Tileset);
    floor01ContractVerified = true;
  }
  return cachedFloor01Tileset;
}

export function createFloor01Tileset(): PixelSurface {
  const source = ensureFloor01Tileset();
  return { width: source.width, height: source.height, data: new Uint8Array(source.data) };
}

export function isFloor01TilesetContractCached(): boolean { return floor01ContractVerified; }
