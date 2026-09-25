/**
 * 角色领域的固定边界与不可变状态工具。
 *
 * 角色的静态定义来自 content/contracts.ts；本文件只负责把存档中的
 * CharacterProgressV1 当作领域值处理，不在这里复制任何内容表数据。
 */
import type {
  CharacterDefinition,
  CharacterProgressV1,
  EquipmentSlot,
  InstanceId,
  SkillId,
  StatBlock,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";

export type { CharacterDefinition, CharacterProgressV1, EquipmentSlot, InstanceId, SkillId, StatBlock };

export const MIN_CHARACTER_LEVEL = 1;
export const MAX_CHARACTER_LEVEL = 50;
export const MAX_CHARACTER_XP = 75_460;

export const CHARACTER_STAT_KEYS = [
  "maxHp",
  "attack",
  "defense",
  "speed",
  "critRateBps",
  "critDamageBps",
  "effectHitBps",
  "effectResistBps",
] as const satisfies readonly (keyof StatBlock)[];

export type CharacterStatKey = (typeof CHARACTER_STAT_KEYS)[number];

export const EQUIPMENT_SLOT_ORDER = [
  "weapon",
  "helmet",
  "armor",
  "gloves",
  "boots",
  "accessory",
] as const satisfies readonly EquipmentSlot[];

export interface CharacterStatSource {
  readonly base: number;
  readonly growth: number;
  readonly flat: number;
  readonly prePercent: number;
  readonly percentBps: number;
  readonly postPercent: number;
  readonly final: number;
}

/** 复制角色状态，避免更新时把嵌套 loadout 暴露给调用方修改。 */
export function cloneCharacterProgress(progress: CharacterProgressV1): CharacterProgressV1 {
  return {
    characterId: progress.characterId,
    recruited: progress.recruited,
    level: progress.level,
    xp: progress.xp,
    currentHp: progress.currentHp,
    skillPoints: progress.skillPoints,
    skillLevels: { ...progress.skillLevels },
    equippedActiveSkillIds: [...progress.equippedActiveSkillIds] as CharacterProgressV1["equippedActiveSkillIds"],
    equipmentBySlot: { ...progress.equipmentBySlot },
    skillStoneInstanceId: progress.skillStoneInstanceId,
  };
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function keysEqual(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const expectedSet = new Set(expected);
  return actual.every((key) => expectedSet.has(key)) && new Set(actual).size === expected.length;
}

function validateStatValues(stats: StatBlock, path: string): { path: string; issueKey: string } | null {
  if (!stats || typeof stats !== "object") return { path, issueKey: "not_object" };
  for (const key of CHARACTER_STAT_KEYS) {
    const value = stats[key];
    if (!Number.isSafeInteger(value)) return { path: `${path}.${key}`, issueKey: "non_integer" };
  }
  return null;
}

/** 校验 CharacterDefinition 自身的数值形状；引用关系仍由 ContentCatalog 负责。 */
export function validateCharacterDefinition(
  character: CharacterDefinition,
): DomainResult<true> {
  if (!character || typeof character !== "object") return invalid("character", "not_object");
  if (typeof character.id !== "string" || character.id.length === 0) return invalid("character.id", "empty_id");
  const baseIssue = validateStatValues(character.baseStats, `characters.${character.id}.baseStats`);
  if (baseIssue) return invalid(baseIssue.path, baseIssue.issueKey);
  const growthIssue = validateStatValues(character.growthPerLevel, `characters.${character.id}.growthPerLevel`);
  if (growthIssue) return invalid(growthIssue.path, growthIssue.issueKey);
  if (!Array.isArray(character.activeSkillIds) || character.activeSkillIds.length !== 4 || new Set(character.activeSkillIds).size !== 4) {
    return invalid(`characters.${character.id}.activeSkillIds`, "active_skill_set");
  }
  for (const id of [character.basicSkillId, ...character.activeSkillIds, character.ultimateSkillId, character.passiveSkillId]) {
    if (typeof id !== "string" || id.length === 0) return invalid(`characters.${character.id}.skills`, "empty_skill_id");
  }
  return success(true);
}

/**
 * 校验角色存档值的结构不变量。xp 与 level 的累计阈值一致性由成长服务
 * 在拥有经验函数时继续检查；这里不读取装备或被动，避免形成循环依赖。
 */
export function validateCharacterProgressShape(
  progress: CharacterProgressV1,
  character: CharacterDefinition,
): DomainResult<true> {
  const definitionResult = validateCharacterDefinition(character);
  if (!definitionResult.ok) return definitionResult;
  if (!progress || typeof progress !== "object") return invalid("characterProgress", "not_object");
  if (progress.characterId !== character.id) return invalid("characterProgress.characterId", "character_id_mismatch");
  if (typeof progress.recruited !== "boolean") return invalid("characterProgress.recruited", "boolean_required");
  if (!Number.isSafeInteger(progress.level) || progress.level < MIN_CHARACTER_LEVEL || progress.level > MAX_CHARACTER_LEVEL) {
    return invalid("characterProgress.level", "level_range");
  }
  if (!Number.isSafeInteger(progress.xp) || progress.xp < 0 || progress.xp > MAX_CHARACTER_XP) {
    return invalid("characterProgress.xp", "xp_range");
  }
  if (!Number.isSafeInteger(progress.currentHp) || progress.currentHp < 0) return invalid("characterProgress.currentHp", "current_hp");
  if (!Number.isSafeInteger(progress.skillPoints) || progress.skillPoints < 0) return invalid("characterProgress.skillPoints", "skill_points");

  if (!progress.skillLevels || typeof progress.skillLevels !== "object" || Array.isArray(progress.skillLevels)) return invalid("characterProgress.skillLevels", "not_object");
  const skillKeys = Object.keys(progress.skillLevels);
  if (!keysEqual(skillKeys, character.activeSkillIds)) return invalid("characterProgress.skillLevels", "active_skill_key_set");
  for (const skillId of character.activeSkillIds) {
    const level = progress.skillLevels[skillId];
    if (!Number.isSafeInteger(level) || level < 0 || level > 5) return invalid(`characterProgress.skillLevels.${skillId}`, "skill_level_range");
  }

  if (!Array.isArray(progress.equippedActiveSkillIds) || progress.equippedActiveSkillIds.length !== 2) return invalid("characterProgress.equippedActiveSkillIds", "slot_shape");
  const [first, second] = progress.equippedActiveSkillIds;
  for (const skillId of [first, second]) {
    if (skillId !== null && !character.activeSkillIds.includes(skillId)) return invalid("characterProgress.equippedActiveSkillIds", "equipped_skill_unknown");
  }
  if (first !== null && first === second) return invalid("characterProgress.equippedActiveSkillIds", "equipped_skill_duplicate");

  if (!progress.equipmentBySlot || typeof progress.equipmentBySlot !== "object" || Array.isArray(progress.equipmentBySlot)) return invalid("characterProgress.equipmentBySlot", "not_object");
  const equipmentKeys = Object.keys(progress.equipmentBySlot);
  if (!keysEqual(equipmentKeys, EQUIPMENT_SLOT_ORDER)) return invalid("characterProgress.equipmentBySlot", "equipment_slot_key_set");
  for (const slot of EQUIPMENT_SLOT_ORDER) {
    const instanceId = progress.equipmentBySlot[slot];
    if (instanceId !== null && (typeof instanceId !== "string" || instanceId.length === 0)) return invalid(`characterProgress.equipmentBySlot.${slot}`, "instance_id");
  }
  if (progress.skillStoneInstanceId !== null && (typeof progress.skillStoneInstanceId !== "string" || progress.skillStoneInstanceId.length === 0)) {
    return invalid("characterProgress.skillStoneInstanceId", "instance_id");
  }
  return success(true);
}

/** 生成全空 loadout；生命值由 StatCalculator/ProgressionService 写入。 */
export function emptyCharacterLoadout(
  character: Pick<CharacterDefinition, "activeSkillIds">,
): Pick<CharacterProgressV1, "skillLevels" | "equippedActiveSkillIds" | "equipmentBySlot" | "skillStoneInstanceId"> {
  return {
    skillLevels: Object.fromEntries(character.activeSkillIds.map((skillId) => [skillId, 0])) as Record<SkillId, number>,
    equippedActiveSkillIds: [null, null],
    equipmentBySlot: {
      weapon: null,
      helmet: null,
      armor: null,
      gloves: null,
      boots: null,
      accessory: null,
    },
    skillStoneInstanceId: null,
  };
}

/** 创建一个不共享嵌套引用的角色状态值。 */
export function createCharacterProgress(
  character: CharacterDefinition,
  values: Pick<CharacterProgressV1, "recruited" | "level" | "xp" | "currentHp" | "skillPoints">,
): DomainResult<CharacterProgressV1> {
  const definitionResult = validateCharacterDefinition(character);
  if (!definitionResult.ok) return definitionResult;
  if (typeof values.recruited !== "boolean") return invalid("characterProgress.recruited", "boolean_required");
  if (!Number.isSafeInteger(values.level) || values.level < MIN_CHARACTER_LEVEL || values.level > MAX_CHARACTER_LEVEL) return invalid("characterProgress.level", "level_range");
  if (!Number.isSafeInteger(values.xp) || values.xp < 0 || values.xp > MAX_CHARACTER_XP) return invalid("characterProgress.xp", "xp_range");
  if (!Number.isSafeInteger(values.currentHp) || values.currentHp < 0) return invalid("characterProgress.currentHp", "current_hp");
  if (!Number.isSafeInteger(values.skillPoints) || values.skillPoints < 0) return invalid("characterProgress.skillPoints", "skill_points");
  for (const [name, value] of Object.entries({
    level: values.level,
    xp: values.xp,
    currentHp: values.currentHp,
    skillPoints: values.skillPoints,
  })) {
    if (!Number.isSafeInteger(value)) return invalid(`characterProgress.${name}`, "non_integer");
  }
  const loadout = emptyCharacterLoadout(character);
  return success({
    characterId: character.id,
    recruited: values.recruited,
    level: values.level,
    xp: values.xp,
    currentHp: values.currentHp,
    skillPoints: values.skillPoints,
    ...loadout,
  });
}
