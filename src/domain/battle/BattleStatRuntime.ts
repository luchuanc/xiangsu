/**
 * 战斗有效属性解析器。
 *
 * `stats` 是入战时的静态基线；状态带来的动态 flat/percent 只能在读取
 * 有效属性时临时合并，不能回写到任何快照字段。这样 ROUND_START、伤害和
 * 条件判断都能使用同一套公式，并且保存失败时不会污染原单位。
 */
import type { BattleUnitStateV1, StatBlock, StatusDefinition } from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";

export type StatusGetter = (statusId: string) => DomainResult<Readonly<StatusDefinition>>;

export const STAT_KEYS: readonly (keyof StatBlock)[] = [
  "maxHp",
  "attack",
  "defense",
  "speed",
  "critRateBps",
  "critDamageBps",
  "effectHitBps",
  "effectResistBps",
];

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function cloneStats(stats: Readonly<StatBlock>): StatBlock {
  return { ...stats };
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function validateStatRecord(stats: Readonly<StatBlock> | undefined, path: string): DomainResult<true> {
  if (!stats || typeof stats !== "object") return invalid(path, "shape");
  for (const key of STAT_KEYS) {
    if (!isInteger(stats[key])) return invalid(`${path}.${key}`, "integer");
  }
  return success(true);
}

function clampEffectiveStat(key: keyof StatBlock, value: number): number {
  if (key === "critRateBps" || key === "effectHitBps" || key === "effectResistBps") {
    return Math.max(0, Math.min(10_000, value));
  }
  if (key === "critDamageBps") return Math.max(10_000, Math.min(30_000, value));
  return Math.max(1, value);
}

function statusDefinition(
  getStatus: StatusGetter,
  statusId: string,
  index: number,
): DomainResult<Readonly<StatusDefinition>> {
  if (typeof statusId !== "string" || statusId.length === 0) return invalid(`unit.statuses[${index}].statusId`, "empty_id");
  let result: DomainResult<Readonly<StatusDefinition>>;
  try {
    result = getStatus(statusId);
  } catch {
    return invalid(`statuses.${statusId}`, "getter_failed");
  }
  // 内容 getter 的失败不能把任意外部错误向上泄漏；状态引用问题统一归为
  // INVALID_CONTENT，调用方可按相同语义中止本次临时解析。
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean") return invalid(`statuses.${statusId}`, "getter_failed");
  if (!result.ok) return invalid(`statuses.${statusId}`, "missing_reference");
  if (!result.value || result.value.id !== statusId) return invalid(`statuses.${statusId}`, "id_mismatch");
  if (!result.value.effect || typeof result.value.effect !== "object") return invalid(`statuses.${statusId}.effect`, "shape");
  return success(result.value);
}

/**
 * 按冻结公式返回单位当前有效属性。
 * 未注入状态表时保留历史 fixture 语义，只复制 `unit.stats`，不主动猜测
 * 状态 ID 的来源；正式战斗必须注入显式 getStatus 才会解析动态状态。
 */
export function resolveEffectiveStats(
  unit: Readonly<BattleUnitStateV1>,
  getStatus?: StatusGetter,
): DomainResult<StatBlock> {
  if (!unit || typeof unit !== "object") return invalid("unit", "shape");
  const statsValidation = validateStatRecord(unit.stats, "unit.stats");
  if (!statsValidation.ok) return statsValidation;
  if (!getStatus) return success(cloneStats(unit.stats));

  const preValidation = validateStatRecord(unit.prePercentStats, "unit.prePercentStats");
  if (!preValidation.ok) return preValidation;
  const staticValidation = validateStatRecord(unit.staticPercentByStatBps, "unit.staticPercentByStatBps");
  if (!staticValidation.ok) return staticValidation;
  if (!Array.isArray(unit.statuses)) return invalid("unit.statuses", "array_required");

  const dynamicFlat: StatBlock = {
    maxHp: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    critRateBps: 0,
    critDamageBps: 0,
    effectHitBps: 0,
    effectResistBps: 0,
  };
  const dynamicPercentBps: StatBlock = { ...dynamicFlat };

  for (const [index, stack] of unit.statuses.entries()) {
    if (!stack || typeof stack !== "object") return invalid(`unit.statuses[${index}]`, "shape");
    const definition = statusDefinition(getStatus, stack.statusId, index);
    if (!definition.ok) return definition;
    if (definition.value.effect.kind !== "statModifier") continue;
    const modifier = definition.value.effect;
    if (!STAT_KEYS.includes(modifier.stat)) return invalid(`statuses.${stack.statusId}.effect.stat`, "unknown_stat");
    if (!isInteger(modifier.flat)) return invalid(`statuses.${stack.statusId}.effect.flat`, "integer");
    if (!isInteger(modifier.percentBps)) return invalid(`statuses.${stack.statusId}.effect.percentBps`, "integer");
    dynamicFlat[modifier.stat] += modifier.flat;
    dynamicPercentBps[modifier.stat] += modifier.percentBps;
    if (!isInteger(dynamicFlat[modifier.stat]) || !isInteger(dynamicPercentBps[modifier.stat])) {
      return invalid(`statuses.${stack.statusId}.effect`, "range");
    }
  }

  const resolved: StatBlock = { ...unit.stats };
  for (const key of STAT_KEYS) {
    const base = unit.prePercentStats[key] + dynamicFlat[key];
    const multiplierBps = 10_000 + unit.staticPercentByStatBps[key] + dynamicPercentBps[key];
    if (!isInteger(base) || !isInteger(multiplierBps)) return invalid(`unit.${key}`, "range");
    const value = Math.floor((base * multiplierBps) / 10_000);
    if (!Number.isSafeInteger(value)) return invalid(`unit.${key}`, "range");
    resolved[key] = clampEffectiveStat(key, value);
  }
  return success(resolved);
}
