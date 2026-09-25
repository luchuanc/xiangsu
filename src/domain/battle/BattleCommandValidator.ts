/**
 * 玩家战斗指令的唯一校验入口。
 *
 * 校验只读取快照、内容和权威背包，不修改任何输入，也不消费 RNG；这样
 * 保存失败时可以使用同一个候选重新提交，且失败指令不会占用领域 ID。
 */
import type {
  AbyssEchoDefinition,
  BattleCommandV1,
  BattleSnapshotV1,
  BattleUnitStateV1,
  CharacterDefinition,
  CharacterProgressV1,
  ConsumableItemDefinition,
  EquipmentAffixDefinition,
  EquipmentSlot,
  EncounterDefinition,
  ExpeditionSnapshotV1,
  InventoryStateV1,
  ItemId,
  SkillDefinition,
  SkillStoneInstance,
  StatusDefinition,
  StackableItemDefinition,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import { SkillModifierResolver, type SkillModifierResolution } from "../skill/SkillModifierResolver";
import { getLegalTargetUnitIds, validateTargetSelection } from "./Targeting";
import { checkSkillResource, getSkillResourceCost } from "./EnergyCooldown";

export interface BattleCommandContentSource {
  getCharacter(id: string): DomainResult<Readonly<CharacterDefinition>>;
  getSkill(id: string): DomainResult<Readonly<SkillDefinition>>;
  getEnemy(id: string): DomainResult<Readonly<import("../../content/contracts").EnemyDefinition>>;
  getItem?(id: string): DomainResult<Readonly<StackableItemDefinition>>;
  getEncounter?(id: string): DomainResult<Readonly<EncounterDefinition>>;
  /** 回响模式 USE_ITEM 必须显式读取该定义，不能从楼层或 ID 猜测。 */
  getAbyssEcho?(id: string): DomainResult<Readonly<AbyssEchoDefinition>>;
  getStatus?(id: string): DomainResult<Readonly<StatusDefinition>>;
  getSkillAffix?(id: string): DomainResult<Readonly<import("../../content/contracts").SkillAffixDefinition>>;
  getEquipmentAffix?(id: string): DomainResult<Readonly<EquipmentAffixDefinition>>;
}

export interface BattleCommandValidationInput {
  readonly snapshot: Readonly<BattleSnapshotV1>;
  /** BattleSnapshot 不携带远征模式，因此由 Gateway 显式传入当前远征。 */
  readonly expedition?: Readonly<ExpeditionSnapshotV1> | null;
  readonly command: BattleCommandV1;
  readonly content: BattleCommandContentSource;
  readonly inventory?: Readonly<InventoryStateV1>;
  readonly characters?: Readonly<Record<string, CharacterProgressV1>>;
  readonly skillStones?: Readonly<Record<string, SkillStoneInstance>>;
  readonly skillModifierResolver?: SkillModifierResolver;
  readonly equippedSkillIdsByCharacter?: Readonly<Record<string, readonly string[]>>;
}

export interface ValidatedBattleCommand {
  readonly command: BattleCommandV1;
  readonly actor: Readonly<BattleUnitStateV1>;
  readonly rootActionDefinitionId: string;
  readonly actionKind: "basic" | "active" | "ultimate" | "defend" | "item" | "retreat";
  readonly skill: Readonly<SkillDefinition> | null;
  readonly skillKind: "basic" | "active" | "ultimate" | null;
  readonly skillLevel: number;
  readonly skillModifierResolution: Readonly<SkillModifierResolution> | null;
  readonly item: Readonly<ConsumableItemDefinition> | null;
  readonly abyssEcho: Readonly<AbyssEchoDefinition> | null;
  readonly targetUnitIds: readonly string[];
  readonly candidateTargetUnitIds: readonly string[];
  readonly resourceCost: { readonly energy: number; readonly cooldown: number };
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAlive(unit: Readonly<BattleUnitStateV1>): boolean {
  return unit.currentHp > 0;
}

function unitOf(snapshot: Readonly<BattleSnapshotV1>, unitId: string): Readonly<BattleUnitStateV1> | undefined {
  return snapshot.units.find((unit) => unit.unitId === unitId);
}

function expectedPhase(): BattleSnapshotV1["phase"][] {
  return ["AWAIT_COMMAND", "AI_DECIDE", "VALIDATE"];
}

function staleRevision(snapshot: Readonly<BattleSnapshotV1>, expected: number): DomainResult<never> {
  return failure(createDomainError("STALE_BATTLE_REVISION", {
    expectedRevision: expected,
    actualRevision: snapshot.battleRevision,
  }));
}

function getSkill(content: BattleCommandContentSource, id: string): DomainResult<Readonly<SkillDefinition>> {
  if (typeof content.getSkill !== "function") return invalid("content.getSkill", "getter_required");
  try {
    const result = content.getSkill(id);
    if (!result.ok) return result;
    if (result.value.id !== id) return invalid(`skills.${id}`, "id_mismatch");
    return result;
  } catch {
    return invalid(`skills.${id}`, "getter_failed");
  }
}

function getCharacter(content: BattleCommandContentSource, id: string): DomainResult<Readonly<CharacterDefinition>> {
  try {
    const result = content.getCharacter(id);
    if (!result.ok) return result;
    if (result.value.id !== id) return invalid(`characters.${id}`, "id_mismatch");
    return result;
  } catch {
    return invalid(`characters.${id}`, "getter_failed");
  }
}

function getEnemy(content: BattleCommandContentSource, id: string): DomainResult<Readonly<import("../../content/contracts").EnemyDefinition>> {
  try {
    const result = content.getEnemy(id);
    if (!result.ok) return result;
    if (result.value.id !== id) return invalid(`enemies.${id}`, "id_mismatch");
    return result;
  } catch {
    return invalid(`enemies.${id}`, "getter_failed");
  }
}

function getSkillLevel(
  characters: Readonly<Record<string, CharacterProgressV1>> | undefined,
  actor: Readonly<BattleUnitStateV1>,
  skill: Readonly<SkillDefinition>,
): DomainResult<number> {
  const progress = characters?.[actor.definitionId];
  if (progress && skill.kind === "active" && !Object.prototype.hasOwnProperty.call(progress.skillLevels, skill.id)) {
    return failure(createDomainError("SKILL_LOCKED", { skillId: skill.id }));
  }
  const level = progress?.skillLevels[skill.id] ?? 1;
  if (!Number.isSafeInteger(level) || level < 1 || level > skill.maxLevel) return invalid(`characters.${actor.definitionId}.skillLevels.${skill.id}`, "level_range");
  if (level < skill.unlockLevel || (progress && progress.level < skill.unlockLevel)) {
    return failure(createDomainError("SKILL_LOCKED_BY_LEVEL", {
      skillId: skill.id,
      unlockLevel: skill.unlockLevel,
      characterLevel: progress?.level ?? actor.level,
    }));
  }
  return success(level);
}

function cloneSkill(skill: Readonly<SkillDefinition>): SkillDefinition {
  return structuredClone(skill);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Reflect.ownKeys(value as object).forEach((key) => {
      freezeDeep((value as Record<PropertyKey, unknown>)[key]);
    });
    Object.freeze(value);
  }
  return value;
}

function skillAvailableForActor(
  actor: Readonly<BattleUnitStateV1>,
  character: Readonly<CharacterDefinition> | null,
  enemy: Readonly<import("../../content/contracts").EnemyDefinition> | null,
  skill: Readonly<SkillDefinition>,
  commandType: BattleCommandV1["type"],
  characters: Readonly<Record<string, CharacterProgressV1>> | undefined,
): DomainResult<true> {
  if (skill.kind === "passive" || skill.kind === "effect") {
    return failure(createDomainError("SKILL_LOCKED", { skillId: skill.id }));
  }
  if (actor.faction === "party") {
    if (!character || skill.owner.kind !== "character" || skill.owner.characterId !== character.id) return failure(createDomainError("SKILL_LOCKED", { skillId: skill.id }));
    const progress = characters?.[actor.definitionId];
    if (commandType === "USE_SKILL") {
      const equipped = progress?.equippedActiveSkillIds ?? [character.activeSkillIds[0], character.activeSkillIds[1]];
      if (!equipped.includes(skill.id) || !character.activeSkillIds.includes(skill.id)) return failure(createDomainError("SKILL_LOCKED", { skillId: skill.id }));
    } else if (commandType === "USE_ULTIMATE" && skill.id !== character.ultimateSkillId) {
      return failure(createDomainError("SKILL_LOCKED", { skillId: skill.id }));
    }
  } else {
    // 敌方可使用内容表中共享的 systemEffect 技能；玩家仍只能使用角色归属技能。
    if (!enemy
      || (skill.owner.kind !== "enemy" && skill.owner.kind !== "systemEffect")
      || (skill.owner.kind === "enemy" && skill.owner.enemyId !== enemy.id)
      || !enemy.skillIds.includes(skill.id)) {
      return failure(createDomainError("SKILL_LOCKED", { skillId: skill.id }));
    }
  }
  return success(true);
}

function resolveBasicSkill(
  content: BattleCommandContentSource,
  actor: Readonly<BattleUnitStateV1>,
): DomainResult<Readonly<SkillDefinition>> {
  const owner = actor.faction === "party" ? getCharacter(content, actor.definitionId) : getEnemy(content, actor.definitionId);
  if (!owner.ok) return owner;
  return getSkill(content, owner.value.basicSkillId);
}

const EQUIPMENT_SLOT_ORDER: readonly EquipmentSlot[] = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"];

function getEquipmentAffix(
  content: BattleCommandContentSource,
  id: string,
): DomainResult<Readonly<EquipmentAffixDefinition>> {
  if (!content.getEquipmentAffix) return invalid("content.getEquipmentAffix", "getter_required");
  try {
    const result = content.getEquipmentAffix(id);
    if (!result.ok) return result;
    if (result.value.id !== id) return invalid(`equipmentAffixes.${id}`, "id_mismatch");
    return result;
  } catch {
    return invalid(`equipmentAffixes.${id}`, "getter_failed");
  }
}

function resolveBasicReplacement(
  input: BattleCommandValidationInput,
  actor: Readonly<BattleUnitStateV1>,
  basic: Readonly<SkillDefinition>,
): DomainResult<Readonly<SkillDefinition>> {
  // 敌方 basic 和没有存档 loadout 的纯领域调用不读取装备；玩家装备由当前角色槽位决定。
  if (actor.faction !== "party" || !input.characters || !input.inventory) return success(basic);
  const progress = input.characters[actor.definitionId];
  if (!progress) return success(basic);
  const equipmentById = new Map(input.inventory.equipment.map((instance) => [instance.instanceId, instance]));
  const replacements: Array<{ readonly skillId: string; readonly affixId: string }> = [];
  for (const slot of EQUIPMENT_SLOT_ORDER) {
    const instanceId = progress.equipmentBySlot[slot];
    if (instanceId === null) continue;
    const instance = equipmentById.get(instanceId);
    if (!instance) return invalid(`characters.${actor.definitionId}.equipmentBySlot.${slot}`, "missing_equipment_instance");
    const rolls = instance.abyssAffix === null ? instance.affixes : [...instance.affixes, instance.abyssAffix];
    for (const roll of rolls) {
      const affixResult = getEquipmentAffix(input.content, roll.affixId);
      if (!affixResult.ok) return affixResult;
      for (const modifier of affixResult.value.modifiers) {
        if (modifier.kind === "replaceBasicSkill") replacements.push({ skillId: modifier.skillId, affixId: roll.affixId });
      }
    }
  }
  if (replacements.length === 0) return success(basic);
  if (replacements.length > 1) {
    return failure(createDomainError("AFFIX_CONFLICT", {
      exclusiveGroup: "replace_basic_skill",
      sourceIds: replacements.map((value) => value.affixId),
    }));
  }
  const replacement = getSkill(input.content, replacements[0].skillId);
  if (!replacement.ok) return replacement;
  // 替换目标必须是系统 effect 技能，不能借此把 passive/effect 暴露为独立玩家技能。
  if (replacement.value.kind !== "effect" || replacement.value.owner.kind !== "systemEffect") {
    return invalid(`skills.${replacement.value.id}`, "replace_basic_skill_requires_effect");
  }
  return success(replacement.value);
}

function resolveCommandSkill(
  input: BattleCommandValidationInput,
  actor: Readonly<BattleUnitStateV1>,
  command: Extract<BattleCommandV1, { type: "USE_SKILL" | "USE_ULTIMATE" }>,
  kind: "active" | "ultimate",
): DomainResult<{ skill: Readonly<SkillDefinition>; level: number; modifier: Readonly<SkillModifierResolution> | null }> {
  const skillResult = getSkill(input.content, command.skillId);
  if (!skillResult.ok) return failure(createDomainError("SKILL_LOCKED", { skillId: command.skillId }));
  const ownerResult = actor.faction === "party" ? getCharacter(input.content, actor.definitionId) : getEnemy(input.content, actor.definitionId);
  if (!ownerResult.ok) return ownerResult;
  const character = actor.faction === "party" ? ownerResult.value as Readonly<CharacterDefinition> : null;
  const enemy = actor.faction === "enemy" ? ownerResult.value as Readonly<import("../../content/contracts").EnemyDefinition> : null;
  const available = skillAvailableForActor(actor, character, enemy, skillResult.value, command.type, input.characters);
  if (!available.ok) return available;
  if (skillResult.value.kind !== kind) return failure(createDomainError("SKILL_LOCKED", { skillId: command.skillId }));
  if (!Object.prototype.hasOwnProperty.call(actor.cooldowns, skillResult.value.id)) return failure(createDomainError("SKILL_LOCKED", { skillId: command.skillId }));
  const levelResult = getSkillLevel(input.characters, actor, skillResult.value);
  if (!levelResult.ok) return levelResult;
  let resolved: Readonly<SkillDefinition> = freezeDeep(cloneSkill(skillResult.value));
  let modifier: Readonly<SkillModifierResolution> | null = null;
  if (input.skillModifierResolver && actor.faction === "party" && input.skillStones?.[actor.definitionId]) {
    const equipped = input.equippedSkillIdsByCharacter?.[actor.definitionId]
      ?? input.characters?.[actor.definitionId]?.equippedActiveSkillIds.filter((id): id is string => id !== null)
      ?? [];
    const modified = input.skillModifierResolver.resolve({
      characterId: actor.definitionId,
      skill: resolved,
      equippedSkillIds: equipped,
      skillStone: input.skillStones[actor.definitionId],
    });
    if (!modified.ok) return modified;
    modifier = freezeDeep(modified.value);
    resolved = freezeDeep(cloneSkill(modified.value.resolvedSkill));
  }
  return success({ skill: resolved, level: levelResult.value, modifier });
}

function resolveAbyssEchoForItem(
  input: BattleCommandValidationInput,
): DomainResult<Readonly<AbyssEchoDefinition> | null> {
  if (input.expedition?.mode !== "abyssEcho") return success(null);
  const echoId = input.expedition.abyssEchoId;
  if (typeof echoId !== "string" || echoId.length === 0) return invalid("expedition.abyssEchoId", "required");
  if (typeof input.content.getAbyssEcho !== "function") return invalid("content.getAbyssEcho", "getter_required");
  let result: DomainResult<Readonly<AbyssEchoDefinition>>;
  try {
    result = input.content.getAbyssEcho(echoId);
  } catch {
    return invalid(`abyssEchoes.${echoId}`, "getter_failed");
  }
  if (!result.ok) return invalid(`abyssEchoes.${echoId}`, "missing_reference");
  if (!result.value || result.value.id !== echoId) return invalid(`abyssEchoes.${echoId}`, "id_mismatch");
  if (![0, 1, 2].includes(result.value.itemUseLimit)) return invalid(`abyssEchoes.${echoId}.itemUseLimit`, "limit_range");
  return success(result.value);
}

function validateItem(
  input: BattleCommandValidationInput,
  command: Extract<BattleCommandV1, { type: "USE_ITEM" }>,
): DomainResult<{ readonly item: Readonly<ConsumableItemDefinition>; readonly abyssEcho: Readonly<AbyssEchoDefinition> | null }> {
  if (!input.content.getItem) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: command.itemId as ItemId }));
  let itemResult: DomainResult<Readonly<StackableItemDefinition>>;
  try {
    itemResult = input.content.getItem(command.itemId);
  } catch {
    return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: command.itemId as ItemId }));
  }
  if (!itemResult.ok || itemResult.value.id !== command.itemId) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: command.itemId as ItemId }));
  if (itemResult.value.category !== "consumable") return failure(createDomainError("ITEM_USE_FORBIDDEN", { itemId: command.itemId, reason: "WRONG_CONTEXT" }));
  if (!itemResult.value.useContexts.includes("battle")) return failure(createDomainError("ITEM_USE_FORBIDDEN", { itemId: command.itemId, reason: "WRONG_CONTEXT" }));
  const quantity = input.inventory?.stackables[command.itemId] ?? 0;
  if (!Number.isSafeInteger(quantity) || quantity < 1) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: command.itemId as ItemId }));
  const echoResult = resolveAbyssEchoForItem(input);
  if (!echoResult.ok) return echoResult;
  if (echoResult.value !== null) {
    if (!Number.isSafeInteger(input.snapshot.successfulItemUses) || input.snapshot.successfulItemUses < 0) return invalid("snapshot.successfulItemUses", "range");
    if (input.snapshot.successfulItemUses >= echoResult.value.itemUseLimit) {
      return failure(createDomainError("ITEM_USE_FORBIDDEN", { itemId: command.itemId, reason: "ECHO_LIMIT" }));
    }
  }
  return success({ item: itemResult.value, abyssEcho: echoResult.value });
}

