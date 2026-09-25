/**
 * DATA-1.2 的运行时内容契约。
 * 业务字段保持与冻结文档同名，内容层不添加别名或开放字段。
 */
import type {
  BattlePhase,
  DomainErrorCode,
  DomainErrorDetailsByCode,
} from "../domain/common/DomainResult";

export type {
  BattlePhase,
  DomainErrorCode,
  DomainErrorDetailsByCode,
} from "../domain/common/DomainResult";

export type CharacterId = string;
export type SkillId = string;
export type SkillFamilyId =
  | "area" | "basic" | "bleed" | "bow" | "cleanse" | "control"
  | "detonate" | "execute" | "fire" | "frost" | "guard" | "hammer"
  | "heal" | "holy" | "mark" | "multiHit" | "passive" | "projectile"
  | "revive" | "shield" | "speed" | "support" | "sword" | "taunt"
  | "ultimate";
export type StatusId = string;
export type EquipmentBaseId = string;
export type EquipmentAffixId = string;
export type AffixTriggerId = string;
export type SkillAffixId = string;
export type ComboId = string;
export type EnemyId = string;
export type EncounterId = string;
export type EncounterModifierId = string;
export type BossIntentId = string;
export type AbyssEchoId = string;
export type MapId = string;
export type FloorId = string;
export type NpcId = string;
export type DialogueId = string;
export type ItemId = string;
export type QuestId = string;
export type ShopId = string;
export type RecruitmentId = string;
export type DropTableId = string;
export type AssetBundleId = string;
export type InstanceId = string;
export type BasisPoints = number;

export interface Vector2 { x: number; y: number }

export interface StatBlock {
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  critRateBps: BasisPoints;
  critDamageBps: BasisPoints;
  effectHitBps: BasisPoints;
  effectResistBps: BasisPoints;
}

export type Element = "physical" | "fire" | "frost" | "lightning" | "holy" | "dark" | "poison" | "true";
export type TargetRule = "self" | "singleAlly" | "allAllies" | "singleEnemy" | "allEnemies" | "randomEnemy" | "deadAlly";
export type StackRule = "add" | "max" | "unique" | "replace";
export type ComboTagId =
  | "area" | "back" | "basicAttack" | "bleed" | "burn" | "chain" | "chase" | "cleanse"
  | "control" | "counter" | "crit" | "dark" | "detonate" | "element" | "execute" | "fire"
  | "focus" | "front" | "frost" | "guard" | "heal" | "healthy" | "holy" | "mark" | "might"
  | "physical" | "poison" | "shield" | "shock" | "speed" | "support" | "taunt" | "ultimate" | "vitality";
export interface TagContribution { tagId: ComboTagId; count: number }

export interface ContentRootV1 {
  schemaVersion: 1;
  contentVersion: "content-1.2.0";
  protagonistCharacterId: CharacterId;
  characters: CharacterDefinition[];
  skills: SkillDefinition[];
  statuses: StatusDefinition[];
  equipmentBases: EquipmentBaseDefinition[];
  equipmentAffixes: EquipmentAffixDefinition[];
  affixTriggers: AffixTriggerDefinition[];
  skillAffixes: SkillAffixDefinition[];
  combos: ComboDefinition[];
  enemies: EnemyDefinition[];
  encounters: EncounterDefinition[];
  encounterModifiers: EncounterModifierDefinition[];
  bossIntents: BossIntentDefinition[];
  abyssEchoes: AbyssEchoDefinition[];
  floors: FloorDefinition[];
  maps: MapDefinition[];
  npcs: NpcDefinition[];
  dialogues: DialogueDefinition[];
  quests: QuestDefinition[];
  recruitments: RecruitmentDefinition[];
  shops: ShopDefinition[];
  items: StackableItemDefinition[];
  dropTables: DropTableDefinition[];
  economy: EconomyDefinition;
}

export type WeaponType = "sword" | "hammer" | "bow" | "staff" | "focus" | "relic";
export type CharacterRole = "fighter" | "tank" | "ranger" | "mage" | "support";
export interface CharacterDefinition {
  id: CharacterId; nameKey: string; role: CharacterRole; allowedWeaponTypes: WeaponType[];
  baseStats: StatBlock; growthPerLevel: StatBlock; innateTags: TagContribution[];
  basicSkillId: SkillId; activeSkillIds: [SkillId, SkillId, SkillId, SkillId]; ultimateSkillId: SkillId;
  passiveSkillId: SkillId; fieldSpriteId: string; battleSpriteId: string;
}

export type SkillKind = "basic" | "active" | "ultimate" | "passive" | "effect";
export interface SkillDefinition {
  id: SkillId; nameKey: string; descriptionKey: string; owner: SkillOwner; familyIds: SkillFamilyId[];
  kind: SkillKind; unlockLevel: number; maxLevel: 1 | 5; targetRule: TargetRule;
  requiresFrontAccess: boolean; cooldownTurnsByLevel: [number, number, number, number, number];
  energyCostByLevel: [number, number, number, number, number];
  baseEnergyGainByLevel: [number, number, number, number, number];
  effectsByLevel: [EffectSpec[], EffectSpec[], EffectSpec[], EffectSpec[], EffectSpec[]];
  passiveModifiers: PassiveModifierSpec[]; tags: TagContribution[]; animationId: string;
}
export type SkillOwner =
  | { kind: "character"; characterId: CharacterId }
  | { kind: "enemy"; enemyId: EnemyId }
  | { kind: "systemEffect" };
