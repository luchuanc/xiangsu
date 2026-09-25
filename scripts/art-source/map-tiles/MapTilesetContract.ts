import { FRONTIER_NIGHT_32_V1, paletteRgb } from "../../art-pack/PixelNormalizer";
import type { PixelSurface } from "./PixelSurface";

export const MAP_TILESET_WIDTH = 256 as const;
export const MAP_TILESET_HEIGHT = 256 as const;
export const TILE_SIZE = 16 as const;
export const MAP_TILESET_COLUMNS = 16 as const;
export const MAP_TILESET_ROWS = 16 as const;
export const MAP_TILESET_PALETTE_ID = "FRONTIER_NIGHT_32_V1" as const;

export const TILE_RANGES = {
  base: [0, 7],
  surface: [8, 15],
  special: [16, 24],
  nodes: [25, 31],
  autotile: [32, 47],
  structure: [48, 63],
  decorBack: [64, 79],
  decorFront: [80, 95],
  reserved: [96, 255],
} as const;

/** autotile 的方向位必须和地图视觉 builder 使用同一套约定。 */
export const AUTOTILE_EDGE_BITS = Object.freeze({
  north: 1,
  east: 2,
  south: 4,
  west: 8,
} as const);

export function autotileEdgeExposure(mask: number): Readonly<{ north: boolean; east: boolean; south: boolean; west: boolean }> {
  if (!Number.isInteger(mask) || mask < 0 || mask > 15) throw new RangeError("MAP_AUTOTILE_MASK_INVALID");
  return {
    north: (mask & AUTOTILE_EDGE_BITS.north) !== 0,
    east: (mask & AUTOTILE_EDGE_BITS.east) !== 0,
    south: (mask & AUTOTILE_EDGE_BITS.south) !== 0,
    west: (mask & AUTOTILE_EDGE_BITS.west) !== 0,
  };
}

export type TileRangeName = keyof typeof TILE_RANGES;

export const MAP_TILESET_CONTRACT = Object.freeze({
  width: MAP_TILESET_WIDTH,
  height: MAP_TILESET_HEIGHT,
  tileWidth: TILE_SIZE,
  tileHeight: TILE_SIZE,
  paletteId: MAP_TILESET_PALETTE_ID,
  alphaValues: [0, 255] as const,
  tileRanges: TILE_RANGES,
});

const PALETTE_RGB = new Set(FRONTIER_NIGHT_32_V1.map(paletteRgb).map((rgb) => rgb.join(",")));

export function tileIndexRange(name: TileRangeName): readonly [number, number] {
  return TILE_RANGES[name];
}

export function tileIndex(column: number, row: number): number {
  if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || column >= MAP_TILESET_COLUMNS || row < 0 || row >= MAP_TILESET_ROWS) throw new RangeError("MAP_TILE_INDEX_INVALID");
  return row * MAP_TILESET_COLUMNS + column;
}

