import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AssetCatalog } from "../../src/app/AssetCatalog";
import { collisionHash } from "../../src/content/builders/mapBlueprint";
import { floors02To05AssetManifest } from "../../src/content/data/assets.manifest";
import { floor02Map } from "../../src/content/data/maps/floor02";
import { floor03Map } from "../../src/content/data/maps/floor03";
import { floor04Map } from "../../src/content/data/maps/floor04";
import { floor05Map } from "../../src/content/data/maps/floor05";
import { FROZEN_BATCH_MANIFESTS } from "../../src/content/Catalog";
import { floor02To05BossIntents, floor02To05DropTables, floor02To05Enemies, floor02To05Encounters, floor02To05Floors, floor02To05Maps, floor02To05SkillAffixes, floors02To05Catalog, floors02To05Content } from "../../src/content/data/floors02-05";

const ids = (values: readonly { id: string }[]) => values.map((value) => value.id);

function assetValidationOptions(manifest: typeof floors02To05AssetManifest) {
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
    fileExists: (source: string) => source.startsWith("__fixture__/") || existsSync(join(process.cwd(), "public", source.replace(/^\//, ""))),
    metadataInspector: {
      inspectImage: (source: string) => images.get(source) ?? null,
      inspectAtlas: (_imageSource: string, dataSource: string) => ({ imageWidth: 1024, imageHeight: 1024, frames: atlasFrames.get(dataSource) ?? {} }),
      inspectBitmapFont: () => ({ textureWidth: 64, textureHeight: 64, characters: [] }),
    },
    requiredFontCharacters: [],
  };
}

describe("RPG-024 第 2～5 层内容", () => {
  it("累计批次通过 ContentCatalog 严格引用/数量/本地化门禁", () => {
    expect(floors02To05Catalog.ok).toBe(true);
  });

  it("累计资源清单通过 AssetCatalog 严格 bundle/尺寸/物理文件门禁", () => {
    const result = AssetCatalog.create(floors02To05AssetManifest, { kind: "batch", batchId: "floors02_05" }, assetValidationOptions(floors02To05AssetManifest));
    expect(result.ok).toBe(true);
  });

  it("提供四层固定 FloorDefinition 与地图快照", () => {
    expect(ids(floor02To05Floors)).toEqual(["floor_02", "floor_03", "floor_04", "floor_05"]);
    expect(ids(floor02To05Maps)).toEqual(["map_floor_02", "map_floor_03", "map_floor_04", "map_floor_05"]);
    expect(floor02Map.collisionLayer.filter((tile) => tile === 0)).toHaveLength(1131);
    expect(floor03Map.collisionLayer.filter((tile) => tile === 0)).toHaveLength(1077);
    expect(floor04Map.collisionLayer.filter((tile) => tile === 0)).toHaveLength(1161);
    expect(floor05Map.collisionLayer.filter((tile) => tile === 0)).toHaveLength(1072);
    expect(collisionHash(floor02Map.collisionLayer)).toBe("3f724a632713fe3bd6672335713be75dcad0f6e057978951240a9a728c7d2533");
    expect(collisionHash(floor03Map.collisionLayer)).toBe("4c125ac8f277d70f5bfc606dc5dd99d5464e9d03fe97b9969bc16430f3273d8f");
    expect(collisionHash(floor04Map.collisionLayer)).toBe("27d00d4976c98c6e10cbcf8fa4e5e234d40be0de88c0bb5a39dafa13a6448572");
    expect(collisionHash(floor05Map.collisionLayer)).toBe("a1c5b9c21f4da9287c30e744ad8e35fddf46bd2e95a2a82b2be35e844d0e1c02");
  });

  it("严格闭合第 2～5 层敌人、Boss、遭遇和修正", () => {
    expect(floor02To05Enemies.filter((enemy) => enemy.id.startsWith("enemy_")).map((enemy) => enemy.id)).toEqual([
      "enemy_sporeling", "enemy_venom_spider", "enemy_fungal_guardian", "enemy_cave_bat", "enemy_ore_golem", "enemy_bomb_goblin",
      "enemy_bog_leech", "enemy_mist_wraith", "enemy_ember_hound", "enemy_ash_cultist",
    ]);
    expect(floor02To05Enemies.filter((enemy) => enemy.id.startsWith("boss_")).map((enemy) => enemy.id)).toEqual([
      "boss_brood_spider", "boss_iron_devourer", "boss_bog_witch", "boss_ember_guardian",
    ]);
    expect(ids(floor02To05Encounters)).toEqual([
      "encounter_floor_02_normal_a", "encounter_floor_02_normal_b", "encounter_floor_02_normal_c", "encounter_floor_02_elite_guardian", "encounter_floor_02_boss",
      "encounter_floor_03_normal_a", "encounter_floor_03_normal_b", "encounter_floor_03_normal_c", "encounter_floor_03_elite_golem", "encounter_floor_03_boss",
      "encounter_floor_04_normal_a", "encounter_floor_04_normal_b", "encounter_floor_04_normal_c", "encounter_floor_04_elite_wraith", "encounter_floor_04_boss",
      "encounter_floor_05_normal_a", "encounter_floor_05_normal_b", "encounter_floor_05_normal_c", "encounter_floor_05_elite_cultist", "encounter_floor_05_boss",
    ]);
    expect(floors02To05Content.encounterModifiers.map((modifier) => modifier.id)).toEqual([
      "modifier_assault", "modifier_swift", "modifier_bulwark", "modifier_mire", "modifier_abyss_execution", "modifier_abyss_fortress", "modifier_abyss_pressure", "modifier_abyss_suppression",
    ]);
    expect(floor02To05BossIntents.map((intent) => intent.id)).toEqual([
      "intent_brood_venom_web", "intent_iron_quake", "intent_witch_miasma", "intent_ember_eruption",
    ]);
  });

  it("固定 27 底材、14 装备词条、8 技能词条和 7 Combo 全部存在", () => {
    expect(floors02To05Content.equipmentBases.filter((base) => base.id.includes("_t2_") || base.id.includes("_t3_") || base.id.includes("_t4_")).map((base) => base.id)).toEqual([
      "eq_sword_t2_bloodiron", "eq_hammer_t2_bastion", "eq_bow_t2_hawkeye", "eq_staff_t2_cinder", "eq_focus_t2_mist_orb", "eq_relic_t2_silver_bell",
      "eq_helmet_t2_iron", "eq_armor_t2_chain", "eq_gloves_t2_rivet", "eq_boots_t2_scout", "eq_accessory_t2_gem",
      "eq_sword_t3_emberedge", "eq_hammer_t3_magma", "eq_bow_t3_bloodstring", "eq_staff_t3_volcano", "eq_focus_t3_iceheart", "eq_relic_t3_sun_shard",
      "eq_helmet_t3_ember", "eq_armor_t3_plate", "eq_gloves_t3_flame", "eq_boots_t3_ash", "eq_accessory_t3_sigil",
      "eq_helmet_t4_abyss", "eq_armor_t4_abyss", "eq_gloves_t4_crimson", "eq_boots_t4_bloodstep", "eq_accessory_t4_eye",
    ]);
    expect(ids(floors02To05Content.equipmentAffixes).filter((id) => id.startsWith("af_")).slice(-14)).toEqual([
      "af_ferocity", "af_focus", "af_resolve", "af_physical_edge", "af_lightning", "af_holy", "af_poison", "af_high_spirit", "af_executioner", "af_last_stand", "af_frontline_wall", "af_backline_focus", "af_marked_prey", "af_venom_edge",
    ]);
    expect(ids(floor02To05SkillAffixes)).toEqual([
      "sa_frost_nova_focus", "sa_frost_zero_echo", "sa_ranger_twin_echo", "sa_ranger_marked_chase", "sa_swift_charge", "sa_storm_chain", "sa_universal_focus", "sa_priest_sanctuary_echo",
    ]);
    expect(ids(floors02To05Content.combos).filter((id) => id.startsWith("combo_")).slice(-7)).toEqual([
      "combo_venom_bloom", "combo_frozen_verdict", "combo_storm_circuit", "combo_execution_cadence", "combo_steadfast_aegis", "combo_swift_formation", "combo_perfect_strike",
    ]);
  });

  it("floors02_05 manifest 只登记五个 t4 非武器底材", () => {
    const equipmentBases = FROZEN_BATCH_MANIFESTS.floors02_05.equipmentBases;
    expect(equipmentBases.filter((id) => id.includes("_t4_")).slice(-5)).toEqual([
      "eq_helmet_t4_abyss", "eq_armor_t4_abyss", "eq_gloves_t4_crimson", "eq_boots_t4_bloodstep", "eq_accessory_t4_eye",
    ]);
    expect(equipmentBases.filter((id) => id.includes("_t4_")).some((id) => id.startsWith("eq_sword_") || id.startsWith("eq_hammer_") || id.startsWith("eq_bow_") || id.startsWith("eq_staff_") || id.startsWith("eq_focus_") || id.startsWith("eq_relic_"))).toBe(false);
  });

  it("floors02_05 manifest 累计闭合 8 条第一层与 8 条新增技能词条", () => {
    expect(FROZEN_BATCH_MANIFESTS.floors02_05.skillAffixes).toEqual([
      "sa_ember_focus", "sa_ember_echo", "sa_guard_ripple", "sa_bleed_doublecut", "sa_heal_overflow", "sa_execution_focus", "sa_fortress_focus", "sa_priest_mend_focus",
      "sa_frost_nova_focus", "sa_frost_zero_echo", "sa_ranger_twin_echo", "sa_ranger_marked_chase", "sa_swift_charge", "sa_storm_chain", "sa_universal_focus", "sa_priest_sanctuary_echo",
    ]);
  });

  it("累计掉落装备池只引用 floors02_05 manifest 内的底材", () => {
    const equipmentBaseIds = new Set(ids(floors02To05Content.equipmentBases));
    for (const table of floor02To05DropTables) {
      for (const roll of table.rolls) {
        if (roll.kind !== "equipment") continue;
        for (const group of roll.equipmentBasePools) {
          expect(group.bases.every((entry) => equipmentBaseIds.has(entry.baseId))).toBe(true);
        }
      }
    }
  });

  it("七条新增 Combo 的触发、效果和预算按冻结表展开", () => {
    const byId = new Map(floors02To05Content.combos.map((combo) => [combo.id, combo]));
    const venom = byId.get("combo_venom_bloom")!;
    expect(venom.trigger).toMatchObject({ event: "afterRootAction", requiredTargetStatusIds: ["status_poison"] });
    expect(venom.effects).toMatchObject([
      { kind: "damage", targetRule: "allEnemies", element: "poison", powerBps: 4500, hitCount: 1, canCrit: false },
      { kind: "applyStatus", targetRule: "allEnemies", statusId: "status_poison", baseChanceBps: 10000, stacks: 1, durationOwnerTurns: 3 },
    ]);
    const frozen = byId.get("combo_frozen_verdict")!;
    expect(frozen.trigger).toMatchObject({ event: "afterDirectHit", requiredTargetStatusIds: ["status_slow"] });
    expect(frozen.effects).toEqual([{ kind: "applyStatus", targetRule: "singleEnemy", statusId: "status_freeze", baseChanceBps: 10000, stacks: 1, durationOwnerTurns: 1 }]);
    const storm = byId.get("combo_storm_circuit")!;
    expect(storm.trigger).toMatchObject({ event: "afterDirectHit", requiredHitResult: "critical" });
    expect(storm.effects).toMatchObject([
      { kind: "damage", targetRule: "allEnemies", element: "lightning", powerBps: 4000, canCrit: false },
      { kind: "applyStatus", targetRule: "allEnemies", statusId: "status_shock", baseChanceBps: 10000, stacks: 1, durationOwnerTurns: 2 },
    ]);
    expect(byId.get("combo_execution_cadence")).toMatchObject({ trigger: { event: "onDefeatUnit" }, effects: [{ kind: "grantExtraTurn", targetRule: "self" }], budget: { maxPerBattle: 3 } });
    expect(byId.get("combo_steadfast_aegis")).toMatchObject({ trigger: { event: "onGainShield" }, effects: [{ kind: "applyStatus", targetRule: "allAllies", statusId: "status_defense_up", baseChanceBps: 10000, stacks: 1, durationOwnerTurns: 2 }], budget: { maxPerBattle: 3 } });
    expect(byId.get("combo_swift_formation")).toMatchObject({ trigger: { event: "beforeAction", requiredSkillKinds: ["basic", "active", "ultimate"] }, effects: [{ kind: "applyStatus", targetRule: "allAllies", statusId: "status_haste", baseChanceBps: 10000, stacks: 1, durationOwnerTurns: 2 }], budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 } });
    expect(byId.get("combo_perfect_strike")).toMatchObject({ trigger: { event: "afterDirectHit", requiredHitResult: "critical" }, effects: [{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 5000, canCrit: true }] });
  });

  it("新增装备词条按冻结部位、等级、修正和标签展开", () => {
    const byId = new Map(floors02To05Content.equipmentAffixes.map((affix) => [affix.id, affix]));
    expect(byId.get("af_ferocity")).toMatchObject({ allowedSlots: ["weapon", "gloves", "accessory"], minItemLevel: 1, weight: 75, goldValue: 30, modifiers: [{ kind: "flatStat", stat: "critDamageBps" }], tags: [{ tagId: "crit", count: 1 }] });
    expect(byId.get("af_focus")).toMatchObject({ allowedSlots: ["helmet", "gloves", "accessory"], modifiers: [{ kind: "flatStat", stat: "effectHitBps" }] });
    expect(byId.get("af_resolve")).toMatchObject({ allowedSlots: ["helmet", "armor", "accessory"], modifiers: [{ kind: "flatStat", stat: "effectResistBps" }] });
    expect(byId.get("af_high_spirit")).toMatchObject({ allowedSlots: ["weapon", "gloves", "accessory"], modifiers: [{ kind: "conditionalDamageBonus", condition: { kind: "selfHpAtLeastBps", valueBps: 8000 }, element: "all" }] });
    expect(byId.get("af_last_stand")).toMatchObject({ allowedSlots: ["armor", "helmet", "accessory"], allowedQualities: ["magic", "rare", "epic", "abyss"], modifiers: [{ kind: "conditionalPercentStat", condition: { kind: "selfHpAtMostBps", valueBps: 4000 }, stat: "defense" }] });
    expect(byId.get("af_frontline_wall")).toMatchObject({ allowedSlots: ["helmet", "armor", "boots"] });
    expect(byId.get("af_backline_focus")).toMatchObject({ allowedSlots: ["gloves", "boots", "accessory"], modifiers: [{ kind: "conditionalPercentStat", condition: { kind: "formationRow", row: "back" }, stat: "attack" }] });
    expect(byId.get("af_marked_prey")).toMatchObject({ allowedSlots: ["weapon", "gloves", "accessory"], modifiers: [{ kind: "conditionalDamageBonus", condition: { kind: "targetHasStatus", statusId: "status_marked" }, element: "all" }] });
    expect(byId.get("af_venom_edge")).toMatchObject({ allowedSlots: ["weapon"], minItemLevel: 6, exclusiveGroup: "basic_ailment", tags: [{ tagId: "poison", count: 2 }, { tagId: "basicAttack", count: 1 }] });
  });

  it("地图对象、掉落、NPC 与招募引用闭合", () => {
    for (const map of [floor02Map, floor03Map, floor04Map, floor05Map]) {
      expect(map.objects).toHaveLength(15);
      expect(new Set(map.objects.map((object) => object.objectId)).size).toBe(15);
      expect(map.objects.some((object) => object.kind === "portal" && object.action.kind === "returnTown")).toBe(true);
      expect(map.objects.some((object) => object.kind === "encounter" && object.encounterId.endsWith("_boss"))).toBe(true);
    }
    expect(floors02To05Content.npcs.slice(-2).map((npc) => npc.id)).toEqual(["npc_cartographer", "npc_abyss_watcher"]);
    expect(floors02To05Content.recruitments.slice(-2).map((recruitment) => recruitment.id)).toEqual(["recruit_ranger_floor_02", "recruit_frost_floor_04"]);
    expect(floor02To05DropTables).toHaveLength(20);
    expect(floor02To05DropTables.find((table) => table.id === "drop_floor_05_first_clear")?.rolls).toEqual([
      { kind: "stackableItem", itemId: "item_forge_shard", chanceBps: 10_000, quantityMin: 10, quantityMax: 10 },
      { kind: "stackableItem", itemId: "item_inscription_dust", chanceBps: 10_000, quantityMin: 10, quantityMax: 10 },
    ]);
  });
});