export type PassiveModifierSpec =
  | { kind: "flatStat"; stat: keyof StatBlock; value: number }
  | { kind: "percentStat"; stat: keyof StatBlock; valueBps: BasisPoints }
  | { kind: "damageBonus"; element: Element | "all"; valueBps: BasisPoints }
  | { kind: "healingBonus"; valueBps: BasisPoints }
  | { kind: "shieldBonus"; valueBps: BasisPoints };

export type EffectSpec = DamageEffectSpec | HealEffectSpec | ShieldEffectSpec | ApplyStatusEffectSpec | DispelEffectSpec | ConsumeStatusEffectSpec | EnergyEffectSpec | CooldownEffectSpec | SummonEffectSpec | GrantExtraTurnEffectSpec | ReviveEffectSpec;
export interface DamageEffectSpec {
  kind: "damage"; targetRule: TargetRule; element: Element; powerBps: BasisPoints; flatPower: number;
  canCrit: boolean; ignoreDefenseBps: BasisPoints; flatIgnoreDefense: number; hitCount: number;
  retargetEachHit: boolean; conditionalMultipliers: DamageConditionMultiplier[];
}
export interface DamageConditionMultiplier { condition: DamageCondition; multiplierBps: BasisPoints }
export type DamageCondition =
  | { kind: "sourceHpAtMostBps"; valueBps: BasisPoints }
  | { kind: "targetHpAtMostBps"; valueBps: BasisPoints }
  | { kind: "sourceHasStatus"; statusId: StatusId }
  | { kind: "targetHasStatus"; statusId: StatusId }
  | { kind: "targetStatusStacksAtLeast"; statusId: StatusId; stacks: number };
export interface HealEffectSpec { kind: "heal"; targetRule: TargetRule; scalingStat: "attack" | "maxHp"; powerBps: BasisPoints; flatPower: number; canCrit: boolean }
export interface ShieldEffectSpec { kind: "shield"; targetRule: TargetRule; scalingStat: "attack" | "maxHp"; powerBps: BasisPoints; flatPower: number; statusId: StatusId; durationOwnerTurns: number }
export interface ApplyStatusEffectSpec { kind: "applyStatus"; targetRule: TargetRule; statusId: StatusId; baseChanceBps: BasisPoints; stacks: number; durationOwnerTurns: number }
export interface DispelEffectSpec { kind: "dispel"; targetRule: TargetRule; polarity: "buff" | "debuff"; count: number }
export interface ConsumeStatusEffectSpec { kind: "consumeStatus"; targetRule: TargetRule; statusId: StatusId; stacks: number }
export interface EnergyEffectSpec { kind: "changeEnergy"; targetRule: TargetRule; amount: number }
export interface CooldownEffectSpec { kind: "changeCooldown"; targetRule: TargetRule; skillId: SkillId; amountTurns: number }
export interface SummonEffectSpec { kind: "summon"; enemyId: EnemyId; preferredSlots: number[]; maxAliveCopies: number }
export interface GrantExtraTurnEffectSpec { kind: "grantExtraTurn"; targetRule: "self" }
export interface ReviveEffectSpec { kind: "revive"; targetRule: "deadAlly"; restoreMaxHpBps: BasisPoints }

export interface StatusDefinition {
  id: StatusId; nameKey: string; polarity: "buff" | "debuff"; maxStacks: number;
  refreshRule: "replaceDuration" | "independentStacks"; triggerTiming: "turnStart" | "afterAction" | "turnEnd" | "none";
  effect: StatusEffect; canDispel: boolean; immunityTag: string | null; iconId: string;
}
export type StatusEffect =
  | { kind: "periodicDamage"; element: Element; snapshotPowerBps: BasisPoints }
  | { kind: "statModifier"; stat: keyof StatBlock; flat: number; percentBps: BasisPoints }
  | { kind: "skipTurn" }
  | { kind: "taunt" }
  | { kind: "shield" }
  | { kind: "guard"; directDamageReductionBps: BasisPoints };
export interface RuntimeStatusStack {
  stackId: string; statusId: StatusId; sourceUnitId: string; remainingOwnerTurns: number;
  skipNextOwnerTurnEndDecrement: boolean; sourceAttackSnapshot: number; shieldRemaining: number;
}

