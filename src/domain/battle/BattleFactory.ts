/**
 * BattleSnapshot 创建器。
 *
 * 这里只负责把已经明确给出的远征、地图、内容和角色进度固化为战斗
 * 快照；伤害、道具、奖励和长期存档写回均留给后续战斗服务处理。
 */
import type {
  AbyssEchoDefinition,
  BattleSnapshotV1,
  BattleUnitStateV1,
  CharacterDefinition,
  CharacterProgressV1,
  EnemyDefinition,
  SkillDefinition,
  StatBlock,
} from "../../content/contracts";
import {
  CHARACTER_STAT_KEYS,
  validateCharacterProgressShape,
} from "../character/Character";
import { calculateStats } from "../character/StatCalculator";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import { mulBpsFloor } from "../common/FixedMath";
import { SeededRng, type RngState } from "../common/SeededRng";
import type {
  BattleContentSource,
  BattleFactoryInput,
  BattleFactoryOptions,
  BattleStatBaseline,
  EncounterMapObject,
} from "./BattleTypes";

/** 回响额外输入只在本文件扩展，不改变冻结 BattleFactoryInput 合同。 */
type AbyssEchoBattleFactoryInput = BattleFactoryInput & { readonly echo?: Readonly<AbyssEchoDefinition> };
type AbyssEchoBattleFactoryOptions = BattleFactoryOptions & {
  readonly getAbyssEcho?: (id: string) => DomainResult<Readonly<AbyssEchoDefinition>>;
};

const statKeys = CHARACTER_STAT_KEYS;

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function cloneStatBlock(value: StatBlock): StatBlock {
  return { ...value };
}

function cloneVector(value: Readonly<{ x: number; y: number }>): { x: number; y: number } {
  return { x: value.x, y: value.y };
}

function validateString(value: unknown, path: string): DomainResult<true> {
  return isNonEmptyString(value) ? success(true) : invalid(path, "empty_id");
}

function validateStatBlock(value: unknown, path: string): DomainResult<true> {
  if (!isRecord(value)) return invalid(path, "not_object");
  const keys = Object.keys(value);
  if (keys.length !== statKeys.length || statKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    return invalid(path, "stat_key_set");
  }
  for (const key of statKeys) {
    if (!Number.isSafeInteger(value[key])) return invalid(`${path}.${key}`, "non_integer");
  }
  return success(true);
}

function clampStat(key: keyof StatBlock, value: number): number {
  switch (key) {
    case "maxHp":
    case "attack":
    case "defense":
    case "speed":
      return Math.max(1, value);
    case "critRateBps":
    case "effectHitBps":
    case "effectResistBps":
      return Math.min(10_000, Math.max(0, value));
    case "critDamageBps":
      return Math.min(30_000, Math.max(10_000, value));
  }
}

function calculateBaselineStats(
  prePercentStats: StatBlock,
  staticPercentByStatBps: Record<keyof StatBlock, number>,
): StatBlock {
  const stats = {} as StatBlock;
  for (const key of statKeys) {
    stats[key] = clampStat(
      key,
      mulBpsFloor(prePercentStats[key], 10_000 + staticPercentByStatBps[key]),
    );
  }
  return stats;
}

function validateBaseline(
  baseline: BattleStatBaseline,
  path: string,
): DomainResult<BattleStatBaseline> {
  if (!baseline || typeof baseline !== "object") return invalid(path, "not_object");
  const preResult = validateStatBlock(baseline.prePercentStats, `${path}.prePercentStats`);
  if (!preResult.ok) return preResult;
  const percentResult = validateStatBlock(baseline.staticPercentByStatBps, `${path}.staticPercentByStatBps`);
  if (!percentResult.ok) return percentResult;
  const statsResult = validateStatBlock(baseline.stats, `${path}.stats`);
  if (!statsResult.ok) return statsResult;
  try {
    const expected = calculateBaselineStats(baseline.prePercentStats, baseline.staticPercentByStatBps);
    for (const key of statKeys) {
      if (baseline.stats[key] !== expected[key]) return invalid(`${path}.stats.${key}`, "baseline_formula");
    }
  } catch {
    return invalid(path, "baseline_overflow");
  }
  return success({
    prePercentStats: cloneStatBlock(baseline.prePercentStats),
    staticPercentByStatBps: cloneStatBlock(baseline.staticPercentByStatBps),
    stats: cloneStatBlock(baseline.stats),
  });
}

function zeroPercentStats(): Record<keyof StatBlock, number> {
  return {
    maxHp: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    critRateBps: 0,
    critDamageBps: 0,
    effectHitBps: 0,
    effectResistBps: 0,
  };
}

