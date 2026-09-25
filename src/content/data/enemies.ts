import type { EnemyAiRule, EnemyDefinition, StatBlock } from "../contracts";

type EnemyFloorBase = {
  level: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  effectHitBps: number;
  effectResistBps: number;
};

/** 敌人面板严格按 BAL-1.2 的楼层基准展开，避免后续楼层回退到第一层常数。 */
const floorBases: Record<number, EnemyFloorBase> = {
  1: { level: 3, maxHp: 300, attack: 42, defense: 18, speed: 45, effectHitBps: 0, effectResistBps: 0 },
  2: { level: 8, maxHp: 500, attack: 60, defense: 28, speed: 48, effectHitBps: 300, effectResistBps: 200 },
  3: { level: 13, maxHp: 750, attack: 82, defense: 40, speed: 50, effectHitBps: 500, effectResistBps: 400 },
  4: { level: 18, maxHp: 1000, attack: 105, defense: 53, speed: 52, effectHitBps: 700, effectResistBps: 600 },
  5: { level: 23, maxHp: 1300, attack: 132, defense: 68, speed: 54, effectHitBps: 900, effectResistBps: 800 },
  6: { level: 28, maxHp: 1600, attack: 165, defense: 86, speed: 58, effectHitBps: 1100, effectResistBps: 1000 },
  7: { level: 33, maxHp: 1900, attack: 205, defense: 106, speed: 61, effectHitBps: 1300, effectResistBps: 1200 },
  8: { level: 38, maxHp: 2250, attack: 252, defense: 130, speed: 64, effectHitBps: 1500, effectResistBps: 1400 },
  9: { level: 43, maxHp: 2600, attack: 305, defense: 158, speed: 67, effectHitBps: 1700, effectResistBps: 1600 },
  10: { level: 48, maxHp: 3000, attack: 368, defense: 190, speed: 70, effectHitBps: 2000, effectResistBps: 1800 },
};

function stat(floor: number, multiplier: { maxHp: number; attack: number; defense: number; speed: number }, elite = false): StatBlock {
  const base = floorBases[floor];
  const eliteMultiplier = elite ? { maxHp: 18_000, attack: 12_000, defense: 12_000, speed: 10_500 } : { maxHp: 10_000, attack: 10_000, defense: 10_000, speed: 10_000 };
  return {
    maxHp: Math.floor(Math.floor(base.maxHp * multiplier.maxHp / 10_000) * eliteMultiplier.maxHp / 10_000),
    attack: Math.floor(Math.floor(base.attack * multiplier.attack / 10_000) * eliteMultiplier.attack / 10_000),
    defense: Math.floor(Math.floor(base.defense * multiplier.defense / 10_000) * eliteMultiplier.defense / 10_000),
    speed: Math.floor(Math.floor(base.speed * multiplier.speed / 10_000) * eliteMultiplier.speed / 10_000),
    critRateBps: 500,
    critDamageBps: 15_000,
    effectHitBps: base.effectHitBps,
    effectResistBps: base.effectResistBps,
  };
}

function rule(priority: number, conditions: EnemyAiRule["conditions"], skillId: string, targetStrategy: EnemyAiRule["targetStrategy"]): EnemyAiRule {
  return { priority, conditions, skillId, targetStrategy, weight: 100 };
}

function enemy(
  id: string,
  level: number,
  stats: StatBlock,
  elementWeaknesses: EnemyDefinition["elementWeaknesses"],
  elementResistances: EnemyDefinition["elementResistances"],
  basicSkillId: string,
  basicTargetStrategy: EnemyDefinition["basicTargetStrategy"],
  skillIds: string[],
  aiRules: EnemyAiRule[],
  immunityTags: string[] = [],
): EnemyDefinition {
  return {
    id,
    nameKey: `enemy.${id}.name`,
    level,
    stats,
    elementWeaknesses,
    elementResistances,
    immunityTags,
    basicSkillId,
    basicTargetStrategy,
    skillIds,
    aiRules,
    spriteId: `sprite_battle_${id}`,
  };
}

const balanced = { maxHp: 10_000, attack: 10_000, defense: 10_000, speed: 10_000 };
const swift = { maxHp: 8500, attack: 10_500, defense: 8500, speed: 13_500 };
const brute = { maxHp: 13_500, attack: 12_000, defense: 10_500, speed: 8000 };
const caster = { maxHp: 9000, attack: 12_500, defense: 8000, speed: 10_000 };
const guardian = { maxHp: 14_500, attack: 8500, defense: 14_500, speed: 7500 };
const support = { maxHp: 10_500, attack: 8000, defense: 9500, speed: 9500 };

