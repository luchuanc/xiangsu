/**
 * 城镇装备操作领域服务。
 *
 * 换装、卸装和分解都只产生新的 GameSave 快照，并通过调用方注入的
 * revision/CAS 保存回调提交；服务本身不直接修改传入对象，也不猜测内容字段。
 */
import type {
  CharacterDefinition,
  CharacterId,
  EquipmentAffixDefinition,
  EquipmentBaseDefinition,
  EquipmentInstance,
  EquipmentSlot,
  EquipmentQuality,
  EconomyDefinition,
  GameSaveV1,
  InstanceId,
  ModifierSpec,
  SkillDefinition,
  SkillAffixDefinition,
  SkillStoneInstance,
  StatBlock,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import type { StatModifierInput } from "../character/StatCalculator";

export interface EquipmentServiceContent {
  readonly equipmentBases: readonly EquipmentBaseDefinition[];
  readonly equipmentAffixes: readonly EquipmentAffixDefinition[];
  readonly economy: Readonly<EconomyDefinition>;
  readonly characters?: readonly CharacterDefinition[];
  readonly getCharacter?: (id: CharacterId) => DomainResult<Readonly<CharacterDefinition>>;
  /** 仅用于静态 maxHp 的固定被动解析；不提供时保持旧调用方的显式装备口径。 */
  readonly skills?: readonly SkillDefinition[];
  readonly getSkill?: (id: string) => DomainResult<Readonly<SkillDefinition>>;
  readonly skillAffixes?: readonly SkillAffixDefinition[];
}

export interface EquipmentMutationOptions {
  readonly expectedRevision: number;
  readonly save: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
  /** 由应用层注入已经核定的静态 maxHp；未提供时服务按显式内容计算。 */
  readonly staticMaxHp?: (save: GameSaveV1, characterId: CharacterId) => DomainResult<number>;
}

export interface EquipCommand {
  readonly characterId: CharacterId;
  readonly instanceId: InstanceId;
  readonly slot?: EquipmentSlot;
}

export interface DisassembleResult {
  readonly save: GameSaveV1;
  readonly materialItemId: string;
  readonly quantity: number;
}

type SkillStoneLike = Pick<SkillStoneInstance, "affixes" | "abyssAffix">;

const EQUIPMENT_SLOT_ORDER: readonly EquipmentSlot[] = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"];

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function notInTown(): DomainResult<never> {
  return failure(createDomainError("NOT_IN_TOWN", null));
}

function validateOptions(options: EquipmentMutationOptions): DomainResult<true> {
  if (!options || typeof options !== "object") return invalid("options", "not_object");
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) return invalid("options.expectedRevision", "revision");
  if (typeof options.save !== "function") return invalid("options.save", "transaction_required");
  return success(true);
}

function validateTown(save: GameSaveV1): DomainResult<true> {
  if (!isRecord(save)) return invalid("save", "not_object");
  if (save.expedition !== null || save.battle !== null) return notInTown();
  return success(true);
}

function contentBase(content: EquipmentServiceContent, instance: EquipmentInstance): DomainResult<EquipmentBaseDefinition> {
  if (!Array.isArray(content.equipmentBases)) return invalid("equipmentBases", "array_required");
  const base = content.equipmentBases.find((value) => value.id === instance.baseId);
  return base ? success(base) : invalid(`equipmentBases.${instance.baseId}`, "missing_content");
}

function contentAffix(content: EquipmentServiceContent, affixId: string): DomainResult<EquipmentAffixDefinition> {
  if (!Array.isArray(content.equipmentAffixes)) return invalid("equipmentAffixes", "array_required");
  const affix = content.equipmentAffixes.find((value) => value.id === affixId);
  return affix ? success(affix) : invalid(`equipmentAffixes.${affixId}`, "missing_content");
}

function findEquipment(save: GameSaveV1, instanceId: InstanceId): EquipmentInstance | undefined {
  return save.inventory.equipment.find((value) => value.instanceId === instanceId);
}

