import { describe, expect, it } from "vitest";
import {
  candidateAssetManifest,
  floors02To05AssetManifest,
  floors06To10AssetManifest,
  fixtureAssetManifest,
  verticalSliceAssetManifest,
} from "../../src/content/data/assets.manifest";

const FORMAL_FIELD_ASSET_IDS = [
  "sprite_field_char_wanderer",
  "sprite_field_char_iron_guard",
  "sprite_field_char_ember_mage",
  "sprite_field_char_priest",
  "sprite_field_char_ranger",
  "sprite_field_char_frost_seer",
  "sprite_npc_tavern_keeper",
  "sprite_npc_blacksmith",
  "sprite_npc_skill_mentor",
  "sprite_npc_merchant",
  "sprite_npc_innkeeper",
  "sprite_npc_cartographer",
  "sprite_npc_abyss_watcher",
  "sprite_field_encounter_floor_01_normal_a",
  "sprite_field_encounter_floor_01_normal_b",
  "sprite_field_encounter_floor_01_normal_c",
  "sprite_field_encounter_floor_01_elite_boar",
  "sprite_field_encounter_floor_01_boss",
] as const;

const FORMAL_SOURCE_NOTE = "确定性手工像素绘制的 field actor sheet，项目原创。";

function assetById(manifest: typeof floors02To05AssetManifest, id: string) {
  return manifest.assets.find((asset) => asset.id === id);
}

describe("VIS-002E field actor runtime activation", () => {
  it("累计正式 manifest 激活全部 18 个 field actor URL 与来源", () => {
    for (const id of FORMAL_FIELD_ASSET_IDS) {
      const asset = assetById(floors02To05AssetManifest, id);
      expect(asset).toMatchObject({
        kind: "fieldActorSheet",
        id,
        src: `/assets/visual/v1/field/${id}.png`,
        frameWidth: 24,
        frameHeight: 32,
        columns: 10,
        rows: 4,
        source: {
          sourceKind: "original",
          sourceNote: FORMAL_SOURCE_NOTE,
          licenseId: "project-original",
        },
      });
    }
  });

  it("fixture/candidate 保留原 38 项清单与 __fixture__ 路径", () => {
    expect(fixtureAssetManifest.assets).toHaveLength(38);
    expect(candidateAssetManifest.assets).toHaveLength(38);
    expect(fixtureAssetManifest.assets).toEqual(candidateAssetManifest.assets);
    expect(fixtureAssetManifest.assets.every((asset) => {
      const sources = "src" in asset
        ? [asset.src]
        : asset.kind === "atlas"
          ? [asset.imageSrc, asset.dataSrc]
          : asset.kind === "bitmapFont"
            ? [asset.descriptorSrc, asset.textureSrc]
            : asset.kind === "audio"
              ? [asset.oggSrc, asset.mp3Src]
              : [];
      return sources.every((source) => source.startsWith("__fixture__/"));
    })).toBe(true);
  });

  it("未入选的第 2～10 层遭遇仍保持原楼层资源路径", () => {
    const formalIds = new Set<string>(FORMAL_FIELD_ASSET_IDS);
    for (const manifest of [floors02To05AssetManifest, floors06To10AssetManifest]) {
      for (const asset of manifest.assets) {
        if (asset.kind !== "fieldActorSheet" || formalIds.has(asset.id)) continue;
        expect(asset.src).not.toMatch(/^\/assets\/visual\/v1\/field\//);
        expect(asset.src).toMatch(/^\/assets\/floors\/(02-05|06-10)\/field\//);
      }
    }
  });

  it("verticalSlice 只激活本批次可用的 14 个 field actor，不改变资源数量", () => {
    const ids = verticalSliceAssetManifest.assets.filter((asset) => asset.kind === "fieldActorSheet").map((asset) => asset.id);
    expect(ids).toHaveLength(14);
    for (const id of ids) {
      const asset = assetById(verticalSliceAssetManifest as typeof floors02To05AssetManifest, id);
      if (asset?.kind !== "fieldActorSheet") throw new Error(`缺少 field actor: ${id}`);
      expect(asset.src).toBe(`/assets/visual/v1/field/${id}.png`);
    }
  });
});
