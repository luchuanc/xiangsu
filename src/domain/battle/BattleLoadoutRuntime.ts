/**
 * 战斗行动期的装备/固定被动倍率解析。
 *
 * 这里严格从同一份候选存档读取角色 loadout；不把动态词条混入静态
 * StatBlock，也不修改传入对象。保存失败时调用方可以安全丢弃本结果。
 */
import type {
  AffixCondition,
  BattleUnitStateV1,
  CharacterDefinition,
  EquipmentAffixDefinition,
  EffectSpec,
  GameSaveV1,
  SkillDefinition,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import { resolveEffectiveStats, type StatusGetter } from "./BattleStatRuntime";

export interface BattleLoadoutRuntimeContent {
  readonly getCharacter: (id: string) => DomainResult<Readonly<CharacterDefinition>>;
  readonly getSkill: (id: string) => DomainResult<Readonly<SkillDefinition>>;
  readonly getEquipmentAffix?: (id: string) => DomainResult<Readonly<EquipmentAffixDefinition>>;
  readonly getStatus?: StatusGetter;
}

export interface BattleDynamicModifiers {
  readonly damageBonusBps: number;
  readonly finalDamageMultiplierBps: number;
  readonly healingBonusBps: number;
  readonly shieldBonusBps: number;
}

export interface BattleLoadoutRuntimeInput {
  readonly save: Readonly<GameSaveV1>;
  readonly actor: Readonly<BattleUnitStateV1>;
  readonly skill?: Readonly<SkillDefinition> | null;
  readonly effect: Readonly<EffectSpec>;
  readonly target?: Readonly<BattleUnitStateV1> | null;
  readonly content: BattleLoadoutRuntimeContent;
  readonly round: number;
}

const EQUIPMENT_SLOT_ORDER = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"] as const;

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function zeroModifiers(): BattleDynamicModifiers {
  return { damageBonusBps: 0, finalDamageMultiplierBps: 0, healingBonusBps: 0, shieldBonusBps: 0 };
}

function modifierValue(roll: number, craftEmpowered: boolean, rollScaleBps: number): number {
  const effectiveRoll = craftEmpowered ? Math.floor((roll * 12_500) / 10_000) : roll;
  return Math.floor((effectiveRoll * rollScaleBps) / 10_000);
}

function conditionSatisfied(
  condition: AffixCondition,
  actor: Readonly<BattleUnitStateV1>,
  target: Readonly<BattleUnitStateV1> | null | undefined,
  round: number,
): boolean {
  switch (condition.kind) {
    case "selfHpAtMostBps": return actor.currentHp * 10_000 <= actor.stats.maxHp * condition.valueBps;
    case "selfHpAtLeastBps": return actor.currentHp * 10_000 >= actor.stats.maxHp * condition.valueBps;
    case "targetHpAtMostBps": return target !== null && target !== undefined && target.currentHp * 10_000 <= target.stats.maxHp * condition.valueBps;
    case "targetHpAtLeastBps": return target !== null && target !== undefined && target.currentHp * 10_000 >= target.stats.maxHp * condition.valueBps;
    case "selfHasStatus": return actor.statuses.some((status) => status.statusId === condition.statusId);
    case "targetHasStatus": return target !== null && target !== undefined && target.statuses.some((status) => status.statusId === condition.statusId);
    case "formationRow": return condition.row === (actor.slot < 2 ? "front" : "back");
    case "roundAtMost": return round <= condition.round;
  }
}

function getCharacter(
  content: BattleLoadoutRuntimeContent,
  id: string,
): DomainResult<Readonly<CharacterDefinition>> {
  try {
    const result = content.getCharacter(id);
    if (!result.ok) return result;
    return result.value.id === id ? result : invalid(`characters.${id}`, "id_mismatch");
  } catch {
    return invalid(`characters.${id}`, "getter_failed");
  }
}

function getSkill(
  content: BattleLoadoutRuntimeContent,
  id: string,
): DomainResult<Readonly<SkillDefinition>> {
  try {
    const result = content.getSkill(id);
    if (!result.ok) return result;
    return result.value.id === id ? result : invalid(`skills.${id}`, "id_mismatch");
  } catch {
    return invalid(`skills.${id}`, "getter_failed");
  }
}

function getEquipmentAffix(
  content: BattleLoadoutRuntimeContent,
  id: string,
): DomainResult<Readonly<EquipmentAffixDefinition>> {
  if (typeof content.getEquipmentAffix !== "function") return invalid(`equipmentAffixes.${id}`, "getter_required");
  try {
    const result = content.getEquipmentAffix(id);
    if (!result.ok) return result;
    return result.value.id === id ? result : invalid(`equipmentAffixes.${id}`, "id_mismatch");
  } catch {
    return invalid(`equipmentAffixes.${id}`, "getter_failed");
  }
}

function addModifier(
  result: { damageBonusBps: number; finalDamageMultiplierBps: number; healingBonusBps: number; shieldBonusBps: number },
  modifier: Readonly<{ kind: string; [key: string]: unknown }>,
  rollValue: number,
  effect: Readonly<EffectSpec>,
  actor: Readonly<BattleUnitStateV1>,
  target: Readonly<BattleUnitStateV1> | null | undefined,
  round: number,
): void {
  if (modifier.kind === "damageBonus" && effect.kind === "damage" && (modifier.element === "all" || modifier.element === effect.element)) {
    result.damageBonusBps += rollValue;
  } else if (modifier.kind === "finalDamageMultiplier" && effect.kind === "damage") {
    result.finalDamageMultiplierBps = Math.max(result.finalDamageMultiplierBps, rollValue);
  } else if (modifier.kind === "healingBonus" && effect.kind === "heal") {
    result.healingBonusBps += rollValue;
  } else if (modifier.kind === "shieldBonus" && effect.kind === "shield") {
    result.shieldBonusBps += rollValue;
  } else if (modifier.kind === "conditionalDamageBonus"
    && effect.kind === "damage"
    && (modifier.element === "all" || modifier.element === effect.element)
    && conditionSatisfied(modifier.condition as AffixCondition, actor, target, round)) {
    result.damageBonusBps += rollValue;
  }
}

function applyEquipmentModifiers(
  input: BattleLoadoutRuntimeInput,
  result: { damageBonusBps: number; finalDamageMultiplierBps: number; healingBonusBps: number; shieldBonusBps: number },
): DomainResult<true> {
  const progress = input.save.characters[input.actor.definitionId];
  if (!progress) return invalid(`characters.${input.actor.definitionId}`, "missing_progress");
  for (const slot of EQUIPMENT_SLOT_ORDER) {
    const instanceId = progress.equipmentBySlot[slot];
    if (instanceId === null) continue;
    const instance = input.save.inventory.equipment.find((value) => value.instanceId === instanceId);
    if (!instance) return invalid(`characters.${input.actor.definitionId}.equipmentBySlot.${slot}`, "missing_equipment_instance");
    const rolls = instance.abyssAffix === null ? instance.affixes : [...instance.affixes, instance.abyssAffix];
    for (const roll of rolls) {
      const definitionResult = getEquipmentAffix(input.content, roll.affixId);
      if (!definitionResult.ok) return definitionResult;
      for (const modifier of definitionResult.value.modifiers) {
        if (!("rollScaleBps" in modifier)) continue;
        if (!Number.isSafeInteger(roll.roll) || roll.roll < 0) return invalid(`equipment.${instance.instanceId}.affixes.${roll.affixId}`, "roll_range");
        if (!Number.isSafeInteger(modifier.rollScaleBps) || modifier.rollScaleBps < 0) return invalid(`equipmentAffixes.${definitionResult.value.id}.modifiers`, "roll_scale_range");
        const value = modifierValue(roll.roll, roll.craftEmpowered, modifier.rollScaleBps);
        addModifier(result, modifier as unknown as { kind: string; [key: string]: unknown }, value, input.effect, input.actor, input.target, input.round);
      }
    }
  }
  return success(true);
}

function applyPassiveModifiers(
  input: BattleLoadoutRuntimeInput,
  result: { damageBonusBps: number; finalDamageMultiplierBps: number; healingBonusBps: number; shieldBonusBps: number },
): DomainResult<true> {
  const characterResult = getCharacter(input.content, input.actor.definitionId);
  if (!characterResult.ok) return characterResult;
  const passiveResult = getSkill(input.content, characterResult.value.passiveSkillId);
  if (!passiveResult.ok) return passiveResult;
  if (passiveResult.value.kind !== "passive") return invalid(`skills.${passiveResult.value.id}`, "passive_kind_required");
  for (const modifier of passiveResult.value.passiveModifiers) {
    if (modifier.kind === "damageBonus" && input.effect.kind === "damage" && (modifier.element === "all" || modifier.element === input.effect.element)) result.damageBonusBps += modifier.valueBps;
    else if (modifier.kind === "healingBonus" && input.effect.kind === "heal") result.healingBonusBps += modifier.valueBps;
    else if (modifier.kind === "shieldBonus" && input.effect.kind === "shield") result.shieldBonusBps += modifier.valueBps;
  }
  return success(true);
}

/** 读取当前候选存档的动态战斗倍率；敌方行动严格不读取玩家 loadout。 */
export function resolveBattleDynamicModifiers(input: BattleLoadoutRuntimeInput): DomainResult<BattleDynamicModifiers> {
  if (!input || !input.save || !input.actor || !input.effect || !input.content || !Number.isSafeInteger(input.round) || input.round < 0) return invalid("input", "shape");
  if (input.actor.faction === "enemy") return success(zeroModifiers());
  const actorStats = resolveEffectiveStats(input.actor, input.content.getStatus);
  if (!actorStats.ok) return actorStats;
  const targetStats = input.target
    ? resolveEffectiveStats(input.target, input.content.getStatus)
    : success(null);
  if (!targetStats.ok) return targetStats;
  // 条件只使用本次解析得到的临时有效 stats，绝不把动态值写回战斗单位。
  const runtimeInput: BattleLoadoutRuntimeInput = {
    ...input,
    actor: { ...input.actor, stats: actorStats.value },
    target: input.target && targetStats.value ? { ...input.target, stats: targetStats.value } : input.target,
  };
  const result = zeroModifiers();
  const equipmentResult = applyEquipmentModifiers(runtimeInput, result);
  if (!equipmentResult.ok) return equipmentResult;
  const passiveResult = applyPassiveModifiers(runtimeInput, result);
  if (!passiveResult.ok) return passiveResult;
  void input.skill;
  return success(Object.freeze(result));
}

export const resolveLoadoutDynamicModifiers = resolveBattleDynamicModifiers;