export type EquipmentSlot = "weapon" | "helmet" | "armor" | "gloves" | "boots" | "accessory";
export type EquipmentQuality = "common" | "magic" | "rare" | "epic" | "abyss";
export type CraftGrade = "ordinary" | "tempered" | "exalted";
export interface EquipmentBaseDefinition {
  id: EquipmentBaseId; nameKey: string; slot: EquipmentSlot; weaponType: WeaponType | null;
  minItemLevel: number; maxItemLevel: number; baseStat: keyof StatBlock; baseValueAtMinLevel: number;
  growthPerItemLevel: number; baseGoldValue: number; goldValuePerItemLevel: number; spriteId: string;
}
export interface EquipmentAffixDefinition {
  id: EquipmentAffixId; nameKey: string; descriptionKey: string;
  category: "baseStat" | "damageType" | "conditional" | "trigger" | "skillAmp" | "mechanic";
  pool: "normal" | "abyss"; allowedSlots: EquipmentSlot[]; allowedWeaponTypes: WeaponType[];
  minItemLevel: number; allowedQualities: EquipmentQuality[]; exclusiveGroup: string | null;
  stackRule: StackRule; weight: number; goldValue: number; canBeCraftEmpowered: boolean;
  tiers: AffixTierDefinition[]; modifiers: ModifierSpec[]; tags: TagContribution[];
}
export interface AffixTierDefinition { tier: 1 | 2 | 3 | 4 | 5; minItemLevel: number; rollMin: number; rollMax: number }
export type ModifierSpec =
  | { kind: "flatStat"; stat: keyof StatBlock; rollScaleBps: BasisPoints }
  | { kind: "percentStat"; stat: keyof StatBlock; rollScaleBps: BasisPoints }
  | { kind: "damageBonus"; element: Element | "all"; rollScaleBps: BasisPoints }
  | { kind: "healingBonus"; rollScaleBps: BasisPoints }
  | { kind: "shieldBonus"; rollScaleBps: BasisPoints }
  | { kind: "finalDamageMultiplier"; rollScaleBps: BasisPoints }
  | { kind: "conditionalDamageBonus"; condition: AffixCondition; element: Element | "all"; rollScaleBps: BasisPoints }
  | { kind: "conditionalPercentStat"; condition: AffixCondition; stat: keyof StatBlock; rollScaleBps: BasisPoints }
  | { kind: "trigger"; triggerId: AffixTriggerId }
  | { kind: "skillPower"; skillId: SkillId; rollScaleBps: BasisPoints }
  | { kind: "replaceBasicSkill"; skillId: SkillId }
  | { kind: "replaceDamageElement"; from: Element | "all"; to: Element };
export type AffixCondition =
  | { kind: "selfHpAtMostBps"; valueBps: BasisPoints }
  | { kind: "selfHpAtLeastBps"; valueBps: BasisPoints }
  | { kind: "targetHpAtMostBps"; valueBps: BasisPoints }
  | { kind: "targetHpAtLeastBps"; valueBps: BasisPoints }
  | { kind: "selfHasStatus"; statusId: StatusId }
  | { kind: "targetHasStatus"; statusId: StatusId }
  | { kind: "formationRow"; row: "front" | "back" }
  | { kind: "roundAtMost"; round: number };
export interface EquipmentAffixRoll { affixId: EquipmentAffixId; tier: 1 | 2 | 3 | 4 | 5; roll: number; craftEmpowered: boolean; reforged: boolean }
export interface EquipmentInstance {
  instanceId: InstanceId; baseId: EquipmentBaseId; itemLevel: number; quality: EquipmentQuality; craftGrade: CraftGrade;
  affixes: EquipmentAffixRoll[]; abyssAffix: EquipmentAffixRoll | null; locked: boolean; acquiredAt: string;
  sourceTransactionId: string; reforgeLockedIndex: number | null; reforgeCount: number;
}

export type SkillStoneQuality = "magic" | "rare" | "epic" | "abyss";
export type SkillAffixKind = "amplify" | "repeat" | "followUp" | "morph" | "statusLink" | "resource";
export type SkillAffixTarget = { kind: "skill"; skillId: SkillId } | { kind: "family"; familyId: SkillFamilyId } | { kind: "allSkills" };
export interface SkillAffixDefinition {
  id: SkillAffixId; nameKey: string; descriptionKey: string; kind: SkillAffixKind; pool: "normal" | "abyss";
  target: SkillAffixTarget; minItemLevel: number; allowedQualities: SkillStoneQuality[]; exclusiveGroup: string | null;
  stackRule: StackRule; weight: number; goldValue: number; rollMin: number; rollMax: number; operation: SkillAffixOperation; tags: TagContribution[];
}
export type SkillAffixOperation =
  | { kind: "addPowerBps" }
  | { kind: "addRepeatChanceBps"; extraHits: number }
  | { kind: "addFollowUp"; effectSkillId: SkillId; chanceScaleBps: BasisPoints }
  | { kind: "replaceTargetRule"; targetRule: TargetRule }
  | { kind: "replaceDamageElement"; element: Element }
  | { kind: "statusLink"; requiredStatusId: StatusId; effectSkillId: SkillId; chanceScaleBps: BasisPoints }
  | { kind: "overhealToShield"; conversionScaleBps: BasisPoints; maxTargetHpBps: BasisPoints; durationOwnerTurns: number }
  | { kind: "changeEnergy"; amountScaleBps: BasisPoints }
  | { kind: "changeCooldown"; turns: number };