function isEquipmentEquipped(save: GameSaveV1, instanceId: InstanceId, exceptCharacterId?: CharacterId, exceptSlot?: EquipmentSlot): boolean {
  return Object.values(save.characters).some((progress) => Object.entries(progress.equipmentBySlot).some(([slot, value]) => value === instanceId && !(progress.characterId === exceptCharacterId && slot === exceptSlot)));
}

function getCharacter(content: EquipmentServiceContent, characterId: CharacterId): DomainResult<CharacterDefinition> {
  if (typeof content.getCharacter === "function") {
    try {
      const result = content.getCharacter(characterId);
      if (!result.ok) return result;
      return result.value.id === characterId
        ? success(result.value)
        : invalid(`characters.${characterId}`, "character_id_mismatch");
    } catch {
      return invalid(`characters.${characterId}`, "getter_failed");
    }
  }
  const character = content.characters?.find((value) => value.id === characterId);
  return character ? success(character) : invalid(`characters.${characterId}`, "missing_content");
}

function validateAffixConflicts(
  content: EquipmentServiceContent,
  instances: readonly EquipmentInstance[],
  skillStones: readonly SkillStoneLike[] = [],
): DomainResult<true> {
  const groups = new Map<string, string[]>();
  for (const instance of instances) {
    for (const roll of [...instance.affixes, ...(instance.abyssAffix === null ? [] : [instance.abyssAffix])]) {
      const definition = contentAffix(content, roll.affixId);
      if (!definition.ok) return definition;
      if (definition.value.exclusiveGroup === null) continue;
      const ids = groups.get(definition.value.exclusiveGroup) ?? [];
      ids.push(roll.affixId);
      groups.set(definition.value.exclusiveGroup, ids);
    }
  }
  for (const instance of skillStones) {
    for (const roll of [...instance.affixes, ...(instance.abyssAffix === null ? [] : [instance.abyssAffix])]) {
      const definition = content.skillAffixes?.find((value) => value.id === roll.skillAffixId);
      if (!definition) return invalid(`skillAffixes.${roll.skillAffixId}`, "missing_content");
      if (definition.exclusiveGroup === null) continue;
      const ids = groups.get(definition.exclusiveGroup) ?? [];
      ids.push(roll.skillAffixId);
      groups.set(definition.exclusiveGroup, ids);
    }
  }
  for (const [exclusiveGroup, sourceIds] of groups) {
    if (sourceIds.length > 1) return failure(createDomainError("AFFIX_CONFLICT", { exclusiveGroup, sourceIds }));
  }
  return success(true);
}

function modifierValue(roll: number, craftEmpowered: boolean, scale: number): number {
  const effective = craftEmpowered ? Math.floor((roll * 12_500) / 10_000) : roll;
  return Math.floor((effective * scale) / 10_000);
}

function addMaxHpFromModifier(maxHp: number, modifier: ModifierSpec, roll: number, craftEmpowered: boolean): { maxHp: number; percentBps: number } {
  if (modifier.kind === "flatStat" && modifier.stat === "maxHp") return { maxHp: maxHp + modifierValue(roll, craftEmpowered, modifier.rollScaleBps), percentBps: 0 };
  if (modifier.kind === "percentStat" && modifier.stat === "maxHp") return { maxHp, percentBps: modifierValue(roll, craftEmpowered, modifier.rollScaleBps) };
  return { maxHp, percentBps: 0 };
}

/**
 * 计算已装备底材和无条件基础词条对八项战斗属性的贡献。
 *
 * damage/healing/trigger/conditional 等战斗期效果不在此处猜测映射，
 * 只把合同明确的 flatStat、percentStat 写入 StatModifierInput。
 */
