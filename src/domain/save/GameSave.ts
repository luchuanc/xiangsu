/**
 * GameSaveV1 的运行时边界。
 *
 * 内容表只描述静态定义，存档边界必须单独 strict 校验，不能把未知字段
 * 当作“未来兼容字段”悄悄保留下来。需要依赖内容表的引用和交叉不变量
 * 在 validateGameSave 中继续检查，避免 Zod schema 与内容目录各自漂移。
 */
import { z } from "zod";

import type {
  BattleSnapshotV1,
  CharacterDefinition,
  CharacterProgressV1,
  ContentRootV1,
  EquipmentInstance,
  EquipmentSlot,
  GameSaveV1,
  SkillStoneInstance,
} from "../../content/contracts";
import type { IdFactory } from "../common/DomainContext";
import { SeededRng } from "../common/SeededRng";
import {
  effectSpecSchema,
  statBlockSchema,
  vector2Schema,
} from "../../content/schemas";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";

const entityIdSchema = z.string().min(1);
const finiteInt = z.number().finite().int();
const nonNegativeInt = finiteInt.min(0);
const positiveInt = finiteInt.min(1);
const safeInt = finiteInt.min(0).max(Number.MAX_SAFE_INTEGER);
const bps = finiteInt.min(0).max(10_000);

const equipmentQualitySchema = z.enum(["common", "magic", "rare", "epic", "abyss"]);
const skillStoneQualitySchema = z.enum(["magic", "rare", "epic", "abyss"]);
const craftGradeSchema = z.enum(["ordinary", "tempered", "exalted"]);
const elementSchema = z.enum([
  "physical",
  "fire",
  "frost",
  "lightning",
  "holy",
  "dark",
  "poison",
  "true",
]);
const battlePhaseSchema = z.enum([
  "INIT",
  "ROUND_START",
  "TURN_START",
  "AWAIT_COMMAND",
  "AI_DECIDE",
  "VALIDATE",
  "DRAIN_PRE_ACTION",
  "RESOLVE_ACTION",
  "DRAIN_TRIGGERS",
  "TURN_END",
  "ROUND_END",
  "VICTORY",
  "DEFEAT",
  "RETREAT",
  "REWARD_PENDING",
  "COMPLETE",
]);
const actionKindSchema = z.enum([
  "basic",
  "active",
  "ultimate",
  "effect",
  "defend",
  "item",
  "retreat",
  "skip",
  "intent",
]);
const targetStrategySchema = z.enum([
  "lowestHpOpponent",
  "highestAttackOpponent",
  "frontFirstOpponent",
  "randomValid",
  "lowestHpAlly",
  "self",
]);

const statRecordSchema = z.object({
  maxHp: finiteInt,
  attack: finiteInt,
  defense: finiteInt,
  speed: finiteInt,
  critRateBps: finiteInt,
  critDamageBps: finiteInt,
  effectHitBps: finiteInt,
  effectResistBps: finiteInt,
}).strict();

const equipmentAffixRollSchema = z.object({
  affixId: entityIdSchema,
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  roll: nonNegativeInt,
  craftEmpowered: z.boolean(),
  reforged: z.boolean(),
}).strict();

const skillAffixRollSchema = z.object({
  skillAffixId: entityIdSchema,
  roll: nonNegativeInt,
  reforged: z.boolean(),
}).strict();

const saveEquipmentInstanceSchema = z.object({
  instanceId: entityIdSchema,
  baseId: entityIdSchema,
  itemLevel: positiveInt,
  quality: equipmentQualitySchema,
  craftGrade: craftGradeSchema,
  affixes: z.array(equipmentAffixRollSchema),
  abyssAffix: equipmentAffixRollSchema.nullable(),
  locked: z.boolean(),
  acquiredAt: z.string().datetime({ offset: true }),
  sourceTransactionId: entityIdSchema,
  reforgeLockedIndex: nonNegativeInt.nullable(),
  reforgeCount: nonNegativeInt.max(2_147_483_647),
}).strict();

const saveSkillStoneInstanceSchema = z.object({
  instanceId: entityIdSchema,
  attunedCharacterId: entityIdSchema,
  itemLevel: positiveInt,
  quality: skillStoneQualitySchema,
  affixes: z.array(skillAffixRollSchema),
  abyssAffix: skillAffixRollSchema.nullable(),
  locked: z.boolean(),
  acquiredAt: z.string().datetime({ offset: true }),
  sourceTransactionId: entityIdSchema,
  reforgeLockedIndex: nonNegativeInt.nullable(),
  reforgeCount: nonNegativeInt.max(2_147_483_647),
}).strict();

const characterProgressSchema = z.object({
  characterId: entityIdSchema,
  recruited: z.boolean(),
  level: positiveInt.max(50),
  xp: nonNegativeInt,
  currentHp: nonNegativeInt,
  skillPoints: nonNegativeInt,
  skillLevels: z.record(entityIdSchema, z.number().finite().int().min(0).max(5)),
  equippedActiveSkillIds: z.tuple([entityIdSchema.nullable(), entityIdSchema.nullable()]),
  equipmentBySlot: z.object({
    weapon: entityIdSchema.nullable(),
    helmet: entityIdSchema.nullable(),
    armor: entityIdSchema.nullable(),
    gloves: entityIdSchema.nullable(),
    boots: entityIdSchema.nullable(),
    accessory: entityIdSchema.nullable(),
  }).strict(),
  skillStoneInstanceId: entityIdSchema.nullable(),
}).strict();

const inventorySchema = z.object({
  equipment: z.array(saveEquipmentInstanceSchema),
  skillStones: z.array(saveSkillStoneInstanceSchema),
  stackables: z.record(entityIdSchema, nonNegativeInt.max(9_999)),
  overflowEquipment: z.array(saveEquipmentInstanceSchema),
  overflowSkillStones: z.array(saveSkillStoneInstanceSchema),
}).strict();

const partySchema = z.object({
  slots: z.tuple([
    entityIdSchema.nullable(),
    entityIdSchema.nullable(),
    entityIdSchema.nullable(),
    entityIdSchema.nullable(),
  ]),
}).strict();

const worldSchema = z.object({
  highestUnlockedFloor: finiteInt,
  clearedBossEncounterIds: z.array(entityIdSchema),
  bossRetryUnlockedFloorIds: z.array(entityIdSchema),
  completedQuestIds: z.array(entityIdSchema),
  discoveredComboIds: z.array(entityIdSchema),
  discoveredEnemyIds: z.array(entityIdSchema),
  echoCharges: nonNegativeInt.max(5),
  echoAttemptSequence: safeInt,
  clearedEchoIds: z.array(entityIdSchema),
  storyCompleted: z.boolean(),
}).strict();

const expeditionSchema = z.object({
  expeditionId: entityIdSchema,
  expeditionSeed: z.number().finite().int().min(0).max(0xffff_ffff),
  mode: z.enum(["exploration", "shortFarm", "bossRetry", "abyssEcho"]),
  abyssEchoId: entityIdSchema.nullable(),
  floorId: entityIdSchema,
  mapId: entityIdSchema,
  playerPosition: vector2Schema,
  safePosition: vector2Schema,
  defeatedEncounterObjectIds: z.array(entityIdSchema),
  openedChestObjectIds: z.array(entityIdSchema),
  encounterProtectionStepsRemaining: finiteInt,
  focusedEliteStoneConsumed: z.boolean(),
  startedAt: z.string().datetime({ offset: true }),
}).strict();

const battleAssistSchema = z.object({
  enabled: z.boolean(),
  lastActionByCharacter: z.record(entityIdSchema, z.union([
    z.object({ kind: z.literal("basic") }).strict(),
    z.object({ kind: z.literal("active"), skillId: entityIdSchema }).strict(),
  ]).nullable()),
}).strict();

const settingsSchema = z.object({
  qualityPreset: z.enum(["battery", "standard", "high"]),
  battleAnimationSpeed: z.union([z.literal(1), z.literal(2)]),
  musicVolume: finiteInt.min(0).max(100),
  sfxVolume: finiteInt.min(0).max(100),
  reducedFlashes: z.boolean(),
  reducedScreenShake: z.boolean(),
}).strict();

const shopOfferSchema = z.discriminatedUnion("kind", [
  z.object({ offerId: entityIdSchema, kind: z.literal("stackableItem"), itemId: entityIdSchema, quantity: positiveInt, goldPrice: nonNegativeInt, sold: z.boolean() }).strict(),
  z.object({ offerId: entityIdSchema, kind: z.literal("equipment"), equipment: saveEquipmentInstanceSchema, goldPrice: nonNegativeInt, sold: z.boolean() }).strict(),
  z.object({ offerId: entityIdSchema, kind: z.literal("skillStone"), skillStone: saveSkillStoneInstanceSchema, goldPrice: nonNegativeInt, sold: z.boolean() }).strict(),
]);
const shopSchema = z.object({
  stockRevision: positiveInt,
  generatedFromExpeditionId: entityIdSchema.nullable(),
  offers: z.array(shopOfferSchema),
}).strict();

const runtimeStatusSchema = z.object({
  stackId: entityIdSchema,
  statusId: entityIdSchema,
  sourceUnitId: entityIdSchema,
  remainingOwnerTurns: nonNegativeInt,
  skipNextOwnerTurnEndDecrement: z.boolean(),
  sourceAttackSnapshot: nonNegativeInt,
  shieldRemaining: nonNegativeInt,
}).strict();

const triggerSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("combo"), comboId: entityIdSchema, ownerKey: entityIdSchema }).strict(),
  z.object({ kind: z.literal("equipmentAffix"), affixId: entityIdSchema, ownerUnitId: entityIdSchema, sourceInstanceId: entityIdSchema, sourceRollIndex: z.union([nonNegativeInt, z.literal("abyss")]) }).strict(),
  z.object({ kind: z.literal("skillAffix"), skillAffixId: entityIdSchema, ownerUnitId: entityIdSchema, sourceInstanceId: entityIdSchema, sourceRollIndex: z.union([nonNegativeInt, z.literal("abyss")]) }).strict(),
  z.object({ kind: z.literal("status"), statusId: entityIdSchema, statusStackId: entityIdSchema, ownerUnitId: entityIdSchema }).strict(),
]);

const battleActionDefinitionIdSchema = z.union([entityIdSchema, z.enum(["action_defend", "action_retreat", "action_skip_control", "action_declare_intent"])]);
const battleEventBaseSchema = z.object({
  eventId: entityIdSchema,
  sequence: nonNegativeInt,
  battleId: entityIdSchema,
  round: positiveInt,
  rootActionId: entityIdSchema.nullable(),
  rootActionDefinitionId: battleActionDefinitionIdSchema.nullable(),
  chainDepth: nonNegativeInt,
  triggerSource: triggerSourceSchema.nullable(),
  visualSkillId: entityIdSchema.nullable(),
  contextSkillKind: z.enum(["basic", "active", "ultimate", "effect"]).nullable(),
  effect: effectSpecSchema.nullable(),
}).strict();

export const battleEventSchema = z.discriminatedUnion("type", [
  battleEventBaseSchema.extend({ type: z.literal("PHASE_CHANGED"), from: battlePhaseSchema, to: battlePhaseSchema }),
  battleEventBaseSchema.extend({ type: z.literal("ACTION_STARTED"), actorUnitId: entityIdSchema, actionKind: actionKindSchema.exclude(["effect"]), targetUnitIds: z.array(entityIdSchema) }),
  battleEventBaseSchema.extend({ type: z.literal("INTENT_DECLARED"), intentId: entityIdSchema, sourceUnitId: entityIdSchema, skillId: entityIdSchema, targetStrategy: targetStrategySchema }),
  battleEventBaseSchema.extend({ type: z.literal("INTENT_RELEASED"), intentId: entityIdSchema, sourceUnitId: entityIdSchema, skillId: entityIdSchema }),
  battleEventBaseSchema.extend({ type: z.literal("INTENT_CLEARED"), intentId: entityIdSchema, sourceUnitId: entityIdSchema, reason: z.enum(["sourceDefeated", "battleFinished"]) }),
  battleEventBaseSchema.extend({ type: z.literal("DAMAGE_RESOLVED"), sourceUnitId: entityIdSchema, targetUnitId: entityIdSchema, effectIndex: nonNegativeInt, hitIndex: nonNegativeInt, damageKind: z.enum(["direct", "periodic"]), element: elementSchema, hitResult: z.enum(["critical", "nonCritical", "notApplicable"]), varianceBps: bps.nullable(), effectiveDefense: nonNegativeInt, elementMultiplierBps: z.union([z.literal(7500), z.literal(10000), z.literal(12500)]), shieldDamage: nonNegativeInt, hpDamage: nonNegativeInt, overkill: nonNegativeInt, hpBefore: nonNegativeInt, hpAfter: nonNegativeInt }),
  battleEventBaseSchema.extend({ type: z.literal("HEAL_RESOLVED"), sourceUnitId: entityIdSchema, targetUnitId: entityIdSchema, effectIndex: nonNegativeInt, hitResult: z.enum(["critical", "nonCritical", "notApplicable"]), healed: nonNegativeInt, overheal: nonNegativeInt, hpBefore: nonNegativeInt, hpAfter: nonNegativeInt }),
  battleEventBaseSchema.extend({ type: z.literal("SHIELD_GRANTED"), sourceUnitId: entityIdSchema, targetUnitId: entityIdSchema, effectIndex: nonNegativeInt, statusStackId: entityIdSchema.nullable(), granted: nonNegativeInt, discardedByCap: nonNegativeInt, shieldAfter: nonNegativeInt }),
  battleEventBaseSchema.extend({ type: z.literal("STATUS_CHANGED"), sourceUnitId: entityIdSchema.nullable(), targetUnitId: entityIdSchema, statusId: entityIdSchema, statusStackId: entityIdSchema.nullable(), change: z.enum(["applied", "refreshed", "stacked", "capped", "consumed", "dispelled", "expired", "resisted", "immune", "depleted"]), stacksBefore: nonNegativeInt, stacksAfter: nonNegativeInt, remainingOwnerTurnsAfter: nonNegativeInt }),
  battleEventBaseSchema.extend({ type: z.literal("RESOURCE_CHANGED"), targetUnitId: entityIdSchema, resource: z.enum(["energy", "cooldown"]), skillId: entityIdSchema.nullable(), before: nonNegativeInt, after: nonNegativeInt, reason: z.enum(["actionCost", "actionGain", "directHit", "damageTaken", "turnEnd", "effect"]) }),
  battleEventBaseSchema.extend({ type: z.literal("UNIT_SUMMONED"), sourceUnitId: entityIdSchema, unitId: entityIdSchema, enemyId: entityIdSchema, slot: nonNegativeInt, eligibleRound: positiveInt }),
  battleEventBaseSchema.extend({ type: z.literal("UNIT_DEFEATED"), sourceUnitId: entityIdSchema.nullable(), unitId: entityIdSchema }),
  battleEventBaseSchema.extend({ type: z.literal("UNIT_REVIVED"), sourceUnitId: entityIdSchema, unitId: entityIdSchema, restoredHp: nonNegativeInt }),
  battleEventBaseSchema.extend({ type: z.literal("TURN_SKIPPED"), unitId: entityIdSchema, reason: z.enum(["defeated", "control"]), statusId: entityIdSchema.nullable() }),
  battleEventBaseSchema.extend({ type: z.literal("EXTRA_TURN_RESOLVED"), unitId: entityIdSchema, result: z.enum(["granted", "suppressed"]) }),
  battleEventBaseSchema.extend({ type: z.literal("COMBO_TRIGGERED"), comboId: entityIdSchema, ownerKey: entityIdSchema, targetUnitIds: z.array(entityIdSchema), firstInBattle: z.boolean() }),
  battleEventBaseSchema.extend({ type: z.literal("TRIGGER_REJECTED"), sourceKey: entityIdSchema, reason: z.enum(["CHAIN_DEPTH", "ROOT_BUDGET", "ROUND_BUDGET", "BATTLE_BUDGET", "UNIT_DAMAGE_BUDGET", "GLOBAL_EVENT_BUDGET", "SOURCE_INVALID", "TARGET_INVALID", "CHANCE_FAILED"]), consumedRng: z.boolean() }),
  battleEventBaseSchema.extend({ type: z.literal("ACTION_FINISHED"), actorUnitId: entityIdSchema, outcomeAfter: z.enum(["ongoing", "victory", "defeat", "retreat"]) }),
  battleEventBaseSchema.extend({ type: z.literal("BATTLE_FINISHED"), outcome: z.enum(["victory", "defeat", "retreat"]) }),
  battleEventBaseSchema.extend({ type: z.literal("ABYSS_ECHO_EVALUATED"), echoId: entityIdSchema, success: z.boolean(), failedReasons: z.array(z.enum(["MAX_ROUNDS", "MAX_KNOCKOUTS", "COMBO_REQUIRED"])) }),
  battleEventBaseSchema.extend({ type: z.literal("REWARD_PREPARED"), transactionId: entityIdSchema }),
]);