const definitions: EnemyDefinition[] = [
  enemy("enemy_grass_slime", 3, stat(1, balanced), ["fire"], [], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_defend"], [rule(80, [{ kind: "selfHpAtMostBps", valueBps: 5000 }], "skill_enemy_defend", "self")]),
  enemy("enemy_thorn_rat", 3, stat(1, swift), ["frost"], ["physical"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_double_hit"], [rule(70, [{ kind: "always" }], "skill_enemy_double_hit", "frontFirstOpponent")]),
  enemy("enemy_fang_wolf", 3, stat(1, brute), ["fire"], ["physical"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_bleed_hit"], [
    rule(80, [{ kind: "targetMissingStatus", statusId: "status_bleed" }], "skill_enemy_bleed_hit", "frontFirstOpponent"),
    rule(50, [{ kind: "always" }], "skill_enemy_bleed_hit", "frontFirstOpponent"),
  ]),
  enemy("enemy_goblin_scout", 3, stat(1, caster), ["lightning"], [], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_slow_hit"], [rule(80, [{ kind: "targetMissingStatus", statusId: "status_slow" }], "skill_enemy_slow_hit", "lowestHpOpponent")]),
  enemy("enemy_stonehide_boar", 3, stat(1, guardian, true), ["poison"], ["physical"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_charge"], [rule(90, [{ kind: "roundAtLeast", round: 2 }], "skill_enemy_charge", "frontFirstOpponent")]),
  enemy("boss_horned_king", 5, { maxHp: 2400, attack: 62, defense: 26, speed: 42, critRateBps: 500, critDamageBps: 15_000, effectHitBps: 500, effectResistBps: 1000 }, ["fire"], [], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_boss_horned_charge", "skill_boss_horned_call", "skill_boss_enrage"], [
    rule(120, [{ kind: "roundAtLeast", round: 12 }, { kind: "selfMissingStatus", statusId: "status_boss_enrage" }], "skill_boss_enrage", "self"),
    rule(100, [{ kind: "selfHpAtMostBps", valueBps: 5000 }, { kind: "selfMissingStatus", statusId: "status_boss_phase_2" }], "skill_boss_horned_call", "self"),
    rule(70, [{ kind: "always" }], "skill_boss_horned_charge", "frontFirstOpponent"),
  ], ["stun"]),
];

const floor02To05Definitions: EnemyDefinition[] = [
  enemy("enemy_sporeling", 8, stat(2, caster), ["fire"], ["poison"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_poison_hit"], [rule(80, [{ kind: "always" }], "skill_enemy_poison_hit", "lowestHpOpponent")]),
  enemy("enemy_venom_spider", 8, stat(2, swift), ["frost"], ["poison"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_poison_double"], [rule(80, [{ kind: "always" }], "skill_enemy_poison_double", "lowestHpOpponent")]),
  enemy("enemy_fungal_guardian", 8, stat(2, guardian, true), ["fire"], ["poison"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_guard_all"], [rule(90, [{ kind: "anyAllyHpAtMostBps", valueBps: 6000 }], "skill_enemy_guard_all", "self")]),
  enemy("enemy_cave_bat", 13, stat(3, swift), ["lightning"], ["dark"], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_haste"], [rule(80, [{ kind: "selfMissingStatus", statusId: "status_haste" }], "skill_enemy_haste", "self")]),
  enemy("enemy_ore_golem", 13, stat(3, guardian, true), ["lightning"], ["physical"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_stun_hit"], [rule(80, [{ kind: "always" }], "skill_enemy_stun_hit", "frontFirstOpponent")]),
  enemy("enemy_bomb_goblin", 13, stat(3, caster), ["frost"], ["fire"], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_all_physical"], [rule(70, [{ kind: "opponentCountAtLeast", count: 2 }], "skill_enemy_all_physical", "self")]),
  enemy("enemy_bog_leech", 18, stat(4, support), ["holy"], ["poison"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_self_heal"], [rule(90, [{ kind: "selfHpAtMostBps", valueBps: 4500 }], "skill_enemy_self_heal", "self")]),
  enemy("enemy_mist_wraith", 18, stat(4, caster, true), ["holy"], ["dark"], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_fear_all"], [rule(85, [{ kind: "roundEquals", round: 1 }], "skill_enemy_fear_all", "self"), rule(80, [{ kind: "opponentsMissingStatusCountAtLeast", statusId: "status_fear", count: 2 }], "skill_enemy_fear_all", "self")]),
  enemy("enemy_ember_hound", 23, stat(5, brute), ["frost"], ["fire"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_burn_hit"], [rule(80, [{ kind: "always" }], "skill_enemy_burn_hit", "frontFirstOpponent")]),
  enemy("enemy_ash_cultist", 23, stat(5, caster, true), ["holy"], ["fire"], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_burn_all"], [rule(75, [{ kind: "opponentCountAtLeast", count: 2 }], "skill_enemy_burn_all", "self")]),
  enemy("boss_brood_spider", 10, { maxHp: 4200, attack: 88, defense: 38, speed: 52, critRateBps: 500, critDamageBps: 15_000, effectHitBps: 900, effectResistBps: 1300 }, ["fire"], ["poison"], "skill_enemy_poison_hit", "lowestHpOpponent", ["skill_boss_brood_venom_web", "skill_boss_brood_hatch", "skill_boss_enrage"], [
    rule(120, [{ kind: "roundAtLeast", round: 11 }, { kind: "selfMissingStatus", statusId: "status_boss_enrage" }], "skill_boss_enrage", "self"),
    rule(100, [{ kind: "selfHpAtMostBps", valueBps: 5000 }, { kind: "selfMissingStatus", statusId: "status_boss_phase_2" }], "skill_boss_brood_hatch", "self"),
    rule(75, [{ kind: "roundAtLeast", round: 2 }], "skill_boss_brood_venom_web", "self"),
  ], ["poison"]),
  enemy("boss_iron_devourer", 15, { maxHp: 6200, attack: 118, defense: 65, speed: 38, critRateBps: 500, critDamageBps: 15_000, effectHitBps: 900, effectResistBps: 1600 }, ["lightning"], ["physical"], "skill_enemy_stun_hit", "frontFirstOpponent", ["skill_boss_iron_quake", "skill_boss_iron_overdrive", "skill_boss_enrage"], [
    rule(120, [{ kind: "roundAtLeast", round: 12 }, { kind: "selfMissingStatus", statusId: "status_boss_enrage" }], "skill_boss_enrage", "self"),
    rule(100, [{ kind: "selfHpAtMostBps", valueBps: 5000 }, { kind: "selfMissingStatus", statusId: "status_boss_phase_2" }], "skill_boss_iron_overdrive", "self"),
    rule(75, [{ kind: "always" }], "skill_boss_iron_quake", "self"),
  ], ["stun"]),
  enemy("boss_bog_witch", 20, { maxHp: 7800, attack: 142, defense: 64, speed: 58, critRateBps: 500, critDamageBps: 15_000, effectHitBps: 1300, effectResistBps: 1900 }, ["holy"], ["dark"], "skill_enemy_fear_hit", "lowestHpOpponent", ["skill_boss_witch_miasma", "skill_boss_witch_rebirth", "skill_boss_enrage"], [
    rule(120, [{ kind: "roundAtLeast", round: 14 }, { kind: "selfMissingStatus", statusId: "status_boss_enrage" }], "skill_boss_enrage", "self"),
    rule(100, [{ kind: "selfHpAtMostBps", valueBps: 5000 }, { kind: "selfMissingStatus", statusId: "status_boss_phase_2" }], "skill_boss_witch_rebirth", "self"),
    rule(75, [{ kind: "roundAtLeast", round: 2 }], "skill_boss_witch_miasma", "self"),
  ], ["poison"]),
  enemy("boss_ember_guardian", 25, { maxHp: 10_500, attack: 182, defense: 92, speed: 55, critRateBps: 500, critDamageBps: 15_000, effectHitBps: 1500, effectResistBps: 2100 }, ["frost"], ["fire"], "skill_enemy_burn_hit", "frontFirstOpponent", ["skill_boss_ember_sweep", "skill_boss_ember_eruption", "skill_boss_enrage"], [
    rule(120, [{ kind: "roundAtLeast", round: 11 }, { kind: "selfMissingStatus", statusId: "status_boss_enrage" }], "skill_boss_enrage", "self"),
    rule(100, [{ kind: "selfHpAtMostBps", valueBps: 5000 }, { kind: "selfMissingStatus", statusId: "status_boss_phase_2" }], "skill_boss_ember_eruption", "self"),
    rule(75, [{ kind: "always" }], "skill_boss_ember_sweep", "self"),
  ], ["burn"]),
];

const abyssDefinitions: EnemyDefinition[] = [
  enemy("enemy_abyss_mauler", 28, stat(6, brute, true), ["holy"], ["dark"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_execute"], [rule(95, [{ kind: "anyOpponentHpAtMostBps", valueBps: 3000 }], "skill_enemy_execute", "lowestHpOpponent")]),
  enemy("enemy_dread_eye", 28, stat(6, caster), ["holy"], ["dark"], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_fear_hit"], [rule(80, [{ kind: "always" }], "skill_enemy_fear_hit", "lowestHpOpponent")]),
  enemy("enemy_blood_ghoul", 33, stat(7, swift), ["holy"], ["dark"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_bleed_double"], [rule(80, [{ kind: "always" }], "skill_enemy_bleed_double", "frontFirstOpponent")]),
  enemy("enemy_crimson_acolyte", 33, stat(7, support, true), ["frost"], ["dark"], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_ally_heal"], [rule(95, [{ kind: "anyAllyHpAtMostBps", valueBps: 5500 }], "skill_enemy_ally_heal", "lowestHpAlly")]),
  enemy("enemy_frost_warden", 38, stat(8, guardian, true), ["fire"], ["frost"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_frost_guard"], [rule(90, [{ kind: "anyAllyHpAtMostBps", valueBps: 7000 }], "skill_enemy_frost_guard", "self")]),
  enemy("enemy_ice_revenant", 38, stat(8, caster), ["fire"], ["frost"], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_freeze_hit"], [rule(80, [{ kind: "always" }], "skill_enemy_freeze_hit", "lowestHpOpponent")]),
  enemy("enemy_void_spark", 43, stat(9, swift), ["physical"], ["lightning"], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_shock_double"], [rule(80, [{ kind: "always" }], "skill_enemy_shock_double", "randomValid")]),
  enemy("enemy_watcher_shard", 43, stat(9, caster, true), ["dark"], ["lightning"], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_slow_all"], [rule(90, [{ kind: "roundEquals", round: 1 }], "skill_enemy_slow_all", "self"), rule(80, [{ kind: "opponentsMissingStatusCountAtLeast", statusId: "status_slow", count: 2 }], "skill_enemy_slow_all", "self")]),
  enemy("enemy_throne_knight", 48, stat(10, guardian, true), ["holy"], ["dark"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_enemy_counter_guard"], [rule(90, [{ kind: "selfHpAtMostBps", valueBps: 7000 }, { kind: "selfMissingStatus", statusId: "status_shield" }], "skill_enemy_counter_guard", "self")]),
  enemy("enemy_abyss_herald", 48, stat(10, caster), ["holy"], ["dark"], "skill_enemy_basic_ranged", "lowestHpOpponent", ["skill_enemy_all_physical"], [rule(70, [{ kind: "opponentCountAtLeast", count: 2 }], "skill_enemy_all_physical", "self")]),
  enemy("boss_abyss_butcher", 30, { maxHp: 13_000, attack: 230, defense: 116, speed: 62, critRateBps: 500, critDamageBps: 15_000, effectHitBps: 1800, effectResistBps: 2400 }, ["holy"], ["dark"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_boss_butcher_cleaver", "skill_boss_butcher_frenzy", "skill_boss_enrage"], [
    rule(120, [{ kind: "roundAtLeast", round: 12 }, { kind: "selfMissingStatus", statusId: "status_boss_enrage" }], "skill_boss_enrage", "self"),
    rule(100, [{ kind: "selfHpAtMostBps", valueBps: 5000 }, { kind: "selfMissingStatus", statusId: "status_boss_phase_2" }], "skill_boss_butcher_frenzy", "self"),
    rule(90, [{ kind: "anyOpponentHpAtMostBps", valueBps: 3000 }], "skill_boss_butcher_cleaver", "lowestHpOpponent"),
    rule(65, [{ kind: "always" }], "skill_boss_butcher_cleaver", "lowestHpOpponent"),
  ], ["fear"]),
  enemy("boss_crimson_knight", 35, { maxHp: 14_500, attack: 285, defense: 132, speed: 72, critRateBps: 500, critDamageBps: 15_000, effectHitBps: 2000, effectResistBps: 2600 }, ["frost"], ["dark"], "skill_enemy_bleed_double", "frontFirstOpponent", ["skill_boss_crimson_flurry", "skill_boss_crimson_bloodmoon", "skill_boss_enrage"], [
    rule(120, [{ kind: "roundAtLeast", round: 13 }, { kind: "selfMissingStatus", statusId: "status_boss_enrage" }], "skill_boss_enrage", "self"),
    rule(100, [{ kind: "selfHpAtMostBps", valueBps: 5000 }, { kind: "selfMissingStatus", statusId: "status_boss_phase_2" }], "skill_boss_crimson_bloodmoon", "self"),
    rule(75, [{ kind: "always" }], "skill_boss_crimson_flurry", "frontFirstOpponent"),
  ], ["bleed"]),
  enemy("boss_pale_jailer", 40, { maxHp: 15_500, attack: 345, defense: 185, speed: 58, critRateBps: 500, critDamageBps: 15_000, effectHitBps: 2200, effectResistBps: 2900 }, ["fire"], ["frost"], "skill_enemy_freeze_hit", "lowestHpOpponent", ["skill_boss_jailer_prison", "skill_boss_jailer_whitewall", "skill_boss_enrage"], [
    rule(120, [{ kind: "roundAtLeast", round: 14 }, { kind: "selfMissingStatus", statusId: "status_boss_enrage" }], "skill_boss_enrage", "self"),
    rule(100, [{ kind: "selfHpAtMostBps", valueBps: 5000 }, { kind: "selfMissingStatus", statusId: "status_boss_phase_2" }], "skill_boss_jailer_whitewall", "self"),
    rule(75, [{ kind: "roundAtLeast", round: 2 }], "skill_boss_jailer_prison", "self"),
  ], ["freeze"]),
  enemy("boss_thousand_eye", 45, { maxHp: 18_000, attack: 420, defense: 190, speed: 78, critRateBps: 500, critDamageBps: 15_000, effectHitBps: 2500, effectResistBps: 3100 }, ["dark"], ["lightning"], "skill_enemy_shock_double", "randomValid", ["skill_boss_eye_chain", "skill_boss_eye_rewrite", "skill_boss_enrage"], [
    rule(120, [{ kind: "roundAtLeast", round: 11 }, { kind: "selfMissingStatus", statusId: "status_boss_enrage" }], "skill_boss_enrage", "self"),
    rule(100, [{ kind: "selfHpAtMostBps", valueBps: 5000 }, { kind: "selfMissingStatus", statusId: "status_boss_phase_2" }], "skill_boss_eye_rewrite", "self"),
    rule(75, [{ kind: "always" }], "skill_boss_eye_chain", "randomValid"),
  ], ["stun"]),
  enemy("boss_abyss_king", 50, { maxHp: 19_000, attack: 510, defense: 240, speed: 75, critRateBps: 500, critDamageBps: 15_000, effectHitBps: 2800, effectResistBps: 3500 }, ["holy"], ["dark"], "skill_enemy_basic_physical", "frontFirstOpponent", ["skill_boss_king_dark_wave", "skill_boss_king_phase_two", "skill_boss_king_phase_three", "skill_boss_king_annihilation", "skill_boss_enrage"], [
    rule(120, [{ kind: "roundAtLeast", round: 14 }, { kind: "selfMissingStatus", statusId: "status_boss_enrage" }], "skill_boss_enrage", "self"),
    rule(110, [{ kind: "selfHpAtMostBps", valueBps: 3500 }, { kind: "selfHasStatus", statusId: "status_boss_phase_2" }, { kind: "selfMissingStatus", statusId: "status_boss_phase_3" }], "skill_boss_king_phase_three", "self"),
    rule(100, [{ kind: "selfHpAtMostBps", valueBps: 7000 }, { kind: "selfMissingStatus", statusId: "status_boss_phase_2" }], "skill_boss_king_phase_two", "self"),
    rule(90, [{ kind: "selfHasStatus", statusId: "status_boss_phase_3" }], "skill_boss_king_annihilation", "self"),
    rule(70, [{ kind: "always" }], "skill_boss_king_dark_wave", "self"),
  ], ["stun", "freeze", "fear"]),
];

/** WORLD-1.2 第一层六个敌方定义，顺序与冻结 manifest 一致。 */
/** 第 2～5 层追加定义排在第一层之后；第一层 manifest 仍按显式 ID 截取。 */
export const ENEMY_DEFINITIONS: readonly EnemyDefinition[] = Object.freeze([...definitions, ...floor02To05Definitions, ...abyssDefinitions]);
export const enemyDefinitionsReadonly = ENEMY_DEFINITIONS;
export const enemies = ENEMY_DEFINITIONS;
