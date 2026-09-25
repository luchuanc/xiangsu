import { createPixelSurface, fillRect } from "./PixelSurface";
import { assertMapTilesetContract, assertTilesTransparent, MAP_TILESET_HEIGHT, MAP_TILESET_WIDTH, TILE_SIZE } from "./MapTilesetContract";
import { color, frameTile, glyphTile, lineTile, speckleTile, tilePixel } from "./TilePrimitives";
import type { PixelSurface } from "./PixelSurface";

export const TOWN_UNALLOCATED_TILE_RANGES = [[72, 79], [92, 95]] as const;
let cachedTownTileset: PixelSurface | undefined;
let townContractVerified = false;

function drawTownSpecial(surface: PixelSurface): void {
  for (let tile = 16; tile <= 24; tile += 1) {
    const local = tile - 16;
    const x = local % 3;
    const y = Math.floor(local / 3);
    frameTile(surface, tile, 25, 18, 1);
    if (x === 1 && y === 1) {
      glyphTile(surface, tile, 17, [[7, 2], [7, 3], [6, 4], [7, 4], [8, 4], [7, 5], [7, 6], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8]]);
    } else {
      for (let i = 2; i < 14; i += 1) tilePixel(surface, tile, x === 0 ? 13 : x === 2 ? 2 : i, y === 0 ? 13 : y === 2 ? 2 : i, color(17));
    }
  }
}

function drawTownAutotiles(surface: PixelSurface): void {
  for (let mask = 0; mask < 16; mask += 1) {
    const tile = 32 + mask;
    speckleTile(surface, tile, 4, 5, 0x544f574e ^ tile, 8);
    const rectX = (tile % 16) * TILE_SIZE;
    const rectY = Math.floor(tile / 16) * TILE_SIZE;
    if (mask & 1) fillRect(surface, rectX + 2, rectY, 12, 2, color(10));
    if (mask & 2) fillRect(surface, rectX + 14, rectY + 2, 2, 12, color(10));
    if (mask & 4) fillRect(surface, rectX + 2, rectY + 14, 12, 2, color(10));
    if (mask & 8) fillRect(surface, rectX, rectY + 2, 2, 12, color(10));
    if (mask === 0) lineTile(surface, tile, [2, 2], [13, 13], 3);
  }
}

function drawTownStructures(surface: PixelSurface): void {
  for (let tile = 48; tile <= 63; tile += 1) {
    const variant = tile - 48;
    if (variant === 0) { frameTile(surface, tile, 3, 6, 2); lineTile(surface, tile, [3, 12], [12, 3], 5); }
    else if (variant === 1) { frameTile(surface, tile, 13, 14, 2); lineTile(surface, tile, [4, 2], [4, 13], 15); lineTile(surface, tile, [11, 2], [11, 13], 15); }
    else if (variant === 2 || variant === 3) { frameTile(surface, tile, variant === 2 ? 17 : 11, 10, 1); fillRect(surface, (tile % 16) * 16 + 5, Math.floor(tile / 16) * 16 + 5, 6, 6, color(variant === 2 ? 20 : 1)); }
    else if (variant === 4) { frameTile(surface, tile, 15, 12, 2); fillRect(surface, (tile % 16) * 16 + 6, Math.floor(tile / 16) * 16 + 5, 4, 10, color(14)); }
    else if (variant === 5) { frameTile(surface, tile, 14, 15, 2); fillRect(surface, (tile % 16) * 16 + 3, Math.floor(tile / 16) * 16 + 5, 10, 6, color(16)); }
    else if (variant === 6) { frameTile(surface, tile, 13, 15, 2); fillRect(surface, (tile % 16) * 16 + 3, Math.floor(tile / 16) * 16 + 5, 10, 6, color(17)); }
    else if (variant === 7) { frameTile(surface, tile, 14, 9, 2); fillRect(surface, (tile % 16) * 16 + 5, Math.floor(tile / 16) * 16 + 4, 6, 12, color(12)); }
    else { speckleTile(surface, tile, variant % 2 === 0 ? 3 : 13, 6, 0x544f574e + tile, 10); frameTile(surface, tile, variant % 2 === 0 ? 3 : 13, 5, 1); }
  }
}

function drawTownDecor(surface: PixelSurface): void {
  const decor = [
    [64, 19, 20, 21], [65, 20, 21, 19], [66, 21, 19, 20], [67, 22, 26, 20],
    [68, 23, 15, 24], [69, 24, 25, 20], [70, 6, 21, 19], [71, 21, 15, 22],
    [80, 13, 14, 15], [81, 14, 15, 17], [82, 15, 16, 18], [83, 18, 19, 20],
    [84, 20, 21, 22], [85, 6, 7, 8], [86, 19, 20, 21], [87, 21, 22, 23],
    [88, 15, 16, 17], [89, 17, 18, 19], [90, 11, 12, 13], [91, 24, 25, 26],
  ] as const;
  for (const [tile, base, speck, accent] of decor) {
    speckleTile(surface, tile, base, speck, 0x1000 + tile, 9);
    lineTile(surface, tile, [2, 13], [13, 2], accent);
  }
}

function buildTownTileset(): PixelSurface {
  const surface = createPixelSurface(MAP_TILESET_WIDTH, MAP_TILESET_HEIGHT);
  for (let tile = 0; tile <= 3; tile += 1) speckleTile(surface, tile, tile + 1, tile + 4, 0x544f574e + tile, 18);
  for (let tile = 4; tile <= 7; tile += 1) { frameTile(surface, tile, tile - 1, 5, 1); lineTile(surface, tile, [1, 5 + (tile % 3)], [14, 10], 6); }
  for (let tile = 8; tile <= 15; tile += 1) speckleTile(surface, tile, 2 + tile % 3, 5 + tile % 2, 0x2000 + tile, 12);
  drawTownSpecial(surface);
  for (let tile = 25; tile <= 31; tile += 1) {
    speckleTile(surface, tile, 14 + tile % 3, 17, 0x3000 + tile, 8);
    glyphTile(surface, tile, 10, [[7, 3], [7, 4], [7, 5], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [7, 9], [7, 10], [7, 11]]);
  }
  drawTownAutotiles(surface);
  drawTownStructures(surface);
  drawTownDecor(surface);
  return surface;
}

export function assertTownTilesetContract(surface: PixelSurface = ensureTownTileset()): void {
  assertMapTilesetContract(surface);
  assertTilesTransparent(surface, TOWN_UNALLOCATED_TILE_RANGES);
}

function ensureTownTileset(): PixelSurface {
  if (!cachedTownTileset) {
    cachedTownTileset = buildTownTileset();
    assertTownTilesetContract(cachedTownTileset);
    townContractVerified = true;
  }
  return cachedTownTileset;
}

export function createTownTileset(): PixelSurface {
  const source = ensureTownTileset();
  // 返回副本，变异负例不能污染缓存中的正式像素面。
  return { width: source.width, height: source.height, data: new Uint8Array(source.data) };
}

export function isTownTilesetContractCached(): boolean { return townContractVerified; }