const battleUnitSchema = z.object({
  unitId: entityIdSchema,
  definitionId: entityIdSchema,
  faction: z.enum(["party", "enemy"]),
  slot: nonNegativeInt,
  level: positiveInt.max(50),
  prePercentStats: statBlockSchema,
  staticPercentByStatBps: statRecordSchema,
  stats: statBlockSchema,
  currentHp: nonNegativeInt,
  energy: nonNegativeInt,
  cooldowns: z.record(entityIdSchema, nonNegativeInt),
  statuses: z.array(runtimeStatusSchema),
  eligibleRound: positiveInt,
  usedExtraTurnThisRound: z.boolean(),
  directHitEnergyRootActionIds: z.array(entityIdSchema),
}).strict();
const pendingBattleEventSchema = z.object({
  eventId: entityIdSchema,
  rootActionId: entityIdSchema,
  rootActionDefinitionId: battleActionDefinitionIdSchema,
  chainDepth: nonNegativeInt,
  sourceUnitId: entityIdSchema,
  targetUnitIds: z.array(entityIdSchema),
  effectIndex: nonNegativeInt,
  effect: effectSpecSchema,
  triggerSource: triggerSourceSchema.nullable(),
  visualSkillId: entityIdSchema.nullable(),
  contextSkillKind: z.enum(["basic", "active", "ultimate", "effect"]).nullable(),
}).strict();
const pendingBossIntentSchema = z.object({
  intentId: entityIdSchema,
  sourceUnitId: entityIdSchema,
  skillId: entityIdSchema,
  targetStrategy: targetStrategySchema,
  declaredRound: positiveInt,
}).strict();
const battleDamageMetricSchema = z.object({
  sourceFaction: z.enum(["party", "enemy"]),
  sourceKind: z.enum(["skill", "item", "combo", "equipmentAffix", "skillAffix", "status"]),
  sourceDefinitionId: entityIdSchema,
  element: elementSchema,
  resolvedDamage: nonNegativeInt,
  weaknessResolvedDamage: nonNegativeInt,
}).strict();
const battleMetricsSchema = z.object({
  damage: z.array(battleDamageMetricSchema),
  partyDamageTaken: nonNegativeInt,
  partyHealingDone: nonNegativeInt,
  partyShieldGranted: nonNegativeInt,
  knockouts: z.array(z.object({ unitId: entityIdSchema, round: positiveInt, rootActionId: entityIdSchema }).strict()),
  comboTriggerCounts: z.record(entityIdSchema, nonNegativeInt),
  bossEnrageCast: z.boolean(),
  maxChainDepth: nonNegativeInt,
  triggerBudgetExhaustedCount: nonNegativeInt,
}).strict();
const rewardSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("encounter"), encounterId: entityIdSchema, mapId: entityIdSchema, objectId: entityIdSchema }).strict(),
  z.object({ kind: z.literal("chest"), mapId: entityIdSchema, objectId: entityIdSchema, dropTableId: entityIdSchema }).strict(),
  z.object({ kind: z.literal("abyssEcho"), echoId: entityIdSchema, encounterId: entityIdSchema }).strict(),
]);
const rewardSchema = z.object({
  transactionId: entityIdSchema,
  source: rewardSourceSchema,
  gold: nonNegativeInt,
  xp: nonNegativeInt,
  stackables: z.record(entityIdSchema, positiveInt),
  stackableCapConversions: z.array(z.object({ itemId: entityIdSchema, quantity: positiveInt, gold: nonNegativeInt }).strict()),
  equipment: z.array(saveEquipmentInstanceSchema),
  skillStones: z.array(saveSkillStoneInstanceSchema),
  instanceOrder: z.array(entityIdSchema),
  claimed: z.boolean(),
}).strict();
const battleSnapshotSchema = z.object({
  battleId: entityIdSchema,
  expeditionId: entityIdSchema,
  battleRevision: nonNegativeInt,
  encounterId: entityIdSchema,
  encounterObjectId: z.string(),
  phase: battlePhaseSchema,
  outcome: z.enum(["ongoing", "victory", "defeat", "retreat"]),
  // INIT 快照尚未进入第一轮，允许使用 0；进入任何可行动阶段后由不变量要求 >=1。
  round: nonNegativeInt,
  units: z.array(battleUnitSchema),
  initiativeQueueUnitIds: z.array(entityIdSchema),
  currentUnitId: entityIdSchema.nullable(),
  pendingEvents: z.array(pendingBattleEventSchema),
  pendingBossIntents: z.array(pendingBossIntentSchema),
  successfulItemUses: nonNegativeInt,
  abyssEchoOutcome: z.enum(["notApplicable", "pending", "success", "failed"]),
  rngState: z.tuple([finiteInt, finiteInt, finiteInt, finiteInt]),
  firedComboKeys: z.array(entityIdSchema),
  roundTriggerCounts: z.record(entityIdSchema, nonNegativeInt),
  battleTriggerCounts: z.record(entityIdSchema, nonNegativeInt),
  metrics: battleMetricsSchema,
  reward: rewardSchema.nullable(),
  returnMapId: entityIdSchema,
  returnSafePosition: vector2Schema,
}).strict();

export const gameSaveV1Schema = z.object({
  schemaVersion: z.literal(1),
  contentVersion: z.literal("content-1.2.0"),
  saveId: z.literal("slot_1"),
  revision: positiveInt,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  gold: nonNegativeInt,
  skillStoneFocusCharacterId: entityIdSchema,
  characters: z.record(entityIdSchema, characterProgressSchema),
  party: partySchema,
  inventory: inventorySchema,
  shop: shopSchema,
  world: worldSchema,
  expedition: expeditionSchema.nullable(),
  battle: battleSnapshotSchema.nullable(),
  battleAssist: battleAssistSchema,
  settings: settingsSchema,
  claimedRewardTransactionIds: z.array(entityIdSchema),
}).strict();

export type GameSaveValidationIssue = { path: string; issueKey: string };

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function knownIds<T extends { id: string }>(values: readonly T[]): Set<string> {
  return new Set(values.map((value) => value.id));
}

