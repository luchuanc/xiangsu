import type {
  SkillAffixDefinition,
  SkillAffixOperation,
  SkillAffixTarget,
  SkillStoneQuality,
  TagContribution,
} from "../contracts";

const NORMAL_QUALITIES: readonly SkillStoneQuality[] = ["magic", "rare", "epic", "abyss"];

function tags(...values: readonly [TagContribution["tagId"], number][]): TagContribution[] {
  return values.map(([tagId, count]) => ({ tagId, count }));
}

function normal(
  id: string,
  kind: SkillAffixDefinition["kind"],
  target: SkillAffixTarget,
  minItemLevel: number,
  exclusiveGroup: string | null,
  stackRule: SkillAffixDefinition["stackRule"],
  weight: number,
  goldValue: number,
  rollMin: number,
  rollMax: number,
  operation: SkillAffixOperation,
  tagValues: readonly [TagContribution["tagId"], number][],
): SkillAffixDefinition {
  return {
    id,
    nameKey: `skill_affix.${id}.name`,
    descriptionKey: `skill_affix.${id}.description`,
    kind,
    pool: "normal",
    target,
    minItemLevel,
    allowedQualities: [...NORMAL_QUALITIES],
    exclusiveGroup,
    stackRule,
    weight,
    goldValue,
    rollMin,
    rollMax,
    operation,
    tags: tags(...tagValues),
  };
}

function abyss(
  id: string,
  kind: SkillAffixDefinition["kind"],
  target: SkillAffixTarget,
  exclusiveGroup: string | null,
  stackRule: SkillAffixDefinition["stackRule"],
  weight: number,
  goldValue: number,
  rollMin: number,
  rollMax: number,
  operation: SkillAffixOperation,
  tagValues: readonly [TagContribution["tagId"], number][],
): SkillAffixDefinition {
  return {
    id,
    nameKey: `skill_affix.${id}.name`,
    descriptionKey: `skill_affix.${id}.description`,
    kind,
    pool: "abyss",
    target,
    minItemLevel: 26,
    allowedQualities: ["abyss"],
    exclusiveGroup,
    stackRule,
    weight,
    goldValue,
    rollMin,
    rollMax,
    operation,
    tags: tags(...tagValues),
  };
}

