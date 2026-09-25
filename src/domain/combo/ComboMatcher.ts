/**
 * Combo 标签汇总和精确配方匹配。
 *
 * 该模块只读取当前快照中明确的已装备来源，返回新的不可变解释视图；
 * Combo 本身不会回写标签，也不会读取任何战斗效果。
 */
import type {
  CharacterDefinition,
  CharacterId,
  CharacterProgressV1,
  ComboDefinition,
  ComboId,
  ComboRequirement,
  ComboTagId,
  EquipmentAffixDefinition,
  EquipmentBaseDefinition,
  EquipmentInstance,
  EquipmentSlot,
  InventoryStateV1,
  PartyStateV1,
  SkillAffixDefinition,
  SkillDefinition,
  SkillStoneInstance,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";

export type ComboTagSource = Exclude<ComboRequirement["source"], "any">;

/** 一条标签的来源细节，便于预览和战斗日志解释。 */
export interface TagContributionEntry {
  readonly source: ComboTagSource;
  readonly tagId: ComboTagId;
  readonly count: number;
  readonly characterId: CharacterId;
  readonly instanceId: string | null;
  readonly sourceIndex: number | "abyss" | null;
}

export interface ComboMatchDiagnostic {
  readonly comboId: ComboId;
  readonly matched: boolean;
  readonly reason: "MATCHED" | "REQUIREMENT_NOT_MET";
  readonly missing: readonly {
    readonly requirement: ComboRequirement;
    readonly available: number;
  }[];
}

export interface ComboMatchResult {
  readonly scope: "personal" | "party";
  readonly matchedComboIds: readonly ComboId[];
  readonly tagContributions: readonly TagContributionEntry[];
  readonly diagnostics: readonly ComboMatchDiagnostic[];
}

export interface ComboMatcherContentSource {
  getCharacter(id: CharacterId): DomainResult<Readonly<CharacterDefinition>>;
  getSkill(id: string): DomainResult<Readonly<SkillDefinition>>;
  getEquipmentBase(id: string): DomainResult<Readonly<EquipmentBaseDefinition>>;
  getEquipmentAffix(id: string): DomainResult<Readonly<EquipmentAffixDefinition>>;
  getSkillAffix(id: string): DomainResult<Readonly<SkillAffixDefinition>>;
  getCombo(id: ComboId): DomainResult<Readonly<ComboDefinition>>;
}

export interface PersonalComboState {
  readonly character: CharacterProgressV1;
  readonly inventory: InventoryStateV1;
  readonly comboIds: readonly ComboId[];
}

export interface PartyComboState {
  readonly party: PartyStateV1;
  readonly characters: Readonly<Record<CharacterId, CharacterProgressV1>>;
  readonly inventory: InventoryStateV1;
  readonly comboIds: readonly ComboId[];
}

const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"];
const TAG_IDS: ReadonlySet<string> = new Set([
  "area", "back", "basicAttack", "bleed", "burn", "chain", "chase", "cleanse", "control", "counter",
  "crit", "dark", "detonate", "element", "execute", "fire", "focus", "front", "frost", "guard", "heal",
  "healthy", "holy", "mark", "might", "physical", "poison", "shield", "shock", "speed", "support", "taunt",
  "ultimate", "vitality",
]);
const SOURCE_ORDER: readonly ComboTagSource[] = ["innate", "equipmentAffix", "equippedSkill", "skillAffix"];

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function freezeResult(value: ComboMatchResult): ComboMatchResult {
  const contributions = value.tagContributions.map((entry) => freeze({ ...entry }));
  const diagnostics = value.diagnostics.map((diagnostic) => freeze({
    ...diagnostic,
    missing: Object.freeze(diagnostic.missing.map((missing) => freeze({
      requirement: freeze({ ...missing.requirement }),
      available: missing.available,
    }))),
  }));
  return freeze({
    ...value,
    matchedComboIds: Object.freeze([...value.matchedComboIds]),
    tagContributions: Object.freeze(contributions),
    diagnostics: Object.freeze(diagnostics),
  }) as ComboMatchResult;
}

function validateTag(tagId: unknown, count: unknown, path: string): DomainResult<true> {
  if (typeof tagId !== "string" || !TAG_IDS.has(tagId)) return invalid(`${path}.tagId`, "unknown_tag");
  if (!Number.isSafeInteger(count) || (count as number) <= 0) return invalid(`${path}.count`, "positive_integer_required");
  return success(true);
}

function addTags(
  target: TagContributionEntry[],
  tags: readonly { tagId: ComboTagId; count: number }[],
  source: ComboTagSource,
  characterId: CharacterId,
  instanceId: string | null,
  sourceIndex: number | "abyss" | null,
  path: string,
): DomainResult<true> {
  if (!Array.isArray(tags)) return invalid(path, "array_required");
  for (const [index, tag] of tags.entries()) {
    const tagResult = validateTag(tag?.tagId, tag?.count, `${path}[${index}]`);
    if (!tagResult.ok) return tagResult;
    target.push(freeze({ source, tagId: tag.tagId, count: tag.count, characterId, instanceId, sourceIndex }));
  }
  return success(true);
}

interface IndexedInventory {
  readonly equipment: ReadonlyMap<string, Readonly<EquipmentInstance>>;
  readonly skillStones: ReadonlyMap<string, Readonly<SkillStoneInstance>>;
}

function indexInventory(inventory: InventoryStateV1): DomainResult<IndexedInventory> {
  if (!isRecord(inventory)) return invalid("inventory", "not_object");
  if (!Array.isArray(inventory.equipment) || !Array.isArray(inventory.overflowEquipment)) return invalid("inventory.equipment", "array_required");
  if (!Array.isArray(inventory.skillStones) || !Array.isArray(inventory.overflowSkillStones)) return invalid("inventory.skillStones", "array_required");
  const allIds = new Set<string>();
  const equipment = new Map<string, Readonly<EquipmentInstance>>();
  const skillStones = new Map<string, Readonly<SkillStoneInstance>>();
  const add = (value: unknown, kind: "equipment" | "skillStone", index: number): DomainResult<true> => {
    if (!isRecord(value) || typeof value.instanceId !== "string" || value.instanceId.length === 0) {
      return invalid(`inventory.${kind}[${index}]`, "instance_shape");
    }
    if (allIds.has(value.instanceId)) return invalid(`inventory.${kind}[${index}].instanceId`, "duplicate_instance_id");
    allIds.add(value.instanceId);
    if (kind === "equipment") equipment.set(value.instanceId, value as unknown as Readonly<EquipmentInstance>);
    else skillStones.set(value.instanceId, value as unknown as Readonly<SkillStoneInstance>);
    return success(true);
  };
  for (const [index, value] of [...inventory.equipment, ...inventory.overflowEquipment].entries()) {
    const result = add(value, "equipment", index);
    if (!result.ok) return result;
  }
  for (const [index, value] of [...inventory.skillStones, ...inventory.overflowSkillStones].entries()) {
    const result = add(value, "skillStone", index);
    if (!result.ok) return result;
  }
  return success({ equipment, skillStones });
}

function getCharacter(
  content: ComboMatcherContentSource,
  characterId: CharacterId,
  path: string,
): DomainResult<Readonly<CharacterDefinition>> {
  if (typeof characterId !== "string" || characterId.length === 0) return invalid(path, "empty_id");
  let result: DomainResult<Readonly<CharacterDefinition>>;
  try {
    result = content.getCharacter(characterId);
  } catch {
    return invalid(path, "getter_failed");
  }
  if (!result.ok) return result;
  if (!isRecord(result.value) || result.value.id !== characterId) return invalid(path, "id_mismatch");
  return result;
}

function collectEquipmentTags(
  content: ComboMatcherContentSource,
  character: CharacterProgressV1,
  definition: Readonly<CharacterDefinition>,
  indexed: IndexedInventory,
  target: TagContributionEntry[],
): DomainResult<true> {
  if (!isRecord(character.equipmentBySlot)) return invalid("character.equipmentBySlot", "not_object");
  const equipped = new Set<string>();
  for (const slot of EQUIPMENT_SLOTS) {
    const instanceId = character.equipmentBySlot[slot];
    if (instanceId === null) continue;
    if (typeof instanceId !== "string" || instanceId.length === 0) return invalid(`character.equipmentBySlot.${slot}`, "instance_id");
    if (equipped.has(instanceId)) return invalid(`character.equipmentBySlot.${slot}`, "duplicate_equipped_instance");
    equipped.add(instanceId);
    const instance = indexed.equipment.get(instanceId);
    if (!instance) return invalid(`character.equipmentBySlot.${slot}`, "unknown_instance");
    let baseResult: DomainResult<Readonly<EquipmentBaseDefinition>>;
    try {
      baseResult = content.getEquipmentBase(instance.baseId);
    } catch {
      return invalid(`equipmentBases.${instance.baseId}`, "getter_failed");
    }
    if (!baseResult.ok) return baseResult;
    if (!isRecord(baseResult.value) || baseResult.value.id !== instance.baseId) return invalid(`equipmentBases.${instance.baseId}`, "id_mismatch");
    if (baseResult.value.slot !== slot) return invalid(`character.equipmentBySlot.${slot}`, "equipment_slot_mismatch");
    if (!Array.isArray(instance.affixes)) return invalid(`equipment.${instanceId}.affixes`, "array_required");
    const seenAffixes = new Set<string>();
    for (const [index, roll] of instance.affixes.entries()) {
      if (!isRecord(roll) || typeof roll.affixId !== "string" || seenAffixes.has(roll.affixId)) return invalid(`equipment.${instanceId}.affixes[${index}]`, "affix_shape_or_duplicate");
      seenAffixes.add(roll.affixId);
      let affixResult: DomainResult<Readonly<EquipmentAffixDefinition>>;
      try {
        affixResult = content.getEquipmentAffix(roll.affixId);
      } catch {
        return invalid(`equipmentAffixes.${roll.affixId}`, "getter_failed");
      }
      if (!affixResult.ok) return affixResult;
      if (!isRecord(affixResult.value) || affixResult.value.id !== roll.affixId || affixResult.value.pool !== "normal") {
        return invalid(`equipmentAffixes.${roll.affixId}`, "id_mismatch_or_pool");
      }
      const tagsResult = addTags(target, affixResult.value.tags, "equipmentAffix", definition.id, instanceId, index, `equipmentAffixes.${roll.affixId}.tags`);
      if (!tagsResult.ok) return tagsResult;
    }
    if (instance.abyssAffix !== null) {
      const roll = instance.abyssAffix;
      if (!isRecord(roll) || typeof roll.affixId !== "string") return invalid(`equipment.${instanceId}.abyssAffix`, "affix_shape");
      let affixResult: DomainResult<Readonly<EquipmentAffixDefinition>>;
      try {
        affixResult = content.getEquipmentAffix(roll.affixId);
      } catch {
        return invalid(`equipmentAffixes.${roll.affixId}`, "getter_failed");
      }
      if (!affixResult.ok) return affixResult;
      if (!isRecord(affixResult.value) || affixResult.value.id !== roll.affixId || affixResult.value.pool !== "abyss") {
        return invalid(`equipmentAffixes.${roll.affixId}`, "id_mismatch_or_pool");
      }
      const tagsResult = addTags(target, affixResult.value.tags, "equipmentAffix", definition.id, instanceId, "abyss", `equipmentAffixes.${roll.affixId}.tags`);
      if (!tagsResult.ok) return tagsResult;
    }
  }
  return success(true);
}

function collectSkillTags(
  content: ComboMatcherContentSource,
  character: CharacterProgressV1,
  definition: Readonly<CharacterDefinition>,
  target: TagContributionEntry[],
): DomainResult<true> {
  if (!Array.isArray(character.equippedActiveSkillIds) || character.equippedActiveSkillIds.length !== 2) return invalid("character.equippedActiveSkillIds", "slot_count");
  if (!isRecord(character.skillLevels)) return invalid("character.skillLevels", "not_object");
  if (!Number.isSafeInteger(character.level) || character.level < 1) return invalid("character.level", "level_required");
  const seen = new Set<string>();
  const addSkill = (skillId: string | null, expectedKind: "active" | "ultimate" | "passive", sourceIndex: number | null, path: string): DomainResult<true> => {
    if (skillId === null && expectedKind === "active") return success(true);
    if (typeof skillId !== "string" || skillId.length === 0) return invalid(path, "skill_id");
    if (seen.has(skillId)) return invalid(path, "duplicate_skill_id");
    seen.add(skillId);
    let skillResult: DomainResult<Readonly<SkillDefinition>>;
    try {
      skillResult = content.getSkill(skillId);
    } catch {
      return invalid(`skills.${skillId}`, "getter_failed");
    }
    if (!skillResult.ok) return skillResult;
    const skill = skillResult.value;
    if (!isRecord(skill) || !isRecord(skill.owner) || skill.id !== skillId || skill.owner.kind !== "character" || skill.owner.characterId !== definition.id || skill.kind !== expectedKind) {
      return invalid(path, "skill_owner_or_kind_mismatch");
    }
    if (!Number.isSafeInteger(skill.unlockLevel) || skill.unlockLevel < 1 || character.level < skill.unlockLevel) {
      return invalid(path, "skill_locked_by_level");
    }
    if (expectedKind === "active") {
      if (!definition.activeSkillIds.includes(skillId)) return invalid(path, "active_skill_not_owned");
      const skillLevel = character.skillLevels[skillId];
      if (!Number.isSafeInteger(skillLevel) || skillLevel < 1) return invalid(path, "skill_locked");
    }
    return addTags(target, skill.tags, "equippedSkill", definition.id, null, sourceIndex, `skills.${skillId}.tags`);
  };
  for (const [index, skillId] of character.equippedActiveSkillIds.entries()) {
    const result = addSkill(skillId, "active", index, `character.equippedActiveSkillIds[${index}]`);
    if (!result.ok) return result;
  }
  let result = addSkill(definition.ultimateSkillId, "ultimate", null, `characters.${definition.id}.ultimateSkillId`);
  if (!result.ok) return result;
  result = addSkill(definition.passiveSkillId, "passive", null, `characters.${definition.id}.passiveSkillId`);
  if (!result.ok) return result;
  return success(true);
}

function collectSkillAffixTags(
  content: ComboMatcherContentSource,
  character: CharacterProgressV1,
  indexed: IndexedInventory,
  target: TagContributionEntry[],
): DomainResult<true> {
  const instanceId = character.skillStoneInstanceId;
  if (instanceId === null) return success(true);
  if (typeof instanceId !== "string" || instanceId.length === 0) return invalid("character.skillStoneInstanceId", "instance_id");
  const stone = indexed.skillStones.get(instanceId);
  if (!stone) return invalid("character.skillStoneInstanceId", "unknown_instance");
  if (stone.attunedCharacterId !== character.characterId) return invalid(`skillStones.${instanceId}.attunedCharacterId`, "attuned_character_mismatch");
  if (!Array.isArray(stone.affixes)) return invalid(`skillStones.${instanceId}.affixes`, "array_required");
  const seen = new Set<string>();
  for (const [index, roll] of stone.affixes.entries()) {
    if (!isRecord(roll) || typeof roll.skillAffixId !== "string" || seen.has(roll.skillAffixId)) return invalid(`skillStones.${instanceId}.affixes[${index}]`, "affix_shape_or_duplicate");
    seen.add(roll.skillAffixId);
    let affixResult: DomainResult<Readonly<SkillAffixDefinition>>;
    try {
      affixResult = content.getSkillAffix(roll.skillAffixId);
    } catch {
      return invalid(`skillAffixes.${roll.skillAffixId}`, "getter_failed");
    }
    if (!affixResult.ok) return affixResult;
    if (!isRecord(affixResult.value) || affixResult.value.id !== roll.skillAffixId || affixResult.value.pool !== "normal") {
      return invalid(`skillAffixes.${roll.skillAffixId}`, "id_mismatch_or_pool");
    }
    const tagsResult = addTags(target, affixResult.value.tags, "skillAffix", character.characterId, instanceId, index, `skillAffixes.${roll.skillAffixId}.tags`);
    if (!tagsResult.ok) return tagsResult;
  }
  if (stone.abyssAffix !== null) {
    const roll = stone.abyssAffix;
    if (!isRecord(roll) || typeof roll.skillAffixId !== "string") return invalid(`skillStones.${instanceId}.abyssAffix`, "affix_shape");
    let affixResult: DomainResult<Readonly<SkillAffixDefinition>>;
    try {
      affixResult = content.getSkillAffix(roll.skillAffixId);
    } catch {
      return invalid(`skillAffixes.${roll.skillAffixId}`, "getter_failed");
    }
    if (!affixResult.ok) return affixResult;
    if (!isRecord(affixResult.value) || affixResult.value.id !== roll.skillAffixId || affixResult.value.pool !== "abyss") {
      return invalid(`skillAffixes.${roll.skillAffixId}`, "id_mismatch_or_pool");
    }
    const tagsResult = addTags(target, affixResult.value.tags, "skillAffix", character.characterId, instanceId, "abyss", `skillAffixes.${roll.skillAffixId}.tags`);
    if (!tagsResult.ok) return tagsResult;
  }
  return success(true);
}

function collectCharacterTags(
  content: ComboMatcherContentSource,
  character: CharacterProgressV1,
  inventory: InventoryStateV1,
): DomainResult<readonly TagContributionEntry[]> {
  if (!isRecord(character)) return invalid("character", "not_object");
  const characterResult = getCharacter(content, character.characterId, "character.characterId");
  if (!characterResult.ok) return characterResult;
  const indexedResult = indexInventory(inventory);
  if (!indexedResult.ok) return indexedResult;
  const result: TagContributionEntry[] = [];
  let tagsResult = addTags(result, characterResult.value.innateTags, "innate", character.characterId, null, null, `characters.${character.characterId}.innateTags`);
  if (!tagsResult.ok) return tagsResult;
  tagsResult = collectEquipmentTags(content, character, characterResult.value, indexedResult.value, result);
  if (!tagsResult.ok) return tagsResult;
  tagsResult = collectSkillTags(content, character, characterResult.value, result);
  if (!tagsResult.ok) return tagsResult;
  tagsResult = collectSkillAffixTags(content, character, indexedResult.value, result);
  if (!tagsResult.ok) return tagsResult;
  result.sort((left, right) => SOURCE_ORDER.indexOf(left.source) - SOURCE_ORDER.indexOf(right.source)
    || left.tagId.localeCompare(right.tagId)
    || left.characterId.localeCompare(right.characterId)
    || (left.instanceId ?? "").localeCompare(right.instanceId ?? "")
    || String(left.sourceIndex ?? "").localeCompare(String(right.sourceIndex ?? "")));
  return success(Object.freeze(result));
}

function requirementKey(source: ComboRequirement["source"], tagId: ComboTagId): string {
  return `${source}:${tagId}`;
}

function validateComboRequirements(combo: Readonly<ComboDefinition>): DomainResult<true> {
  if (!Array.isArray(combo.requirements) || combo.requirements.length === 0) return invalid(`combos.${combo.id}.requirements`, "non_empty_array_required");
  const seen = new Set<string>();
  for (const [index, requirement] of combo.requirements.entries()) {
    const tagResult = validateTag(requirement?.tagId, requirement?.count, `combos.${combo.id}.requirements[${index}]`);
    if (!tagResult.ok) return tagResult;
    if (!["any", ...SOURCE_ORDER].includes(requirement.source)) return invalid(`combos.${combo.id}.requirements[${index}].source`, "unknown_source");
    const key = requirementKey(requirement.source, requirement.tagId);
    if (seen.has(key)) return invalid(`combos.${combo.id}.requirements[${index}]`, "duplicate_source_tag_requirement");
    seen.add(key);
  }
  return success(true);
}

interface MatchRequirementsResult {
  readonly matched: boolean;
  readonly missing: readonly { readonly requirement: ComboRequirement; readonly available: number }[];
}

function matchRequirements(
  combo: Readonly<ComboDefinition>,
  contributions: readonly TagContributionEntry[],
): DomainResult<MatchRequirementsResult> {
  const validation = validateComboRequirements(combo);
  if (!validation.ok) return validation;
  const remaining = new Map<string, number>();
  for (const contribution of contributions) {
    const key = requirementKey(contribution.source, contribution.tagId);
    remaining.set(key, (remaining.get(key) ?? 0) + contribution.count);
  }
  const missing: Array<{ requirement: ComboRequirement; available: number }> = [];
  const specific = combo.requirements.filter((requirement) => requirement.source !== "any");
  const any = combo.requirements.filter((requirement) => requirement.source === "any");
  for (const requirement of [...specific, ...any]) {
    if (requirement.source === "any") {
      let available = 0;
      for (const source of SOURCE_ORDER) available += remaining.get(requirementKey(source, requirement.tagId)) ?? 0;
      if (available < requirement.count) {
        missing.push({ requirement: { ...requirement }, available });
        continue;
      }
      let left = requirement.count;
      for (const source of SOURCE_ORDER) {
        const key = requirementKey(source, requirement.tagId);
        const take = Math.min(left, remaining.get(key) ?? 0);
        if (take > 0) remaining.set(key, (remaining.get(key) ?? 0) - take);
        left -= take;
        if (left === 0) break;
      }
      continue;
    }
    const key = requirementKey(requirement.source, requirement.tagId);
    const available = remaining.get(key) ?? 0;
    if (available < requirement.count) {
      missing.push({ requirement: { ...requirement }, available });
      continue;
    }
    remaining.set(key, available - requirement.count);
  }
  return success({ matched: missing.length === 0, missing: Object.freeze(missing) });
}

function resolveCombos(
  content: ComboMatcherContentSource,
  comboIds: readonly ComboId[],
  scope: "personal" | "party",
): DomainResult<readonly Readonly<ComboDefinition>[]> {
  if (!Array.isArray(comboIds) || comboIds.length === 0) return invalid("comboIds", "non_empty_array_required");
  const seen = new Set<string>();
  const combos: Array<Readonly<ComboDefinition>> = [];
  for (const comboId of comboIds) {
    if (typeof comboId !== "string" || comboId.length === 0 || seen.has(comboId)) return invalid("comboIds", "duplicate_or_empty_id");
    seen.add(comboId);
    let result: DomainResult<Readonly<ComboDefinition>>;
    try {
      result = content.getCombo(comboId);
    } catch {
      return invalid(`combos.${comboId}`, "getter_failed");
    }
    if (!result.ok) return result;
    if (result.value.id !== comboId) return invalid(`combos.${comboId}`, "id_mismatch");
    // personal/party 是两个独立池；调用方可以传入全量 ID，另一作用域在本次匹配中排除。
    if (result.value.scope !== scope) continue;
    combos.push(result.value);
  }
  return success(Object.freeze(combos));
}

function buildMatchResult(
  content: ComboMatcherContentSource,
  scope: "personal" | "party",
  contributions: readonly TagContributionEntry[],
  comboIds: readonly ComboId[],
): DomainResult<ComboMatchResult> {
  const combosResult = resolveCombos(content, comboIds, scope);
  if (!combosResult.ok) return combosResult;
  const matched: ComboId[] = [];
  const diagnostics: ComboMatchDiagnostic[] = [];
  for (const combo of combosResult.value) {
    const result = matchRequirements(combo, contributions);
    if (!result.ok) return result;
    if (result.value.matched) matched.push(combo.id);
    diagnostics.push({ comboId: combo.id, matched: result.value.matched, reason: result.value.matched ? "MATCHED" : "REQUIREMENT_NOT_MET", missing: result.value.missing });
  }
  matched.sort();
  diagnostics.sort((left, right) => left.comboId.localeCompare(right.comboId));
  return success(freezeResult({ scope, matchedComboIds: matched, tagContributions: [...contributions], diagnostics }));
}

function validateContentSource(content: ComboMatcherContentSource): DomainResult<true> {
  if (!isRecord(content)) return invalid("content", "not_object");
  for (const key of ["getCharacter", "getSkill", "getEquipmentBase", "getEquipmentAffix", "getSkillAffix", "getCombo"] as const) {
    if (typeof content[key] !== "function") return invalid(`content.${key}`, "getter_required");
  }
  return success(true);
}

export function collectPersonalTagContributions(
  content: ComboMatcherContentSource,
  character: CharacterProgressV1,
  inventory: InventoryStateV1,
): DomainResult<readonly TagContributionEntry[]> {
  const contentResult = validateContentSource(content);
  if (!contentResult.ok) return contentResult;
  return collectCharacterTags(content, character, inventory);
}

export function collectPartyTagContributions(
  content: ComboMatcherContentSource,
  party: PartyStateV1,
  characters: Readonly<Record<CharacterId, CharacterProgressV1>>,
  inventory: InventoryStateV1,
): DomainResult<readonly TagContributionEntry[]> {
  const contentResult = validateContentSource(content);
  if (!contentResult.ok) return contentResult;
  if (!isRecord(party) || !Array.isArray(party.slots) || party.slots.length !== 4) return invalid("party.slots", "slot_count");
  if (!isRecord(characters)) return invalid("characters", "not_object");
  const seen = new Set<CharacterId>();
  const result: TagContributionEntry[] = [];
  for (const [index, characterId] of party.slots.entries()) {
    if (characterId === null) continue;
    if (typeof characterId !== "string" || characterId.length === 0 || seen.has(characterId)) return invalid(`party.slots[${index}]`, "duplicate_or_empty_character");
    seen.add(characterId);
    const character = characters[characterId];
    if (!character || character.characterId !== characterId) return invalid(`characters.${characterId}`, "missing_or_id_mismatch");
    const personal = collectCharacterTags(content, character, inventory);
    if (!personal.ok) return personal;
    result.push(...personal.value);
  }
  result.sort((left, right) => SOURCE_ORDER.indexOf(left.source) - SOURCE_ORDER.indexOf(right.source)
    || left.tagId.localeCompare(right.tagId)
    || left.characterId.localeCompare(right.characterId)
    || (left.instanceId ?? "").localeCompare(right.instanceId ?? "")
    || String(left.sourceIndex ?? "").localeCompare(String(right.sourceIndex ?? "")));
  return success(Object.freeze(result));
}

export function matchPersonalCombos(
  content: ComboMatcherContentSource,
  state: PersonalComboState,
): DomainResult<ComboMatchResult> {
  const contributions = collectPersonalTagContributions(content, state.character, state.inventory);
  if (!contributions.ok) return contributions;
  return buildMatchResult(content, "personal", contributions.value, state.comboIds);
}

export function matchPartyCombos(
  content: ComboMatcherContentSource,
  state: PartyComboState,
): DomainResult<ComboMatchResult> {
  const contributions = collectPartyTagContributions(content, state.party, state.characters, state.inventory);
  if (!contributions.ok) return contributions;
  return buildMatchResult(content, "party", contributions.value, state.comboIds);
}

export class ComboMatcher {
  private readonly content: ComboMatcherContentSource;

  public constructor(content: ComboMatcherContentSource) {
    this.content = content;
  }

  public collectPersonal(character: CharacterProgressV1, inventory: InventoryStateV1): DomainResult<readonly TagContributionEntry[]> {
    return collectPersonalTagContributions(this.content, character, inventory);
  }

  public collectParty(party: PartyStateV1, characters: Readonly<Record<CharacterId, CharacterProgressV1>>, inventory: InventoryStateV1): DomainResult<readonly TagContributionEntry[]> {
    return collectPartyTagContributions(this.content, party, characters, inventory);
  }

  public matchPersonal(state: PersonalComboState): DomainResult<ComboMatchResult> {
    return matchPersonalCombos(this.content, state);
  }

  public matchParty(state: PartyComboState): DomainResult<ComboMatchResult> {
    return matchPartyCombos(this.content, state);
  }
}