export function tileRect(tile: number): { x: number; y: number; width: number; height: number } {
  if (!Number.isInteger(tile) || tile < 0 || tile >= 256) throw new RangeError("MAP_TILE_INDEX_INVALID");
  return { x: (tile % MAP_TILESET_COLUMNS) * TILE_SIZE, y: Math.floor(tile / MAP_TILESET_COLUMNS) * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
}

export function getTile(surface: PixelSurface, tile: number): Uint8Array {
  if (surface.width !== MAP_TILESET_WIDTH || surface.height !== MAP_TILESET_HEIGHT) throw new RangeError("MAP_TILESET_SIZE_INVALID");
  const rect = tileRect(tile);
  const output = new Uint8Array(TILE_SIZE * TILE_SIZE * 4);
  for (let row = 0; row < TILE_SIZE; row += 1) {
    const sourceStart = ((rect.y + row) * surface.width + rect.x) * 4;
    output.set(surface.data.subarray(sourceStart, sourceStart + TILE_SIZE * 4), row * TILE_SIZE * 4);
  }
  return output;
}

export function setTile(surface: PixelSurface, tile: number, pixels: Uint8Array): void {
  if (pixels.length !== TILE_SIZE * TILE_SIZE * 4) throw new RangeError("MAP_TILE_PIXELS_INVALID");
  const rect = tileRect(tile);
  for (let row = 0; row < TILE_SIZE; row += 1) {
    const destinationStart = ((rect.y + row) * surface.width + rect.x) * 4;
    surface.data.set(pixels.subarray(row * TILE_SIZE * 4, (row + 1) * TILE_SIZE * 4), destinationStart);
  }
}

export function tileEdgeSignature(pixels: Uint8Array): string {
  if (pixels.length !== TILE_SIZE * TILE_SIZE * 4) throw new RangeError("MAP_TILE_PIXELS_INVALID");
  const edge = (offset: number, step: number): string => {
    const colors: string[] = [];
    for (let index = 0; index < TILE_SIZE; index += 1) {
      const pixel = offset + index * step;
      colors.push(`${pixels[pixel]!.toString(16).padStart(2, "0")}${pixels[pixel + 1]!.toString(16).padStart(2, "0")}${pixels[pixel + 2]!.toString(16).padStart(2, "0")}${pixels[pixel + 3]!.toString(16).padStart(2, "0")}`);
    }
    return colors.join("");
  };
  return `${edge(0, 4)}|${edge((TILE_SIZE - 1) * TILE_SIZE * 4, 4)}|${edge(0, TILE_SIZE * 4)}|${edge((TILE_SIZE - 1) * 4, TILE_SIZE * 4)}`;
}

export function assertMapTilesetContract(surface: PixelSurface): void {
  if (surface.width !== MAP_TILESET_WIDTH || surface.height !== MAP_TILESET_HEIGHT || surface.data.length !== MAP_TILESET_WIDTH * MAP_TILESET_HEIGHT * 4) throw new Error("MAP_TILESET_SIZE_INVALID");
  for (let offset = 0; offset < surface.data.length; offset += 4) {
    const alpha = surface.data[offset + 3]!;
    if (alpha !== 0 && alpha !== 255) throw new Error("MAP_TILESET_ALPHA_INVALID");
    if (alpha === 0 && (surface.data[offset] !== 0 || surface.data[offset + 1] !== 0 || surface.data[offset + 2] !== 0)) throw new Error("MAP_TILESET_TRANSPARENT_RGB_INVALID");
    if (alpha === 255 && !PALETTE_RGB.has(`${surface.data[offset]},${surface.data[offset + 1]},${surface.data[offset + 2]}`)) throw new Error("MAP_TILESET_PALETTE_INVALID");
  }
  for (let tile = TILE_RANGES.reserved[0]; tile <= TILE_RANGES.reserved[1]; tile += 1) {
    if (getTile(surface, tile).some((value, index) => index % 4 === 3 && value !== 0)) throw new Error(`MAP_TILESET_RESERVED_REFERENCED:${tile}`);
  }
}

export function assertTilesTransparent(surface: PixelSurface, ranges: readonly (readonly [number, number])[]): void {
  for (const [start, end] of ranges) for (let tile = start; tile <= end; tile += 1) {
    if (getTile(surface, tile).some((value, index) => index % 4 === 3 && value !== 0)) throw new Error(`MAP_TILESET_UNALLOCATED_FILLED:${tile}`);
  }
}

export function exposedMask(collision: readonly (0 | 1)[], width: number, height: number, x: number, y: number): number {
  const at = (column: number, row: number): boolean => column >= 0 && row >= 0 && column < width && row < height && collision[row * width + column] === 0;
  return (at(x, y - 1) ? 1 : 0) | (at(x + 1, y) ? 2 : 0) | (at(x, y + 1) ? 4 : 0) | (at(x - 1, y) ? 8 : 0);
}