const skillAffixDefinitions: SkillAffixDefinition[] = [
  normal("sa_ember_focus", "amplify", { kind: "skill", skillId: "skill_ember_fireball" }, 1, null, "add", 100, 35, 600, 1400, { kind: "addPowerBps" }, [["burn", 1], ["fire", 1]]),
  normal("sa_ember_echo", "followUp", { kind: "skill", skillId: "skill_ember_fireball" }, 1, "fireball_follow", "unique", 50, 55, 4500, 6500, { kind: "addFollowUp", effectSkillId: "effect_ember_echo_burst", chanceScaleBps: 10_000 }, [["burn", 1], ["detonate", 2]]),
  normal("sa_guard_ripple", "followUp", { kind: "family", familyId: "shield" }, 1, "shield_follow", "unique", 65, 45, 3500, 5500, { kind: "addFollowUp", effectSkillId: "effect_guard_ripple", chanceScaleBps: 10_000 }, [["shield", 1], ["counter", 2]]),
  normal("sa_bleed_doublecut", "repeat", { kind: "skill", skillId: "skill_wanderer_rending_slash" }, 1, "rending_repeat", "max", 75, 42, 2500, 4500, { kind: "addRepeatChanceBps", extraHits: 1 }, [["bleed", 2], ["chase", 1]]),
  normal("sa_heal_overflow", "statusLink", { kind: "family", familyId: "heal" }, 1, "overheal_convert", "max", 70, 45, 3000, 5000, { kind: "overhealToShield", conversionScaleBps: 10_000, maxTargetHpBps: 2000, durationOwnerTurns: 2 }, [["heal", 2], ["shield", 2]]),
  normal("sa_frost_spread", "morph", { kind: "skill", skillId: "skill_frost_chill_lance" }, 21, "chill_shape", "replace", 25, 80, 1, 1, { kind: "replaceTargetRule", targetRule: "allEnemies" }, [["frost", 2], ["control", 2], ["area", 1]]),
  normal("sa_swift_charge", "resource", { kind: "family", familyId: "multiHit" }, 1, null, "add", 80, 38, 5, 10, { kind: "changeEnergy", amountScaleBps: 10_000 }, [["speed", 2], ["chase", 1]]),
  normal("sa_storm_chain", "morph", { kind: "skill", skillId: "skill_ranger_twin_shot" }, 11, "twin_element", "replace", 35, 70, 1, 1, { kind: "replaceDamageElement", element: "lightning" }, [["shock", 2], ["chain", 2]]),
  normal("sa_execution_focus", "amplify", { kind: "skill", skillId: "skill_wanderer_execution" }, 1, null, "add", 90, 38, 800, 1600, { kind: "addPowerBps" }, [["execute", 2]]),
  normal("sa_fortress_focus", "amplify", { kind: "skill", skillId: "skill_guard_fortify" }, 1, null, "add", 90, 38, 800, 1600, { kind: "addPowerBps" }, [["shield", 2], ["guard", 1]]),
  normal("sa_guard_shared_wall", "morph", { kind: "skill", skillId: "skill_guard_fortify" }, 21, "fortify_shape", "replace", 25, 80, 1, 1, { kind: "replaceTargetRule", targetRule: "allAllies" }, [["shield", 2], ["support", 2]]),
  normal("sa_ranger_twin_echo", "repeat", { kind: "skill", skillId: "skill_ranger_twin_shot" }, 1, "twin_repeat", "max", 75, 42, 2000, 4000, { kind: "addRepeatChanceBps", extraHits: 1 }, [["chase", 2], ["speed", 1]]),
  normal("sa_ranger_marked_chase", "statusLink", { kind: "skill", skillId: "skill_ranger_marking_arrow" }, 1, "mark_follow", "unique", 65, 48, 4000, 6000, { kind: "statusLink", requiredStatusId: "status_marked", effectSkillId: "effect_bleed_doublecut", chanceScaleBps: 10_000 }, [["mark", 2], ["chase", 2]]),
  normal("sa_ember_detonate_cycle", "resource", { kind: "skill", skillId: "skill_ember_detonate" }, 1, "detonate_cooldown", "unique", 55, 50, 1, 1, { kind: "changeCooldown", turns: -1 }, [["burn", 1], ["detonate", 2]]),
  normal("sa_ember_detonate_focus", "amplify", { kind: "skill", skillId: "skill_ember_detonate" }, 1, null, "add", 85, 42, 800, 1600, { kind: "addPowerBps" }, [["burn", 2], ["detonate", 1]]),
  normal("sa_frost_nova_focus", "amplify", { kind: "skill", skillId: "skill_frost_ice_nova" }, 1, null, "add", 85, 42, 700, 1500, { kind: "addPowerBps" }, [["frost", 2], ["control", 1]]),
  normal("sa_frost_zero_echo", "repeat", { kind: "skill", skillId: "skill_frost_absolute_zero" }, 1, "zero_repeat", "max", 55, 55, 1500, 3000, { kind: "addRepeatChanceBps", extraHits: 1 }, [["frost", 2], ["control", 1]]),
  normal("sa_priest_mend_focus", "amplify", { kind: "skill", skillId: "skill_priest_mend" }, 1, null, "add", 90, 38, 800, 1600, { kind: "addPowerBps" }, [["heal", 2]]),
  normal("sa_priest_sanctuary_echo", "followUp", { kind: "skill", skillId: "skill_priest_sanctuary" }, 1, "sanctuary_follow", "unique", 65, 48, 4000, 6000, { kind: "addFollowUp", effectSkillId: "effect_holy_afterglow", chanceScaleBps: 10_000 }, [["heal", 2], ["holy", 1]]),
  normal("sa_universal_focus", "amplify", { kind: "allSkills" }, 1, null, "add", 60, 50, 400, 900, { kind: "addPowerBps" }, [["focus", 1]]),
  abyss("sa_abyss_unbound_power", "amplify", { kind: "allSkills" }, null, "add", 35, 180, 1200, 2200, { kind: "addPowerBps" }, [["might", 1], ["dark", 1]]),
  abyss("sa_abyss_endless_energy", "resource", { kind: "allSkills" }, null, "add", 30, 200, 8, 15, { kind: "changeEnergy", amountScaleBps: 10_000 }, [["speed", 1], ["ultimate", 1]]),
  abyss("sa_abyss_shadow_echo", "followUp", { kind: "allSkills" }, "allskill_follow", "unique", 22, 240, 2500, 4500, { kind: "addFollowUp", effectSkillId: "effect_shadow_echo", chanceScaleBps: 10_000 }, [["dark", 2], ["chase", 2]]),
  abyss("sa_abyss_cascade", "repeat", { kind: "allSkills" }, "allskill_repeat", "max", 18, 280, 1500, 3000, { kind: "addRepeatChanceBps", extraHits: 1 }, [["chain", 2], ["chase", 1]]),
];

/** STONE-1.2 正式 20+4 条技能词条，数组顺序即冻结池顺序。 */
export const SKILL_AFFIX_DEFINITIONS: readonly SkillAffixDefinition[] = Object.freeze(skillAffixDefinitions);
export const skillAffixDefinitionsReadonly = SKILL_AFFIX_DEFINITIONS;
export const skillAffixes = SKILL_AFFIX_DEFINITIONS;

