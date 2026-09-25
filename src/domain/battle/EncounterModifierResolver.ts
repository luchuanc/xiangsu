/**
 * 遭遇修正的纯领域解析器。
 *
 * 修正不是 StatusDefinition，也不进入状态层数或触发队列；这里仅按
 * EncounterDefinition.modifierIds 的原顺序累加动态属性、护盾、斩杀增伤
 * 与治疗压制，所有计算都不消费 RNG。
 */
import type {
  EncounterModifierDefinition,
  StatBlock,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";

type Faction = "party" | "enemy";

export interface EncounterModifierApplication {
  readonly stats: StatBlock;
  readonly startShieldByUnitId: Readonly<Record<string, number>>;
  readonly activeModifierIds: readonly string[];
}

export interface EncounterModifierInput {
  readonly modifiers: readonly EncounterModifierDefinition[];
  readonly round: number;
  readonly faction: Faction;
  readonly stats: Readonly<StatBlock>;
  /** 只用于开场护盾；key 顺序由调用方的 slot 顺序提供。 */
  readonly maxHpByUnitId?: Readonly<Record<string, number>>;
}

export interface EncounterDamageInput {
  readonly modifiers: readonly EncounterModifierDefinition[];
  readonly round: number;
  readonly sourceFaction: Faction;
  readonly targetCurrentHp: number;
  readonly targetMaxHp: number;
  readonly baseDamage: number;
  readonly damageKind: "direct" | "periodic";
}

export interface EncounterHealingInput {
  readonly modifiers: readonly EncounterModifierDefinition[];
  readonly faction: Faction;
  readonly amount: number;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function validBps(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000;
}

function validateModifiers(modifiers: readonly EncounterModifierDefinition[]): DomainResult<true> {
  if (!Array.isArray(modifiers)) return invalid("encounter.modifiers", "array_required");
  const ids = new Set<string>();
  for (const [index, modifier] of modifiers.entries()) {
    if (!modifier || typeof modifier.id !== "string" || modifier.id.length === 0) return invalid(`encounter.modifiers[${index}]`, "id");
    if (ids.has(modifier.id)) return invalid(`encounter.modifiers[${index}].id`, "duplicate_id");
    ids.add(modifier.id);
    const rule = modifier.rule;
    if (!rule || typeof rule.kind !== "string") return invalid(`encounter.modifiers[${index}].rule`, "required");
    if (rule.kind === "timedStat") {
      if (rule.fromRound < 1 || rule.throughRound < rule.fromRound || !Number.isSafeInteger(rule.fromRound) || !Number.isSafeInteger(rule.throughRound)) return invalid(`encounter.modifiers[${index}].rule`, "round_range");
      if (!validBps(rule.valueBps)) return invalid(`encounter.modifiers[${index}].rule.valueBps`, "bps");
    } else if (rule.kind === "battleStartShield") {
      if (rule.faction !== "enemy" || !Number.isSafeInteger(rule.maxHpBps) || rule.maxHpBps < 1 || rule.maxHpBps > 9_999) return invalid(`encounter.modifiers[${index}].rule`, "start_shield");
    } else if (rule.kind === "executeDamage") {
      if (rule.faction !== "enemy" || !Number.isSafeInteger(rule.targetHpAtMostBps) || rule.targetHpAtMostBps < 1 || rule.targetHpAtMostBps > 9_999 || !Number.isSafeInteger(rule.damageBonusBps) || rule.damageBonusBps < 1 || rule.damageBonusBps > 9_999) return invalid(`encounter.modifiers[${index}].rule`, "execute_damage");
    } else if (rule.kind === "escalatingStat") {
      if (rule.faction !== "enemy" || !Number.isSafeInteger(rule.perRoundBps) || rule.perRoundBps < 1 || !Number.isSafeInteger(rule.capBps) || rule.capBps < rule.perRoundBps || rule.capBps > 10_000) return invalid(`encounter.modifiers[${index}].rule`, "escalating_stat");
    } else if (rule.kind === "healingSuppression") {
      if (rule.faction !== "party" || !Number.isSafeInteger(rule.valueBps) || rule.valueBps < 1 || rule.valueBps > 9_999) return invalid(`encounter.modifiers[${index}].rule`, "healing_suppression");
    } else {
      return invalid(`encounter.modifiers[${index}].rule`, "unknown_kind");
    }
  }
  return success(true);
}

function cloneStats(stats: Readonly<StatBlock>): StatBlock {
  return { ...stats };
}

function statBpsForRound(
  modifiers: readonly EncounterModifierDefinition[],
  faction: Faction,
  round: number,
): { attack: number; defense: number; speed: number; activeModifierIds: string[] } {
  const total = { attack: 0, defense: 0, speed: 0 };
  const activeModifierIds: string[] = [];
  for (const modifier of modifiers) {
    const rule = modifier.rule;
    if (rule.kind === "timedStat" && rule.faction === faction && round >= rule.fromRound && round <= rule.throughRound) {
      total[rule.stat] += rule.valueBps;
      activeModifierIds.push(modifier.id);
    }
    if (rule.kind === "escalatingStat" && rule.faction === faction) {
      total[rule.stat] += Math.min(rule.capBps, Math.max(0, round - 1) * rule.perRoundBps);
      activeModifierIds.push(modifier.id);
    }
  }
  return { ...total, activeModifierIds };
}

/** 计算某阵营在指定回合的有效属性和开场护盾。 */
export function applyEncounterModifiers(input: EncounterModifierInput): DomainResult<EncounterModifierApplication> {
  const valid = validateModifiers(input.modifiers);
  if (!valid.ok) return valid;
  if (!Number.isSafeInteger(input.round) || input.round < 1) return invalid("encounter.round", "positive_integer");
  if (!input.stats || typeof input.stats !== "object") return invalid("encounter.stats", "object_required");

  const bps = statBpsForRound(input.modifiers, input.faction, input.round);
  const stats = cloneStats(input.stats);
  for (const key of ["attack", "defense", "speed"] as const) {
    stats[key] = Math.floor(stats[key] * (10_000 + bps[key]) / 10_000);
  }

  const startShieldByUnitId: Record<string, number> = {};
  if (input.faction === "enemy" && input.maxHpByUnitId) {
    const shieldBps = input.modifiers
      .filter((modifier) => modifier.rule.kind === "battleStartShield")
      .reduce((sum, modifier) => sum + (modifier.rule.kind === "battleStartShield" ? modifier.rule.maxHpBps : 0), 0);
    for (const [unitId, maxHp] of Object.entries(input.maxHpByUnitId)) {
      if (!Number.isSafeInteger(maxHp) || maxHp < 1) return invalid(`maxHpByUnitId.${unitId}`, "positive_integer");
      if (shieldBps > 0) startShieldByUnitId[unitId] = Math.floor(maxHp * shieldBps / 10_000);
    }
  }
  return success({ stats, startShieldByUnitId, activeModifierIds: bps.activeModifierIds });
}

/** 解析直接伤害的遭遇斩杀增伤；周期伤害明确不享受该修正。 */
export function resolveEncounterDamage(input: EncounterDamageInput): DomainResult<{ readonly damage: number; readonly bonusBps: number }> {
  const valid = validateModifiers(input.modifiers);
  if (!valid.ok) return valid;
  if (!Number.isSafeInteger(input.baseDamage) || input.baseDamage < 0) return invalid("damage.baseDamage", "non_negative_integer");
  if (!Number.isSafeInteger(input.targetCurrentHp) || input.targetCurrentHp < 0 || !Number.isSafeInteger(input.targetMaxHp) || input.targetMaxHp < 1 || input.targetCurrentHp > input.targetMaxHp) return invalid("damage.targetHp", "range");
  let bonusBps = 0;
  if (input.sourceFaction === "enemy" && input.damageKind === "direct") {
    for (const modifier of input.modifiers) {
      const rule = modifier.rule;
      if (rule.kind !== "executeDamage") continue;
      if (input.targetCurrentHp * 10_000 <= input.targetMaxHp * rule.targetHpAtMostBps) bonusBps += rule.damageBonusBps;
    }
  }
  return success({ damage: Math.floor(input.baseDamage * (10_000 + bonusBps) / 10_000), bonusBps });
}

/** 只压制最终非过量治疗，不影响护盾或最大生命。 */
export function resolveEncounterHealing(input: EncounterHealingInput): DomainResult<{ readonly amount: number; readonly suppressionBps: number }> {
  const valid = validateModifiers(input.modifiers);
  if (!valid.ok) return valid;
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) return invalid("healing.amount", "non_negative_integer");
  let suppressionBps = 0;
  if (input.faction === "party") {
    for (const modifier of input.modifiers) {
      if (modifier.rule.kind === "healingSuppression") suppressionBps += modifier.rule.valueBps;
    }
  }
  suppressionBps = Math.min(10_000, suppressionBps);
  return success({ amount: Math.floor(input.amount * (10_000 - suppressionBps) / 10_000), suppressionBps });
}

/** 中文别名，供 BattleFactory/无渲染夹具调用。 */
export const resolveEncounterModifier = applyEncounterModifiers;
