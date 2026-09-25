import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import mapArtGolden from "../../art/visual/v1/map-art.golden.json";
import { parseArtPackConfig } from "../../scripts/art-pack/ArtPackSchema";
import {
  candidateAssetManifest,
  floors02To05AssetManifest,
  floors06To10AssetManifest,
  fixtureAssetManifest,
  verticalSliceAssetManifest,
} from "../../src/content/data/assets.manifest";

describe("VIS-002C map art pack", () => {
  it("只声明 town/floor01 两张正式地图 tileset", async () => {
    const config = parseArtPackConfig(JSON.parse(await fs.readFile(path.resolve("art/visual/v1/art-pack.json"), "utf8")) as unknown);
    const mapEntries = config.entries.filter((entry) => entry.kind === "mapTileset");
    expect(mapEntries.map((entry) => entry.assetId)).toEqual(["tileset_map_town", "tileset_map_floor_01"]);
    for (const entry of mapEntries) {
      expect(entry.kind).toBe("mapTileset");
      if (entry.kind !== "mapTileset") continue;
      expect(entry.width).toBe(256);
      expect(entry.height).toBe(256);
      expect(entry.tileWidth).toBe(16);
      expect(entry.tileHeight).toBe(16);
      const metadata = await sharp(path.resolve("art/visual/v1/input", entry.input)).metadata();
      expect(metadata.width).toBe(256);
      expect(metadata.height).toBe(256);
    }
  });

  it("golden 文件字段严格冻结且不依赖被测生产模块常量", () => {
    expect(Object.keys(mapArtGolden).sort()).toEqual(["contactSheet", "paletteId", "schemaVersion", "tileSize", "tilesets", "visualLayers"]);
    expect(mapArtGolden.schemaVersion).toBe(1);
    expect(mapArtGolden.paletteId).toBe("FRONTIER_NIGHT_32_V1");
    expect(mapArtGolden.tileSize).toBe(16);
    expect(Object.keys(mapArtGolden.tilesets).sort()).toEqual(["floor_01", "town"]);
    for (const entry of Object.values(mapArtGolden.tilesets)) expect(Object.keys(entry).sort()).toEqual(["autotileEdgeSha256", "rawPixelSha256"]);
    expect(Object.keys(mapArtGolden.visualLayers).sort()).toEqual(["map_floor_01", "map_town"]);
    for (const entry of Object.values(mapArtGolden.visualLayers)) expect(Object.keys(entry)).toEqual(["sha256"]);
    expect(Object.keys(mapArtGolden.contactSheet)).toEqual(["sha256"]);
  });

  it("publish 字节与 input 一致，联系图分区版本固定", async () => {
    const town = await fs.readFile(path.resolve("art/visual/v1/input/maps/town.png"));
    const floor = await fs.readFile(path.resolve("art/visual/v1/input/maps/floor_01.png"));
    expect(await fs.readFile(path.resolve("public/assets/visual/v1/maps/town.png"))).toEqual(town);
    expect(await fs.readFile(path.resolve("public/assets/visual/v1/maps/floor_01.png"))).toEqual(floor);
    const contact = await fs.readFile(path.resolve("docs/art-source/review/vis-002c-map-contact-sheet.png"));
    expect(createHash("sha256").update(contact).digest("hex")).toBe(mapArtGolden.contactSheet.sha256);
  });

  it("正式地图只激活两项 visual/v1，累计清单继承 URL，fixture/candidate 保持旧占位契约", () => {
    const expected = [
      ["tileset_map_town", "town", "确定性手工像素绘制的城镇 tileset，项目原创。"],
      ["tileset_map_floor_01", "floor_01", "确定性手工像素绘制的第一层 tileset，项目原创。"],
    ] as const;
    for (const manifest of [verticalSliceAssetManifest, floors02To05AssetManifest, floors06To10AssetManifest]) {
      for (const [assetId, bundleId, sourceNote] of expected) {
        const asset = manifest.assets.find((entry) => entry.id === assetId);
        expect(asset).toMatchObject({
          kind: "mapTileset",
          bundleId,
          src: `/assets/visual/v1/maps/${bundleId}.png`,
          tileSize: 16,
          columns: 16,
          rows: 16,
          source: { sourceKind: "original", licenseId: "project-original", sourceNote },
        });
        expect(asset?.kind === "mapTileset" ? asset.src : "").not.toContain("placeholder");
      }
    }

    for (const manifest of [fixtureAssetManifest, candidateAssetManifest]) {
      expect(manifest.assets).toHaveLength(38);
      expect(manifest.assets.find((entry) => entry.id === "tileset_map_town")).toMatchObject({
        src: "__fixture__/maps/town.png",
        source: { sourceKind: "generated", licenseId: "project-original-placeholder" },
      });
      expect(manifest.assets.find((entry) => entry.id === "tileset_map_floor_01")).toMatchObject({
        src: "__fixture__/maps/floor_01.png",
      });
    }
  });
});
