import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import mapArtGolden from "../../art/visual/v1/map-art.golden.json";
import { TILE_SIZE, getTile, setTile, tileEdgeSignature } from "../../scripts/art-source/map-tiles/MapTilesetContract";
import { assertTownTilesetContract, createTownTileset, TOWN_UNALLOCATED_TILE_RANGES } from "../../scripts/art-source/map-tiles/TownTilesetSource";
import { assertFloor01TilesetContract, createFloor01Tileset, FLOOR01_UNALLOCATED_TILE_RANGES } from "../../scripts/art-source/map-tiles/Floor01TilesetSource";

function tileAlpha(surface: ReturnType<typeof createTownTileset>, tileIndex: number): number {
  const tile = getTile(surface, tileIndex);
  let opaque = 0;
  for (let index = 3; index < tile.length; index += 4) if (tile[index] === 255) opaque += 1;
  return opaque;
}

function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function edgeDigest(surface: ReturnType<typeof createTownTileset>): string {
  return sha256(JSON.stringify(Array.from({ length: 16 }, (_, mask) => tileEdgeSignature(getTile(surface, 32 + mask)))));
}
function assertGolden(actual: string, expected: string): void {
  if (actual !== expected) throw new Error("MAP_TILESET_GOLDEN_MISMATCH");
}

describe("VIS-002C town/floor01 tileset source", () => {
  it("生成两张确定性的 32 色、二值 alpha tileset", () => {
    const town = createTownTileset();
    const floor = createFloor01Tileset();
    assertTownTilesetContract(town);
    assertFloor01TilesetContract(floor);
    expect(Buffer.from(town.data)).toEqual(Buffer.from(createTownTileset().data));
    expect(Buffer.from(floor.data)).toEqual(Buffer.from(createFloor01Tileset().data));
    expect(tileAlpha(town, 0)).toBeGreaterThan(0);
    expect(tileAlpha(floor, 0)).toBeGreaterThan(0);
    expect(tileAlpha(town, 96)).toBe(0);
    expect(tileAlpha(floor, 255)).toBe(0);
    expect(TILE_SIZE).toBe(16);
    expect(sha256(town.data)).toBe(mapArtGolden.tilesets.town.rawPixelSha256);
    expect(sha256(floor.data)).toBe(mapArtGolden.tilesets.floor_01.rawPixelSha256);
    expect(edgeDigest(town)).toBe(mapArtGolden.tilesets.town.autotileEdgeSha256);
    expect(edgeDigest(floor)).toBe(mapArtGolden.tilesets.floor_01.autotileEdgeSha256);
  });

  it("北门、出生徽记、Boss/精英/宝箱节点使用正式 tile", () => {
    const town = createTownTileset();
    const floor = createFloor01Tileset();
    expect(tileAlpha(town, 16)).toBeGreaterThan(0);
    expect(tileAlpha(town, 25)).toBeGreaterThan(0);
    expect(tileAlpha(floor, 16)).toBeGreaterThan(0);
    expect(tileAlpha(floor, 25)).toBeGreaterThan(0);
    expect(tileAlpha(floor, 28)).toBeGreaterThan(0);
    expect(TOWN_UNALLOCATED_TILE_RANGES).toEqual([[72, 79], [92, 95]]);
    expect(FLOOR01_UNALLOCATED_TILE_RANGES).toEqual([[72, 79], [91, 95]]);
  });

  it("独立拒绝 reserved/未分配槽写入，交换 autotile N/E 后不再命中 golden", () => {
    const town = createTownTileset();
    const filledTile = getTile(town, 0);
    setTile(town, 72, filledTile);
    expect(() => assertTownTilesetContract(town)).toThrow("MAP_TILESET_UNALLOCATED_FILLED:72");
    const reservedTown = createTownTileset();
    setTile(reservedTown, 96, filledTile);
    expect(() => assertTownTilesetContract(reservedTown)).toThrow("MAP_TILESET_RESERVED_REFERENCED:96");

    const swapped = createTownTileset();
    const pixels = getTile(swapped, 33);
    for (let i = 0; i < TILE_SIZE * 4; i += 4) {
      const north = i;
      const east = (i / 4 * TILE_SIZE + (TILE_SIZE - 1)) * 4;
      [pixels[north], pixels[east]] = [pixels[east]!, pixels[north]!];
    }
    setTile(swapped, 33, pixels);
    expect(() => assertGolden(edgeDigest(swapped), mapArtGolden.tilesets.town.autotileEdgeSha256)).toThrow("MAP_TILESET_GOLDEN_MISMATCH");

    const floor = createFloor01Tileset();
    const floorFilledTile = getTile(floor, 0);
    setTile(floor, 72, floorFilledTile);
    expect(() => assertFloor01TilesetContract(floor)).toThrow("MAP_TILESET_UNALLOCATED_FILLED:72");
    const reservedFloor = createFloor01Tileset();
    setTile(reservedFloor, 96, floorFilledTile);
    expect(() => assertFloor01TilesetContract(reservedFloor)).toThrow("MAP_TILESET_RESERVED_REFERENCED:96");
    const swappedFloor = createFloor01Tileset();
    const floorPixels = getTile(swappedFloor, 33);
    for (let i = 0; i < TILE_SIZE * 4; i += 4) {
      const north = i;
      const east = (i / 4 * TILE_SIZE + (TILE_SIZE - 1)) * 4;
      [floorPixels[north], floorPixels[east]] = [floorPixels[east]!, floorPixels[north]!];
    }
    setTile(swappedFloor, 33, floorPixels);
    expect(() => assertGolden(edgeDigest(swappedFloor), mapArtGolden.tilesets.floor_01.autotileEdgeSha256)).toThrow("MAP_TILESET_GOLDEN_MISMATCH");
  });
});
