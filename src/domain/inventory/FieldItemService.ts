/**
 * 野外消耗品事务。
 *
 * 这里故意不复用战斗物品解析：野外首版只接受单一、不可暴击的
 * maxHp 比例治疗，并按固定顺序检查远征、战斗、库存、使用场景和目标。
 */
import type {
  CharacterDefinition,
  CharacterId,
  ConsumableItemDefinition,
  EquipmentAffixDefinition,
  EquipmentBaseDefinition,
  GameSaveV1,
  UseFieldItemCommandV1,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";

export interface FieldItemContentSource {
  getItem(id: string): DomainResult<Readonly<ConsumableItemDefinition | import("../../content/contracts").MaterialItemDefinition>>;
  getCharacter(id: CharacterId): DomainResult<Readonly<CharacterDefinition>>;
  /** 角色装备影响 maxHp 时必须显式提供这两个 getter，不能猜测底材/词条。 */
  getEquipmentBase?(id: string): DomainResult<Readonly<EquipmentBaseDefinition>>;
  getEquipmentAffix?(id: string): DomainResult<Readonly<EquipmentAffixDefinition>>;
}

export interface FieldItemCommitOptions {
  readonly save: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
  /** 平衡夹具或战斗层可注入已核定 maxHp；不传时按角色和装备内容计算。 */
  readonly staticMaxHp?: (save: GameSaveV1, characterId: CharacterId) => DomainResult<number>;
}

export interface FieldItemUseResult {
  readonly save: GameSaveV1;
  readonly healed: number;
  readonly maxHp: number;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stale(expectedRevision: number, actualRevision: number): DomainResult<never> {
  return failure(createDomainError("STALE_REVISION", { expectedRevision, actualRevision }));
}

function forbidden(itemId: string, reason: "NOT_IN_EXPEDITION" | "BATTLE_ACTIVE" | "WRONG_CONTEXT"): DomainResult<never> {
  return failure(createDomainError("ITEM_USE_FORBIDDEN", { itemId, reason }));
}

function invalidTarget(reason: "UNKNOWN" | "DEAD" | "FULL_HP", targetCharacterId: CharacterId): DomainResult<never> {
  return failure(createDomainError("INVALID_TARGET", { reason, targetUnitId: targetCharacterId }));
}

function getOwnedItem(save: GameSaveV1, itemId: string): number {
  return save.inventory.stackables[itemId] ?? 0;
}

function staticMaxHpFromContent(
  content: FieldItemContentSource,
  save: GameSaveV1,
  characterId: CharacterId,
): DomainResult<number> {
  const progress = save.characters[characterId];
  if (!progress) return invalid(`characters.${characterId}`, "missing_progress");
  let characterResult: DomainResult<Readonly<CharacterDefinition>>;
  try {
    characterResult = content.getCharacter(characterId);
  } catch {
    return invalid(`characters.${characterId}`, "getter_failed");
  }
  if (!characterResult.ok) return characterResult;
  if (characterResult.value.id !== characterId) return invalid(`characters.${characterId}`, "character_id_mismatch");
  const level = progress.level;
  if (!Number.isSafeInteger(level) || level < 1 || level > 50) return invalid(`characters.${characterId}.level`, "level_range");

  const character = characterResult.value;
  let maxHp = character.baseStats.maxHp + character.growthPerLevel.maxHp * (level - 1);
  let percentBps = 0;
  const equipmentById = new Map([
    ...save.inventory.equipment,
    ...save.inventory.overflowEquipment,
  ].map((instance) => [instance.instanceId, instance]));
  for (const instanceId of Object.values(progress.equipmentBySlot)) {
    if (instanceId === null) continue;
    const instance = equipmentById.get(instanceId);
    if (!instance) return invalid(`characters.${characterId}.equipmentBySlot`, "missing_equipment_instance");
    if (typeof content.getEquipmentBase !== "function") return invalid("content.getEquipmentBase", "getter_required");
    let baseResult: DomainResult<Readonly<EquipmentBaseDefinition>>;
    try {
      baseResult = content.getEquipmentBase(instance.baseId);
    } catch {
      return invalid(`equipmentBases.${instance.baseId}`, "getter_failed");
    }
    if (!baseResult.ok) return baseResult;
    if (baseResult.value.baseStat === "maxHp") {
      maxHp += baseResult.value.baseValueAtMinLevel
        + baseResult.value.growthPerItemLevel * (instance.itemLevel - baseResult.value.minItemLevel);
    }
    const rolls = instance.abyssAffix === null ? instance.affixes : [...instance.affixes, instance.abyssAffix];
    for (const roll of rolls) {
      if (typeof content.getEquipmentAffix !== "function") return invalid("content.getEquipmentAffix", "getter_required");
      let affixResult: DomainResult<Readonly<EquipmentAffixDefinition>>;
      try {
        affixResult = content.getEquipmentAffix(roll.affixId);
      } catch {
        return invalid(`equipmentAffixes.${roll.affixId}`, "getter_failed");
      }
      if (!affixResult.ok) return affixResult;
      const effectiveRoll = roll.craftEmpowered ? Math.floor((roll.roll * 12_500) / 10_000) : roll.roll;
      for (const modifier of affixResult.value.modifiers) {
        if (modifier.kind === "flatStat" && modifier.stat === "maxHp") {
          maxHp += Math.floor((effectiveRoll * modifier.rollScaleBps) / 10_000);
        } else if (modifier.kind === "percentStat" && modifier.stat === "maxHp") {
          percentBps += Math.floor((effectiveRoll * modifier.rollScaleBps) / 10_000);
        }
      }
    }
  }
  if (!Number.isSafeInteger(maxHp) || maxHp < 1) return invalid(`characters.${characterId}`, "max_hp_range");
  return success(Math.max(1, Math.floor((maxHp * (10_000 + percentBps)) / 10_000)));
}

function resolveHeal(item: ConsumableItemDefinition, itemId: string): DomainResult<number> {
  if (item.category !== "consumable") return forbidden(itemId, "WRONG_CONTEXT");
  if (!item.useContexts.includes("field")) return forbidden(itemId, "WRONG_CONTEXT");
  if (!Array.isArray(item.effects) || item.effects.length !== 1) return forbidden(itemId, "WRONG_CONTEXT");
  const effect = item.effects[0];
  if (effect.kind !== "heal"
    || effect.targetRule !== "singleAlly"
    || effect.scalingStat !== "maxHp"
    || effect.canCrit
    || effect.flatPower !== 0
    || !Number.isSafeInteger(effect.powerBps)
    || effect.powerBps <= 0
    || effect.powerBps > 10_000) {
    return forbidden(itemId, "WRONG_CONTEXT");
  }
  return success(effect.powerBps);
}

function validateCommand(command: UseFieldItemCommandV1): DomainResult<true> {
  if (!isRecord(command)) return invalid("command", "not_object");
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) return invalid("command.expectedRevision", "revision");
  if (typeof command.itemId !== "string" || command.itemId.length === 0) return invalid("command.itemId", "empty_id");
  if (typeof command.targetCharacterId !== "string" || command.targetCharacterId.length === 0) return invalid("command.targetCharacterId", "empty_id");
  return success(true);
}

/** 无副作用解析入口，先校验所有门禁并返回本次治疗量。 */
export function previewFieldItemUse(
  content: FieldItemContentSource,
  save: GameSaveV1,
  command: UseFieldItemCommandV1,
  staticMaxHp?: (save: GameSaveV1, characterId: CharacterId) => DomainResult<number>,
): DomainResult<{ powerBps: number; maxHp: number; healed: number }> {
  const commandResult = validateCommand(command);
  if (!commandResult.ok) return commandResult;
  if (!isRecord(save)) return invalid("save", "not_object");
  if (command.expectedRevision !== save.revision) return stale(command.expectedRevision, save.revision);
  if (save.expedition === null) return forbidden(command.itemId, "NOT_IN_EXPEDITION");
  if (save.battle !== null) return forbidden(command.itemId, "BATTLE_ACTIVE");
  if (getOwnedItem(save, command.itemId) < 1) {
    return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: command.itemId }));
  }
  let itemResult: ReturnType<FieldItemContentSource["getItem"]>;
  try {
    itemResult = content.getItem(command.itemId);
  } catch {
    return invalid(`items.${command.itemId}`, "getter_failed");
  }
  if (!itemResult.ok) return itemResult;
  const healResult = resolveHeal(itemResult.value as ConsumableItemDefinition, command.itemId);
  if (!healResult.ok) return healResult;

  const progress = save.characters[command.targetCharacterId];
  const inParty = save.party.slots.includes(command.targetCharacterId);
  if (!progress || !inParty || progress.characterId !== command.targetCharacterId || progress.recruited !== true) {
    return invalidTarget("UNKNOWN", command.targetCharacterId);
  }
  if (!Number.isSafeInteger(progress.currentHp) || progress.currentHp <= 0) return invalidTarget("DEAD", command.targetCharacterId);
  let maxHpResult: DomainResult<number>;
  try {
    maxHpResult = staticMaxHp
      ? staticMaxHp(save, command.targetCharacterId)
      : staticMaxHpFromContent(content, save, command.targetCharacterId);
  } catch {
    return invalid(`characters.${command.targetCharacterId}`, "max_hp_getter_failed");
  }
  if (!maxHpResult.ok) return maxHpResult;
  if (!Number.isSafeInteger(maxHpResult.value) || maxHpResult.value < 1) return invalid(`characters.${command.targetCharacterId}`, "max_hp_range");
  if (progress.currentHp >= maxHpResult.value) return invalidTarget("FULL_HP", command.targetCharacterId);
  const healed = Math.floor((maxHpResult.value * healResult.value) / 10_000);
  if (healed <= 0) return invalid(`items.${command.itemId}.effects[0]`, "zero_heal");
  return success({ powerBps: healResult.value, maxHp: maxHpResult.value, healed });
}

