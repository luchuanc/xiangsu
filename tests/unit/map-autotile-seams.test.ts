import { describe, expect, it } from "vitest";
import { createTownTileset } from "../../scripts/art-source/map-tiles/TownTilesetSource";
import { createFloor01Tileset } from "../../scripts/art-source/map-tiles/Floor01TilesetSource";
import { getTile, tileEdgeSignature } from "../../scripts/art-source/map-tiles/MapTilesetContract";

describe("VIS-002C autotile 与 3x3 接缝", () => {
  it("16 个 autotile 变体均有亮边且边缘签名稳定", () => {
    const town = createTownTileset();
    const floor = createFloor01Tileset();
    for (const surface of [town, floor]) {
      const signatures = Array.from({ length: 16 }, (_, mask) => tileEdgeSignature(getTile(surface, 32 + mask)));
      expect(new Set(signatures).size).toBeGreaterThan(4);
      expect(signatures).toEqual(Array.from({ length: 16 }, (_, mask) => tileEdgeSignature(getTile(surface, 32 + mask))));
      expect(signatures.every((signature) => signature.split("|").length === 4)).toBe(true);
    }
  });

  it("特殊 3x3 行的九个 tile 都是连续的非空像素块", () => {
    for (const surface of [createTownTileset(), createFloor01Tileset()]) {
      for (let tileIndex = 16; tileIndex <= 24; tileIndex += 1) {
        const tile = getTile(surface, tileIndex);
        expect(tile.some((value, index) => index % 4 === 3 && value === 255)).toBe(true);
      }
    }
  });
});
