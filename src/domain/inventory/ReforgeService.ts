/**
 * 单普通词条槽重铸。
 *
 * 预览 RNG 由 contentVersion、实例 ID、槽位和次数通过 FNV namespace 派生，
 * 不读取远征或全局 RNG。只有确认阶段才扣除材料并递增 reforgeCount。
 */
import type {
  ConfirmReforgeCommandV1,
  EquipmentAffixDefinition,
  EquipmentAffixRoll,
  EquipmentBaseDefinition,
  EquipmentInstance,
  GameSaveV1,
  InstanceId,
  OpenReforgePreviewCommandV1,
  ReforgeCandidateV1,
  ReforgePreviewV1,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import { fnv1a32, SeededRng } from "../common/SeededRng";
import type { EquipmentServiceContent } from "./EquipmentService";

export const REFORGE_CONTENT_VERSION = "content-1.2.0" as const;

export interface ReforgeCommitOptions {
  readonly save: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
}

export interface OpenReforgeResult {
  readonly save: GameSaveV1;
  readonly preview: ReforgePreviewV1;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stale(expectedRevision: number, actualRevision: number): DomainResult<never> {
  return failure(createDomainError("STALE_REVISION", { expectedRevision, actualRevision }));
}

function nonReforgeable(instanceId: InstanceId, reason: "ABYSS_SLOT" | "WRONG_LOCKED_INDEX" | "LOCKED_ITEM" | "EQUIPPED_ITEM"): DomainResult<never> {
  return failure(createDomainError("AFFIX_NOT_REFORGEABLE", { instanceId, reason }));
}

function isTown(save: GameSaveV1): DomainResult<true> {
  if (save.expedition !== null || save.battle !== null) return failure(createDomainError("NOT_IN_TOWN", null));
  return success(true);
}

function findEquipment(save: GameSaveV1, instanceId: InstanceId): EquipmentInstance | undefined {
  return save.inventory.equipment.find((value) => value.instanceId === instanceId);
}

function equipped(save: GameSaveV1, instanceId: InstanceId): boolean {
  return Object.values(save.characters).some((progress) => Object.values(progress.equipmentBySlot).includes(instanceId));
}

function getBase(content: EquipmentServiceContent, instance: EquipmentInstance): DomainResult<EquipmentBaseDefinition> {
  const base = content.equipmentBases.find((value) => value.id === instance.baseId);
  return base ? success(base) : invalid(`equipmentBases.${instance.baseId}`, "missing_content");
}

function getTier(affix: EquipmentAffixDefinition, itemLevel: number): EquipmentAffixDefinition["tiers"][number] | null {
  return affix.tiers.filter((tier) => tier.minItemLevel <= itemLevel).sort((left, right) => right.minItemLevel - left.minItemLevel)[0] ?? null;
}

function candidateDefinitions(
  content: EquipmentServiceContent,
  instance: EquipmentInstance,
  base: EquipmentBaseDefinition,
  lockedIndex: number,
): DomainResult<EquipmentAffixDefinition[]> {
  const old = instance.affixes[lockedIndex];
  if (!old) return nonReforgeable(instance.instanceId, "WRONG_LOCKED_INDEX");
  const otherRolls = instance.affixes.filter((_, index) => index !== lockedIndex);
  const excludedIds = new Set(otherRolls.map((roll) => roll.affixId));
  excludedIds.add(old.affixId);
  const excludedGroups = new Set<string>();
  for (const roll of otherRolls) {
    const definition = content.equipmentAffixes.find((value) => value.id === roll.affixId);
    if (!definition) return invalid(`equipmentAffixes.${roll.affixId}`, "missing_content");
    if (definition.exclusiveGroup !== null) excludedGroups.add(definition.exclusiveGroup);
  }
  const oldDefinition = content.equipmentAffixes.find((value) => value.id === old.affixId);
  if (!oldDefinition) return invalid(`equipmentAffixes.${old.affixId}`, "missing_content");
  // 旧槽已被暂时移除；同一互斥组的其它词条可以作为替代，
  // 但其它槽位的互斥组仍然必须排除。
  const craftOnly = old.craftEmpowered;
  const values = content.equipmentAffixes.filter((definition) => {
    if (definition.pool !== "normal" || excludedIds.has(definition.id)) return false;
    if (!definition.allowedSlots.includes(base.slot)) return false;
    if (definition.allowedWeaponTypes.length > 0 && (base.weaponType === null || !definition.allowedWeaponTypes.includes(base.weaponType))) return false;
    if (!definition.allowedQualities.includes(instance.quality) || definition.minItemLevel > instance.itemLevel) return false;
    if (definition.exclusiveGroup !== null && excludedGroups.has(definition.exclusiveGroup)) return false;
    if (getTier(definition, instance.itemLevel) === null) return false;
    if (craftOnly && (!definition.canBeCraftEmpowered || definition.category === "mechanic")) return false;
    return true;
  });
  return success(values);
}

function createCandidateRoll(
  definition: EquipmentAffixDefinition,
  instance: EquipmentInstance,
  rng: SeededRng,
  craftEmpowered: boolean,
): DomainResult<EquipmentAffixRoll> {
  const tier = getTier(definition, instance.itemLevel);
  if (!tier) return invalid(`equipmentAffixes.${definition.id}.tiers`, "no_eligible_tier");
  try {
    return success({
      affixId: definition.id,
      tier: tier.tier,
      roll: rng.nextIntInclusive(tier.rollMin, tier.rollMax),
      craftEmpowered,
      reforged: true,
    });
  } catch {
    return invalid(`equipmentAffixes.${definition.id}.tiers.${tier.tier}`, "roll_range");
  }
}

function deriveCandidates(
  content: EquipmentServiceContent,
  instance: EquipmentInstance,
  lockedIndex: number,
): DomainResult<readonly ReforgeCandidateV1[]> {
  const base = getBase(content, instance);
  if (!base.ok) return base;
  const definitions = candidateDefinitions(content, instance, base.value, lockedIndex);
  if (!definitions.ok) return definitions;
  if (definitions.value.length === 0) return failure(createDomainError("AFFIX_POOL_EMPTY", { poolKind: "equipmentNormal", itemLevel: instance.itemLevel }));
  const namespace = `reforge:equipment:${REFORGE_CONTENT_VERSION}:${instance.instanceId}:${lockedIndex}:${instance.reforgeCount}`;
  const rng = SeededRng.fromSeed(fnv1a32(new TextEncoder().encode(namespace)));
  const remaining = [...definitions.value];
  const candidates: ReforgeCandidateV1[] = [];
  const old = instance.affixes[lockedIndex];
  if (!old) return nonReforgeable(instance.instanceId, "WRONG_LOCKED_INDEX");
  while (remaining.length > 0 && candidates.length < 3) {
    let selectedIndex: number;
    try {
      const selected = rng.pickWeighted(remaining.map((definition) => ({ value: definition, weight: definition.weight })));
      selectedIndex = remaining.indexOf(selected);
    } catch {
      return invalid("equipment.reforge", "invalid_weight");
    }
    const definition = remaining[selectedIndex];
    const roll = createCandidateRoll(definition, instance, rng, old.craftEmpowered);
    if (!roll.ok) return roll;
    candidates.push({ candidateIndex: candidates.length as 0 | 1 | 2, kind: "equipment", roll: roll.value });
    remaining.splice(selectedIndex, 1);
  }
  return success(candidates);
}

function validateCommand(command: OpenReforgePreviewCommandV1 | ConfirmReforgeCommandV1): DomainResult<true> {
  if (!command || typeof command !== "object") return invalid("reforge.command", "not_object");
  if (!Number.isSafeInteger(command.expectedSaveRevision) || command.expectedSaveRevision < 0) return invalid("reforge.expectedSaveRevision", "revision");
  if (command.itemKind !== "equipment") return invalid("reforge.itemKind", "equipment_only");
  if (typeof command.instanceId !== "string" || command.instanceId.length === 0) return invalid("reforge.instanceId", "empty_id");
  return success(true);
}

function resolveInstance(
  save: GameSaveV1,
  instanceId: InstanceId,
  requestedIndex: number,
): DomainResult<{ instance: EquipmentInstance; lockedIndex: number }> {
  const instance = findEquipment(save, instanceId);
  if (!instance) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId, itemId: null }));
  if (instance.locked) return nonReforgeable(instanceId, "LOCKED_ITEM");
  if (equipped(save, instanceId)) return nonReforgeable(instanceId, "EQUIPPED_ITEM");
  if (!Number.isSafeInteger(requestedIndex)) return nonReforgeable(instanceId, "WRONG_LOCKED_INDEX");
  if (requestedIndex >= instance.affixes.length && requestedIndex === instance.affixes.length && instance.abyssAffix !== null) return nonReforgeable(instanceId, "ABYSS_SLOT");
  const lockedIndex = instance.reforgeLockedIndex ?? requestedIndex;
  if (lockedIndex < 0 || lockedIndex >= instance.affixes.length) return nonReforgeable(instanceId, "WRONG_LOCKED_INDEX");
  if (instance.reforgeLockedIndex !== null && requestedIndex !== instance.reforgeLockedIndex) return nonReforgeable(instanceId, "WRONG_LOCKED_INDEX");
  return success({ instance, lockedIndex });
}

