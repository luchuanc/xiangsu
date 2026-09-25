import { ContentCatalog, FROZEN_BATCH_MANIFESTS } from "../Catalog";
import type {
  BossIntentDefinition,
  ContentRootV1,
  DropTableDefinition,
  EquipmentBasePoolGroupV1,
  EquipmentQuality,
  FloorDefinition,
  SkillStoneQuality,
} from "../contracts";
import { verticalSliceContentRoot } from "./verticalSlice";
import { floors02To05Content } from "./floors02-05";
import { CHARACTER_DEFINITIONS } from "./characters";
import { combos } from "./combos";
import { ECONOMY_DEFINITION } from "./economy";
import { abyssBossIntents, abyssAffixTriggers } from "./abyss";
import { ENCOUNTER_DEFINITIONS } from "./encounters";
import { ENEMY_DEFINITIONS } from "./enemies";
import { EQUIPMENT_AFFIX_DEFINITIONS, EQUIPMENT_BASE_DEFINITIONS, EQUIPMENT_BASE_POOLS } from "./equipment";
import { ITEM_DEFINITIONS } from "./items";
import { npcs } from "./npcs";
import { dialogues } from "./dialogues";
import { quests } from "./quests";
import { recruitments } from "./recruitment";
import { shops } from "./shops";
import { SKILL_AFFIX_DEFINITIONS } from "./skillAffixes";
import { SKILL_DEFINITIONS, VERTICAL_SLICE_EXTRA_SKILLS } from "./skills";
import { statuses } from "./statuses";
import { floor06Map } from "./maps/floor06";
import { floor07Map } from "./maps/floor07";
import { floor08Map } from "./maps/floor08";
import { floor09Map } from "./maps/floor09";
import { floor10Map } from "./maps/floor10";

const manifest = FROZEN_BATCH_MANIFESTS.floors06_10;
const allSkills = [...SKILL_DEFINITIONS, ...VERTICAL_SLICE_EXTRA_SKILLS];

function byManifestId<T extends { id: string }>(values: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(values.map((value) => [value.id, value]));
  return ids.map((id) => {
    const value = byId.get(id);
    if (!value) throw new Error(`floors06_10 内容缺少冻结 ID: ${id}`);
    return value;
  });
}

const qualityWeights: Readonly<Record<"6_7" | "8_9" | "10", readonly { quality: EquipmentQuality; weight: number }[]>> = {
  "6_7": [
    { quality: "common", weight: 0 }, { quality: "magic", weight: 35 }, { quality: "rare", weight: 45 }, { quality: "epic", weight: 17 }, { quality: "abyss", weight: 3 },
  ],
  "8_9": [
    { quality: "common", weight: 0 }, { quality: "magic", weight: 20 }, { quality: "rare", weight: 45 }, { quality: "epic", weight: 27 }, { quality: "abyss", weight: 8 },
  ],
  "10": [
    { quality: "common", weight: 0 }, { quality: "magic", weight: 0 }, { quality: "rare", weight: 45 }, { quality: "epic", weight: 40 }, { quality: "abyss", weight: 15 },
  ],
};
const skillStoneQualityWeights: Readonly<Record<"6_7" | "8_9" | "10", readonly { quality: SkillStoneQuality; weight: number }[]>> = {
  "6_7": [{ quality: "magic", weight: 35 }, { quality: "rare", weight: 45 }, { quality: "epic", weight: 17 }, { quality: "abyss", weight: 3 }],
  "8_9": [{ quality: "magic", weight: 20 }, { quality: "rare", weight: 45 }, { quality: "epic", weight: 27 }, { quality: "abyss", weight: 8 }],
  "10": [{ quality: "magic", weight: 0 }, { quality: "rare", weight: 45 }, { quality: "epic", weight: 40 }, { quality: "abyss", weight: 15 }],
};

function floorQualityKey(floor: number): "6_7" | "8_9" | "10" {
  return floor <= 7 ? "6_7" : floor <= 9 ? "8_9" : "10";
}

/** 根据冻结楼层区间裁剪底材池，禁止把后续楼层底材混入掉落。 */
function floorBasePools(itemLevelMin: number, itemLevelMax: number): EquipmentBasePoolGroupV1[] {
  return EQUIPMENT_BASE_POOLS.map((group) => ({
    slot: group.slot,
    weight: 100,
    bases: group.bases.filter((entry) => {
      if (entry.baseId === "eq_accessory_t6_crown") return false;
      const base = EQUIPMENT_BASE_DEFINITIONS.find((candidate) => candidate.id === entry.baseId);
      return Boolean(base && base.minItemLevel <= itemLevelMax && base.maxItemLevel >= itemLevelMin);
    }).map((entry) => ({ baseId: entry.baseId, weight: 100 })),
  }));
}

