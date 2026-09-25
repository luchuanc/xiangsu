/**
 * 每轮行动顺序构建器。
 *
 * ROUND_START 只读取一次单位当下速度并固化排序结果。后续 SPEED_CHANGED
 * 只能更新单位实时属性，不能把已经建立的本轮队列重新排序。
 */
import type { BattleUnitStateV1 } from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import type { InitiativeSnapshot } from "./BattleTypes";
import { resolveEffectiveStats, type StatusGetter } from "./BattleStatRuntime";

// 保留旧调用方只提供排序字段的能力；启用动态状态时，解析器会在运行时
// 严格要求完整 BattleUnitStateV1 字段，缺失内容按 INVALID_CONTENT 处理。
export type InitiativeUnit = Pick<
  BattleUnitStateV1,
  "unitId" | "faction" | "slot" | "stats" | "currentHp" | "eligibleRound"
> & Partial<Pick<BattleUnitStateV1, "definitionId" | "prePercentStats" | "staticPercentByStatBps" | "statuses" | "level" | "energy" | "cooldowns" | "usedExtraTurnThisRound" | "directHitEnergyRootActionIds">>;

export interface InitiativeOptions {
  readonly getStatus?: StatusGetter;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function compareUnitId(left: string, right: string): number {
  // JS 字符串比较按 UTF-16 code unit 排序，正好对应冻结规则。
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateUnit(unit: InitiativeUnit, index: number): DomainResult<true> {
  if (!unit || typeof unit !== "object") return invalid(`units[${index}]`, "not_object");
  if (typeof unit.unitId !== "string" || unit.unitId.length === 0) return invalid(`units[${index}].unitId`, "empty_id");
  if (unit.faction !== "party" && unit.faction !== "enemy") return invalid(`units[${index}].faction`, "unknown_faction");
  if (!Number.isSafeInteger(unit.slot) || unit.slot < 0) return invalid(`units[${index}].slot`, "slot");
  if (!Number.isSafeInteger(unit.currentHp) || unit.currentHp < 0) return invalid(`units[${index}].currentHp`, "current_hp");
  if (!Number.isSafeInteger(unit.eligibleRound) || unit.eligibleRound < 1) return invalid(`units[${index}].eligibleRound`, "eligible_round");
  if (!unit.stats || typeof unit.stats !== "object" || !Number.isSafeInteger(unit.stats.speed) || unit.stats.speed < 1) {
    return invalid(`units[${index}].stats.speed`, "speed");
  }
  return success(true);
}

/** 稳定排序键：速度降序、我方优先、槽位升序、unitId UTF-16 升序。 */
export function compareInitiativeUnits(left: InitiativeUnit, right: InitiativeUnit): number {
  return right.stats.speed - left.stats.speed
    || (left.faction === "party" ? 0 : 1) - (right.faction === "party" ? 0 : 1)
    || left.slot - right.slot
    || compareUnitId(left.unitId, right.unitId);
}

/**
 * 读取一轮的速度并生成队列与速度快照。
 * 死亡单位和 eligibleRound 尚未到达的召唤物会被排除，但仍会先校验结构。
 */
export function buildInitiativeSnapshot(
  units: readonly InitiativeUnit[],
  currentRound: number,
  options: InitiativeOptions = {},
): DomainResult<InitiativeSnapshot> {
  if (!Array.isArray(units)) return invalid("units", "array_required");
  if (!Number.isSafeInteger(currentRound) || currentRound < 1) return invalid("currentRound", "round");

  const seen = new Set<string>();
  const eligible: InitiativeUnit[] = [];
  const speedByUnitId: Record<string, number> = {};
  for (const [index, unit] of units.entries()) {
    const unitResult = validateUnit(unit, index);
    if (!unitResult.ok) return unitResult;
    if (seen.has(unit.unitId)) return invalid(`units[${index}].unitId`, "duplicate_id");
    seen.add(unit.unitId);
    const effectiveStats = resolveEffectiveStats(unit as BattleUnitStateV1, options.getStatus);
    if (!effectiveStats.ok) return effectiveStats;
    const effectiveUnit: InitiativeUnit = { ...unit, stats: effectiveStats.value };
    if (effectiveUnit.currentHp <= 0 || effectiveUnit.eligibleRound > currentRound) continue;
    // 这里的读取只发生一次，排序及返回的 speedByUnitId 共用这个值。
    speedByUnitId[effectiveUnit.unitId] = effectiveUnit.stats.speed;
    eligible.push(effectiveUnit);
  }

  eligible.sort(compareInitiativeUnits);
  return success({
    queueUnitIds: eligible.map((unit) => unit.unitId),
    speedByUnitId,
  });
}

/** RPG-013 冻结名称：每轮只建立一次队列和速度快照。 */
export function buildRoundInitiative(
  units: readonly InitiativeUnit[],
  currentRound: number,
  options: InitiativeOptions = {},
): DomainResult<InitiativeSnapshot> {
  return buildInitiativeSnapshot(units, currentRound, options);
}

/** 兼容只需要队列的调用方，完整速度快照由 buildInitiativeSnapshot 提供。 */
export function buildInitiativeQueue(
  units: readonly InitiativeUnit[],
  currentRound: number,
  options: InitiativeOptions = {},
): DomainResult<readonly string[]> {
  const result = buildInitiativeSnapshot(units, currentRound, options);
  return result.ok ? success(Object.freeze([...result.value.queueUnitIds])) : result;
}

export class InitiativeBuilder {
  public build(units: readonly InitiativeUnit[], currentRound: number, options: InitiativeOptions = {}): DomainResult<InitiativeSnapshot> {
    return buildInitiativeSnapshot(units, currentRound, options);
  }
}