export interface SkillAffixRoll { skillAffixId: SkillAffixId; roll: number; reforged: boolean }
export interface SkillStoneInstance {
  instanceId: InstanceId; attunedCharacterId: CharacterId; itemLevel: number; quality: SkillStoneQuality;
  affixes: SkillAffixRoll[]; abyssAffix: SkillAffixRoll | null; locked: boolean; acquiredAt: string;
  sourceTransactionId: string; reforgeLockedIndex: number | null; reforgeCount: number;
}
export type ReforgeItemKind = "equipment" | "skillStone";
export type ReforgeCandidateV1 = { candidateIndex: 0 | 1 | 2; kind: "equipment"; roll: EquipmentAffixRoll } | { candidateIndex: 0 | 1 | 2; kind: "skillStone"; roll: SkillAffixRoll };
export interface ReforgePreviewV1 { contentVersion: "content-1.2.0"; itemKind: ReforgeItemKind; instanceId: InstanceId; lockedIndex: number; reforgeCount: number; costItemId: "item_forge_shard" | "item_inscription_dust"; costQuantity: number; candidates: ReforgeCandidateV1[] }
export interface OpenReforgePreviewCommandV1 { expectedSaveRevision: number; itemKind: ReforgeItemKind; instanceId: InstanceId; requestedIndex: number }
export interface ConfirmReforgeCommandV1 { expectedSaveRevision: number; itemKind: ReforgeItemKind; instanceId: InstanceId; expectedLockedIndex: number; expectedReforgeCount: number; candidateIndex: 0 | 1 | 2 }

export interface ComboRequirement { tagId: ComboTagId; count: number; source: "any" | "innate" | "equipmentAffix" | "equippedSkill" | "skillAffix" }
export interface TriggerBudget { maxPerRootAction: number; maxPerRound: number; maxPerBattle: number }
export interface ComboDefinition { id: ComboId; nameKey: string; descriptionKey: string; scope: "personal" | "party"; requirements: ComboRequirement[]; trigger: TriggerSpec; effects: EffectSpec[]; budget: TriggerBudget; iconId: string }
export interface TriggerSpec {
  event: "beforeAction" | "afterDirectHit" | "afterRootAction" | "onDirectDamageTaken" | "onHeal" | "onOverheal" | "onGainShield" | "onDefeatUnit";
  requiredSkillKinds: TriggerSkillKindV1[]; requiredHitResult: "any" | "critical" | "nonCritical";
  requiredSourceHpAtMostBps: BasisPoints | null; requiredTargetHpAtMostBps: BasisPoints | null;
  requiredSourceStatusIds: StatusId[]; requiredTargetStatusIds: StatusId[];
  consumeTargetStatus: { statusId: StatusId; stacks: number } | null;
}
export interface AffixTriggerDefinition { id: AffixTriggerId; trigger: TriggerSpec; chance: { kind: "fixed"; valueBps: BasisPoints } | { kind: "affixRoll"; scaleBps: BasisPoints }; effects: EffectSpec[]; budget: TriggerBudget }

export interface EnemyDefinition {
  id: EnemyId; nameKey: string; level: number; stats: StatBlock; elementWeaknesses: Element[]; elementResistances: Element[];
  immunityTags: string[]; basicSkillId: SkillId; basicTargetStrategy: EnemyTargetStrategy; skillIds: SkillId[]; aiRules: EnemyAiRule[]; spriteId: string;
}
export interface EnemyAiRule { priority: number; conditions: AiCondition[]; skillId: SkillId; targetStrategy: EnemyTargetStrategy; weight: number }
export interface BossIntentDefinition { id: BossIntentId; bossId: EnemyId; skillId: SkillId; targetStrategy: EnemyTargetStrategy; delayLegalActions: 1; counterKind: "guard" | "shield" | "heal" | "cleanse" }
export type EnemyTargetStrategy = "lowestHpOpponent" | "highestAttackOpponent" | "frontFirstOpponent" | "randomValid" | "lowestHpAlly" | "self";
export type AiCondition =
  | { kind: "always" }
  | { kind: "selfHpAtMostBps"; valueBps: BasisPoints }
  | { kind: "selfHasStatus"; statusId: StatusId }
  | { kind: "selfMissingStatus"; statusId: StatusId }
  | { kind: "anyAllyHpAtMostBps"; valueBps: BasisPoints }
  | { kind: "anyOpponentHpAtMostBps"; valueBps: BasisPoints }
  | { kind: "allyCountAtMost"; count: number }
  | { kind: "opponentCountAtLeast"; count: number }
  | { kind: "targetHasStatus"; statusId: StatusId }
  | { kind: "targetMissingStatus"; statusId: StatusId }
  | { kind: "targetStatusStacksAtMost"; statusId: StatusId; stacks: number }
  | { kind: "opponentsMissingStatusCountAtLeast"; statusId: StatusId; count: number }
  | { kind: "roundEquals"; round: number }
  | { kind: "roundAtLeast"; round: number };
export interface EncounterDefinition { id: EncounterId; kind: "normal" | "elite" | "boss"; fieldSpriteId: string; enemyIdsBySlot: Array<EnemyId | null>; xpReward: number; goldRewardMin: number; goldRewardMax: number; dropTableId: DropTableId; canRetreat: boolean; modifierIds: EncounterModifierId[] }
export interface EncounterModifierDefinition {
  id: EncounterModifierId; nameKey: string; descriptionKey: string;
  rule:
    | { kind: "timedStat"; faction: "party" | "enemy"; stat: "attack" | "defense" | "speed"; valueBps: number; fromRound: number; throughRound: number }
    | { kind: "battleStartShield"; faction: "enemy"; maxHpBps: BasisPoints }
    | { kind: "executeDamage"; faction: "enemy"; targetHpAtMostBps: BasisPoints; damageBonusBps: BasisPoints }
    | { kind: "escalatingStat"; faction: "enemy"; stat: "attack"; perRoundBps: BasisPoints; capBps: BasisPoints }
    | { kind: "healingSuppression"; faction: "party"; valueBps: BasisPoints };
}
export interface AbyssEchoDefinition {
  id: AbyssEchoId; nameKey: string; descriptionKey: string; floorId: FloorId; bossEncounterId: EncounterId;
  enemyHpBps: BasisPoints; enemyAttackBps: BasisPoints; enemyDefenseBps: BasisPoints; enemySpeedBps: BasisPoints; enrageRoundDelta: -2 | -1;
  itemUseLimit: 0 | 1 | 2; objective: { maxRounds: number; maxKnockouts: number; requiredAnyComboTriggers: 0 | 1 };
  bonusAbyssUpgradeChanceBps: BasisPoints; firstClearForgeShards: number; firstClearInscriptionDust: number;
}