const materialPool = [
  { itemId: "item_forge_shard" as const, weight: 50 },
  { itemId: "item_inscription_dust" as const, weight: 50 },
];

function equipmentRoll(
  chanceBps: number,
  itemLevelMin: number,
  itemLevelMax: number,
  guaranteedMinQuality: EquipmentQuality | null,
  abyssUpgradeChanceBps: number,
): DropTableDefinition["rolls"][number] {
  return {
    kind: "equipment",
    chanceBps,
    itemLevelMin,
    itemLevelMax,
    equipmentBasePools: floorBasePools(itemLevelMin, itemLevelMax),
    qualityWeights: [...qualityWeights[floorQualityKey(itemLevelMin)]],
    guaranteedMinQuality,
    abyssUpgradeChanceBps,
  };
}

function equipmentRollWithoutAbyssQuality(
  chanceBps: number,
  itemLevelMin: number,
  itemLevelMax: number,
  guaranteedMinQuality: EquipmentQuality | null,
  abyssUpgradeChanceBps: number,
): DropTableDefinition["rolls"][number] {
  const roll = equipmentRoll(chanceBps, itemLevelMin, itemLevelMax, guaranteedMinQuality, abyssUpgradeChanceBps);
  if (roll.kind !== "equipment") return roll;
  return { ...roll, qualityWeights: roll.qualityWeights.map((entry) => entry.quality === "abyss" ? { ...entry, weight: 0 } : entry) };
}

function skillStoneRoll(chanceBps: number, itemLevelMin: number, itemLevelMax: number, guaranteedMinQuality: SkillStoneQuality | null): DropTableDefinition["rolls"][number] {
  return {
    kind: "skillStone",
    chanceBps,
    itemLevelMin,
    itemLevelMax,
    qualityWeights: [...skillStoneQualityWeights[floorQualityKey(itemLevelMin)]],
    guaranteedMinQuality,
  };
}

function materials(chanceBps: number) {
  return { kind: "stackableItemPool" as const, itemPool: materialPool, chanceBps, quantityMin: 2, quantityMax: 4 };
}

function fixedMaterial(itemId: "item_forge_shard" | "item_inscription_dust", quantity: number) {
  return { kind: "stackableItem" as const, itemId, chanceBps: 10_000, quantityMin: quantity, quantityMax: quantity };
}

function firstClearTable(floor: number, itemId: "item_forge_shard" | "item_inscription_dust", quantity: number): DropTableDefinition {
  return { id: `drop_floor_${String(floor).padStart(2, "0")}_first_clear`, rolls: [fixedMaterial(itemId, quantity)] };
}

function abyssFloorDropTables(floor: number, itemLevelMin: number, itemLevelMax: number, bossAbyssUpgradeChanceBps: number): DropTableDefinition[] {
  const key = String(floor).padStart(2, "0");
  const eliteLevel = Math.floor((itemLevelMin + itemLevelMax) / 2);
  const bossRolls: DropTableDefinition["rolls"] = [
    equipmentRollWithoutAbyssQuality(10_000, itemLevelMax, itemLevelMax, "rare", bossAbyssUpgradeChanceBps),
    equipmentRoll(5000, itemLevelMax, itemLevelMax, null, 0),
    skillStoneRoll(10_000, itemLevelMax, itemLevelMax, null),
    materials(10_000),
    materials(10_000),
  ];
  if (floor === 10) {
    bossRolls.push({ kind: "fixedEquipment", chanceBps: 500, baseId: "eq_accessory_t6_crown", itemLevel: 50, quality: "abyss", craftGrade: "weighted", fixedAbyssAffixId: "af_abyss_kingbrand" });
  }
  return [
    { id: `drop_floor_${key}_normal`, rolls: [equipmentRoll(3500, itemLevelMin, itemLevelMax, null, 0), materials(7000)] },
    { id: `drop_floor_${key}_elite`, rolls: [equipmentRoll(10_000, eliteLevel, eliteLevel, "magic", 0), equipmentRoll(2000, eliteLevel, eliteLevel, null, 0), skillStoneRoll(10_000, eliteLevel, eliteLevel, "magic"), materials(10_000)] },
    { id: `drop_floor_${key}_boss`, rolls: bossRolls },
    { id: `drop_floor_${key}_chest`, rolls: [equipmentRoll(10_000, itemLevelMin, itemLevelMax, "magic", 0), materials(10_000)] },
    floor === 6 ? firstClearTable(floor, "item_forge_shard", 12)
      : floor === 7 ? firstClearTable(floor, "item_inscription_dust", 12)
        : floor === 8 ? firstClearTable(floor, "item_forge_shard", 16)
          : floor === 9 ? firstClearTable(floor, "item_inscription_dust", 16)
            : {
              id: `drop_floor_${key}_first_clear`,
              rolls: [
                { kind: "fixedEquipment", chanceBps: 10_000, baseId: "eq_accessory_t6_crown", itemLevel: 50, quality: "abyss", craftGrade: "exalted", fixedAbyssAffixId: "af_abyss_kingbrand" },
                fixedMaterial("item_forge_shard", 20),
                fixedMaterial("item_inscription_dust", 20),
              ],
            },
  ];
}

