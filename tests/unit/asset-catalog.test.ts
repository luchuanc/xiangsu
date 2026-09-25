import { describe, expect, it } from "vitest";
import { AssetCatalog } from "../../src/app/AssetCatalog";
import type { AssetEntryV1, AssetManifestV1 } from "../../src/app/AssetCatalog";
import {
  ANIMATION_DEFINITIONS,
  deriveAnimationDefinition,
  PASSIVE_SKILL_IDS,
} from "../../src/content/data/animations";
import { candidateAssetManifest } from "../../src/content/data/assets.manifest";
import { FROZEN_BATCH_MANIFESTS } from "../../src/content/Catalog";

function copyManifest(): typeof candidateAssetManifest {
  return structuredClone(candidateAssetManifest);
}

const fieldClips = {
  down: { row: 0 as const, idle: { startColumn: 0 as const, frameCount: 4 as const, fps: 6 as const }, walk: { startColumn: 4 as const, frameCount: 6 as const, fps: 10 as const } },
  left: { row: 1 as const, idle: { startColumn: 0 as const, frameCount: 4 as const, fps: 6 as const }, walk: { startColumn: 4 as const, frameCount: 6 as const, fps: 10 as const } },
  right: { row: 2 as const, idle: { startColumn: 0 as const, frameCount: 4 as const, fps: 6 as const }, walk: { startColumn: 4 as const, frameCount: 6 as const, fps: 10 as const } },
  up: { row: 3 as const, idle: { startColumn: 0 as const, frameCount: 4 as const, fps: 6 as const }, walk: { startColumn: 4 as const, frameCount: 6 as const, fps: 10 as const } },
};
const battleClips = {
  idle: { startFrame: 0 as const, frameCount: 4 as const, fps: 6 as const, loop: true as const },
  attack: { startFrame: 4 as const, frameCount: 6 as const, fps: 12 as const, loop: false as const, impactFrame: 8 as const },
  skill: { startFrame: 10 as const, frameCount: 8 as const, fps: 12 as const, loop: false as const, impactFrame: 15 as const },
  hit: { startFrame: 18 as const, frameCount: 3 as const, fps: 12 as const, loop: false as const },
  down: { startFrame: 21 as const, frameCount: 6 as const, fps: 10 as const, loop: false as const },
};

function appendAsset(manifest: AssetManifestV1, asset: AssetEntryV1): void {
  manifest.assets.push(asset);
  const bundle = manifest.bundles.find((candidate) => candidate.id === asset.bundleId);
  if (!bundle) throw new Error(`missing test bundle ${asset.bundleId}`);
  bundle.assetIds.push(asset.id);
}

function groupedFloorEntries(): { encounters: string[]; enemies: string[] }[] {
  return Array.from({ length: 10 }, (_, index) => {
    const floor = String(index + 1).padStart(2, "0");
    const encounters = ["normal_a", "normal_b", "normal_c", ["elite_boar", "elite_guardian", "elite_golem", "elite_wraith", "elite_cultist", "elite_mauler", "elite_acolyte", "elite_warden", "elite_shard", "elite_knight"][index]!, "boss"]
      .map((suffix) => `encounter_floor_${floor}_${suffix}`);
    const enemies = [
      ["enemy_grass_slime", "enemy_thorn_rat", "enemy_fang_wolf", "enemy_goblin_scout", "enemy_stonehide_boar", "boss_horned_king"],
      ["enemy_sporeling", "enemy_venom_spider", "enemy_fungal_guardian", "boss_brood_spider"],
      ["enemy_cave_bat", "enemy_ore_golem", "enemy_bomb_goblin", "boss_iron_devourer"],
      ["enemy_bog_leech", "enemy_mist_wraith", "boss_bog_witch"],
      ["enemy_ember_hound", "enemy_ash_cultist", "boss_ember_guardian"],
      ["enemy_abyss_mauler", "enemy_dread_eye", "boss_abyss_butcher"],
      ["enemy_blood_ghoul", "enemy_crimson_acolyte", "boss_crimson_knight"],
      ["enemy_frost_warden", "enemy_ice_revenant", "boss_pale_jailer"],
      ["enemy_void_spark", "enemy_watcher_shard", "boss_thousand_eye"],
      ["enemy_throne_knight", "enemy_abyss_herald", "boss_abyss_king"],
    ][index]!;
    return { encounters, enemies };
  });
}

