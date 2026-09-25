/**
 * 装备生成领域逻辑。
 *
 * 生成器只读取显式注入的底材、词条和经济配置；随机流、实例 ID 和时间
 * 也都由调用方提供。这样同一份掉落快照可以在重试和回放时得到同一结果。
 */
import type {
  CraftGrade,
  EquipmentAffixDefinition,
  EquipmentAffixId,
  EquipmentBaseDefinition,
  EquipmentBaseId,
  EquipmentBasePoolGroupV1,
  EquipmentInstance,
  EquipmentQuality,
  EconomyDefinition,
  EquipmentSlot,
  EquipmentAffixRoll,
  InstanceId,
  WeaponType,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import { SeededRng } from "../common/SeededRng";

export const EQUIPMENT_QUALITY_AFFIX_COUNT: Readonly<Record<EquipmentQuality, number>> = Object.freeze({
  common: 0,
  magic: 2,
  rare: 3,
  epic: 4,
  abyss: 4,
});

export const EQUIPMENT_SLOT_ORDER: readonly EquipmentSlot[] = [
  "weapon",
  "helmet",
  "armor",
  "gloves",
  "boots",
  "accessory",
];

const QUALITY_RANK: Readonly<Record<EquipmentQuality, number>> = {
  common: 0,
  magic: 1,
  rare: 2,
  epic: 3,
  abyss: 4,
};

export interface EquipmentContentSource {
  readonly equipmentBases: readonly EquipmentBaseDefinition[];
  readonly equipmentAffixes: readonly EquipmentAffixDefinition[];
  readonly economy: Readonly<EconomyDefinition>;
}

export interface EquipmentGenerationIdentity {
  readonly instanceId: InstanceId;
  readonly acquiredAt: string;
  readonly sourceTransactionId: string;
}

/** 已经确定底材、等级和品质时使用的生成请求。 */
export interface EquipmentGenerationInput extends EquipmentGenerationIdentity {
  readonly rng: SeededRng;
  readonly baseId: EquipmentBaseId;
  readonly itemLevel: number;
  readonly quality: EquipmentQuality;
  readonly craftGrade: CraftGrade | "weighted";
  readonly fixedAbyssAffixId?: EquipmentAffixId | null;
}

/** 掉落表的随机装备请求，严格按 itemLevel→部位→底材→品质顺序消费 RNG。 */
export interface RandomEquipmentGenerationInput extends EquipmentGenerationIdentity {
  readonly rng: SeededRng;
  readonly itemLevelMin: number;
  readonly itemLevelMax: number;
  readonly equipmentBasePools: readonly EquipmentBasePoolGroupV1[];
  readonly qualityWeights: readonly { quality: EquipmentQuality; weight: number }[];
  readonly guaranteedMinQuality: EquipmentQuality | null;
  readonly abyssUpgradeChanceBps: number;
  readonly craftGrade?: CraftGrade | "weighted";
  readonly fixedAbyssAffixId?: EquipmentAffixId | null;
}

export interface EquipmentGeneratorOptions {
  readonly idFactory?: () => InstanceId;
  readonly clock?: () => string;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function affixPoolEmpty(poolKind: "equipmentNormal" | "equipmentAbyss", itemLevel: number): DomainResult<never> {
  return failure(createDomainError("AFFIX_POOL_EMPTY", { poolKind, itemLevel }));
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function weighted<T>(rng: SeededRng, values: readonly { value: T; weight: number }[]): DomainResult<T> {
  if (values.length === 0) return invalid("equipment.pool", "empty");
  try {
    return success(rng.pickWeighted(values));
  } catch {
    return invalid("equipment.pool", "invalid_weight");
  }
}

function validIdentity(input: EquipmentGenerationIdentity): DomainResult<true> {
  if (!input || typeof input !== "object") return invalid("equipment.identity", "not_object");
  if (typeof input.instanceId !== "string" || input.instanceId.length === 0) return invalid("equipment.instanceId", "empty_id");
  if (typeof input.acquiredAt !== "string" || input.acquiredAt.length === 0) return invalid("equipment.acquiredAt", "empty_time");
  if (typeof input.sourceTransactionId !== "string" || input.sourceTransactionId.length === 0) return invalid("equipment.sourceTransactionId", "empty_id");
  return success(true);
}

function getBase(content: EquipmentContentSource, baseId: EquipmentBaseId): DomainResult<EquipmentBaseDefinition> {
  if (!Array.isArray(content.equipmentBases)) return invalid("equipmentBases", "array_required");
  const base = content.equipmentBases.find((candidate) => candidate.id === baseId);
  return base ? success(base) : invalid(`equipmentBases.${baseId}`, "missing_content");
}

function getAffix(content: EquipmentContentSource, affixId: EquipmentAffixId): DomainResult<EquipmentAffixDefinition> {
  if (!Array.isArray(content.equipmentAffixes)) return invalid("equipmentAffixes", "array_required");
  const affix = content.equipmentAffixes.find((candidate) => candidate.id === affixId);
  return affix ? success(affix) : invalid(`equipmentAffixes.${affixId}`, "missing_content");
}

function tierFor(affix: EquipmentAffixDefinition, itemLevel: number): EquipmentAffixDefinition["tiers"][number] | null {
  let selected: EquipmentAffixDefinition["tiers"][number] | null = null;
  for (const tier of affix.tiers) {
    if (tier.minItemLevel <= itemLevel && (selected === null || tier.minItemLevel > selected.minItemLevel)) {
      selected = tier;
    }
  }
  return selected;
}

function weaponAllowed(
  affix: EquipmentAffixDefinition,
  base: EquipmentBaseDefinition,
): boolean {
  if (affix.allowedWeaponTypes.length === 0) return true;
  const weaponType: WeaponType | null = base.weaponType;
  return weaponType !== null && affix.allowedWeaponTypes.includes(weaponType);
}

function candidateAffixes(
  content: EquipmentContentSource,
  base: EquipmentBaseDefinition,
  itemLevel: number,
  quality: EquipmentQuality,
  pool: "normal" | "abyss",
  excludedIds: ReadonlySet<EquipmentAffixId>,
  excludedGroups: ReadonlySet<string>,
  craftOnly = false,
): EquipmentAffixDefinition[] {
  return content.equipmentAffixes.filter((affix) => {
    if (affix.pool !== pool || excludedIds.has(affix.id)) return false;
    if (!affix.allowedSlots.includes(base.slot) || !weaponAllowed(affix, base)) return false;
    if (affix.minItemLevel > itemLevel || !affix.allowedQualities.includes(quality)) return false;
    if (affix.exclusiveGroup !== null && excludedGroups.has(affix.exclusiveGroup)) return false;
    if (tierFor(affix, itemLevel) === null) return false;
    if (craftOnly && (!affix.canBeCraftEmpowered || affix.category === "mechanic")) return false;
    return true;
  });
}

function addExclusions(
  affix: EquipmentAffixDefinition,
  ids: Set<EquipmentAffixId>,
  groups: Set<string>,
): void {
  ids.add(affix.id);
  if (affix.exclusiveGroup !== null) groups.add(affix.exclusiveGroup);
}

function createRoll(
  affix: EquipmentAffixDefinition,
  itemLevel: number,
  rng: SeededRng,
  craftEmpowered: boolean,
): DomainResult<EquipmentAffixRoll> {
  const tier = tierFor(affix, itemLevel);
  if (tier === null) return invalid(`equipmentAffixes.${affix.id}.tiers`, "no_eligible_tier");
  try {
    return success({
      affixId: affix.id,
      tier: tier.tier,
      // 闭区间即使 min=max 也调用一次 RNG，保证固定种子消费顺序稳定。
      roll: rng.nextIntInclusive(tier.rollMin, tier.rollMax),
      craftEmpowered,
      reforged: false,
    });
  } catch {
    return invalid(`equipmentAffixes.${affix.id}.tiers.${tier.tier}`, "roll_range");
  }
}

function pickOneAffix(
  content: EquipmentContentSource,
  base: EquipmentBaseDefinition,
  itemLevel: number,
  quality: EquipmentQuality,
  pool: "normal" | "abyss",
  rng: SeededRng,
  ids: Set<EquipmentAffixId>,
  groups: Set<string>,
  craftOnly = false,
): DomainResult<{ definition: EquipmentAffixDefinition; roll: EquipmentAffixRoll }> {
  const candidates = candidateAffixes(content, base, itemLevel, quality, pool, ids, groups, craftOnly);
  if (candidates.length === 0) return affixPoolEmpty(pool === "normal" ? "equipmentNormal" : "equipmentAbyss", itemLevel);
  const selected = weighted(rng, candidates.map((definition) => ({ value: definition, weight: definition.weight })));
  if (!selected.ok) return selected;
  const roll = createRoll(selected.value, itemLevel, rng, false);
  if (!roll.ok) return roll;
  addExclusions(selected.value, ids, groups);
  return success({ definition: selected.value, roll: roll.value });
}

function makeAbyssRoll(
  content: EquipmentContentSource,
  base: EquipmentBaseDefinition,
  itemLevel: number,
  quality: EquipmentQuality,
  rng: SeededRng,
  fixedAbyssAffixId: EquipmentAffixId | null | undefined,
  normalIds: ReadonlySet<EquipmentAffixId>,
  normalGroups: ReadonlySet<string>,
): DomainResult<EquipmentAffixRoll | null> {
  if (quality !== "abyss") return success(null);
  if (fixedAbyssAffixId !== undefined && fixedAbyssAffixId !== null) {
    const definitionResult = getAffix(content, fixedAbyssAffixId);
    if (!definitionResult.ok) return definitionResult;
    const definition = definitionResult.value;
    if (definition.pool !== "abyss"
      || !definition.allowedQualities.includes("abyss")
      || !definition.allowedSlots.includes(base.slot)
      || !weaponAllowed(definition, base)
      || definition.minItemLevel > itemLevel
      || tierFor(definition, itemLevel) === null
      || (definition.exclusiveGroup !== null && normalGroups.has(definition.exclusiveGroup))) {
      return affixPoolEmpty("equipmentAbyss", itemLevel);
    }
    // 固定深渊词条仍需生成一次 roll，且固定 tier 的 min=max 仍消费 RNG。
    return createRoll(definition, itemLevel, rng, false);
  }
  const ids = new Set(normalIds);
  const groups = new Set(normalGroups);
  const selected = pickOneAffix(content, base, itemLevel, "abyss", "abyss", rng, ids, groups);
  return selected.ok ? success(selected.value.roll) : selected;
}

function chooseCraftGrade(
  economy: Readonly<EconomyDefinition>,
  rng: SeededRng,
  craftableCount: number,
): DomainResult<CraftGrade> {
  const values: Array<{ value: CraftGrade; weight: number }> = [{ value: "ordinary", weight: economy.craftGradeWeights.ordinary }];
  if (craftableCount >= 1) values.push({ value: "tempered", weight: economy.craftGradeWeights.tempered });
  if (craftableCount >= 2) values.push({ value: "exalted", weight: economy.craftGradeWeights.exalted });
  return weighted(rng, values);
}

function empowerTargets(
  affixes: EquipmentAffixRoll[],
  definitions: readonly EquipmentAffixDefinition[],
  grade: CraftGrade,
  rng: SeededRng,
): DomainResult<void> {
  const targetCount = grade === "ordinary" ? 0 : grade === "tempered" ? 1 : 2;
  const candidates = affixes
    .map((roll, index) => ({ roll, index, definition: definitions.find((value) => value.id === roll.affixId) }))
    .filter((value): value is { roll: EquipmentAffixRoll; index: number; definition: EquipmentAffixDefinition } => value.definition !== undefined && value.definition.canBeCraftEmpowered && value.definition.category !== "mechanic");
  if (candidates.length < targetCount) return failure(createDomainError("AFFIX_POOL_EMPTY", { poolKind: "equipmentNormal", itemLevel: 0 }));
  const remaining = [...candidates];
  for (let count = 0; count < targetCount; count += 1) {
    let index: number;
    try {
      index = rng.nextIntInclusive(0, remaining.length - 1);
    } catch {
      return invalid("equipment.craft", "target_rng");
    }
    remaining[index].roll.craftEmpowered = true;
    remaining.splice(index, 1);
  }
  return success(undefined);
}

function createInstance(
  content: EquipmentContentSource,
  input: EquipmentGenerationInput,
  base: EquipmentBaseDefinition,
): DomainResult<EquipmentInstance> {
  if (!isInteger(input.itemLevel) || input.itemLevel < base.minItemLevel || input.itemLevel > base.maxItemLevel) {
    return invalid("equipment.itemLevel", "base_level_range");
  }
  if (!Object.prototype.hasOwnProperty.call(EQUIPMENT_QUALITY_AFFIX_COUNT, input.quality)) return invalid("equipment.quality", "unknown_quality");
  if (input.quality !== "abyss" && input.fixedAbyssAffixId !== undefined && input.fixedAbyssAffixId !== null) {
    return invalid("equipment.fixedAbyssAffixId", "non_abyss_must_be_null");
  }
  const grade = input.craftGrade;
  if (grade !== "ordinary" && grade !== "tempered" && grade !== "exalted" && grade !== "weighted") return invalid("equipment.craftGrade", "unknown_grade");

  const targetCount = EQUIPMENT_QUALITY_AFFIX_COUNT[input.quality];
  const ids = new Set<EquipmentAffixId>();
  const groups = new Set<string>();
  const affixes: EquipmentAffixRoll[] = [];

  // 指定 tempered/exalted 需要先抽强化候选，再按同一排除集补普通词条。
  let resolvedGrade: CraftGrade;
  if (grade === "tempered" || grade === "exalted") {
    resolvedGrade = grade;
    const required = grade === "tempered" ? 1 : 2;
    for (let index = 0; index < required; index += 1) {
      const selected = pickOneAffix(content, base, input.itemLevel, input.quality, "normal", input.rng, ids, groups, true);
      if (!selected.ok) return selected;
      selected.value.roll.craftEmpowered = true;
      affixes.push(selected.value.roll);
    }
    while (affixes.length < targetCount) {
      const selected = pickOneAffix(content, base, input.itemLevel, input.quality, "normal", input.rng, ids, groups);
      if (!selected.ok) return selected;
      affixes.push(selected.value.roll);
    }
  } else {
    for (let index = 0; index < targetCount; index += 1) {
      const selected = pickOneAffix(content, base, input.itemLevel, input.quality, "normal", input.rng, ids, groups);
      if (!selected.ok) return selected;
      affixes.push(selected.value.roll);
    }
    if (grade === "weighted") {
      const craftableCount = affixes.filter((roll) => {
        const definition = content.equipmentAffixes.find((value) => value.id === roll.affixId);
        return definition?.canBeCraftEmpowered === true && definition.category !== "mechanic";
      }).length;
      const selectedGrade = chooseCraftGrade(content.economy, input.rng, craftableCount);
      if (!selectedGrade.ok) return selectedGrade;
      resolvedGrade = selectedGrade.value;
      const empowered = empowerTargets(affixes, content.equipmentAffixes, resolvedGrade, input.rng);
      if (!empowered.ok) return empowered;
    } else {
      resolvedGrade = grade;
    }
  }

  const abyss = makeAbyssRoll(content, base, input.itemLevel, input.quality, input.rng, input.fixedAbyssAffixId, ids, groups);
  if (!abyss.ok) return abyss;
  return success({
    instanceId: input.instanceId,
    baseId: base.id,
    itemLevel: input.itemLevel,
    quality: input.quality,
    craftGrade: resolvedGrade,
    affixes: affixes.map(clone),
    abyssAffix: abyss.value === null ? null : clone(abyss.value),
    locked: false,
    acquiredAt: input.acquiredAt,
    sourceTransactionId: input.sourceTransactionId,
    reforgeLockedIndex: null,
    reforgeCount: 0,
  });
}

function chooseBase(
  content: EquipmentContentSource,
  pools: readonly EquipmentBasePoolGroupV1[],
  itemLevel: number,
  rng: SeededRng,
): DomainResult<EquipmentBaseId> {
  const groups = pools.map((group) => ({
    group,
    bases: group.bases.filter((entry) => {
      const base = content.equipmentBases.find((value) => value.id === entry.baseId);
      // 掉落池按当前 itemLevel 过滤，避免抽到不兼容底材后再静默降级。
      return entry.baseId.length > 0 && base !== undefined && itemLevel >= base.minItemLevel && itemLevel <= base.maxItemLevel;
    }),
  })).filter((entry) => EQUIPMENT_SLOT_ORDER.includes(entry.group.slot) && entry.bases.length > 0);
  if (groups.length === 0) return invalid("equipmentBasePools", "empty");
  const slotResult = weighted(rng, groups.map((entry) => ({ value: entry, weight: entry.group.weight })));
  if (!slotResult.ok) return slotResult;
  const baseResult = weighted(rng, slotResult.value.bases.map((base) => ({ value: base.baseId, weight: base.weight })));
  return baseResult;
}

function chooseQuality(
  weights: readonly { quality: EquipmentQuality; weight: number }[],
  minimum: EquipmentQuality | null,
  rng: SeededRng,
): DomainResult<EquipmentQuality> {
  const legal = weights.filter((entry) => {
    if (!(entry.quality in QUALITY_RANK)) return false;
    return minimum === null || QUALITY_RANK[entry.quality] >= QUALITY_RANK[minimum];
  });
  return weighted(rng, legal.map((entry) => ({ value: entry.quality, weight: entry.weight })));
}

export function generateEquipment(
  content: EquipmentContentSource,
  input: EquipmentGenerationInput,
): DomainResult<EquipmentInstance> {
  const identity = validIdentity(input);
  if (!identity.ok) return identity;
  if (!content || !Array.isArray(content.equipmentAffixes) || !content.economy) return invalid("content", "equipment_source");
  if (!(input.rng instanceof SeededRng)) return invalid("equipment.rng", "rng_required");
  const base = getBase(content, input.baseId);
  if (!base.ok) return base;
  return createInstance(content, input, base.value);
}

export function generateRandomEquipment(
  content: EquipmentContentSource,
  input: RandomEquipmentGenerationInput,
): DomainResult<EquipmentInstance> {
  const identity = validIdentity(input);
  if (!identity.ok) return identity;
  if (!content || !Array.isArray(content.equipmentAffixes) || !content.economy) return invalid("content", "equipment_source");
  if (!(input.rng instanceof SeededRng)) return invalid("equipment.rng", "rng_required");
  if (!isInteger(input.itemLevelMin) || !isInteger(input.itemLevelMax) || input.itemLevelMin > input.itemLevelMax) return invalid("equipment.itemLevel", "range");
  if (input.abyssUpgradeChanceBps < 0 || input.abyssUpgradeChanceBps > 10_000 || !isInteger(input.abyssUpgradeChanceBps)) return invalid("equipment.abyssUpgradeChanceBps", "bps");
  let itemLevel: number;
  try {
    itemLevel = input.rng.nextIntInclusive(input.itemLevelMin, input.itemLevelMax);
  } catch {
    return invalid("equipment.itemLevel", "range");
  }
  const baseId = chooseBase(content, input.equipmentBasePools, itemLevel, input.rng);
  if (!baseId.ok) return baseId;
  const base = getBase(content, baseId.value);
  if (!base.ok) return base;
  if (itemLevel < base.value.minItemLevel || itemLevel > base.value.maxItemLevel) return invalid("equipmentBasePools", "base_level_range");

  let quality: EquipmentQuality;
  try {
    quality = input.abyssUpgradeChanceBps > 0 && input.rng.rollBps(input.abyssUpgradeChanceBps)
      ? "abyss"
      : "" as EquipmentQuality;
  } catch {
    return invalid("equipment.abyssUpgradeChanceBps", "bps");
  }
  if (quality !== "abyss") {
    const qualityResult = chooseQuality(input.qualityWeights, input.guaranteedMinQuality, input.rng);
    if (!qualityResult.ok) return qualityResult;
    quality = qualityResult.value;
  }
  return generateEquipment(content, {
    ...input,
    baseId: base.value.id,
    itemLevel,
    quality,
    craftGrade: input.craftGrade ?? "weighted",
  });
}

export class EquipmentGenerator {
  private readonly content: EquipmentContentSource;
  private readonly idFactory: () => InstanceId;
  private readonly clock: () => string;

  public constructor(content: EquipmentContentSource, options: EquipmentGeneratorOptions = {}) {
    this.content = content;
    this.idFactory = options.idFactory ?? (() => "eq_generated");
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public generate(input: EquipmentGenerationInput): DomainResult<EquipmentInstance> {
    return generateEquipment(this.content, input);
  }

  public generateRandom(input: Omit<RandomEquipmentGenerationInput, keyof EquipmentGenerationIdentity> & Partial<EquipmentGenerationIdentity>): DomainResult<EquipmentInstance> {
    return generateRandomEquipment(this.content, {
      ...input,
      instanceId: input.instanceId ?? this.idFactory(),
      acquiredAt: input.acquiredAt ?? this.clock(),
      sourceTransactionId: input.sourceTransactionId ?? "generated",
    } as RandomEquipmentGenerationInput);
  }
}
