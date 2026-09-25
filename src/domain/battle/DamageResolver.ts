/**
 * 战斗数值解析器。
 *
 * 这里不依赖真实时间或渲染层；所有随机都通过调用方注入的 SeededRng
 * 消费，且返回新的目标单位，避免保存失败前污染权威快照。
 */
import type {
  BattleUnitStateV1,
  DamageCondition,
  DamageEffectSpec,
  Element,
  HealEffectSpec,
  ShieldEffectSpec,
} from "../../content/contracts";
import { SeededRng } from "../common/SeededRng";
import type { DomainResult } from "../common/DomainResult";
import { resolveEffectiveStats, type StatusGetter } from "./BattleStatRuntime";

export const DAMAGE_DEFENSE_CONSTANT = 300;
export const DAMAGE_VARIANCE_MIN_BPS = 9_500;
export const DAMAGE_VARIANCE_MAX_BPS = 10_500;

export interface DamageResolverInput {
  readonly attacker: Readonly<BattleUnitStateV1>;
  readonly target: Readonly<BattleUnitStateV1>;
  readonly effect: Readonly<DamageEffectSpec>;
  readonly rng: SeededRng;
  readonly damageBonusBps?: number;
  readonly finalDamageMultiplierBps?: number;
  readonly damageReductionBps?: number;
  readonly targetElementWeaknesses?: readonly Element[];
  readonly targetElementResistances?: readonly Element[];
  readonly getStatus?: StatusGetter;
}

export interface DamageResolution {
  readonly nextTarget: BattleUnitStateV1;
  readonly scaled: number;
  readonly effectiveDefense: number;
  readonly elementMultiplierBps: 7_500 | 10_000 | 12_500;
  readonly critical: boolean;
  readonly hitResult: "critical" | "nonCritical" | "notApplicable";
  readonly varianceBps: number;
  readonly finalDamage: number;
  readonly shieldDamage: number;
  readonly hpDamage: number;
  readonly overkill: number;
  readonly hpBefore: number;
  readonly hpAfter: number;
}

/** 周期伤害解析结果；周期效果不消费暴击/波动 RNG。 */
export interface PeriodicDamageResolution extends Omit<DamageResolution, "varianceBps"> {
  readonly varianceBps: null;
}

export interface PeriodicDamageResolverInput {
  /** 周期伤害使用状态创建时固化的 flatPower，不依赖当前来源单位；保留可选字段仅兼容旧调用方。 */
  readonly attacker?: Readonly<BattleUnitStateV1>;
  readonly target: Readonly<BattleUnitStateV1>;
  readonly effect: Readonly<DamageEffectSpec>;
  readonly targetElementWeaknesses?: readonly Element[];
  readonly targetElementResistances?: readonly Element[];
  readonly getStatus?: StatusGetter;
}

export interface HealResolverInput {
  readonly source: Readonly<BattleUnitStateV1>;
  readonly target: Readonly<BattleUnitStateV1>;
  readonly effect: Readonly<HealEffectSpec>;
  readonly healingBonusBps?: number;
  readonly rng: SeededRng;
  readonly getStatus?: StatusGetter;
}

export interface HealResolution {
  readonly nextTarget: BattleUnitStateV1;
  readonly raw: number;
  readonly finalHeal: number;
  readonly healed: number;
  readonly overheal: number;
  readonly critical: boolean;
  readonly hitResult: "critical" | "nonCritical" | "notApplicable";
  readonly hpBefore: number;
  readonly hpAfter: number;
}

export interface ShieldResolverInput {
  readonly source: Readonly<BattleUnitStateV1>;
  readonly target: Readonly<BattleUnitStateV1>;
  readonly effect: Readonly<ShieldEffectSpec>;
  readonly shieldBonusBps?: number;
  readonly statusStackId: string;
  readonly getStatus?: StatusGetter;
}

export interface ShieldResolution {
  readonly nextTarget: BattleUnitStateV1;
  readonly raw: number;
  readonly desired: number;
  readonly granted: number;
  readonly discardedByCap: number;
  readonly shieldAfter: number;
  readonly statusStackId: string | null;
}