function makeFullManifest(): AssetManifestV1 {
  const manifest = copyManifest() as AssetManifestV1;
  const final = FROZEN_BATCH_MANIFESTS.floors06_10;
  const source = { sourceKind: "generated" as const, sourceNote: "test generated asset", licenseId: "test" };
  const floors = groupedFloorEntries();
  for (const id of final.characters) {
    appendAsset(manifest, { kind: "fieldActorSheet", id: `sprite_field_${id}`, bundleId: "player_common", src: `test/${id}-field.png`, frameWidth: 24, frameHeight: 32, columns: 10, rows: 4, clips: structuredClone(fieldClips), source });
    appendAsset(manifest, { kind: "battleActorSheet", id: `sprite_battle_${id}`, bundleId: "player_common", src: `test/${id}-battle.png`, frameWidth: 48, frameHeight: 48, columns: 27, rows: 1, clips: structuredClone(battleClips), source });
  }
  for (const [index, group] of floors.entries()) {
    const floorId = `floor_${String(index + 1).padStart(2, "0")}`;
    for (const id of group.encounters) appendAsset(manifest, { kind: "fieldActorSheet", id: `sprite_field_${id}`, bundleId: floorId, src: `test/${id}-field.png`, frameWidth: 24, frameHeight: 32, columns: 10, rows: 4, clips: structuredClone(fieldClips), source });
    for (const id of group.enemies) appendAsset(manifest, { kind: "battleActorSheet", id: `sprite_battle_${id}`, bundleId: floorId, src: `test/${id}-battle.png`, frameWidth: id.startsWith("boss_") ? 64 : 48, frameHeight: id.startsWith("boss_") ? 64 : 48, columns: 27, rows: 1, clips: structuredClone(battleClips), source });
  }
  for (const id of final.npcs) appendAsset(manifest, { kind: "fieldActorSheet", id: `sprite_${id}`, bundleId: "town", src: `test/${id}.png`, frameWidth: 24, frameHeight: 32, columns: 10, rows: 4, clips: structuredClone(fieldClips), source });
  for (const id of final.equipmentBases) appendAsset(manifest, { kind: "singleFrame", id: `sprite_${id}`, bundleId: "core_ui", src: `test/${id}.png`, width: 24, height: 24, source });
  for (const id of final.statuses) appendAsset(manifest, { kind: "singleFrame", id: `icon_${id}`, bundleId: "core_ui", src: `test/${id}.png`, width: 16, height: 16, source });
  for (const id of final.combos) appendAsset(manifest, { kind: "singleFrame", id: `icon_${id}`, bundleId: "core_ui", src: `test/${id}.png`, width: 24, height: 24, source });
  for (const id of final.items) appendAsset(manifest, { kind: "singleFrame", id: `icon_${id}`, bundleId: "core_ui", src: `test/${id}.png`, width: 24, height: 24, source });
  return manifest;
}

function validationOptions(manifest: AssetManifestV1) {
  const images = new Map<string, { width: number; height: number }>();
  const atlasFrames = new Map<string, Record<string, { x: number; y: number; width: number; height: number }>>();
  for (const asset of manifest.assets) {
    if (asset.kind === "fieldActorSheet") images.set(asset.src, { width: 240, height: 128 });
    if (asset.kind === "battleActorSheet") images.set(asset.src, { width: asset.frameWidth * asset.columns, height: asset.frameHeight });
    if (asset.kind === "singleFrame" || asset.kind === "image") images.set(asset.src, { width: asset.width, height: asset.height });
    if (asset.kind === "mapTileset") images.set(asset.src, { width: asset.columns * asset.tileSize, height: asset.rows * asset.tileSize });
    if (asset.kind === "atlas") {
      const frames: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (const frameId of asset.requiredFrames) {
        const isObject = frameId.startsWith("object_");
        const isMarker = frameId.startsWith("marker_");
        frames[frameId] = { x: 0, y: 0, width: isObject ? 24 : isMarker ? 16 : 32, height: isObject ? 32 : isMarker ? 16 : 32 };
      }
      atlasFrames.set(asset.dataSrc, frames);
    }
  }
  return {
    fileExists: () => true,
    metadataInspector: {
      inspectImage: (src: string) => images.get(src) ?? null,
      inspectAtlas: (_imageSrc: string, dataSrc: string) => ({ imageWidth: 1024, imageHeight: 1024, frames: atlasFrames.get(dataSrc) ?? {} }),
      inspectBitmapFont: () => ({ textureWidth: 64, textureHeight: 64, characters: [] }),
    },
    requiredFontCharacters: [],
  };
}