function exactKeys(actual: Record<string, unknown>, expected: readonly string[]): boolean {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = [...expected].sort();
  return actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function initialMaxHp(character: CharacterDefinition, content?: ContentRootV1): number {
  let maxHp = character.baseStats.maxHp;
  let percentBps = 0;
  const passive = content?.skills.find((skill) => skill.id === character.passiveSkillId);
  for (const modifier of passive?.passiveModifiers ?? []) {
    if (modifier.kind === "flatStat" && modifier.stat === "maxHp") maxHp += modifier.value;
    if (modifier.kind === "percentStat" && modifier.stat === "maxHp") percentBps += modifier.valueBps;
  }
  return Math.max(1, Math.floor((maxHp * (10_000 + percentBps)) / 10_000));
}

/**
 * 只把角色当前引用的装备计入静态生命上限；背包里未装备的物品不能
 * 改变上限，否则把一件物品放进背包就会绕过 currentHp 的越界检查。
 * RPG-008 完成后会复用同一公式；这里仅实现存档边界需要的 maxHp 部分。
 */
function staticMaxHp(
  character: CharacterDefinition,
  progress: CharacterProgressV1,
  save: GameSaveV1,
  content: ContentRootV1,
): number {
  // 先合并基础生命和等级成长，再统一叠加 flat，最后一次性应用百分比。
  // 该顺序必须与 ProgressionService、EquipmentService 的静态属性公式一致。
  let maxHp = character.baseStats.maxHp + character.growthPerLevel.maxHp * (progress.level - 1);
  let percentBps = 0;
  const passive = content.skills.find((skill) => skill.id === character.passiveSkillId);
  for (const modifier of passive?.passiveModifiers ?? []) {
    if (modifier.kind === "flatStat" && modifier.stat === "maxHp") maxHp += modifier.value;
    if (modifier.kind === "percentStat" && modifier.stat === "maxHp") percentBps += modifier.valueBps;
  }
  const equipmentById = new Map(save.inventory.equipment.map((instance) => [instance.instanceId, instance]));
  const equipped = Object.values(progress.equipmentBySlot)
    .map((instanceId) => (instanceId === null ? null : equipmentById.get(instanceId) ?? null))
    .filter((instance): instance is EquipmentInstance => instance !== null);
  for (const instance of equipped) {
    const base = content.equipmentBases.find((definition) => definition.id === instance.baseId);
    if (base?.baseStat === "maxHp") {
      maxHp += base.baseValueAtMinLevel + base.growthPerItemLevel * (instance.itemLevel - base.minItemLevel);
    }
    const rolls = instance.abyssAffix === null ? instance.affixes : [...instance.affixes, instance.abyssAffix];
    for (const roll of rolls) {
      const definition = content.equipmentAffixes.find((value) => value.id === roll.affixId);
      const tier = definition?.tiers.find((value) => value.tier === roll.tier);
      if (!definition || !tier) continue;
      const effectiveRoll = roll.craftEmpowered ? Math.floor((roll.roll * 12_500) / 10_000) : roll.roll;
      for (const modifier of definition.modifiers) {
        if (modifier.kind === "flatStat" && modifier.stat === "maxHp") {
          maxHp += Math.floor((effectiveRoll * modifier.rollScaleBps) / 10_000);
        } else if (modifier.kind === "percentStat" && modifier.stat === "maxHp") {
          percentBps += Math.floor((effectiveRoll * modifier.rollScaleBps) / 10_000);
        }
      }
    }
  }
  return Math.max(1, Math.floor((maxHp * (10_000 + percentBps)) / 10_000));
}

function validateRecordKeys(
  save: GameSaveV1,
  content: ContentRootV1,
): DomainResult<GameSaveV1> | null {
  const characterIds = content.characters.map((character) => character.id);
  const itemIds = content.items.map((item) => item.id);
  if (!exactKeys(save.characters, characterIds)) return invalid("characters", "character_key_set");
  if (!exactKeys(save.inventory.stackables, itemIds)) return invalid("inventory.stackables", "item_key_set");
  if (!exactKeys(save.battleAssist.lastActionByCharacter, characterIds)) return invalid("battleAssist.lastActionByCharacter", "character_key_set");
  if (content.shops.length > 0 && save.shop.generatedFromExpeditionId === null && save.shop.offers.length === 0) return invalid("shop.offers", "initial_offers_required");
  for (const character of content.characters) {
    const progress = save.characters[character.id];
    if (progress.characterId !== character.id) return invalid(`characters.${character.id}.characterId`, "character_id_mismatch");
    if (!exactKeys(progress.skillLevels, character.activeSkillIds)) return invalid(`characters.${character.id}.skillLevels`, "active_skill_key_set");
    for (const [skillId, skillLevel] of Object.entries(progress.skillLevels)) {
      if (!character.activeSkillIds.includes(skillId)) return invalid(`characters.${character.id}.skillLevels.${skillId}`, "unknown_skill");
      const definition = content.skills.find((skill) => skill.id === skillId);
      if (definition && skillLevel > 0 && definition.unlockLevel > progress.level) return invalid(`characters.${character.id}.skillLevels.${skillId}`, "skill_level_locked");
      if (definition && skillLevel > definition.maxLevel) return invalid(`characters.${character.id}.skillLevels.${skillId}`, "skill_level_max");
    }
    if (progress.equippedActiveSkillIds[0] !== null && !character.activeSkillIds.includes(progress.equippedActiveSkillIds[0])) return invalid(`characters.${character.id}.equippedActiveSkillIds`, "equipped_skill_not_owned");
    if (progress.equippedActiveSkillIds[1] !== null && !character.activeSkillIds.includes(progress.equippedActiveSkillIds[1])) return invalid(`characters.${character.id}.equippedActiveSkillIds`, "equipped_skill_not_owned");
    if (progress.equippedActiveSkillIds[0] !== null && progress.equippedActiveSkillIds[0] === progress.equippedActiveSkillIds[1]) return invalid(`characters.${character.id}.equippedActiveSkillIds`, "duplicate_equipped_skill");
    for (const equippedSkillId of progress.equippedActiveSkillIds) {
      if (equippedSkillId !== null && progress.skillLevels[equippedSkillId] < 1) return invalid(`characters.${character.id}.equippedActiveSkillIds`, "equipped_skill_level_zero");
    }
    if (progress.currentHp > staticMaxHp(character, progress, save, content)) return invalid(`characters.${character.id}.currentHp`, "current_hp_over_max");
    const assist = save.battleAssist.lastActionByCharacter[character.id];
    if (assist?.kind === "active" && !character.activeSkillIds.includes(assist.skillId)) return invalid(`battleAssist.lastActionByCharacter.${character.id}`, "active_skill_not_owned");
  }
  if (!characterIds.includes(save.skillStoneFocusCharacterId)) return invalid("skillStoneFocusCharacterId", "unknown_character");
  if (!save.characters[save.skillStoneFocusCharacterId].recruited) return invalid("skillStoneFocusCharacterId", "character_not_recruited");
  const partyIds = save.party.slots.filter((id): id is string => id !== null);
  if (!save.party.slots.includes(content.protagonistCharacterId)) return invalid("party.slots", "protagonist_required");
  if (!unique(partyIds)) return invalid("party.slots", "duplicate_character");
  for (const characterId of partyIds) {
    if (!characterIds.includes(characterId)) return invalid("party.slots", "unknown_character");
    if (!save.characters[characterId].recruited) return invalid("party.slots", "character_not_recruited");
  }
  return null;
}

function expectedEquipmentAffixCount(quality: EquipmentInstance["quality"]): number {
  return quality === "common" ? 0 : quality === "magic" ? 2 : quality === "rare" ? 3 : 4;
}

function expectedSkillStoneAffixCount(quality: SkillStoneInstance["quality"]): number {
  return quality === "magic" ? 1 : quality === "rare" ? 2 : 3;
}

function highestEligibleTier(definition: { tiers: Array<{ tier: 1 | 2 | 3 | 4 | 5; minItemLevel: number }> }, itemLevel: number): 1 | 2 | 3 | 4 | 5 | null {
  return [...definition.tiers].filter((tier) => tier.minItemLevel <= itemLevel).pop()?.tier ?? null;
}

function validateEquipmentInstance(
  instance: EquipmentInstance,
  path: string,
  content: ContentRootV1,
): DomainResult<GameSaveV1> | null {
  const base = content.equipmentBases.find((definition) => definition.id === instance.baseId);
  if (!base) return invalid(`${path}.baseId`, "unknown_equipment_base");
  if (instance.itemLevel < base.minItemLevel || instance.itemLevel > base.maxItemLevel) return invalid(`${path}.itemLevel`, "equipment_item_level_range");
  if (instance.reforgeLockedIndex !== null && (instance.reforgeLockedIndex < 0 || instance.reforgeLockedIndex >= instance.affixes.length)) return invalid(`${path}.reforgeLockedIndex`, "reforge_index_range");
  if (instance.abyssAffix !== null && instance.quality !== "abyss") return invalid(`${path}.abyssAffix`, "abyss_quality_required");
  if (instance.abyssAffix === null && instance.quality === "abyss") return invalid(`${path}.abyssAffix`, "abyss_affix_required");
  if (instance.affixes.length !== expectedEquipmentAffixCount(instance.quality)) return invalid(`${path}.affixes`, "equipment_affix_count");
  const usedIds = new Set<string>();
  const usedExclusiveGroups = new Set<string>();
  const validateRoll = (roll: EquipmentInstance["affixes"][number], rollPath: string, expectedPool: "normal" | "abyss"): DomainResult<GameSaveV1> | null => {
    const definition = content.equipmentAffixes.find((candidate) => candidate.id === roll.affixId);
    if (!definition) return invalid(`${rollPath}.affixId`, "unknown_equipment_affix");
    if (definition.pool !== expectedPool) return invalid(`${rollPath}.affixId`, "equipment_affix_pool_mismatch");
    if (!definition.allowedSlots.includes(base.slot)) return invalid(`${rollPath}.affixId`, "equipment_affix_slot_mismatch");
    if (base.slot !== "weapon" && definition.allowedWeaponTypes.length > 0) return invalid(`${rollPath}.affixId`, "equipment_weapon_filter_mismatch");
    if (base.slot === "weapon" && definition.allowedWeaponTypes.length > 0 && (base.weaponType === null || !definition.allowedWeaponTypes.includes(base.weaponType))) return invalid(`${rollPath}.affixId`, "equipment_weapon_filter_mismatch");
    if (!definition.allowedQualities.includes(instance.quality)) return invalid(`${rollPath}.affixId`, "equipment_affix_quality_mismatch");
    if (definition.pool === "abyss" && (definition.allowedQualities.length !== 1 || !definition.allowedQualities.includes("abyss"))) return invalid(`${rollPath}.affixId`, "abyss_affix_quality_definition");
    if (definition.minItemLevel > instance.itemLevel) return invalid(`${rollPath}.affixId`, "equipment_affix_item_level");
    const tier = definition.tiers.find((candidate) => candidate.tier === roll.tier);
    const highestTier = highestEligibleTier(definition, instance.itemLevel);
    if (!tier || highestTier === null || roll.tier !== highestTier) return invalid(`${rollPath}.tier`, "equipment_affix_tier");
    if (roll.roll < tier.rollMin || roll.roll > tier.rollMax) return invalid(`${rollPath}.roll`, "equipment_affix_roll_range");
    if (roll.craftEmpowered && (expectedPool === "abyss" || !definition.canBeCraftEmpowered)) return invalid(`${rollPath}.craftEmpowered`, "equipment_craft_target_invalid");
    if (usedIds.has(definition.id)) return invalid(`${rollPath}.affixId`, "duplicate_equipment_affix");
    if (definition.exclusiveGroup !== null && usedExclusiveGroups.has(definition.exclusiveGroup)) return invalid(`${rollPath}.affixId`, "equipment_affix_exclusive_conflict");
    usedIds.add(definition.id);
    if (definition.exclusiveGroup !== null) usedExclusiveGroups.add(definition.exclusiveGroup);
    return null;
  };
  for (const [index, roll] of instance.affixes.entries()) {
    const error = validateRoll(roll, `${path}.affixes.${index}`, "normal");
    if (error) return error;
  }
  if (instance.abyssAffix !== null) {
    const error = validateRoll(instance.abyssAffix, `${path}.abyssAffix`, "abyss");
    if (error) return error;
  }
  const empoweredCount = instance.affixes.filter((roll) => roll.craftEmpowered).length;
  const expectedEmpowered = instance.craftGrade === "ordinary" ? 0 : instance.craftGrade === "tempered" ? 1 : 2;
  if (empoweredCount !== expectedEmpowered) return invalid(`${path}.craftGrade`, "equipment_craft_count");
  return null;
}

function validateSkillStoneInstance(
  instance: SkillStoneInstance,
  path: string,
  content: ContentRootV1,
): DomainResult<GameSaveV1> | null {
  if (!knownIds(content.characters).has(instance.attunedCharacterId)) return invalid(`${path}.attunedCharacterId`, "unknown_character");
  if (instance.reforgeLockedIndex !== null && (instance.reforgeLockedIndex < 0 || instance.reforgeLockedIndex >= instance.affixes.length)) return invalid(`${path}.reforgeLockedIndex`, "reforge_index_range");
  if (instance.abyssAffix !== null && instance.quality !== "abyss") return invalid(`${path}.abyssAffix`, "abyss_quality_required");
  if (instance.abyssAffix === null && instance.quality === "abyss") return invalid(`${path}.abyssAffix`, "abyss_affix_required");
  if (instance.affixes.length !== expectedSkillStoneAffixCount(instance.quality)) return invalid(`${path}.affixes`, "skill_stone_affix_count");
  const usedIds = new Set<string>();
  const usedExclusiveGroups = new Set<string>();
  const validateRoll = (roll: SkillStoneInstance["affixes"][number], rollPath: string, expectedPool: "normal" | "abyss"): DomainResult<GameSaveV1> | null => {
    const definition = content.skillAffixes.find((candidate) => candidate.id === roll.skillAffixId);
    if (!definition) return invalid(`${rollPath}.skillAffixId`, "unknown_skill_affix");
    if (definition.pool !== expectedPool) return invalid(`${rollPath}.skillAffixId`, "skill_affix_pool_mismatch");
    if (!definition.allowedQualities.includes(instance.quality)) return invalid(`${rollPath}.skillAffixId`, "skill_affix_quality_mismatch");
    if (definition.pool === "abyss" && (definition.allowedQualities.length !== 1 || !definition.allowedQualities.includes("abyss"))) return invalid(`${rollPath}.skillAffixId`, "abyss_skill_affix_quality_definition");
    if (definition.minItemLevel > instance.itemLevel) return invalid(`${rollPath}.skillAffixId`, "skill_affix_item_level");
    if (roll.roll < definition.rollMin || roll.roll > definition.rollMax) return invalid(`${rollPath}.roll`, "skill_affix_roll_range");
    if (usedIds.has(definition.id)) return invalid(`${rollPath}.skillAffixId`, "duplicate_skill_affix");
    if (definition.exclusiveGroup !== null && usedExclusiveGroups.has(definition.exclusiveGroup)) return invalid(`${rollPath}.skillAffixId`, "skill_affix_exclusive_conflict");
    usedIds.add(definition.id);
    if (definition.exclusiveGroup !== null) usedExclusiveGroups.add(definition.exclusiveGroup);
    return null;
  };
  for (const [index, roll] of instance.affixes.entries()) {
    const error = validateRoll(roll, `${path}.affixes.${index}`, "normal");
    if (error) return error;
  }
  if (instance.abyssAffix !== null) {
    const error = validateRoll(instance.abyssAffix, `${path}.abyssAffix`, "abyss");
    if (error) return error;
  }
  return null;
}

function validateInventory(save: GameSaveV1, content: ContentRootV1): DomainResult<GameSaveV1> | null {
  // 120/80 是包含已装备实例的主背包容量；溢出仓另按共享 30 格计算。
  if (save.inventory.equipment.length > 120) return invalid("inventory.equipment", "equipment_capacity");
  if (save.inventory.skillStones.length > 80) return invalid("inventory.skillStones", "skill_stone_capacity");
  const instanceIds = new Set<string>();
  const equipmentInstanceIds = new Set<string>();
  const skillStoneInstanceIds = new Set<string>();
  const characterIds = knownIds(content.characters);
  const equippedInstanceIds = new Set<string>();
  const checkEquipment = (equipment: readonly EquipmentInstance[], path: string, overflow: boolean): DomainResult<GameSaveV1> | null => {
    for (const [index, instance] of equipment.entries()) {
      if (instanceIds.has(instance.instanceId)) return invalid(`${path}.${index}.instanceId`, "duplicate_instance_id");
      instanceIds.add(instance.instanceId);
      equipmentInstanceIds.add(instance.instanceId);
      if (overflow && instance.instanceId.length === 0) return invalid(`${path}.${index}.instanceId`, "invalid_instance_id");
      const dynamicError = validateEquipmentInstance(instance, `${path}.${index}`, content);
      if (dynamicError) return dynamicError;
    }
    return null;
  };
  const firstEquipmentError = checkEquipment(save.inventory.equipment, "inventory.equipment", false) ?? checkEquipment(save.inventory.overflowEquipment, "inventory.overflowEquipment", true);
  if (firstEquipmentError) return firstEquipmentError;
  for (const [index, instance] of save.inventory.skillStones.entries()) {
    if (instanceIds.has(instance.instanceId)) return invalid(`inventory.skillStones.${index}.instanceId`, "duplicate_instance_id");
    instanceIds.add(instance.instanceId);
    skillStoneInstanceIds.add(instance.instanceId);
    if (!characterIds.has(instance.attunedCharacterId)) return invalid(`inventory.skillStones.${index}.attunedCharacterId`, "unknown_character");
    const dynamicError = validateSkillStoneInstance(instance, `inventory.skillStones.${index}`, content);
    if (dynamicError) return dynamicError;
  }
  for (const [index, instance] of save.inventory.overflowSkillStones.entries()) {
    if (instanceIds.has(instance.instanceId)) return invalid(`inventory.overflowSkillStones.${index}.instanceId`, "duplicate_instance_id");
    instanceIds.add(instance.instanceId);
    skillStoneInstanceIds.add(instance.instanceId);
    const dynamicError = validateSkillStoneInstance(instance, `inventory.overflowSkillStones.${index}`, content);
    if (dynamicError) return dynamicError;
  }
  // 商店尚未售出的动态实例同样来自内容表，不能以“还没进背包”为由跳过引用校验。
  for (const [index, offer] of save.shop.offers.entries()) {
    if (offer.kind === "equipment") {
      if (instanceIds.has(offer.equipment.instanceId)) return invalid(`shop.offers.${index}.equipment.instanceId`, "duplicate_instance_id");
      instanceIds.add(offer.equipment.instanceId);
      const dynamicError = validateEquipmentInstance(offer.equipment, `shop.offers.${index}.equipment`, content);
      if (dynamicError) return dynamicError;
    } else if (offer.kind === "skillStone") {
      if (instanceIds.has(offer.skillStone.instanceId)) return invalid(`shop.offers.${index}.skillStone.instanceId`, "duplicate_instance_id");
      instanceIds.add(offer.skillStone.instanceId);
      const dynamicError = validateSkillStoneInstance(offer.skillStone, `shop.offers.${index}.skillStone`, content);
      if (dynamicError) return dynamicError;
    }
  }
  if (save.inventory.overflowEquipment.length + save.inventory.overflowSkillStones.length > 30) return invalid("inventory", "overflow_capacity");
  const equipmentById = new Map([...save.inventory.equipment, ...save.inventory.overflowEquipment].map((instance) => [instance.instanceId, instance]));
  const skillStoneById = new Map([...save.inventory.skillStones, ...save.inventory.overflowSkillStones].map((instance) => [instance.instanceId, instance]));
  for (const [characterId, progress] of Object.entries(save.characters)) {
    for (const [slot, instanceId] of Object.entries(progress.equipmentBySlot)) {
      if (instanceId !== null && !instanceIds.has(instanceId)) return invalid(`characters.${characterId}.equipmentBySlot.${slot}`, "unknown_instance");
      if (instanceId !== null && !equipmentInstanceIds.has(instanceId)) return invalid(`characters.${characterId}.equipmentBySlot.${slot}`, "equipment_slot_type_mismatch");
      if (instanceId !== null && save.inventory.overflowEquipment.some((instance) => instance.instanceId === instanceId)) return invalid(`characters.${characterId}.equipmentBySlot.${slot}`, "overflow_instance_equipped");
      if (instanceId !== null && equipmentById.get(instanceId) && content.equipmentBases.find((base) => base.id === equipmentById.get(instanceId)!.baseId)?.slot !== slot) return invalid(`characters.${characterId}.equipmentBySlot.${slot}`, "equipment_slot_mismatch");
      if (instanceId !== null && equippedInstanceIds.has(instanceId)) return invalid(`characters.${characterId}.equipmentBySlot.${slot}`, "duplicate_equipped_instance");
      if (instanceId !== null) equippedInstanceIds.add(instanceId);
    }
    if (progress.skillStoneInstanceId !== null && !instanceIds.has(progress.skillStoneInstanceId)) return invalid(`characters.${characterId}.skillStoneInstanceId`, "unknown_instance");
    if (progress.skillStoneInstanceId !== null && !skillStoneInstanceIds.has(progress.skillStoneInstanceId)) return invalid(`characters.${characterId}.skillStoneInstanceId`, "skill_stone_slot_type_mismatch");
    if (progress.skillStoneInstanceId !== null && save.inventory.overflowSkillStones.some((instance) => instance.instanceId === progress.skillStoneInstanceId)) return invalid(`characters.${characterId}.skillStoneInstanceId`, "overflow_instance_equipped");
    if (progress.skillStoneInstanceId !== null && skillStoneById.get(progress.skillStoneInstanceId)?.attunedCharacterId !== characterId) return invalid(`characters.${characterId}.skillStoneInstanceId`, "skill_stone_attuned_character_mismatch");
    if (progress.skillStoneInstanceId !== null && equippedInstanceIds.has(progress.skillStoneInstanceId)) return invalid(`characters.${characterId}.skillStoneInstanceId`, "duplicate_equipped_instance");
    if (progress.skillStoneInstanceId !== null) equippedInstanceIds.add(progress.skillStoneInstanceId);
  }
  return null;
}

function validateWorld(save: GameSaveV1, content: ContentRootV1): DomainResult<GameSaveV1> | null {
  if (save.world.highestUnlockedFloor < 1 || save.world.highestUnlockedFloor > 10) return invalid("world.highestUnlockedFloor", "floor_range");
  if (!Number.isInteger(save.world.echoCharges) || save.world.echoCharges < 0 || save.world.echoCharges > 5) return invalid("world.echoCharges", "echo_charge_range");
  const checks: Array<[string, readonly { id: string }[], readonly string[]]> = [
    ["clearedBossEncounterIds", content.encounters, save.world.clearedBossEncounterIds],
    ["completedQuestIds", content.quests, save.world.completedQuestIds],
    ["discoveredComboIds", content.combos, save.world.discoveredComboIds],
    ["discoveredEnemyIds", content.enemies, save.world.discoveredEnemyIds],
    ["clearedEchoIds", content.abyssEchoes, save.world.clearedEchoIds],
    ["bossRetryUnlockedFloorIds", content.floors, save.world.bossRetryUnlockedFloorIds],
  ];
  for (const [field, definitions, values] of checks) {
    if (!unique(values)) return invalid(`world.${field}`, "duplicate_id");
    const ids = knownIds(definitions);
    if (values.some((value) => !ids.has(value))) return invalid(`world.${field}`, "unknown_id");
  }
  if (save.world.clearedEchoIds.length > 0 && !save.world.storyCompleted) return invalid("world.clearedEchoIds", "story_required");
  if (save.world.storyCompleted && content.floors.length >= 10 && save.world.clearedBossEncounterIds.length !== 10) return invalid("world.storyCompleted", "story_clear_prefix");
  if (!unique(save.claimedRewardTransactionIds)) return invalid("claimedRewardTransactionIds", "duplicate_id");
  if (save.claimedRewardTransactionIds.length > 100) return invalid("claimedRewardTransactionIds", "capacity");
  if (content.floors.length >= 1 && content.encounters.length >= content.floors.length) {
    const floorByBoss = new Map(content.floors.map((floor) => [floor.bossEncounterId, floor.floorNumber]));
    const clearedNumbers = save.world.clearedBossEncounterIds.map((encounterId) => floorByBoss.get(encounterId));
    if (clearedNumbers.some((floorNumber) => floorNumber === undefined) || clearedNumbers.some((floorNumber, index) => floorNumber !== index + 1)) return invalid("world.clearedBossEncounterIds", "boss_clear_prefix");
    const expectedHighest = Math.min(10, clearedNumbers.length + 1);
    if (save.world.highestUnlockedFloor !== expectedHighest) return invalid("world.highestUnlockedFloor", "boss_clear_prefix");
    if (save.world.storyCompleted !== (clearedNumbers.length === 10)) return invalid("world.storyCompleted", "boss_clear_prefix");
  }
  return null;
}

function isWalkable(map: { widthTiles: number; heightTiles: number; collisionLayer: Array<0 | 1> }, position: { x: number; y: number }): boolean {
  // position 是脚底中心的逻辑像素坐标，碰撞盒固定为 12×8，而不是 tile 坐标。
  const left = position.x - 6;
  const right = position.x + 6;
  const top = position.y - 8;
  const bottom = position.y;
  const mapWidth = map.widthTiles * 16;
  const mapHeight = map.heightTiles * 16;
  if (left < 0 || top < 0 || right > mapWidth || bottom > mapHeight) return false;
  const firstTileX = Math.floor(left / 16);
  // AABB 采用 [left,right) / [top,bottom)；ceil-1 对整数边界也稳定，
  // 不依赖 Number.EPSILON 这种可能被 ULP 吃掉的微调。
  const lastTileX = Math.ceil(right / 16) - 1;
  const firstTileY = Math.floor(top / 16);
  const lastTileY = Math.ceil(bottom / 16) - 1;
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      if (map.collisionLayer[tileY * map.widthTiles + tileX] !== 0) return false;
    }
  }
  return true;
}

