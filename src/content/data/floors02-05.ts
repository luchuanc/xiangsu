import { ContentCatalog, FROZEN_BATCH_MANIFESTS } from "../Catalog";
import type {
  AffixTriggerDefinition,
  BossIntentDefinition,
  ContentRootV1,
  DropTableDefinition,
  EncounterModifierDefinition,
  FloorDefinition,
} from "../contracts";
import { affixTriggers } from "./affixTriggers";
import { CHARACTER_DEFINITIONS } from "./characters";
import { combos } from "./combos";
import { ECONOMY_DEFINITION } from "./economy";
import { ENCOUNTER_DEFINITIONS } from "./encounters";
import { ENEMY_DEFINITIONS } from "./enemies";
import { EQUIPMENT_AFFIX_DEFINITIONS, EQUIPMENT_BASE_DEFINITIONS, EQUIPMENT_BASE_POOLS } from "./equipment";
import { DROP_TABLE_DEFINITIONS } from "./dropTables";
import { ITEM_DEFINITIONS } from "./items";
import { dialogues } from "./dialogues";
import { npcs } from "./npcs";
import { quests } from "./quests";
import { recruitments } from "./recruitment";
import { shops } from "./shops";
import { SKILL_AFFIX_DEFINITIONS } from "./skillAffixes";
import { SKILL_DEFINITIONS, VERTICAL_SLICE_EXTRA_SKILLS } from "./skills";
import { statuses } from "./statuses";
import { townMap } from "./maps/town";
import { floor02Map } from "./maps/floor02";
import { floor03Map } from "./maps/floor03";
import { floor04Map } from "./maps/floor04";
import { floor05Map } from "./maps/floor05";
import { floor01Map } from "./maps/floor01";
import type { EquipmentBasePoolGroupV1, EquipmentQuality, SkillStoneQuality } from "../contracts";

const manifest = FROZEN_BATCH_MANIFESTS.floors02_05;
const allSkills = [...SKILL_DEFINITIONS, ...VERTICAL_SLICE_EXTRA_SKILLS];

function byManifestId<T extends { id: string }>(values: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(values.map((value) => [value.id, value]));
  return ids.map((id) => {
    const value = byId.get(id);
    if (!value) throw new Error(`floors02_05 内容缺少冻结 ID: ${id}`);
    return value;
  });
}

function firstClearTable(id: string, itemId: "item_forge_shard" | "item_inscription_dust", quantity: number): DropTableDefinition {
  return { id, rolls: [{ kind: "stackableItem", itemId, chanceBps: 10_000, quantityMin: quantity, quantityMax: quantity }] };
}

const floor02QualityWeights: Array<{ quality: EquipmentQuality; weight: number }> = [
  { quality: "common", weight: 35 }, { quality: "magic", weight: 50 }, { quality: "rare", weight: 14 }, { quality: "epic", weight: 1 }, { quality: "abyss", weight: 0 },
];
const floor03To05QualityWeights: Array<{ quality: EquipmentQuality; weight: number }> = [
  { quality: "common", weight: 15 }, { quality: "magic", weight: 50 }, { quality: "rare", weight: 30 }, { quality: "epic", weight: 5 }, { quality: "abyss", weight: 0 },
];
const floor02SkillStoneQualityWeights: Array<{ quality: SkillStoneQuality; weight: number }> = [
  { quality: "magic", weight: 80 }, { quality: "rare", weight: 19 }, { quality: "epic", weight: 1 }, { quality: "abyss", weight: 0 },
];
const floor03To05SkillStoneQualityWeights: Array<{ quality: SkillStoneQuality; weight: number }> = [
  { quality: "magic", weight: 55 }, { quality: "rare", weight: 38 }, { quality: "epic", weight: 7 }, { quality: "abyss", weight: 0 },
];
const materialPool = [{ itemId: "item_forge_shard", weight: 55 }, { itemId: "item_inscription_dust", weight: 45 }];
// 累计批次只允许引用自身 manifest 的底材，保留全局 t4 武器供后续批次使用但不泄漏到本批根。
const batchEquipmentBaseIds = new Set(manifest.equipmentBases);
const allBasePools: EquipmentBasePoolGroupV1[] = EQUIPMENT_BASE_POOLS.map((group) => ({
  slot: group.slot,
  weight: group.weight,
  bases: group.bases.filter((base) => batchEquipmentBaseIds.has(base.baseId)).map((base) => ({ ...base })),
}));

