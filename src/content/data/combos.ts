/**
 * RPG-012 垂直切片 Combo 配方。
 *
 * COMBO-1.2 的累计内容配方；运行时不得从 Combo 自身反向生成标签。
 */
import type {
  ComboDefinition,
  ComboRequirement,
  EffectSpec,
  TriggerSpec,
} from "../contracts";

function requirements(
  values: readonly [ComboRequirement["source"], ComboRequirement["tagId"], number][],
): ComboRequirement[] {
  return values.map(([source, tagId, count]) => ({ source, tagId, count }));
}

function trigger(
  event: TriggerSpec["event"],
  options: Partial<Pick<TriggerSpec, "requiredSkillKinds" | "requiredHitResult" | "requiredSourceHpAtMostBps" | "requiredTargetHpAtMostBps" | "requiredSourceStatusIds" | "requiredTargetStatusIds" | "consumeTargetStatus">> = {},
): TriggerSpec {
  return {
    event,
    requiredSkillKinds: options.requiredSkillKinds ?? [],
    requiredHitResult: options.requiredHitResult ?? "any",
    requiredSourceHpAtMostBps: options.requiredSourceHpAtMostBps ?? null,
    requiredTargetHpAtMostBps: options.requiredTargetHpAtMostBps ?? null,
    requiredSourceStatusIds: options.requiredSourceStatusIds ?? [],
    requiredTargetStatusIds: options.requiredTargetStatusIds ?? [],
    consumeTargetStatus: options.consumeTargetStatus ?? null,
  };
}

function damage(
  targetRule: "singleEnemy" | "allEnemies",
  element: "physical" | "fire" | "poison" | "lightning" | "dark",
  powerBps: number,
  canCrit: boolean,
): EffectSpec {
  return {
    kind: "damage",
    targetRule,
    element,
    powerBps,
    flatPower: 0,
    canCrit,
    ignoreDefenseBps: 0,
    flatIgnoreDefense: 0,
    hitCount: 1,
    retargetEachHit: false,
    conditionalMultipliers: [],
  };
}

function status(targetRule: "self" | "allAllies" | "allEnemies" | "singleEnemy", statusId: string, baseChanceBps: number, stacks: number, durationOwnerTurns: number): EffectSpec {
  return { kind: "applyStatus", targetRule, statusId, baseChanceBps, stacks, durationOwnerTurns };
}

function shield(scalingStat: "attack" | "maxHp" = "attack", powerBps = 3000): EffectSpec {
  return {
    kind: "shield",
    targetRule: "allAllies",
    scalingStat,
    powerBps,
    flatPower: 0,
    statusId: "status_shield",
    durationOwnerTurns: 2,
  };
}

function heal(targetRule: "self" | "allAllies", scalingStat: "attack" | "maxHp", powerBps: number): EffectSpec {
  return { kind: "heal", targetRule, scalingStat, powerBps, flatPower: 0, canCrit: false };
}

function dispel(targetRule: "allAllies", polarity: "buff" | "debuff", count: number): EffectSpec {
  return { kind: "dispel", targetRule, polarity, count };
}

const budget = { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 999 } as const;