function normalizeContentResult<T extends { id: string }>(
  getter: ((id: string) => DomainResult<Readonly<T>>) | undefined,
  id: string,
  path: string,
): DomainResult<Readonly<T>> {
  if (typeof getter !== "function") return invalid(path, "getter_required");
  let result: DomainResult<Readonly<T>>;
  try {
    result = getter(id);
  } catch {
    return invalid(path, "getter_failed");
  }
  if (!result.ok) return invalid(path, "missing_reference");
  if (!result.value || result.value.id !== id) return invalid(path, "id_mismatch");
  return success(result.value);
}

function validateVector(value: unknown, path: string): DomainResult<true> {
  if (!isRecord(value)) return invalid(path, "not_object");
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return invalid(path, "finite_required");
  return success(true);
}

function validateRngState(input: BattleFactoryInput): DomainResult<RngState> {
  let state: RngState | undefined;
  if (input.rngState !== undefined) {
    state = input.rngState;
  } else if (input.rng && typeof input.rng.getState === "function") {
    try {
      state = input.rng.getState();
    } catch {
      return invalid("rngState", "getter_failed");
    }
  }
  if (!state || !Array.isArray(state) || state.length !== 4) return invalid("rngState", "state_shape");
  try {
    // SeededRng 的构造器包含 uint32、非全零等冻结校验；这里只读取，不推进流。
    const normalized = new SeededRng(state).getState();
    return success([normalized[0], normalized[1], normalized[2], normalized[3]]);
  } catch {
    return invalid("rngState", "state_value");
  }
}

function validateCharacterSkillReferences(
  content: BattleContentSource,
  character: CharacterDefinition,
  path: string,
): DomainResult<ReadonlyMap<string, Readonly<SkillDefinition>>> {
  const ids = [
    character.basicSkillId,
    ...character.activeSkillIds,
    character.ultimateSkillId,
    character.passiveSkillId,
  ];
  const skills = new Map<string, Readonly<SkillDefinition>>();
  for (const [index, id] of ids.entries()) {
    const result = normalizeContentResult(content.getSkill, id, `${path}.skills[${index}]`);
    if (!result.ok) return result;
    skills.set(id, result.value);
  }
  return success(skills);
}

function validateEnemySkillReferences(
  content: BattleContentSource,
  enemy: EnemyDefinition,
  path: string,
): DomainResult<ReadonlyMap<string, Readonly<SkillDefinition>>> {
  const ids = [enemy.basicSkillId, ...enemy.skillIds];
  const skills = new Map<string, Readonly<SkillDefinition>>();
  for (const [index, id] of ids.entries()) {
    const result = normalizeContentResult(content.getSkill, id, `${path}.skills[${index}]`);
    if (!result.ok) return result;
    skills.set(id, result.value);
  }
  return success(skills);
}

function createCooldowns(ids: readonly string[]): Record<string, number> {
  const cooldowns: Record<string, number> = {};
  for (const id of ids) cooldowns[id] = 0;
  return cooldowns;
}

function createUnit(
  unitId: string,
  definitionId: string,
  faction: "party" | "enemy",
  slot: number,
  level: number,
  baseline: BattleStatBaseline,
  currentHp: number,
  cooldowns: Record<string, number>,
  eligibleRound = 1,
): BattleUnitStateV1 {
  return {
    unitId,
    definitionId,
    faction,
    slot,
    level,
    prePercentStats: cloneStatBlock(baseline.prePercentStats),
    staticPercentByStatBps: cloneStatBlock(baseline.staticPercentByStatBps),
    stats: cloneStatBlock(baseline.stats),
    currentHp,
    energy: 0,
    cooldowns,
    statuses: [],
    eligibleRound,
    usedExtraTurnThisRound: false,
    directHitEnergyRootActionIds: [],
  };
}

function defaultCharacterBaseline(
  character: CharacterDefinition,
  progress: CharacterProgressV1,
): DomainResult<BattleStatBaseline> {
  const result = calculateStats(character, progress.level);
  if (!result.ok) return result;
  return success({
    prePercentStats: result.value.prePercentStats,
    staticPercentByStatBps: result.value.staticPercentByStatBps,
    stats: result.value.stats,
  });
}

function defaultEnemyBaseline(enemy: EnemyDefinition): DomainResult<BattleStatBaseline> {
  const percent = zeroPercentStats();
  return success({
    prePercentStats: cloneStatBlock(enemy.stats),
    staticPercentByStatBps: percent,
    stats: cloneStatBlock(enemy.stats),
  });
}

