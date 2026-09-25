/**
 * 铭石技能修饰解析器。
 *
 * 解析结果是一次根行动可消费的临时视图；所有 morph/power 修改都写入克隆的
 * SkillDefinition，ContentCatalog 中的静态对象始终保持不变。
 */
import type {
  Element,
  EffectSpec,
  SkillAffixDefinition,
  SkillAffixOperation,
  SkillAffixRoll,
  SkillDefinition,
  SkillStoneInstance,
  TargetRule,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import { mulBpsFloor } from "../common/FixedMath";

export interface SkillModifierContentSource {
  getSkillAffix(skillAffixId: string): DomainResult<Readonly<SkillAffixDefinition>>;
}

export interface SkillModifierResolveInput {
  readonly characterId: string;
  readonly skill: Readonly<SkillDefinition>;
  /** 两个主动槽加固定终极/被动；普攻不需要放入该集合。 */
  readonly equippedSkillIds: readonly string[];
  readonly skillStone: Readonly<SkillStoneInstance>;
}

export type SkillModifierSourceState = "applied" | "suppressed";
export interface SkillModifierSourceDetail {
  readonly skillAffixId: string;
  readonly roll: number;
  readonly operationKind: SkillAffixOperation["kind"];
  readonly sourceIndex: number;
  readonly state: SkillModifierSourceState;
  readonly reason: string | null;
}

export interface FollowUpModifier {
  readonly skillAffixId: string;
  readonly effectSkillId: string;
  readonly chanceBps: number;
  readonly chanceScaleBps: number;
}

export interface StatusLinkModifier {
  readonly skillAffixId: string;
  readonly requiredStatusId: string;
  readonly effectSkillId: string;
  readonly chanceBps: number;
  readonly chanceScaleBps: number;
}

export interface OverhealShieldModifier {
  readonly skillAffixId: string;
  readonly requiredStatusId: string | null;
  readonly conversionScaleBps: number;
  readonly maxTargetHpBps: number;
  readonly durationOwnerTurns: number;
}

export interface SkillModifierResolution {
  readonly characterId: string;
  readonly skillId: string;
  readonly resolvedSkill: SkillDefinition;
  readonly powerBonusBps: number;
  readonly repeatChanceBps: number;
  readonly repeatExtraHits: number;
  readonly followUps: readonly FollowUpModifier[];
  readonly statusLinks: readonly StatusLinkModifier[];
  readonly overhealToShield: readonly OverhealShieldModifier[];
  readonly energyGainDelta: number;
  readonly cooldownDelta: number;
  readonly sources: readonly SkillModifierSourceDetail[];
  readonly appliedSources: readonly SkillModifierSourceDetail[];
  readonly suppressedSources: readonly SkillModifierSourceDetail[];
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function cloneEffect(effect: EffectSpec): EffectSpec {
  return {
    ...effect,
    ...(effect.kind === "damage" ? { conditionalMultipliers: effect.conditionalMultipliers.map((value) => ({ ...value, condition: { ...value.condition } })) } : {}),
  } as EffectSpec;
}

function cloneSkill(skill: Readonly<SkillDefinition>): SkillDefinition {
  return {
    ...skill,
    owner: { ...skill.owner },
    familyIds: [...skill.familyIds],
    cooldownTurnsByLevel: [...skill.cooldownTurnsByLevel] as SkillDefinition["cooldownTurnsByLevel"],
    energyCostByLevel: [...skill.energyCostByLevel] as SkillDefinition["energyCostByLevel"],
    baseEnergyGainByLevel: [...skill.baseEnergyGainByLevel] as SkillDefinition["baseEnergyGainByLevel"],
    effectsByLevel: skill.effectsByLevel.map((effects) => effects.map(cloneEffect)) as SkillDefinition["effectsByLevel"],
    passiveModifiers: skill.passiveModifiers.map((modifier) => ({ ...modifier })),
    tags: skill.tags.map((tag) => ({ ...tag })),
  };
}

function targetIsActive(
  definition: SkillAffixDefinition,
  input: SkillModifierResolveInput,
): boolean {
  const skill = input.skill;
  if (definition.target.kind === "allSkills") return true;
  if (!input.equippedSkillIds.includes(skill.id)) return false;
  if (definition.target.kind === "skill") return definition.target.skillId === skill.id;
  return skill.familyIds.includes(definition.target.familyId);
}

function sourceDetail(
  roll: SkillAffixRoll,
  definition: SkillAffixDefinition,
  sourceIndex: number,
  state: SkillModifierSourceState,
  reason: string | null,
): SkillModifierSourceDetail {
  return {
    skillAffixId: roll.skillAffixId,
    roll: roll.roll,
    operationKind: definition.operation.kind,
    sourceIndex,
    state,
    reason,
  };
}

function checkRoll(roll: SkillAffixRoll, definition: SkillAffixDefinition): DomainResult<true> {
  if (!Number.isSafeInteger(roll.roll) || roll.roll < definition.rollMin || roll.roll > definition.rollMax) {
    return invalid(`skillAffixes.${definition.id}.roll`, "roll_range");
  }
  return success(true);
}

function replaceTargetRules(skill: SkillDefinition, from: TargetRule, to: TargetRule): void {
  for (const effects of skill.effectsByLevel) {
    for (const effect of effects) {
      if ("targetRule" in effect && effect.targetRule === from) effect.targetRule = to;
    }
  }
  skill.targetRule = to;
}

function replaceDamageElements(skill: SkillDefinition, element: Element): void {
  for (const effects of skill.effectsByLevel) {
    for (const effect of effects) if (effect.kind === "damage") effect.element = element;
  }
}

function aggregateByStack(
  definitions: readonly { definition: Readonly<SkillAffixDefinition>; roll: SkillAffixRoll; sourceIndex: number }[],
  operationKind: SkillAffixOperation["kind"],
): { selected: typeof definitions[number][]; suppressed: typeof definitions[number][]; total: number } {
  const values = definitions.filter((value) => value.definition.operation.kind === operationKind);
  if (values.length === 0) return { selected: [], suppressed: [], total: 0 };
  const stackRule = values[0].definition.stackRule;
  if (stackRule === "max") {
    let selected = values[0];
    for (const candidate of values.slice(1)) if (candidate.roll.roll > selected.roll.roll) selected = candidate;
    return {
      selected: [selected],
      suppressed: values.filter((value) => value !== selected),
      total: selected.roll.roll,
    };
  }
  if (stackRule === "add") {
    return { selected: values, suppressed: [], total: values.reduce((sum, value) => sum + value.roll.roll, 0) };
  }
  return { selected: [values[0]], suppressed: values.slice(1), total: values[0].roll.roll };
}

function checkExclusiveGroups(
  values: readonly { definition: SkillAffixDefinition; roll: SkillAffixRoll; sourceIndex: number }[],
): DomainResult<true> {
  const groups = new Map<string, string[]>();
  for (const value of values) {
    const group = value.definition.exclusiveGroup;
    if (group === null) continue;
    const ids = groups.get(group) ?? [];
    ids.push(value.definition.id);
    groups.set(group, ids);
  }
  for (const [exclusiveGroup, sourceIds] of groups) {
    if (sourceIds.length > 1) return failure(createDomainError("AFFIX_CONFLICT", { exclusiveGroup, sourceIds }));
  }
  return success(true);
}

export class SkillModifierResolver {
  private readonly content: SkillModifierContentSource;

  public constructor(content: SkillModifierContentSource) {
    this.content = content;
  }

  public resolve(input: SkillModifierResolveInput): DomainResult<SkillModifierResolution> {
    if (!input || typeof input !== "object") return invalid("input", "not_object");
    if (input.skill.owner.kind !== "character" || input.skill.owner.characterId !== input.characterId) return invalid(`skills.${input.skill.id}.owner`, "character_skill_owner_mismatch");
    if (!input.skillStone || input.skillStone.attunedCharacterId !== input.characterId) return invalid("skillStone.attunedCharacterId", "attuned_character_mismatch");
    if (!Array.isArray(input.equippedSkillIds) || new Set(input.equippedSkillIds).size !== input.equippedSkillIds.length) return invalid("equippedSkillIds", "duplicate_skill_id");

    const rolls: SkillAffixRoll[] = [
      ...input.skillStone.affixes.map((roll) => ({ ...roll })),
      ...(input.skillStone.abyssAffix === null ? [] : [{ ...input.skillStone.abyssAffix }]),
    ];
    const rollIds = new Set<string>();
    for (const roll of rolls) {
      if (rollIds.has(roll.skillAffixId)) return invalid("skillStone.affixes", "duplicate_skill_affix");
      rollIds.add(roll.skillAffixId);
    }
    const activeValues: Array<{ definition: SkillAffixDefinition; roll: SkillAffixRoll; sourceIndex: number }> = [];
    const sources: SkillModifierSourceDetail[] = [];
    const suppressedSources: SkillModifierSourceDetail[] = [];
    for (const [sourceIndex, roll] of rolls.entries()) {
      const definitionResult = this.content.getSkillAffix(roll.skillAffixId);
      if (!definitionResult.ok) return definitionResult;
      const definition = definitionResult.value;
      const rollResult = checkRoll(roll, definition);
      if (!rollResult.ok) return rollResult;
      if (!targetIsActive(definition, input)) {
        suppressedSources.push(sourceDetail(roll, definition, sourceIndex, "suppressed", "target_skill_not_active"));
        continue;
      }
      activeValues.push({ definition, roll, sourceIndex });
    }
    const exclusiveResult = checkExclusiveGroups(activeValues);
    if (!exclusiveResult.ok) return exclusiveResult;
    const resolvedSkill = cloneSkill(input.skill);

    const power = aggregateByStack(activeValues, "addPowerBps");
    for (const value of power.suppressed) suppressedSources.push(sourceDetail(value.roll, value.definition, value.sourceIndex, "suppressed", "stack_max"));
    const powerBonusBps = power.total;
    if (powerBonusBps !== 0) {
      for (const effects of resolvedSkill.effectsByLevel) {
        for (const effect of effects) {
          if (effect.kind === "damage" || effect.kind === "heal" || effect.kind === "shield") effect.powerBps += powerBonusBps;
        }
      }
    }

    const repeat = aggregateByStack(activeValues, "addRepeatChanceBps");
    for (const value of repeat.suppressed) suppressedSources.push(sourceDetail(value.roll, value.definition, value.sourceIndex, "suppressed", "stack_max"));
    let repeatExtraHits = 0;
    for (const value of repeat.selected) {
      if (value.definition.operation.kind !== "addRepeatChanceBps") continue;
      if (repeatExtraHits !== 0 && repeatExtraHits !== value.definition.operation.extraHits) return invalid(`skillAffixes.${value.definition.id}.operation.extraHits`, "repeat_extra_hits_mismatch");
      repeatExtraHits = value.definition.operation.extraHits;
    }

    const followUps: FollowUpModifier[] = [];
    const statusLinks: StatusLinkModifier[] = [];
    const overhealToShield: OverhealShieldModifier[] = [];
    const followUpValues = activeValues.filter((value) => value.definition.operation.kind === "addFollowUp");
    for (const value of followUpValues) {
      const operation = value.definition.operation;
      if (operation.kind !== "addFollowUp") continue;
      followUps.push({ skillAffixId: value.definition.id, effectSkillId: operation.effectSkillId, chanceBps: mulBpsFloor(value.roll.roll, operation.chanceScaleBps), chanceScaleBps: operation.chanceScaleBps });
    }
    for (const value of activeValues) {
      const operation = value.definition.operation;
      if (operation.kind === "statusLink") {
        statusLinks.push({ skillAffixId: value.definition.id, requiredStatusId: operation.requiredStatusId, effectSkillId: operation.effectSkillId, chanceBps: mulBpsFloor(value.roll.roll, operation.chanceScaleBps), chanceScaleBps: operation.chanceScaleBps });
      } else if (operation.kind === "overhealToShield") {
        overhealToShield.push({ skillAffixId: value.definition.id, requiredStatusId: null, conversionScaleBps: mulBpsFloor(value.roll.roll, operation.conversionScaleBps), maxTargetHpBps: operation.maxTargetHpBps, durationOwnerTurns: operation.durationOwnerTurns });
      }
    }

    let energyGainDelta = 0;
    let cooldownDelta = 0;
    const energyValues = activeValues.filter((value) => value.definition.operation.kind === "changeEnergy");
    for (const value of energyValues) {
      const operation = value.definition.operation;
      if (operation.kind === "changeEnergy") energyGainDelta += mulBpsFloor(value.roll.roll, operation.amountScaleBps);
    }
    energyGainDelta = Math.min(30, Math.max(0, energyGainDelta));
    const cooldownValues = activeValues.filter((value) => value.definition.operation.kind === "changeCooldown");
    for (const value of cooldownValues) {
      const operation = value.definition.operation;
      if (operation.kind === "changeCooldown") cooldownDelta += operation.turns;
    }
    // 冷却的最小值在战斗写回基础 CD 时再钳制到 0；这里保留可解释的修正总值。

    for (const value of activeValues) {
      const operation = value.definition.operation;
      if (operation.kind === "replaceTargetRule") replaceTargetRules(resolvedSkill, input.skill.targetRule, operation.targetRule);
      if (operation.kind === "replaceDamageElement") replaceDamageElements(resolvedSkill, operation.element);
    }
    const suppressedIndexes = new Set(suppressedSources.map((source) => source.sourceIndex));
    for (const value of activeValues) {
      if (!suppressedIndexes.has(value.sourceIndex)) sources.push(sourceDetail(value.roll, value.definition, value.sourceIndex, "applied", null));
    }

    return success({
      characterId: input.characterId,
      skillId: input.skill.id,
      resolvedSkill,
      powerBonusBps,
      repeatChanceBps: repeat.total,
      repeatExtraHits,
      followUps,
      statusLinks,
      overhealToShield,
      energyGainDelta,
      cooldownDelta,
      sources,
      appliedSources: sources,
      suppressedSources,
    });
  }

  public resolveSkill(input: SkillModifierResolveInput): DomainResult<SkillModifierResolution> {
    return this.resolve(input);
  }
}

export function resolveSkillModifiers(
  content: SkillModifierContentSource,
  input: SkillModifierResolveInput,
): DomainResult<SkillModifierResolution> {
  return new SkillModifierResolver(content).resolve(input);
}
