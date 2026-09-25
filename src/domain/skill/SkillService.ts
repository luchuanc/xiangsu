/**
 * 技能导师领域服务。
 *
 * 服务只接收显式注入的内容 getter，所有更新都返回新的 CharacterProgressV1，
 * 不直接修改存档对象，也不在领域层创建 View 状态或战斗冷却 key。
 */
import type {
  CharacterDefinition,
  CharacterProgressV1,
  SkillDefinition,
} from "../../content/contracts";
import {
  cloneCharacterProgress,
  validateCharacterProgressShape,
  validateCharacterDefinition,
} from "../character/Character";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";

export interface SkillContentSource {
  getCharacter(characterId: string): DomainResult<Readonly<CharacterDefinition>>;
  getSkill(skillId: string): DomainResult<Readonly<SkillDefinition>>;
}

export interface SkillActionOptions {
  /** 技能导师操作只能在城镇完成；省略时表示已经由上层门禁确认。 */
  readonly inTown?: boolean;
}

export interface SkillUpgradePreview {
  readonly characterId: string;
  readonly skillId: string;
  readonly currentLevel: number;
  readonly nextLevel: number;
  readonly skillPointCost: 1;
  readonly unlockLevel: number;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function notInTown(): DomainResult<never> {
  return failure(createDomainError("NOT_IN_TOWN", null));
}

function checkTown(options: SkillActionOptions | undefined): DomainResult<true> {
  if (options?.inTown === false) return notInTown();
  if (options?.inTown !== undefined && typeof options.inTown !== "boolean") {
    return invalid("options.inTown", "boolean_required");
  }
  return success(true);
}

function activeSkillIds(character: CharacterDefinition): readonly string[] {
  return character.activeSkillIds;
}

/** 读取并校验一名角色的四个主动技能，拒绝跨角色或错误 kind 的技能引用。 */
function resolveActiveSkills(
  content: SkillContentSource,
  character: CharacterDefinition,
): DomainResult<ReadonlyArray<Readonly<SkillDefinition>>> {
  const definitionResult = validateCharacterDefinition(character);
  if (!definitionResult.ok) return definitionResult;
  const skills: SkillDefinition[] = [];
  for (const skillId of activeSkillIds(character)) {
    const skillResult = content.getSkill(skillId);
    if (!skillResult.ok) return skillResult;
    const skill = skillResult.value;
    if (skill.owner.kind !== "character" || skill.owner.characterId !== character.id) {
      return invalid(`skills.${skill.id}.owner`, "character_skill_owner_mismatch");
    }
    if (skill.kind !== "active" || skill.maxLevel !== 5) {
      return invalid(`skills.${skill.id}`, "active_skill_shape");
    }
    skills.push(skill);
  }
  return success(skills);
}

interface ValidatedProgress {
  readonly character: Readonly<CharacterDefinition>;
  readonly skills: ReadonlyArray<Readonly<SkillDefinition>>;
}

function validateProgress(
  content: SkillContentSource,
  progress: CharacterProgressV1,
): DomainResult<ValidatedProgress> {
  if (!progress || typeof progress !== "object") return invalid("characterProgress", "not_object");
  const characterResult = content.getCharacter(progress.characterId);
  if (!characterResult.ok) return characterResult;
  const shapeResult = validateCharacterProgressShape(progress, characterResult.value);
  if (!shapeResult.ok) return shapeResult;
  const skillsResult = resolveActiveSkills(content, characterResult.value);
  if (!skillsResult.ok) return skillsResult;
  const spentSkillPoints = Object.values(progress.skillLevels).reduce((sum, level) => sum + level, 0);
  if (spentSkillPoints + progress.skillPoints !== progress.level - 1) {
    return invalid("characterProgress.skillPoints", "skill_points_conservation");
  }
  for (const skill of skillsResult.value) {
    const currentLevel = progress.skillLevels[skill.id];
    if (currentLevel > 0 && progress.level < skill.unlockLevel) {
      return failure(createDomainError("SKILL_LOCKED_BY_LEVEL", {
        skillId: skill.id,
        unlockLevel: skill.unlockLevel,
        characterLevel: progress.level,
      }));
    }
  }
  for (const equippedSkillId of progress.equippedActiveSkillIds) {
    if (equippedSkillId === null) continue;
    const skill = skillsResult.value.find((value) => value.id === equippedSkillId);
    if (!skill) return invalid("characterProgress.equippedActiveSkillIds", "equipped_skill_unknown");
    if (progress.skillLevels[equippedSkillId] < 1) return failure(createDomainError("SKILL_LOCKED", { skillId: equippedSkillId }));
    if (progress.level < skill.unlockLevel) {
      return failure(createDomainError("SKILL_LOCKED_BY_LEVEL", {
        skillId: equippedSkillId,
        unlockLevel: skill.unlockLevel,
        characterLevel: progress.level,
      }));
    }
  }
  return success({ character: characterResult.value, skills: skillsResult.value });
}

function resolveSkill(
  content: SkillContentSource,
  character: CharacterDefinition,
  skillId: string,
): DomainResult<Readonly<SkillDefinition>> {
  if (!character.activeSkillIds.includes(skillId)) {
    return failure(createDomainError("SKILL_LOCKED", { skillId }));
  }
  return content.getSkill(skillId);
}

export class SkillService {
  private readonly content: SkillContentSource;

  public constructor(content: SkillContentSource) {
    this.content = content;
  }

