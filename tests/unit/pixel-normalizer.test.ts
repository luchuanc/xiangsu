import { describe, expect, it } from "vitest";
import {
  FRONTIER_NIGHT_32_V1,
  normalizeRgba,
  paletteRgb,
  normalizedPixelSha256,
} from "../../scripts/art-pack/PixelNormalizer";

describe("pixel normalizer", () => {
  it("uses alpha 127/128 threshold and zeroes transparent RGB", () => {
    const output = normalizeRgba(2, 1, new Uint8Array([
      255, 0, 0, 127,
      255, 0, 0, 128,
    ]));

    expect([...output]).toEqual([
      0, 0, 0, 0,
      ...paletteRgb(FRONTIER_NIGHT_32_V1[30]), 255,
    ]);
  });

  it("maps exact palette colors without changing them", () => {
    const first = paletteRgb(FRONTIER_NIGHT_32_V1[0]);
    const last = paletteRgb(FRONTIER_NIGHT_32_V1[31]);
    expect([...normalizeRgba(2, 1, new Uint8Array([...first, 255, ...last, 255]))]).toEqual([
      ...first, 255, ...last, 255,
    ]);
  });

  it("breaks equal-distance mapping toward the earlier palette index", () => {
    const earlier = paletteRgb(FRONTIER_NIGHT_32_V1[1]);
    const output = normalizeRgba(1, 1, new Uint8Array([0, 7, 93, 255]));
    expect([...output]).toEqual([...earlier, 255]);
  });

  it("outputs only binary alpha and the fixed 32-color palette", () => {
    const output = normalizeRgba(3, 1, new Uint8Array([
      1, 2, 3, 0,
      245, 244, 243, 64,
      12, 200, 99, 255,
    ]));
    const palette = new Set(FRONTIER_NIGHT_32_V1.flatMap((hex) => paletteRgb(hex).join(",")));
    for (let index = 0; index < output.length; index += 4) {
      expect(output[index + 3] === 0 || output[index + 3] === 255).toBe(true);
      if (output[index + 3] === 0) expect([...output.slice(index, index + 3)]).toEqual([0, 0, 0]);
      else expect(palette.has([...output.slice(index, index + 3)].join(","))).toBe(true);
    }
  });

  it("changes pixel hash when a single normalized pixel changes", () => {
    const a = normalizeRgba(1, 1, new Uint8Array([0, 0, 0, 255]));
    const b = normalizeRgba(1, 1, new Uint8Array([255, 255, 255, 255]));
    expect(normalizedPixelSha256(1, 1, a)).not.toBe(normalizedPixelSha256(1, 1, b));
  });

  it("rejects raw buffers whose length does not match dimensions", () => {
    expect(() => normalizeRgba(2, 2, new Uint8Array(3))).toThrow("ART_PACK_PIXEL_SIZE_INVALID");
  });
});
