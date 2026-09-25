/**
 * 角色静态属性解析器。
 *
 * 所有中间值和结果都保持安全整数。百分比只以 basis point 参与计算，
 * 因此装备、被动和 Combo 系统可以直接复用 prePercent/staticPercent 快照。
 */
import type { CharacterDefinition, StatBlock } from "../../content/contracts";
import { failure, success, type DomainResult } from "../common/DomainResult";
import { mulBpsFloor } from "../common/FixedMath";
import {
  CHARACTER_STAT_KEYS,
  MAX_CHARACTER_LEVEL,
  MIN_CHARACTER_LEVEL,
  validateCharacterDefinition,
  type CharacterStatKey,
} from "./Character";

export interface StatModifierInput {
  /** 无条件 flat 来源；缺少的 stat 按 0 处理。 */
  readonly flat?: Partial<Record<CharacterStatKey, number>>;
  /** 无条件百分比来源；缺少的 stat 按 0 处理。 */
  readonly percentBps?: Partial<Record<CharacterStatKey, number>>;
}

export interface StatCalculationResult {
  readonly level: number;
  readonly baseStats: StatBlock;
  readonly growthStats: StatBlock;
  readonly flatStats: StatBlock;
  readonly prePercentStats: StatBlock;
  readonly staticPercentByStatBps: StatBlock;
  /** 百分比乘法后、最小值/范围 clamp 前的整数结果。 */
  readonly postPercentStats: StatBlock;
  /** 可用于战斗的最终基础属性。 */
  readonly stats: StatBlock;
  readonly sources: Readonly<Record<CharacterStatKey, StatSourceDetail>>;
}

export interface StatSourceDetail {
  readonly base: number;
  readonly growth: number;
  readonly flat: number;
  readonly prePercent: number;
  readonly percentBps: number;
  readonly postPercent: number;
  readonly final: number;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure({
    code: "INVALID_CONTENT",
    details: { path, issueKey },
  });
}

function zeroStats(): StatBlock {
  return {
    maxHp: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    critRateBps: 0,
    critDamageBps: 0,
    effectHitBps: 0,
    effectResistBps: 0,
  };
}

function validateIntegerMap(
  map: Partial<Record<CharacterStatKey, number>> | undefined,
  path: string,
): DomainResult<true> {
  if (map !== undefined && (typeof map !== "object" || Array.isArray(map))) return invalid(path, "not_object");
  for (const key of Object.keys(map ?? {})) {
    if (!(CHARACTER_STAT_KEYS as readonly string[]).includes(key)) return invalid(`${path}.${key}`, "unknown_stat");
  }
  for (const key of CHARACTER_STAT_KEYS) {
    const value = map?.[key];
    if (value !== undefined && !Number.isSafeInteger(value)) return invalid(`${path}.${key}`, "non_integer");
  }
  return success(true);
}

function finalValue(key: CharacterStatKey, value: number): number {
  switch (key) {
    case "maxHp":
    case "attack":
    case "defense":
    case "speed":
      return Math.max(1, value);
    case "critRateBps":
    case "effectHitBps":
    case "effectResistBps":
      return Math.min(10_000, Math.max(0, value));
    case "critDamageBps":
      return Math.min(30_000, Math.max(10_000, value));
  }
}

/**
 * 按冻结公式计算角色属性：
 * floor((base + growth * (level - 1) + flat) * (10000 + percentBps) / 10000)。
 */
export function calculateStats(
  character: CharacterDefinition,
  level: number,
  modifiers: StatModifierInput = {},
): DomainResult<StatCalculationResult> {
  const definitionResult = validateCharacterDefinition(character);
  if (!definitionResult.ok) return definitionResult;
  if (!Number.isSafeInteger(level) || level < MIN_CHARACTER_LEVEL || level > MAX_CHARACTER_LEVEL) {
    return invalid("character.level", "level_range");
  }
  const flatResult = validateIntegerMap(modifiers.flat, "modifiers.flat");
  if (!flatResult.ok) return flatResult;
  const percentResult = validateIntegerMap(modifiers.percentBps, "modifiers.percentBps");
  if (!percentResult.ok) return percentResult;

  const baseStats = { ...character.baseStats };
  const growthStats = zeroStats();
  const flatStats = zeroStats();
  const prePercentStats = zeroStats();
  const staticPercentByStatBps = zeroStats();
  const postPercentStats = zeroStats();
  const stats = zeroStats();
  const sources = {} as Record<CharacterStatKey, StatSourceDetail>;

  for (const key of CHARACTER_STAT_KEYS) {
    const base = character.baseStats[key];
    const growth = character.growthPerLevel[key] * (level - 1);
    const flat = modifiers.flat?.[key] ?? 0;
    const percentBps = modifiers.percentBps?.[key] ?? 0;
    if (![base, growth, flat, percentBps].every(Number.isSafeInteger)) {
      return invalid(`characters.${character.id}.${key}`, "non_integer");
    }
    const prePercent = base + growth + flat;
    if (!Number.isSafeInteger(prePercent)) return invalid(`characters.${character.id}.${key}`, "overflow");
    const multiplierBps = 10_000 + percentBps;
    if (!Number.isSafeInteger(multiplierBps)) return invalid(`modifiers.percentBps.${key}`, "overflow");
    const postPercent = mulBpsFloor(prePercent, multiplierBps);
    const final = finalValue(key, postPercent);
    growthStats[key] = growth;
    flatStats[key] = flat;
    prePercentStats[key] = prePercent;
    staticPercentByStatBps[key] = percentBps;
    postPercentStats[key] = postPercent;
    stats[key] = final;
    sources[key] = { base, growth, flat, prePercent, percentBps, postPercent, final };
  }

  return success({
    level,
    baseStats,
    growthStats,
    flatStats,
    prePercentStats,
    staticPercentByStatBps,
    postPercentStats,
    stats,
    sources,
  });
}

/** 将八字段 stat block 映射为可传入属性计算器的 flat 来源。 */
export function flatStatBlock(stats: Partial<StatBlock>): StatModifierInput {
  return { flat: { ...stats } };
}