export async function useFieldItem(
  content: FieldItemContentSource,
  save: GameSaveV1,
  command: UseFieldItemCommandV1,
  options: FieldItemCommitOptions,
): Promise<DomainResult<FieldItemUseResult>> {
  if (!options || typeof options !== "object" || typeof options.save !== "function") return invalid("options.save", "transaction_required");
  const preview = previewFieldItemUse(content, save, command, options.staticMaxHp);
  if (!preview.ok) return preview;
  const nextSave = clone(save);
  nextSave.inventory.stackables[command.itemId] -= 1;
  const target = nextSave.characters[command.targetCharacterId];
  if (!target) return invalid(`characters.${command.targetCharacterId}`, "missing_progress");
  target.currentHp = Math.min(preview.value.maxHp, target.currentHp + preview.value.healed);
  try {
    const committed = await options.save(command.expectedRevision, nextSave);
    return committed.ok
      ? success({ save: committed.value, healed: target.currentHp - save.characters[command.targetCharacterId].currentHp, maxHp: preview.value.maxHp })
      : committed;
  } catch {
    return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
  }
}

export class FieldItemService {
  private readonly content: FieldItemContentSource;

  public constructor(content: FieldItemContentSource) {
    this.content = content;
  }

  public preview(save: GameSaveV1, command: UseFieldItemCommandV1, staticMaxHp?: FieldItemCommitOptions["staticMaxHp"]): DomainResult<{ powerBps: number; maxHp: number; healed: number }> {
    return previewFieldItemUse(this.content, save, command, staticMaxHp);
  }

  public use(save: GameSaveV1, command: UseFieldItemCommandV1, options: FieldItemCommitOptions): Promise<DomainResult<FieldItemUseResult>> {
    return useFieldItem(this.content, save, command, options);
  }
}
