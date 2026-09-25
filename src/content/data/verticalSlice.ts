import type { ContentRootV1, EncounterModifierDefinition, FloorDefinition, BossIntentDefinition, MapDefinition } from "../contracts";
import { ContentCatalog, FROZEN_BATCH_MANIFESTS } from "../Catalog";
import { affixTriggers } from "./affixTriggers";
import { CHARACTER_DEFINITIONS } from "./characters";
import { combos } from "./combos";
import { DROP_TABLE_DEFINITIONS } from "./dropTables";
import { ENCOUNTER_DEFINITIONS } from "./encounters";
import { ENEMY_DEFINITIONS } from "./enemies";
import { ECONOMY_DEFINITION } from "./economy";
import { EQUIPMENT_AFFIX_DEFINITIONS, EQUIPMENT_BASE_DEFINITIONS, EQUIPMENT_BASE_POOLS } from "./equipment";
import { ITEM_DEFINITIONS } from "./items";
import { dialogues } from "./dialogues";
import { npcs } from "./npcs";
import { quests } from "./quests";
import { recruitments } from "./recruitment";
import { shops } from "./shops";
import { SKILL_AFFIX_DEFINITIONS } from "./skillAffixes";
import { SKILL_DEFINITIONS, VERTICAL_SLICE_EXTRA_SKILLS } from "./skills";
import { statuses } from "./statuses";
import { floor01Map } from "./maps/floor01";
import { townMap } from "./maps/town";

const batch = FROZEN_BATCH_MANIFESTS.verticalSlice;

function byManifestId<T extends { id: string }>(values: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(values.map((value) => [value.id, value]));
  return ids.map((id) => {
    const value = byId.get(id);
    if (!value) throw new Error(`verticalSlice 内容缺少冻结 ID: ${id}`);
    return value;
  });
}

const floors: FloorDefinition[] = [{
  id: "floor_01",
  nameKey: "floor.floor_01.name",
  floorNumber: 1,
  mapId: "map_floor_01",
  bossEncounterId: "encounter_floor_01_boss",
  assetBundleId: "floor_01",
  minItemLevel: 1,
  maxItemLevel: 5,
  recommendedBossLevel: 4,
  recommendedItemLevel: 3,
  bossEnrageRound: 12,
  bossGateType: "tutorial",
  bossPhaseThresholdBps: [5000],
  shortRouteObjectIds: ["obj_f01_n01", "obj_f01_n02", "obj_f01_n03", "obj_f01_e01", "obj_f01_chest01"],
  isAbyss: false,
  firstClearRewardTableId: "drop_floor_01_first_clear",
}];

const encounterModifiers: EncounterModifierDefinition[] = [
  { id: "modifier_assault", nameKey: "encounter_modifier.modifier_assault.name", descriptionKey: "encounter_modifier.modifier_assault.description", rule: { kind: "timedStat", faction: "enemy", stat: "attack", valueBps: 1000, fromRound: 1, throughRound: 2 } },
  { id: "modifier_swift", nameKey: "encounter_modifier.modifier_swift.name", descriptionKey: "encounter_modifier.modifier_swift.description", rule: { kind: "timedStat", faction: "enemy", stat: "speed", valueBps: 1200, fromRound: 1, throughRound: 2 } },
  { id: "modifier_bulwark", nameKey: "encounter_modifier.modifier_bulwark.name", descriptionKey: "encounter_modifier.modifier_bulwark.description", rule: { kind: "timedStat", faction: "enemy", stat: "defense", valueBps: 1200, fromRound: 1, throughRound: 3 } },
  { id: "modifier_mire", nameKey: "encounter_modifier.modifier_mire.name", descriptionKey: "encounter_modifier.modifier_mire.description", rule: { kind: "timedStat", faction: "party", stat: "speed", valueBps: -1000, fromRound: 1, throughRound: 2 } },
];

const bossIntents: BossIntentDefinition[] = [{
  id: "intent_horned_charge",
  bossId: "boss_horned_king",
  skillId: "skill_boss_horned_charge",
  targetStrategy: "frontFirstOpponent",
  delayLegalActions: 1,
  counterKind: "guard",
}];