export interface FloorDefinition {
  id: FloorId; nameKey: string; floorNumber: number; mapId: MapId; bossEncounterId: EncounterId; assetBundleId: AssetBundleId;
  minItemLevel: number; maxItemLevel: number; recommendedBossLevel: number; recommendedItemLevel: number; bossEnrageRound: number;
  bossGateType: "tutorial" | "currentTier" | "breakthrough"; bossPhaseThresholdBps: BasisPoints[]; shortRouteObjectIds: string[];
  isAbyss: boolean; firstClearRewardTableId: DropTableId;
}
export interface MapDefinition { id: MapId; nameKey: string; widthTiles: number; heightTiles: number; tileSize: 16; assetBundleId: AssetBundleId; spawnPoint: Vector2; groundLayer: number[]; decorBackLayer: number[]; decorFrontLayer: number[]; collisionLayer: Array<0 | 1>; objects: MapObjectDefinition[] }
export type MapObjectDefinition =
  | { kind: "npc"; objectId: string; position: Vector2; npcId: NpcId; blocking: true }
  | { kind: "encounter"; objectId: string; position: Vector2; encounterId: EncounterId; behavior: EncounterBehavior }
  | { kind: "chest"; objectId: string; position: Vector2; dropTableId: DropTableId; frameId: "object_chest_closed" }
  | { kind: "portal"; objectId: string; position: Vector2; action: PortalAction; frameId: "object_portal_floor" | "object_portal_return" };
export interface EncounterBehavior { mode: "patrol" | "wander" | "stationary"; patrolPoints: Vector2[]; wanderRadius: number; detectionRadius: number; leashRadius: number; moveSpeed: number }
export type PortalAction = { kind: "openFloorSelect" } | { kind: "returnTown" };
export interface NpcDefinition { id: NpcId; nameKey: string; function: "tavern" | "blacksmith" | "skillMentor" | "merchant" | "inn" | "cartographer" | "abyssWatcher"; unlockCondition: UnlockCondition; lockReasonKey: string; dialogueId: DialogueId; spriteId: string }
export type UnlockCondition = { kind: "always" } | { kind: "floorCleared"; floorNumber: number } | { kind: "encounterCleared"; encounterId: EncounterId };
export interface DialogueDefinition { id: DialogueId; pages: Array<{ speakerNpcId: NpcId | null; textKey: string }> }
export interface QuestDefinition { id: QuestId; nameKey: string; descriptionKey: string; unlockCondition: UnlockCondition; completionCondition: UnlockCondition }
export interface RecruitmentDefinition { id: RecruitmentId; characterId: CharacterId; condition: RecruitmentCondition }
export type RecruitmentCondition = { kind: "questCompleted"; questId: QuestId } | { kind: "gold"; goldCost: number; minimumClearedFloor: number } | { kind: "firstClear"; floorNumber: number };
export interface ShopDefinition { id: ShopId; npcId: NpcId; tiers: ShopTierDefinition[] }
export interface ShopTierDefinition { minHighestUnlockedFloor: number; offerCount: number; itemLevelMin: number; itemLevelMax: number; offerKindWeights: { stackableItem: number; equipment: number; skillStone: number }; stackableItems: Array<{ itemId: ItemId; weight: number; quantityMin: number; quantityMax: number }>; equipmentBasePools: EquipmentBasePoolGroupV1[]; equipmentQualityWeights: Array<{ quality: EquipmentQuality; weight: number }>; skillStoneQualityWeights: Array<{ quality: SkillStoneQuality; weight: number }> }
export interface EquipmentBasePoolGroupV1 { slot: EquipmentSlot; weight: number; bases: Array<{ baseId: EquipmentBaseId; weight: number }> }

export interface DropTableDefinition { id: DropTableId; rolls: DropRollDefinition[] }
export type DropRollDefinition =
  | { kind: "stackableItem"; itemId: ItemId; chanceBps: BasisPoints; quantityMin: number; quantityMax: number }
  | { kind: "stackableItemPool"; itemPool: Array<{ itemId: ItemId; weight: number }>; chanceBps: BasisPoints; quantityMin: number; quantityMax: number }
  | { kind: "equipment"; chanceBps: BasisPoints; itemLevelMin: number; itemLevelMax: number; equipmentBasePools: EquipmentBasePoolGroupV1[]; qualityWeights: Array<{ quality: EquipmentQuality; weight: number }>; guaranteedMinQuality: EquipmentQuality | null; abyssUpgradeChanceBps: BasisPoints }
  | { kind: "skillStone"; chanceBps: BasisPoints; itemLevelMin: number; itemLevelMax: number; qualityWeights: Array<{ quality: SkillStoneQuality; weight: number }>; guaranteedMinQuality: SkillStoneQuality | null }
  | { kind: "fixedEquipment"; chanceBps: BasisPoints; baseId: EquipmentBaseId; itemLevel: number; quality: EquipmentQuality; craftGrade: CraftGrade | "weighted"; fixedAbyssAffixId: EquipmentAffixId | null };