// 第一层掉落表与城镇商店也要复用批次池，避免全局池中的后续层底材泄漏到累计根。
const batchDropTables = DROP_TABLE_DEFINITIONS.map((table) => ({
  ...table,
  rolls: table.rolls.map((roll) => roll.kind === "equipment" ? { ...roll, equipmentBasePools: allBasePools } : roll),
}));
const batchShops = shops.map((shop) => ({
  ...shop,
  tiers: shop.tiers.map((tier) => ({ ...tier, equipmentBasePools: allBasePools })),
}));

function equipmentRoll(chanceBps: number, itemLevelMin: number, itemLevelMax: number, guaranteedMinQuality: EquipmentQuality | null = null, qualityWeights = floor03To05QualityWeights) {
  return { kind: "equipment" as const, chanceBps, itemLevelMin, itemLevelMax, equipmentBasePools: allBasePools, qualityWeights, guaranteedMinQuality, abyssUpgradeChanceBps: 0 };
}
function skillStoneRoll(chanceBps: number, itemLevelMin: number, itemLevelMax: number, guaranteedMinQuality: SkillStoneQuality | null = null, qualityWeights = floor03To05SkillStoneQualityWeights) {
  return { kind: "skillStone" as const, chanceBps, itemLevelMin, itemLevelMax, qualityWeights, guaranteedMinQuality };
}
function materialRoll(chanceBps: number, quantityMin = 2, quantityMax = 4) {
  return { kind: "stackableItemPool" as const, itemPool: materialPool, chanceBps, quantityMin, quantityMax };
}