export function calculateEquipmentStatModifiers(
  content: EquipmentServiceContent,
  save: GameSaveV1,
  characterId: CharacterId,
): DomainResult<StatModifierInput> {
  const progress = save.characters[characterId];
  if (!progress) return invalid(`characters.${characterId}`, "missing_progress");
  if (!Array.isArray(content.equipmentBases)) return invalid("equipmentBases", "array_required");
  if (!Array.isArray(content.equipmentAffixes)) return invalid("equipmentAffixes", "array_required");
  const flat: Partial<Record<keyof StatBlock, number>> = {};
  const percentBps: Partial<Record<keyof StatBlock, number>> = {};
  const addFlat = (stat: keyof StatBlock, value: number): void => {
    flat[stat] = (flat[stat] ?? 0) + value;
  };
  const addPercent = (stat: keyof StatBlock, value: number): void => {
    percentBps[stat] = (percentBps[stat] ?? 0) + value;
  };
  for (const slot of EQUIPMENT_SLOT_ORDER) {
    const instanceId = progress.equipmentBySlot[slot];
    if (instanceId === null) continue;
    const instance = findEquipment(save, instanceId);
    if (!instance) return invalid(`characters.${characterId}.equipmentBySlot.${slot}`, "missing_equipment_instance");
    const base = contentBase(content, instance);
    if (!base.ok) return base;
    const baseValue = base.value.baseValueAtMinLevel + base.value.growthPerItemLevel * (instance.itemLevel - base.value.minItemLevel);
    if (!Number.isSafeInteger(baseValue)) return invalid(`equipmentBases.${base.value.id}`, "base_value_overflow");
    addFlat(base.value.baseStat, baseValue);
    const rolls = instance.abyssAffix === null ? instance.affixes : [...instance.affixes, instance.abyssAffix];
    for (const roll of rolls) {
      const definition = contentAffix(content, roll.affixId);
      if (!definition.ok) return definition;
      for (const modifier of definition.value.modifiers) {
        if (modifier.kind !== "flatStat" && modifier.kind !== "percentStat") continue;
        const value = modifierValue(roll.roll, roll.craftEmpowered, modifier.rollScaleBps);
        if (!Number.isSafeInteger(value)) return invalid(`equipmentAffixes.${definition.value.id}.modifiers`, "modifier_value_overflow");
        if (modifier.kind === "flatStat") addFlat(modifier.stat, value);
        else addPercent(modifier.stat, value);
      }
    }
  }
  return success({ flat, percentBps });
}

function contentPassiveSkill(content: EquipmentServiceContent, character: CharacterDefinition): DomainResult<Readonly<SkillDefinition> | null> {
  if (typeof content.getSkill === "function") {
    try {
      const result = content.getSkill(character.passiveSkillId);
      if (!result.ok) return result;
      return result.value.id === character.passiveSkillId
        ? success(result.value)
        : invalid(`skills.${character.passiveSkillId}`, "skill_id_mismatch");
    } catch {
      return invalid(`skills.${character.passiveSkillId}`, "getter_failed");
    }
  }
  if (content.skills === undefined) return success(null);
  const skill = content.skills.find((value) => value.id === character.passiveSkillId);
  return skill ? success(skill) : invalid(`skills.${character.passiveSkillId}`, "missing_content");
}

/** 按当前角色等级、已装备底材和词条计算战后使用的静态最大生命。 */
export function calculateStaticMaxHp(content: EquipmentServiceContent, save: GameSaveV1, characterId: CharacterId): DomainResult<number> {
  const progress = save.characters[characterId];
  if (!progress) return invalid(`characters.${characterId}`, "missing_progress");
  const characterResult = getCharacter(content, characterId);
  if (!characterResult.ok) return characterResult;
  const character = characterResult.value;
  let maxHp = character.baseStats.maxHp + character.growthPerLevel.maxHp * (progress.level - 1);
  let percentBps = 0;
  const passiveResult = contentPassiveSkill(content, character);
  if (!passiveResult.ok) return passiveResult;
  for (const modifier of passiveResult.value?.passiveModifiers ?? []) {
    if (modifier.kind === "flatStat" && modifier.stat === "maxHp") maxHp += modifier.value;
    if (modifier.kind === "percentStat" && modifier.stat === "maxHp") percentBps += modifier.valueBps;
  }
  for (const slot of EQUIPMENT_SLOT_ORDER) {
    const id = progress.equipmentBySlot[slot];
    if (id === null) continue;
    const instance = findEquipment(save, id);
    if (!instance) return invalid(`characters.${characterId}.equipmentBySlot.${slot}`, "missing_equipment_instance");
    const base = contentBase(content, instance);
    if (!base.ok) return base;
    if (base.value.baseStat === "maxHp") maxHp += base.value.baseValueAtMinLevel + base.value.growthPerItemLevel * (instance.itemLevel - base.value.minItemLevel);
    for (const roll of [...instance.affixes, ...(instance.abyssAffix === null ? [] : [instance.abyssAffix])]) {
      const definition = contentAffix(content, roll.affixId);
      if (!definition.ok) return definition;
      for (const modifier of definition.value.modifiers) {
        const contribution = addMaxHpFromModifier(maxHp, modifier, roll.roll, roll.craftEmpowered);
        maxHp = contribution.maxHp;
        percentBps += contribution.percentBps;
      }
    }
  }
  return success(Math.max(1, Math.floor((maxHp * (10_000 + percentBps)) / 10_000)));
}