export type StackableItemDefinition = ConsumableItemDefinition | MaterialItemDefinition;
export interface ConsumableItemDefinition { id: ItemId; nameKey: string; category: "consumable"; maxStack: 99; baseGoldValue: number; iconId: string; useContexts: Array<"field" | "battle">; targetRule: TargetRule; effects: EffectSpec[] }
export interface MaterialItemDefinition { id: ItemId; nameKey: string; category: "material"; maxStack: 99; baseGoldValue: number; iconId: string }
export interface EconomyDefinition { equipmentSellRateBps: 2500; shopBuyMarkupBps: 20000; buybackLimit: 10; innCostGold: 0; craftGradeWeights: { ordinary: 70; tempered: 25; exalted: 5 }; equipmentDisassembleYieldByQuality: Record<EquipmentQuality, number>; skillStoneDisassembleYieldByQuality: Record<SkillStoneQuality, number>; equipmentDisassembleMaterialItemId: ItemId; skillStoneDisassembleMaterialItemId: ItemId; stackableTotalCap: 9999; equipmentReforgeBaseCost: 5; equipmentReforgePerItemLevelCost: 1; skillStoneReforgeBaseCost: 5; skillStoneReforgePerTwoItemLevelsCost: 1 }

export type ShopOfferV1 = { offerId: string; kind: "stackableItem"; itemId: ItemId; quantity: number; goldPrice: number; sold: boolean } | { offerId: string; kind: "equipment"; equipment: EquipmentInstance; goldPrice: number; sold: boolean } | { offerId: string; kind: "skillStone"; skillStone: SkillStoneInstance; goldPrice: number; sold: boolean };
export interface ShopStateV1 { stockRevision: number; generatedFromExpeditionId: string | null; offers: ShopOfferV1[] }
export type BuybackEntryV1 = { sequence: number; kind: "equipment"; equipment: EquipmentInstance; goldPrice: number } | { sequence: number; kind: "skillStone"; skillStone: SkillStoneInstance; goldPrice: number } | { sequence: number; kind: "stackableItem"; itemId: ItemId; quantity: number; goldPrice: number };

export interface CharacterProgressV1 { characterId: CharacterId; recruited: boolean; level: number; xp: number; currentHp: number; skillPoints: number; skillLevels: Record<SkillId, number>; equippedActiveSkillIds: [SkillId | null, SkillId | null]; equipmentBySlot: Record<EquipmentSlot, InstanceId | null>; skillStoneInstanceId: InstanceId | null }
export interface InventoryStateV1 { equipment: EquipmentInstance[]; skillStones: SkillStoneInstance[]; stackables: Record<ItemId, number>; overflowEquipment: EquipmentInstance[]; overflowSkillStones: SkillStoneInstance[] }
export interface PartyStateV1 { slots: [CharacterId | null, CharacterId | null, CharacterId | null, CharacterId | null] }
export interface WorldProgressV1 { highestUnlockedFloor: number; clearedBossEncounterIds: EncounterId[]; bossRetryUnlockedFloorIds: FloorId[]; completedQuestIds: QuestId[]; discoveredComboIds: ComboId[]; discoveredEnemyIds: EnemyId[]; echoCharges: number; echoAttemptSequence: number; clearedEchoIds: AbyssEchoId[]; storyCompleted: boolean }
export interface ExpeditionSnapshotV1 { expeditionId: string; expeditionSeed: number; mode: "exploration" | "shortFarm" | "bossRetry" | "abyssEcho"; abyssEchoId: AbyssEchoId | null; floorId: FloorId; mapId: MapId; playerPosition: Vector2; safePosition: Vector2; defeatedEncounterObjectIds: string[]; openedChestObjectIds: string[]; encounterProtectionStepsRemaining: number; focusedEliteStoneConsumed: boolean; startedAt: string }
export interface BattleAssistStateV1 { enabled: boolean; lastActionByCharacter: Record<CharacterId, { kind: "basic" } | { kind: "active"; skillId: SkillId } | null> }
export interface GameSettingsV1 { qualityPreset: "battery" | "standard" | "high"; battleAnimationSpeed: 1 | 2; musicVolume: number; sfxVolume: number; reducedFlashes: boolean; reducedScreenShake: boolean }