function validateExpedition(save: GameSaveV1, content: ContentRootV1): DomainResult<GameSaveV1> | null {
  const expedition = save.expedition;
  if (!expedition) return null;
  if (expedition.encounterProtectionStepsRemaining < 0 || expedition.encounterProtectionStepsRemaining > 180) return invalid("expedition.encounterProtectionStepsRemaining", "protection_range");
  if (expedition.mode === "abyssEcho" && expedition.abyssEchoId === null) return invalid("expedition.abyssEchoId", "echo_required");
  if (expedition.mode !== "abyssEcho" && expedition.abyssEchoId !== null) return invalid("expedition.abyssEchoId", "echo_only_mode");
  if ((expedition.mode === "bossRetry" || expedition.mode === "abyssEcho") && (expedition.defeatedEncounterObjectIds.length > 0 || expedition.openedChestObjectIds.length > 0)) return invalid("expedition", "detached_mode_objects");
  if ((expedition.mode === "bossRetry" || expedition.mode === "abyssEcho") && save.battle === null) return invalid("battle", "detached_mode_battle_required");
  if (!unique(expedition.defeatedEncounterObjectIds) || !unique(expedition.openedChestObjectIds)) return invalid("expedition", "duplicate_object_id");
  if (content.floors.length === 0 || content.maps.length === 0) return null;
  const floor = content.floors.find((value) => value.id === expedition.floorId);
  const map = content.maps.find((value) => value.id === expedition.mapId);
  if (!floor || !map) return invalid("expedition", "unknown_floor_or_map");
  if (floor.mapId !== map.id) return invalid("expedition.mapId", "floor_map_mismatch");
  if (floor.floorNumber > save.world.highestUnlockedFloor) return invalid("expedition.floorId", "floor_not_unlocked");
  if (!isWalkable(map, expedition.playerPosition) || !isWalkable(map, expedition.safePosition)) return invalid("expedition", "position_not_walkable");
  const encounterIds = new Set(map.objects.filter((object) => object.kind === "encounter").map((object) => object.objectId));
  const chestIds = new Set(map.objects.filter((object) => object.kind === "chest").map((object) => object.objectId));
  if (expedition.defeatedEncounterObjectIds.some((id) => !encounterIds.has(id))) return invalid("expedition.defeatedEncounterObjectIds", "unknown_encounter_object");
  if (expedition.openedChestObjectIds.some((id) => !chestIds.has(id))) return invalid("expedition.openedChestObjectIds", "unknown_chest_object");
  const encounterOrder = map.objects.filter((object) => object.kind === "encounter").map((object) => object.objectId);
  const chestOrder = map.objects.filter((object) => object.kind === "chest").map((object) => object.objectId);
  const isOrderedSubset = (values: readonly string[], order: readonly string[]): boolean => {
    let previous = -1;
    for (const value of values) {
      const index = order.indexOf(value);
      if (index <= previous) return false;
      previous = index;
    }
    return true;
  };
  if (!isOrderedSubset(expedition.defeatedEncounterObjectIds, encounterOrder)) return invalid("expedition.defeatedEncounterObjectIds", "map_object_order");
  if (!isOrderedSubset(expedition.openedChestObjectIds, chestOrder)) return invalid("expedition.openedChestObjectIds", "map_object_order");
  if (expedition.mode === "shortFarm" && expedition.defeatedEncounterObjectIds.some((id) => !floor.shortRouteObjectIds.includes(id))) return invalid("expedition.defeatedEncounterObjectIds", "short_route_only");
  if (expedition.mode === "bossRetry") {
    if (!save.world.bossRetryUnlockedFloorIds.includes(floor.id)) return invalid("expedition.floorId", "boss_retry_not_unlocked");
    if (save.world.clearedBossEncounterIds.includes(floor.bossEncounterId)) return invalid("expedition.floorId", "boss_already_cleared");
  }
  if (expedition.mode === "shortFarm" && !save.world.clearedBossEncounterIds.includes(floor.bossEncounterId)) return invalid("expedition.floorId", "short_farm_boss_not_cleared");
  if (expedition.mode === "abyssEcho") {
    const echo = content.abyssEchoes.find((value) => value.id === expedition.abyssEchoId);
    if (!echo || echo.floorId !== floor.id || echo.bossEncounterId !== floor.bossEncounterId || !floor.isAbyss || !save.world.storyCompleted) return invalid("expedition.abyssEchoId", "echo_floor_boss_mismatch");
    // 回响次数在开始事务中先扣除；活动中的远征允许保留 0 次，终局不会返还。
  }
  return null;
}