/** 第 2～5 层掉落按 rank 展开，首通奖励与常规掉落分开保存。 */
const floors02To05DropTables: DropTableDefinition[] = [
  { id: "drop_floor_02_normal", rolls: [equipmentRoll(3500, 6, 10, null, floor02QualityWeights), materialRoll(7000, 1, 2)] },
  { id: "drop_floor_02_elite", rolls: [equipmentRoll(10_000, 8, 8, "magic", floor02QualityWeights), equipmentRoll(2000, 8, 8, null, floor02QualityWeights), skillStoneRoll(10_000, 8, 8, "magic", floor02SkillStoneQualityWeights), materialRoll(10_000, 1, 2)] },
  { id: "drop_floor_02_boss", rolls: [equipmentRoll(10_000, 10, 10, "rare", floor02QualityWeights), equipmentRoll(5000, 10, 10, null, floor02QualityWeights), skillStoneRoll(5000, 10, 10, null, floor02SkillStoneQualityWeights), materialRoll(10_000, 1, 2), materialRoll(10_000, 1, 2)] },
  { id: "drop_floor_02_chest", rolls: [equipmentRoll(10_000, 6, 10, "magic", floor02QualityWeights), materialRoll(10_000, 1, 2)] },
  firstClearTable("drop_floor_02_first_clear", "item_inscription_dust", 5),
  { id: "drop_floor_03_normal", rolls: [equipmentRoll(3500, 11, 15), materialRoll(7000, 1, 2)] },
  { id: "drop_floor_03_elite", rolls: [equipmentRoll(10_000, 13, 13, "magic"), equipmentRoll(2000, 13, 13), skillStoneRoll(10_000, 13, 13, "magic"), materialRoll(10_000, 1, 2)] },
  { id: "drop_floor_03_boss", rolls: [equipmentRoll(10_000, 15, 15, "rare"), equipmentRoll(5000, 15, 15), skillStoneRoll(5000, 15, 15), materialRoll(10_000, 1, 2), materialRoll(10_000, 1, 2)] },
  { id: "drop_floor_03_chest", rolls: [equipmentRoll(10_000, 11, 15, "magic"), materialRoll(10_000, 1, 2)] },
  firstClearTable("drop_floor_03_first_clear", "item_forge_shard", 8),
  { id: "drop_floor_04_normal", rolls: [equipmentRoll(3500, 16, 20), materialRoll(7000, 1, 2)] },
  { id: "drop_floor_04_elite", rolls: [equipmentRoll(10_000, 18, 18, "magic"), equipmentRoll(2000, 18, 18), skillStoneRoll(10_000, 18, 18, "magic"), materialRoll(10_000, 1, 2)] },
  { id: "drop_floor_04_boss", rolls: [equipmentRoll(10_000, 20, 20, "rare"), equipmentRoll(5000, 20, 20), skillStoneRoll(5000, 20, 20), materialRoll(10_000, 1, 2), materialRoll(10_000, 1, 2)] },
  { id: "drop_floor_04_chest", rolls: [equipmentRoll(10_000, 16, 20, "magic"), materialRoll(10_000, 1, 2)] },
  firstClearTable("drop_floor_04_first_clear", "item_inscription_dust", 8),
  { id: "drop_floor_05_normal", rolls: [equipmentRoll(3500, 21, 25), materialRoll(7000, 1, 2)] },
  { id: "drop_floor_05_elite", rolls: [equipmentRoll(10_000, 23, 23, "magic"), equipmentRoll(2000, 23, 23), skillStoneRoll(10_000, 23, 23, "magic"), materialRoll(10_000, 1, 2)] },
  { id: "drop_floor_05_boss", rolls: [equipmentRoll(10_000, 25, 25, "rare"), equipmentRoll(5000, 25, 25), skillStoneRoll(5000, 25, 25), materialRoll(10_000, 1, 2), materialRoll(10_000, 1, 2)] },
  { id: "drop_floor_05_chest", rolls: [equipmentRoll(10_000, 21, 25, "magic"), materialRoll(10_000, 1, 2)] },
  {
    id: "drop_floor_05_first_clear",
    // 第五层首通的两种材料必须在同一奖励表中原子发放，不能拆成隐藏的额外表。
    rolls: [
      { kind: "stackableItem", itemId: "item_forge_shard", chanceBps: 10_000, quantityMin: 10, quantityMax: 10 },
      { kind: "stackableItem", itemId: "item_inscription_dust", chanceBps: 10_000, quantityMin: 10, quantityMax: 10 },
    ],
  },
];

const floors02To05: FloorDefinition[] = [
  { id: "floor_02", nameKey: "floor.floor_02.name", floorNumber: 2, mapId: "map_floor_02", bossEncounterId: "encounter_floor_02_boss", assetBundleId: "floor_02", minItemLevel: 6, maxItemLevel: 10, recommendedBossLevel: 8, recommendedItemLevel: 8, bossEnrageRound: 11, bossGateType: "currentTier", bossPhaseThresholdBps: [5000], shortRouteObjectIds: ["obj_f02_n01", "obj_f02_n02", "obj_f02_n03", "obj_f02_e01", "obj_f02_chest01"], isAbyss: false, firstClearRewardTableId: "drop_floor_02_first_clear" },
  { id: "floor_03", nameKey: "floor.floor_03.name", floorNumber: 3, mapId: "map_floor_03", bossEncounterId: "encounter_floor_03_boss", assetBundleId: "floor_03", minItemLevel: 11, maxItemLevel: 15, recommendedBossLevel: 12, recommendedItemLevel: 13, bossEnrageRound: 12, bossGateType: "currentTier", bossPhaseThresholdBps: [5000], shortRouteObjectIds: ["obj_f03_n01", "obj_f03_n02", "obj_f03_n03", "obj_f03_e01", "obj_f03_chest01"], isAbyss: false, firstClearRewardTableId: "drop_floor_03_first_clear" },
  { id: "floor_04", nameKey: "floor.floor_04.name", floorNumber: 4, mapId: "map_floor_04", bossEncounterId: "encounter_floor_04_boss", assetBundleId: "floor_04", minItemLevel: 16, maxItemLevel: 20, recommendedBossLevel: 16, recommendedItemLevel: 18, bossEnrageRound: 14, bossGateType: "currentTier", bossPhaseThresholdBps: [5000], shortRouteObjectIds: ["obj_f04_n01", "obj_f04_n02", "obj_f04_n03", "obj_f04_e01", "obj_f04_chest01"], isAbyss: false, firstClearRewardTableId: "drop_floor_04_first_clear" },
  { id: "floor_05", nameKey: "floor.floor_05.name", floorNumber: 5, mapId: "map_floor_05", bossEncounterId: "encounter_floor_05_boss", assetBundleId: "floor_05", minItemLevel: 21, maxItemLevel: 25, recommendedBossLevel: 21, recommendedItemLevel: 23, bossEnrageRound: 11, bossGateType: "currentTier", bossPhaseThresholdBps: [5000], shortRouteObjectIds: ["obj_f05_n01", "obj_f05_n02", "obj_f05_n03", "obj_f05_e01", "obj_f05_chest01"], isAbyss: false, firstClearRewardTableId: "drop_floor_05_first_clear" },
];