  /** 只计算升级结果，不消费技能点，也不改变调用方对象。 */
  public previewUpgrade(
    progress: CharacterProgressV1,
    skillId: string,
    options?: SkillActionOptions,
  ): DomainResult<SkillUpgradePreview> {
    const townResult = checkTown(options);
    if (!townResult.ok) return townResult;
    const progressResult = validateProgress(this.content, progress);
    if (!progressResult.ok) return progressResult;
    const skillResult = resolveSkill(this.content, progressResult.value.character, skillId);
    if (!skillResult.ok) return skillResult;
    const skill = skillResult.value;
    const currentLevel = progress.skillLevels[skillId];
    if (currentLevel >= skill.maxLevel) {
      return failure(createDomainError("SKILL_LEVEL_MAX", { skillId }));
    }
    if (progress.level < skill.unlockLevel) {
      return failure(createDomainError("SKILL_LOCKED_BY_LEVEL", {
        skillId,
        unlockLevel: skill.unlockLevel,
        characterLevel: progress.level,
      }));
    }
    if (progress.skillPoints < 1) {
      return failure(createDomainError("INSUFFICIENT_SKILL_POINTS", {
        required: 1,
        owned: progress.skillPoints,
      }));
    }
    return success({
      characterId: progress.characterId,
      skillId,
      currentLevel,
      nextLevel: currentLevel + 1,
      skillPointCost: 1,
      unlockLevel: skill.unlockLevel,
    });
  }

  public upgradeSkill(
    progress: CharacterProgressV1,
    skillId: string,
    options?: SkillActionOptions,
  ): DomainResult<CharacterProgressV1> {
    const previewResult = this.previewUpgrade(progress, skillId, options);
    if (!previewResult.ok) return previewResult;
    const next = cloneCharacterProgress(progress);
    next.skillLevels[skillId] = previewResult.value.nextLevel;
    next.skillPoints -= previewResult.value.skillPointCost;
    return success(next);
  }

  /** 与任务卡同义的显式操作入口。 */
  public upgrade(
    progress: CharacterProgressV1,
    skillId: string,
    options?: SkillActionOptions,
  ): DomainResult<CharacterProgressV1> {
    return this.upgradeSkill(progress, skillId, options);
  }

  public equipActiveSkill(
    progress: CharacterProgressV1,
    skillId: string,
    slot: 0 | 1,
    options?: SkillActionOptions,
  ): DomainResult<CharacterProgressV1> {
    const townResult = checkTown(options);
    if (!townResult.ok) return townResult;
    if (slot !== 0 && slot !== 1) return invalid("slot", "active_slot_range");
    const progressResult = validateProgress(this.content, progress);
    if (!progressResult.ok) return progressResult;
    const skillResult = resolveSkill(this.content, progressResult.value.character, skillId);
    if (!skillResult.ok) return skillResult;
    const skill = skillResult.value;
    const level = progress.skillLevels[skillId];
    if (progress.level < skill.unlockLevel) {
      return failure(createDomainError("SKILL_LOCKED_BY_LEVEL", {
        skillId,
        unlockLevel: skill.unlockLevel,
        characterLevel: progress.level,
      }));
    }
    if (level < 1) return failure(createDomainError("SKILL_LOCKED", { skillId }));
    if (progress.equippedActiveSkillIds.includes(skillId)) {
      return invalid("characterProgress.equippedActiveSkillIds", "equipped_skill_duplicate");
    }
    const next = cloneCharacterProgress(progress);
    next.equippedActiveSkillIds[slot] = skillId;
    return success(next);
  }

  public equipSkill(
    progress: CharacterProgressV1,
    skillId: string,
    slot: 0 | 1,
    options?: SkillActionOptions,
  ): DomainResult<CharacterProgressV1> {
    return this.equipActiveSkill(progress, skillId, slot, options);
  }

  public unequipActiveSkill(
    progress: CharacterProgressV1,
    slot: 0 | 1,
    options?: SkillActionOptions,
  ): DomainResult<CharacterProgressV1> {
    const townResult = checkTown(options);
    if (!townResult.ok) return townResult;
    if (slot !== 0 && slot !== 1) return invalid("slot", "active_slot_range");
    const progressResult = validateProgress(this.content, progress);
    if (!progressResult.ok) return progressResult;
    const next = cloneCharacterProgress(progress);
    next.equippedActiveSkillIds[slot] = null;
    return success(next);
  }

  public unequipSkill(
    progress: CharacterProgressV1,
    slot: 0 | 1,
    options?: SkillActionOptions,
  ): DomainResult<CharacterProgressV1> {
    return this.unequipActiveSkill(progress, slot, options);
  }

  /** 免费重置主动技能并返还已投入技能点，同时清空两个主动槽。 */
  public resetSkills(
    progress: CharacterProgressV1,
    options?: SkillActionOptions,
  ): DomainResult<CharacterProgressV1> {
    const townResult = checkTown(options);
    if (!townResult.ok) return townResult;
    const progressResult = validateProgress(this.content, progress);
    if (!progressResult.ok) return progressResult;
    const refunded = Object.values(progress.skillLevels).reduce((sum, level) => sum + level, 0);
    const next = cloneCharacterProgress(progress);
    for (const skillId of progressResult.value.character.activeSkillIds) next.skillLevels[skillId] = 0;
    next.equippedActiveSkillIds = [null, null];
    next.skillPoints += refunded;
    return success(next);
  }

  public reset(
    progress: CharacterProgressV1,
    options?: SkillActionOptions,
  ): DomainResult<CharacterProgressV1> {
    return this.resetSkills(progress, options);
  }
}