/** 第 6～10 层每层五张掉落表，表内 rolls 顺序与 WORLD-1.2 固定表一致。 */
const abyssDropTables = [
  ...abyssFloorDropTables(6, 26, 30, 1000),
  ...abyssFloorDropTables(7, 31, 35, 1200),
  ...abyssFloorDropTables(8, 36, 40, 1500),
  ...abyssFloorDropTables(9, 41, 45, 1800),
  ...abyssFloorDropTables(10, 46, 50, 2500),
];

const floors06To10: FloorDefinition[] = [
  { id: "floor_06", nameKey: "floor.floor_06.name", floorNumber: 6, mapId: "map_floor_06", bossEncounterId: "encounter_floor_06_boss", assetBundleId: "floor_06", minItemLevel: 26, maxItemLevel: 30, recommendedBossLevel: 25, recommendedItemLevel: 28, bossEnrageRound: 12, bossGateType: "currentTier", bossPhaseThresholdBps: [5000], shortRouteObjectIds: ["obj_f06_n01", "obj_f06_n02", "obj_f06_n03", "obj_f06_e01", "obj_f06_chest01"], isAbyss: true, firstClearRewardTableId: "drop_floor_06_first_clear" },
  { id: "floor_07", nameKey: "floor.floor_07.name", floorNumber: 7, mapId: "map_floor_07", bossEncounterId: "encounter_floor_07_boss", assetBundleId: "floor_07", minItemLevel: 31, maxItemLevel: 35, recommendedBossLevel: 31, recommendedItemLevel: 33, bossEnrageRound: 13, bossGateType: "currentTier", bossPhaseThresholdBps: [5000], shortRouteObjectIds: ["obj_f07_n01", "obj_f07_n02", "obj_f07_n03", "obj_f07_e01", "obj_f07_chest01"], isAbyss: true, firstClearRewardTableId: "drop_floor_07_first_clear" },
  { id: "floor_08", nameKey: "floor.floor_08.name", floorNumber: 8, mapId: "map_floor_08", bossEncounterId: "encounter_floor_08_boss", assetBundleId: "floor_08", minItemLevel: 36, maxItemLevel: 40, recommendedBossLevel: 37, recommendedItemLevel: 38, bossEnrageRound: 14, bossGateType: "currentTier", bossPhaseThresholdBps: [5000], shortRouteObjectIds: ["obj_f08_n01", "obj_f08_n02", "obj_f08_n03", "obj_f08_e01", "obj_f08_chest01"], isAbyss: true, firstClearRewardTableId: "drop_floor_08_first_clear" },
  { id: "floor_09", nameKey: "floor.floor_09.name", floorNumber: 9, mapId: "map_floor_09", bossEncounterId: "encounter_floor_09_boss", assetBundleId: "floor_09", minItemLevel: 41, maxItemLevel: 45, recommendedBossLevel: 43, recommendedItemLevel: 43, bossEnrageRound: 11, bossGateType: "currentTier", bossPhaseThresholdBps: [5000], shortRouteObjectIds: ["obj_f09_n01", "obj_f09_n02", "obj_f09_n03", "obj_f09_e01", "obj_f09_chest01"], isAbyss: true, firstClearRewardTableId: "drop_floor_09_first_clear" },
  { id: "floor_10", nameKey: "floor.floor_10.name", floorNumber: 10, mapId: "map_floor_10", bossEncounterId: "encounter_floor_10_boss", assetBundleId: "floor_10", minItemLevel: 46, maxItemLevel: 50, recommendedBossLevel: 50, recommendedItemLevel: 48, bossEnrageRound: 14, bossGateType: "breakthrough", bossPhaseThresholdBps: [7000, 3500], shortRouteObjectIds: ["obj_f10_n01", "obj_f10_n02", "obj_f10_n03", "obj_f10_e01", "obj_f10_chest01"], isAbyss: true, firstClearRewardTableId: "drop_floor_10_first_clear" },
];

const finalBossIntents: BossIntentDefinition[] = [
  ...verticalSliceContentRoot.bossIntents,
  ...floors02To05Content.bossIntents,
  ...abyssBossIntents,
];
const finalAffixTriggers = [...floors02To05Content.affixTriggers, ...abyssAffixTriggers];
const oldDropTables = floors02To05Content.dropTables;

