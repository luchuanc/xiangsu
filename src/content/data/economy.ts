/** RPG-010 经济与重铸固定数值。 */
import type { EconomyDefinition } from "../contracts";

export const ECONOMY_DEFINITION: Readonly<EconomyDefinition> = Object.freeze({
  equipmentSellRateBps: 2500,
  shopBuyMarkupBps: 20_000,
  buybackLimit: 10,
  innCostGold: 0,
  craftGradeWeights: { ordinary: 70, tempered: 25, exalted: 5 },
  equipmentDisassembleYieldByQuality: { common: 1, magic: 2, rare: 4, epic: 8, abyss: 16 },
  skillStoneDisassembleYieldByQuality: { magic: 2, rare: 4, epic: 8, abyss: 16 },
  equipmentDisassembleMaterialItemId: "item_forge_shard",
  skillStoneDisassembleMaterialItemId: "item_inscription_dust",
  stackableTotalCap: 9999,
  equipmentReforgeBaseCost: 5,
  equipmentReforgePerItemLevelCost: 1,
  skillStoneReforgeBaseCost: 5,
  skillStoneReforgePerTwoItemLevelsCost: 1,
} as const);

export const economy = ECONOMY_DEFINITION;