function validateBattle(save: GameSaveV1, content: ContentRootV1): DomainResult<GameSaveV1> | null {
  const battle = save.battle;
  if (!battle) return null;
  if (battle.phase === "INIT" && battle.round !== 0) return invalid("battle.round", "init_round_must_be_zero");
  if (battle.phase !== "INIT" && battle.round < 1) return invalid("battle.round", "round_must_be_positive");
  if (battle.pendingEvents.length > 0) return invalid("battle.pendingEvents", "stable_snapshot_pending_events");
  if (battle.phase !== "COMPLETE" && save.expedition === null) return invalid("battle", "expedition_required");
  if (save.expedition && battle.expeditionId !== save.expedition.expeditionId) return invalid("battle.expeditionId", "expedition_id_mismatch");
  const terminalEchoSnapshot = save.expedition === null && battle.phase === "COMPLETE" && battle.abyssEchoOutcome !== "notApplicable";
  const isEchoBattle = save.expedition?.mode === "abyssEcho" || terminalEchoSnapshot;
  if (battle.abyssEchoOutcome !== "notApplicable" && !isEchoBattle) return invalid("battle.abyssEchoOutcome", "echo_mode_required");
  if (save.expedition?.mode === "abyssEcho" && battle.abyssEchoOutcome === "notApplicable") return invalid("battle.abyssEchoOutcome", "echo_outcome_required");
  if (battle.abyssEchoOutcome !== "notApplicable" && save.expedition === null && battle.phase !== "COMPLETE") return invalid("battle", "echo_expedition_required");
  if (isEchoBattle) {
    if (battle.encounterObjectId !== "") return invalid("battle.encounterObjectId", "echo_object_must_be_empty");
    if (battle.returnMapId !== "map_town") return invalid("battle.returnMapId", "echo_return_map");
    const echoDefinition = save.expedition?.abyssEchoId === null || save.expedition?.abyssEchoId === undefined
      ? content.abyssEchoes.find((echo) => echo.bossEncounterId === battle.encounterId)
      : content.abyssEchoes.find((echo) => echo.id === save.expedition?.abyssEchoId);
    if (!echoDefinition || echoDefinition.bossEncounterId !== battle.encounterId) return invalid("battle.encounterId", "echo_boss_mismatch");
  }
  if (!isEchoBattle && save.expedition && battle.returnMapId !== save.expedition.mapId) return invalid("battle.returnMapId", "encounter_binding");
  if (!isEchoBattle && save.expedition && content.maps.length > 0) {
    const map = content.maps.find((value) => value.id === save.expedition?.mapId);
    const object = map?.objects.find((value) => value.kind === "encounter" && value.objectId === battle.encounterObjectId);
    if (!object || object.kind !== "encounter" || object.encounterId !== battle.encounterId || battle.returnMapId !== save.expedition.mapId) return invalid("battle", "encounter_binding");
  }
  if (!isEchoBattle && battle.phase !== "COMPLETE" && save.expedition?.defeatedEncounterObjectIds.includes(battle.encounterObjectId)) {
    return invalid("battle.encounterObjectId", "encounter_already_defeated");
  }
  if (battle.outcome === "ongoing" && ["VICTORY", "DEFEAT", "RETREAT", "COMPLETE"].includes(battle.phase)) return invalid("battle.outcome", "phase_outcome_mismatch");
  if (battle.phase === "VICTORY" || battle.phase === "REWARD_PENDING") {
    if (battle.outcome !== "victory") return invalid("battle.outcome", "phase_outcome_mismatch");
  }
  if (battle.phase === "DEFEAT" && battle.outcome !== "defeat") return invalid("battle.outcome", "phase_outcome_mismatch");
  if (battle.phase === "RETREAT" && battle.outcome !== "retreat") return invalid("battle.outcome", "phase_outcome_mismatch");
  if (battle.phase === "REWARD_PENDING" && battle.reward === null) return invalid("battle.reward", "reward_required");
  if (isEchoBattle) {
    if ((battle.abyssEchoOutcome === "pending" || battle.abyssEchoOutcome === "failed") && battle.reward !== null) return invalid("battle.reward", "echo_reward_must_be_empty");
    if (battle.abyssEchoOutcome === "pending" && battle.phase === "COMPLETE") return invalid("battle.phase", "echo_pending_phase_mismatch");
    if (battle.abyssEchoOutcome === "failed" && battle.phase !== "COMPLETE") return invalid("battle.phase", "echo_failed_phase_mismatch");
    if (battle.abyssEchoOutcome === "success") {
      if (battle.outcome !== "victory" || !["REWARD_PENDING", "COMPLETE"].includes(battle.phase)) return invalid("battle.abyssEchoOutcome", "echo_success_phase_mismatch");
      if (battle.phase === "REWARD_PENDING" && battle.reward === null) return invalid("battle.reward", "echo_reward_required");
      if (battle.phase === "COMPLETE" && battle.reward === null) return invalid("battle.reward", "echo_reward_required");
    }
  }
  if (battle.reward) {
    if (battle.reward.source.kind === "abyssEcho") {
      const source = battle.reward.source;
      const sourceEcho = content.abyssEchoes.find((echo) => echo.id === source.echoId);
      if (!isEchoBattle || !sourceEcho || sourceEcho.bossEncounterId !== battle.encounterId || (save.expedition && save.expedition.abyssEchoId !== source.echoId) || source.encounterId !== battle.encounterId) return invalid("battle.reward.source", "echo_reward_mismatch");
      if (battle.abyssEchoOutcome !== "success" || !["REWARD_PENDING", "COMPLETE"].includes(battle.phase) || battle.outcome !== "victory") return invalid("battle.reward.source", "echo_reward_phase_mismatch");
    } else {
      if (isEchoBattle || battle.reward.source.kind !== "encounter") return invalid("battle.reward.source", "battle_reward_source_mismatch");
      if (!["REWARD_PENDING", "COMPLETE"].includes(battle.phase) || battle.outcome !== "victory") return invalid("battle.reward.source", "encounter_reward_phase_mismatch");
      if (battle.reward.source.encounterId !== battle.encounterId || battle.reward.source.mapId !== battle.returnMapId || battle.reward.source.objectId !== battle.encounterObjectId) return invalid("battle.reward.source", "encounter_reward_mismatch");
      if (save.expedition && (battle.reward.source.mapId !== save.expedition.mapId || battle.reward.source.objectId !== battle.encounterObjectId)) return invalid("battle.reward.source", "encounter_reward_mismatch");
      if (battle.phase === "REWARD_PENDING" && save.expedition?.defeatedEncounterObjectIds.includes(battle.encounterObjectId)) return invalid("battle.reward.source", "encounter_already_defeated");
    }
  }
  if (content.encounters.length > 0 && !knownIds(content.encounters).has(battle.encounterId)) return invalid("battle.encounterId", "unknown_encounter");
  return null;
}