function resourceFailure(
  actor: Readonly<BattleUnitStateV1>,
  skill: Readonly<SkillDefinition>,
  level: number,
  ultimate: boolean,
): DomainResult<true> {
  const check = checkSkillResource(actor, skill, level, ultimate);
  if (check.ok) return success(true);
  if (check.reason === "cooldown") return failure(createDomainError("SKILL_ON_COOLDOWN", { skillId: skill.id, remainingTurns: check.remaining ?? 0 }));
  return failure(createDomainError("INSUFFICIENT_ENERGY", { required: check.required ?? 0, owned: check.owned ?? actor.energy }));
}

/** 按合同固定顺序校验并解析一条 BattleCommandV1。 */
export function validateBattleCommand(input: BattleCommandValidationInput): DomainResult<ValidatedBattleCommand> {
  if (!input || !isObject(input)) return invalid("input", "not_object");
  const { snapshot, command, content } = input;
  if (!snapshot || !isObject(snapshot) || !command || !isObject(command) || !content) return invalid("input", "shape");
  if (!Number.isSafeInteger(command.expectedBattleRevision) || command.expectedBattleRevision < 0) return invalid("command.expectedBattleRevision", "revision");
  if (command.expectedBattleRevision !== snapshot.battleRevision) return staleRevision(snapshot, command.expectedBattleRevision);
  if (!expectedPhase().includes(snapshot.phase)) return failure(createDomainError("INVALID_BATTLE_PHASE", { expected: expectedPhase(), actual: snapshot.phase }));
  const actor = unitOf(snapshot, command.actorUnitId);
  if (!actor || snapshot.currentUnitId !== command.actorUnitId) return failure(createDomainError("NOT_CURRENT_ACTOR", { actorUnitId: command.actorUnitId, currentUnitId: snapshot.currentUnitId }));
  if (!isAlive(actor)) return failure(createDomainError("INVALID_TARGET", { reason: "DEAD", targetUnitId: actor.unitId }));

  let skill: Readonly<SkillDefinition> | null = null;
  let skillKind: "basic" | "active" | "ultimate" | null = null;
  let skillLevel = 1;
  let modifier: Readonly<SkillModifierResolution> | null = null;
  let item: Readonly<ConsumableItemDefinition> | null = null;
  let abyssEcho: Readonly<AbyssEchoDefinition> | null = null;
  let actionKind: ValidatedBattleCommand["actionKind"];
  let rootActionDefinitionId: string;
  let targetRule: import("../../content/contracts").TargetRule | null = null;
  let requiresFrontAccess = false;
  let resourceCost = { energy: 0, cooldown: 0 };

  switch (command.type) {
    case "USE_BASIC": {
      const result = resolveBasicSkill(content, actor);
      if (!result.ok) return result;
      const replacement = resolveBasicReplacement(input, actor, result.value);
      if (!replacement.ok) return replacement;
      skill = replacement.value;
      skillKind = "basic";
      skillLevel = 1;
      actionKind = "basic";
      rootActionDefinitionId = skill.id;
      targetRule = skill.targetRule;
      requiresFrontAccess = skill.requiresFrontAccess;
      // 普攻/敌方 fallback 不查模板 CD，也不写入模板 CD。
      break;
    }
    case "USE_SKILL": {
      const result = resolveCommandSkill(input, actor, command, "active");
      if (!result.ok) return result;
      skill = result.value.skill;
      skillLevel = result.value.level;
      modifier = result.value.modifier;
      skillKind = "active";
      actionKind = "active";
      rootActionDefinitionId = command.skillId;
      targetRule = skill.targetRule;
      requiresFrontAccess = skill.requiresFrontAccess;
      const resource = resourceFailure(actor, skill, skillLevel, false);
      if (!resource.ok) return resource;
      {
        const cost = getSkillResourceCost(skill, skillLevel);
        resourceCost = { energy: cost.energyCost, cooldown: cost.cooldownTurns };
      }
      break;
    }
    case "USE_ULTIMATE": {
      const result = resolveCommandSkill(input, actor, command, "ultimate");
      if (!result.ok) return result;
      skill = result.value.skill;
      skillLevel = result.value.level;
      modifier = result.value.modifier;
      skillKind = "ultimate";
      actionKind = "ultimate";
      rootActionDefinitionId = command.skillId;
      targetRule = skill.targetRule;
      requiresFrontAccess = skill.requiresFrontAccess;
      const resource = resourceFailure(actor, skill, skillLevel, true);
      if (!resource.ok) return resource;
      resourceCost = { energy: 100, cooldown: getSkillResourceCost(skill, skillLevel).cooldownTurns };
      break;
    }
    case "USE_ITEM": {
      const result = validateItem(input, command);
      if (!result.ok) return result;
      item = result.value.item;
      abyssEcho = result.value.abyssEcho;
      actionKind = "item";
      rootActionDefinitionId = command.itemId;
      targetRule = item.targetRule;
      break;
    }
    case "DEFEND":
      actionKind = "defend";
      rootActionDefinitionId = "action_defend";
      break;
    case "RETREAT": {
      actionKind = "retreat";
      rootActionDefinitionId = "action_retreat";
      if (!content.getEncounter) return invalid("content.getEncounter", "getter_required");
      let encounter: DomainResult<Readonly<EncounterDefinition>>;
      try {
        encounter = content.getEncounter(snapshot.encounterId);
      } catch {
        return invalid(`encounters.${snapshot.encounterId}`, "getter_failed");
      }
      if (!encounter.ok || encounter.value.id !== snapshot.encounterId) return invalid(`encounters.${snapshot.encounterId}`, "missing_reference");
      if (encounter.value.kind === "boss" || !encounter.value.canRetreat) return failure(createDomainError("RETREAT_FORBIDDEN", null));
      break;
    }
    default:
      return invalid("command.type", "unsupported");
  }

  let targetUnitIds: readonly string[] = [];
  let candidateTargetUnitIds: readonly string[] = [];
  if (targetRule !== null) {
    const requested = "targetUnitIds" in command ? command.targetUnitIds : [];
    const targetResult = validateTargetSelection({ snapshot, actorUnitId: actor.unitId, targetRule, requiresFrontAccess, targetUnitIds: requested });
    if (!targetResult.ok) return targetResult;
    const candidatesResult = getLegalTargetUnitIds(snapshot, actor.unitId, targetRule, requiresFrontAccess);
    if (!candidatesResult.ok) return candidatesResult;
    if (candidatesResult.value.length === 0) return failure(createDomainError("INVALID_TARGET", { reason: "UNKNOWN", targetUnitId: null }));
    candidateTargetUnitIds = candidatesResult.value;
    targetUnitIds = requested.length === 0 ? [] : [...requested];
  }
  return success({
    command,
    actor,
    rootActionDefinitionId,
    actionKind,
    skill: skill ? freezeDeep(cloneSkill(skill)) : null,
    skillKind,
    skillLevel,
    skillModifierResolution: modifier,
    item,
    abyssEcho,
    targetUnitIds,
    candidateTargetUnitIds,
    resourceCost,
  });
}

export const validateCommand = validateBattleCommand;