function floorMul(value: number, bps: number): number {
  return Math.floor((value * bps) / 10_000);
}

function cloneUnit(unit: Readonly<BattleUnitStateV1>): BattleUnitStateV1 {
  return {
    ...unit,
    prePercentStats: { ...unit.prePercentStats },
    staticPercentByStatBps: { ...unit.staticPercentByStatBps },
    stats: { ...unit.stats },
    cooldowns: { ...unit.cooldowns },
    statuses: unit.statuses.map((status) => ({ ...status })),
    directHitEnergyRootActionIds: [...unit.directHitEnergyRootActionIds],
  };
}

function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, Number.isSafeInteger(value) ? value : 0));
}

function conditionSatisfied(
  condition: DamageCondition,
  source: Readonly<BattleUnitStateV1>,
  sourceStats: Readonly<BattleUnitStateV1["stats"]>,
  target: Readonly<BattleUnitStateV1>,
  targetStats: Readonly<BattleUnitStateV1["stats"]>,
): boolean {
  switch (condition.kind) {
    case "sourceHpAtMostBps": return source.currentHp * 10_000 <= sourceStats.maxHp * condition.valueBps;
    case "targetHpAtMostBps": return target.currentHp * 10_000 <= targetStats.maxHp * condition.valueBps;
    case "sourceHasStatus": return source.statuses.some((status) => status.statusId === condition.statusId);
    case "targetHasStatus": return target.statuses.some((status) => status.statusId === condition.statusId);
    case "targetStatusStacksAtLeast": return target.statuses.filter((value) => value.statusId === condition.statusId).reduce((sum) => sum + 1, 0) >= condition.stacks;
  }
}

function elementMultiplier(
  element: Element,
  weaknesses: readonly Element[],
  resistances: readonly Element[],
): 7_500 | 10_000 | 12_500 {
  if (element === "true") return 10_000;
  if (weaknesses.includes(element)) return 12_500;
  if (resistances.includes(element)) return 7_500;
  return 10_000;
}

function consumeShield(target: BattleUnitStateV1, amount: number): { shieldDamage: number; hpDamage: number; overkill: number } {
  let remaining = amount;
  let shieldDamage = 0;
  for (const status of target.statuses) {
    if (remaining <= 0) break;
    if (status.statusId !== "status_shield" || status.shieldRemaining <= 0) continue;
    const absorbed = Math.min(status.shieldRemaining, remaining);
    status.shieldRemaining -= absorbed;
    shieldDamage += absorbed;
    remaining -= absorbed;
  }
  const hpBefore = target.currentHp;
  const hpDamage = Math.min(hpBefore, remaining);
  target.currentHp = hpBefore - hpDamage;
  return { shieldDamage, hpDamage, overkill: Math.max(0, remaining - hpDamage) };
}