/** 严格校验存档；传入内容根时同时校验 key 集、引用和跨字段不变量。 */
export function validateGameSave(save: unknown, content?: ContentRootV1): DomainResult<GameSaveV1> {
  const parsed = gameSaveV1Schema.safeParse(save);
  if (!parsed.success) return invalid("save", parsed.error.issues[0]?.code ?? "invalid_schema");
  const value = parsed.data as GameSaveV1;
  if (!content) return success(value);
  const inventoryError = validateInventory(value, content);
  if (inventoryError) return inventoryError;
  const keyError = validateRecordKeys(value, content);
  if (keyError) return keyError;
  const worldError = validateWorld(value, content);
  if (worldError) return worldError;
  const expeditionError = validateExpedition(value, content);
  if (expeditionError) return expeditionError;
  const battleError = validateBattle(value, content);
  if (battleError) return battleError;
  return success(value);
}

function createCharacterProgress(character: CharacterDefinition): CharacterProgressV1 {
  const skillLevels = Object.fromEntries(character.activeSkillIds.map((skillId) => [skillId, 0]));
  const equipmentBySlot: Record<EquipmentSlot, string | null> = {
    weapon: null,
    helmet: null,
    armor: null,
    gloves: null,
    boots: null,
    accessory: null,
  };
  return {
    characterId: character.id,
    recruited: false,
    level: 1,
    xp: 0,
    currentHp: initialMaxHp(character),
    skillPoints: 0,
    skillLevels,
    equippedActiveSkillIds: [null, null],
    equipmentBySlot,
    skillStoneInstanceId: null,
  };
}

export interface NewGameSaveOptions {
  /** 新游戏商店的独立根 seed；不从系统时钟或 Math.random() 取值。 */
  readonly newGameSeed?: number;
  /** 商店生成的装备/铭石实例 ID 必须来自调用方注入的工厂。 */
  readonly idFactory?: IdFactory;
}

function shopWeighted<T>(rng: SeededRng, values: readonly { value: T; weight: number }[], path: string): T {
  if (values.length === 0) throw new Error(`商店冻结表缺少${path}`);
  try {
    return rng.pickWeighted(values);
  } catch {
    throw new Error(`商店冻结表${path}权重无效`);
  }
}

function shopPrice(value: number, content: ContentRootV1): number {
  return Math.floor((value * content.economy.shopBuyMarkupBps) / 10_000);
}

function normalAffixCount(quality: "common" | "magic" | "rare" | "epic" | "abyss"): number {
  return quality === "common" ? 0 : quality === "magic" ? 2 : quality === "rare" ? 3 : 4;
}

function skillAffixCount(quality: "magic" | "rare" | "epic" | "abyss"): number {
  return quality === "magic" ? 1 : quality === "rare" ? 2 : 3;
}

function generateEquipmentAffixes(
  content: ContentRootV1,
  rng: SeededRng,
  base: NonNullable<ContentRootV1["equipmentBases"]>[number],
  itemLevel: number,
  quality: "common" | "magic" | "rare" | "epic" | "abyss",
): { affixes: EquipmentInstance["affixes"]; abyssAffix: EquipmentInstance["abyssAffix"]; craftGrade: "ordinary" | "tempered" | "exalted" } {
  const normalPool = content.equipmentAffixes.filter((definition) =>
    definition.pool === "normal" && definition.minItemLevel <= itemLevel && definition.allowedSlots.includes(base.slot)
      && (base.weaponType === null || definition.allowedWeaponTypes.length === 0 || definition.allowedWeaponTypes.includes(base.weaponType))
      && definition.allowedQualities.includes(quality),
  );
  const makeRoll = (definition: typeof normalPool[number]): EquipmentInstance["affixes"][number] => {
    const tier = [...definition.tiers].filter((value) => value.minItemLevel <= itemLevel).pop();
    if (!tier) throw new Error(`装备词条没有合法 tier: ${definition.id}`);
    return { affixId: definition.id, tier: tier.tier, roll: rng.nextIntInclusive(tier.rollMin, tier.rollMax), craftEmpowered: false, reforged: false };
  };
  const selected: Array<{ definition: typeof normalPool[number]; roll: EquipmentInstance["affixes"][number] }> = [];
  for (let index = 0; index < normalAffixCount(quality); index += 1) {
    const candidates = normalPool.filter((definition) => !selected.some((value) => value.definition.id === definition.id)
      && (definition.exclusiveGroup === null || !selected.some((value) => value.definition.exclusiveGroup === definition.exclusiveGroup)));
    const definition = shopWeighted(rng, candidates.map((value) => ({ value, weight: value.weight })), "equipmentAffixes");
    // 每个词条严格按“抽 ID → 立即抽 roll”交错消费 RNG。
    selected.push({ definition, roll: makeRoll(definition) });
  }
  const affixes = selected.map((value) => value.roll);
  const craftCandidates = selected.map((value, index) => ({ definition: value.definition, index })).filter(({ definition }) => definition.canBeCraftEmpowered);
  const craftChoices = [
    { value: "ordinary" as const, weight: content.economy.craftGradeWeights.ordinary },
    { value: "tempered" as const, weight: content.economy.craftGradeWeights.tempered },
    { value: "exalted" as const, weight: content.economy.craftGradeWeights.exalted },
  ].filter(({ value }) => value === "ordinary" || (value === "tempered" ? craftCandidates.length >= 1 : craftCandidates.length >= 2));
  const craftGrade = shopWeighted(rng, craftChoices, "craftGradeWeights");
  const empoweredCount = craftGrade === "ordinary" ? 0 : craftGrade === "tempered" ? 1 : 2;
  const remaining = [...craftCandidates];
  for (let index = 0; index < empoweredCount; index += 1) {
    const picked = shopWeighted(rng, remaining.map((value) => ({ value, weight: 1 })), "craftAffixes");
    affixes[picked.index] = { ...affixes[picked.index], craftEmpowered: true };
    remaining.splice(remaining.indexOf(picked), 1);
  }
  let abyssAffix: EquipmentInstance["abyssAffix"] = null;
  if (quality === "abyss") {
    const candidates = content.equipmentAffixes.filter((definition) => definition.pool === "abyss" && definition.minItemLevel <= itemLevel
      && definition.allowedSlots.includes(base.slot) && (base.weaponType === null || definition.allowedWeaponTypes.length === 0 || definition.allowedWeaponTypes.includes(base.weaponType))
      && definition.allowedQualities.includes(quality));
    const definition = shopWeighted(rng, candidates.map((value) => ({ value, weight: value.weight })), "abyssAffixes");
    const tier = [...definition.tiers].filter((value) => value.minItemLevel <= itemLevel).pop();
    if (!tier) throw new Error(`深渊词条没有合法 tier: ${definition.id}`);
    abyssAffix = { affixId: definition.id, tier: tier.tier, roll: rng.nextIntInclusive(tier.rollMin, tier.rollMax), craftEmpowered: false, reforged: false };
  }
  return { affixes, abyssAffix, craftGrade };
}

