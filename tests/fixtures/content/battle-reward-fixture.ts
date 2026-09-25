import type {
  BattleSnapshotV1,
  BattleUnitStateV1,
  DropRollDefinition,
  DropTableDefinition,
  Element,
  EnemyDefinition,
  EquipmentAffixDefinition,
  EquipmentBaseDefinition,
  EquipmentInstance,
  EconomyDefinition,
  EncounterDefinition,
  InventoryStateV1,
  SkillDefinition,
  SkillStoneInstance,
  StatBlock,
} from "../../../src/content/contracts";
import { failure, success, type DomainResult } from "../../../src/domain/common/DomainResult";
import type { EquipmentContentSource } from "../../../src/domain/inventory/EquipmentGenerator";
import type { SkillStoneContentSource } from "../../../src/domain/skill/SkillStoneGenerator";

export const fixtureStats: StatBlock = {
  maxHp: 100,
  attack: 30,
  defense: 20,
  speed: 40,
  critRateBps: 0,
  critDamageBps: 15_000,
  effectHitBps: 0,
  effectResistBps: 0,
};

export function makeUnit(
  overrides: Partial<BattleUnitStateV1> & Pick<BattleUnitStateV1, "unitId" | "definitionId" | "faction" | "slot">,
): BattleUnitStateV1 {
  const stats = overrides.stats ?? { ...fixtureStats };
  return {
    unitId: overrides.unitId,
    definitionId: overrides.definitionId,
    faction: overrides.faction,
    slot: overrides.slot,
    level: overrides.level ?? 1,
    prePercentStats: { ...(overrides.prePercentStats ?? stats) },
    staticPercentByStatBps: {
      maxHp: 0,
      attack: 0,
      defense: 0,
      speed: 0,
      critRateBps: 0,
      critDamageBps: 0,
      effectHitBps: 0,
      effectResistBps: 0,
      ...(overrides.staticPercentByStatBps ?? {}),
    },
    stats: { ...stats },
    currentHp: overrides.currentHp ?? stats.maxHp,
    energy: overrides.energy ?? 0,
    cooldowns: { ...(overrides.cooldowns ?? {}) },
    statuses: overrides.statuses?.map((status) => ({ ...status })) ?? [],
    eligibleRound: overrides.eligibleRound ?? 1,
    usedExtraTurnThisRound: overrides.usedExtraTurnThisRound ?? false,
    directHitEnergyRootActionIds: [...(overrides.directHitEnergyRootActionIds ?? [])],
  };
}

export function makeSnapshot(
  units: BattleUnitStateV1[] = [
    makeUnit({ unitId: "party:0", definitionId: "char_fixture", faction: "party", slot: 0 }),
    makeUnit({ unitId: "enemy:0", definitionId: "enemy_fixture", faction: "enemy", slot: 0 }),
  ],
  overrides: Partial<BattleSnapshotV1> = {},
): BattleSnapshotV1 {
  return {
    battleId: "battle_fixture",
    expeditionId: "expedition_fixture",
    battleRevision: 0,
    encounterId: "encounter_fixture",
    encounterObjectId: "object_fixture",
    phase: "AI_DECIDE",
    outcome: "ongoing",
    round: 1,
    units,
    initiativeQueueUnitIds: units.map((unit) => unit.unitId),
    currentUnitId: units.find((unit) => unit.faction === "enemy")?.unitId ?? null,
    pendingEvents: [],
    pendingBossIntents: [],
    successfulItemUses: 0,
    abyssEchoOutcome: "notApplicable",
    rngState: [1, 2, 3, 4],
    firedComboKeys: [],
    roundTriggerCounts: {},
    battleTriggerCounts: {},
    metrics: {
      damage: [],
      partyDamageTaken: 0,
      partyHealingDone: 0,
      partyShieldGranted: 0,
      knockouts: [],
      comboTriggerCounts: {},
      bossEnrageCast: false,
      maxChainDepth: 0,
      triggerBudgetExhaustedCount: 0,
    },
    reward: null,
    returnMapId: "map_fixture",
    returnSafePosition: { x: 0, y: 0 },
    ...overrides,
  };
}

