import { describe, expect, it } from "vitest";

import {
  affixTriggerDefinitionSchema,
  contentRootSchema,
  effectSpecSchema,
  equipmentAffixDefinitionSchema,
  statBlockSchema,
} from "../../src/content/schemas";
import type { BattleDomainEventV1 } from "../../src/content/contracts";

const battleEventTypeCoverage: Record<BattleDomainEventV1["type"], true> = {
  PHASE_CHANGED: true,
  ACTION_STARTED: true,
  INTENT_DECLARED: true,
  INTENT_RELEASED: true,
  INTENT_CLEARED: true,
  DAMAGE_RESOLVED: true,
  HEAL_RESOLVED: true,
  SHIELD_GRANTED: true,
  STATUS_CHANGED: true,
  RESOURCE_CHANGED: true,
  UNIT_SUMMONED: true,
  UNIT_DEFEATED: true,
  UNIT_REVIVED: true,
  TURN_SKIPPED: true,
  EXTRA_TURN_RESOLVED: true,
  COMBO_TRIGGERED: true,
  TRIGGER_REJECTED: true,
  ACTION_FINISHED: true,
  BATTLE_FINISHED: true,
  ABYSS_ECHO_EVALUATED: true,
  REWARD_PREPARED: true,
};

function validEquipmentAffix(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "af_fixture",
    nameKey: "affix.af_fixture.name",
    descriptionKey: "affix.af_fixture.description",
    category: "baseStat",
    pool: "normal",
    allowedSlots: ["weapon"],
    allowedWeaponTypes: ["sword"],
    minItemLevel: 1,
    allowedQualities: ["common"],
    exclusiveGroup: null,
    stackRule: "add",
    weight: 1,
    goldValue: 1,
    canBeCraftEmpowered: true,
    tiers: [{ tier: 1, minItemLevel: 1, rollMin: 1, rollMax: 1 }],
    modifiers: [{ kind: "flatStat", stat: "attack", rollScaleBps: 10_000 }],
    tags: [],
    ...overrides,
  };
}

describe("content schemas", () => {
  it("keeps the complete BattleDomainEvent discriminant union exhaustive", () => {
    expect(Object.keys(battleEventTypeCoverage)).toHaveLength(21);
  });
  it("rejects missing fields and unknown aliases", () => {
    const missing = statBlockSchema.safeParse({
      maxHp: 1,
      attack: 1,
      defense: 1,
      speed: 1,
      critRateBps: 0,
      critDamageBps: 10_000,
      effectHitBps: 0,
    });
    const alias = statBlockSchema.safeParse({
      maxHp: 1,
      attack: 1,
      defense: 1,
      speed: 1,
      critRateBps: 0,
      critDamageBps: 10_000,
      effectHitBps: 0,
      effectResistBps: 0,
      maxHP: 2,
    });

    expect(missing.success).toBe(false);
    expect(alias.success).toBe(false);
  });

  it("rejects a root with an extra field", () => {
    const result = contentRootSchema.safeParse({
      schemaVersion: 1,
      contentVersion: "content-1.2.0",
      protagonistCharacterId: "char_wanderer",
      characters: [],
      skills: [],
      statuses: [],
      equipmentBases: [],
      equipmentAffixes: [],
      affixTriggers: [],
      skillAffixes: [],
      combos: [],
      enemies: [],
      encounters: [],
      encounterModifiers: [],
      bossIntents: [],
      abyssEchoes: [],
      floors: [],
      maps: [],
      npcs: [],
      dialogues: [],
      quests: [],
      recruitments: [],
      shops: [],
      items: [],
      dropTables: [],
      economy: {},
      alias: true,
    });

    expect(result.success).toBe(false);
  });

  it("keeps probability and damage/power BPS ranges semantically separate", () => {
    const damage = effectSpecSchema.safeParse({
      kind: "damage",
      targetRule: "singleEnemy",
      element: "physical",
      powerBps: 11_000,
      flatPower: 0,
      canCrit: true,
      ignoreDefenseBps: 0,
      flatIgnoreDefense: 0,
      hitCount: 1,
      retargetEachHit: false,
      conditionalMultipliers: [{
        condition: { kind: "targetHpAtMostBps", valueBps: 3_000 },
        multiplierBps: 14_000,
      }],
    });
    const affix = equipmentAffixDefinitionSchema.safeParse(validEquipmentAffix({
      modifiers: [{ kind: "finalDamageMultiplier", rollScaleBps: 15_000 }],
    }));
    const trigger = affixTriggerDefinitionSchema.safeParse({
      id: "tr_fixture",
      trigger: {
        event: "afterDirectHit",
        requiredSkillKinds: [],
        requiredHitResult: "any",
        requiredSourceHpAtMostBps: null,
        requiredTargetHpAtMostBps: null,
        requiredSourceStatusIds: [],
        requiredTargetStatusIds: [],
        consumeTargetStatus: null,
      },
      chance: { kind: "fixed", valueBps: 10_000 },
      effects: [{
        kind: "damage",
        targetRule: "singleEnemy",
        element: "physical",
        powerBps: 11_000,
        flatPower: 0,
        canCrit: false,
        ignoreDefenseBps: 0,
        flatIgnoreDefense: 0,
        hitCount: 1,
        retargetEachHit: false,
        conditionalMultipliers: [],
      }],
      budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 },
    });

    expect(damage.success).toBe(true);
    expect(affix.success).toBe(true);
    expect(trigger.success).toBe(true);

    const invalidChance = affixTriggerDefinitionSchema.safeParse({
      id: "tr_fixture",
      trigger: {
        event: "afterDirectHit",
        requiredSkillKinds: [],
        requiredHitResult: "any",
        requiredSourceHpAtMostBps: null,
        requiredTargetHpAtMostBps: null,
        requiredSourceStatusIds: [],
        requiredTargetStatusIds: [],
        consumeTargetStatus: null,
      },
      chance: { kind: "fixed", valueBps: 10_001 },
      effects: [{
        kind: "damage",
        targetRule: "singleEnemy",
        element: "physical",
        powerBps: 11_000,
        flatPower: 0,
        canCrit: false,
        ignoreDefenseBps: 0,
        flatIgnoreDefense: 0,
        hitCount: 1,
        retargetEachHit: false,
        conditionalMultipliers: [],
      }],
      budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 },
    });
    expect(invalidChance.success).toBe(false);
  });
});
