import type {
  DamageConditionMultiplier,
  EffectSpec,
  Element,
  PassiveModifierSpec,
  SkillDefinition,
  SkillFamilyId,
  SkillKind,
  TagContribution,
  TargetRule,
} from "../contracts";

type Five<T> = [T, T, T, T, T];

function five<T>(values: readonly [T, T, T, T, T]): Five<T> {
  return [values[0], values[1], values[2], values[3], values[4]];
}

function damage(
  element: Element,
  targetRule: TargetRule,
  powerBps: number,
  hitCount = 1,
  canCrit = true,
  conditionalMultipliers: readonly DamageConditionMultiplier[] = [],
  retargetEachHit = false,
): EffectSpec {
  return { kind: "damage", targetRule, element, powerBps, flatPower: 0, canCrit, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount, retargetEachHit, conditionalMultipliers: conditionalMultipliers.map((value) => ({ ...value, condition: { ...value.condition } })) };
}

function heal(targetRule: TargetRule, powerBps: number, scalingStat: "attack" | "maxHp" = "attack"): EffectSpec {
  return { kind: "heal", targetRule, scalingStat, powerBps, flatPower: 0, canCrit: false };
}

function shield(targetRule: TargetRule, powerBps: number, scalingStat: "attack" | "maxHp"): EffectSpec {
  return { kind: "shield", targetRule, scalingStat, powerBps, flatPower: 0, statusId: "status_shield", durationOwnerTurns: 2 };
}

function applyStatus(targetRule: TargetRule, statusId: string, baseChanceBps: number, stacks: number, durationOwnerTurns: number): EffectSpec {
  return { kind: "applyStatus", targetRule, statusId, baseChanceBps, stacks, durationOwnerTurns };
}

function consumeStatus(targetRule: TargetRule, statusId: string, stacks: number): EffectSpec {
  return { kind: "consumeStatus", targetRule, statusId, stacks };
}

function energy(targetRule: TargetRule, amount: number): EffectSpec {
  return { kind: "changeEnergy", targetRule, amount };
}

function dispel(targetRule: TargetRule, polarity: "buff" | "debuff", count: number): EffectSpec {
  return { kind: "dispel", targetRule, polarity, count };
}

function revive(restoreMaxHpBps: number): EffectSpec {
  return { kind: "revive", targetRule: "deadAlly", restoreMaxHpBps };
}

function levelEffects(factory: (index: number) => EffectSpec[]): Five<EffectSpec[]> {
  return five([factory(0), factory(1), factory(2), factory(3), factory(4)]);
}

function staticEffects(effects: readonly EffectSpec[]): Five<EffectSpec[]> {
  return levelEffects(() => effects.map((effect) => ({ ...effect })));
}

function damageLevels(
  powers: readonly [number, number, number, number, number],
  element: Element,
  targetRule: TargetRule,
  hitCounts: readonly [number, number, number, number, number] = [1, 1, 1, 1, 1],
  canCrit = true,
  conditionalByLevel: readonly (readonly DamageConditionMultiplier[])[] = [[], [], [], [], []],
  retargetEachHit = false,
): Five<EffectSpec[]> {
  return levelEffects((index) => [damage(element, targetRule, powers[index], hitCounts[index], canCrit, conditionalByLevel[index], retargetEachHit)]);
}

function skill(
  id: string,
  ownerCharacterId: string | null,
  kind: SkillKind,
  unlockLevel: number,
  targetRule: TargetRule,
  requiresFrontAccess: boolean,
  cooldown: readonly [number, number, number, number, number],
  energyCost: readonly [number, number, number, number, number],
  baseEnergyGain: readonly [number, number, number, number, number],
  familyIds: readonly SkillFamilyId[],
  tags: readonly TagContribution[],
  effectsByLevel: Five<EffectSpec[]>,
  passiveModifiers: readonly PassiveModifierSpec[] = [],
): SkillDefinition {
  return {
    id,
    nameKey: `skill.${id}.name`,
    descriptionKey: `skill.${id}.description`,
    owner: ownerCharacterId === null ? { kind: "systemEffect" } : { kind: "character", characterId: ownerCharacterId },
    familyIds: [...familyIds],
    kind,
    unlockLevel,
    maxLevel: kind === "active" ? 5 : 1,
    targetRule,
    requiresFrontAccess,
    cooldownTurnsByLevel: five(cooldown),
    energyCostByLevel: five(energyCost),
    baseEnergyGainByLevel: five(baseEnergyGain),
    effectsByLevel,
    passiveModifiers: [...passiveModifiers],
    tags: tags.map((value) => ({ ...value })),
    animationId: `anim_${id}`,
  };
}

