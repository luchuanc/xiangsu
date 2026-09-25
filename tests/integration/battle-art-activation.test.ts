import { describe, expect, it } from "vitest";
import {
  candidateAssetManifest,
  fixtureAssetManifest,
  floors02To05AssetManifest,
  verticalSliceAssetManifest,
} from "../../src/content/data/assets.manifest";

const FORMAL_BATTLE_ASSET_IDS = [
  "sprite_battle_char_wanderer",
  "sprite_battle_char_iron_guard",
  "sprite_battle_char_ember_mage",
  "sprite_battle_char_priest",
  "sprite_battle_enemy_grass_slime",
  "sprite_battle_enemy_thorn_rat",
  "sprite_battle_enemy_fang_wolf",
  "sprite_battle_enemy_goblin_scout",
  "sprite_battle_enemy_stonehide_boar",
  "sprite_battle_boss_horned_king",
] as const;

const FORMAL_SOURCE_NOTE = "确定性手工像素绘制的 battle actor sheet，项目原创。";

function assetById(manifest: typeof floors02To05AssetManifest, id: string) {
  return manifest.assets.find((asset) => asset.id === id);
}

describe("VIS-004B battle actor runtime activation", () => {
  it("verticalSlice 与累计正式 manifest 激活十个 battle actor 正式 URL", () => {
    for (const manifest of [verticalSliceAssetManifest, floors02To05AssetManifest]) {
      for (const id of FORMAL_BATTLE_ASSET_IDS) {
        const asset = assetById(manifest, id);
        const boss = id === "sprite_battle_boss_horned_king";
        expect(asset).toMatchObject({
          kind: "battleActorSheet",
          id,
          src: `/assets/visual/v1/battle/${id}.png`,
          frameWidth: boss ? 64 : 48,
          frameHeight: boss ? 64 : 48,
          columns: 27,
          rows: 1,
          source: {
            sourceKind: "original",
            sourceNote: FORMAL_SOURCE_NOTE,
            licenseId: "project-original",
          },
        });
      }
    }
  });

  it("fixture/candidate 仍保持 38 项旧占位资源且不被 battle 正式 URL 污染", () => {
    expect(fixtureAssetManifest.assets).toHaveLength(38);
    expect(candidateAssetManifest.assets).toHaveLength(38);
    expect(fixtureAssetManifest.assets).toEqual(candidateAssetManifest.assets);
    for (const id of FORMAL_BATTLE_ASSET_IDS) {
      expect(fixtureAssetManifest.assets.some((asset) => asset.id === id)).toBe(false);
      expect(candidateAssetManifest.assets.some((asset) => asset.id === id)).toBe(false);
    }
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
});

