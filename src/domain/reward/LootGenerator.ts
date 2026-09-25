/**
 * 固定种子掉落生成器。
 *
 * 掉落 roll 按内容原数组执行；装备/铭石实例统一复用既有生成器，实例
 * ID、来源事务号和 RNG 子流都由调用方固定。首杀表只对 encounter 生效，
 * abyssEcho 只提升 eligible equipment 的深渊升级概率并追加固定材料。
 */
import type {
  DropRollDefinition,
  DropTableDefinition,
  EquipmentInstance,
  InventoryStateV1,
  RewardTransactionV1,
  SkillStoneInstance,
  StackableItemDefinition,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import { SeededRng } from "../common/SeededRng";
import { generateEquipment, generateRandomEquipment, type EquipmentContentSource } from "../inventory/EquipmentGenerator";
import { generateSkillStone, type SkillStoneContentSource } from "../skill/SkillStoneGenerator";

export interface LootContentSource {
  getItem(id: string): DomainResult<Readonly<StackableItemDefinition>>;
  readonly equipment: EquipmentContentSource;
  readonly skillStone: SkillStoneContentSource;
  readonly recruitedCharacterIds: readonly string[];
}

export interface AbyssLootOptions {
  readonly bonusAbyssUpgradeChanceBps: number;
  readonly firstClearForgeShards: number;
  readonly firstClearInscriptionDust: number;
  readonly isFirstClear: boolean;
}

export interface LootGenerationInput {
  readonly transactionId: string;
  readonly source: RewardTransactionV1["source"];
  readonly table: Readonly<DropTableDefinition>;
  readonly firstClearTable?: Readonly<DropTableDefinition>;
  readonly isFirstClear?: boolean;
  readonly abyssEcho?: AbyssLootOptions;
  readonly inventory: Readonly<InventoryStateV1>;
  readonly rng: SeededRng;
  readonly content: LootContentSource;
  readonly gold?: number;
  readonly xp?: number;
  readonly acquiredAt?: string;
  readonly nextInstanceId?: (index: number) => string;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isRewardSource(value: unknown): value is RewardTransactionV1["source"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (source.kind === "encounter") return typeof source.encounterId === "string" && typeof source.mapId === "string" && typeof source.objectId === "string";
  if (source.kind === "chest") return typeof source.mapId === "string" && typeof source.objectId === "string" && typeof source.dropTableId === "string";
  if (source.kind === "abyssEcho") return typeof source.echoId === "string" && typeof source.encounterId === "string";
  return false;
}

function cloneInventory(inventory: Readonly<InventoryStateV1>): InventoryStateV1 {
  return structuredClone(inventory);
}

function validateInput(input: LootGenerationInput): DomainResult<true> {
  if (!input || typeof input.transactionId !== "string" || input.transactionId.length === 0) return invalid("loot.transactionId", "required");
  if (!isRewardSource(input.source)) return invalid("loot.source", "strict_source");
  if (!input.table || typeof input.table.id !== "string" || !Array.isArray(input.table.rolls)) return invalid("loot.table", "shape");
  if (!(input.rng instanceof SeededRng)) return invalid("loot.rng", "rng_required");
  if (!input.inventory || !input.content) return invalid("loot", "dependencies_required");
  if (input.source.kind === "chest" && input.source.dropTableId !== input.table.id) return invalid("loot.source.dropTableId", "table_mismatch");
  if (input.source.kind === "abyssEcho" && !input.abyssEcho) return invalid("loot.abyssEcho", "required");
  if (input.abyssEcho && input.source.kind !== "abyssEcho") return invalid("loot.abyssEcho", "source_mismatch");
  if (input.abyssEcho && (!Number.isSafeInteger(input.abyssEcho.bonusAbyssUpgradeChanceBps) || input.abyssEcho.bonusAbyssUpgradeChanceBps < 0 || input.abyssEcho.bonusAbyssUpgradeChanceBps > 5_000 || !Number.isSafeInteger(input.abyssEcho.firstClearForgeShards) || input.abyssEcho.firstClearForgeShards < 0 || !Number.isSafeInteger(input.abyssEcho.firstClearInscriptionDust) || input.abyssEcho.firstClearInscriptionDust < 0 || typeof input.abyssEcho.isFirstClear !== "boolean")) return invalid("loot.abyssEcho", "shape");
  return success(true);
}

function getItem(content: LootContentSource, itemId: string): DomainResult<Readonly<StackableItemDefinition>> {
  try {
    const result = content.getItem(itemId);
    if (!result.ok) return result;
    if (result.value.id !== itemId) return invalid(`items.${itemId}`, "id_mismatch");
    return result;
  } catch {
    return invalid(`items.${itemId}`, "getter_failed");
  }
}

function addStackable(
  stackables: Record<string, number>,
  itemId: string,
  quantity: number,
): void {
  stackables[itemId] = (stackables[itemId] ?? 0) + quantity;
}

function quantity(rng: SeededRng, min: number, max: number, path: string): DomainResult<number> {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) return invalid(path, "quantity_range");
  try {
    return success(rng.nextIntInclusive(min, max));
  } catch {
    return invalid(path, "quantity_rng");
  }
}

function rollChance(rng: SeededRng, chanceBps: number, path: string): DomainResult<boolean> {
  if (!Number.isSafeInteger(chanceBps) || chanceBps < 0 || chanceBps > 10_000) return invalid(path, "chance_range");
  try {
    return success(rng.rollBps(chanceBps));
  } catch {
    return invalid(path, "chance_rng");
  }
}

const SKILL_STONE_QUALITY_RANK: Readonly<Record<string, number>> = { magic: 0, rare: 1, epic: 2, abyss: 3 };

function chooseSkillStoneQuality(
  input: Extract<DropRollDefinition, { kind: "skillStone" }>,
  rng: SeededRng,
  path: string,
): DomainResult<Extract<DropRollDefinition, { kind: "skillStone" }>["qualityWeights"][number]["quality"]> {
  const minimum = input.guaranteedMinQuality === null ? -1 : SKILL_STONE_QUALITY_RANK[input.guaranteedMinQuality];
  const legal = input.qualityWeights.filter((entry) => SKILL_STONE_QUALITY_RANK[entry.quality] >= minimum);
  if (legal.length === 0) return invalid(path, "quality_pool_empty");
  try {
    return success(rng.pickWeighted(legal.map((entry) => ({ value: entry.quality, weight: entry.weight }))));
  } catch {
    return invalid(path, "quality_weight");
  }
}

function appendDropRoll(
  input: LootGenerationInput,
  roll: DropRollDefinition,
  index: number,
  stackables: Record<string, number>,
  equipment: EquipmentInstance[],
  skillStones: SkillStoneInstance[],
  instanceOrder: string[],
  instanceIndex: { value: number },
): DomainResult<true> {
  const chance = rollChance(input.rng, roll.chanceBps, `drop.rolls[${index}].chanceBps`);
  if (!chance.ok) return chance;
  if (!chance.value) return success(true);
  if (roll.kind === "stackableItem" || roll.kind === "stackableItemPool") {
    let itemId: string;
    if (roll.kind === "stackableItem") itemId = roll.itemId;
    else {
      if (roll.itemPool.length === 0) return invalid(`drop.rolls[${index}].itemPool`, "empty");
      try {
        itemId = input.rng.pickWeighted(roll.itemPool.map((entry) => ({ value: entry.itemId, weight: entry.weight })));
      } catch {
        return invalid(`drop.rolls[${index}].itemPool`, "weight");
      }
    }
    const item = getItem(input.content, itemId);
    if (!item.ok) return item;
    const amount = quantity(input.rng, roll.quantityMin, roll.quantityMax, `drop.rolls[${index}].quantity`);
    if (!amount.ok) return amount;
    if (amount.value > 0) addStackable(stackables, itemId, amount.value);
    return success(true);
  }
  const instanceId = input.nextInstanceId?.(instanceIndex.value) ?? `${input.transactionId}:instance:${instanceIndex.value}`;
  if (typeof instanceId !== "string" || instanceId.length === 0) return invalid(`drop.rolls[${index}].instanceId`, "required");
  const acquiredAt = input.acquiredAt ?? "2026-01-01T00:00:00.000Z";
  let generated: DomainResult<EquipmentInstance | SkillStoneInstance>;
  if (roll.kind === "equipment") {
    const bonus = input.source.kind === "abyssEcho" ? (input.abyssEcho?.bonusAbyssUpgradeChanceBps ?? 0) : 0;
    generated = generateRandomEquipment(input.content.equipment, {
      rng: input.rng,
      instanceId,
      acquiredAt,
      sourceTransactionId: input.transactionId,
      itemLevelMin: roll.itemLevelMin,
      itemLevelMax: roll.itemLevelMax,
      equipmentBasePools: roll.equipmentBasePools,
      qualityWeights: roll.qualityWeights,
      guaranteedMinQuality: roll.guaranteedMinQuality,
      abyssUpgradeChanceBps: Math.min(10_000, roll.abyssUpgradeChanceBps + bonus),
      craftGrade: "weighted",
    });
  } else if (roll.kind === "fixedEquipment") {
    generated = generateEquipment(input.content.equipment, {
      rng: input.rng,
      instanceId,
      acquiredAt,
      sourceTransactionId: input.transactionId,
      baseId: roll.baseId,
      itemLevel: roll.itemLevel,
      quality: roll.quality,
      craftGrade: roll.craftGrade === "weighted" ? "weighted" : roll.craftGrade,
      fixedAbyssAffixId: roll.fixedAbyssAffixId,
    });
  } else {
    let itemLevel: number;
    try {
      itemLevel = input.rng.nextIntInclusive(roll.itemLevelMin, roll.itemLevelMax);
    } catch {
      return invalid(`drop.rolls[${index}].itemLevel`, "range");
    }
    const quality = chooseSkillStoneQuality(roll, input.rng, `drop.rolls[${index}].qualityWeights`);
    if (!quality.ok) return quality;
    generated = generateSkillStone(input.content.skillStone, {
      itemLevel,
      quality: quality.value,
      recruitedCharacterIds: input.content.recruitedCharacterIds,
      rng: input.rng,
      instanceId,
      acquiredAt,
      sourceTransactionId: input.transactionId,
    });
  }
  if (!generated.ok) return generated;
  instanceIndex.value += 1;
  instanceOrder.push(generated.value.instanceId);
  if (roll.kind === "skillStone") skillStones.push(generated.value as SkillStoneInstance);
  else equipment.push(generated.value as EquipmentInstance);
  return success(true);
}

function capStackables(
  input: LootGenerationInput,
  raw: Readonly<Record<string, number>>,
): DomainResult<{ readonly stackables: Record<string, number>; readonly conversions: RewardTransactionV1["stackableCapConversions"]; readonly gold: number }> {
  const inventory = cloneInventory(input.inventory);
  const stackables: Record<string, number> = {};
  const conversions: RewardTransactionV1["stackableCapConversions"] = [];
  let gold = input.gold ?? 0;
  for (const [itemId, requested] of Object.entries(raw)) {
    if (!Number.isSafeInteger(requested) || requested < 0) return invalid(`loot.stackables.${itemId}`, "quantity_range");
    const item = getItem(input.content, itemId);
    if (!item.ok) return item;
    const owned = inventory.stackables[itemId] ?? 0;
    if (!Number.isSafeInteger(owned) || owned < 0 || owned > 9_999) return invalid(`inventory.stackables.${itemId}`, "quantity_range");
    const accepted = Math.min(requested, 9_999 - owned);
    const overflow = requested - accepted;
    if (accepted > 0) stackables[itemId] = accepted;
    if (overflow > 0) {
      const value = overflow * item.value.baseGoldValue;
      gold += value;
      conversions.push({ itemId, quantity: overflow, gold: value });
    }
  }
  return success({ stackables, conversions, gold });
}

/** 生成不可变奖励候选；调用方仍需通过 RewardService 做领取 dry-run。 */
export function generateLoot(input: LootGenerationInput): DomainResult<RewardTransactionV1> {
  const valid = validateInput(input);
  if (!valid.ok) return valid;
  const stackables: Record<string, number> = {};
  const equipment: EquipmentInstance[] = [];
  const skillStones: SkillStoneInstance[] = [];
  const instanceOrder: string[] = [];
  const instanceIndex = { value: 0 };
  const process = (table: Readonly<DropTableDefinition>, offset: number): DomainResult<true> => {
    for (const [index, roll] of table.rolls.entries()) {
      const result = appendDropRoll(input, roll, offset + index, stackables, equipment, skillStones, instanceOrder, instanceIndex);
      if (!result.ok) return result;
    }
    return success(true);
  };
  const regular = process(input.table, 0);
  if (!regular.ok) return regular;
  if (input.source.kind === "encounter" && input.isFirstClear && input.firstClearTable) {
    const first = process(input.firstClearTable, input.table.rolls.length);
    if (!first.ok) return first;
  }
  if (input.source.kind === "abyssEcho" && input.abyssEcho?.isFirstClear) {
    if (input.abyssEcho.firstClearForgeShards > 0) addStackable(stackables, "item_forge_shard", input.abyssEcho.firstClearForgeShards);
    if (input.abyssEcho.firstClearInscriptionDust > 0) addStackable(stackables, "item_inscription_dust", input.abyssEcho.firstClearInscriptionDust);
  }
  const capped = capStackables(input, stackables);
  if (!capped.ok) return capped;
  return success({
    transactionId: input.transactionId,
    source: structuredClone(input.source),
    gold: capped.value.gold,
    xp: input.xp ?? 0,
    stackables: capped.value.stackables,
    stackableCapConversions: capped.value.conversions,
    equipment,
    skillStones,
    instanceOrder,
    claimed: false,
  });
}

export class LootGenerator {
  public generate(input: LootGenerationInput): DomainResult<RewardTransactionV1> {
    return generateLoot(input);
  }
}