const allSkills = [...SKILL_DEFINITIONS, ...VERTICAL_SLICE_EXTRA_SKILLS];

// 全局装备池会随后续楼层扩展；首层掉落必须裁剪到本批次底材，避免跨批次引用。
const verticalSliceEquipmentBaseIds = new Set(batch.equipmentBases);
const verticalSliceBasePools = EQUIPMENT_BASE_POOLS.map((group) => ({
  slot: group.slot,
  weight: group.weight,
  bases: group.bases.filter((base) => verticalSliceEquipmentBaseIds.has(base.baseId)).map((base) => ({ ...base })),
}));
const verticalSliceDropTables = DROP_TABLE_DEFINITIONS.map((table) => ({
  ...table,
  rolls: table.rolls.map((roll) => roll.kind === "equipment" ? { ...roll, equipmentBasePools: verticalSliceBasePools } : roll),
}));
const verticalSliceShops = shops.map((shop) => ({
  ...shop,
  tiers: shop.tiers.map((tier) => ({ ...tier, equipmentBasePools: verticalSliceBasePools })),
}));

/**
 * 垂直切片只暴露本批次已冻结的 NPC；地图碰撞、尺寸、出生点和传送门仍复用完整城镇地图。
 * 不能直接裁剪 townMap，否则会把后续楼层 NPC 的引用带进首层 ContentRoot。
 */
const verticalSliceTownMap: MapDefinition = {
  ...townMap,
  objects: townMap.objects.filter((object) => object.kind !== "npc" || batch.npcs.includes(object.npcId)),
};

/**
 * 第一层正式内容根。批次只筛选冻结集合，避免把未来楼层或夹具数据混入首层。
 */
export const verticalSliceContentRoot: ContentRootV1 = {
  schemaVersion: 1,
  contentVersion: "content-1.2.0",
  protagonistCharacterId: "char_wanderer",
  characters: byManifestId(CHARACTER_DEFINITIONS, batch.characters),
  skills: byManifestId(allSkills, batch.skills),
  statuses: byManifestId(statuses, batch.statuses),
  equipmentBases: byManifestId(EQUIPMENT_BASE_DEFINITIONS, batch.equipmentBases),
  equipmentAffixes: byManifestId(EQUIPMENT_AFFIX_DEFINITIONS, batch.equipmentAffixes),
  affixTriggers: byManifestId(affixTriggers, batch.affixTriggers),
  skillAffixes: byManifestId(SKILL_AFFIX_DEFINITIONS, batch.skillAffixes),
  combos: byManifestId(combos, batch.combos),
  enemies: byManifestId(ENEMY_DEFINITIONS, batch.enemies),
  encounters: byManifestId(ENCOUNTER_DEFINITIONS, batch.encounters),
  encounterModifiers: byManifestId(encounterModifiers, batch.encounterModifiers),
  bossIntents: byManifestId(bossIntents, batch.bossIntents),
  abyssEchoes: [],
  floors: byManifestId(floors, batch.floors),
  maps: byManifestId([verticalSliceTownMap, floor01Map], batch.maps),
  npcs: byManifestId(npcs, batch.npcs),
  dialogues: byManifestId(dialogues, batch.dialogues),
  quests: byManifestId(quests, batch.quests),
  recruitments: byManifestId(recruitments, batch.recruitments),
  shops: byManifestId(verticalSliceShops, batch.shops),
  items: byManifestId(ITEM_DEFINITIONS, batch.items),
  dropTables: byManifestId(verticalSliceDropTables, batch.dropTables),
  economy: ECONOMY_DEFINITION,
};

/** 生产构建与内容测试统一使用此批次根，禁止回退到 fixture。 */
export const candidateVerticalSliceContentRoot = verticalSliceContentRoot;
export const verticalSliceCatalog = ContentCatalog.create(verticalSliceContentRoot, { kind: "batch", batchId: "verticalSlice" });
