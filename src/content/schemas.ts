/**
 * DATA-1.2 的 strict Zod schema。
 * 数值先在 schema 层限制整数、有限值和 BPS 闭区间，引用关系由 Catalog 继续检查。
 */
import { z } from "zod";

const idSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const intSchema = z.number().finite().int();
const nonNegativeInt = intSchema.min(0);
const positiveInt = intSchema.min(1);
// 概率、生命门槛、减伤等参与 rollBps 或 clamp 的字段只能落在 0～10000。
const bpsSchema = intSchema.min(0).max(10_000);
// 威力、条件倍率和词条 rollScale 以 10000 为基准，合法强化可超过基准，但受明确上限约束。
const ratioBpsSchema = intSchema.min(0).max(30_000);
const positiveRatioBpsSchema = intSchema.min(1).max(30_000);
const signedModifierBpsSchema = intSchema.min(-30_000).max(30_000);
const statKeySchema = z.enum(["maxHp", "attack", "defense", "speed", "critRateBps", "critDamageBps", "effectHitBps", "effectResistBps"]);
const elementSchema = z.enum(["physical", "fire", "frost", "lightning", "holy", "dark", "poison", "true"]);
const targetRuleSchema = z.enum(["self", "singleAlly", "allAllies", "singleEnemy", "allEnemies", "randomEnemy", "deadAlly"]);
const skillFamilyIdSchema = z.enum(["area", "basic", "bleed", "bow", "cleanse", "control", "detonate", "execute", "fire", "frost", "guard", "hammer", "heal", "holy", "mark", "multiHit", "passive", "projectile", "revive", "shield", "speed", "support", "sword", "taunt", "ultimate"]);
const comboTagIdSchema = z.enum(["area", "back", "basicAttack", "bleed", "burn", "chain", "chase", "cleanse", "control", "counter", "crit", "dark", "detonate", "element", "execute", "fire", "focus", "front", "frost", "guard", "heal", "healthy", "holy", "mark", "might", "physical", "poison", "shield", "shock", "speed", "support", "taunt", "ultimate", "vitality"]);
const stackRuleSchema = z.enum(["add", "max", "unique", "replace"]);
const weaponTypeSchema = z.enum(["sword", "hammer", "bow", "staff", "focus", "relic"]);
const equipmentSlotSchema = z.enum(["weapon", "helmet", "armor", "gloves", "boots", "accessory"]);
const equipmentQualitySchema = z.enum(["common", "magic", "rare", "epic", "abyss"]);
const skillStoneQualitySchema = z.enum(["magic", "rare", "epic", "abyss"]);
const craftGradeSchema = z.enum(["ordinary", "tempered", "exalted"]);
const roleSchema = z.enum(["fighter", "tank", "ranger", "mage", "support"]);
const skillKindSchema = z.enum(["basic", "active", "ultimate", "passive", "effect"]);
const triggerSkillKindSchema = z.enum(["basic", "active", "ultimate", "effect"]);
const itemUseContextSchema = z.enum(["field", "battle"]);
const finiteIntArray = z.array(intSchema);

export const vector2Schema = z.object({ x: intSchema, y: intSchema }).strict();
export const statBlockSchema = z.object({
  maxHp: positiveInt,
  attack: positiveInt,
  defense: positiveInt,
  speed: positiveInt,
  critRateBps: bpsSchema,
  critDamageBps: intSchema.min(10_000).max(30_000),
  effectHitBps: bpsSchema,
  effectResistBps: bpsSchema,
}).strict();
const growthStatBlockSchema = z.object({
  maxHp: nonNegativeInt,
  attack: nonNegativeInt,
  defense: nonNegativeInt,
  speed: nonNegativeInt,
  critRateBps: nonNegativeInt,
  critDamageBps: nonNegativeInt,
  effectHitBps: nonNegativeInt,
  effectResistBps: nonNegativeInt,
}).strict();
export const tagContributionSchema = z.object({ tagId: comboTagIdSchema, count: positiveInt }).strict();

const damageConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sourceHpAtMostBps"), valueBps: bpsSchema }).strict(),
  z.object({ kind: z.literal("targetHpAtMostBps"), valueBps: bpsSchema }).strict(),
  z.object({ kind: z.literal("sourceHasStatus"), statusId: idSchema }).strict(),
  z.object({ kind: z.literal("targetHasStatus"), statusId: idSchema }).strict(),
  z.object({ kind: z.literal("targetStatusStacksAtLeast"), statusId: idSchema, stacks: positiveInt }).strict(),
]);
const damageConditionMultiplierSchema = z.object({ condition: damageConditionSchema, multiplierBps: positiveRatioBpsSchema }).strict();
const damageEffectSchema = z.object({
  kind: z.literal("damage"), targetRule: targetRuleSchema, element: elementSchema, powerBps: ratioBpsSchema,
  flatPower: nonNegativeInt, canCrit: z.boolean(), ignoreDefenseBps: bpsSchema, flatIgnoreDefense: nonNegativeInt,
  hitCount: positiveInt, retargetEachHit: z.boolean(), conditionalMultipliers: z.array(damageConditionMultiplierSchema),
}).strict();
const healEffectSchema = z.object({ kind: z.literal("heal"), targetRule: targetRuleSchema, scalingStat: z.enum(["attack", "maxHp"]), powerBps: ratioBpsSchema, flatPower: nonNegativeInt, canCrit: z.boolean() }).strict();
const shieldEffectSchema = z.object({ kind: z.literal("shield"), targetRule: targetRuleSchema, scalingStat: z.enum(["attack", "maxHp"]), powerBps: ratioBpsSchema, flatPower: nonNegativeInt, statusId: idSchema, durationOwnerTurns: positiveInt }).strict();
const applyStatusEffectSchema = z.object({ kind: z.literal("applyStatus"), targetRule: targetRuleSchema, statusId: idSchema, baseChanceBps: bpsSchema, stacks: positiveInt, durationOwnerTurns: positiveInt }).strict();
const dispelEffectSchema = z.object({ kind: z.literal("dispel"), targetRule: targetRuleSchema, polarity: z.enum(["buff", "debuff"]), count: positiveInt }).strict();
const consumeStatusEffectSchema = z.object({ kind: z.literal("consumeStatus"), targetRule: targetRuleSchema, statusId: idSchema, stacks: positiveInt }).strict();
const energyEffectSchema = z.object({ kind: z.literal("changeEnergy"), targetRule: targetRuleSchema, amount: intSchema }).strict();
const cooldownEffectSchema = z.object({ kind: z.literal("changeCooldown"), targetRule: targetRuleSchema, skillId: idSchema, amountTurns: intSchema }).strict();
const summonEffectSchema = z.object({ kind: z.literal("summon"), enemyId: idSchema, preferredSlots: z.array(intSchema.min(0).max(5)), maxAliveCopies: positiveInt }).strict();
const extraTurnEffectSchema = z.object({ kind: z.literal("grantExtraTurn"), targetRule: z.literal("self") }).strict();
const reviveEffectSchema = z.object({ kind: z.literal("revive"), targetRule: z.literal("deadAlly"), restoreMaxHpBps: bpsSchema }).strict();
export const effectSpecSchema = z.discriminatedUnion("kind", [damageEffectSchema, healEffectSchema, shieldEffectSchema, applyStatusEffectSchema, dispelEffectSchema, consumeStatusEffectSchema, energyEffectSchema, cooldownEffectSchema, summonEffectSchema, extraTurnEffectSchema, reviveEffectSchema]);

const passiveModifierSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("flatStat"), stat: statKeySchema, value: intSchema }).strict(),
  z.object({ kind: z.literal("percentStat"), stat: statKeySchema, valueBps: signedModifierBpsSchema }).strict(),
  z.object({ kind: z.literal("damageBonus"), element: z.union([elementSchema, z.literal("all")]), valueBps: signedModifierBpsSchema }).strict(),
  z.object({ kind: z.literal("healingBonus"), valueBps: signedModifierBpsSchema }).strict(),
  z.object({ kind: z.literal("shieldBonus"), valueBps: signedModifierBpsSchema }).strict(),
]);
const skillOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), characterId: idSchema }).strict(),
  z.object({ kind: z.literal("enemy"), enemyId: idSchema }).strict(),
  z.object({ kind: z.literal("systemEffect") }).strict(),
]);
export const characterDefinitionSchema = z.object({
  id: idSchema, nameKey: z.string().min(1), role: roleSchema, allowedWeaponTypes: z.array(weaponTypeSchema), baseStats: statBlockSchema, growthPerLevel: growthStatBlockSchema,
  innateTags: z.array(tagContributionSchema), basicSkillId: idSchema, activeSkillIds: z.tuple([idSchema, idSchema, idSchema, idSchema]), ultimateSkillId: idSchema, passiveSkillId: idSchema,
  fieldSpriteId: z.string().min(1), battleSpriteId: z.string().min(1),
}).strict();
export const skillDefinitionSchema = z.object({
  id: idSchema, nameKey: z.string().min(1), descriptionKey: z.string().min(1), owner: skillOwnerSchema, familyIds: z.array(skillFamilyIdSchema), kind: skillKindSchema,
  unlockLevel: positiveInt, maxLevel: z.union([z.literal(1), z.literal(5)]), targetRule: targetRuleSchema, requiresFrontAccess: z.boolean(),
  cooldownTurnsByLevel: z.tuple([nonNegativeInt, nonNegativeInt, nonNegativeInt, nonNegativeInt, nonNegativeInt]),
  energyCostByLevel: z.tuple([nonNegativeInt, nonNegativeInt, nonNegativeInt, nonNegativeInt, nonNegativeInt]),
  baseEnergyGainByLevel: z.tuple([nonNegativeInt, nonNegativeInt, nonNegativeInt, nonNegativeInt, nonNegativeInt]),
  effectsByLevel: z.tuple([z.array(effectSpecSchema), z.array(effectSpecSchema), z.array(effectSpecSchema), z.array(effectSpecSchema), z.array(effectSpecSchema)]),
  passiveModifiers: z.array(passiveModifierSchema), tags: z.array(tagContributionSchema), animationId: z.string().min(1),
}).strict();

const statusEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("periodicDamage"), element: elementSchema, snapshotPowerBps: ratioBpsSchema }).strict(),
  z.object({ kind: z.literal("statModifier"), stat: statKeySchema, flat: intSchema, percentBps: signedModifierBpsSchema }).strict(),
  z.object({ kind: z.literal("skipTurn") }).strict(), z.object({ kind: z.literal("taunt") }).strict(), z.object({ kind: z.literal("shield") }).strict(),
  z.object({ kind: z.literal("guard"), directDamageReductionBps: bpsSchema }).strict(),
]);
export const statusDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), polarity: z.enum(["buff", "debuff"]), maxStacks: positiveInt, refreshRule: z.enum(["replaceDuration", "independentStacks"]), triggerTiming: z.enum(["turnStart", "afterAction", "turnEnd", "none"]), effect: statusEffectSchema, canDispel: z.boolean(), immunityTag: z.string().min(1).nullable(), iconId: z.string().min(1) }).strict();

const affixConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("selfHpAtMostBps"), valueBps: bpsSchema }).strict(), z.object({ kind: z.literal("selfHpAtLeastBps"), valueBps: bpsSchema }).strict(),
  z.object({ kind: z.literal("targetHpAtMostBps"), valueBps: bpsSchema }).strict(), z.object({ kind: z.literal("targetHpAtLeastBps"), valueBps: bpsSchema }).strict(),
  z.object({ kind: z.literal("selfHasStatus"), statusId: idSchema }).strict(), z.object({ kind: z.literal("targetHasStatus"), statusId: idSchema }).strict(),
  z.object({ kind: z.literal("formationRow"), row: z.enum(["front", "back"]) }).strict(), z.object({ kind: z.literal("roundAtMost"), round: positiveInt }).strict(),
]);
const modifierSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("flatStat"), stat: statKeySchema, rollScaleBps: positiveRatioBpsSchema }).strict(), z.object({ kind: z.literal("percentStat"), stat: statKeySchema, rollScaleBps: positiveRatioBpsSchema }).strict(),
  z.object({ kind: z.literal("damageBonus"), element: z.union([elementSchema, z.literal("all")]), rollScaleBps: positiveRatioBpsSchema }).strict(), z.object({ kind: z.literal("healingBonus"), rollScaleBps: positiveRatioBpsSchema }).strict(), z.object({ kind: z.literal("shieldBonus"), rollScaleBps: positiveRatioBpsSchema }).strict(), z.object({ kind: z.literal("finalDamageMultiplier"), rollScaleBps: positiveRatioBpsSchema }).strict(),
  z.object({ kind: z.literal("conditionalDamageBonus"), condition: affixConditionSchema, element: z.union([elementSchema, z.literal("all")]), rollScaleBps: positiveRatioBpsSchema }).strict(),
  z.object({ kind: z.literal("conditionalPercentStat"), condition: affixConditionSchema, stat: statKeySchema, rollScaleBps: positiveRatioBpsSchema }).strict(),
  z.object({ kind: z.literal("trigger"), triggerId: idSchema }).strict(), z.object({ kind: z.literal("skillPower"), skillId: idSchema, rollScaleBps: positiveRatioBpsSchema }).strict(),
  z.object({ kind: z.literal("replaceBasicSkill"), skillId: idSchema }).strict(), z.object({ kind: z.literal("replaceDamageElement"), from: z.union([elementSchema, z.literal("all")]), to: elementSchema }).strict(),
]);
const tierSchema = z.object({ tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]), minItemLevel: positiveInt, rollMin: nonNegativeInt, rollMax: nonNegativeInt }).strict().refine((tier) => tier.rollMax >= tier.rollMin, "rollMax must be >= rollMin");
export const equipmentBaseDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), slot: equipmentSlotSchema, weaponType: weaponTypeSchema.nullable(), minItemLevel: positiveInt, maxItemLevel: positiveInt, baseStat: statKeySchema, baseValueAtMinLevel: positiveInt, growthPerItemLevel: nonNegativeInt, baseGoldValue: nonNegativeInt, goldValuePerItemLevel: nonNegativeInt, spriteId: z.string().min(1) }).strict().refine((v) => v.maxItemLevel >= v.minItemLevel, "item level range");
export const equipmentAffixDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), descriptionKey: z.string().min(1), category: z.enum(["baseStat", "damageType", "conditional", "trigger", "skillAmp", "mechanic"]), pool: z.enum(["normal", "abyss"]), allowedSlots: z.array(equipmentSlotSchema), allowedWeaponTypes: z.array(weaponTypeSchema), minItemLevel: positiveInt, allowedQualities: z.array(equipmentQualitySchema).min(1), exclusiveGroup: z.string().min(1).nullable(), stackRule: stackRuleSchema, weight: nonNegativeInt, goldValue: nonNegativeInt, canBeCraftEmpowered: z.boolean(), tiers: z.array(tierSchema).min(1), modifiers: z.array(modifierSpecSchema), tags: z.array(tagContributionSchema) }).strict();
export const equipmentAffixRollSchema = z.object({ affixId: idSchema, tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]), roll: nonNegativeInt, craftEmpowered: z.boolean(), reforged: z.boolean() }).strict();
export const equipmentInstanceSchema = z.object({ instanceId: idSchema, baseId: idSchema, itemLevel: positiveInt, quality: equipmentQualitySchema, craftGrade: craftGradeSchema, affixes: z.array(equipmentAffixRollSchema), abyssAffix: equipmentAffixRollSchema.nullable(), locked: z.boolean(), acquiredAt: z.string().datetime({ offset: true }), sourceTransactionId: idSchema, reforgeLockedIndex: nonNegativeInt.nullable(), reforgeCount: nonNegativeInt }).strict();

const skillAffixOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("addPowerBps") }).strict(), z.object({ kind: z.literal("addRepeatChanceBps"), extraHits: positiveInt }).strict(),
  z.object({ kind: z.literal("addFollowUp"), effectSkillId: idSchema, chanceScaleBps: bpsSchema }).strict(), z.object({ kind: z.literal("replaceTargetRule"), targetRule: targetRuleSchema }).strict(),
  z.object({ kind: z.literal("replaceDamageElement"), element: elementSchema }).strict(), z.object({ kind: z.literal("statusLink"), requiredStatusId: idSchema, effectSkillId: idSchema, chanceScaleBps: bpsSchema }).strict(),
  z.object({ kind: z.literal("overhealToShield"), conversionScaleBps: bpsSchema, maxTargetHpBps: bpsSchema, durationOwnerTurns: positiveInt }).strict(), z.object({ kind: z.literal("changeEnergy"), amountScaleBps: bpsSchema }).strict(), z.object({ kind: z.literal("changeCooldown"), turns: intSchema }).strict(),
]);
const skillAffixTargetSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("skill"), skillId: idSchema }).strict(), z.object({ kind: z.literal("family"), familyId: skillFamilyIdSchema }).strict(), z.object({ kind: z.literal("allSkills") }).strict()]);
export const skillAffixDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), descriptionKey: z.string().min(1), kind: z.enum(["amplify", "repeat", "followUp", "morph", "statusLink", "resource"]), pool: z.enum(["normal", "abyss"]), target: skillAffixTargetSchema, minItemLevel: positiveInt, allowedQualities: z.array(skillStoneQualitySchema).min(1), exclusiveGroup: z.string().min(1).nullable(), stackRule: stackRuleSchema, weight: nonNegativeInt, goldValue: nonNegativeInt, rollMin: nonNegativeInt, rollMax: nonNegativeInt, operation: skillAffixOperationSchema, tags: z.array(tagContributionSchema) }).strict().refine((v) => v.rollMax >= v.rollMin, "roll range");
export const skillAffixRollSchema = z.object({ skillAffixId: idSchema, roll: nonNegativeInt, reforged: z.boolean() }).strict();
export const skillStoneInstanceSchema = z.object({ instanceId: idSchema, attunedCharacterId: idSchema, itemLevel: positiveInt, quality: skillStoneQualitySchema, affixes: z.array(skillAffixRollSchema), abyssAffix: skillAffixRollSchema.nullable(), locked: z.boolean(), acquiredAt: z.string().datetime({ offset: true }), sourceTransactionId: idSchema, reforgeLockedIndex: nonNegativeInt.nullable(), reforgeCount: nonNegativeInt }).strict();