function applyEchoMultiplier(
  baseline: BattleStatBaseline,
  echo: Readonly<AbyssEchoDefinition>,
): BattleStatBaseline {
  const staticPercentByStatBps = { ...baseline.staticPercentByStatBps };
  staticPercentByStatBps.maxHp += echo.enemyHpBps - 10_000;
  staticPercentByStatBps.attack += echo.enemyAttackBps - 10_000;
  staticPercentByStatBps.defense += echo.enemyDefenseBps - 10_000;
  staticPercentByStatBps.speed += echo.enemySpeedBps - 10_000;
  return {
    prePercentStats: cloneStatBlock(baseline.prePercentStats),
    staticPercentByStatBps,
    stats: calculateBaselineStats(baseline.prePercentStats, staticPercentByStatBps),
  };
}

function getEchoDefinition(
  input: AbyssEchoBattleFactoryInput,
  options: AbyssEchoBattleFactoryOptions,
): DomainResult<Readonly<AbyssEchoDefinition> | null> {
  if (input.expedition.mode !== "abyssEcho") return success(null);
  const echoId = input.expedition.abyssEchoId;
  if (echoId === null) return invalid("expedition.abyssEchoId", "required");
  if (input.echo) {
    if (input.echo.id !== echoId) return invalid("echo.id", "id_mismatch");
    return success(input.echo);
  }
  if (typeof options.getAbyssEcho !== "function") return invalid("echo", "getter_required");
  try {
    const result = options.getAbyssEcho(echoId);
    if (!result.ok || result.value.id !== echoId) return invalid(`abyssEchoes.${echoId}`, "missing_reference");
    return success(result.value);
  } catch {
    return invalid(`abyssEchoes.${echoId}`, "getter_failed");
  }
}

function emptyMetrics(comboIds: readonly string[]): BattleSnapshotV1["metrics"] {
  const comboTriggerCounts: Record<string, number> = {};
  for (const id of comboIds) comboTriggerCounts[id] = 0;
  return {
    damage: [],
    partyDamageTaken: 0,
    partyHealingDone: 0,
    partyShieldGranted: 0,
    knockouts: [],
    comboTriggerCounts,
    bossEnrageCast: false,
    maxChainDepth: 0,
    triggerBudgetExhaustedCount: 0,
  };
}

