import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AssetCatalog } from "../../src/app/AssetCatalog";
import { collisionHash } from "../../src/content/builders/mapBlueprint";
import { FROZEN_BATCH_MANIFESTS } from "../../src/content/Catalog";
import { floors06To10AssetManifest } from "../../src/content/data/assets.manifest";
import { floor06Map } from "../../src/content/data/maps/floor06";
import { floor07Map } from "../../src/content/data/maps/floor07";
import { floor08Map } from "../../src/content/data/maps/floor08";
import { floor09Map } from "../../src/content/data/maps/floor09";
import { floor10Map } from "../../src/content/data/maps/floor10";
import {
  floor06To10BossIntents,
  floor06To10Content,
  floor06To10DropTables,
  floor06To10Enemies,
  floor06To10Encounters,
  floor06To10Floors,
  floors06To10Catalog,
} from "../../src/content/data/floors06-10";

const ids = (values: readonly { id: string }[]) => values.map((value) => value.id);

function assetValidationOptions(manifest: typeof floors06To10AssetManifest) {
  const images = new Map<string, { width: number; height: number }>();
  const atlasFrames = new Map<string, Record<string, { x: number; y: number; width: number; height: number }>>();
  for (const asset of manifest.assets) {
    if (asset.kind === "fieldActorSheet") images.set(asset.src, { width: 240, height: 128 });
    if (asset.kind === "battleActorSheet") images.set(asset.src, { width: asset.frameWidth * asset.columns, height: asset.frameHeight });
    if (asset.kind === "singleFrame" || asset.kind === "image") images.set(asset.src, { width: asset.width, height: asset.height });
    if (asset.kind === "mapTileset") images.set(asset.src, { width: asset.columns * asset.tileSize, height: asset.rows * asset.tileSize });
    if (asset.kind === "atlas") {
      const frames: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (const frameId of asset.requiredFrames) frames[frameId] = { x: 0, y: 0, width: frameId.startsWith("marker_") ? 16 : frameId.startsWith("object_") ? 24 : 32, height: frameId.startsWith("marker_") ? 16 : frameId.startsWith("object_") ? 32 : 32 };
      atlasFrames.set(asset.dataSrc, frames);
    }
  }
  return {
    fileExists: (source: string) => source.startsWith("__fixture__/") || existsSync(join(process.cwd(), "public", source.replace(/^\//, ""))),
    metadataInspector: {
      inspectImage: (source: string) => images.get(source) ?? null,
      inspectAtlas: (_imageSource: string, dataSource: string) => ({ imageWidth: 1024, imageHeight: 1024, frames: atlasFrames.get(dataSource) ?? {} }),
      inspectBitmapFont: () => ({ textureWidth: 64, textureHeight: 64, characters: [] }),
    },
    requiredFontCharacters: [],
  };
}

describe("RPG-025 第 6～10 层深渊内容", () => {
  it("五张地图匹配冻结 collision 快照并保留 15 个业务对象", () => {
    const maps = [floor06Map, floor07Map, floor08Map, floor09Map, floor10Map];
    const expected = [
      [1133, "2a291e49028044be0a052afb47a857893724438097a62fbd28eb17749036a9c7"],
      [1067, "03f960c9b69424fb304c082d276812bbb31a76a40ef8a66d21ed0257e87d026b"],
      [1169, "7a2568f02ceced11ce69104615fa25247eaeafbb9c8c26276af20c0df3c46734"],
      [1182, "381c7066ed671590fd4acf8d1c0f9980d7e28288f8aed43233e0e61f76adca07"],
      [1161, "482e11862ec1c049212293a7384c427a6e3d62b8560d5c31127fcfc7e10cfeca"],
    ] as const;
    maps.forEach((map, index) => {
      expect(map.objects).toHaveLength(15);
      expect(map.collisionLayer.filter((tile) => tile === 0)).toHaveLength(expected[index][0]);
      expect(collisionHash(map.collisionLayer)).toBe(expected[index][1]);
      expect(map.objects.filter((object) => object.kind === "portal")).toHaveLength(1);
      expect(map.objects.some((object) => object.kind === "encounter" && object.encounterId.endsWith("_boss"))).toBe(true);
    });
    expect(floor10Map.objects.find((object) => object.objectId === "obj_f10_boss")?.kind).toBe("encounter");
  });

  it("严格录入敌人、遭遇、modifier 与五条 Boss intent", () => {
    expect(ids(floor06To10Floors)).toEqual(["floor_06", "floor_07", "floor_08", "floor_09", "floor_10"]);
    expect(floor06To10Enemies.filter((enemy) => enemy.id.startsWith("enemy_")).map((enemy) => enemy.id)).toEqual([
      "enemy_abyss_mauler", "enemy_dread_eye", "enemy_blood_ghoul", "enemy_crimson_acolyte", "enemy_frost_warden",
      "enemy_ice_revenant", "enemy_void_spark", "enemy_watcher_shard", "enemy_throne_knight", "enemy_abyss_herald",
    ]);
    expect(floor06To10Enemies.filter((enemy) => enemy.id.startsWith("boss_")).map((enemy) => enemy.id)).toEqual([
      "boss_abyss_butcher", "boss_crimson_knight", "boss_pale_jailer", "boss_thousand_eye", "boss_abyss_king",
    ]);
    expect(ids(floor06To10Encounters)).toHaveLength(25);
    expect(ids(floor06To10BossIntents)).toEqual([
      "intent_butcher_cleaver", "intent_crimson_flurry", "intent_jailer_prison", "intent_eye_chain", "intent_king_annihilation",
    ]);
    expect(floor06To10Content.encounterModifiers.map((modifier) => modifier.id)).toEqual([
      "modifier_assault", "modifier_swift", "modifier_bulwark", "modifier_mire", "modifier_abyss_execution", "modifier_abyss_fortress", "modifier_abyss_pressure", "modifier_abyss_suppression",
    ]);
  });

  it("累计 manifest 与 ContentCatalog 使用真实 floors06_10 根且不提前录入 abyssEcho", () => {
    expect(FROZEN_BATCH_MANIFESTS.floors06_10.abyssEchoes).toEqual([]);
    expect(floor06To10Content.abyssEchoes).toEqual([]);
    expect(floors06To10Catalog.ok).toBe(true);
  });

  it("累计资源清单通过 AssetCatalog 严格 bundle/尺寸/物理文件门禁", () => {
    const result = AssetCatalog.create(floors06To10AssetManifest, { kind: "batch", batchId: "floors06_10" }, assetValidationOptions(floors06To10AssetManifest));
    expect(result.ok).toBe(true);
  });

  it("严格闭合 22 底材、14 普通词条、8 深渊词条、8 技能词条与 7 Combo", () => {
    expect(FROZEN_BATCH_MANIFESTS.floors06_10.equipmentBases).toHaveLength(60);
    expect(FROZEN_BATCH_MANIFESTS.floors06_10.equipmentAffixes).toHaveLength(48);
    expect(FROZEN_BATCH_MANIFESTS.floors06_10.skillAffixes).toHaveLength(24);
    expect(FROZEN_BATCH_MANIFESTS.floors06_10.combos).toHaveLength(18);
    expect(floor06To10Content.equipmentAffixes.filter((affix) => affix.id.startsWith("af_dark") || affix.id.startsWith("af_prismatic") || affix.id.startsWith("af_frostbite_edge") || affix.id.startsWith("af_storm_spark") || affix.id.startsWith("af_healing_echo") || affix.id.startsWith("af_guardian_pulse") || affix.id.startsWith("af_rending_mastery") || affix.id.startsWith("af_fortress_mastery") || affix.id.startsWith("af_twinshot_mastery") || affix.id.startsWith("af_fireball_mastery") || affix.id.startsWith("af_ice_nova_mastery") || affix.id.startsWith("af_mend_mastery") || affix.id.startsWith("af_sweeping_form") || affix.id.startsWith("af_elemental_recast") || affix.id.startsWith("af_abyss_")).map((affix) => affix.id)).toEqual([
      "af_dark", "af_prismatic",
      "af_frostbite_edge", "af_storm_spark", "af_healing_echo", "af_guardian_pulse", "af_rending_mastery", "af_fortress_mastery", "af_twinshot_mastery", "af_fireball_mastery", "af_ice_nova_mastery", "af_mend_mastery", "af_sweeping_form", "af_elemental_recast", "af_abyss_twinstrike", "af_abyss_soulburn", "af_abyss_bloodmoon", "af_abyss_permafrost", "af_abyss_stormcrown", "af_abyss_sanctuary", "af_abyss_timefracture", "af_abyss_kingbrand",
    ]);
    expect(floor06To10Content.skillAffixes.filter((affix) => ["sa_frost_spread", "sa_guard_shared_wall", "sa_ember_detonate_cycle", "sa_ember_detonate_focus", "sa_abyss_unbound_power", "sa_abyss_endless_energy", "sa_abyss_shadow_echo", "sa_abyss_cascade"].includes(affix.id)).map((affix) => affix.id)).toEqual([
      "sa_frost_spread", "sa_guard_shared_wall", "sa_ember_detonate_cycle", "sa_ember_detonate_focus", "sa_abyss_unbound_power", "sa_abyss_endless_energy", "sa_abyss_shadow_echo", "sa_abyss_cascade",
    ]);
    expect(floor06To10Content.combos.slice(-7).map((combo) => combo.id)).toEqual([
      "combo_dark_covenant", "combo_cleansing_light", "combo_front_fortress", "combo_backline_barrage", "combo_triune_elements", "combo_ultimate_resonance", "combo_abyss_dominion",
    ]);
  });

  it("第 6～9 层掉落使用深渊表，第 10 层首杀 crown 固定为 exalted 王印", () => {
    expect(floor06To10DropTables).toHaveLength(25);
    for (const floor of [6, 7, 8, 9]) {
      expect(floor06To10DropTables.find((table) => table.id === `drop_floor_0${floor}_boss`)).toBeDefined();
      expect(floor06To10DropTables.find((table) => table.id === `drop_floor_0${floor}_first_clear`)).toBeDefined();
    }
    const firstClear = floor06To10DropTables.find((table) => table.id === "drop_floor_10_first_clear")!;
    expect(firstClear.rolls).toEqual([
      { kind: "fixedEquipment", chanceBps: 10_000, baseId: "eq_accessory_t6_crown", itemLevel: 50, quality: "abyss", craftGrade: "exalted", fixedAbyssAffixId: "af_abyss_kingbrand" },
      { kind: "stackableItem", itemId: "item_forge_shard", chanceBps: 10_000, quantityMin: 20, quantityMax: 20 },
      { kind: "stackableItem", itemId: "item_inscription_dust", chanceBps: 10_000, quantityMin: 20, quantityMax: 20 },
    ]);
  });
});