const floor02To05Modifiers: EncounterModifierDefinition[] = [
  { id: "modifier_assault", nameKey: "encounter_modifier.modifier_assault.name", descriptionKey: "encounter_modifier.modifier_assault.description", rule: { kind: "timedStat", faction: "enemy", stat: "attack", valueBps: 1000, fromRound: 1, throughRound: 2 } },
  { id: "modifier_swift", nameKey: "encounter_modifier.modifier_swift.name", descriptionKey: "encounter_modifier.modifier_swift.description", rule: { kind: "timedStat", faction: "enemy", stat: "speed", valueBps: 1200, fromRound: 1, throughRound: 2 } },
  { id: "modifier_bulwark", nameKey: "encounter_modifier.modifier_bulwark.name", descriptionKey: "encounter_modifier.modifier_bulwark.description", rule: { kind: "timedStat", faction: "enemy", stat: "defense", valueBps: 1200, fromRound: 1, throughRound: 3 } },
  { id: "modifier_mire", nameKey: "encounter_modifier.modifier_mire.name", descriptionKey: "encounter_modifier.modifier_mire.description", rule: { kind: "timedStat", faction: "party", stat: "speed", valueBps: -1000, fromRound: 1, throughRound: 2 } },
  { id: "modifier_abyss_execution", nameKey: "encounter_modifier.modifier_abyss_execution.name", descriptionKey: "encounter_modifier.modifier_abyss_execution.description", rule: { kind: "executeDamage", faction: "enemy", targetHpAtMostBps: 3000, damageBonusBps: 1500 } },
  { id: "modifier_abyss_fortress", nameKey: "encounter_modifier.modifier_abyss_fortress.name", descriptionKey: "encounter_modifier.modifier_abyss_fortress.description", rule: { kind: "battleStartShield", faction: "enemy", maxHpBps: 1200 } },
  { id: "modifier_abyss_pressure", nameKey: "encounter_modifier.modifier_abyss_pressure.name", descriptionKey: "encounter_modifier.modifier_abyss_pressure.description", rule: { kind: "escalatingStat", faction: "enemy", stat: "attack", perRoundBps: 400, capBps: 2000 } },
  { id: "modifier_abyss_suppression", nameKey: "encounter_modifier.modifier_abyss_suppression.name", descriptionKey: "encounter_modifier.modifier_abyss_suppression.description", rule: { kind: "healingSuppression", faction: "party", valueBps: 1500 } },
];