function buildPreview(content: EquipmentServiceContent, instance: EquipmentInstance, lockedIndex: number): DomainResult<ReforgePreviewV1> {
  const candidates = deriveCandidates(content, instance, lockedIndex);
  if (!candidates.ok) return candidates;
  const costItemId = "item_forge_shard" as const;
  const costQuantity = content.economy.equipmentReforgeBaseCost + instance.itemLevel * content.economy.equipmentReforgePerItemLevelCost;
  if (!Number.isSafeInteger(costQuantity) || costQuantity < 0) return invalid("economy.equipmentReforge", "cost");
  return success({
    contentVersion: REFORGE_CONTENT_VERSION,
    itemKind: "equipment",
    instanceId: instance.instanceId,
    lockedIndex,
    reforgeCount: instance.reforgeCount,
    costItemId,
    costQuantity,
    candidates: [...candidates.value],
  });
}

async function commit(
  options: ReforgeCommitOptions,
  expectedRevision: number,
  nextSave: GameSaveV1,
): Promise<DomainResult<GameSaveV1>> {
  try {
    return await options.save(expectedRevision, nextSave);
  } catch {
    return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
  }
}

export function previewReforge(
  content: EquipmentServiceContent,
  save: GameSaveV1,
  command: OpenReforgePreviewCommandV1,
): DomainResult<ReforgePreviewV1> {
  const commandResult = validateCommand(command);
  if (!commandResult.ok) return commandResult;
  if (command.expectedSaveRevision !== save.revision) return stale(command.expectedSaveRevision, save.revision);
  const town = isTown(save);
  if (!town.ok) return town;
  const resolved = resolveInstance(save, command.instanceId, command.requestedIndex);
  if (!resolved.ok) return resolved;
  return buildPreview(content, resolved.value.instance, resolved.value.lockedIndex);
}