function clampCurrentHp(content: EquipmentServiceContent, save: GameSaveV1, characterId: CharacterId, staticMaxHp?: EquipmentMutationOptions["staticMaxHp"]): DomainResult<true> {
  let maxHp: DomainResult<number>;
  try {
    maxHp = staticMaxHp ? staticMaxHp(save, characterId) : calculateStaticMaxHp(content, save, characterId);
  } catch {
    return invalid(`characters.${characterId}`, "max_hp_getter_failed");
  }
  if (!maxHp.ok) return maxHp;
  if (!Number.isSafeInteger(maxHp.value) || maxHp.value < 1) return invalid(`characters.${characterId}`, "max_hp_range");
  const progress = save.characters[characterId];
  if (!progress) return invalid(`characters.${characterId}`, "missing_progress");
  progress.currentHp = Math.min(progress.currentHp, maxHp.value);
  return success(true);
}

function commitSave(
  nextSave: GameSaveV1,
  options: EquipmentMutationOptions,
): Promise<DomainResult<GameSaveV1>> {
  return Promise.resolve().then(() => options.save(options.expectedRevision, nextSave)).catch(() => failure(createDomainError("SAVE_FAILED", { operation: "save" })));
}

/** 校验一个角色当前六部位的互斥组，供装备预览和提交共同使用。 */
export function validateEquipmentLoadout(
  content: EquipmentServiceContent,
  save: GameSaveV1,
  characterId: CharacterId,
  equipmentBySlot: Readonly<Record<EquipmentSlot, InstanceId | null>>,
): DomainResult<true> {
  const progress = save.characters[characterId];
  if (!progress) return invalid(`characters.${characterId}`, "missing_progress");
  const instances: EquipmentInstance[] = [];
  for (const slot of EQUIPMENT_SLOT_ORDER) {
    const id = equipmentBySlot[slot];
    if (id === null) continue;
    const instance = findEquipment(save, id);
    if (!instance) return invalid(`characters.${characterId}.equipmentBySlot.${slot}`, "missing_equipment_instance");
    instances.push(instance);
  }
  const stones: SkillStoneLike[] = [];
  if (progress.skillStoneInstanceId !== null) {
    const stone = save.inventory.skillStones.find((value) => value.instanceId === progress.skillStoneInstanceId);
    if (!stone) return invalid(`characters.${characterId}.skillStoneInstanceId`, "missing_skill_stone_instance");
    stones.push(stone);
  }
  return validateAffixConflicts(content, instances, stones);
}

export class EquipmentService {
  private readonly content: EquipmentServiceContent;

  public constructor(content: EquipmentServiceContent) {
    this.content = content;
  }

