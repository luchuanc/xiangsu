import { createHash } from "node:crypto";

export const FRONTIER_NIGHT_32_V1 = [
  "#0D1429", "#151B31", "#202742", "#2A344A",
  "#364052", "#4A5364", "#687080", "#8A8F9A",
  "#B0B1B0", "#D6D0C2", "#F2E5CB",
  "#2B1B1D", "#4A2A25", "#6B3B2A", "#8F5634",
  "#B97945", "#D79A54", "#F2B35D", "#FFD98A",
  "#23362E", "#36503D", "#557553", "#72905F",
  "#9AAE73", "#183642", "#28505A", "#3F6B70",
  "#6F9290", "#5E2234", "#7C2E40", "#A93D4C",
  "#D65A62",
] as const;

export type Rgb = readonly [number, number, number];

export function paletteRgb(hex: string): Rgb {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) throw new Error(`ART_PACK_PALETTE_INVALID:${hex}`);
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

const PALETTE_RGB = FRONTIER_NIGHT_32_V1.map(paletteRgb);

function nearestPalette(red: number, green: number, blue: number): Rgb {
  let best = PALETTE_RGB[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of PALETTE_RGB) {
    const distance = (red - candidate[0]) ** 2 + (green - candidate[1]) ** 2 + (blue - candidate[2]) ** 2;
    // 只有严格更近才替换，距离相等自然保留更早的色板索引。
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

export function normalizeRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
    throw new Error("ART_PACK_PIXEL_SIZE_INVALID");
  }
  const output = new Uint8Array(rgba.length);
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index + 3] < 128) {
      output[index] = 0;
      output[index + 1] = 0;
      output[index + 2] = 0;
      output[index + 3] = 0;
      continue;
    }
    const [red, green, blue] = nearestPalette(rgba[index], rgba[index + 1], rgba[index + 2]);
    output[index] = red;
    output[index + 1] = green;
    output[index + 2] = blue;
    output[index + 3] = 255;
  }
  return output;
}

export function normalizedPixelSha256(width: number, height: number, rgba: Uint8Array): string {
  const header = Buffer.from(`${width}x${height}\u0000`, "utf8");
  return createHash("sha256").update(header).update(rgba).digest("hex");
}

export function paletteSha256(): string {
  return createHash("sha256").update(JSON.stringify(FRONTIER_NIGHT_32_V1)).digest("hex");
}
