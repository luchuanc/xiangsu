import type { DropTableDefinition, EquipmentBasePoolGroupV1 } from "../contracts";
import { EQUIPMENT_BASE_POOLS } from "./equipment";

const qualityWeights = [
  { quality: "common" as const, weight: 35 },
  { quality: "magic" as const, weight: 50 },
  { quality: "rare" as const, weight: 15 },
  { quality: "epic" as const, weight: 0 },
  { quality: "abyss" as const, weight: 0 },
];
const skillStoneQualityWeights = [
  { quality: "magic" as const, weight: 80 },
  { quality: "rare" as const, weight: 20 },
];
const materialPool = [
  { itemId: "item_forge_shard", weight: 70 },
  { itemId: "item_inscription_dust", weight: 30 },
];
const basePools: EquipmentBasePoolGroupV1[] = EQUIPMENT_BASE_POOLS.map((group) => ({ slot: group.slot, weight: group.weight, bases: group.bases.map((entry) => ({ ...entry })) }));

function equipment(chanceBps: number, guaranteedMinQuality: "magic" | "rare" | null, itemLevelMin = 1, itemLevelMax = 5) {
  return { kind: "equipment" as const, chanceBps, itemLevelMin, itemLevelMax, equipmentBasePools: basePools, qualityWeights, guaranteedMinQuality, abyssUpgradeChanceBps: 0 };
}
function skillStone(chanceBps: number, guaranteedMinQuality: "magic" | "rare" | null, itemLevelMin = 1, itemLevelMax = 5) {
  return { kind: "skillStone" as const, chanceBps, itemLevelMin, itemLevelMax, qualityWeights: skillStoneQualityWeights, guaranteedMinQuality };
}
function material(chanceBps: number, quantityMin = 1, quantityMax = 2) {
  return { kind: "stackableItemPool" as const, itemPool: materialPool, chanceBps, quantityMin, quantityMax };
}

const definitions: DropTableDefinition[] = [
  { id: "drop_floor_01_normal", rolls: [equipment(3500, null), material(7000)] },
  { id: "drop_floor_01_elite", rolls: [equipment(10000, "magic", 3, 3), equipment(2000, null, 1, 5), skillStone(10000, "rare", 3, 3), material(10000)] },
  { id: "drop_floor_01_boss", rolls: [equipment(10000, "rare", 5, 5), equipment(5000, null, 5, 5), skillStone(5000, null, 5, 5), material(10000), material(10000)] },
  { id: "drop_floor_01_chest", rolls: [equipment(10000, "magic"), material(10000)] },
  { id: "drop_floor_01_first_clear", rolls: [{ kind: "stackableItem", itemId: "item_forge_shard", chanceBps: 10000, quantityMin: 5, quantityMax: 5 }] },
];

/** 第一层五张掉落表；不从 tableId 后缀在运行时推导参数。 */
export const DROP_TABLE_DEFINITIONS: readonly DropTableDefinition[] = Object.freeze(definitions);
export const dropTableDefinitionsReadonly = DROP_TABLE_DEFINITIONS;
export const dropTables = DROP_TABLE_DEFINITIONS;