export function makeSkill(
  id: string,
  owner: SkillDefinition["owner"],
  options: Partial<SkillDefinition> = {},
): SkillDefinition {
  const targetRule = options.targetRule ?? "singleEnemy";
  return {
    id,
    nameKey: `skill.${id}`,
    descriptionKey: `skill.${id}`,
    owner,
    familyIds: [],
    kind: options.kind ?? "active",
    unlockLevel: 1,
    maxLevel: 5,
    targetRule,
    requiresFrontAccess: options.requiresFrontAccess ?? false,
    cooldownTurnsByLevel: options.cooldownTurnsByLevel ?? [0, 0, 0, 0, 0],
    energyCostByLevel: options.energyCostByLevel ?? [0, 0, 0, 0, 0],
    baseEnergyGainByLevel: options.baseEnergyGainByLevel ?? [0, 0, 0, 0, 0],
    effectsByLevel: options.effectsByLevel ?? [[], [], [], [], []],
    passiveModifiers: [],
    tags: [],
    animationId: `anim_${id}`,
    ...options,
  };
}

export function makeEnemy(
  id = "enemy_fixture",
  options: Partial<EnemyDefinition> = {},
): EnemyDefinition {
  return {
    id,
    nameKey: `enemy.${id}`,
    level: 1,
    stats: { ...fixtureStats },
    elementWeaknesses: [],
    elementResistances: [],
    immunityTags: [],
    basicSkillId: "skill_enemy_basic",
    basicTargetStrategy: "frontFirstOpponent",
    skillIds: ["skill_enemy_attack"],
    aiRules: [],
    spriteId: `sprite_${id}`,
    ...options,
  };
}

export function makeEncounter(options: Partial<EncounterDefinition> = {}): EncounterDefinition {
  return {
    id: "encounter_fixture",
    kind: "normal",
    fieldSpriteId: "sprite_field_encounter_fixture",
    enemyIdsBySlot: ["enemy_fixture", null, null, null, null, null],
    xpReward: 10,
    goldRewardMin: 1,
    goldRewardMax: 2,
    dropTableId: "drop_fixture",
    canRetreat: true,
    modifierIds: [],
    ...options,
  };
}

export function makeEmptyInventory(): InventoryStateV1 {
  return {
    equipment: [],
    skillStones: [],
    stackables: {},
    overflowEquipment: [],
    overflowSkillStones: [],
  };
}