/** 按 6.1 的固定顺序解析一段直接伤害。 */
export function resolveDamage(input: DamageResolverInput): DomainResult<DamageResolution> {
  const attacker = input.attacker;
  const target = input.target;
  const effect = input.effect;
  const attackerStatsResult = resolveEffectiveStats(attacker, input.getStatus);
  if (!attackerStatsResult.ok) return attackerStatsResult;
  const targetStatsResult = resolveEffectiveStats(target, input.getStatus);
  if (!targetStatsResult.ok) return targetStatsResult;
  const attackerStats = attackerStatsResult.value;
  const targetStats = targetStatsResult.value;
  let effectivePowerBps = effect.powerBps;
  for (const multiplier of effect.conditionalMultipliers) {
    if (conditionSatisfied(multiplier.condition, attacker, attackerStats, target, targetStats)) effectivePowerBps = floorMul(effectivePowerBps, multiplier.multiplierBps);
  }
  const scaled = floorMul(attackerStats.attack, effectivePowerBps) + effect.flatPower;
  const boosted = floorMul(Math.max(0, scaled), Math.max(0, 10_000 + (input.damageBonusBps ?? 0)));
  const effectiveDefense = effect.element === "true"
    ? 0
    : Math.max(0, floorMul(targetStats.defense, 10_000 - effect.ignoreDefenseBps) - effect.flatIgnoreDefense);
  // 防御公式的分子/分母不是 basis-point 乘法，必须单独逐步向下取整。
  const defended = effect.element === "true"
    ? boosted
    : Math.floor((boosted * DAMAGE_DEFENSE_CONSTANT) / (DAMAGE_DEFENSE_CONSTANT + effectiveDefense));
  const multiplierBps = elementMultiplier(effect.element, input.targetElementWeaknesses ?? [], input.targetElementResistances ?? []);
  const elemental = floorMul(defended, multiplierBps);
  const critical = effect.canCrit ? input.rng.rollBps(clampBps(attackerStats.critRateBps)) : false;
  const criticalValue = critical ? floorMul(elemental, attackerStats.critDamageBps) : elemental;
  // 无论中间伤害是否为 0，直接伤害都必须消费一次确定性波动。
  const varianceBps = input.rng.nextIntInclusive(DAMAGE_VARIANCE_MIN_BPS, DAMAGE_VARIANCE_MAX_BPS);
  const varied = floorMul(criticalValue, varianceBps);
  const finalBoosted = input.finalDamageMultiplierBps === undefined ? varied : floorMul(varied, Math.max(0, 10_000 + input.finalDamageMultiplierBps));
  const implicitGuardReduction = target.statuses.some((status) => status.statusId === "status_guard_30") ? 3_000 : 0;
  const reductionBps = Math.max(0, Math.min(9_000, input.damageReductionBps ?? implicitGuardReduction));
  const reduced = floorMul(finalBoosted, 10_000 - reductionBps);
  const finalDamage = scaled > 0 && reduced === 0 ? 1 : reduced;
  const nextTarget = cloneUnit(target);
  const hpBefore = nextTarget.currentHp;
  const consumed = consumeShield(nextTarget, finalDamage);
  return {
    ok: true,
    value: {
      nextTarget,
      scaled,
      effectiveDefense,
      elementMultiplierBps: multiplierBps,
      critical,
      hitResult: effect.canCrit ? (critical ? "critical" : "nonCritical") : "notApplicable",
      varianceBps,
      finalDamage,
      ...consumed,
      hpBefore,
      hpAfter: nextTarget.currentHp,
    },
  };
}

/**
 * 按状态快照解析周期伤害。
 *
 * 周期伤害只使用 StatusRuntime 固化到 effect.flatPower 的攻击快照和目标
 * 当前有效防御；不消费 RNG、不暴击、不读取动态增伤，也不套用 guard。
 */
export function resolvePeriodicDamage(input: PeriodicDamageResolverInput): DomainResult<PeriodicDamageResolution> {
  const targetStatsResult = resolveEffectiveStats(input.target, input.getStatus);
  if (!targetStatsResult.ok) return targetStatsResult;
  const effect = input.effect;
  const scaled = Math.max(0, effect.flatPower);
  const effectiveDefense = effect.element === "true"
    ? 0
    : Math.max(0, floorMul(targetStatsResult.value.defense, 10_000 - effect.ignoreDefenseBps) - effect.flatIgnoreDefense);
  const defended = effect.element === "true"
    ? scaled
    : Math.floor((scaled * DAMAGE_DEFENSE_CONSTANT) / (DAMAGE_DEFENSE_CONSTANT + effectiveDefense));
  const multiplierBps = elementMultiplier(effect.element, input.targetElementWeaknesses ?? [], input.targetElementResistances ?? []);
  const reduced = floorMul(defended, multiplierBps);
  // 周期伤害与直接伤害一样，正值在高防御/抗性下仍至少造成 1 点；
  // 但这里不引入直接伤害的暴击、波动或减伤阶段。
  const finalDamage = scaled > 0 && reduced === 0 ? 1 : reduced;
  const nextTarget = cloneUnit(input.target);
  const hpBefore = nextTarget.currentHp;
  const consumed = consumeShield(nextTarget, finalDamage);
  return {
    ok: true,
    value: {
      nextTarget,
      scaled,
      effectiveDefense,
      elementMultiplierBps: multiplierBps,
      critical: false,
      hitResult: "notApplicable",
      varianceBps: null,
      finalDamage,
      ...consumed,
      hpBefore,
      hpAfter: nextTarget.currentHp,
    },
  };
}