const floor02To05BossIntentDefinitions: BossIntentDefinition[] = [
  { id: "intent_horned_charge", bossId: "boss_horned_king", skillId: "skill_boss_horned_charge", targetStrategy: "frontFirstOpponent", delayLegalActions: 1, counterKind: "guard" },
  { id: "intent_brood_venom_web", bossId: "boss_brood_spider", skillId: "skill_boss_brood_venom_web", targetStrategy: "lowestHpOpponent", delayLegalActions: 1, counterKind: "cleanse" },
  { id: "intent_iron_quake", bossId: "boss_iron_devourer", skillId: "skill_boss_iron_quake", targetStrategy: "frontFirstOpponent", delayLegalActions: 1, counterKind: "guard" },
  { id: "intent_witch_miasma", bossId: "boss_bog_witch", skillId: "skill_boss_witch_miasma", targetStrategy: "lowestHpOpponent", delayLegalActions: 1, counterKind: "cleanse" },
  { id: "intent_ember_eruption", bossId: "boss_ember_guardian", skillId: "skill_boss_ember_eruption", targetStrategy: "frontFirstOpponent", delayLegalActions: 1, counterKind: "shield" },
];

function appendTrigger(id: string, effect: AffixTriggerDefinition["effects"][number], event: AffixTriggerDefinition["trigger"]["event"]): AffixTriggerDefinition {
  return {
    id,
    trigger: { event, requiredSkillKinds: ["basic", "active"], requiredHitResult: "any", requiredSourceHpAtMostBps: null, requiredTargetHpAtMostBps: null, requiredSourceStatusIds: [], requiredTargetStatusIds: [], consumeTargetStatus: null },
    chance: { kind: "affixRoll", scaleBps: 10_000 },
    effects: [effect],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 20 },
  };
}

const floors02To05AffixTriggers: readonly AffixTriggerDefinition[] = [
  ...affixTriggers,
  appendTrigger("tr_venom_edge", { kind: "applyStatus", targetRule: "singleEnemy", statusId: "status_poison", baseChanceBps: 10_000, stacks: 1, durationOwnerTurns: 3 }, "afterDirectHit"),
  appendTrigger("tr_frostbite_edge", { kind: "applyStatus", targetRule: "singleEnemy", statusId: "status_slow", baseChanceBps: 10_000, stacks: 1, durationOwnerTurns: 2 }, "afterDirectHit"),
  appendTrigger("tr_storm_spark", { kind: "damage", targetRule: "singleEnemy", element: "lightning", powerBps: 2500, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }, "afterDirectHit"),
  appendTrigger("tr_healing_echo", { kind: "heal", targetRule: "self", scalingStat: "attack", powerBps: 2500, flatPower: 0, canCrit: false }, "onHeal"),
  appendTrigger("tr_guardian_pulse", { kind: "shield", targetRule: "self", scalingStat: "maxHp", powerBps: 500, flatPower: 0, statusId: "status_shield", durationOwnerTurns: 1 }, "onDirectDamageTaken"),
];