const batchRoot: ContentRootV1 = {
  schemaVersion: 1,
  contentVersion: "content-1.2.0",
  protagonistCharacterId: "char_wanderer",
  characters: byManifestId(CHARACTER_DEFINITIONS, manifest.characters),
  skills: byManifestId(allSkills, manifest.skills),
  statuses: byManifestId(statuses, manifest.statuses),
  equipmentBases: byManifestId(EQUIPMENT_BASE_DEFINITIONS, manifest.equipmentBases),
  equipmentAffixes: byManifestId(EQUIPMENT_AFFIX_DEFINITIONS, manifest.equipmentAffixes),
  affixTriggers: byManifestId(finalAffixTriggers, manifest.affixTriggers),
  skillAffixes: byManifestId(SKILL_AFFIX_DEFINITIONS, manifest.skillAffixes),
  combos: byManifestId(combos, manifest.combos),
  enemies: byManifestId(ENEMY_DEFINITIONS, manifest.enemies),
  encounters: byManifestId(ENCOUNTER_DEFINITIONS, manifest.encounters),
  encounterModifiers: byManifestId(floors02To05Content.encounterModifiers, manifest.encounterModifiers),
  bossIntents: byManifestId(finalBossIntents, manifest.bossIntents),
  abyssEchoes: [],
  floors: byManifestId([...floors02To05Content.floors, ...floors06To10], manifest.floors),
  maps: byManifestId([...floors02To05Content.maps, floor06Map, floor07Map, floor08Map, floor09Map, floor10Map], manifest.maps),
  npcs: byManifestId(npcs, manifest.npcs),
  dialogues: byManifestId(dialogues, manifest.dialogues),
  quests: byManifestId(quests, manifest.quests),
  recruitments: byManifestId(recruitments, manifest.recruitments),
  shops: byManifestId(shops, manifest.shops),
  items: byManifestId(ITEM_DEFINITIONS, manifest.items),
  dropTables: byManifestId([...oldDropTables, ...abyssDropTables], manifest.dropTables),
  economy: ECONOMY_DEFINITION,
};

export const floors06To10Content: ContentRootV1 = Object.freeze(batchRoot);
export const floor06To10Content = floors06To10Content;
export const floors06To10ContentRoot = floors06To10Content;
export const floors06To10Catalog = ContentCatalog.create(floors06To10Content, { kind: "batch", batchId: "floors06_10" });
export const floor06To10Floors = Object.freeze(floors06To10);
export const floor06To10Maps = Object.freeze([floor06Map, floor07Map, floor08Map, floor09Map, floor10Map]);
export const floor06To10Enemies = Object.freeze(byManifestId(ENEMY_DEFINITIONS, [
  "enemy_abyss_mauler", "enemy_dread_eye", "enemy_blood_ghoul", "enemy_crimson_acolyte", "enemy_frost_warden", "enemy_ice_revenant", "enemy_void_spark", "enemy_watcher_shard", "enemy_throne_knight", "enemy_abyss_herald",
  "boss_abyss_butcher", "boss_crimson_knight", "boss_pale_jailer", "boss_thousand_eye", "boss_abyss_king",
]));
export const floor06To10Encounters = Object.freeze(byManifestId(ENCOUNTER_DEFINITIONS, [
  "encounter_floor_06_normal_a", "encounter_floor_06_normal_b", "encounter_floor_06_normal_c", "encounter_floor_06_elite_mauler", "encounter_floor_06_boss",
  "encounter_floor_07_normal_a", "encounter_floor_07_normal_b", "encounter_floor_07_normal_c", "encounter_floor_07_elite_acolyte", "encounter_floor_07_boss",
  "encounter_floor_08_normal_a", "encounter_floor_08_normal_b", "encounter_floor_08_normal_c", "encounter_floor_08_elite_warden", "encounter_floor_08_boss",
  "encounter_floor_09_normal_a", "encounter_floor_09_normal_b", "encounter_floor_09_normal_c", "encounter_floor_09_elite_shard", "encounter_floor_09_boss",
  "encounter_floor_10_normal_a", "encounter_floor_10_normal_b", "encounter_floor_10_normal_c", "encounter_floor_10_elite_knight", "encounter_floor_10_boss",
]));
export const floor06To10BossIntents = Object.freeze(byManifestId(abyssBossIntents, ["intent_butcher_cleaver", "intent_crimson_flurry", "intent_jailer_prison", "intent_eye_chain", "intent_king_annihilation"]));
export const floor06To10DropTables = Object.freeze(abyssDropTables);
export const floors06To10DropTables = floor06To10DropTables;