const triggerSchema = z.object({ event: z.enum(["beforeAction", "afterDirectHit", "afterRootAction", "onDirectDamageTaken", "onHeal", "onOverheal", "onGainShield", "onDefeatUnit"]), requiredSkillKinds: z.array(triggerSkillKindSchema), requiredHitResult: z.enum(["any", "critical", "nonCritical"]), requiredSourceHpAtMostBps: bpsSchema.nullable(), requiredTargetHpAtMostBps: bpsSchema.nullable(), requiredSourceStatusIds: z.array(idSchema), requiredTargetStatusIds: z.array(idSchema), consumeTargetStatus: z.object({ statusId: idSchema, stacks: positiveInt }).strict().nullable() }).strict();
const triggerBudgetSchema = z.object({ maxPerRootAction: positiveInt, maxPerRound: positiveInt, maxPerBattle: positiveInt }).strict();
export const comboDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), descriptionKey: z.string().min(1), scope: z.enum(["personal", "party"]), requirements: z.array(z.object({ tagId: comboTagIdSchema, count: positiveInt, source: z.enum(["any", "innate", "equipmentAffix", "equippedSkill", "skillAffix"]) }).strict()).min(1), trigger: triggerSchema, effects: z.array(effectSpecSchema).min(1), budget: triggerBudgetSchema, iconId: z.string().min(1) }).strict();
export const affixTriggerDefinitionSchema = z.object({ id: idSchema, trigger: triggerSchema, chance: z.union([z.object({ kind: z.literal("fixed"), valueBps: bpsSchema }).strict(), z.object({ kind: z.literal("affixRoll"), scaleBps: bpsSchema }).strict()]), effects: z.array(effectSpecSchema).min(1), budget: triggerBudgetSchema }).strict();