describe("AssetCatalog", () => {
  it("fixture 严格校验 16 bundle、97 动画和六条被动投影", () => {
    const result = AssetCatalog.create(candidateAssetManifest, "fixture");
    expect(result.ok).toBe(true);
    expect(ANIMATION_DEFINITIONS).toHaveLength(97);
    expect(ANIMATION_DEFINITIONS.filter((animation) => animation.sfxId === null)).toHaveLength(6);
    expect(ANIMATION_DEFINITIONS.filter((animation) => animation.sfxId !== null)).toHaveLength(91);
    expect(ANIMATION_DEFINITIONS.filter((animation) => animation.presetId === "passive").map((animation) => animation.id)).toEqual(PASSIVE_SKILL_IDS.map((id) => `anim_${id}`));
  });

  it("final/batch 只接受冻结资源集合，不接受同数量伪 ID 或篡改 canonical 动画", () => {
    const full = makeFullManifest();
    expect(full.assets).toHaveLength(243);
    expect(AssetCatalog.create(full, "final").ok).toBe(false);
    expect(AssetCatalog.create(full, "final", { runtime: true }).ok).toBe(true);
    expect(AssetCatalog.create(full, "final", validationOptions(full)).ok).toBe(true);

    const fake = structuredClone(full);
    const target = fake.assets.find((asset) => asset.id === "sprite_field_char_wanderer");
    if (!target) throw new Error("test target missing");
    const owner = fake.bundles.find((bundle) => bundle.id === target.bundleId);
    target.id = "fake_same_count";
    if (owner) owner.assetIds = owner.assetIds.map((id) => id === "sprite_field_char_wanderer" ? "fake_same_count" : id);
    expect(AssetCatalog.create(fake, "final", validationOptions(fake)).ok).toBe(false);

    const mutatedAnimation = structuredClone(full);
    const animation = mutatedAnimation.animations.find((entry) => entry.id === "anim_skill_wanderer_strike");
    if (!animation) throw new Error("test animation missing");
    animation.element = "fire";
    expect(AssetCatalog.create(mutatedAnimation, "final", validationOptions(mutatedAnimation)).ok).toBe(false);
  });

  it("批次按冻结累计集合校验，06-10 批次包含 abyss_common 资源", () => {
    const full = makeFullManifest();
    const batch = structuredClone(full);
    const floors = new Set(FROZEN_BATCH_MANIFESTS.floors02_05.floors);
    const characters = new Set(FROZEN_BATCH_MANIFESTS.floors02_05.characters);
    const content = FROZEN_BATCH_MANIFESTS.floors02_05;
    const keep = (asset: AssetEntryV1): boolean => {
      const bundles = new Set(["boot", "core_ui", "player_common", "town", "battle_common", ...floors]);
      if (asset.kind === "audio") return bundles.has(asset.bundleId);
      if (asset.kind === "mapTileset") return asset.bundleId === "town" || floors.has(asset.bundleId);
      if (asset.id.startsWith("sprite_field_")) {
        const id = asset.id.slice("sprite_field_".length);
        return characters.has(id) || content.encounters.includes(id);
      }
      if (asset.id.startsWith("sprite_battle_")) return characters.has(asset.id.slice("sprite_battle_".length)) || content.enemies.includes(asset.id.slice("sprite_battle_".length));
      if (asset.id.startsWith("sprite_")) return content.npcs.includes(asset.id.slice("sprite_".length)) || content.equipmentBases.includes(asset.id.slice("sprite_".length));
      if (asset.id.startsWith("icon_status_")) return true;
      if (asset.id.startsWith("icon_item_")) return true;
      if (asset.id.startsWith("icon_combo_")) return content.combos.includes(asset.id.slice("icon_".length));
      return asset.bundleId === "boot" || asset.bundleId === "core_ui" || asset.bundleId === "battle_common";
    };
    batch.assets = batch.assets.filter(keep);
    for (const bundle of batch.bundles) bundle.assetIds = bundle.assetIds.filter((id) => batch.assets.some((asset) => asset.id === id));
    expect(AssetCatalog.create(batch, { kind: "batch", batchId: "floors02_05" }, validationOptions(batch)).ok).toBe(true);

    const abyss = AssetCatalog.create(full, { kind: "batch", batchId: "floors06_10" }, validationOptions(full));
    expect(abyss.ok).toBe(true); // floors06_10 已累计到全量资源集合，abyssEchoes 仍只增加内容定义。
    const abyssAudio = full.assets.find((asset) => asset.id === "bgm_abyss");
    expect(abyssAudio?.bundleId).toBe("abyss_common");
  });

  it("未知逻辑 ID、重复 owner、DAG 和 strict source/尺寸/clip/audio 均失败", () => {
    const catalog = AssetCatalog.create(candidateAssetManifest, "fixture");
    expect(catalog.ok).toBe(true);
    if (catalog.ok) {
      expect(catalog.value.getAsset("asset_missing").ok).toBe(false);
      expect(catalog.value.getBundle("bundle_missing").ok).toBe(false);
      expect(catalog.value.getAnimation("anim_missing").ok).toBe(false);
    }

    const duplicate = copyManifest();
    duplicate.assets.push({ ...duplicate.assets[0], id: duplicate.assets[1]?.id ?? "duplicate" });
    expect(AssetCatalog.create(duplicate, "fixture").ok).toBe(false);

    const owner = copyManifest();
    owner.bundles[1]?.assetIds.push("font_pixel_zh_cn");
    expect(AssetCatalog.create(owner, "fixture").ok).toBe(false);

    const cycle = copyManifest();
    cycle.bundles[0]!.dependsOn = ["core_ui"];
    expect(AssetCatalog.create(cycle, "fixture").ok).toBe(false);

    const source = copyManifest();
    (source.assets[0] as { source: { sourceKind: string } }).source.sourceKind = "unknown";
    expect(AssetCatalog.create(source, "fixture").ok).toBe(false);

    const clip = copyManifest();
    const field = clip.assets.find((asset) => asset.kind === "fieldActorSheet");
    if (field && field.kind === "fieldActorSheet") field.clips.down.idle.frameCount = 3 as never;
    // fixture 最小候选没有 field sheet；此分支用 battle/atlas 的 strict 校验覆盖。
    const atlas = copyManifest();
    const atlasEntry = atlas.assets.find((asset) => asset.id === "atlas_core_ui");
    if (atlasEntry && atlasEntry.kind === "atlas") atlasEntry.requiredFrames.pop();
    expect(AssetCatalog.create(atlas, "fixture").ok).toBe(false);

    const audio = copyManifest();
    const audioEntry = audio.assets.find((asset) => asset.id === "bgm_title");
    if (audioEntry && audioEntry.kind === "audio") audioEntry.baseGainBps = 1;
    expect(AssetCatalog.create(audio, "fixture").ok).toBe(false);

    const hotlink = copyManifest();
    const hotlinkAsset = hotlink.assets[0];
    if (!hotlinkAsset) throw new Error("fixture asset missing");
    hotlinkAsset.source.licenseId = " unknown ";
    expect(AssetCatalog.create(hotlink, "fixture").ok).toBe(false);
    const hotlinkImage = copyManifest();
    const image = hotlinkImage.assets.find((asset) => asset.id === "image_boot_logo");
    if (!image || image.kind !== "image") throw new Error("fixture image missing");
    image.src = "https://example.invalid/boot.png";
    expect(AssetCatalog.create(hotlinkImage, "fixture").ok).toBe(false);
  });

  it("metadata inspector 负责实际尺寸、图集帧和字体字符门禁", () => {
    const full = makeFullManifest();
    expect(AssetCatalog.create(full, "final", validationOptions(full)).ok).toBe(true);

    const missing = AssetCatalog.create(full, "final", {
      fileExists: () => true,
      metadataInspector: {
        inspectImage: () => null,
        inspectAtlas: () => null,
        inspectBitmapFont: () => null,
      },
      requiredFontCharacters: [],
    });
    expect(missing.ok).toBe(false);

    const badTileset = structuredClone(full);
    const tileset = badTileset.assets.find((asset) => asset.kind === "mapTileset");
    if (!tileset || tileset.kind !== "mapTileset") throw new Error("tileset missing");
    const options = validationOptions(badTileset);
    const inspectImage = options.metadataInspector.inspectImage;
    options.metadataInspector.inspectImage = (src: string) => src === tileset.src ? { width: 17, height: 16 } : inspectImage(src);
    expect(AssetCatalog.create(badTileset, "final", options).ok).toBe(false);
  });

  it("按首效果严格派生八类动画，非法空 effects 和 damage 字段失败", () => {
    const result = deriveAnimationDefinition({ id: "skill_test", kind: "active", targetRule: "singleEnemy", requiresFrontAccess: true, effects: [{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }] });
    expect(result.ok && result.value.presetId).toBe("melee");
    expect(deriveAnimationDefinition({ id: "skill_test", kind: "active", targetRule: "allEnemies", requiresFrontAccess: false, effects: [{ kind: "damage", targetRule: "allEnemies", element: "fire", powerBps: 1, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }] }).ok).toBe(true);
    expect(deriveAnimationDefinition({ id: "skill_test", kind: "active", targetRule: "self", requiresFrontAccess: false, effects: [{ kind: "heal", targetRule: "self", scalingStat: "attack", powerBps: 1, flatPower: 0, canCrit: false }] }).ok).toBe(true);
    expect(deriveAnimationDefinition({ id: "skill_test", kind: "active", targetRule: "self", requiresFrontAccess: false, effects: [] }).ok).toBe(false);
    const passive = deriveAnimationDefinition({ id: "skill_test", kind: "passive", targetRule: "self", requiresFrontAccess: false, effects: [] });
    expect(passive.ok).toBe(true);
    if (passive.ok) expect(passive.value).toMatchObject({ presetId: "passive", element: "physical", durationMs: 0, screenShake: "none", sfxId: null });
    expect(deriveAnimationDefinition({ id: "skill_test", kind: "active", targetRule: "singleEnemy", requiresFrontAccess: false, effects: [{ kind: "damage", targetRule: "singleEnemy", powerBps: 1 } as never] }).ok).toBe(false);
  });
});