const zero = [0, 0, 0, 0, 0] as const;
const basicEnergyGain = [25, 25, 25, 25, 25] as const;
const activeEnergyGain = [10, 10, 10, 10, 10] as const;
const ultimateCost = [100, 100, 100, 100, 100] as const;
const emptyTags: readonly TagContribution[] = [];

const skillDefinitions: SkillDefinition[] = [
  skill("skill_wanderer_strike", "char_wanderer", "basic", 1, "singleEnemy", true, zero, zero, basicEnergyGain, ["basic", "sword"], emptyTags, damageLevels([10_000, 10_000, 10_000, 10_000, 10_000], "physical", "singleEnemy")),
  skill("skill_wanderer_rending_slash", "char_wanderer", "active", 1, "singleEnemy", true, [2, 2, 2, 2, 2], zero, activeEnergyGain, ["sword", "bleed"], [{ tagId: "bleed", count: 1 }], levelEffects((index) => [damage("physical", "singleEnemy", [11_000, 12_000, 13_000, 14_000, 15_000][index]), applyStatus("singleEnemy", "status_bleed", [7000, 7500, 8000, 8500, 9000][index], 1, 3)])),
  skill("skill_wanderer_guarding_blow", "char_wanderer", "active", 3, "singleEnemy", true, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["sword", "guard"], [{ tagId: "guard", count: 1 }, { tagId: "shield", count: 1 }], levelEffects((index) => [damage("physical", "singleEnemy", [9000, 9500, 10_000, 10_500, 11_000][index]), shield("self", [6000, 6500, 7000, 7500, 8000][index], "attack")])),
  skill("skill_wanderer_execution", "char_wanderer", "active", 6, "singleEnemy", true, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["sword", "execute"], [{ tagId: "execute", count: 1 }], damageLevels([13_500, 14_500, 15_500, 16_500, 17_500], "physical", "singleEnemy", [1, 1, 1, 1, 1], true, [[{ condition: { kind: "targetHpAtMostBps", valueBps: 3500 }, multiplierBps: 15_000 }], [{ condition: { kind: "targetHpAtMostBps", valueBps: 3500 }, multiplierBps: 15_000 }], [{ condition: { kind: "targetHpAtMostBps", valueBps: 3500 }, multiplierBps: 15_000 }], [{ condition: { kind: "targetHpAtMostBps", valueBps: 3500 }, multiplierBps: 15_000 }], [{ condition: { kind: "targetHpAtMostBps", valueBps: 3500 }, multiplierBps: 15_000 }]])),
  skill("skill_wanderer_blood_rally", "char_wanderer", "active", 10, "allEnemies", false, [4, 4, 4, 4, 4], zero, activeEnergyGain, ["sword", "bleed"], [{ tagId: "bleed", count: 1 }, { tagId: "guard", count: 1 }], levelEffects((index) => [damage("physical", "allEnemies", [7500, 8000, 8500, 9000, 9500][index]), applyStatus("self", "status_attack_up", 10_000, 1, 2)])),
  skill("skill_wanderer_endless_edge", "char_wanderer", "ultimate", 1, "allEnemies", false, zero, ultimateCost, zero, ["sword", "bleed", "ultimate"], [{ tagId: "bleed", count: 1 }, { tagId: "execute", count: 1 }], levelEffects(() => [damage("physical", "allEnemies", 14_000, 1, true, [{ condition: { kind: "targetStatusStacksAtLeast", statusId: "status_bleed", stacks: 3 }, multiplierBps: 13_000 }]), consumeStatus("allEnemies", "status_bleed", 3)])),
  skill("skill_wanderer_instinct", "char_wanderer", "passive", 1, "self", false, zero, zero, zero, ["passive"], [{ tagId: "bleed", count: 1 }, { tagId: "guard", count: 1 }], staticEffects([]), [{ kind: "percentStat", stat: "attack", valueBps: 800 }]),

  skill("skill_guard_hammer", "char_iron_guard", "basic", 1, "singleEnemy", true, zero, zero, basicEnergyGain, ["basic", "hammer"], emptyTags, damageLevels([10_000, 10_000, 10_000, 10_000, 10_000], "physical", "singleEnemy")),
  skill("skill_guard_shield_bash", "char_iron_guard", "active", 1, "singleEnemy", true, [2, 2, 2, 2, 2], zero, activeEnergyGain, ["hammer", "control"], [{ tagId: "taunt", count: 1 }, { tagId: "counter", count: 1 }], levelEffects((index) => [damage("physical", "singleEnemy", [9500, 10_000, 10_500, 11_000, 11_500][index]), applyStatus("singleEnemy", "status_taunt", [7000, 7500, 8000, 8500, 9000][index], 1, 2)])),
  skill("skill_guard_fortify", "char_iron_guard", "active", 3, "self", false, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["shield", "guard"], [{ tagId: "shield", count: 2 }, { tagId: "guard", count: 1 }], levelEffects((index) => [shield("self", [1500, 1700, 1900, 2100, 2300][index], "maxHp"), applyStatus("self", "status_guard_30", 10_000, 1, 1)])),
  skill("skill_guard_banner", "char_iron_guard", "active", 6, "allAllies", false, [4, 4, 4, 4, 4], zero, activeEnergyGain, ["shield", "support"], [{ tagId: "shield", count: 1 }, { tagId: "support", count: 1 }], levelEffects((index) => [shield("allAllies", [6000, 7000, 8000, 9000, 10_000][index], "attack"), applyStatus("allAllies", "status_defense_up", 10_000, 1, 2)])),
  skill("skill_guard_challenge", "char_iron_guard", "active", 10, "allEnemies", false, [4, 4, 4, 4, 4], zero, activeEnergyGain, ["taunt", "guard"], [{ tagId: "taunt", count: 2 }, { tagId: "counter", count: 1 }], levelEffects((index) => [applyStatus("allEnemies", "status_taunt", [7000, 7500, 8000, 8500, 9000][index], 1, 2), applyStatus("self", "status_attack_up", 10_000, 1, 2)])),
  skill("skill_guard_iron_citadel", "char_iron_guard", "ultimate", 1, "allAllies", false, zero, ultimateCost, zero, ["shield", "guard", "ultimate"], [{ tagId: "shield", count: 2 }, { tagId: "guard", count: 2 }], staticEffects([shield("allAllies", 2500, "maxHp"), applyStatus("allAllies", "status_guard_30", 10_000, 1, 1)])),
  skill("skill_guard_unyielding", "char_iron_guard", "passive", 1, "self", false, zero, zero, zero, ["passive"], [{ tagId: "shield", count: 1 }, { tagId: "taunt", count: 1 }], staticEffects([]), [{ kind: "percentStat", stat: "maxHp", valueBps: 1200 }]),

  skill("skill_ranger_arrow", "char_ranger", "basic", 1, "singleEnemy", false, zero, zero, basicEnergyGain, ["basic", "bow"], emptyTags, damageLevels([10_000, 10_000, 10_000, 10_000, 10_000], "physical", "singleEnemy")),
  skill("skill_ranger_twin_shot", "char_ranger", "active", 1, "singleEnemy", false, [2, 2, 2, 2, 2], zero, activeEnergyGain, ["bow", "multiHit"], [{ tagId: "chase", count: 1 }, { tagId: "speed", count: 1 }], damageLevels([6000, 6500, 7000, 7500, 8000], "physical", "singleEnemy", [2, 2, 2, 2, 2])),
  skill("skill_ranger_marking_arrow", "char_ranger", "active", 3, "singleEnemy", false, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["bow", "mark"], [{ tagId: "crit", count: 1 }, { tagId: "chase", count: 1 }], levelEffects((index) => [damage("physical", "singleEnemy", [11_000, 12_000, 13_000, 14_000, 15_000][index]), applyStatus("singleEnemy", "status_marked", [7500, 8000, 8500, 9000, 9500][index], 1, 3)])),
  skill("skill_ranger_fleet_step", "char_ranger", "active", 6, "self", false, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["speed", "support"], [{ tagId: "speed", count: 2 }], levelEffects((index) => [applyStatus("self", "status_haste", 10_000, 1, [2, 2, 3, 3, 3][index]), energy("self", [10, 12, 14, 16, 18][index])])),
  skill("skill_ranger_predator_volley", "char_ranger", "active", 10, "randomEnemy", false, [4, 4, 4, 4, 4], zero, activeEnergyGain, ["bow", "multiHit"], [{ tagId: "chase", count: 1 }, { tagId: "crit", count: 1 }], damageLevels([5000, 5500, 6000, 6500, 7000], "physical", "randomEnemy", [3, 3, 3, 3, 3], true, [[], [], [], [], []], true)),
  skill("skill_ranger_arrow_storm", "char_ranger", "ultimate", 1, "allEnemies", false, zero, ultimateCost, zero, ["bow", "multiHit", "ultimate"], [{ tagId: "chase", count: 2 }, { tagId: "speed", count: 1 }], damageLevels([5000, 5000, 5000, 5000, 5000], "physical", "allEnemies", [4, 4, 4, 4, 4])),
  skill("skill_ranger_eagle_eye", "char_ranger", "passive", 1, "self", false, zero, zero, zero, ["passive"], [{ tagId: "crit", count: 1 }, { tagId: "speed", count: 1 }], staticEffects([]), [{ kind: "flatStat", stat: "critRateBps", value: 800 }]),

  skill("skill_ember_bolt", "char_ember_mage", "basic", 1, "singleEnemy", false, zero, zero, basicEnergyGain, ["basic", "fire"], emptyTags, damageLevels([10_000, 10_000, 10_000, 10_000, 10_000], "fire", "singleEnemy")),
  skill("skill_ember_fireball", "char_ember_mage", "active", 1, "singleEnemy", false, [2, 2, 2, 2, 2], zero, activeEnergyGain, ["fire", "projectile"], [{ tagId: "burn", count: 1 }, { tagId: "fire", count: 1 }], levelEffects((index) => [damage("fire", "singleEnemy", [12_000, 13_000, 14_000, 15_000, 16_000][index]), applyStatus("singleEnemy", "status_burn", [7500, 8000, 8500, 9000, 9500][index], 1, 3)])),
  skill("skill_ember_flame_wave", "char_ember_mage", "active", 3, "allEnemies", false, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["fire", "area"], [{ tagId: "burn", count: 1 }, { tagId: "fire", count: 1 }, { tagId: "area", count: 1 }], levelEffects((index) => [damage("fire", "allEnemies", [7000, 7500, 8000, 8500, 9000][index]), applyStatus("allEnemies", "status_burn", [5000, 5500, 6000, 6500, 7000][index], 1, 3)])),
  skill("skill_ember_detonate", "char_ember_mage", "active", 6, "singleEnemy", false, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["fire", "detonate"], [{ tagId: "detonate", count: 2 }, { tagId: "burn", count: 1 }], levelEffects((index) => [damage("fire", "singleEnemy", [10_000, 10_500, 11_000, 11_500, 12_000][index], 1, true, [{ condition: { kind: "targetStatusStacksAtLeast", statusId: "status_burn", stacks: 3 }, multiplierBps: [14_000, 14_500, 15_000, 15_500, 16_000][index] }]), consumeStatus("singleEnemy", "status_burn", 5)])),
  skill("skill_ember_ward", "char_ember_mage", "active", 10, "self", false, [4, 4, 4, 4, 4], zero, activeEnergyGain, ["fire", "shield"], [{ tagId: "shield", count: 1 }, { tagId: "burn", count: 1 }], levelEffects((index) => [shield("self", [10_000, 11_000, 12_000, 13_000, 14_000][index], "attack"), applyStatus("self", "status_attack_up", 10_000, 1, 2)])),
  skill("skill_ember_inferno", "char_ember_mage", "ultimate", 1, "allEnemies", false, zero, ultimateCost, zero, ["fire", "area", "ultimate"], [{ tagId: "burn", count: 2 }, { tagId: "detonate", count: 1 }], staticEffects([damage("fire", "allEnemies", 12_000, 1, true), applyStatus("allEnemies", "status_burn", 10_000, 2, 3)])),
  skill("skill_ember_kindling", "char_ember_mage", "passive", 1, "self", false, zero, zero, zero, ["passive"], [{ tagId: "burn", count: 1 }, { tagId: "fire", count: 1 }], staticEffects([]), [{ kind: "damageBonus", element: "fire", valueBps: 1000 }]),

  skill("skill_frost_shard", "char_frost_seer", "basic", 1, "singleEnemy", false, zero, zero, basicEnergyGain, ["basic", "frost"], emptyTags, staticEffects([damage("frost", "singleEnemy", 10_000, 1, true), applyStatus("singleEnemy", "status_slow", 4000, 1, 2)])),
  skill("skill_frost_chill_lance", "char_frost_seer", "active", 1, "singleEnemy", false, [2, 2, 2, 2, 2], zero, activeEnergyGain, ["frost", "projectile"], [{ tagId: "frost", count: 1 }, { tagId: "control", count: 1 }], levelEffects((index) => [damage("frost", "singleEnemy", [11_500, 12_500, 13_500, 14_500, 15_500][index]), applyStatus("singleEnemy", "status_slow", [7500, 8000, 8500, 9000, 9500][index], 1, 2)])),
  skill("skill_frost_ice_nova", "char_frost_seer", "active", 3, "allEnemies", false, [4, 4, 4, 4, 4], zero, activeEnergyGain, ["frost", "area", "control"], [{ tagId: "frost", count: 1 }, { tagId: "control", count: 2 }], levelEffects((index) => [damage("frost", "allEnemies", [7000, 7500, 8000, 8500, 9000][index]), applyStatus("allEnemies", "status_freeze", [2500, 3000, 3500, 4000, 4500][index], 1, 1)])),
  skill("skill_frost_crystal_aegis", "char_frost_seer", "active", 6, "singleAlly", false, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["frost", "shield"], [{ tagId: "shield", count: 2 }, { tagId: "frost", count: 1 }], levelEffects((index) => [shield("singleAlly", [1200, 1400, 1600, 1800, 2000][index], "maxHp"), applyStatus("singleAlly", "status_defense_up", 10_000, 1, 2)])),
  skill("skill_frost_winter_link", "char_frost_seer", "active", 10, "allEnemies", false, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["frost", "control"], [{ tagId: "frost", count: 1 }, { tagId: "chain", count: 1 }], levelEffects((index) => [damage("frost", "allEnemies", [5500, 6000, 6500, 7000, 7500][index]), applyStatus("allEnemies", "status_slow", [7000, 7500, 8000, 8500, 9000][index], 1, 2)])),
  skill("skill_frost_absolute_zero", "char_frost_seer", "ultimate", 1, "allEnemies", false, zero, ultimateCost, zero, ["frost", "control", "ultimate"], [{ tagId: "frost", count: 2 }, { tagId: "control", count: 2 }], staticEffects([damage("frost", "allEnemies", 10_000, 1, true), applyStatus("allEnemies", "status_freeze", 5000, 1, 1), applyStatus("allEnemies", "status_slow", 10_000, 1, 2)])),
  skill("skill_frost_clarity", "char_frost_seer", "passive", 1, "self", false, zero, zero, zero, ["passive"], [{ tagId: "frost", count: 1 }, { tagId: "control", count: 1 }], staticEffects([]), [{ kind: "flatStat", stat: "effectHitBps", value: 1000 }]),

  skill("skill_priest_smite", "char_priest", "basic", 1, "singleEnemy", false, zero, zero, basicEnergyGain, ["basic", "holy"], emptyTags, damageLevels([9500, 9500, 9500, 9500, 9500], "holy", "singleEnemy")),
  skill("skill_priest_mend", "char_priest", "active", 1, "singleAlly", false, [2, 2, 2, 2, 2], zero, activeEnergyGain, ["heal", "holy"], [{ tagId: "heal", count: 2 }], levelEffects((index) => [heal("singleAlly", [14_000, 15_500, 17_000, 18_500, 20_000][index])])),
  skill("skill_priest_sanctuary", "char_priest", "active", 3, "allAllies", false, [4, 4, 4, 4, 4], zero, activeEnergyGain, ["heal", "area", "holy"], [{ tagId: "heal", count: 2 }, { tagId: "support", count: 1 }], levelEffects((index) => [heal("allAllies", [7000, 8000, 9000, 10_000, 11_000][index])])),
  skill("skill_priest_purifying_light", "char_priest", "active", 6, "singleAlly", false, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["heal", "cleanse", "holy"], [{ tagId: "heal", count: 1 }, { tagId: "cleanse", count: 2 }], levelEffects((index) => [heal("singleAlly", [8000, 9000, 10_000, 11_000, 12_000][index]), dispel("singleAlly", "debuff", [1, 1, 1, 2, 2][index])])),
  skill("skill_priest_aegis", "char_priest", "active", 10, "singleAlly", false, [3, 3, 3, 3, 3], zero, activeEnergyGain, ["shield", "holy"], [{ tagId: "shield", count: 2 }, { tagId: "heal", count: 1 }], levelEffects((index) => [shield("singleAlly", [14_000, 15_500, 17_000, 18_500, 20_000][index], "attack"), applyStatus("singleAlly", "status_guard_30", 10_000, 1, 1)])),
  skill("skill_priest_returning_light", "char_priest", "ultimate", 1, "deadAlly", false, zero, ultimateCost, zero, ["heal", "revive", "ultimate"], [{ tagId: "heal", count: 2 }, { tagId: "holy", count: 2 }], staticEffects([revive(4000)])),
  skill("skill_priest_benediction", "char_priest", "passive", 1, "self", false, zero, zero, zero, ["passive"], [{ tagId: "heal", count: 1 }, { tagId: "holy", count: 1 }], staticEffects([]), [{ kind: "healingBonus", valueBps: 1200 }]),
];