export type BattleActionDefinitionIdV1 = SkillId | ItemId | "action_defend" | "action_retreat" | "action_skip_control" | "action_declare_intent";
export type TriggerSourceV1 = { kind: "combo"; comboId: ComboId; ownerKey: string } | { kind: "equipmentAffix"; affixId: EquipmentAffixId; ownerUnitId: string; sourceInstanceId: InstanceId; sourceRollIndex: number | "abyss" } | { kind: "skillAffix"; skillAffixId: SkillAffixId; ownerUnitId: string; sourceInstanceId: InstanceId; sourceRollIndex: number | "abyss" } | { kind: "status"; statusId: StatusId; statusStackId: string; ownerUnitId: string };
export type TriggerSkillKindV1 = "basic" | "active" | "ultimate" | "effect";
export type BattleActionKindV1 = TriggerSkillKindV1 | "defend" | "item" | "retreat" | "skip" | "intent";
export interface BattleUnitStateV1 { unitId: string; definitionId: CharacterId | EnemyId; faction: "party" | "enemy"; slot: number; level: number; prePercentStats: StatBlock; staticPercentByStatBps: Record<keyof StatBlock, number>; stats: StatBlock; currentHp: number; energy: number; cooldowns: Record<SkillId, number>; statuses: RuntimeStatusStack[]; eligibleRound: number; usedExtraTurnThisRound: boolean; directHitEnergyRootActionIds: string[] }
export interface PendingBattleEventV1 { eventId: string; rootActionId: string; rootActionDefinitionId: BattleActionDefinitionIdV1; chainDepth: number; sourceUnitId: string; targetUnitIds: string[]; effectIndex: number; effect: EffectSpec; triggerSource: TriggerSourceV1 | null; visualSkillId: SkillId | null; contextSkillKind: TriggerSkillKindV1 | null }
export interface PendingBossIntentV1 { intentId: BossIntentId; sourceUnitId: string; skillId: SkillId; targetStrategy: EnemyTargetStrategy; declaredRound: number }
export interface BattleEventBaseV1 { eventId: string; sequence: number; battleId: string; round: number; rootActionId: string | null; rootActionDefinitionId: BattleActionDefinitionIdV1 | null; chainDepth: number; triggerSource: TriggerSourceV1 | null; visualSkillId: SkillId | null; contextSkillKind: TriggerSkillKindV1 | null; effect: EffectSpec | null }
export type BattleDomainEventV1 =
  | (BattleEventBaseV1 & { type: "PHASE_CHANGED"; from: BattlePhase; to: BattlePhase })
  | (BattleEventBaseV1 & { type: "ACTION_STARTED"; actorUnitId: string; actionKind: Exclude<BattleActionKindV1, "effect">; targetUnitIds: string[] })
  | (BattleEventBaseV1 & { type: "INTENT_DECLARED"; intentId: BossIntentId; sourceUnitId: string; skillId: SkillId; targetStrategy: EnemyTargetStrategy })
  | (BattleEventBaseV1 & { type: "INTENT_RELEASED"; intentId: BossIntentId; sourceUnitId: string; skillId: SkillId })
  | (BattleEventBaseV1 & { type: "INTENT_CLEARED"; intentId: BossIntentId; sourceUnitId: string; reason: "sourceDefeated" | "battleFinished" })
  | (BattleEventBaseV1 & { type: "DAMAGE_RESOLVED"; sourceUnitId: string; targetUnitId: string; effectIndex: number; hitIndex: number; damageKind: "direct" | "periodic"; element: Element; hitResult: "critical" | "nonCritical" | "notApplicable"; varianceBps: BasisPoints | null; effectiveDefense: number; elementMultiplierBps: 7500 | 10000 | 12500; shieldDamage: number; hpDamage: number; overkill: number; hpBefore: number; hpAfter: number })
  | (BattleEventBaseV1 & { type: "HEAL_RESOLVED"; sourceUnitId: string; targetUnitId: string; effectIndex: number; hitResult: "critical" | "nonCritical" | "notApplicable"; healed: number; overheal: number; hpBefore: number; hpAfter: number })
  | (BattleEventBaseV1 & { type: "SHIELD_GRANTED"; sourceUnitId: string; targetUnitId: string; effectIndex: number; statusStackId: string | null; granted: number; discardedByCap: number; shieldAfter: number })
  | (BattleEventBaseV1 & { type: "STATUS_CHANGED"; sourceUnitId: string | null; targetUnitId: string; statusId: StatusId; statusStackId: string | null; change: "applied" | "refreshed" | "stacked" | "capped" | "consumed" | "dispelled" | "expired" | "resisted" | "immune" | "depleted"; stacksBefore: number; stacksAfter: number; remainingOwnerTurnsAfter: number })
  | (BattleEventBaseV1 & { type: "RESOURCE_CHANGED"; targetUnitId: string; resource: "energy" | "cooldown"; skillId: SkillId | null; before: number; after: number; reason: "actionCost" | "actionGain" | "directHit" | "damageTaken" | "turnEnd" | "effect" })
  | (BattleEventBaseV1 & { type: "UNIT_SUMMONED"; sourceUnitId: string; unitId: string; enemyId: EnemyId; slot: number; eligibleRound: number })
  | (BattleEventBaseV1 & { type: "UNIT_DEFEATED"; sourceUnitId: string | null; unitId: string })
  | (BattleEventBaseV1 & { type: "UNIT_REVIVED"; sourceUnitId: string; unitId: string; restoredHp: number })
  | (BattleEventBaseV1 & { type: "TURN_SKIPPED"; unitId: string; reason: "defeated" | "control"; statusId: StatusId | null })
  | (BattleEventBaseV1 & { type: "EXTRA_TURN_RESOLVED"; unitId: string; result: "granted" | "suppressed" })
  | (BattleEventBaseV1 & { type: "COMBO_TRIGGERED"; comboId: ComboId; ownerKey: string; targetUnitIds: string[]; firstInBattle: boolean })
  | (BattleEventBaseV1 & { type: "TRIGGER_REJECTED"; sourceKey: string; reason: "CHAIN_DEPTH" | "ROOT_BUDGET" | "ROUND_BUDGET" | "BATTLE_BUDGET" | "UNIT_DAMAGE_BUDGET" | "GLOBAL_EVENT_BUDGET" | "SOURCE_INVALID" | "TARGET_INVALID" | "CHANCE_FAILED"; consumedRng: boolean })
  | (BattleEventBaseV1 & { type: "ACTION_FINISHED"; actorUnitId: string; outcomeAfter: "ongoing" | "victory" | "defeat" | "retreat" })
  | (BattleEventBaseV1 & { type: "BATTLE_FINISHED"; outcome: "victory" | "defeat" | "retreat" })
  | (BattleEventBaseV1 & { type: "ABYSS_ECHO_EVALUATED"; echoId: AbyssEchoId; success: boolean; failedReasons: Array<"MAX_ROUNDS" | "MAX_KNOCKOUTS" | "COMBO_REQUIRED"> })
  | (BattleEventBaseV1 & { type: "REWARD_PREPARED"; transactionId: string });