function buildSnapshot(
  content: BattleContentSource,
  input: AbyssEchoBattleFactoryInput,
  options: AbyssEchoBattleFactoryOptions = {},
): DomainResult<BattleSnapshotV1> {
  if (!isRecord(input)) return invalid("input", "not_object");
  const battleIdResult = validateString(input.battleId, "battleId");
  if (!battleIdResult.ok) return battleIdResult;
  if (!input.expedition || typeof input.expedition !== "object") return invalid("expedition", "not_object");
  if (!input.map || typeof input.map !== "object") return invalid("map", "not_object");
  if (!input.encounter || typeof input.encounter !== "object") return invalid("encounter", "not_object");
  if (!input.encounterObject || typeof input.encounterObject !== "object") return invalid("encounterObject", "not_object");
  if (!input.party || typeof input.party !== "object") return invalid("party", "not_object");

  const expedition = input.expedition;
  const map = input.map;
  const encounter = input.encounter;
  const encounterObject = input.encounterObject;
  const echoResult = getEchoDefinition(input, options);
  if (!echoResult.ok) return echoResult;
  const echo = echoResult.value;
  const isEchoBattle = echo !== null;
  if (!isNonEmptyString(expedition.expeditionId)) return invalid("expedition.expeditionId", "empty_id");
  if (!isNonEmptyString(map.id)) return invalid("map.id", "empty_id");
  if (!isNonEmptyString(encounter.id)) return invalid("encounter.id", "empty_id");
  if (expedition.mapId !== map.id) return invalid("expedition.mapId", "map_mismatch");
  if (!isEchoBattle && !isNonEmptyString(encounterObject.objectId)) return invalid("encounterObject.objectId", "empty_id");
  if (isEchoBattle && encounterObject.objectId !== "") return invalid("encounterObject.objectId", "echo_object_must_be_empty");
  if (encounterObject.encounterId !== encounter.id) return invalid("encounterObject.encounterId", "encounter_mismatch");
  if (!Array.isArray(map.objects)) return invalid("map.objects", "array_required");
  if (!isEchoBattle) {
    const mapEncounterObjects = map.objects.filter((value): value is EncounterMapObject => (
      value.kind === "encounter" && value.objectId === encounterObject.objectId
    ));
    if (mapEncounterObjects.length !== 1) return invalid("map.objects", "encounter_object_not_unique");
    if (mapEncounterObjects[0].encounterId !== encounter.id) return invalid("map.objects", "encounter_binding");
  } else if (input.returnMapId !== "map_town") {
    return invalid("returnMapId", "echo_return_map");
  }
  if (!Array.isArray(expedition.defeatedEncounterObjectIds)) return invalid("expedition.defeatedEncounterObjectIds", "array_required");
  if (expedition.defeatedEncounterObjectIds.includes(encounterObject.objectId)) {
    return invalid("encounterObject.objectId", "already_defeated");
  }
  if (!isNonEmptyString(input.returnMapId)) return invalid("returnMapId", "empty_id");
  if (!isEchoBattle && (!isNonEmptyString(expedition.mapId) || input.returnMapId !== expedition.mapId)) {
    return invalid("returnMapId", "expedition_binding");
  }
  const returnPositionResult = validateVector(input.returnSafePosition, "returnSafePosition");
  if (!returnPositionResult.ok) return returnPositionResult;

  const mapResult = normalizeContentResult(content.getMap, map.id, "map.id");
  if (!mapResult.ok) return mapResult;
  const encounterResult = normalizeContentResult(content.getEncounter, encounter.id, "encounter.id");
  if (!encounterResult.ok) return encounterResult;
  if (encounterResult.value.id !== encounter.id || mapResult.value.id !== map.id) return invalid("content", "id_mismatch");

  if (!Array.isArray(encounter.enemyIdsBySlot) || encounter.enemyIdsBySlot.length < 1 || encounter.enemyIdsBySlot.length > 6) {
    return invalid("encounter.enemyIdsBySlot", "slot_count");
  }
  const enemyIds = encounter.enemyIdsBySlot.filter((value): value is string => value !== null);
  if (enemyIds.length < 1 || enemyIds.length > 6) return invalid("encounter.enemyIdsBySlot", "occupied_slot_count");
  if (!Array.isArray(input.comboIds)) return invalid("comboIds", "array_required");
  const comboSet = new Set<string>();
  for (const [index, id] of input.comboIds.entries()) {
    if (!isNonEmptyString(id)) return invalid(`comboIds[${index}]`, "empty_id");
    if (comboSet.has(id)) return invalid(`comboIds[${index}]`, "duplicate_id");
    comboSet.add(id);
  }
  const rngResult = validateRngState(input);
  if (!rngResult.ok) return rngResult;

  if (!Array.isArray(input.party.slots) || input.party.slots.length !== 4) return invalid("party.slots", "slot_count");
  const occupiedPartySlots: Array<{ characterId: string; slot: number }> = [];
  const partyIds = new Set<string>();
  for (const [slot, characterId] of input.party.slots.entries()) {
    if (characterId !== null && !isNonEmptyString(characterId)) return invalid(`party.slots[${slot}]`, "character_id");
    if (characterId === null) continue;
    if (partyIds.has(characterId)) return invalid(`party.slots[${slot}]`, "duplicate_character");
    partyIds.add(characterId);
    occupiedPartySlots.push({ characterId, slot });
  }
  if (occupiedPartySlots.length < 1 || occupiedPartySlots.length > 4) return invalid("party.slots", "occupied_slot_count");
  if (!isRecord(input.characters)) return invalid("characters", "not_object");

  const characterBaseline = input.calculateCharacterBaseline ?? options.calculateCharacterBaseline;
  const enemyBaseline = input.calculateEnemyBaseline ?? options.calculateEnemyBaseline;
  const units: BattleUnitStateV1[] = [];
  for (const { characterId, slot } of occupiedPartySlots) {
    if (!Object.prototype.hasOwnProperty.call(input.characters, characterId)) return invalid(`characters.${characterId}`, "missing_progress");
    const characterResult = normalizeContentResult(content.getCharacter, characterId, `characters.${characterId}`);
    if (!characterResult.ok) return characterResult;
    const character = characterResult.value;
    const progress = input.characters[characterId];
    if (!progress || progress.characterId !== characterId || progress.recruited !== true) {
      return invalid(`characters.${characterId}`, "progress_reference");
    }
    const progressResult = validateCharacterProgressShape(progress, character);
    if (!progressResult.ok) return progressResult;
    const skillsResult = validateCharacterSkillReferences(content, character, `characters.${characterId}`);
    if (!skillsResult.ok) return skillsResult;
    const equippedActiveSkillIds = progress.equippedActiveSkillIds.filter((id): id is string => id !== null);
    if (new Set(equippedActiveSkillIds).size !== equippedActiveSkillIds.length || equippedActiveSkillIds.length > 2) {
      return invalid(`characters.${characterId}.equippedActiveSkillIds`, "active_skill_slots");
    }
    const baselineResult = characterBaseline
      ? characterBaseline(character, progress)
      : defaultCharacterBaseline(character, progress);
    if (!baselineResult.ok) return baselineResult;
    const normalizedBaseline = validateBaseline(baselineResult.value, `characters.${characterId}.baseline`);
    if (!normalizedBaseline.ok) return normalizedBaseline;
    if (progress.currentHp < 0 || progress.currentHp > normalizedBaseline.value.stats.maxHp) {
      return invalid(`characters.${characterId}.currentHp`, "hp_range");
    }
    const cooldownIds = [character.basicSkillId, ...equippedActiveSkillIds, character.ultimateSkillId];
    units.push(createUnit(
      `party:${slot}`,
      character.id,
      "party",
      slot,
      progress.level,
      normalizedBaseline.value,
      progress.currentHp,
      createCooldowns(cooldownIds),
    ));
  }

  for (let slot = 0; slot < encounter.enemyIdsBySlot.length; slot += 1) {
    const enemyId = encounter.enemyIdsBySlot[slot];
    if (enemyId === null) continue;
    if (!isNonEmptyString(enemyId)) return invalid(`encounter.enemyIdsBySlot[${slot}]`, "enemy_id");
    const enemyResult = normalizeContentResult(content.getEnemy, enemyId, `enemies.${enemyId}`);
    if (!enemyResult.ok) return enemyResult;
    const enemy = enemyResult.value;
    const skillResult = validateEnemySkillReferences(content, enemy, `enemies.${enemyId}`);
    if (!skillResult.ok) return skillResult;
    const baselineResult = enemyBaseline
      ? enemyBaseline(enemy, slot)
      : defaultEnemyBaseline(enemy);
    if (!baselineResult.ok) return baselineResult;
    const normalizedBaseline = validateBaseline(baselineResult.value, `enemies.${enemyId}.baseline`);
    if (!normalizedBaseline.ok) return normalizedBaseline;
    const bossSlot = encounter.enemyIdsBySlot.findIndex((value) => value !== null);
    const effectiveBaseline = echo !== null && encounter.kind === "boss" && slot === bossSlot
      ? applyEchoMultiplier(normalizedBaseline.value, echo)
      : normalizedBaseline.value;
    units.push(createUnit(
      `enemy:${slot}`,
      enemy.id,
      "enemy",
      slot,
      enemy.level,
      effectiveBaseline,
      effectiveBaseline.stats.maxHp,
      createCooldowns([enemy.basicSkillId, ...enemy.skillIds]),
    ));
  }

  return success({
    battleId: input.battleId,
    expeditionId: expedition.expeditionId,
    battleRevision: 0,
    encounterId: encounter.id,
    encounterObjectId: encounterObject.objectId,
    phase: "INIT",
    outcome: "ongoing",
    round: 0,
    units,
    initiativeQueueUnitIds: [],
    currentUnitId: null,
    pendingEvents: [],
    pendingBossIntents: [],
    successfulItemUses: 0,
    abyssEchoOutcome: expedition.mode === "abyssEcho" ? "pending" : "notApplicable",
    // BattleSnapshot 使用可序列化的可变四元组；SeededRng 仍只在这里读取副本。
    rngState: [...rngResult.value] as [number, number, number, number],
    firedComboKeys: [],
    roundTriggerCounts: {},
    battleTriggerCounts: {},
    metrics: emptyMetrics(input.comboIds),
    reward: null,
    returnMapId: input.returnMapId,
    returnSafePosition: cloneVector(input.returnSafePosition),
  });
}

/** 以显式内容源创建战斗快照；不会修改任何传入对象。 */
export function createBattleSnapshot(
  content: BattleContentSource,
  input: AbyssEchoBattleFactoryInput,
  options: AbyssEchoBattleFactoryOptions = {},
): DomainResult<BattleSnapshotV1> {
  try {
    return buildSnapshot(content, input, options);
  } catch {
    return invalid("battle", "factory_exception");
  }
}

export class BattleFactory {
  private readonly content: BattleContentSource;
  private readonly options: AbyssEchoBattleFactoryOptions;

  public constructor(content: BattleContentSource, options: AbyssEchoBattleFactoryOptions = {}) {
    this.content = content;
    this.options = options;
  }

  public create(input: AbyssEchoBattleFactoryInput): DomainResult<BattleSnapshotV1> {
    return createBattleSnapshot(this.content, input, this.options);
  }
}