/** 按 6.3 解析治疗，实际 healed 会被缺失生命截断。 */
export function resolveHeal(input: HealResolverInput): DomainResult<HealResolution> {
  const sourceStatsResult = resolveEffectiveStats(input.source, input.getStatus);
  if (!sourceStatsResult.ok) return sourceStatsResult;
  const targetStatsResult = resolveEffectiveStats(input.target, input.getStatus);
  if (!targetStatsResult.ok) return targetStatsResult;
  const sourceStats = sourceStatsResult.value;
  const targetStats = targetStatsResult.value;
  const scaling = input.effect.scalingStat === "attack" ? sourceStats.attack : targetStats.maxHp;
  const raw = floorMul(scaling, input.effect.powerBps) + input.effect.flatPower;
  const critical = input.effect.canCrit ? input.rng.rollBps(clampBps(sourceStats.critRateBps)) : false;
  const criticalRaw = critical ? floorMul(raw, sourceStats.critDamageBps) : raw;
  const finalHeal = floorMul(Math.max(0, criticalRaw), Math.max(0, 10_000 + (input.healingBonusBps ?? 0)));
  const hpBefore = input.target.currentHp;
  const healed = Math.min(Math.max(0, targetStats.maxHp - hpBefore), finalHeal);
  const nextTarget = cloneUnit(input.target);
  nextTarget.currentHp = hpBefore + healed;
  return {
    ok: true,
    value: {
      nextTarget, raw, finalHeal, healed, overheal: Math.max(0, finalHeal - healed), critical,
      hitResult: input.effect.canCrit ? (critical ? "critical" : "nonCritical") : "notApplicable", hpBefore, hpAfter: nextTarget.currentHp,
    },
  };
}

/** 创建 status_shield 栈；护盾吸收和状态顺序由 DamageResolver 保持。 */
export function resolveShield(input: ShieldResolverInput): DomainResult<ShieldResolution> {
  const sourceStatsResult = resolveEffectiveStats(input.source, input.getStatus);
  if (!sourceStatsResult.ok) return sourceStatsResult;
  const targetStatsResult = resolveEffectiveStats(input.target, input.getStatus);
  if (!targetStatsResult.ok) return targetStatsResult;
  const sourceStats = sourceStatsResult.value;
  const targetStats = targetStatsResult.value;
  const scaling = input.effect.scalingStat === "attack" ? sourceStats.attack : targetStats.maxHp;
  const raw = floorMul(scaling, input.effect.powerBps) + input.effect.flatPower;
  const desired = floorMul(Math.max(0, raw), Math.max(0, 10_000 + (input.shieldBonusBps ?? 0)));
  const nextTarget = cloneUnit(input.target);
  const existing = nextTarget.statuses.filter((status) => status.statusId === input.effect.statusId).length;
  if (desired <= 0 || existing >= 99) return { ok: true, value: { nextTarget, raw, desired, granted: 0, discardedByCap: desired, shieldAfter: nextTarget.statuses.reduce((sum, status) => sum + (status.statusId === "status_shield" ? status.shieldRemaining : 0), 0), statusStackId: null } };
  nextTarget.statuses.push({ stackId: input.statusStackId, statusId: input.effect.statusId, sourceUnitId: input.source.unitId, remainingOwnerTurns: input.effect.durationOwnerTurns, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: sourceStats.attack, shieldRemaining: desired });
  const shieldAfter = nextTarget.statuses.reduce((sum, status) => sum + (status.statusId === "status_shield" ? status.shieldRemaining : 0), 0);
  return { ok: true, value: { nextTarget, raw, desired, granted: desired, discardedByCap: 0, shieldAfter, statusStackId: input.statusStackId } };
}

export const resolveDirectDamage = resolveDamage;
export const calculateDamage = resolveDamage;