const batchRoot: ContentRootV1 = {
  schemaVersion: 1,
  contentVersion: "content-1.2.0",
  protagonistCharacterId: "char_wanderer",
  characters: byManifestId(CHARACTER_DEFINITIONS, manifest.characters),
  skills: byManifestId(allSkills, manifest.skills),
  statuses: byManifestId(statuses, manifest.statuses),
  equipmentBases: byManifestId(EQUIPMENT_BASE_DEFINITIONS, manifest.equipmentBases),
  equipmentAffixes: byManifestId(EQUIPMENT_AFFIX_DEFINITIONS, manifest.equipmentAffixes),
  affixTriggers: byManifestId(floors02To05AffixTriggers, manifest.affixTriggers),
  skillAffixes: byManifestId(SKILL_AFFIX_DEFINITIONS, manifest.skillAffixes),
  combos: byManifestId(combos, manifest.combos),
  enemies: byManifestId(ENEMY_DEFINITIONS, manifest.enemies),
  encounters: byManifestId(ENCOUNTER_DEFINITIONS, manifest.encounters),
  encounterModifiers: byManifestId(floor02To05Modifiers, manifest.encounterModifiers),
  bossIntents: byManifestId(floor02To05BossIntentDefinitions, manifest.bossIntents),
  abyssEchoes: [],
  floors: [{ id: "floor_01", nameKey: "floor.floor_01.name", floorNumber: 1, mapId: "map_floor_01", bossEncounterId: "encounter_floor_01_boss", assetBundleId: "floor_01", minItemLevel: 1, maxItemLevel: 5, recommendedBossLevel: 4, recommendedItemLevel: 3, bossEnrageRound: 12, bossGateType: "tutorial", bossPhaseThresholdBps: [5000], shortRouteObjectIds: ["obj_f01_n01", "obj_f01_n02", "obj_f01_n03", "obj_f01_e01", "obj_f01_chest01"], isAbyss: false, firstClearRewardTableId: "drop_floor_01_first_clear" }, ...floors02To05],
  maps: [townMap, floor01Map, floor02Map, floor03Map, floor04Map, floor05Map],
  npcs: byManifestId(npcs, manifest.npcs),
  dialogues: byManifestId(dialogues, manifest.dialogues),
  quests: byManifestId(quests, manifest.quests),
  recruitments: byManifestId(recruitments, manifest.recruitments),
  shops: byManifestId(batchShops, manifest.shops),
  items: byManifestId(ITEM_DEFINITIONS, manifest.items),
  dropTables: byManifestId([...batchDropTables, ...floors02To05DropTables], manifest.dropTables),
  economy: ECONOMY_DEFINITION,
};

/** RPG-024 的累计根，显式按批次 manifest 取数，不从当前数组顺序猜测。 */
export const floors02To05Content: ContentRootV1 = Object.freeze(batchRoot);
export const floors02To05Catalog = ContentCatalog.create(floors02To05Content, { kind: "batch", batchId: "floors02_05" });
export const floor02To05Floors = Object.freeze(floors02To05);
export const floor02To05Maps = Object.freeze([floor02Map, floor03Map, floor04Map, floor05Map]);
export const floor02To05Enemies = Object.freeze(byManifestId(ENEMY_DEFINITIONS, ["enemy_sporeling", "enemy_venom_spider", "enemy_fungal_guardian", "enemy_cave_bat", "enemy_ore_golem", "enemy_bomb_goblin", "enemy_bog_leech", "enemy_mist_wraith", "enemy_ember_hound", "enemy_ash_cultist", "boss_brood_spider", "boss_iron_devourer", "boss_bog_witch", "boss_ember_guardian"]));
export const floor02To05Encounters = Object.freeze(byManifestId(ENCOUNTER_DEFINITIONS, [
  "encounter_floor_02_normal_a", "encounter_floor_02_normal_b", "encounter_floor_02_normal_c", "encounter_floor_02_elite_guardian", "encounter_floor_02_boss",
  "encounter_floor_03_normal_a", "encounter_floor_03_normal_b", "encounter_floor_03_normal_c", "encounter_floor_03_elite_golem", "encounter_floor_03_boss",
  "encounter_floor_04_normal_a", "encounter_floor_04_normal_b", "encounter_floor_04_normal_c", "encounter_floor_04_elite_wraith", "encounter_floor_04_boss",
  "encounter_floor_05_normal_a", "encounter_floor_05_normal_b", "encounter_floor_05_normal_c", "encounter_floor_05_elite_cultist", "encounter_floor_05_boss",
]));
export const floor02To05BossIntents = Object.freeze(byManifestId(floor02To05BossIntentDefinitions, ["intent_brood_venom_web", "intent_iron_quake", "intent_witch_miasma", "intent_ember_eruption"]));
export const floor02To05SkillAffixes = Object.freeze(byManifestId(SKILL_AFFIX_DEFINITIONS, ["sa_frost_nova_focus", "sa_frost_zero_echo", "sa_ranger_twin_echo", "sa_ranger_marked_chase", "sa_swift_charge", "sa_storm_chain", "sa_universal_focus", "sa_priest_sanctuary_echo"]));
export const floor02To05DropTables = Object.freeze(floors02To05DropTables);
export const floor02To05AffixTriggers = Object.freeze(floors02To05AffixTriggers);
