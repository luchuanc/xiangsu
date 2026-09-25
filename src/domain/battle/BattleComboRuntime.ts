/**
 * 战斗根行动的 Combo 适配器。
 *
 * 这里只把同一份候选存档转换成 ComboTriggerRuntime 所需的来源；预算、
 * chance、FIFO 和派生事件应用仍由 ComboTriggerRuntime/TriggerQueue 负责。
 */
import type {
  BattleDomainEventV1,
  BattleSnapshotV1,
  BattleUnitStateV1,
  CharacterDefinition,
  ComboDefinition,
  ContentRootV1,
  EffectSpec,
  EquipmentAffixDefinition,
  EquipmentBaseDefinition,
  GameSaveV1,
  SkillAffixDefinition,
  SkillDefinition,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import { ComboMatcher } from "../combo/ComboMatcher";
import { ComboTriggerRuntime, type EquipmentTriggerCandidateInput, type TriggerRuntimeEvent } from "./ComboTriggerRuntime";
import { SeededRng } from "../common/SeededRng";
import { TriggerQueue, type TriggerCandidate } from "./TriggerQueue";

export interface BattleComboRuntimeContent {
  readonly getRoot: () => Readonly<ContentRootV1>;
  readonly getCharacter: (id: string) => DomainResult<Readonly<CharacterDefinition>>;
  readonly getSkill: (id: string) => DomainResult<Readonly<SkillDefinition>>;
  readonly getEquipmentBase: (id: string) => DomainResult<Readonly<EquipmentBaseDefinition>>;
  readonly getEquipmentAffix: (id: string) => DomainResult<Readonly<EquipmentAffixDefinition>>;
  readonly getSkillAffix: (id: string) => DomainResult<Readonly<SkillAffixDefinition>>;
  readonly getCombo: (id: string) => DomainResult<Readonly<ComboDefinition>>;
}

export interface BattleComboRuntimeCandidateInput {
  readonly event: TriggerRuntimeEvent;
  readonly snapshot: Readonly<BattleSnapshotV1>;
  readonly nextEventId: () => string;
}

export interface BattleComboRuntimeAdapter {
  readonly collectCandidates: (input: BattleComboRuntimeCandidateInput) => DomainResult<readonly TriggerCandidate[]>;
  readonly createQueue: (options: ConstructorParameters<typeof TriggerQueue>[0]) => TriggerQueue;
}

const EQUIPMENT_SLOTS = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"] as const;

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strictRootArray<K extends keyof ContentRootV1>(root: Readonly<ContentRootV1>, key: K): DomainResult<unknown[]> {
  const value = root[key];
  if (!Array.isArray(value)) return invalid(`content.getRoot().${String(key)}`, "array_required");
  return success(value);
}

function strictGetter<T extends { readonly id: string }>(
  getter: (id: string) => DomainResult<Readonly<T>>,
  id: string,
  path: string,
): DomainResult<Readonly<T>> {
  let result: DomainResult<Readonly<T>>;
  try {
    result = getter(id);
  } catch {
    return invalid(path, "getter_failed");
  }
  if (!result.ok) return invalid(path, "missing_reference");
  if (!result.value || result.value.id !== id) return invalid(path, "id_mismatch");
  return result;
}

function rootDefinition<T extends { readonly id: string }>(
  values: readonly T[],
  id: string,
  path: string,
): DomainResult<Readonly<T>> {
  const matches = values.filter((value) => value.id === id);
  if (matches.length !== 1) return invalid(path, matches.length === 0 ? "missing_reference" : "duplicate_id");
  return success(matches[0]);
}

function unitById(snapshot: Readonly<BattleSnapshotV1>, unitId: string): BattleUnitStateV1 | undefined {
  return snapshot.units.find((unit) => unit.unitId === unitId);
}

function isAlive(unit: Readonly<BattleUnitStateV1> | undefined): boolean {
  return Boolean(unit && unit.currentHp > 0);
}

function legalTarget(
  snapshot: Readonly<BattleSnapshotV1>,
  sourceUnitId: string,
  targetUnitId: string | null,
  effect: EffectSpec,
): boolean {
  if (!("targetRule" in effect)) return true;
  const source = unitById(snapshot, sourceUnitId);
  const target = targetUnitId === null ? undefined : unitById(snapshot, targetUnitId);
  switch (effect.targetRule) {
    case "self": return Boolean(source && source.currentHp > 0);
    case "singleEnemy": return Boolean(target && target.faction !== source?.faction && isAlive(target));
    case "singleAlly": return Boolean(target && target.faction === source?.faction && isAlive(target));
    case "deadAlly": return Boolean(target && target.faction === source?.faction && target.currentHp <= 0);
    case "allEnemies":
    case "randomEnemy": return snapshot.units.some((unit) => unit.faction !== source?.faction && isAlive(unit));
    case "allAllies": return snapshot.units.some((unit) => unit.faction === source?.faction && isAlive(unit));
  }
}

function consumeStatusEvent(
  snapshot: BattleSnapshotV1,
  event: TriggerRuntimeEvent,
  statusId: string,
  stacks: number,
  nextEventId: () => string,
): readonly BattleDomainEventV1[] {
  if (event.targetUnitId === null || stacks <= 0) return [];
  const target = unitById(snapshot, event.targetUnitId);
  if (!target) return [];
  const before = target.statuses.filter((status) => status.statusId === statusId).length;
  if (before === 0) return [];
  let left = stacks;
  target.statuses = target.statuses.filter((status) => {
    if (left > 0 && status.statusId === statusId) {
      left -= 1;
      return false;
    }
    return true;
  });
  const after = target.statuses.filter((status) => status.statusId === statusId).length;
  return [{
    type: "STATUS_CHANGED",
    eventId: nextEventId(),
    sequence: 0,
    battleId: snapshot.battleId,
    round: snapshot.round,
    rootActionId: event.rootActionId,
    rootActionDefinitionId: event.rootActionDefinitionId,
    chainDepth: event.chainDepth,
    triggerSource: null,
    visualSkillId: event.visualSkillId ?? null,
    contextSkillKind: event.contextSkillKind,
    effect: null,
    sourceUnitId: event.eventOwnerUnitId,
    targetUnitId: target.unitId,
    statusId,
    statusStackId: null,
    change: "consumed",
    stacksBefore: before,
    stacksAfter: after,
    remainingOwnerTurnsAfter: target.statuses.find((status) => status.statusId === statusId)?.remainingOwnerTurns ?? 0,
  }];
}

/** 创建一次战斗命令使用的只读 Combo 适配器。 */
export function createBattleComboRuntime(options: {
  readonly save: Readonly<GameSaveV1>;
  readonly content: BattleComboRuntimeContent;
}): DomainResult<BattleComboRuntimeAdapter> {
  let root: Readonly<ContentRootV1>;
  try {
    root = options.content.getRoot();
  } catch {
    return invalid("content.getRoot", "getter_failed");
  }
  if (!isRecord(root)) return invalid("content.getRoot", "not_object");
  for (const key of ["characters", "skills", "equipmentBases", "equipmentAffixes", "affixTriggers", "skillAffixes", "combos"] as const) {
    const result = strictRootArray(root, key);
    if (!result.ok) return result;
  }
  const comboIds = root.combos.map((combo) => combo.id);
  const matcher = new ComboMatcher({
    getCharacter: options.content.getCharacter,
    getSkill: options.content.getSkill,
    getEquipmentBase: options.content.getEquipmentBase,
    getEquipmentAffix: options.content.getEquipmentAffix,
    getSkillAffix: options.content.getSkillAffix,
    getCombo: options.content.getCombo,
  });

  const adapter: BattleComboRuntimeAdapter = {
    createQueue: (queueOptions) => new ComboTriggerRuntime({ rng: queueOptions.rng }).createQueue(queueOptions),
    collectCandidates: (input) => {
      const eventOwner = input.event.eventOwnerUnitId === null ? null : unitById(input.snapshot, input.event.eventOwnerUnitId);
      if (!eventOwner) return input.event.eventOwnerUnitId === null ? success([]) : invalid(`battle.units.${input.event.eventOwnerUnitId}`, "missing_unit");
      // 玩家 Combo 只读取 party 的已招募角色和装备；敌方行动不猜测玩家 loadout。
      if (eventOwner.faction !== "party") return success([]);
      const character = options.save.characters[eventOwner.definitionId];
      if (!character || character.characterId !== eventOwner.definitionId) return invalid(`characters.${eventOwner.definitionId}`, "missing_or_id_mismatch");
      if (!character.recruited) return success([]);

      const equipmentSources: EquipmentTriggerCandidateInput[] = [];
      const slotIds = character.equipmentBySlot;
      if (!isRecord(slotIds)) return invalid(`characters.${character.characterId}.equipmentBySlot`, "not_object");
      for (const slot of EQUIPMENT_SLOTS) {
        const instanceId = slotIds[slot];
        if (instanceId === null) continue;
        if (typeof instanceId !== "string" || instanceId.length === 0) return invalid(`characters.${character.characterId}.equipmentBySlot.${slot}`, "instance_id");
        const instance = options.save.inventory.equipment.find((value) => value.instanceId === instanceId);
        if (!instance) return invalid(`inventory.equipment.${instanceId}`, "missing_instance");
        const base = strictGetter(options.content.getEquipmentBase, instance.baseId, `equipmentBases.${instance.baseId}`);
        if (!base.ok) return base;
        if (base.value.slot !== slot) return invalid(`characters.${character.characterId}.equipmentBySlot.${slot}`, "equipment_slot_mismatch");
        if (!Array.isArray(instance.affixes)) return invalid(`equipment.${instanceId}.affixes`, "array_required");
        for (const [rollIndex, roll] of instance.affixes.entries()) {
          const affix = strictGetter(options.content.getEquipmentAffix, roll.affixId, `equipmentAffixes.${roll.affixId}`);
          if (!affix.ok) return affix;
          if (affix.value.pool !== "normal") return invalid(`equipment.${instanceId}.affixes[${rollIndex}]`, "pool_mismatch");
          for (const modifier of affix.value.modifiers) {
            if (modifier.kind !== "trigger") continue;
            const definition = rootDefinition(root.affixTriggers, modifier.triggerId, `affixTriggers.${modifier.triggerId}`);
            if (!definition.ok) return definition;
            equipmentSources.push({
              affixId: affix.value.id,
              ownerUnitId: eventOwner.unitId,
              ownerFaction: eventOwner.faction,
              ownerSlot: eventOwner.slot,
              equipmentSlot: slot,
              sourceInstanceId: instance.instanceId,
              sourceRollIndex: rollIndex,
              affixRoll: roll.roll,
              definition: definition.value,
              trigger: definition.value.trigger,
              effects: definition.value.effects,
              budget: definition.value.budget,
              sourceAlive: () => isAlive(unitById(input.snapshot, eventOwner.unitId)),
              targetLegal: (effect) => legalTarget(input.snapshot, eventOwner.unitId, input.event.targetUnitId, effect),
            });
          }
        }
        if (instance.abyssAffix !== null) {
          const roll = instance.abyssAffix;
          const affix = strictGetter(options.content.getEquipmentAffix, roll.affixId, `equipmentAffixes.${roll.affixId}`);
          if (!affix.ok) return affix;
          if (affix.value.pool !== "abyss") return invalid(`equipment.${instanceId}.abyssAffix`, "pool_mismatch");
          for (const modifier of affix.value.modifiers) {
            if (modifier.kind !== "trigger") continue;
            const definition = rootDefinition(root.affixTriggers, modifier.triggerId, `affixTriggers.${modifier.triggerId}`);
            if (!definition.ok) return definition;
            equipmentSources.push({
              affixId: affix.value.id,
              ownerUnitId: eventOwner.unitId,
              ownerFaction: eventOwner.faction,
              ownerSlot: eventOwner.slot,
              equipmentSlot: slot,
              sourceInstanceId: instance.instanceId,
              sourceRollIndex: "abyss",
              affixRoll: roll.roll,
              definition: definition.value,
              trigger: definition.value.trigger,
              effects: definition.value.effects,
              budget: definition.value.budget,
              sourceAlive: () => isAlive(unitById(input.snapshot, eventOwner.unitId)),
              targetLegal: (effect) => legalTarget(input.snapshot, eventOwner.unitId, input.event.targetUnitId, effect),
            });
          }
        }
      }

      const personalMatch = matcher.matchPersonal({ character, inventory: options.save.inventory, comboIds });
      if (!personalMatch.ok) return personalMatch;
      const partyMatch = matcher.matchParty({ party: options.save.party, characters: options.save.characters, inventory: options.save.inventory, comboIds });
      if (!partyMatch.ok) return partyMatch;
      const personalCombos = personalMatch.value.matchedComboIds.map((comboId) => {
        const combo = rootDefinition(root.combos, comboId, `combos.${comboId}`);
        if (!combo.ok) return combo;
        return success({
          combo: combo.value,
          ownerUnitId: eventOwner.unitId,
          ownerFaction: eventOwner.faction,
          ownerSlot: eventOwner.slot,
          sourceAlive: () => isAlive(unitById(input.snapshot, eventOwner.unitId)),
          targetLegal: (effect: EffectSpec) => legalTarget(input.snapshot, eventOwner.unitId, input.event.targetUnitId, effect),
          consumeTargetStatus: combo.value.trigger.consumeTargetStatus
            ? () => consumeStatusEvent(input.snapshot as BattleSnapshotV1, input.event, combo.value.trigger.consumeTargetStatus!.statusId, combo.value.trigger.consumeTargetStatus!.stacks, input.nextEventId)
            : undefined,
        });
      });
      const personalResult = personalCombos.find((value) => !value.ok);
      if (personalResult && !personalResult.ok) return personalResult;
      const partyCombos = partyMatch.value.matchedComboIds.map((comboId) => {
        const combo = rootDefinition(root.combos, comboId, `combos.${comboId}`);
        if (!combo.ok) return combo;
        return success({
          combo: combo.value,
          ownerUnitId: eventOwner.unitId,
          ownerFaction: eventOwner.faction,
          ownerSlot: eventOwner.slot,
          sourceAlive: () => isAlive(unitById(input.snapshot, eventOwner.unitId)),
          targetLegal: (effect: EffectSpec) => legalTarget(input.snapshot, eventOwner.unitId, input.event.targetUnitId, effect),
          consumeTargetStatus: combo.value.trigger.consumeTargetStatus
            ? () => consumeStatusEvent(input.snapshot as BattleSnapshotV1, input.event, combo.value.trigger.consumeTargetStatus!.statusId, combo.value.trigger.consumeTargetStatus!.stacks, input.nextEventId)
            : undefined,
        });
      });
      const partyResult = partyCombos.find((value) => !value.ok);
      if (partyResult && !partyResult.ok) return partyResult;
      const runtime = new ComboTriggerRuntime({ rng: SeededRng.fromState([1, 2, 3, 4]) });
      // 仅借用候选收集器；chance/预算由 ActionResolver 为本根创建的同一队列处理。
      return success(runtime.collectCandidates({
        event: input.event,
        equipment: equipmentSources,
        personalCombos: personalCombos.filter((value): value is Extract<typeof value, { ok: true }> => value.ok).map((value) => value.value),
        partyCombos: partyCombos.filter((value): value is Extract<typeof value, { ok: true }> => value.ok).map((value) => value.value),
      }));
    },
  };
  return success(adapter);
}