function generateSkillAffixes(
  content: ContentRootV1,
  rng: SeededRng,
  itemLevel: number,
  quality: "magic" | "rare" | "epic" | "abyss",
): { affixes: SkillStoneInstance["affixes"]; abyssAffix: SkillStoneInstance["abyssAffix"] } {
  const normalPool = content.skillAffixes.filter((definition) => definition.pool === "normal" && definition.minItemLevel <= itemLevel && definition.allowedQualities.includes(quality));
  const selected: SkillStoneInstance["affixes"] = [];
  for (let index = 0; index < skillAffixCount(quality); index += 1) {
    const candidates = normalPool.filter((definition) => !selected.some((value) => value.skillAffixId === definition.id)
      && (definition.exclusiveGroup === null || !selected.some((value) => normalPool.find((candidate) => candidate.id === value.skillAffixId)?.exclusiveGroup === definition.exclusiveGroup)));
    const definition = shopWeighted(rng, candidates.map((value) => ({ value, weight: value.weight })), "skillAffixes");
    // 铭石词条同样交错消费：每次抽出 ID 后立即抽该词条 roll。
    selected.push({ skillAffixId: definition.id, roll: rng.nextIntInclusive(definition.rollMin, definition.rollMax), reforged: false });
  }
  const affixes = selected;
  let abyssAffix: SkillStoneInstance["abyssAffix"] = null;
  if (quality === "abyss") {
    const candidates = content.skillAffixes.filter((definition) => definition.pool === "abyss" && definition.minItemLevel <= itemLevel && definition.allowedQualities.includes(quality));
    const definition = shopWeighted(rng, candidates.map((value) => ({ value, weight: value.weight })), "skillStoneAbyssAffixes");
    abyssAffix = { skillAffixId: definition.id, roll: rng.nextIntInclusive(definition.rollMin, definition.rollMax), reforged: false };
  }
  return { affixes, abyssAffix };
}

/** 按冻结 ShopTierDefinition 生成初始库存；不读档补抽，也不写入临时 RNG 状态。 */
function createInitialShop(content: ContentRootV1, timestamp: string, options: NewGameSaveOptions): GameSaveV1["shop"] {
  if (content.shops.length === 0) return { stockRevision: 1, generatedFromExpeditionId: null, offers: [] };
  if (options.newGameSeed === undefined) throw new Error("有商店内容时必须注入 newGameSeed");
  const shop = content.shops[0];
  const tier = [...shop.tiers].filter((candidate) => candidate.minHighestUnlockedFloor <= 1).pop();
  if (!tier || tier.offerCount < 1) throw new Error("初始商店没有可用的冻结 tier");
  const rng = SeededRng.fromSeed(options.newGameSeed).derive("shop");
  const offers: GameSaveV1["shop"]["offers"] = [];
  for (let index = 0; index < tier.offerCount; index += 1) {
    const offerId = `shop_offer_${(options.newGameSeed >>> 0).toString(16).padStart(8, "0")}_${String(index + 1).padStart(2, "0")}`;
    const kind = shopWeighted(rng, [
      { value: "stackableItem" as const, weight: tier.offerKindWeights.stackableItem },
      { value: "equipment" as const, weight: tier.offerKindWeights.equipment },
      { value: "skillStone" as const, weight: tier.offerKindWeights.skillStone },
    ], "offerKindWeights");
    if (kind === "stackableItem") {
      const item = shopWeighted(rng, tier.stackableItems.map((entry) => ({ value: entry, weight: entry.weight })), "stackableItems");
      const quantity = rng.nextIntInclusive(item.quantityMin, item.quantityMax);
      const definition = content.items.find((candidate) => candidate.id === item.itemId);
      if (!definition) throw new Error(`商店引用未知堆叠物: ${item.itemId}`);
      offers.push({ offerId, kind, itemId: item.itemId, quantity, goldPrice: shopPrice(definition.baseGoldValue * quantity, content), sold: false });
      continue;
    }
    if (kind === "equipment") {
      const idFactory = options.idFactory;
      if (!idFactory) throw new Error("商店装备生成需要注入 idFactory");
      const itemLevel = rng.nextIntInclusive(tier.itemLevelMin, tier.itemLevelMax);
      const validGroups = tier.equipmentBasePools.map((group) => ({
        group,
        bases: group.bases.filter((entry) => {
          const base = content.equipmentBases.find((candidate) => candidate.id === entry.baseId);
          return base !== undefined && base.minItemLevel <= itemLevel && base.maxItemLevel >= itemLevel;
        }),
      })).filter((entry) => entry.bases.length > 0);
      const selectedGroup = shopWeighted(rng, validGroups.map((entry) => ({ value: entry, weight: entry.group.weight })), "equipmentBasePools");
      const baseChoice = shopWeighted(rng, selectedGroup.bases.map((entry) => ({ value: entry, weight: entry.weight })), "equipmentBasePools.bases");
      const base = content.equipmentBases.find((candidate) => candidate.id === baseChoice.baseId);
      if (!base) throw new Error(`商店引用未知装备底材: ${baseChoice.baseId}`);
      const quality = shopWeighted(rng, tier.equipmentQualityWeights.map((entry) => ({ value: entry.quality, weight: entry.weight })), "equipmentQualityWeights");
      const generated = generateEquipmentAffixes(content, rng, base, itemLevel, quality);
      const equipment: EquipmentInstance = {
        instanceId: idFactory.next("eq"),
        baseId: base.id,
        itemLevel,
        quality,
        craftGrade: generated.craftGrade,
        affixes: generated.affixes,
        abyssAffix: generated.abyssAffix,
        locked: false,
        acquiredAt: timestamp,
        sourceTransactionId: offerId,
        reforgeLockedIndex: null,
        reforgeCount: 0,
      };
      const value = base.baseGoldValue + base.goldValuePerItemLevel * (itemLevel - base.minItemLevel)
        + generated.affixes.reduce((total, affix) => total + (content.equipmentAffixes.find((definition) => definition.id === affix.affixId)?.goldValue ?? 0), 0)
        + (generated.abyssAffix === null ? 0 : (content.equipmentAffixes.find((definition) => definition.id === generated.abyssAffix?.affixId)?.goldValue ?? 0));
      offers.push({ offerId, kind, equipment, goldPrice: shopPrice(value, content), sold: false });
      continue;
    }
    const idFactory = options.idFactory;
    if (!idFactory) throw new Error("商店铭石生成需要注入 idFactory");
    const itemLevel = rng.nextIntInclusive(tier.itemLevelMin, tier.itemLevelMax);
    const attunedCharacterId = shopWeighted(rng, [{ value: content.protagonistCharacterId, weight: 1 }], "attunedCharacter");
    const quality = shopWeighted(rng, tier.skillStoneQualityWeights.map((entry) => ({ value: entry.quality, weight: entry.weight })), "skillStoneQualityWeights");
    const generated = generateSkillAffixes(content, rng, itemLevel, quality);
    const skillStone: SkillStoneInstance = {
      instanceId: idFactory.next("stone"),
      attunedCharacterId,
      itemLevel,
      quality,
      affixes: generated.affixes,
      abyssAffix: generated.abyssAffix,
      locked: false,
      acquiredAt: timestamp,
      sourceTransactionId: offerId,
      reforgeLockedIndex: null,
      reforgeCount: 0,
    };
    const value = 40 * itemLevel
      + generated.affixes.reduce((total, affix) => total + (content.skillAffixes.find((definition) => definition.id === affix.skillAffixId)?.goldValue ?? 0), 0)
      + (generated.abyssAffix === null ? 0 : (content.skillAffixes.find((definition) => definition.id === generated.abyssAffix?.skillAffixId)?.goldValue ?? 0));
    offers.push({ offerId, kind, skillStone, goldPrice: shopPrice(value, content), sold: false });
  }
  return { stockRevision: 1, generatedFromExpeditionId: null, offers };
}

/** 创建冻结表对应的新游戏存档；时间由调用方注入，避免领域代码读取系统时钟。 */
export function createNewGameSave(content: ContentRootV1, timestamp: string, options: NewGameSaveOptions = {}): GameSaveV1 {
  const characters = Object.fromEntries(content.characters.map((character) => [character.id, { ...createCharacterProgress(character), currentHp: initialMaxHp(character, content) }]));
  const protagonist = characters[content.protagonistCharacterId];
  if (!protagonist) throw new Error("内容根缺少主角定义");
  protagonist.recruited = true;
  const stackables = Object.fromEntries(content.items.map((item) => [item.id, item.id === "item_minor_potion" ? 3 : 0]));
  const save: GameSaveV1 = {
    schemaVersion: 1,
    contentVersion: "content-1.2.0",
    saveId: "slot_1",
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    gold: 200,
    skillStoneFocusCharacterId: content.protagonistCharacterId,
    characters,
    party: { slots: [content.protagonistCharacterId, null, null, null] },
    inventory: { equipment: [], skillStones: [], stackables, overflowEquipment: [], overflowSkillStones: [] },
    shop: createInitialShop(content, timestamp, options),
    world: {
      highestUnlockedFloor: 1,
      clearedBossEncounterIds: [],
      bossRetryUnlockedFloorIds: [],
      completedQuestIds: [],
      discoveredComboIds: [],
      discoveredEnemyIds: [],
      echoCharges: 0,
      echoAttemptSequence: 0,
      clearedEchoIds: [],
      storyCompleted: false,
    },
    expedition: null,
    battle: null,
    battleAssist: { enabled: false, lastActionByCharacter: Object.fromEntries(content.characters.map((character) => [character.id, null])) },
    settings: { qualityPreset: "standard", battleAnimationSpeed: 1, musicVolume: 80, sfxVolume: 80, reducedFlashes: false, reducedScreenShake: false },
    claimedRewardTransactionIds: [],
  };
  const result = validateGameSave(save, content);
  if (!result.ok) {
    const detail = result.error.code === "INVALID_CONTENT" ? result.error.details.issueKey : result.error.code;
    throw new Error(`${result.error.code}:${detail}`);
  }
  return result.value;
}

/** 不抛异常的工厂入口，供应用层在启动失败时展示领域错误。 */
export function tryCreateNewGameSave(content: ContentRootV1, timestamp: string, options: NewGameSaveOptions = {}): DomainResult<GameSaveV1> {
  try {
    return success(createNewGameSave(content, timestamp, options));
  } catch (error) {
    return invalid("save", error instanceof Error ? error.message : "new_game_invalid");
  }
}

export type { GameSaveV1, BattleSnapshotV1 };