export function makeEquipment(instanceId: string): EquipmentInstance {
  return {
    instanceId,
    baseId: "base_fixture",
    itemLevel: 1,
    quality: "common",
    craftGrade: "ordinary",
    affixes: [],
    abyssAffix: null,
    locked: false,
    acquiredAt: "2026-01-01T00:00:00.000Z",
    sourceTransactionId: "tx_fixture",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
}

export function makeSkillStone(instanceId: string): SkillStoneInstance {
  return {
    instanceId,
    attunedCharacterId: "char_fixture",
    itemLevel: 1,
    quality: "magic",
    affixes: [],
    abyssAffix: null,
    locked: false,
    acquiredAt: "2026-01-01T00:00:00.000Z",
    sourceTransactionId: "tx_fixture",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
}

export const fixtureDropRolls: DropRollDefinition[] = [
  { kind: "stackableItem", itemId: "item_forge_shard", chanceBps: 10_000, quantityMin: 1, quantityMax: 1 },
];

export function makeDropTable(id = "drop_fixture", rolls: DropRollDefinition[] = fixtureDropRolls): DropTableDefinition {
  return { id, rolls };
}

export const fixtureBase: EquipmentBaseDefinition = {
  id: "base_fixture",
  nameKey: "base.fixture",
  slot: "weapon",
  weaponType: "sword",
  minItemLevel: 1,
  maxItemLevel: 50,
  baseStat: "attack",
  baseValueAtMinLevel: 1,
  growthPerItemLevel: 1,
  baseGoldValue: 10,
  goldValuePerItemLevel: 1,
  spriteId: "sprite_base_fixture",
};

export const fixtureAffix: EquipmentAffixDefinition = {
  id: "affix_fixture",
  nameKey: "affix.fixture",
  descriptionKey: "affix.fixture",
  category: "baseStat",
  pool: "normal",
  allowedSlots: ["weapon"],
  allowedWeaponTypes: ["sword"],
  minItemLevel: 1,
  allowedQualities: ["common", "magic", "rare", "epic", "abyss"],
  exclusiveGroup: null,
  stackRule: "add",
  weight: 1,
  goldValue: 1,
  canBeCraftEmpowered: false,
  tiers: [{ tier: 1, minItemLevel: 1, rollMin: 1, rollMax: 1 }],
  modifiers: [{ kind: "flatStat", stat: "attack", rollScaleBps: 100 }],
  tags: [],
};

export const fixtureAffix2: EquipmentAffixDefinition = { ...fixtureAffix, id: "affix_fixture_2", modifiers: [{ kind: "flatStat", stat: "defense", rollScaleBps: 100 }] };
export const fixtureAffix3: EquipmentAffixDefinition = { ...fixtureAffix, id: "affix_fixture_3", modifiers: [{ kind: "flatStat", stat: "speed", rollScaleBps: 100 }] };
export const fixtureAffix4: EquipmentAffixDefinition = { ...fixtureAffix, id: "affix_fixture_4", modifiers: [{ kind: "flatStat", stat: "maxHp", rollScaleBps: 100 }] };
export const fixtureAbyssAffix: EquipmentAffixDefinition = { ...fixtureAffix, id: "affix_fixture_abyss", pool: "abyss", allowedQualities: ["abyss"] };

export const fixtureEconomy: EconomyDefinition = {
  equipmentSellRateBps: 2500,
  shopBuyMarkupBps: 20_000,
  buybackLimit: 10,
  innCostGold: 0,
  craftGradeWeights: { ordinary: 70, tempered: 25, exalted: 5 },
  equipmentDisassembleYieldByQuality: { common: 1, magic: 2, rare: 4, epic: 8, abyss: 16 },
  skillStoneDisassembleYieldByQuality: { magic: 2, rare: 4, epic: 8, abyss: 16 },
  equipmentDisassembleMaterialItemId: "item_forge_shard",
  skillStoneDisassembleMaterialItemId: "item_inscription_dust",
  stackableTotalCap: 9999,
  equipmentReforgeBaseCost: 5,
  equipmentReforgePerItemLevelCost: 1,
  skillStoneReforgeBaseCost: 5,
  skillStoneReforgePerTwoItemLevelsCost: 1,
};

export const fixtureEquipmentContent: EquipmentContentSource = {
  equipmentBases: [fixtureBase],
  equipmentAffixes: [fixtureAffix, fixtureAffix2, fixtureAffix3, fixtureAffix4, fixtureAbyssAffix],
  economy: fixtureEconomy,
};

export function fixtureSkillStoneContent(): SkillStoneContentSource {
  const skill = makeSkill("skill_fixture", { kind: "systemEffect" }, { kind: "basic", targetRule: "self" });
  return {
    getCharacter: (id) => failure({ code: "INVALID_CONTENT", details: { path: `characters.${id}`, issueKey: "missing" } }),
    getSkill: (id) => id === skill.id ? success(skill) : failure({ code: "INVALID_CONTENT", details: { path: `skills.${id}`, issueKey: "missing" } }),
    getSkillAffix: () => failure({ code: "AFFIX_POOL_EMPTY", details: { poolKind: "skillStoneNormal", itemLevel: 1 } }),
    getRoot: () => ({ contentVersion: "content-1.2.0", characters: [], skills: [], skillAffixes: [] }),
  };
}

export function resultGetter<T extends { id: string }>(values: readonly T[]): (id: string) => DomainResult<Readonly<T>> {
  return (id) => {
    const value = values.find((candidate) => candidate.id === id);
    return value
      ? success(value)
      : failure({ code: "INVALID_CONTENT", details: { path: `${id}`, issueKey: "missing" } });
  };
}

export function element(value: Element): Element {
  return value;
}