function systemSkill(
  id: string,
  kind: SkillKind,
  targetRule: TargetRule,
  requiresFrontAccess: boolean,
  cooldown: number,
  effects: readonly EffectSpec[],
): SkillDefinition {
  return skill(id, null, kind, 1, targetRule, requiresFrontAccess, [cooldown, cooldown, cooldown, cooldown, cooldown], zero, zero, [], emptyTags, staticEffects(effects));
}

function enemyOwnedSkill(
  id: string,
  enemyId: string,
  targetRule: TargetRule,
  requiresFrontAccess: boolean,
  cooldown: number,
  effects: readonly EffectSpec[],
): SkillDefinition {
  return { ...systemSkill(id, "active", targetRule, requiresFrontAccess, cooldown, effects), owner: { kind: "enemy", enemyId } };
}

const verticalSliceExtraSkillDefinitions: SkillDefinition[] = [
  // 技能词条产生的派生动作必须是真实 effect 技能，不能在运行时凭名称猜表现。
  systemSkill("effect_ember_echo_burst", "effect", "allEnemies", false, 0, [damage("fire", "allEnemies", 4500, 1, false)]),
  systemSkill("effect_guard_ripple", "effect", "allEnemies", false, 0, [damage("physical", "allEnemies", 4000, 1, false)]),
  systemSkill("effect_bleed_doublecut", "effect", "singleEnemy", false, 0, [damage("physical", "singleEnemy", 4500)]),
  systemSkill("effect_holy_afterglow", "effect", "allAllies", false, 0, [heal("allAllies", 4000)]),
  systemSkill("effect_shadow_echo", "effect", "singleEnemy", false, 0, [damage("dark", "singleEnemy", 6000)]),
  systemSkill("effect_sweeping_basic", "effect", "allEnemies", false, 0, [damage("physical", "allEnemies", 7000)]),

  // 第一层敌方模板按 SKILL-1.2 逐条展开；模板共用时保持 systemEffect owner。
  systemSkill("skill_enemy_basic_physical", "basic", "singleEnemy", true, 0, [damage("physical", "singleEnemy", 10000)]),
  systemSkill("skill_enemy_basic_ranged", "basic", "singleEnemy", false, 0, [damage("physical", "singleEnemy", 9500)]),
  systemSkill("skill_enemy_defend", "active", "self", false, 3, [applyStatus("self", "status_guard_30", 10000, 1, 1)]),
  systemSkill("skill_enemy_double_hit", "active", "singleEnemy", true, 2, [damage("physical", "singleEnemy", 6000, 2)]),
  systemSkill("skill_enemy_bleed_hit", "active", "singleEnemy", true, 2, [damage("physical", "singleEnemy", 9000), applyStatus("singleEnemy", "status_bleed", 7000, 1, 3)]),
  systemSkill("skill_enemy_slow_hit", "active", "singleEnemy", false, 2, [damage("physical", "singleEnemy", 8500), applyStatus("singleEnemy", "status_slow", 7500, 1, 2)]),
  systemSkill("skill_enemy_charge", "active", "singleEnemy", true, 3, [damage("physical", "singleEnemy", 15000), applyStatus("singleEnemy", "status_stun", 4000, 1, 1)]),
  systemSkill("skill_enemy_poison_hit", "active", "singleEnemy", false, 2, [damage("poison", "singleEnemy", 8500), applyStatus("singleEnemy", "status_poison", 8000, 1, 3)]),
  systemSkill("skill_enemy_poison_double", "active", "singleEnemy", false, 3, [damage("poison", "singleEnemy", 5000, 2), applyStatus("singleEnemy", "status_poison", 5000, 1, 3)]),
  systemSkill("skill_enemy_guard_all", "active", "allAllies", false, 4, [shield("allAllies", 800, "maxHp"), applyStatus("allAllies", "status_defense_up", 10000, 1, 2)]),
  systemSkill("skill_enemy_haste", "active", "self", false, 3, [applyStatus("self", "status_haste", 10000, 1, 2)]),
  systemSkill("skill_enemy_stun_hit", "active", "singleEnemy", true, 3, [damage("physical", "singleEnemy", 11000), applyStatus("singleEnemy", "status_stun", 5500, 1, 1)]),
  systemSkill("skill_enemy_all_physical", "active", "allEnemies", false, 3, [damage("physical", "allEnemies", 6500)]),
  systemSkill("skill_enemy_self_heal", "active", "self", false, 3, [heal("self", 10000)]),
  systemSkill("skill_enemy_fear_all", "active", "allEnemies", false, 4, [applyStatus("allEnemies", "status_fear", 7000, 1, 2)]),
  systemSkill("skill_enemy_burn_hit", "active", "singleEnemy", true, 2, [damage("fire", "singleEnemy", 9500), applyStatus("singleEnemy", "status_burn", 8000, 1, 3)]),
  systemSkill("skill_enemy_burn_all", "active", "allEnemies", false, 3, [damage("fire", "allEnemies", 6000), applyStatus("allEnemies", "status_burn", 6000, 1, 3)]),
  systemSkill("skill_enemy_execute", "active", "singleEnemy", true, 3, [damage("dark", "singleEnemy", 13000, 1, true, [{ condition: { kind: "targetHpAtMostBps", valueBps: 3000 }, multiplierBps: 13846 }])]),
  systemSkill("skill_enemy_fear_hit", "active", "singleEnemy", false, 2, [damage("dark", "singleEnemy", 9000), applyStatus("singleEnemy", "status_fear", 8000, 1, 2)]),
  systemSkill("skill_enemy_bleed_double", "active", "singleEnemy", true, 3, [damage("physical", "singleEnemy", 5500, 2), applyStatus("singleEnemy", "status_bleed", 8000, 1, 3)]),
  systemSkill("skill_enemy_ally_heal", "active", "singleAlly", false, 3, [heal("singleAlly", 9000)]),
  systemSkill("skill_enemy_frost_guard", "active", "allAllies", false, 4, [shield("allAllies", 1000, "maxHp"), applyStatus("allAllies", "status_defense_up", 10000, 1, 2)]),
  systemSkill("skill_enemy_freeze_hit", "active", "singleEnemy", false, 3, [damage("frost", "singleEnemy", 9000), applyStatus("singleEnemy", "status_freeze", 3500, 1, 1)]),
  systemSkill("skill_enemy_shock_double", "active", "randomEnemy", false, 3, [damage("lightning", "randomEnemy", 5500, 2), applyStatus("randomEnemy", "status_shock", 6500, 1, 2)]),
  systemSkill("skill_enemy_slow_all", "active", "allEnemies", false, 4, [applyStatus("allEnemies", "status_slow", 7500, 1, 2)]),
  systemSkill("skill_enemy_counter_guard", "active", "self", false, 3, [shield("self", 1200, "maxHp"), applyStatus("self", "status_guard_30", 10000, 1, 1)]),
  systemSkill("skill_boss_enrage", "active", "self", false, 0, [applyStatus("self", "status_boss_enrage", 10000, 1, 999)]),
  enemyOwnedSkill("skill_boss_horned_charge", "boss_horned_king", "singleEnemy", true, 3, [damage("physical", "singleEnemy", 14500), applyStatus("singleEnemy", "status_stun", 4500, 1, 1)]),
  enemyOwnedSkill("skill_boss_horned_call", "boss_horned_king", "self", false, 0, [
    applyStatus("self", "status_boss_phase_2", 10000, 1, 999),
    { kind: "summon", enemyId: "enemy_fang_wolf", preferredSlots: [4, 5], maxAliveCopies: 2 },
  ]),

  // RPG-024 四位层主只组合已有状态/召唤/狂暴机制，不在领域层增加 Boss 特判。
  enemyOwnedSkill("skill_boss_brood_venom_web", "boss_brood_spider", "allEnemies", false, 3, [
    damage("poison", "allEnemies", 6500, 1, false),
    applyStatus("allEnemies", "status_poison", 8500, 1, 3),
  ]),
  enemyOwnedSkill("skill_boss_brood_hatch", "boss_brood_spider", "self", false, 4, [
    { kind: "summon", enemyId: "enemy_venom_spider", preferredSlots: [4, 5], maxAliveCopies: 2 },
  ]),
  enemyOwnedSkill("skill_boss_iron_quake", "boss_iron_devourer", "allEnemies", false, 3, [
    damage("physical", "allEnemies", 8500, 1, false),
    applyStatus("allEnemies", "status_stun", 4500, 1, 1),
  ]),
  enemyOwnedSkill("skill_boss_iron_overdrive", "boss_iron_devourer", "self", false, 4, [
    applyStatus("self", "status_boss_phase_2", 10000, 1, 999),
    applyStatus("self", "status_attack_up", 10000, 1, 2),
  ]),
  enemyOwnedSkill("skill_boss_witch_miasma", "boss_bog_witch", "allEnemies", false, 3, [
    damage("poison", "allEnemies", 7000, 1, false),
    applyStatus("allEnemies", "status_poison", 8000, 1, 3),
    applyStatus("allEnemies", "status_fear", 5000, 1, 2),
  ]),
  enemyOwnedSkill("skill_boss_witch_rebirth", "boss_bog_witch", "self", false, 5, [
    heal("self", 18000, "maxHp"),
    applyStatus("self", "status_boss_phase_2", 10000, 1, 999),
  ]),
  enemyOwnedSkill("skill_boss_ember_sweep", "boss_ember_guardian", "allEnemies", false, 3, [
    damage("fire", "allEnemies", 7500, 1, false),
    applyStatus("allEnemies", "status_burn", 8000, 1, 3),
  ]),
  enemyOwnedSkill("skill_boss_ember_eruption", "boss_ember_guardian", "allEnemies", false, 4, [
    damage("fire", "allEnemies", 11000, 1, false, [{ condition: { kind: "sourceHasStatus", statusId: "status_boss_phase_2" }, multiplierBps: 13000 }]),
    applyStatus("allEnemies", "status_burn", 10000, 2, 3),
  ]),
  // RPG-025 深渊层主技能只组合现有伤害、状态、护盾和召唤效果。
  enemyOwnedSkill("skill_boss_butcher_cleaver", "boss_abyss_butcher", "singleEnemy", true, 3, [
    damage("dark", "singleEnemy", 15000, 1, true, [{ condition: { kind: "targetHpAtMostBps", valueBps: 3000 }, multiplierBps: 14000 }]),
  ]),
  enemyOwnedSkill("skill_boss_butcher_frenzy", "boss_abyss_butcher", "self", false, 0, [
    applyStatus("self", "status_boss_phase_2", 10000, 1, 999),
    applyStatus("self", "status_haste", 10000, 1, 999),
    applyStatus("allEnemies", "status_fear", 10000, 1, 2),
  ]),
  enemyOwnedSkill("skill_boss_crimson_flurry", "boss_crimson_knight", "singleEnemy", true, 3, [
    damage("physical", "singleEnemy", 5000, 3, true, [], true),
    applyStatus("singleEnemy", "status_bleed", 8000, 1, 3),
  ]),
  enemyOwnedSkill("skill_boss_crimson_bloodmoon", "boss_crimson_knight", "self", false, 0, [
    applyStatus("self", "status_boss_phase_2", 10000, 1, 999),
    heal("self", 1500, "maxHp"),
    applyStatus("self", "status_attack_up", 10000, 1, 999),
  ]),
  enemyOwnedSkill("skill_boss_jailer_prison", "boss_pale_jailer", "allEnemies", false, 3, [
    damage("frost", "allEnemies", 6500, 1, true),
    applyStatus("allEnemies", "status_freeze", 4000, 1, 1),
  ]),
  enemyOwnedSkill("skill_boss_jailer_whitewall", "boss_pale_jailer", "self", false, 0, [
    applyStatus("self", "status_boss_phase_2", 10000, 1, 999),
    shield("self", 2200, "maxHp"),
    applyStatus("self", "status_defense_up", 10000, 1, 999),
  ]),
  enemyOwnedSkill("skill_boss_eye_chain", "boss_thousand_eye", "randomEnemy", false, 2, [
    damage("lightning", "randomEnemy", 5000, 3, true, [], true),
    applyStatus("randomEnemy", "status_shock", 7500, 1, 2),
  ]),
  enemyOwnedSkill("skill_boss_eye_rewrite", "boss_thousand_eye", "allEnemies", false, 0, [
    applyStatus("self", "status_boss_phase_2", 10000, 1, 999),
    applyStatus("allEnemies", "status_slow", 10000, 1, 3),
    damage("lightning", "allEnemies", 7000, 1, true),
  ]),
  enemyOwnedSkill("skill_boss_king_dark_wave", "boss_abyss_king", "allEnemies", false, 3, [
    damage("dark", "allEnemies", 8000, 1, true),
    applyStatus("allEnemies", "status_fear", 6500, 1, 2),
  ]),
  enemyOwnedSkill("skill_boss_king_phase_two", "boss_abyss_king", "self", false, 0, [
    applyStatus("self", "status_boss_phase_2", 10000, 1, 999),
    { kind: "summon", enemyId: "enemy_throne_knight", preferredSlots: [4, 5], maxAliveCopies: 1 },
    shield("self", 1500, "maxHp"),
  ]),
  enemyOwnedSkill("skill_boss_king_phase_three", "boss_abyss_king", "allEnemies", false, 0, [
    applyStatus("self", "status_boss_phase_3", 10000, 1, 999),
    damage("dark", "allEnemies", 10000, 1, true),
    applyStatus("allEnemies", "status_burn", 8000, 1, 3),
    applyStatus("allEnemies", "status_shock", 8000, 1, 2),
  ]),
  enemyOwnedSkill("skill_boss_king_annihilation", "boss_abyss_king", "allEnemies", false, 4, [
    damage("dark", "allEnemies", 12000, 1, true),
  ]),
];

export const VERTICAL_SLICE_EXTRA_SKILLS: readonly SkillDefinition[] = Object.freeze(verticalSliceExtraSkillDefinitions);

/** SKILL-1.2 角色 42 条基础/主动/终极/被动技能。 */
export const SKILL_DEFINITIONS: readonly SkillDefinition[] = Object.freeze(skillDefinitions);
export const skillDefinitionsReadonly = SKILL_DEFINITIONS;
export const skills = SKILL_DEFINITIONS;
