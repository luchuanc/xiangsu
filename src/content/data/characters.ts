import type { CharacterDefinition, StatBlock } from "../contracts";

function stats(
  maxHp: number,
  attack: number,
  defense: number,
  speed: number,
  critRateBps: number,
  effectHitBps: number,
  effectResistBps: number,
): StatBlock {
  return {
    maxHp,
    attack,
    defense,
    speed,
    critRateBps,
    critDamageBps: 15_000,
    effectHitBps,
    effectResistBps,
  };
}

function growthStats(maxHp: number, attack: number, defense: number, speed: number): StatBlock {
  return {
    maxHp,
    attack,
    defense,
    speed,
    critRateBps: 0,
    critDamageBps: 0,
    effectHitBps: 0,
    effectResistBps: 0,
  };
}

function character(
  id: string,
  role: CharacterDefinition["role"],
  allowedWeaponTypes: CharacterDefinition["allowedWeaponTypes"],
  baseStats: StatBlock,
  growthPerLevel: StatBlock,
  innateTags: CharacterDefinition["innateTags"],
  basicSkillId: string,
  activeSkillIds: [string, string, string, string],
  ultimateSkillId: string,
  passiveSkillId: string,
): CharacterDefinition {
  return {
    id,
    nameKey: `character.${id}.name`,
    role,
    allowedWeaponTypes: [...allowedWeaponTypes],
    baseStats,
    growthPerLevel,
    innateTags,
    basicSkillId,
    activeSkillIds,
    ultimateSkillId,
    passiveSkillId,
    fieldSpriteId: `sprite_field_${id}`,
    battleSpriteId: `sprite_battle_${id}`,
  };
}

const characterDefinitions: CharacterDefinition[] = [
  character(
    "char_wanderer",
    "fighter",
    ["sword"],
    stats(420, 58, 32, 52, 500, 200, 300),
    growthStats(38, 5, 3, 0),
    [{ tagId: "bleed", count: 1 }, { tagId: "guard", count: 1 }],
    "skill_wanderer_strike",
    ["skill_wanderer_rending_slash", "skill_wanderer_guarding_blow", "skill_wanderer_execution", "skill_wanderer_blood_rally"],
    "skill_wanderer_endless_edge",
    "skill_wanderer_instinct",
  ),
  character(
    "char_iron_guard",
    "tank",
    ["hammer"],
    stats(520, 48, 45, 38, 300, 100, 700),
    growthStats(46, 4, 4, 0),
    [{ tagId: "shield", count: 1 }, { tagId: "taunt", count: 1 }],
    "skill_guard_hammer",
    ["skill_guard_shield_bash", "skill_guard_fortify", "skill_guard_banner", "skill_guard_challenge"],
    "skill_guard_iron_citadel",
    "skill_guard_unyielding",
  ),
  character(
    "char_ranger",
    "ranger",
    ["bow"],
    stats(360, 62, 25, 65, 800, 200, 200),
    growthStats(32, 6, 2, 0),
    [{ tagId: "speed", count: 1 }, { tagId: "chase", count: 1 }],
    "skill_ranger_arrow",
    ["skill_ranger_twin_shot", "skill_ranger_marking_arrow", "skill_ranger_fleet_step", "skill_ranger_predator_volley"],
    "skill_ranger_arrow_storm",
    "skill_ranger_eagle_eye",
  ),
  character(
    "char_ember_mage",
    "mage",
    ["staff"],
    stats(330, 68, 22, 50, 500, 600, 300),
    growthStats(29, 6, 2, 0),
    [{ tagId: "burn", count: 1 }, { tagId: "detonate", count: 1 }],
    "skill_ember_bolt",
    ["skill_ember_fireball", "skill_ember_flame_wave", "skill_ember_detonate", "skill_ember_ward"],
    "skill_ember_inferno",
    "skill_ember_kindling",
  ),
  character(
    "char_frost_seer",
    "mage",
    ["focus"],
    stats(350, 60, 26, 55, 400, 800, 500),
    growthStats(31, 5, 2, 0),
    [{ tagId: "frost", count: 1 }, { tagId: "control", count: 1 }],
    "skill_frost_shard",
    ["skill_frost_chill_lance", "skill_frost_ice_nova", "skill_frost_crystal_aegis", "skill_frost_winter_link"],
    "skill_frost_absolute_zero",
    "skill_frost_clarity",
  ),
  character(
    "char_priest",
    "support",
    ["relic"],
    stats(390, 52, 30, 46, 300, 400, 700),
    growthStats(35, 5, 3, 0),
    [{ tagId: "heal", count: 1 }, { tagId: "shield", count: 1 }],
    "skill_priest_smite",
    ["skill_priest_mend", "skill_priest_sanctuary", "skill_priest_purifying_light", "skill_priest_aegis"],
    "skill_priest_returning_light",
    "skill_priest_benediction",
  ),
];

/** BAL-1.2 六名角色的静态引用和成长数值。 */
export const CHARACTER_DEFINITIONS: readonly CharacterDefinition[] = Object.freeze(characterDefinitions);
export const characterDefinitionsReadonly = CHARACTER_DEFINITIONS;
export const characters = CHARACTER_DEFINITIONS;