  public async equip(save: GameSaveV1, command: EquipCommand, options: EquipmentMutationOptions): Promise<DomainResult<GameSaveV1>> {
    const optionResult = validateOptions(options);
    if (!optionResult.ok) return optionResult;
    const town = validateTown(save);
    if (!town.ok) return town;
    const progress = save.characters[command.characterId];
    if (!progress || progress.recruited !== true) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: command.instanceId, itemId: null }));
    const instance = findEquipment(save, command.instanceId);
    if (!instance) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: command.instanceId, itemId: null }));
    const base = contentBase(this.content, instance);
    if (!base.ok) return base;
    const slot = command.slot ?? base.value.slot;
    if (!EQUIPMENT_SLOT_ORDER.includes(slot) || slot !== base.value.slot) return invalid(`equipment.${instance.instanceId}`, "slot_mismatch");
    if (slot === "weapon") {
      const character = getCharacter(this.content, command.characterId);
      if (!character.ok) return character;
      const weaponType = base.value.weaponType;
      if (weaponType === null) return invalid(`equipmentBases.${base.value.id}.weaponType`, "weapon_type_required");
      if (!character.value.allowedWeaponTypes.includes(weaponType)) return failure(createDomainError("WEAPON_NOT_ALLOWED", { characterId: command.characterId, weaponType }));
    }
    if (isEquipmentEquipped(save, command.instanceId, command.characterId, slot)) return failure(createDomainError("ITEM_EQUIPPED", { instanceId: command.instanceId }));
    const nextSave = clone(save);
    nextSave.characters[command.characterId].equipmentBySlot[slot] = command.instanceId;
    const conflict = validateEquipmentLoadout(this.content, nextSave, command.characterId, nextSave.characters[command.characterId].equipmentBySlot);
    if (!conflict.ok) return conflict;
    const clamped = clampCurrentHp(this.content, nextSave, command.characterId, options.staticMaxHp);
    if (!clamped.ok) return clamped;
    return commitSave(nextSave, options);
  }

  public async unequip(save: GameSaveV1, characterId: CharacterId, slot: EquipmentSlot, options: EquipmentMutationOptions): Promise<DomainResult<GameSaveV1>> {
    const optionResult = validateOptions(options);
    if (!optionResult.ok) return optionResult;
    const town = validateTown(save);
    if (!town.ok) return town;
    if (!EQUIPMENT_SLOT_ORDER.includes(slot)) return invalid(`equipmentBySlot.${slot}`, "unknown_slot");
    const progress = save.characters[characterId];
    if (!progress || progress.recruited !== true) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: null }));
    if (progress.equipmentBySlot[slot] === null) return success(clone(save));
    const nextSave = clone(save);
    nextSave.characters[characterId].equipmentBySlot[slot] = null;
    const clamped = clampCurrentHp(this.content, nextSave, characterId, options.staticMaxHp);
    if (!clamped.ok) return clamped;
    return commitSave(nextSave, options);
  }

  public async disassemble(save: GameSaveV1, instanceId: InstanceId, options: EquipmentMutationOptions): Promise<DomainResult<DisassembleResult>> {
    const optionResult = validateOptions(options);
    if (!optionResult.ok) return optionResult;
    const town = validateTown(save);
    if (!town.ok) return town;
    const index = save.inventory.equipment.findIndex((value) => value.instanceId === instanceId);
    if (index < 0) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId, itemId: null }));
    const instance = save.inventory.equipment[index];
    if (instance.locked) return failure(createDomainError("ITEM_LOCKED", { instanceId }));
    if (isEquipmentEquipped(save, instanceId)) return failure(createDomainError("ITEM_EQUIPPED", { instanceId }));
    const quantity = this.content.economy.equipmentDisassembleYieldByQuality[instance.quality as EquipmentQuality];
    const materialItemId = this.content.economy.equipmentDisassembleMaterialItemId;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || typeof materialItemId !== "string") return invalid("economy", "disassemble_config");
    const owned = save.inventory.stackables[materialItemId] ?? 0;
    if (owned > 9999 - quantity) return failure(createDomainError("STACKABLE_CAP_EXCEEDED", { itemId: materialItemId, cap: 9999, owned, requested: quantity }));
    const nextSave = clone(save);
    nextSave.inventory.equipment.splice(index, 1);
    nextSave.inventory.stackables[materialItemId] = owned + quantity;
    const committed = await commitSave(nextSave, options);
    if (!committed.ok) return committed;
    return success({ save: committed.value, materialItemId, quantity });
  }

  public async disassembleEquipment(save: GameSaveV1, instanceId: InstanceId, options: EquipmentMutationOptions): Promise<DomainResult<DisassembleResult>> {
    return this.disassemble(save, instanceId, options);
  }
}