export class ReforgeService {
  private readonly content: EquipmentServiceContent;

  public constructor(content: EquipmentServiceContent) {
    this.content = content;
  }

  /** 首次打开写入锁定槽；重复打开只重新返回同一稳定预览，不重复保存。 */
  public async open(save: GameSaveV1, command: OpenReforgePreviewCommandV1, options: ReforgeCommitOptions): Promise<DomainResult<OpenReforgeResult>> {
    const preview = previewReforge(this.content, save, command);
    if (!preview.ok) return preview;
    const resolved = resolveInstance(save, command.instanceId, command.requestedIndex);
    if (!resolved.ok) return resolved;
    if (resolved.value.instance.reforgeLockedIndex !== null) return success({ save: clone(save), preview: preview.value });
    const nextSave = clone(save);
    const target = findEquipment(nextSave, command.instanceId);
    if (!target) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: command.instanceId, itemId: null }));
    target.reforgeLockedIndex = preview.value.lockedIndex;
    const committed = await commit(options, command.expectedSaveRevision, nextSave);
    if (!committed.ok) return committed;
    return success({ save: committed.value, preview: preview.value });
  }

  public preview(save: GameSaveV1, command: OpenReforgePreviewCommandV1): DomainResult<ReforgePreviewV1> {
    return previewReforge(this.content, save, command);
  }

  public async confirm(save: GameSaveV1, command: ConfirmReforgeCommandV1, options: ReforgeCommitOptions): Promise<DomainResult<GameSaveV1>> {
    const commandResult = validateCommand(command);
    if (!commandResult.ok) return commandResult;
    if (command.expectedSaveRevision !== save.revision) return stale(command.expectedSaveRevision, save.revision);
    const town = isTown(save);
    if (!town.ok) return town;
    const instance = findEquipment(save, command.instanceId);
    if (!instance) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: command.instanceId, itemId: null }));
    if (instance.locked) return nonReforgeable(command.instanceId, "LOCKED_ITEM");
    if (equipped(save, command.instanceId)) return nonReforgeable(command.instanceId, "EQUIPPED_ITEM");
    if (instance.reforgeLockedIndex === null || instance.reforgeLockedIndex !== command.expectedLockedIndex) return nonReforgeable(command.instanceId, "WRONG_LOCKED_INDEX");
    if (instance.reforgeCount !== command.expectedReforgeCount) return failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: command.expectedReforgeCount, actualReforgeCount: instance.reforgeCount }));
    const openCommand: OpenReforgePreviewCommandV1 = {
      expectedSaveRevision: command.expectedSaveRevision,
      itemKind: "equipment",
      instanceId: command.instanceId,
      requestedIndex: command.expectedLockedIndex,
    };
    const preview = previewReforge(this.content, save, openCommand);
    if (!preview.ok) return preview;
    const candidate = preview.value.candidates.find((value) => value.candidateIndex === command.candidateIndex);
    if (!candidate || candidate.kind !== "equipment") return failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: command.expectedReforgeCount, actualReforgeCount: instance.reforgeCount }));
    const owned = save.inventory.stackables[preview.value.costItemId] ?? 0;
    if (owned < preview.value.costQuantity) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: preview.value.costItemId }));
    const nextSave = clone(save);
    const target = findEquipment(nextSave, command.instanceId);
    if (!target) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: command.instanceId, itemId: null }));
    target.affixes[command.expectedLockedIndex] = { ...candidate.roll, reforged: true };
    target.reforgeCount += 1;
    nextSave.inventory.stackables[preview.value.costItemId] = owned - preview.value.costQuantity;
    return commit(options, command.expectedSaveRevision, nextSave);
  }

  public async confirmReforge(save: GameSaveV1, command: ConfirmReforgeCommandV1, options: ReforgeCommitOptions): Promise<DomainResult<GameSaveV1>> {
    return this.confirm(save, command, options);
  }
}