const enemyTargetStrategySchema = z.enum(["lowestHpOpponent", "highestAttackOpponent", "frontFirstOpponent", "randomValid", "lowestHpAlly", "self"]);
const aiConditionSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("always") }).strict(), z.object({ kind: z.literal("selfHpAtMostBps"), valueBps: bpsSchema }).strict(), z.object({ kind: z.literal("selfHasStatus"), statusId: idSchema }).strict(), z.object({ kind: z.literal("selfMissingStatus"), statusId: idSchema }).strict(), z.object({ kind: z.literal("anyAllyHpAtMostBps"), valueBps: bpsSchema }).strict(), z.object({ kind: z.literal("anyOpponentHpAtMostBps"), valueBps: bpsSchema }).strict(), z.object({ kind: z.literal("allyCountAtMost"), count: nonNegativeInt }).strict(), z.object({ kind: z.literal("opponentCountAtLeast"), count: positiveInt }).strict(), z.object({ kind: z.literal("targetHasStatus"), statusId: idSchema }).strict(), z.object({ kind: z.literal("targetMissingStatus"), statusId: idSchema }).strict(), z.object({ kind: z.literal("targetStatusStacksAtMost"), statusId: idSchema, stacks: nonNegativeInt }).strict(), z.object({ kind: z.literal("opponentsMissingStatusCountAtLeast"), statusId: idSchema, count: positiveInt }).strict(), z.object({ kind: z.literal("roundEquals"), round: positiveInt }).strict(), z.object({ kind: z.literal("roundAtLeast"), round: positiveInt }).strict()]);
export const enemyDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), level: positiveInt, stats: statBlockSchema, elementWeaknesses: z.array(elementSchema), elementResistances: z.array(elementSchema), immunityTags: z.array(idSchema), basicSkillId: idSchema, basicTargetStrategy: enemyTargetStrategySchema, skillIds: z.array(idSchema), aiRules: z.array(z.object({ priority: positiveInt, conditions: z.array(aiConditionSchema).min(1), skillId: idSchema, targetStrategy: enemyTargetStrategySchema, weight: positiveInt }).strict()), spriteId: z.string().min(1) }).strict();
export const bossIntentDefinitionSchema = z.object({ id: idSchema, bossId: idSchema, skillId: idSchema, targetStrategy: enemyTargetStrategySchema, delayLegalActions: z.literal(1), counterKind: z.enum(["guard", "shield", "heal", "cleanse"]) }).strict();
export const encounterDefinitionSchema = z.object({ id: idSchema, kind: z.enum(["normal", "elite", "boss"]), fieldSpriteId: z.string().min(1), enemyIdsBySlot: z.array(idSchema.nullable()).length(6), xpReward: nonNegativeInt, goldRewardMin: nonNegativeInt, goldRewardMax: nonNegativeInt, dropTableId: idSchema, canRetreat: z.boolean(), modifierIds: z.array(idSchema) }).strict().refine((v) => v.goldRewardMax >= v.goldRewardMin, "gold range");
export const encounterModifierDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), descriptionKey: z.string().min(1), rule: z.discriminatedUnion("kind", [z.object({ kind: z.literal("timedStat"), faction: z.enum(["party", "enemy"]), stat: z.enum(["attack", "defense", "speed"]), valueBps: intSchema, fromRound: positiveInt, throughRound: positiveInt }).strict(), z.object({ kind: z.literal("battleStartShield"), faction: z.literal("enemy"), maxHpBps: bpsSchema }).strict(), z.object({ kind: z.literal("executeDamage"), faction: z.literal("enemy"), targetHpAtMostBps: bpsSchema, damageBonusBps: bpsSchema }).strict(), z.object({ kind: z.literal("escalatingStat"), faction: z.literal("enemy"), stat: z.literal("attack"), perRoundBps: positiveInt, capBps: positiveInt }).strict(), z.object({ kind: z.literal("healingSuppression"), faction: z.literal("party"), valueBps: bpsSchema }).strict()]) }).strict();
export const abyssEchoDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), descriptionKey: z.string().min(1), floorId: idSchema, bossEncounterId: idSchema, enemyHpBps: intSchema.min(10_000).max(15_000), enemyAttackBps: intSchema.min(10_000).max(15_000), enemyDefenseBps: intSchema.min(10_000).max(15_000), enemySpeedBps: intSchema.min(10_000).max(15_000), enrageRoundDelta: z.union([z.literal(-2), z.literal(-1)]), itemUseLimit: z.union([z.literal(0), z.literal(1), z.literal(2)]), objective: z.object({ maxRounds: positiveInt, maxKnockouts: nonNegativeInt, requiredAnyComboTriggers: z.union([z.literal(0), z.literal(1)]) }).strict(), bonusAbyssUpgradeChanceBps: bpsSchema, firstClearForgeShards: nonNegativeInt, firstClearInscriptionDust: nonNegativeInt }).strict();

const portalActionSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("openFloorSelect") }).strict(), z.object({ kind: z.literal("returnTown") }).strict()]);
const encounterBehaviorSchema = z.object({ mode: z.enum(["patrol", "wander", "stationary"]), patrolPoints: z.array(vector2Schema), wanderRadius: nonNegativeInt, detectionRadius: nonNegativeInt, leashRadius: nonNegativeInt, moveSpeed: nonNegativeInt }).strict();
const mapObjectSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("npc"), objectId: idSchema, position: vector2Schema, npcId: idSchema, blocking: z.literal(true) }).strict(), z.object({ kind: z.literal("encounter"), objectId: idSchema, position: vector2Schema, encounterId: idSchema, behavior: encounterBehaviorSchema }).strict(), z.object({ kind: z.literal("chest"), objectId: idSchema, position: vector2Schema, dropTableId: idSchema, frameId: z.literal("object_chest_closed") }).strict(), z.object({ kind: z.literal("portal"), objectId: idSchema, position: vector2Schema, action: portalActionSchema, frameId: z.enum(["object_portal_floor", "object_portal_return"]) }).strict()]);
const unlockConditionSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("always") }).strict(), z.object({ kind: z.literal("floorCleared"), floorNumber: positiveInt }).strict(), z.object({ kind: z.literal("encounterCleared"), encounterId: idSchema }).strict()]);
export const floorDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), floorNumber: positiveInt, mapId: idSchema, bossEncounterId: idSchema, assetBundleId: idSchema, minItemLevel: positiveInt, maxItemLevel: positiveInt, recommendedBossLevel: positiveInt, recommendedItemLevel: positiveInt, bossEnrageRound: positiveInt, bossGateType: z.enum(["tutorial", "currentTier", "breakthrough"]), bossPhaseThresholdBps: z.array(bpsSchema).min(1), shortRouteObjectIds: z.array(idSchema), isAbyss: z.boolean(), firstClearRewardTableId: idSchema }).strict().refine((v) => v.maxItemLevel >= v.minItemLevel, "floor item level range");
export const mapDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), widthTiles: positiveInt, heightTiles: positiveInt, tileSize: z.literal(16), assetBundleId: idSchema, spawnPoint: vector2Schema, groundLayer: finiteIntArray, decorBackLayer: finiteIntArray, decorFrontLayer: finiteIntArray, collisionLayer: z.array(z.union([z.literal(0), z.literal(1)])), objects: z.array(mapObjectSchema) }).strict();
export const npcDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), function: z.enum(["tavern", "blacksmith", "skillMentor", "merchant", "inn", "cartographer", "abyssWatcher"]), unlockCondition: unlockConditionSchema, lockReasonKey: z.string().min(1), dialogueId: idSchema, spriteId: z.string().min(1) }).strict();
export const dialogueDefinitionSchema = z.object({ id: idSchema, pages: z.array(z.object({ speakerNpcId: idSchema.nullable(), textKey: z.string().min(1) }).strict()).min(1) }).strict();
export const questDefinitionSchema = z.object({ id: idSchema, nameKey: z.string().min(1), descriptionKey: z.string().min(1), unlockCondition: unlockConditionSchema, completionCondition: unlockConditionSchema }).strict();
export const recruitmentDefinitionSchema = z.object({ id: idSchema, characterId: idSchema, condition: z.discriminatedUnion("kind", [z.object({ kind: z.literal("questCompleted"), questId: idSchema }).strict(), z.object({ kind: z.literal("gold"), goldCost: nonNegativeInt, minimumClearedFloor: z.number().int().min(0).max(10) }).strict(), z.object({ kind: z.literal("firstClear"), floorNumber: positiveInt }).strict()]) }).strict();
const basePoolSchema = z.object({ slot: equipmentSlotSchema, weight: positiveInt, bases: z.array(z.object({ baseId: idSchema, weight: positiveInt }).strict()).min(1) }).strict();
const qualityWeightSchema = z.object({ quality: equipmentQualitySchema, weight: nonNegativeInt }).strict();
const stoneQualityWeightSchema = z.object({ quality: skillStoneQualitySchema, weight: nonNegativeInt }).strict();
export const shopDefinitionSchema = z.object({ id: idSchema, npcId: idSchema, tiers: z.array(z.object({ minHighestUnlockedFloor: positiveInt, offerCount: positiveInt, itemLevelMin: positiveInt, itemLevelMax: positiveInt, offerKindWeights: z.object({ stackableItem: nonNegativeInt, equipment: nonNegativeInt, skillStone: nonNegativeInt }).strict(), stackableItems: z.array(z.object({ itemId: idSchema, weight: positiveInt, quantityMin: positiveInt, quantityMax: positiveInt }).strict()), equipmentBasePools: z.array(basePoolSchema), equipmentQualityWeights: z.array(qualityWeightSchema), skillStoneQualityWeights: z.array(stoneQualityWeightSchema) }).strict()).min(1) }).strict();

const dropRollSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("stackableItem"), itemId: idSchema, chanceBps: bpsSchema, quantityMin: positiveInt, quantityMax: positiveInt }).strict(), z.object({ kind: z.literal("stackableItemPool"), itemPool: z.array(z.object({ itemId: idSchema, weight: positiveInt }).strict()).min(1), chanceBps: bpsSchema, quantityMin: positiveInt, quantityMax: positiveInt }).strict(), z.object({ kind: z.literal("equipment"), chanceBps: bpsSchema, itemLevelMin: positiveInt, itemLevelMax: positiveInt, equipmentBasePools: z.array(basePoolSchema), qualityWeights: z.array(qualityWeightSchema), guaranteedMinQuality: equipmentQualitySchema.nullable(), abyssUpgradeChanceBps: bpsSchema }).strict(), z.object({ kind: z.literal("skillStone"), chanceBps: bpsSchema, itemLevelMin: positiveInt, itemLevelMax: positiveInt, qualityWeights: z.array(stoneQualityWeightSchema), guaranteedMinQuality: skillStoneQualitySchema.nullable() }).strict(), z.object({ kind: z.literal("fixedEquipment"), chanceBps: bpsSchema, baseId: idSchema, itemLevel: positiveInt, quality: equipmentQualitySchema, craftGrade: z.union([craftGradeSchema, z.literal("weighted")]), fixedAbyssAffixId: idSchema.nullable() }).strict()]);
export const stackableItemDefinitionSchema = z.union([z.object({ id: idSchema, nameKey: z.string().min(1), category: z.literal("consumable"), maxStack: z.literal(99), baseGoldValue: nonNegativeInt, iconId: z.string().min(1), useContexts: z.array(itemUseContextSchema), targetRule: targetRuleSchema, effects: z.array(effectSpecSchema) }).strict(), z.object({ id: idSchema, nameKey: z.string().min(1), category: z.literal("material"), maxStack: z.literal(99), baseGoldValue: nonNegativeInt, iconId: z.string().min(1) }).strict()]);
export const economyDefinitionSchema = z.object({ equipmentSellRateBps: z.literal(2500), shopBuyMarkupBps: z.literal(20000), buybackLimit: z.literal(10), innCostGold: z.literal(0), craftGradeWeights: z.object({ ordinary: z.literal(70), tempered: z.literal(25), exalted: z.literal(5) }).strict(), equipmentDisassembleYieldByQuality: z.record(equipmentQualitySchema, nonNegativeInt), skillStoneDisassembleYieldByQuality: z.record(skillStoneQualitySchema, nonNegativeInt), equipmentDisassembleMaterialItemId: idSchema, skillStoneDisassembleMaterialItemId: idSchema, stackableTotalCap: z.literal(9999), equipmentReforgeBaseCost: z.literal(5), equipmentReforgePerItemLevelCost: z.literal(1), skillStoneReforgeBaseCost: z.literal(5), skillStoneReforgePerTwoItemLevelsCost: z.literal(1) }).strict();

export const contentRootSchema = z.object({ schemaVersion: z.literal(1), contentVersion: z.literal("content-1.2.0"), protagonistCharacterId: idSchema, characters: z.array(characterDefinitionSchema), skills: z.array(skillDefinitionSchema), statuses: z.array(statusDefinitionSchema), equipmentBases: z.array(equipmentBaseDefinitionSchema), equipmentAffixes: z.array(equipmentAffixDefinitionSchema), affixTriggers: z.array(affixTriggerDefinitionSchema), skillAffixes: z.array(skillAffixDefinitionSchema), combos: z.array(comboDefinitionSchema), enemies: z.array(enemyDefinitionSchema), encounters: z.array(encounterDefinitionSchema), encounterModifiers: z.array(encounterModifierDefinitionSchema), bossIntents: z.array(bossIntentDefinitionSchema), abyssEchoes: z.array(abyssEchoDefinitionSchema), floors: z.array(floorDefinitionSchema), maps: z.array(mapDefinitionSchema), npcs: z.array(npcDefinitionSchema), dialogues: z.array(dialogueDefinitionSchema), quests: z.array(questDefinitionSchema), recruitments: z.array(recruitmentDefinitionSchema), shops: z.array(shopDefinitionSchema), items: z.array(stackableItemDefinitionSchema), dropTables: z.array(z.object({ id: idSchema, rolls: z.array(dropRollSchema) }).strict()), economy: economyDefinitionSchema }).strict();

export const contentIdSchema = idSchema;
export const comboTagIds = comboTagIdSchema.options as readonly string[];
export const skillFamilyIds = skillFamilyIdSchema.options as readonly string[];