export interface BattleResolutionV1 { snapshot: BattleSnapshotV1; events: BattleDomainEventV1[]; consumedItem: { itemId: ItemId; quantity: 1 } | null }
export interface BattleDamageMetricV1 { sourceFaction: "party" | "enemy"; sourceKind: "skill" | "item" | "combo" | "equipmentAffix" | "skillAffix" | "status"; sourceDefinitionId: string; element: Element; resolvedDamage: number; weaknessResolvedDamage: number }
export interface BattleMetricsV1 { damage: BattleDamageMetricV1[]; partyDamageTaken: number; partyHealingDone: number; partyShieldGranted: number; knockouts: Array<{ unitId: string; round: number; rootActionId: string }>; comboTriggerCounts: Record<ComboId, number>; bossEnrageCast: boolean; maxChainDepth: number; triggerBudgetExhaustedCount: number }
export interface BattleSnapshotV1 { battleId: string; expeditionId: string; battleRevision: number; encounterId: EncounterId; encounterObjectId: string; phase: BattlePhase; outcome: "ongoing" | "victory" | "defeat" | "retreat"; round: number; units: BattleUnitStateV1[]; initiativeQueueUnitIds: string[]; currentUnitId: string | null; pendingEvents: PendingBattleEventV1[]; pendingBossIntents: PendingBossIntentV1[]; successfulItemUses: number; abyssEchoOutcome: "notApplicable" | "pending" | "success" | "failed"; rngState: [number, number, number, number]; firedComboKeys: string[]; roundTriggerCounts: Record<string, number>; battleTriggerCounts: Record<string, number>; metrics: BattleMetricsV1; reward: RewardTransactionV1 | null; returnMapId: MapId; returnSafePosition: Vector2 }
export interface RewardTransactionV1 { transactionId: string; source: { kind: "encounter"; encounterId: EncounterId; mapId: MapId; objectId: string } | { kind: "chest"; mapId: MapId; objectId: string; dropTableId: DropTableId } | { kind: "abyssEcho"; echoId: AbyssEchoId; encounterId: EncounterId }; gold: number; xp: number; stackables: Record<ItemId, number>; stackableCapConversions: Array<{ itemId: ItemId; quantity: number; gold: number }>; equipment: EquipmentInstance[]; skillStones: SkillStoneInstance[]; instanceOrder: InstanceId[]; claimed: boolean }
export interface GameSaveV1 { schemaVersion: 1; contentVersion: "content-1.2.0"; saveId: "slot_1"; revision: number; createdAt: string; updatedAt: string; gold: number; skillStoneFocusCharacterId: CharacterId; characters: Record<CharacterId, CharacterProgressV1>; party: PartyStateV1; inventory: InventoryStateV1; shop: ShopStateV1; world: WorldProgressV1; expedition: ExpeditionSnapshotV1 | null; battle: BattleSnapshotV1 | null; battleAssist: BattleAssistStateV1; settings: GameSettingsV1; claimedRewardTransactionIds: string[] }
export interface UseFieldItemCommandV1 { expectedRevision: number; itemId: ItemId; targetCharacterId: CharacterId }
export type BattleCommandV1 = { type: "USE_BASIC"; expectedBattleRevision: number; actorUnitId: string; targetUnitIds: string[] } | { type: "USE_SKILL"; expectedBattleRevision: number; actorUnitId: string; skillId: SkillId; targetUnitIds: string[] } | { type: "USE_ULTIMATE"; expectedBattleRevision: number; actorUnitId: string; skillId: SkillId; targetUnitIds: string[] } | { type: "DEFEND"; expectedBattleRevision: number; actorUnitId: string } | { type: "USE_ITEM"; expectedBattleRevision: number; actorUnitId: string; itemId: ItemId; targetUnitIds: string[] } | { type: "RETREAT"; expectedBattleRevision: number; actorUnitId: string };
export type DomainErrorV1 = { [Code in DomainErrorCode]: { code: Code; details: DomainErrorDetailsByCode[Code] } }[DomainErrorCode];
