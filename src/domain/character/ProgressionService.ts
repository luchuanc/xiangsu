/**
 * 角色累计经验、升级生命补偿和招募追赶服务。
 *
 * 服务只接受 ContentCatalog 的严格 getter（或同契约注入源），不根据 ID
 * 名称猜测角色/技能，也不在这里维护编队、装备或战斗状态。
 */
import type {
  CharacterDefinition,
  CharacterProgressV1,
  PassiveModifierSpec,
  SkillDefinition,
  StatBlock,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import {
  cloneCharacterProgress,
  createCharacterProgress,
  MAX_CHARACTER_LEVEL,
  MAX_CHARACTER_XP,
  MIN_CHARACTER_LEVEL,
  validateCharacterProgressShape,
} from "./Character";
import {
  calculateStats,
  type StatCalculationResult,
  type StatModifierInput,
} from "./StatCalculator";

export interface CharacterContentSource {
  getCharacter(id: string): DomainResult<Readonly<CharacterDefinition>>;
  getSkill(id: string): DomainResult<Readonly<SkillDefinition>>;
}

export interface CharacterProgressionServiceOptions {
  readonly content: CharacterContentSource;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function requireLevel(level: number): void {
  if (!Number.isSafeInteger(level) || level < MIN_CHARACTER_LEVEL || level > MAX_CHARACTER_LEVEL) {
    throw new RangeError("角色等级必须是 1～50 的整数");
  }
}

function requireExperience(xp: number): void {
  if (!Number.isSafeInteger(xp) || xp < 0) throw new RangeError("经验必须是非负整数");
}

/** 返回某等级的累计经验下限，1 级为 0，50 级为 75460。 */
export function experienceThresholdForLevel(level: number): number {
  requireLevel(level);
  const levelsGained = level - 1;
  return 100 * levelsGained + 30 * levelsGained * (levelsGained - 1);
}

/** 返回从当前等级升到下一级所需的增量经验；50 级没有下一级。 */
export function nextLevelExperience(level: number): number | null {
  requireLevel(level);
  if (level === MAX_CHARACTER_LEVEL) return null;
  return 100 + 60 * (level - 1);
}

/** 从累计经验唯一反算等级；超过终局经验的输入钳制到 50 级。 */
export function levelFromExperience(xp: number): number {
  requireExperience(xp);
  const clamped = Math.min(MAX_CHARACTER_XP, xp);
  let level = MIN_CHARACTER_LEVEL;
  while (level < MAX_CHARACTER_LEVEL && experienceThresholdForLevel(level + 1) <= clamped) level += 1;
  return level;
}

function mergeModifiers(first: StatModifierInput, second: StatModifierInput): StatModifierInput {
  const flat: Partial<StatBlock> = {};
  const percentBps: Partial<StatBlock> = {};
  const statKeys: Array<keyof StatBlock> = [
    "maxHp",
    "attack",
    "defense",
    "speed",
    "critRateBps",
    "critDamageBps",
    "effectHitBps",
    "effectResistBps",
  ];
  for (const key of statKeys) {
    const flatValue = (first.flat?.[key] ?? 0) + (second.flat?.[key] ?? 0);
    const percentValue = (first.percentBps?.[key] ?? 0) + (second.percentBps?.[key] ?? 0);
    if (flatValue !== 0) flat[key] = flatValue;
    if (percentValue !== 0) percentBps[key] = percentValue;
  }
  return { flat, percentBps };
}

function passiveModifiers(skill: SkillDefinition): DomainResult<StatModifierInput> {
  if (skill.kind !== "passive") return invalid(`skills.${skill.id}.kind`, "passive_skill_required");
  const flat: Partial<StatBlock> = {};
  const percentBps: Partial<StatBlock> = {};
  const addFlat = (stat: keyof StatBlock, value: number): DomainResult<true> => {
    if (!Number.isSafeInteger(value)) return invalid(`skills.${skill.id}.passiveModifiers`, "non_integer");
    flat[stat] = (flat[stat] ?? 0) + value;
    return success(true);
  };
  const addPercent = (stat: keyof StatBlock, valueBps: number): DomainResult<true> => {
    if (!Number.isSafeInteger(valueBps)) return invalid(`skills.${skill.id}.passiveModifiers`, "non_integer");
    percentBps[stat] = (percentBps[stat] ?? 0) + valueBps;
    return success(true);
  };
  for (const modifier of skill.passiveModifiers as readonly PassiveModifierSpec[]) {
    if (modifier.kind === "flatStat") {
      const result = addFlat(modifier.stat, modifier.value);
      if (!result.ok) return result;
    } else if (modifier.kind === "percentStat") {
      const result = addPercent(modifier.stat, modifier.valueBps);
      if (!result.ok) return result;
    }
    // damage/healing/shield 被动不是八字段基础属性，在此阶段不应猜测映射。
  }
  return success({ flat, percentBps });
}

function emptyModifiers(): StatModifierInput {
  return { flat: {}, percentBps: {} };
}

export class ProgressionService {
  private readonly content: CharacterContentSource;

  public constructor(contentOrOptions: CharacterContentSource | CharacterProgressionServiceOptions) {
    this.content = "content" in contentOrOptions ? contentOrOptions.content : contentOrOptions;
  }

  /** 通过严格 getter 解析角色，不保留未知 ID 的本地兜底。 */
  public getCharacter(characterId: string): DomainResult<Readonly<CharacterDefinition>> {
    if (typeof characterId !== "string" || characterId.length === 0) return invalid("characterId", "empty_id");
    return this.content.getCharacter(characterId);
  }

  private getDefinitionAndPassive(characterId: string): DomainResult<{ character: Readonly<CharacterDefinition>; modifiers: StatModifierInput }> {
    const characterResult = this.getCharacter(characterId);
    if (!characterResult.ok) return characterResult;
    const skillResult = this.content.getSkill(characterResult.value.passiveSkillId);
    if (!skillResult.ok) return skillResult;
    const modifiersResult = passiveModifiers(skillResult.value);
    if (!modifiersResult.ok) return modifiersResult;
    return success({ character: characterResult.value, modifiers: modifiersResult.value });
  }

  /** 计算角色在固定被动和传入静态来源下的可解释属性。 */
  public calculateStats(
    characterId: string,
    level: number,
    modifiers: StatModifierInput = emptyModifiers(),
  ): DomainResult<StatCalculationResult> {
    const resolved = this.getDefinitionAndPassive(characterId);
    if (!resolved.ok) return resolved;
    return calculateStats(resolved.value.character, level, mergeModifiers(resolved.value.modifiers, modifiers));
  }

  /**
   * 为已招募角色分配一笔遭遇经验。inParty=true 为 100%，已招募但未出战
   * 为向下取整的 50%；未招募角色始终获得 0。
   */
  public awardExperience(
    progress: CharacterProgressV1,
    amount: number,
    inParty: boolean,
  ): DomainResult<CharacterProgressV1> {
    if (!progress || typeof progress !== "object") return invalid("characterProgress", "not_object");
    if (typeof inParty !== "boolean") return invalid("inParty", "boolean_required");
    if (!Number.isSafeInteger(amount) || amount < 0) return invalid("amount", "non_negative_integer");
    const resolved = this.getDefinitionAndPassive(progress.characterId);
    if (!resolved.ok) return resolved;
    const shapeResult = validateCharacterProgressShape(progress, resolved.value.character);
    if (!shapeResult.ok) return shapeResult;
    let oldLevel: number;
    try {
      oldLevel = levelFromExperience(progress.xp);
    } catch {
      return invalid("characterProgress.xp", "xp_range");
    }
    if (oldLevel !== progress.level) return invalid("characterProgress.level", "xp_level_mismatch");

    const oldStatsResult = calculateStats(resolved.value.character, oldLevel, resolved.value.modifiers);
    if (!oldStatsResult.ok) return oldStatsResult;
    if (progress.currentHp > oldStatsResult.value.stats.maxHp) return invalid("characterProgress.currentHp", "current_hp_over_max");

    const effectiveAmount = !progress.recruited ? 0 : inParty ? amount : Math.floor(amount / 2);
    const newXp = effectiveAmount > MAX_CHARACTER_XP - progress.xp
      ? MAX_CHARACTER_XP
      : progress.xp + effectiveAmount;
    const newLevel = levelFromExperience(newXp);
    const newStatsResult = calculateStats(resolved.value.character, newLevel, resolved.value.modifiers);
    if (!newStatsResult.ok) return newStatsResult;

    let currentHp = progress.currentHp;
    if (newLevel > oldLevel && currentHp > 0) {
      currentHp = Math.min(
        newStatsResult.value.stats.maxHp,
        currentHp + Math.max(0, newStatsResult.value.stats.maxHp - oldStatsResult.value.stats.maxHp),
      );
    }
    const next = cloneCharacterProgress(progress);
    next.xp = newXp;
    next.level = newLevel;
    next.currentHp = currentHp;
    next.skillPoints += newLevel - oldLevel;
    return success(next);
  }

  /**
   * 生成延后招募角色的全空状态。追赶只写累计等级下限，不复制主角配置，
   * 也不包含任何 party 字段，因此调用方必须另行提交入队事务。
   */
  public createCaughtUpRecruit(
    characterId: string,
    protagonistLevel: number,
  ): DomainResult<CharacterProgressV1> {
    if (!Number.isSafeInteger(protagonistLevel) || protagonistLevel < MIN_CHARACTER_LEVEL || protagonistLevel > MAX_CHARACTER_LEVEL) {
      return invalid("protagonistLevel", "level_range");
    }
    const resolved = this.getDefinitionAndPassive(characterId);
    if (!resolved.ok) return resolved;
    const level = protagonistLevel;
    const statsResult = calculateStats(resolved.value.character, level, resolved.value.modifiers);
    if (!statsResult.ok) return statsResult;
    const progressResult = createCharacterProgress(resolved.value.character, {
      recruited: true,
      level,
      xp: experienceThresholdForLevel(level),
      currentHp: statsResult.value.stats.maxHp,
      skillPoints: level - 1,
    });
    if (!progressResult.ok) return progressResult;
    const shapeResult = validateCharacterProgressShape(progressResult.value, resolved.value.character);
    if (!shapeResult.ok) return shapeResult;
    return success(progressResult.value);
  }
}

/** 显式注入内容源的纯函数入口，便于招募事务不持有服务状态。 */
export function createCaughtUpRecruit(
  content: CharacterContentSource,
  characterId: string,
  protagonistLevel: number,
): DomainResult<CharacterProgressV1> {
  return new ProgressionService(content).createCaughtUpRecruit(characterId, protagonistLevel);
}

/** 显式注入内容源的纯函数经验入口。 */
export function awardExperience(
  content: CharacterContentSource,
  progress: CharacterProgressV1,
  amount: number,
  inParty: boolean,
): DomainResult<CharacterProgressV1> {
  return new ProgressionService(content).awardExperience(progress, amount, inParty);
}
