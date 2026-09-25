import { FRONTIER_NIGHT_32_V1, paletteRgb } from "../../art-pack/PixelNormalizer";
import { drawLine, drawRect, fillRect, type PixelSurface, setPixel } from "./PixelSurface";
import { TILE_SIZE, tileRect } from "./MapTilesetContract";

const COLORS = FRONTIER_NIGHT_32_V1.map(paletteRgb);

export function color(index: number): readonly [number, number, number, number] {
  if (!Number.isInteger(index) || index < 0 || index >= COLORS.length) throw new RangeError("MAP_TILE_COLOR_INVALID");
  const rgb = COLORS[index]!;
  return [rgb[0], rgb[1], rgb[2], 255];
}

export function transparent(): readonly [number, number, number, number] { return [0, 0, 0, 0]; }

export function tilePixel(surface: PixelSurface, tile: number, x: number, y: number, rgba: readonly [number, number, number, number]): void {
  const rect = tileRect(tile);
  setPixel(surface, rect.x + x, rect.y + y, rgba);
}

export function fillTile(surface: PixelSurface, tile: number, colorIndex: number): void {
  const rect = tileRect(tile);
  fillRect(surface, rect.x, rect.y, TILE_SIZE, TILE_SIZE, color(colorIndex));
}

export function frameTile(surface: PixelSurface, tile: number, fillColor: number, edgeColor: number, thickness = 1): void {
  fillTile(surface, tile, fillColor);
  const rect = tileRect(tile);
  drawRect(surface, rect.x, rect.y, TILE_SIZE, TILE_SIZE, color(edgeColor), thickness);
}

export function speckleTile(surface: PixelSurface, tile: number, baseColor: number, speckColor: number, seed: number, density = 18): void {
  fillTile(surface, tile, baseColor);
  const rect = tileRect(tile);
  let state = seed >>> 0;
  for (let count = 0; count < density; count += 1) {
    state = Math.imul(state ^ 0x9e3779b9, 1664525) + 1013904223 >>> 0;
    const x = state % TILE_SIZE;
    state = Math.imul(state ^ 0x85ebca6b, 2246822519) >>> 0;
    const y = state % TILE_SIZE;
    setPixel(surface, rect.x + x, rect.y + y, color(speckColor));
  }
}

export function lineTile(surface: PixelSurface, tile: number, from: readonly [number, number], to: readonly [number, number], colorIndex: number): void {
  const rect = tileRect(tile);
  drawLine(surface, rect.x + from[0], rect.y + from[1], rect.x + to[0], rect.y + to[1], color(colorIndex));
}

export function glyphTile(surface: PixelSurface, tile: number, colorIndex: number, points: readonly (readonly [number, number])[]): void {
  for (const [x, y] of points) tilePixel(surface, tile, x, y, color(colorIndex));
}

export function copyTilePattern(surface: PixelSurface, tile: number, source: readonly number[], colors: readonly [number, number]): void {
  const rect = tileRect(tile);
  for (let y = 0; y < TILE_SIZE; y += 1) for (let x = 0; x < TILE_SIZE; x += 1) {
    const value = source[(y * TILE_SIZE + x) % source.length]!;
    setPixel(surface, rect.x + x, rect.y + y, color(value === 0 ? colors[0] : colors[1]));
  }
}
