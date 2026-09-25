/**
 * 技能铭石生成与普通词条稳定重铸。
 *
 * 生成顺序严格为：调谐角色 → 普通词条 ID/roll 交错 → 深渊词条 ID/roll。
 * 所有随机数都来自调用方注入的 SeededRng；实例时间、ID 和奖励事务号也由调用方提供。
 */
import type {
  CharacterDefinition,
  CharacterId,
  ReforgeCandidateV1,
  ReforgePreviewV1,
  SkillAffixDefinition,
  SkillAffixRoll,
  SkillStoneInstance,
  SkillStoneQuality,
  SkillDefinition,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import { fnv1a32, SeededRng } from "../common/SeededRng";

export interface SkillStoneContentSource {
  getCharacter(characterId: string): DomainResult<Readonly<CharacterDefinition>>;
  getSkill(skillId: string): DomainResult<Readonly<SkillDefinition>>;
  getSkillAffix(skillAffixId: string): DomainResult<Readonly<SkillAffixDefinition>>;
  getRoot(): {
    readonly contentVersion: "content-1.2.0";
    readonly characters: readonly {
      readonly id: string;
      readonly basicSkillId: string;
      readonly activeSkillIds: readonly string[];
      readonly ultimateSkillId: string;
      readonly passiveSkillId: string;
    }[];
    readonly skills: readonly {
      readonly id: string;
      readonly familyIds: readonly string[];
    }[];
    readonly skillAffixes: readonly Readonly<SkillAffixDefinition>[];
  };
}

export interface SkillStoneRewardContext {
  readonly rewardKind: "elite" | "boss" | "shop" | "other";
  readonly isFirstSuccessfulEliteReward: boolean;
  readonly focusedCharacterId: CharacterId | null;
  readonly focusedEliteStoneConsumed: boolean;
}

export interface GenerateSkillStoneOptions {
  readonly itemLevel: number;
  readonly quality: SkillStoneQuality;
  readonly recruitedCharacterIds: readonly CharacterId[];
  readonly rng: SeededRng;
  readonly instanceId: string;
  readonly acquiredAt: string;
  readonly sourceTransactionId: string;
  readonly rewardContext?: SkillStoneRewardContext;
}

export interface SkillStoneReforgeOptions {
  readonly contentVersion: "content-1.2.0";
  readonly requestedIndex: number;
  readonly equipped?: boolean;
  readonly excludedSkillAffixIds?: readonly string[];
  readonly excludedExclusiveGroups?: readonly string[];
}

export interface ConfirmSkillStoneReforgeOptions {
  readonly expectedLockedIndex: number;
  readonly expectedReforgeCount: number;
  readonly candidateIndex: 0 | 1 | 2;
}

const NORMAL_AFFIX_COUNT: Readonly<Record<SkillStoneQuality, number>> = Object.freeze({
  magic: 1,
  rare: 2,
  epic: 3,
  abyss: 3,
});

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function poolEmpty(poolKind: "skillStoneNormal" | "skillStoneAbyss", itemLevel: number): DomainResult<never> {
  return failure(createDomainError("AFFIX_POOL_EMPTY", { poolKind, itemLevel }));
}

function validateGenerationOptions(options: GenerateSkillStoneOptions): DomainResult<true> {
  if (!options || typeof options !== "object") return invalid("options", "not_object");
  if (!Number.isSafeInteger(options.itemLevel) || options.itemLevel < 1 || options.itemLevel > 50) return invalid("options.itemLevel", "item_level_range");
  if (!Object.hasOwn(NORMAL_AFFIX_COUNT, options.quality)) return invalid("options.quality", "quality");
  if (!Array.isArray(options.recruitedCharacterIds) || options.recruitedCharacterIds.length === 0) return invalid("options.recruitedCharacterIds", "empty_recruited_characters");
  if (new Set(options.recruitedCharacterIds).size !== options.recruitedCharacterIds.length) return invalid("options.recruitedCharacterIds", "duplicate_character_id");
  if (typeof options.instanceId !== "string" || options.instanceId.length === 0) return invalid("options.instanceId", "instance_id");
  if (typeof options.acquiredAt !== "string" || options.acquiredAt.length === 0) return invalid("options.acquiredAt", "timestamp");
  if (typeof options.sourceTransactionId !== "string" || options.sourceTransactionId.length === 0) return invalid("options.sourceTransactionId", "transaction_id");
  return success(true);
}

function characterSkillIds(character: CharacterDefinition): readonly string[] {
  return [character.basicSkillId, ...character.activeSkillIds, character.ultimateSkillId, character.passiveSkillId];
}

function targetMatchesCharacter(
  source: SkillStoneContentSource,
  target: SkillAffixDefinition["target"],
  character: Readonly<CharacterDefinition>,
): boolean {
  if (target.kind === "allSkills") return true;
  const ids = characterSkillIds(character);
  if (target.kind === "skill") return ids.includes(target.skillId);
  return source.getRoot().skills.some((skill) => ids.includes(skill.id) && skill.familyIds.includes(target.familyId));
}

function normalPool(
  source: SkillStoneContentSource,
  itemLevel: number,
  quality: SkillStoneQuality,
  character: Readonly<CharacterDefinition>,
): readonly Readonly<SkillAffixDefinition>[] {
  return source.getRoot().skillAffixes.filter((definition) =>
    definition.pool === "normal"
    && definition.minItemLevel <= itemLevel
    && definition.allowedQualities.includes(quality)
    && targetMatchesCharacter(source, definition.target, character),
  );
}

function abyssPool(
  source: SkillStoneContentSource,
  itemLevel: number,
  quality: SkillStoneQuality,
  character: Readonly<CharacterDefinition>,
): readonly Readonly<SkillAffixDefinition>[] {
  return source.getRoot().skillAffixes.filter((definition) =>
    definition.pool === "abyss"
    && definition.minItemLevel <= itemLevel
    && definition.allowedQualities.includes(quality)
    && targetMatchesCharacter(source, definition.target, character),
  );
}

function pickDefinition(
  rng: SeededRng,
  candidates: readonly Readonly<SkillAffixDefinition>[],
): Readonly<SkillAffixDefinition> {
  return rng.pickWeighted(candidates.map((definition) => ({ value: definition, weight: definition.weight })));
}

function hasConflict(
  definition: Readonly<SkillAffixDefinition>,
  selected: readonly Readonly<SkillAffixDefinition>[],
): boolean {
  if (selected.some((value) => value.id === definition.id)) return true;
  return definition.exclusiveGroup !== null
    && selected.some((value) => value.exclusiveGroup === definition.exclusiveGroup);
}

function hasEnoughCandidates(
  candidates: readonly Readonly<SkillAffixDefinition>[],
  count: number,
): boolean {
  const selected: Readonly<SkillAffixDefinition>[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = candidates.find((definition) => !hasConflict(definition, selected));
    if (!next) return false;
    selected.push(next);
  }
  return true;
}

function makeRoll(rng: SeededRng, definition: Readonly<SkillAffixDefinition>): SkillAffixRoll {
  return {
    skillAffixId: definition.id,
    roll: rng.nextIntInclusive(definition.rollMin, definition.rollMax),
    reforged: false,
  };
}

function sortedRecruitedIds(ids: readonly CharacterId[]): CharacterId[] {
  return [...ids].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function resolveAttunedCharacter(
  options: GenerateSkillStoneOptions,
  sortedIds: readonly CharacterId[],
): DomainResult<CharacterId> {
  const draw = options.rng.nextIntInclusive(0, sortedIds.length - 1);
  const context = options.rewardContext;
  if (context?.isFirstSuccessfulEliteReward) {
    if (context.rewardKind !== "elite" || context.focusedEliteStoneConsumed) {
      return success(sortedIds[draw]);
    }
    if (context.focusedCharacterId === null || !sortedIds.includes(context.focusedCharacterId)) {
      return invalid("rewardContext.focusedCharacterId", "focus_character_not_recruited");
    }
    // 即便使用专注覆盖，也必须保留上面的等权抽值消费。
    return success(context.focusedCharacterId);
  }
  return success(sortedIds[draw]);
}

export class SkillStoneGenerator {
  private readonly content: SkillStoneContentSource;

  public constructor(content: SkillStoneContentSource) {
    this.content = content;
  }

  public generate(options: GenerateSkillStoneOptions): DomainResult<SkillStoneInstance> {
    const optionsResult = validateGenerationOptions(options);
    if (!optionsResult.ok) return optionsResult;
    const sortedIds = sortedRecruitedIds(options.recruitedCharacterIds);
    const characters: Readonly<CharacterDefinition>[] = [];
    for (const characterId of sortedIds) {
      const result = this.content.getCharacter(characterId);
      if (!result.ok) return result;
      if (!result.value || result.value.id !== characterId) return invalid(`characters.${characterId}`, "character_id_mismatch");
      characters.push(result.value);
    }

    // 在任何随机抽取前预检全部可能的调谐角色，避免空池失败推进调用方 RNG。
    const normalCount = NORMAL_AFFIX_COUNT[options.quality];
    for (const character of characters) {
      const normalCandidates = normalPool(this.content, options.itemLevel, options.quality, character);
      if (!hasEnoughCandidates(normalCandidates, normalCount)) {
        return poolEmpty("skillStoneNormal", options.itemLevel);
      }
      if (options.quality === "abyss") {
        const abyssCandidates = abyssPool(this.content, options.itemLevel, options.quality, character);
        if (!hasEnoughCandidates(abyssCandidates, 1)) {
          return poolEmpty("skillStoneAbyss", options.itemLevel);
        }
      }
    }

    const attunedResult = resolveAttunedCharacter(options, sortedIds);
    if (!attunedResult.ok) return attunedResult;
    const attunedCharacter = characters.find((character) => character.id === attunedResult.value);
    if (!attunedCharacter) return invalid(`characters.${attunedResult.value}`, "missing_content");

    const selectedDefinitions: Readonly<SkillAffixDefinition>[] = [];
    const normal = normalPool(this.content, options.itemLevel, options.quality, attunedCharacter);
    const affixes: SkillAffixRoll[] = [];
    for (let index = 0; index < normalCount; index += 1) {
      const candidates = normal.filter((definition) => !hasConflict(definition, selectedDefinitions));
      if (candidates.length === 0) return poolEmpty("skillStoneNormal", options.itemLevel);
      let definition: Readonly<SkillAffixDefinition>;
      try {
        definition = pickDefinition(options.rng, candidates);
        affixes.push(makeRoll(options.rng, definition));
      } catch {
        return poolEmpty("skillStoneNormal", options.itemLevel);
      }
      selectedDefinitions.push(definition);
    }

    let abyssAffix: SkillAffixRoll | null = null;
    if (options.quality === "abyss") {
      const abyssCandidates = abyssPool(this.content, options.itemLevel, options.quality, attunedCharacter)
        .filter((definition) => !hasConflict(definition, selectedDefinitions));
      if (abyssCandidates.length === 0) return poolEmpty("skillStoneAbyss", options.itemLevel);
      try {
        const definition = pickDefinition(options.rng, abyssCandidates);
        abyssAffix = makeRoll(options.rng, definition);
      } catch {
        return poolEmpty("skillStoneAbyss", options.itemLevel);
      }
    }

    return success({
      instanceId: options.instanceId,
      attunedCharacterId: attunedResult.value,
      itemLevel: options.itemLevel,
      quality: options.quality,
      affixes,
      abyssAffix,
      locked: false,
      acquiredAt: options.acquiredAt,
      sourceTransactionId: options.sourceTransactionId,
      reforgeLockedIndex: null,
      reforgeCount: 0,
    });
  }

  /** 显式入口，便于奖励事务不持有生成器状态。 */
  public generateSkillStone(options: GenerateSkillStoneOptions): DomainResult<SkillStoneInstance> {
    return this.generate(options);
  }

  /**
   * 打开普通槽重铸预览。预览 RNG 由实例字段派生，刷新同一请求不会推进远征 RNG。
   * 该方法不修改实例，也不消费材料；abyssAffix 没有合法下标。
   */
  public openReforgePreview(
    instance: SkillStoneInstance,
    options: SkillStoneReforgeOptions,
  ): DomainResult<ReforgePreviewV1> {
  if (!instance || typeof instance !== "object") return invalid("instance", "not_object");
  if (options.equipped === true) return failure(createDomainError("AFFIX_NOT_REFORGEABLE", { instanceId: instance.instanceId, reason: "EQUIPPED_ITEM" }));
    if (instance.locked) return failure(createDomainError("AFFIX_NOT_REFORGEABLE", { instanceId: instance.instanceId, reason: "LOCKED_ITEM" }));
    if (!Number.isSafeInteger(options.requestedIndex) || options.requestedIndex < 0 || options.requestedIndex >= instance.affixes.length) {
      return failure(createDomainError("AFFIX_NOT_REFORGEABLE", { instanceId: instance.instanceId, reason: "ABYSS_SLOT" }));
    }
    if (instance.reforgeLockedIndex !== null && instance.reforgeLockedIndex !== options.requestedIndex) {
      return failure(createDomainError("AFFIX_NOT_REFORGEABLE", { instanceId: instance.instanceId, reason: "WRONG_LOCKED_INDEX" }));
    }
    if (options.contentVersion !== "content-1.2.0") return invalid("options.contentVersion", "content_version");
    const oldRoll = instance.affixes[options.requestedIndex];
    const oldDefinitionResult = this.content.getSkillAffix(oldRoll.skillAffixId);
    if (!oldDefinitionResult.ok) return oldDefinitionResult;
    const excludedIds = new Set(options.excludedSkillAffixIds ?? []);
    const excludedGroups = new Set(options.excludedExclusiveGroups ?? []);
    for (const [index, roll] of instance.affixes.entries()) {
      if (index === options.requestedIndex) continue;
      const definitionResult = this.content.getSkillAffix(roll.skillAffixId);
      if (!definitionResult.ok) return definitionResult;
      excludedIds.add(roll.skillAffixId);
      if (definitionResult.value.exclusiveGroup !== null) excludedGroups.add(definitionResult.value.exclusiveGroup);
    }
    const characterResult = this.content.getCharacter(instance.attunedCharacterId);
    if (!characterResult.ok) return characterResult;
    const candidates = normalPool(this.content, instance.itemLevel, instance.quality, characterResult.value)
      .filter((definition) => definition.id !== oldRoll.skillAffixId)
      .filter((definition) => !excludedIds.has(definition.id))
      .filter((definition) => definition.exclusiveGroup === null || !excludedGroups.has(definition.exclusiveGroup));
    if (candidates.length === 0) return poolEmpty("skillStoneNormal", instance.itemLevel);
    const namespace = `reforge:skillStone:${options.contentVersion}:${instance.instanceId}:${options.requestedIndex}:${instance.reforgeCount}`;
    const namespaceBytes = new TextEncoder().encode(namespace);
    const rng = SeededRng.fromSeed(fnv1a32(namespaceBytes));
    const candidatesResult: ReforgeCandidateV1[] = [];
    const selectedIds = new Set<string>([...excludedIds, oldRoll.skillAffixId]);
    const selectedGroups = new Set<string>(excludedGroups);
    for (let index = 0; index < 3; index += 1) {
      const available = candidates.filter((definition) => !selectedIds.has(definition.id)
        && (definition.exclusiveGroup === null || !selectedGroups.has(definition.exclusiveGroup)));
      if (available.length === 0) break;
      const definition = pickDefinition(rng, available);
      candidatesResult.push({
        candidateIndex: index as 0 | 1 | 2,
        kind: "skillStone",
        roll: makeRoll(rng, definition),
      });
      selectedIds.add(definition.id);
      if (definition.exclusiveGroup !== null) selectedGroups.add(definition.exclusiveGroup);
    }
    if (candidatesResult.length === 0) return poolEmpty("skillStoneNormal", instance.itemLevel);
    return success({
      contentVersion: options.contentVersion,
      itemKind: "skillStone",
      instanceId: instance.instanceId,
      lockedIndex: options.requestedIndex,
      reforgeCount: instance.reforgeCount,
      costItemId: "item_inscription_dust",
      costQuantity: 5 + Math.ceil(instance.itemLevel / 2),
      candidates: candidatesResult,
    });
  }

  public confirmReforge(
    instance: SkillStoneInstance,
    preview: ReforgePreviewV1,
    options: ConfirmSkillStoneReforgeOptions,
  ): DomainResult<SkillStoneInstance> {
    if (preview.itemKind !== "skillStone" || preview.instanceId !== instance.instanceId) return invalid("preview", "instance_mismatch");
    if (preview.lockedIndex !== options.expectedLockedIndex || preview.reforgeCount !== options.expectedReforgeCount || instance.reforgeCount !== options.expectedReforgeCount) {
      return failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: options.expectedReforgeCount, actualReforgeCount: instance.reforgeCount }));
    }
    const candidate = preview.candidates.find((value) => value.candidateIndex === options.candidateIndex);
    if (!candidate || candidate.kind !== "skillStone") return invalid("options.candidateIndex", "candidate_missing");
    const next: SkillStoneInstance = {
      ...instance,
      affixes: instance.affixes.map((value, index) => index === options.expectedLockedIndex ? { ...candidate.roll, reforged: true } : { ...value }),
      reforgeLockedIndex: options.expectedLockedIndex,
      reforgeCount: instance.reforgeCount + 1,
    };
    return success(next);
  }
}

export function generateSkillStone(
  content: SkillStoneContentSource,
  options: GenerateSkillStoneOptions,
): DomainResult<SkillStoneInstance> {
  return new SkillStoneGenerator(content).generate(options);
}
