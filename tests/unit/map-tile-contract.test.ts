import { describe, expect, it } from "vitest";
import { createPixelSurface } from "../../scripts/art-source/map-tiles/PixelSurface";
import {
  AUTOTILE_EDGE_BITS,
  MAP_TILESET_HEIGHT,
  MAP_TILESET_WIDTH,
  TILE_SIZE,
  autotileEdgeExposure,
  assertMapTilesetContract,
  tileIndexRange,
} from "../../scripts/art-source/map-tiles/MapTilesetContract";

describe("VIS-002C 地图 tileset 合同", () => {
  it("固定为 256x256、16x16 tile，且透明像素保持 0000", () => {
    const surface = createPixelSurface(MAP_TILESET_WIDTH, MAP_TILESET_HEIGHT);
    expect(() => assertMapTilesetContract(surface)).not.toThrow();
    expect(surface.width / TILE_SIZE).toBe(16);
    expect(surface.height / TILE_SIZE).toBe(16);
    expect(Array.from(surface.data).every((value, index) => index % 4 === 3 ? value === 0 : value === 0)).toBe(true);
  });

  it("固定索引分区，未分配的区间不能误用已分配索引", () => {
    expect(tileIndexRange("base")).toEqual([0, 7]);
    expect(tileIndexRange("surface")).toEqual([8, 15]);
    expect(tileIndexRange("special")).toEqual([16, 24]);
    expect(tileIndexRange("nodes")).toEqual([25, 31]);
    expect(tileIndexRange("autotile")).toEqual([32, 47]);
    expect(tileIndexRange("structure")).toEqual([48, 63]);
    expect(tileIndexRange("decorBack")).toEqual([64, 79]);
    expect(tileIndexRange("decorFront")).toEqual([80, 95]);
    expect(tileIndexRange("reserved")).toEqual([96, 255]);
  });

  it("冻结 autotile 方向位：N1/E2/S4/W8，16 个 mask 均可独立解释", () => {
    expect(AUTOTILE_EDGE_BITS).toEqual({ north: 1, east: 2, south: 4, west: 8 });
    for (let mask = 0; mask <= 15; mask += 1) {
      expect(autotileEdgeExposure(mask)).toEqual({
        north: (mask & 1) !== 0,
        east: (mask & 2) !== 0,
        south: (mask & 4) !== 0,
        west: (mask & 8) !== 0,
      });
    }
    expect(() => autotileEdgeExposure(16)).toThrow("MAP_AUTOTILE_MASK_INVALID");
  });
});