const definitions: ComboDefinition[] = [
  {
    id: "combo_ember_chain",
    nameKey: "combo.combo_ember_chain.name",
    descriptionKey: "combo.combo_ember_chain.description",
    scope: "personal",
    requirements: requirements([
      ["equipmentAffix", "burn", 1],
      ["equippedSkill", "burn", 1],
      ["skillAffix", "detonate", 1],
    ]),
    trigger: trigger("afterDirectHit", {
      requiredTargetStatusIds: ["status_burn"],
      consumeTargetStatus: { statusId: "status_burn", stacks: 3 },
    }),
    effects: [damage("allEnemies", "fire", 6000, false)],
    budget,
    iconId: "icon_combo_ember_chain",
  },
  {
    id: "combo_iron_reprise",
    nameKey: "combo.combo_iron_reprise.name",
    descriptionKey: "combo.combo_iron_reprise.description",
    scope: "personal",
    requirements: requirements([
      ["equipmentAffix", "counter", 1],
      ["equippedSkill", "shield", 2],
      ["skillAffix", "counter", 1],
    ]),
    trigger: trigger("onDirectDamageTaken", { requiredSourceStatusIds: ["status_shield"] }),
    effects: [damage("singleEnemy", "physical", 6000, true)],
    budget,
    iconId: "icon_combo_iron_reprise",
  },
  {
    id: "combo_blood_hunt",
    nameKey: "combo.combo_blood_hunt.name",
    descriptionKey: "combo.combo_blood_hunt.description",
    scope: "personal",
    requirements: requirements([
      ["equipmentAffix", "bleed", 1],
      ["equippedSkill", "bleed", 1],
      ["skillAffix", "chase", 1],
    ]),
    trigger: trigger("afterDirectHit", { requiredTargetStatusIds: ["status_bleed"] }),
    effects: [damage("singleEnemy", "physical", 4000, true)],
    budget,
    iconId: "icon_combo_blood_hunt",
  },
  {
    id: "combo_holy_bulwark",
    nameKey: "combo.combo_holy_bulwark.name",
    descriptionKey: "combo.combo_holy_bulwark.description",
    scope: "party",
    requirements: requirements([
      ["equipmentAffix", "shield", 1],
      ["equippedSkill", "heal", 2],
      ["skillAffix", "heal", 1],
    ]),
    trigger: trigger("onOverheal"),
    effects: [shield()],
    budget,
    iconId: "icon_combo_holy_bulwark",
  },
  {
    id: "combo_venom_bloom",
    nameKey: "combo.combo_venom_bloom.name",
    descriptionKey: "combo.combo_venom_bloom.description",
    scope: "personal",
    requirements: requirements([["equipmentAffix", "poison", 2], ["skillAffix", "control", 1], ["equippedSkill", "focus", 1]]),
    trigger: trigger("afterRootAction", { requiredTargetStatusIds: ["status_poison"] }),
    effects: [damage("allEnemies", "poison", 4500, false), status("allEnemies", "status_poison", 10_000, 1, 3)],
    budget,
    iconId: "icon_combo_venom_bloom",
  },
  {
    id: "combo_frozen_verdict",
    nameKey: "combo.combo_frozen_verdict.name",
    descriptionKey: "combo.combo_frozen_verdict.description",
    scope: "personal",
    requirements: requirements([["equipmentAffix", "frost", 1], ["skillAffix", "control", 2], ["equippedSkill", "frost", 1]]),
    trigger: trigger("afterDirectHit", { requiredTargetStatusIds: ["status_slow"] }),
    effects: [status("singleEnemy", "status_freeze", 10_000, 1, 1)],
    budget,
    iconId: "icon_combo_frozen_verdict",
  },
  {
    id: "combo_storm_circuit",
    nameKey: "combo.combo_storm_circuit.name",
    descriptionKey: "combo.combo_storm_circuit.description",
    scope: "personal",
    requirements: requirements([["equipmentAffix", "shock", 1], ["equippedSkill", "crit", 1], ["skillAffix", "chain", 1]]),
    trigger: trigger("afterDirectHit", { requiredHitResult: "critical" }),
    effects: [damage("allEnemies", "lightning", 4000, false), status("allEnemies", "status_shock", 10_000, 1, 2)],
    budget,
    iconId: "icon_combo_storm_circuit",
  },
  {
    id: "combo_execution_cadence",
    nameKey: "combo.combo_execution_cadence.name",
    descriptionKey: "combo.combo_execution_cadence.description",
    scope: "personal",
    requirements: requirements([["equipmentAffix", "execute", 1], ["skillAffix", "execute", 1], ["equippedSkill", "execute", 1]]),
    trigger: trigger("onDefeatUnit"),
    effects: [{ kind: "grantExtraTurn", targetRule: "self" }],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 3 },
    iconId: "icon_combo_execution_cadence",
  },
  {
    id: "combo_steadfast_aegis",
    nameKey: "combo.combo_steadfast_aegis.name",
    descriptionKey: "combo.combo_steadfast_aegis.description",
    scope: "party",
    requirements: requirements([["innate", "shield", 1], ["equipmentAffix", "guard", 2], ["skillAffix", "shield", 1]]),
    trigger: trigger("onGainShield"),
    effects: [status("allAllies", "status_defense_up", 10_000, 1, 2)],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 3 },
    iconId: "icon_combo_steadfast_aegis",
  },
  {
    id: "combo_swift_formation",
    nameKey: "combo.combo_swift_formation.name",
    descriptionKey: "combo.combo_swift_formation.description",
    scope: "party",
    requirements: requirements([["innate", "speed", 1], ["equipmentAffix", "speed", 2], ["equippedSkill", "speed", 1]]),
    trigger: trigger("beforeAction", { requiredSkillKinds: ["basic", "active", "ultimate"] }),
    effects: [status("allAllies", "status_haste", 10_000, 1, 2)],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 },
    iconId: "icon_combo_swift_formation",
  },
  {
    id: "combo_perfect_strike",
    nameKey: "combo.combo_perfect_strike.name",
    descriptionKey: "combo.combo_perfect_strike.description",
    scope: "personal",
    requirements: requirements([["equipmentAffix", "crit", 2], ["equippedSkill", "crit", 1], ["skillAffix", "focus", 1]]),
    trigger: trigger("afterDirectHit", { requiredHitResult: "critical" }),
    effects: [damage("singleEnemy", "physical", 5000, true)],
    budget,
    iconId: "icon_combo_perfect_strike",
  },
  {
    id: "combo_dark_covenant",
    nameKey: "combo.combo_dark_covenant.name",
    descriptionKey: "combo.combo_dark_covenant.description",
    scope: "personal",
    requirements: requirements([["equipmentAffix", "dark", 2], ["innate", "bleed", 1], ["skillAffix", "dark", 1]]),
    trigger: trigger("afterDirectHit", { requiredSourceHpAtMostBps: 4000 }),
    effects: [heal("self", "attack", 3000)],
    budget,
    iconId: "icon_combo_dark_covenant",
  },
  {
    id: "combo_cleansing_light",
    nameKey: "combo.combo_cleansing_light.name",
    descriptionKey: "combo.combo_cleansing_light.description",
    scope: "party",
    requirements: requirements([["equippedSkill", "cleanse", 2], ["equipmentAffix", "holy", 1], ["skillAffix", "heal", 1]]),
    trigger: trigger("onHeal"),
    effects: [dispel("allAllies", "debuff", 1)],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 3 },
    iconId: "icon_combo_cleansing_light",
  },
  {
    id: "combo_front_fortress",
    nameKey: "combo.combo_front_fortress.name",
    descriptionKey: "combo.combo_front_fortress.description",
    scope: "party",
    requirements: requirements([["equipmentAffix", "front", 1], ["equipmentAffix", "guard", 1], ["equippedSkill", "shield", 1]]),
    trigger: trigger("onDirectDamageTaken"),
    effects: [shield("maxHp", 500)],
    budget,
    iconId: "icon_combo_front_fortress",
  },
  {
    id: "combo_backline_barrage",
    nameKey: "combo.combo_backline_barrage.name",
    descriptionKey: "combo.combo_backline_barrage.description",
    scope: "party",
    requirements: requirements([["equipmentAffix", "back", 1], ["equippedSkill", "area", 1], ["skillAffix", "focus", 1]]),
    trigger: trigger("afterRootAction", { requiredSkillKinds: ["active", "ultimate"] }),
    effects: [damage("allEnemies", "physical", 3000, false)],
    budget,
    iconId: "icon_combo_backline_barrage",
  },
  {
    id: "combo_triune_elements",
    nameKey: "combo.combo_triune_elements.name",
    descriptionKey: "combo.combo_triune_elements.description",
    scope: "party",
    requirements: requirements([["equipmentAffix", "fire", 1], ["equippedSkill", "frost", 1], ["skillAffix", "shock", 1]]),
    trigger: trigger("beforeAction", { requiredSkillKinds: ["basic", "active", "ultimate"] }),
    effects: [status("allAllies", "status_attack_up", 10_000, 1, 2)],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 },
    iconId: "icon_combo_triune_elements",
  },
  {
    id: "combo_ultimate_resonance",
    nameKey: "combo.combo_ultimate_resonance.name",
    descriptionKey: "combo.combo_ultimate_resonance.description",
    scope: "party",
    requirements: requirements([["skillAffix", "ultimate", 2], ["equippedSkill", "support", 1], ["equipmentAffix", "element", 1]]),
    trigger: trigger("afterRootAction", { requiredSkillKinds: ["ultimate"] }),
    effects: [{ kind: "changeEnergy", targetRule: "allAllies", amount: 10 }],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 3 },
    iconId: "icon_combo_ultimate_resonance",
  },
  {
    id: "combo_abyss_dominion",
    nameKey: "combo.combo_abyss_dominion.name",
    descriptionKey: "combo.combo_abyss_dominion.description",
    scope: "party",
    requirements: requirements([["equipmentAffix", "dark", 2], ["equipmentAffix", "execute", 2], ["skillAffix", "chain", 1]]),
    trigger: trigger("onDefeatUnit"),
    effects: [damage("allEnemies", "dark", 7000, false)],
    budget,
    iconId: "icon_combo_abyss_dominion",
  },
];

/** COMBO-1.2 垂直切片四条 Combo，数组顺序为稳定内容顺序。 */
export const COMBO_DEFINITIONS: readonly ComboDefinition[] = Object.freeze(definitions);
export const comboDefinitionsReadonly = COMBO_DEFINITIONS;
export const combos = COMBO_DEFINITIONS;
