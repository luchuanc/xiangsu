/**
 * 不可变内容目录与引用门禁。
 * Catalog 不返回 undefined；调用方必须处理 DomainResult 失败分支。
 */
import { createDomainError, failure, success, type DomainResult } from "../domain/common/DomainResult";
import type {
  AbyssEchoDefinition, AffixTriggerDefinition, BossIntentDefinition, CharacterDefinition, ComboDefinition, ContentRootV1, DialogueDefinition, DropTableDefinition,
  EncounterDefinition, EncounterModifierDefinition, EnemyDefinition, EquipmentAffixDefinition, EquipmentBaseDefinition,
  FloorDefinition, MapDefinition, NpcDefinition, QuestDefinition, RecruitmentDefinition, ShopDefinition, StackableItemDefinition,
  SkillAffixDefinition, SkillDefinition, StatusDefinition,
} from "./contracts";
import { contentRootSchema } from "./schemas";
import { expectedLocaleKeys, validateLocale, zhCN } from "./locales/zh-CN";

export type BatchId = "verticalSlice" | "floors02_05" | "floors06_10" | "abyssEchoes";
export type ValidationMode = "fixture" | "final" | { kind: "batch"; batchId: BatchId };

const rootCollections = [
  "characters", "skills", "statuses", "equipmentBases", "equipmentAffixes", "affixTriggers", "skillAffixes", "combos",
  "enemies", "encounters", "encounterModifiers", "bossIntents", "abyssEchoes", "floors", "maps", "npcs", "dialogues",
  "quests", "recruitments", "shops", "items", "dropTables",
] as const;
type CollectionName = (typeof rootCollections)[number];
type Entity = { id: string };
export type ContentManifest = Readonly<{ [K in CollectionName]: readonly string[] }>;

export const FINAL_CONTENT_COUNTS = Object.freeze({
  characters: 6, skills: 97, statuses: 18, equipmentBases: 60, equipmentAffixes: 48, affixTriggers: 15,
  skillAffixes: 24, combos: 18, enemies: 35, encounters: 50, encounterModifiers: 8, bossIntents: 10,
  abyssEchoes: 10, floors: 10, maps: 11, npcs: 7, dialogues: 7, quests: 1, recruitments: 5, shops: 1,
  items: 5, dropTables: 50,
} as const);

export const FROZEN_BATCH_IDS: Readonly<Record<BatchId, readonly string[]>> = Object.freeze({
  verticalSlice: Object.freeze(["map_town", "map_floor_01", "floor_01", "encounter_floor_01_normal_a", "encounter_floor_01_normal_b", "encounter_floor_01_normal_c", "encounter_floor_01_elite_boar", "encounter_floor_01_boss"]),
  floors02_05: Object.freeze(["floor_02", "floor_03", "floor_04", "floor_05", "map_floor_02", "map_floor_03", "map_floor_04", "map_floor_05"]),
  floors06_10: Object.freeze(["floor_06", "floor_07", "floor_08", "floor_09", "floor_10", "map_floor_06", "map_floor_07", "map_floor_08", "map_floor_09", "map_floor_10"]),
  abyssEchoes: Object.freeze(["echo_f06_iron", "echo_f06_hunger", "echo_f07_red_tide", "echo_f07_blood_oath", "echo_f08_white_wall", "echo_f08_silent_prison", "echo_f09_storm_eye", "echo_f09_rewrite", "echo_f10_dark_throne", "echo_f10_endless_king"]),
});

function freezeManifest(overrides: Partial<Record<CollectionName, readonly string[]>> = {}): ContentManifest {
  return Object.freeze(Object.fromEntries(rootCollections.map((collection) => [
    collection,
    Object.freeze([...(overrides[collection] ?? [])]),
  ]))) as ContentManifest;
}

// 四批 ID 由 RPG-022/024/025/028 的冻结生产清单逐集合转录；不从当前 root 推导。
const verticalSliceManifest = freezeManifest({
  characters: ["char_wanderer","char_iron_guard","char_ember_mage","char_priest"],
  skills: ["skill_wanderer_strike","skill_wanderer_rending_slash","skill_wanderer_guarding_blow","skill_wanderer_execution","skill_wanderer_blood_rally","skill_wanderer_endless_edge","skill_wanderer_instinct","skill_guard_hammer","skill_guard_shield_bash","skill_guard_fortify","skill_guard_banner","skill_guard_challenge","skill_guard_iron_citadel","skill_guard_unyielding","skill_priest_smite","skill_priest_mend","skill_priest_sanctuary","skill_priest_purifying_light","skill_priest_aegis","skill_priest_returning_light","skill_priest_benediction","skill_ember_bolt","skill_ember_fireball","skill_ember_flame_wave","skill_ember_detonate","skill_ember_ward","skill_ember_inferno","skill_ember_kindling","effect_ember_echo_burst","effect_guard_ripple","effect_bleed_doublecut","effect_holy_afterglow","effect_shadow_echo","effect_sweeping_basic","skill_enemy_basic_physical","skill_enemy_basic_ranged","skill_enemy_defend","skill_enemy_double_hit","skill_enemy_bleed_hit","skill_enemy_slow_hit","skill_enemy_charge","skill_enemy_poison_hit","skill_enemy_poison_double","skill_enemy_guard_all","skill_enemy_haste","skill_enemy_stun_hit","skill_enemy_all_physical","skill_enemy_self_heal","skill_enemy_fear_all","skill_enemy_burn_hit","skill_enemy_burn_all","skill_enemy_execute","skill_enemy_fear_hit","skill_enemy_bleed_double","skill_enemy_ally_heal","skill_enemy_frost_guard","skill_enemy_freeze_hit","skill_enemy_shock_double","skill_enemy_slow_all","skill_enemy_counter_guard","skill_boss_horned_charge","skill_boss_horned_call","skill_boss_enrage"],
  statuses: ["status_bleed","status_burn","status_poison","status_slow","status_freeze","status_stun","status_taunt","status_guard_30","status_shield","status_marked","status_haste","status_attack_up","status_defense_up","status_fear","status_shock","status_boss_phase_2","status_boss_phase_3","status_boss_enrage"],
  equipmentBases: ["eq_sword_t1_windblade","eq_hammer_t1_stonemaul","eq_bow_t1_reed","eq_staff_t1_oak","eq_focus_t1_frostglass","eq_relic_t1_prayer","eq_helmet_t1_traveler","eq_armor_t1_leather","eq_gloves_t1_hide","eq_boots_t1_cloth","eq_accessory_t1_charm"],
  equipmentAffixes: ["af_vitality","af_might","af_guard","af_haste","af_precision","af_flame","af_frost","af_bleed_edge","af_bulwark","af_counterweight","af_pursuit","af_searing_edge"],
  affixTriggers: ["tr_bleed_edge","tr_counterweight","tr_searing_edge"],
  skillAffixes: ["sa_ember_focus","sa_ember_echo","sa_guard_ripple","sa_bleed_doublecut","sa_heal_overflow","sa_execution_focus","sa_fortress_focus","sa_priest_mend_focus"],
  combos: ["combo_ember_chain","combo_iron_reprise","combo_blood_hunt","combo_holy_bulwark"],
  enemies: ["enemy_grass_slime","enemy_thorn_rat","enemy_fang_wolf","enemy_goblin_scout","enemy_stonehide_boar","boss_horned_king"],
  encounters: ["encounter_floor_01_normal_a","encounter_floor_01_normal_b","encounter_floor_01_normal_c","encounter_floor_01_elite_boar","encounter_floor_01_boss"],
  encounterModifiers: ["modifier_assault","modifier_swift","modifier_bulwark","modifier_mire"],
  bossIntents: ["intent_horned_charge"],
  abyssEchoes: [],
  floors: ["floor_01"],
  maps: ["map_town","map_floor_01"],
  npcs: ["npc_tavern_keeper","npc_blacksmith","npc_skill_mentor","npc_merchant","npc_innkeeper"],
  dialogues: ["dialogue_tavern_keeper","dialogue_blacksmith","dialogue_skill_mentor","dialogue_merchant","dialogue_innkeeper"],
  quests: ["quest_first_elite"],
  recruitments: ["recruit_iron_guard_tavern","recruit_ember_mage_tavern","recruit_priest_first_elite"],
  shops: ["shop_town_merchant"],
  items: ["item_forge_shard","item_inscription_dust","item_minor_potion","item_major_potion","item_cleansing_tonic"],
  dropTables: ["drop_floor_01_normal","drop_floor_01_elite","drop_floor_01_boss","drop_floor_01_chest","drop_floor_01_first_clear"],
});
const floors02_05Manifest = freezeManifest({
  characters: ["char_wanderer","char_iron_guard","char_ranger","char_ember_mage","char_frost_seer","char_priest"],
  skills: ["skill_wanderer_strike","skill_wanderer_rending_slash","skill_wanderer_guarding_blow","skill_wanderer_execution","skill_wanderer_blood_rally","skill_wanderer_endless_edge","skill_wanderer_instinct","skill_guard_hammer","skill_guard_shield_bash","skill_guard_fortify","skill_guard_banner","skill_guard_challenge","skill_guard_iron_citadel","skill_guard_unyielding","skill_ranger_arrow","skill_ranger_twin_shot","skill_ranger_marking_arrow","skill_ranger_fleet_step","skill_ranger_predator_volley","skill_ranger_arrow_storm","skill_ranger_eagle_eye","skill_ember_bolt","skill_ember_fireball","skill_ember_flame_wave","skill_ember_detonate","skill_ember_ward","skill_ember_inferno","skill_ember_kindling","effect_ember_echo_burst","effect_guard_ripple","effect_bleed_doublecut","effect_holy_afterglow","effect_shadow_echo","effect_sweeping_basic","skill_enemy_basic_physical","skill_enemy_basic_ranged","skill_enemy_defend","skill_enemy_double_hit","skill_enemy_bleed_hit","skill_enemy_slow_hit","skill_enemy_charge","skill_enemy_poison_hit","skill_enemy_poison_double","skill_enemy_guard_all","skill_enemy_haste","skill_enemy_stun_hit","skill_enemy_all_physical","skill_enemy_self_heal","skill_enemy_fear_all","skill_enemy_burn_hit","skill_enemy_burn_all","skill_enemy_execute","skill_enemy_fear_hit","skill_enemy_bleed_double","skill_enemy_ally_heal","skill_enemy_frost_guard","skill_enemy_freeze_hit","skill_enemy_shock_double","skill_enemy_slow_all","skill_enemy_counter_guard","skill_boss_horned_charge","skill_boss_horned_call","skill_boss_enrage","skill_frost_shard","skill_frost_chill_lance","skill_frost_ice_nova","skill_frost_crystal_aegis","skill_frost_winter_link","skill_frost_absolute_zero","skill_frost_clarity","skill_priest_smite","skill_priest_mend","skill_priest_sanctuary","skill_priest_purifying_light","skill_priest_aegis","skill_priest_returning_light","skill_priest_benediction","skill_boss_brood_venom_web","skill_boss_brood_hatch","skill_boss_iron_quake","skill_boss_iron_overdrive","skill_boss_witch_miasma","skill_boss_witch_rebirth","skill_boss_ember_sweep","skill_boss_ember_eruption"],
  statuses: ["status_bleed","status_burn","status_poison","status_slow","status_freeze","status_stun","status_taunt","status_guard_30","status_shield","status_marked","status_haste","status_attack_up","status_defense_up","status_fear","status_shock","status_boss_phase_2","status_boss_phase_3","status_boss_enrage"],
  equipmentBases: ["eq_sword_t1_windblade","eq_hammer_t1_stonemaul","eq_bow_t1_reed","eq_staff_t1_oak","eq_focus_t1_frostglass","eq_relic_t1_prayer","eq_helmet_t1_traveler","eq_armor_t1_leather","eq_gloves_t1_hide","eq_boots_t1_cloth","eq_accessory_t1_charm","eq_sword_t2_bloodiron","eq_hammer_t2_bastion","eq_bow_t2_hawkeye","eq_staff_t2_cinder","eq_focus_t2_mist_orb","eq_relic_t2_silver_bell","eq_helmet_t2_iron","eq_armor_t2_chain","eq_gloves_t2_rivet","eq_boots_t2_scout","eq_accessory_t2_gem","eq_sword_t3_emberedge","eq_hammer_t3_magma","eq_bow_t3_bloodstring","eq_staff_t3_volcano","eq_focus_t3_iceheart","eq_relic_t3_sun_shard","eq_helmet_t3_ember","eq_armor_t3_plate","eq_gloves_t3_flame","eq_boots_t3_ash","eq_accessory_t3_sigil","eq_helmet_t4_abyss","eq_armor_t4_abyss","eq_gloves_t4_crimson","eq_boots_t4_bloodstep","eq_accessory_t4_eye"],
  equipmentAffixes: ["af_vitality","af_might","af_guard","af_haste","af_precision","af_flame","af_frost","af_bleed_edge","af_bulwark","af_counterweight","af_pursuit","af_searing_edge","af_ferocity","af_focus","af_resolve","af_physical_edge","af_lightning","af_holy","af_poison","af_high_spirit","af_executioner","af_last_stand","af_frontline_wall","af_backline_focus","af_marked_prey","af_venom_edge"],
  affixTriggers: ["tr_bleed_edge","tr_counterweight","tr_searing_edge","tr_venom_edge","tr_frostbite_edge","tr_storm_spark","tr_healing_echo","tr_guardian_pulse"],
  skillAffixes: ["sa_ember_focus","sa_ember_echo","sa_guard_ripple","sa_bleed_doublecut","sa_heal_overflow","sa_execution_focus","sa_fortress_focus","sa_priest_mend_focus","sa_frost_nova_focus","sa_frost_zero_echo","sa_ranger_twin_echo","sa_ranger_marked_chase","sa_swift_charge","sa_storm_chain","sa_universal_focus","sa_priest_sanctuary_echo"],
  combos: ["combo_ember_chain","combo_iron_reprise","combo_blood_hunt","combo_holy_bulwark","combo_venom_bloom","combo_frozen_verdict","combo_storm_circuit","combo_execution_cadence","combo_steadfast_aegis","combo_swift_formation","combo_perfect_strike"],
  enemies: ["enemy_grass_slime","enemy_thorn_rat","enemy_fang_wolf","enemy_goblin_scout","enemy_stonehide_boar","enemy_sporeling","enemy_venom_spider","enemy_fungal_guardian","enemy_cave_bat","enemy_ore_golem","enemy_bomb_goblin","enemy_bog_leech","enemy_mist_wraith","enemy_ember_hound","enemy_ash_cultist","boss_horned_king","boss_brood_spider","boss_iron_devourer","boss_bog_witch","boss_ember_guardian"],
  encounters: ["encounter_floor_01_normal_a","encounter_floor_01_normal_b","encounter_floor_01_normal_c","encounter_floor_01_elite_boar","encounter_floor_01_boss","encounter_floor_02_normal_a","encounter_floor_02_normal_b","encounter_floor_02_normal_c","encounter_floor_02_elite_guardian","encounter_floor_02_boss","encounter_floor_03_normal_a","encounter_floor_03_normal_b","encounter_floor_03_normal_c","encounter_floor_03_elite_golem","encounter_floor_03_boss","encounter_floor_04_normal_a","encounter_floor_04_normal_b","encounter_floor_04_normal_c","encounter_floor_04_elite_wraith","encounter_floor_04_boss","encounter_floor_05_normal_a","encounter_floor_05_normal_b","encounter_floor_05_normal_c","encounter_floor_05_elite_cultist","encounter_floor_05_boss"],
  encounterModifiers: ["modifier_assault","modifier_swift","modifier_bulwark","modifier_mire","modifier_abyss_execution","modifier_abyss_fortress","modifier_abyss_pressure","modifier_abyss_suppression"],
  bossIntents: ["intent_horned_charge","intent_brood_venom_web","intent_iron_quake","intent_witch_miasma","intent_ember_eruption"],
  abyssEchoes: [],
  floors: ["floor_01","floor_02","floor_03","floor_04","floor_05"],
  maps: ["map_town","map_floor_01","map_floor_02","map_floor_03","map_floor_04","map_floor_05"],
  npcs: ["npc_tavern_keeper","npc_blacksmith","npc_skill_mentor","npc_merchant","npc_innkeeper","npc_cartographer","npc_abyss_watcher"],
  dialogues: ["dialogue_tavern_keeper","dialogue_blacksmith","dialogue_skill_mentor","dialogue_merchant","dialogue_innkeeper","dialogue_cartographer","dialogue_abyss_watcher"],
  quests: ["quest_first_elite"],
  recruitments: ["recruit_iron_guard_tavern","recruit_ember_mage_tavern","recruit_priest_first_elite","recruit_ranger_floor_02","recruit_frost_floor_04"],
  shops: ["shop_town_merchant"],
  items: ["item_forge_shard","item_inscription_dust","item_minor_potion","item_major_potion","item_cleansing_tonic"],
  dropTables: ["drop_floor_01_normal","drop_floor_01_elite","drop_floor_01_boss","drop_floor_01_chest","drop_floor_01_first_clear","drop_floor_02_normal","drop_floor_02_elite","drop_floor_02_boss","drop_floor_02_chest","drop_floor_02_first_clear","drop_floor_03_normal","drop_floor_03_elite","drop_floor_03_boss","drop_floor_03_chest","drop_floor_03_first_clear","drop_floor_04_normal","drop_floor_04_elite","drop_floor_04_boss","drop_floor_04_chest","drop_floor_04_first_clear","drop_floor_05_normal","drop_floor_05_elite","drop_floor_05_boss","drop_floor_05_chest","drop_floor_05_first_clear"],
});
const floors06_10Manifest = freezeManifest({
  characters: ["char_wanderer","char_iron_guard","char_ranger","char_ember_mage","char_frost_seer","char_priest"],
  skills: ["skill_wanderer_strike","skill_wanderer_rending_slash","skill_wanderer_guarding_blow","skill_wanderer_execution","skill_wanderer_blood_rally","skill_wanderer_endless_edge","skill_wanderer_instinct","skill_guard_hammer","skill_guard_shield_bash","skill_guard_fortify","skill_guard_banner","skill_guard_challenge","skill_guard_iron_citadel","skill_guard_unyielding","skill_ranger_arrow","skill_ranger_twin_shot","skill_ranger_marking_arrow","skill_ranger_fleet_step","skill_ranger_predator_volley","skill_ranger_arrow_storm","skill_ranger_eagle_eye","skill_ember_bolt","skill_ember_fireball","skill_ember_flame_wave","skill_ember_detonate","skill_ember_ward","skill_ember_inferno","skill_ember_kindling","skill_frost_shard","skill_frost_chill_lance","skill_frost_ice_nova","skill_frost_crystal_aegis","skill_frost_winter_link","skill_frost_absolute_zero","skill_frost_clarity","skill_priest_smite","skill_priest_mend","skill_priest_sanctuary","skill_priest_purifying_light","skill_priest_aegis","skill_priest_returning_light","skill_priest_benediction","effect_ember_echo_burst","effect_guard_ripple","effect_bleed_doublecut","effect_holy_afterglow","effect_shadow_echo","effect_sweeping_basic","skill_enemy_basic_physical","skill_enemy_basic_ranged","skill_enemy_defend","skill_enemy_double_hit","skill_enemy_bleed_hit","skill_enemy_slow_hit","skill_enemy_charge","skill_enemy_poison_hit","skill_enemy_poison_double","skill_enemy_guard_all","skill_enemy_haste","skill_enemy_stun_hit","skill_enemy_all_physical","skill_enemy_self_heal","skill_enemy_fear_all","skill_enemy_burn_hit","skill_enemy_burn_all","skill_enemy_execute","skill_enemy_fear_hit","skill_enemy_bleed_double","skill_enemy_ally_heal","skill_enemy_frost_guard","skill_enemy_freeze_hit","skill_enemy_shock_double","skill_enemy_slow_all","skill_enemy_counter_guard","skill_boss_enrage","skill_boss_horned_charge","skill_boss_horned_call","skill_boss_brood_venom_web","skill_boss_brood_hatch","skill_boss_iron_quake","skill_boss_iron_overdrive","skill_boss_witch_miasma","skill_boss_witch_rebirth","skill_boss_ember_sweep","skill_boss_ember_eruption","skill_boss_butcher_cleaver","skill_boss_butcher_frenzy","skill_boss_crimson_flurry","skill_boss_crimson_bloodmoon","skill_boss_jailer_prison","skill_boss_jailer_whitewall","skill_boss_eye_chain","skill_boss_eye_rewrite","skill_boss_king_dark_wave","skill_boss_king_phase_two","skill_boss_king_phase_three","skill_boss_king_annihilation"],
  statuses: ["status_bleed","status_burn","status_poison","status_slow","status_freeze","status_stun","status_taunt","status_guard_30","status_shield","status_marked","status_haste","status_attack_up","status_defense_up","status_fear","status_shock","status_boss_phase_2","status_boss_phase_3","status_boss_enrage"],
  equipmentBases: ["eq_sword_t1_windblade","eq_sword_t2_bloodiron","eq_sword_t3_emberedge","eq_sword_t4_voidcutter","eq_sword_t5_kingbreaker","eq_hammer_t1_stonemaul","eq_hammer_t2_bastion","eq_hammer_t3_magma","eq_hammer_t4_jailer","eq_hammer_t5_worldfall","eq_bow_t1_reed","eq_bow_t2_hawkeye","eq_bow_t3_bloodstring","eq_bow_t4_starchaser","eq_bow_t5_voidrain","eq_staff_t1_oak","eq_staff_t2_cinder","eq_staff_t3_volcano","eq_staff_t4_nightflame","eq_staff_t5_abyss_sun","eq_focus_t1_frostglass","eq_focus_t2_mist_orb","eq_focus_t3_iceheart","eq_focus_t4_thousand_lens","eq_focus_t5_zero_core","eq_relic_t1_prayer","eq_relic_t2_silver_bell","eq_relic_t3_sun_shard","eq_relic_t4_pale_grail","eq_relic_t5_dawn_crown","eq_helmet_t1_traveler","eq_helmet_t2_iron","eq_helmet_t3_ember","eq_helmet_t4_abyss","eq_helmet_t5_pale","eq_helmet_t6_king","eq_armor_t1_leather","eq_armor_t2_chain","eq_armor_t3_plate","eq_armor_t4_abyss","eq_armor_t5_frost","eq_armor_t6_sovereign","eq_gloves_t1_hide","eq_gloves_t2_rivet","eq_gloves_t3_flame","eq_gloves_t4_crimson","eq_gloves_t5_void","eq_gloves_t6_king","eq_boots_t1_cloth","eq_boots_t2_scout","eq_boots_t3_ash","eq_boots_t4_bloodstep","eq_boots_t5_starless","eq_boots_t6_throne","eq_accessory_t1_charm","eq_accessory_t2_gem","eq_accessory_t3_sigil","eq_accessory_t4_eye","eq_accessory_t5_star","eq_accessory_t6_crown"],
  equipmentAffixes: ["af_vitality","af_might","af_guard","af_haste","af_precision","af_ferocity","af_focus","af_resolve","af_physical_edge","af_flame","af_frost","af_lightning","af_holy","af_dark","af_poison","af_prismatic","af_high_spirit","af_executioner","af_last_stand","af_frontline_wall","af_backline_focus","af_marked_prey","af_bleed_edge","af_bulwark","af_counterweight","af_pursuit","af_searing_edge","af_venom_edge","af_frostbite_edge","af_storm_spark","af_healing_echo","af_guardian_pulse","af_rending_mastery","af_fortress_mastery","af_twinshot_mastery","af_fireball_mastery","af_ice_nova_mastery","af_mend_mastery","af_sweeping_form","af_elemental_recast","af_abyss_twinstrike","af_abyss_soulburn","af_abyss_bloodmoon","af_abyss_permafrost","af_abyss_stormcrown","af_abyss_sanctuary","af_abyss_timefracture","af_abyss_kingbrand"],
  affixTriggers: ["tr_bleed_edge","tr_counterweight","tr_searing_edge","tr_venom_edge","tr_frostbite_edge","tr_storm_spark","tr_healing_echo","tr_guardian_pulse","tr_abyss_twinstrike","tr_abyss_soulburn","tr_abyss_bloodmoon","tr_abyss_permafrost","tr_abyss_stormcrown","tr_abyss_sanctuary","tr_abyss_timefracture"],
  skillAffixes: ["sa_ember_focus","sa_ember_echo","sa_guard_ripple","sa_bleed_doublecut","sa_heal_overflow","sa_frost_spread","sa_swift_charge","sa_storm_chain","sa_execution_focus","sa_fortress_focus","sa_guard_shared_wall","sa_ranger_twin_echo","sa_ranger_marked_chase","sa_ember_detonate_cycle","sa_ember_detonate_focus","sa_frost_nova_focus","sa_frost_zero_echo","sa_priest_mend_focus","sa_priest_sanctuary_echo","sa_universal_focus","sa_abyss_unbound_power","sa_abyss_endless_energy","sa_abyss_shadow_echo","sa_abyss_cascade"],
  combos: ["combo_ember_chain","combo_iron_reprise","combo_blood_hunt","combo_holy_bulwark","combo_venom_bloom","combo_frozen_verdict","combo_storm_circuit","combo_execution_cadence","combo_steadfast_aegis","combo_swift_formation","combo_perfect_strike","combo_dark_covenant","combo_cleansing_light","combo_front_fortress","combo_backline_barrage","combo_triune_elements","combo_ultimate_resonance","combo_abyss_dominion"],
  enemies: ["enemy_grass_slime","enemy_thorn_rat","enemy_fang_wolf","enemy_goblin_scout","enemy_stonehide_boar","enemy_sporeling","enemy_venom_spider","enemy_fungal_guardian","enemy_cave_bat","enemy_ore_golem","enemy_bomb_goblin","enemy_bog_leech","enemy_mist_wraith","enemy_ember_hound","enemy_ash_cultist","enemy_abyss_mauler","enemy_dread_eye","enemy_blood_ghoul","enemy_crimson_acolyte","enemy_frost_warden","enemy_ice_revenant","enemy_void_spark","enemy_watcher_shard","enemy_throne_knight","enemy_abyss_herald","boss_horned_king","boss_brood_spider","boss_iron_devourer","boss_bog_witch","boss_ember_guardian","boss_abyss_butcher","boss_crimson_knight","boss_pale_jailer","boss_thousand_eye","boss_abyss_king"],
  encounters: ["encounter_floor_01_normal_a","encounter_floor_01_normal_b","encounter_floor_01_normal_c","encounter_floor_01_elite_boar","encounter_floor_01_boss","encounter_floor_02_normal_a","encounter_floor_02_normal_b","encounter_floor_02_normal_c","encounter_floor_02_elite_guardian","encounter_floor_02_boss","encounter_floor_03_normal_a","encounter_floor_03_normal_b","encounter_floor_03_normal_c","encounter_floor_03_elite_golem","encounter_floor_03_boss","encounter_floor_04_normal_a","encounter_floor_04_normal_b","encounter_floor_04_normal_c","encounter_floor_04_elite_wraith","encounter_floor_04_boss","encounter_floor_05_normal_a","encounter_floor_05_normal_b","encounter_floor_05_normal_c","encounter_floor_05_elite_cultist","encounter_floor_05_boss","encounter_floor_06_normal_a","encounter_floor_06_normal_b","encounter_floor_06_normal_c","encounter_floor_06_elite_mauler","encounter_floor_06_boss","encounter_floor_07_normal_a","encounter_floor_07_normal_b","encounter_floor_07_normal_c","encounter_floor_07_elite_acolyte","encounter_floor_07_boss","encounter_floor_08_normal_a","encounter_floor_08_normal_b","encounter_floor_08_normal_c","encounter_floor_08_elite_warden","encounter_floor_08_boss","encounter_floor_09_normal_a","encounter_floor_09_normal_b","encounter_floor_09_normal_c","encounter_floor_09_elite_shard","encounter_floor_09_boss","encounter_floor_10_normal_a","encounter_floor_10_normal_b","encounter_floor_10_normal_c","encounter_floor_10_elite_knight","encounter_floor_10_boss"],
  encounterModifiers: ["modifier_assault","modifier_swift","modifier_bulwark","modifier_mire","modifier_abyss_execution","modifier_abyss_fortress","modifier_abyss_pressure","modifier_abyss_suppression"],
  bossIntents: ["intent_horned_charge","intent_brood_venom_web","intent_iron_quake","intent_witch_miasma","intent_ember_eruption","intent_butcher_cleaver","intent_crimson_flurry","intent_jailer_prison","intent_eye_chain","intent_king_annihilation"],
  abyssEchoes: [],
  floors: ["floor_01","floor_02","floor_03","floor_04","floor_05","floor_06","floor_07","floor_08","floor_09","floor_10"],
  maps: ["map_town","map_floor_01","map_floor_02","map_floor_03","map_floor_04","map_floor_05","map_floor_06","map_floor_07","map_floor_08","map_floor_09","map_floor_10"],
  npcs: ["npc_tavern_keeper","npc_blacksmith","npc_skill_mentor","npc_merchant","npc_innkeeper","npc_cartographer","npc_abyss_watcher"],
  dialogues: ["dialogue_tavern_keeper","dialogue_blacksmith","dialogue_skill_mentor","dialogue_merchant","dialogue_innkeeper","dialogue_cartographer","dialogue_abyss_watcher"],
  quests: ["quest_first_elite"],
  recruitments: ["recruit_iron_guard_tavern","recruit_ember_mage_tavern","recruit_priest_first_elite","recruit_ranger_floor_02","recruit_frost_floor_04"],
  shops: ["shop_town_merchant"],
  items: ["item_forge_shard","item_inscription_dust","item_minor_potion","item_major_potion","item_cleansing_tonic"],
  dropTables: ["drop_floor_01_normal","drop_floor_01_elite","drop_floor_01_boss","drop_floor_01_chest","drop_floor_01_first_clear","drop_floor_02_normal","drop_floor_02_elite","drop_floor_02_boss","drop_floor_02_chest","drop_floor_02_first_clear","drop_floor_03_normal","drop_floor_03_elite","drop_floor_03_boss","drop_floor_03_chest","drop_floor_03_first_clear","drop_floor_04_normal","drop_floor_04_elite","drop_floor_04_boss","drop_floor_04_chest","drop_floor_04_first_clear","drop_floor_05_normal","drop_floor_05_elite","drop_floor_05_boss","drop_floor_05_chest","drop_floor_05_first_clear","drop_floor_06_normal","drop_floor_06_elite","drop_floor_06_boss","drop_floor_06_chest","drop_floor_06_first_clear","drop_floor_07_normal","drop_floor_07_elite","drop_floor_07_boss","drop_floor_07_chest","drop_floor_07_first_clear","drop_floor_08_normal","drop_floor_08_elite","drop_floor_08_boss","drop_floor_08_chest","drop_floor_08_first_clear","drop_floor_09_normal","drop_floor_09_elite","drop_floor_09_boss","drop_floor_09_chest","drop_floor_09_first_clear","drop_floor_10_normal","drop_floor_10_elite","drop_floor_10_boss","drop_floor_10_chest","drop_floor_10_first_clear"],
});

// abyssEchoes 是累计终局批次，集合必须与 final manifest 逐集合相等。
const finalContentManifest = freezeManifest({
  ...floors06_10Manifest,
  abyssEchoes: ["echo_f06_iron","echo_f06_hunger","echo_f07_red_tide","echo_f07_blood_oath","echo_f08_white_wall","echo_f08_silent_prison","echo_f09_storm_eye","echo_f09_rewrite","echo_f10_dark_throne","echo_f10_endless_king"],
});
const abyssEchoesManifest = finalContentManifest;

export const FROZEN_BATCH_MANIFESTS: Readonly<Record<BatchId, ContentManifest>> = Object.freeze({
  verticalSlice: verticalSliceManifest,
  floors02_05: floors02_05Manifest,
  floors06_10: floors06_10Manifest,
  abyssEchoes: abyssEchoesManifest,
});

if (JSON.stringify(FROZEN_BATCH_MANIFESTS.abyssEchoes) !== JSON.stringify(finalContentManifest)) {
  throw new Error("abyssEchoes 批次 manifest 必须与 final manifest 相等");
}

function invalid(path: string, issueKey: string): ReturnType<typeof failure> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function byId<T extends Entity>(items: readonly T[]): ReadonlyMapLike<T> {
  const map = new Map(items.map((item) => [item.id, item]));
  return Object.freeze({
    get: (key: string) => map.get(key),
    has: (key: string) => map.has(key),
  });
}

function validateUniqueIds(root: ContentRootV1): { path: string; issueKey: string } | null {
  const global = new Map<string, string>();
  for (const collection of rootCollections) {
    const items = root[collection] as readonly Entity[];
    const local = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (local.has(item.id)) return { path: `${collection}[${index}].id`, issueKey: "duplicate_id" };
      local.add(item.id);
      const previous = global.get(item.id);
      if (previous) return { path: `${collection}[${index}].id`, issueKey: `duplicate_global_id:${previous}` };
      global.set(item.id, collection);
    }
  }
  return null;
}

function validateReferences(root: ContentRootV1): { path: string; issueKey: string } | null {
  const ids = new Set<string>();
  for (const collection of rootCollections) for (const item of root[collection] as readonly Entity[]) ids.add(item.id);
  const requireId = (value: string, path: string): { path: string; issueKey: string } | null => ids.has(value) ? null : { path, issueKey: "missing_reference" };
  for (const [index, character] of root.characters.entries()) {
    for (const [slot, skillId] of [character.basicSkillId, ...character.activeSkillIds, character.ultimateSkillId, character.passiveSkillId].entries()) {
      const issue = requireId(skillId, `characters[${index}].skills[${slot}]`); if (issue) return issue;
    }
  }
  for (const [index, skill] of root.skills.entries()) {
    if (skill.owner.kind === "character") { const issue = requireId(skill.owner.characterId, `skills[${index}].owner.characterId`); if (issue) return issue; }
    if (skill.owner.kind === "enemy") { const issue = requireId(skill.owner.enemyId, `skills[${index}].owner.enemyId`); if (issue) return issue; }
    for (const [level, effects] of skill.effectsByLevel.entries()) for (const [effectIndex, effect] of effects.entries()) {
      const idFields: Array<[string, string]> = [];
      if ("statusId" in effect) idFields.push([effect.statusId, `skills[${index}].effectsByLevel[${level}][${effectIndex}].statusId`]);
      if ("skillId" in effect) idFields.push([effect.skillId, `skills[${index}].effectsByLevel[${level}][${effectIndex}].skillId`]);
      if ("enemyId" in effect) idFields.push([effect.enemyId, `skills[${index}].effectsByLevel[${level}][${effectIndex}].enemyId`]);
      for (const [id, path] of idFields) { const issue = requireId(id, path); if (issue) return issue; }
    }
  }
  for (const [index, enemy] of root.enemies.entries()) {
    for (const skillId of [enemy.basicSkillId, ...enemy.skillIds]) { const issue = requireId(skillId, `enemies[${index}].skillIds`); if (issue) return issue; }
    for (const [ruleIndex, rule] of enemy.aiRules.entries()) { const issue = requireId(rule.skillId, `enemies[${index}].aiRules[${ruleIndex}].skillId`); if (issue) return issue; }
  }
  for (const [index, encounter] of root.encounters.entries()) {
    const issue = requireId(encounter.dropTableId, `encounters[${index}].dropTableId`); if (issue) return issue;
    for (const enemyId of encounter.enemyIdsBySlot) if (enemyId) { const enemyIssue = requireId(enemyId, `encounters[${index}].enemyIdsBySlot`); if (enemyIssue) return enemyIssue; }
    for (const modifierId of encounter.modifierIds) { const modifierIssue = requireId(modifierId, `encounters[${index}].modifierIds`); if (modifierIssue) return modifierIssue; }
  }
  for (const [index, floor] of root.floors.entries()) {
    for (const [value, path] of [[floor.mapId, "mapId"], [floor.bossEncounterId, "bossEncounterId"], [floor.firstClearRewardTableId, "firstClearRewardTableId"]] as const) { const issue = requireId(value, `floors[${index}].${path}`); if (issue) return issue; }
  }
  for (const [index, echo] of root.abyssEchoes.entries()) {
    for (const [value, path] of [[echo.floorId, "floorId"], [echo.bossEncounterId, "bossEncounterId"]] as const) { const issue = requireId(value, `abyssEchoes[${index}].${path}`); if (issue) return issue; }
  }
  for (const [index, npc] of root.npcs.entries()) {
    const issue = requireId(npc.dialogueId, `npcs[${index}].dialogueId`); if (issue) return issue;
  }
  for (const [index, dialogue] of root.dialogues.entries()) for (const [pageIndex, page] of dialogue.pages.entries()) {
    if (page.speakerNpcId) { const issue = requireId(page.speakerNpcId, `dialogues[${index}].pages[${pageIndex}].speakerNpcId`); if (issue) return issue; }
  }
  for (const [index, quest] of root.quests.entries()) {
    const condition = quest.completionCondition;
    if (condition.kind === "encounterCleared") { const issue = requireId(condition.encounterId, `quests[${index}].completionCondition.encounterId`); if (issue) return issue; }
  }
  for (const [index, recruitment] of root.recruitments.entries()) {
    const issue = requireId(recruitment.characterId, `recruitments[${index}].characterId`); if (issue) return issue;
    if (recruitment.condition.kind === "questCompleted") { const questIssue = requireId(recruitment.condition.questId, `recruitments[${index}].condition.questId`); if (questIssue) return questIssue; }
  }
  for (const [index, map] of root.maps.entries()) {
    const layerLength = map.widthTiles * map.heightTiles;
    if (map.groundLayer.length !== layerLength || map.decorBackLayer.length !== layerLength || map.decorFrontLayer.length !== layerLength || map.collisionLayer.length !== layerLength) return { path: `maps[${index}]`, issueKey: "layer_length" };
    const inside = (point: { x: number; y: number }) => point.x >= 0 && point.x < map.widthTiles * 16 && point.y >= 0 && point.y < map.heightTiles * 16;
    if (!inside(map.spawnPoint)) return { path: `maps[${index}].spawnPoint`, issueKey: "out_of_bounds" };
    const objectIds = new Set<string>();
    for (const [objectIndex, object] of map.objects.entries()) {
      if (objectIds.has(object.objectId)) return { path: `maps[${index}].objects[${objectIndex}].objectId`, issueKey: "duplicate_object_id" };
      objectIds.add(object.objectId);
      if (!inside(object.position)) return { path: `maps[${index}].objects[${objectIndex}].position`, issueKey: "out_of_bounds" };
      if (object.kind === "npc") {
        const npcIssue = requireId(object.npcId, `maps[${index}].objects[${objectIndex}].npcId`); if (npcIssue) return npcIssue;
      } else if (object.kind === "encounter") {
        const encounterIssue = requireId(object.encounterId, `maps[${index}].objects[${objectIndex}].encounterId`); if (encounterIssue) return encounterIssue;
        if (object.behavior.mode === "patrol" && (object.behavior.patrolPoints.length !== 2 || object.behavior.wanderRadius !== 0 || object.behavior.patrolPoints[0]?.x === object.behavior.patrolPoints[1]?.x && object.behavior.patrolPoints[0]?.y === object.behavior.patrolPoints[1]?.y)) return { path: `maps[${index}].objects[${objectIndex}].behavior`, issueKey: "patrol_shape" };
        if (object.behavior.mode === "wander" && (object.behavior.patrolPoints.length !== 0 || object.behavior.wanderRadius !== 64)) return { path: `maps[${index}].objects[${objectIndex}].behavior`, issueKey: "wander_shape" };
        if (object.behavior.mode === "stationary" && (object.behavior.patrolPoints.length !== 0 || object.behavior.wanderRadius !== 0)) return { path: `maps[${index}].objects[${objectIndex}].behavior`, issueKey: "stationary_shape" };
        for (const [pointIndex, point] of object.behavior.patrolPoints.entries()) if (!inside(point)) return { path: `maps[${index}].objects[${objectIndex}].behavior.patrolPoints[${pointIndex}]`, issueKey: "out_of_bounds" };
        if (object.behavior.detectionRadius < 0 || object.behavior.leashRadius < 0 || object.behavior.moveSpeed < 0) return { path: `maps[${index}].objects[${objectIndex}].behavior`, issueKey: "negative_behavior_value" };
      } else if (object.kind === "chest") {
        const dropIssue = requireId(object.dropTableId, `maps[${index}].objects[${objectIndex}].dropTableId`); if (dropIssue) return dropIssue;
      }
    }
    if (map.groundLayer.some((tile) => tile < 0) || map.decorBackLayer.some((tile) => tile < 0) || map.decorFrontLayer.some((tile) => tile < 0)) return { path: `maps[${index}]`, issueKey: "negative_tile_index" };
  }
  for (const [index, encounter] of root.encounters.entries()) {
    if (encounter.fieldSpriteId !== `sprite_field_${encounter.id}`) return { path: `encounters[${index}].fieldSpriteId`, issueKey: "field_sprite_derivation" };
    if (encounter.kind === "boss" && (encounter.canRetreat || encounter.modifierIds.length !== 0)) return { path: `encounters[${index}]`, issueKey: "boss_encounter_shape" };
  }
  for (const [index, affix] of root.equipmentAffixes.entries()) {
    for (const [modifierIndex, modifier] of affix.modifiers.entries()) {
      let id: string | null = null;
      if (modifier.kind === "trigger" || modifier.kind === "skillPower" || modifier.kind === "replaceBasicSkill") id = modifier.kind === "trigger" ? modifier.triggerId : modifier.skillId;
      if (id) { const issue = requireId(id, `equipmentAffixes[${index}].modifiers[${modifierIndex}]`); if (issue) return issue; }
      if (modifier.kind === "conditionalDamageBonus" || modifier.kind === "conditionalPercentStat") {
        if ("statusId" in modifier.condition) { const issue = requireId(modifier.condition.statusId, `equipmentAffixes[${index}].modifiers[${modifierIndex}].condition.statusId`); if (issue) return issue; }
      }
    }
  }
  for (const [index, skillAffix] of root.skillAffixes.entries()) {
    if (skillAffix.target.kind === "skill") { const issue = requireId(skillAffix.target.skillId, `skillAffixes[${index}].target.skillId`); if (issue) return issue; }
    if (skillAffix.operation.kind === "addFollowUp" || skillAffix.operation.kind === "statusLink") {
      const skillIssue = requireId(skillAffix.operation.effectSkillId, `skillAffixes[${index}].operation.effectSkillId`); if (skillIssue) return skillIssue;
      if (skillAffix.operation.kind === "statusLink") { const statusIssue = requireId(skillAffix.operation.requiredStatusId, `skillAffixes[${index}].operation.requiredStatusId`); if (statusIssue) return statusIssue; }
    }
  }
  for (const [index, dropTable] of root.dropTables.entries()) for (const [rollIndex, roll] of dropTable.rolls.entries()) {
    if (roll.kind === "stackableItem" || roll.kind === "fixedEquipment") { const issue = requireId(roll.kind === "stackableItem" ? roll.itemId : roll.baseId, `dropTables[${index}].rolls[${rollIndex}]`); if (issue) return issue; }
    if (roll.kind === "stackableItemPool") for (const item of roll.itemPool) { const issue = requireId(item.itemId, `dropTables[${index}].rolls[${rollIndex}].itemPool`); if (issue) return issue; }
    if (roll.kind === "fixedEquipment" && roll.fixedAbyssAffixId) { const issue = requireId(roll.fixedAbyssAffixId, `dropTables[${index}].rolls[${rollIndex}].fixedAbyssAffixId`); if (issue) return issue; }
    if (roll.kind === "equipment") for (const group of roll.equipmentBasePools) for (const base of group.bases) { const issue = requireId(base.baseId, `dropTables[${index}].rolls[${rollIndex}].equipmentBasePools`); if (issue) return issue; }
  }
  if (!ids.has(root.economy.equipmentDisassembleMaterialItemId) || !ids.has(root.economy.skillStoneDisassembleMaterialItemId)) return { path: "economy", issueKey: "missing_material_reference" };
  const typedIssue = validateTypedReferences(root);
  if (typedIssue) return typedIssue;
  return null;
}

function validateTypedReferences(root: ContentRootV1): { path: string; issueKey: string } | null {
  // 使用 reduce 按 rootCollections 逐项填充，避免 Object.fromEntries 丢失集合键关联；22 个集合均在此循环内建立。
  const sets = rootCollections.reduce((result, collection) => {
    result[collection] = new Set((root[collection] as readonly Entity[]).map((item) => item.id));
    return result;
  }, {} as Record<CollectionName, ReadonlySet<string>>);
  const check = (collection: CollectionName, value: string, path: string): { path: string; issueKey: string } | null =>
    sets[collection].has(value) ? null : { path, issueKey: `missing_${collection}_reference` };
  const checkEffect = (effect: import("./contracts").EffectSpec, path: string): { path: string; issueKey: string } | null => {
    if (effect.kind === "applyStatus" || effect.kind === "shield" || effect.kind === "consumeStatus") {
      const issue = check("statuses", effect.statusId, `${path}.statusId`); if (issue) return issue;
    }
    if (effect.kind === "changeCooldown") {
      const issue = check("skills", effect.skillId, `${path}.skillId`); if (issue) return issue;
    }
    if (effect.kind === "summon") {
      const issue = check("enemies", effect.enemyId, `${path}.enemyId`); if (issue) return issue;
    }
    if (effect.kind === "damage") {
      for (const [index, multiplier] of effect.conditionalMultipliers.entries()) {
        const condition = multiplier.condition;
        if ("statusId" in condition) {
          const issue = check("statuses", condition.statusId, `${path}.conditionalMultipliers[${index}].condition.statusId`); if (issue) return issue;
        }
      }
    }
    return null;
  };
  const checkTrigger = (trigger: import("./contracts").TriggerSpec, path: string): { path: string; issueKey: string } | null => {
    for (const [index, statusId] of trigger.requiredSourceStatusIds.entries()) {
      const issue = check("statuses", statusId, `${path}.requiredSourceStatusIds[${index}]`); if (issue) return issue;
    }
    for (const [index, statusId] of trigger.requiredTargetStatusIds.entries()) {
      const issue = check("statuses", statusId, `${path}.requiredTargetStatusIds[${index}]`); if (issue) return issue;
    }
    if (trigger.consumeTargetStatus) {
      const issue = check("statuses", trigger.consumeTargetStatus.statusId, `${path}.consumeTargetStatus.statusId`); if (issue) return issue;
    }
    return null;
  };

  const protagonistIssue = check("characters", root.protagonistCharacterId, "protagonistCharacterId");
  if (protagonistIssue) return protagonistIssue;
  for (const [index, character] of root.characters.entries()) {
    for (const [slot, skillId] of [character.basicSkillId, ...character.activeSkillIds, character.ultimateSkillId, character.passiveSkillId].entries()) {
      const issue = check("skills", skillId, `characters[${index}].skills[${slot}]`); if (issue) return issue;
    }
  }
  for (const [index, skill] of root.skills.entries()) {
    if (skill.owner.kind === "character") {
      const issue = check("characters", skill.owner.characterId, `skills[${index}].owner.characterId`); if (issue) return issue;
    }
    if (skill.owner.kind === "enemy") {
      const issue = check("enemies", skill.owner.enemyId, `skills[${index}].owner.enemyId`); if (issue) return issue;
    }
    for (const [level, effects] of skill.effectsByLevel.entries()) for (const [effectIndex, effect] of effects.entries()) {
      const issue = checkEffect(effect, `skills[${index}].effectsByLevel[${level}][${effectIndex}]`); if (issue) return issue;
    }
  }
  for (const [index, affix] of root.equipmentAffixes.entries()) {
    for (const [modifierIndex, modifier] of affix.modifiers.entries()) {
      if (modifier.kind === "trigger") {
        const issue = check("affixTriggers", modifier.triggerId, `equipmentAffixes[${index}].modifiers[${modifierIndex}].triggerId`); if (issue) return issue;
      }
      if (modifier.kind === "skillPower" || modifier.kind === "replaceBasicSkill") {
        const issue = check("skills", modifier.skillId, `equipmentAffixes[${index}].modifiers[${modifierIndex}].skillId`); if (issue) return issue;
      }
      if (modifier.kind === "conditionalDamageBonus" || modifier.kind === "conditionalPercentStat") {
        if ("statusId" in modifier.condition) {
          const issue = check("statuses", modifier.condition.statusId, `equipmentAffixes[${index}].modifiers[${modifierIndex}].condition.statusId`); if (issue) return issue;
        }
      }
    }
  }
  for (const [index, trigger] of root.affixTriggers.entries()) {
    const triggerIssue = checkTrigger(trigger.trigger, `affixTriggers[${index}].trigger`); if (triggerIssue) return triggerIssue;
    for (const [effectIndex, effect] of trigger.effects.entries()) {
      const issue = checkEffect(effect, `affixTriggers[${index}].effects[${effectIndex}]`); if (issue) return issue;
    }
  }
  for (const [index, skillAffix] of root.skillAffixes.entries()) {
    if (skillAffix.target.kind === "skill") {
      const issue = check("skills", skillAffix.target.skillId, `skillAffixes[${index}].target.skillId`); if (issue) return issue;
    }
    if (skillAffix.operation.kind === "addFollowUp" || skillAffix.operation.kind === "statusLink") {
      const issue = check("skills", skillAffix.operation.effectSkillId, `skillAffixes[${index}].operation.effectSkillId`); if (issue) return issue;
      if (skillAffix.operation.kind === "statusLink") {
        const statusIssue = check("statuses", skillAffix.operation.requiredStatusId, `skillAffixes[${index}].operation.requiredStatusId`); if (statusIssue) return statusIssue;
      }
    }
  }
  for (const [index, combo] of root.combos.entries()) {
    const triggerIssue = checkTrigger(combo.trigger, `combos[${index}].trigger`); if (triggerIssue) return triggerIssue;
    for (const [effectIndex, effect] of combo.effects.entries()) {
      const issue = checkEffect(effect, `combos[${index}].effects[${effectIndex}]`); if (issue) return issue;
    }
  }
  for (const [index, enemy] of root.enemies.entries()) {
    const skillIds = [enemy.basicSkillId, ...enemy.skillIds];
    for (const [skillIndex, skillId] of skillIds.entries()) {
      const issue = check("skills", skillId, `enemies[${index}].skills[${skillIndex}]`); if (issue) return issue;
    }
    if (new Set(enemy.skillIds).has(enemy.basicSkillId)) return { path: `enemies[${index}].skillIds`, issueKey: "basic_skill_repeated" };
    for (const [ruleIndex, rule] of enemy.aiRules.entries()) {
      const issue = check("skills", rule.skillId, `enemies[${index}].aiRules[${ruleIndex}].skillId`); if (issue) return issue;
    }
  }
  for (const [index, bossIntent] of root.bossIntents.entries()) {
    const bossIssue = check("enemies", bossIntent.bossId, `bossIntents[${index}].bossId`); if (bossIssue) return bossIssue;
    const skillIssue = check("skills", bossIntent.skillId, `bossIntents[${index}].skillId`); if (skillIssue) return skillIssue;
    const boss = root.enemies.find((enemy) => enemy.id === bossIntent.bossId);
    if (boss && ![boss.basicSkillId, ...boss.skillIds].includes(bossIntent.skillId)) return { path: `bossIntents[${index}].skillId`, issueKey: "boss_skill_not_declared" };
  }
  for (const [index, encounter] of root.encounters.entries()) {
    let issue = check("dropTables", encounter.dropTableId, `encounters[${index}].dropTableId`); if (issue) return issue;
    for (const [slot, enemyId] of encounter.enemyIdsBySlot.entries()) if (enemyId) { issue = check("enemies", enemyId, `encounters[${index}].enemyIdsBySlot[${slot}]`); if (issue) return issue; }
    for (const [modifierIndex, modifierId] of encounter.modifierIds.entries()) { issue = check("encounterModifiers", modifierId, `encounters[${index}].modifierIds[${modifierIndex}]`); if (issue) return issue; }
  }
  const sortedFloors = [...root.floors].sort((left, right) => left.floorNumber - right.floorNumber);
  for (const [index, floor] of sortedFloors.entries()) {
    if (floor.floorNumber !== index + 1) return { path: "floors", issueKey: "floor_number_not_contiguous" };
    if (floor.maxItemLevel < floor.minItemLevel || floor.recommendedItemLevel < floor.minItemLevel || floor.recommendedItemLevel > floor.maxItemLevel) return { path: `floors[${index}]`, issueKey: "floor_item_level_gate" };
    let issue = check("maps", floor.mapId, `floors[${index}].mapId`); if (issue) return issue;
    issue = check("encounters", floor.bossEncounterId, `floors[${index}].bossEncounterId`); if (issue) return issue;
    issue = check("dropTables", floor.firstClearRewardTableId, `floors[${index}].firstClearRewardTableId`); if (issue) return issue;
    const map = root.maps.find((candidate) => candidate.id === floor.mapId);
    if (map && floor.shortRouteObjectIds.some((objectId) => !map.objects.some((object) => object.objectId === objectId))) return { path: `floors[${index}].shortRouteObjectIds`, issueKey: "unknown_short_route_object" };
  }
  for (const [index, echo] of root.abyssEchoes.entries()) {
    let issue = check("floors", echo.floorId, `abyssEchoes[${index}].floorId`); if (issue) return issue;
    issue = check("encounters", echo.bossEncounterId, `abyssEchoes[${index}].bossEncounterId`); if (issue) return issue;
    const floor = root.floors.find((candidate) => candidate.id === echo.floorId);
    if (floor && (!floor.isAbyss || floor.floorNumber < 6 || floor.floorNumber > 10 || floor.bossEncounterId !== echo.bossEncounterId)) return { path: `abyssEchoes[${index}]`, issueKey: "echo_floor_boss_mismatch" };
  }
  const conditionIssue = (condition: import("./contracts").UnlockCondition, path: string): { path: string; issueKey: string } | null => {
    if (condition.kind === "encounterCleared") return check("encounters", condition.encounterId, `${path}.encounterId`);
    if (condition.kind === "floorCleared" && (condition.floorNumber < 1 || condition.floorNumber > 10)) return { path: `${path}.floorNumber`, issueKey: "floor_gate_out_of_range" };
    return null;
  };
  for (const [index, npc] of root.npcs.entries()) {
    let issue = check("dialogues", npc.dialogueId, `npcs[${index}].dialogueId`); if (issue) return issue;
    issue = conditionIssue(npc.unlockCondition, `npcs[${index}].unlockCondition`); if (issue) return issue;
  }
  for (const [index, dialogue] of root.dialogues.entries()) for (const [pageIndex, page] of dialogue.pages.entries()) {
    if (page.speakerNpcId) { const issue = check("npcs", page.speakerNpcId, `dialogues[${index}].pages[${pageIndex}].speakerNpcId`); if (issue) return issue; }
  }
  for (const [index, quest] of root.quests.entries()) {
    let issue = conditionIssue(quest.unlockCondition, `quests[${index}].unlockCondition`); if (issue) return issue;
    issue = conditionIssue(quest.completionCondition, `quests[${index}].completionCondition`); if (issue) return issue;
  }
  for (const [index, recruitment] of root.recruitments.entries()) {
    let issue = check("characters", recruitment.characterId, `recruitments[${index}].characterId`); if (issue) return issue;
    if (recruitment.condition.kind === "questCompleted") { issue = check("quests", recruitment.condition.questId, `recruitments[${index}].condition.questId`); if (issue) return issue; }
    if (recruitment.condition.kind === "firstClear" && (recruitment.condition.floorNumber < 1 || recruitment.condition.floorNumber > 10)) return { path: `recruitments[${index}].condition.floorNumber`, issueKey: "floor_gate_out_of_range" };
  }
  for (const [index, shop] of root.shops.entries()) {
    let issue = check("npcs", shop.npcId, `shops[${index}].npcId`); if (issue) return issue;
    const npc = root.npcs.find((candidate) => candidate.id === shop.npcId);
    if (npc && npc.function !== "merchant") return { path: `shops[${index}].npcId`, issueKey: "shop_npc_not_merchant" };
    let previous = 0;
    for (const [tierIndex, tier] of shop.tiers.entries()) {
      if ((tierIndex === 0 && tier.minHighestUnlockedFloor !== 1) || tier.minHighestUnlockedFloor <= previous) return { path: `shops[${index}].tiers[${tierIndex}].minHighestUnlockedFloor`, issueKey: "shop_tier_order" };
      previous = tier.minHighestUnlockedFloor;
      if (tier.itemLevelMax < tier.itemLevelMin) return { path: `shops[${index}].tiers[${tierIndex}]`, issueKey: "shop_item_level_range" };
      for (const [itemIndex, item] of tier.stackableItems.entries()) { issue = check("items", item.itemId, `shops[${index}].tiers[${tierIndex}].stackableItems[${itemIndex}].itemId`); if (issue) return issue; if (item.quantityMax < item.quantityMin) return { path: `shops[${index}].tiers[${tierIndex}].stackableItems[${itemIndex}]`, issueKey: "quantity_range" }; }
      issue = validateBasePools(tier.equipmentBasePools, `shops[${index}].tiers[${tierIndex}].equipmentBasePools`, root.equipmentBases, tier.itemLevelMin, tier.itemLevelMax); if (issue) return issue;
      if (tier.offerKindWeights.stackableItem + tier.offerKindWeights.equipment + tier.offerKindWeights.skillStone <= 0) return { path: `shops[${index}].tiers[${tierIndex}].offerKindWeights`, issueKey: "empty_weight_group" };
      if (tier.offerKindWeights.stackableItem > 0 && tier.stackableItems.reduce((sum, item) => sum + item.weight, 0) <= 0) return { path: `shops[${index}].tiers[${tierIndex}].stackableItems`, issueKey: "empty_weight_group" };
      if (tier.offerKindWeights.equipment > 0) { issue = validateQualityWeights(tier.equipmentQualityWeights, `shops[${index}].tiers[${tierIndex}].equipmentQualityWeights`); if (issue) return issue; }
      if (tier.offerKindWeights.skillStone > 0) { issue = validateQualityWeights(tier.skillStoneQualityWeights, `shops[${index}].tiers[${tierIndex}].skillStoneQualityWeights`); if (issue) return issue; }
    }
  }
  for (const [index, item] of root.items.entries()) if (item.category === "consumable") for (const [effectIndex, effect] of item.effects.entries()) {
    const issue = checkEffect(effect, `items[${index}].effects[${effectIndex}]`); if (issue) return issue;
  }
  for (const [index, dropTable] of root.dropTables.entries()) for (const [rollIndex, roll] of dropTable.rolls.entries()) {
    if (roll.kind === "stackableItem") { const issue = check("items", roll.itemId, `dropTables[${index}].rolls[${rollIndex}].itemId`); if (issue) return issue; }
    if (roll.kind === "stackableItemPool") {
      for (const [poolIndex, entry] of roll.itemPool.entries()) { const issue = check("items", entry.itemId, `dropTables[${index}].rolls[${rollIndex}].itemPool[${poolIndex}].itemId`); if (issue) return issue; }
    }
    if (roll.kind === "fixedEquipment") {
      let issue = check("equipmentBases", roll.baseId, `dropTables[${index}].rolls[${rollIndex}].baseId`); if (issue) return issue;
      if (roll.fixedAbyssAffixId) { issue = check("equipmentAffixes", roll.fixedAbyssAffixId, `dropTables[${index}].rolls[${rollIndex}].fixedAbyssAffixId`); if (issue) return issue; }
      const base = root.equipmentBases.find((candidate) => candidate.id === roll.baseId);
      if (base && (roll.itemLevel < base.minItemLevel || roll.itemLevel > base.maxItemLevel)) return { path: `dropTables[${index}].rolls[${rollIndex}].itemLevel`, issueKey: "base_item_level_mismatch" };
      const abyssAffix = roll.fixedAbyssAffixId ? root.equipmentAffixes.find((candidate) => candidate.id === roll.fixedAbyssAffixId) : null;
      if ((roll.quality === "abyss") !== Boolean(abyssAffix) || abyssAffix && (abyssAffix.pool !== "abyss" || !abyssAffix.allowedQualities.includes("abyss") || abyssAffix.minItemLevel > roll.itemLevel)) return { path: `dropTables[${index}].rolls[${rollIndex}].fixedAbyssAffixId`, issueKey: "fixed_abyss_affix_mismatch" };
    }
    if (roll.kind === "equipment") {
      if (roll.itemLevelMax < roll.itemLevelMin) return { path: `dropTables[${index}].rolls[${rollIndex}]`, issueKey: "item_level_range" };
      let issue = validateBasePools(roll.equipmentBasePools, `dropTables[${index}].rolls[${rollIndex}].equipmentBasePools`, root.equipmentBases, roll.itemLevelMin, roll.itemLevelMax); if (issue) return issue;
      issue = validateQualityWeights(roll.qualityWeights, `dropTables[${index}].rolls[${rollIndex}].qualityWeights`); if (issue) return issue;
      if (roll.abyssUpgradeChanceBps > 0 && roll.qualityWeights.some((entry) => entry.quality === "abyss" && entry.weight > 0)) return { path: `dropTables[${index}].rolls[${rollIndex}].qualityWeights`, issueKey: "duplicate_abyss_path" };
    }
    if (roll.kind === "skillStone") {
      if (roll.itemLevelMax < roll.itemLevelMin) return { path: `dropTables[${index}].rolls[${rollIndex}]`, issueKey: "item_level_range" };
      const issue = validateQualityWeights(roll.qualityWeights, `dropTables[${index}].rolls[${rollIndex}].qualityWeights`); if (issue) return issue;
    }
    if (roll.kind !== "stackableItemPool" && "quantityMax" in roll && roll.quantityMax < roll.quantityMin) return { path: `dropTables[${index}].rolls[${rollIndex}]`, issueKey: "quantity_range" };
  }
  const economyItems = [root.economy.equipmentDisassembleMaterialItemId, root.economy.skillStoneDisassembleMaterialItemId];
  for (const itemId of economyItems) { const issue = check("items", itemId, "economy.materialItemId"); if (issue) return issue; }
  const poolIssue = validateAffixPools(root); if (poolIssue) return poolIssue;
  const recruitCounts = new Map<string, number>();
  for (const recruitment of root.recruitments) recruitCounts.set(recruitment.characterId, (recruitCounts.get(recruitment.characterId) ?? 0) + 1);
  const expectedRecruitIds = new Set(root.characters.filter((character) => character.id !== root.protagonistCharacterId).map((character) => character.id));
  if (recruitCounts.has(root.protagonistCharacterId) || recruitCounts.size !== expectedRecruitIds.size) return { path: "recruitments", issueKey: "recruitment_character_set" };
  for (const characterId of expectedRecruitIds) if (recruitCounts.get(characterId) !== 1) return { path: `recruitments.${characterId}`, issueKey: "recruitment_count" };
  return null;
}

function validateQualityWeights(groups: readonly { quality: string; weight: number }[], path: string): { path: string; issueKey: string } | null {
  if (groups.length === 0 || groups.reduce((sum, entry) => sum + entry.weight, 0) <= 0) return { path, issueKey: "empty_weight_group" };
  if (new Set(groups.map((entry) => entry.quality)).size !== groups.length) return { path, issueKey: "duplicate_quality" };
  return null;
}

function validateBasePools(groups: readonly import("./contracts").EquipmentBasePoolGroupV1[], path: string, bases: readonly EquipmentBaseDefinition[], itemLevelMin: number, itemLevelMax: number): { path: string; issueKey: string } | null {
  const expectedSlots = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"] as const;
  if (groups.length !== expectedSlots.length || itemLevelMax < itemLevelMin) return { path, issueKey: "base_pool_shape" };
  const byBaseId = new Map(bases.map((base) => [base.id, base]));
  for (const [groupIndex, group] of groups.entries()) {
    if (group.slot !== expectedSlots[groupIndex] || group.weight !== 100 || group.bases.length < 1 || new Set(group.bases.map((entry) => entry.baseId)).size !== group.bases.length) return { path: `${path}[${groupIndex}]`, issueKey: "base_pool_shape" };
    for (const [baseIndex, entry] of group.bases.entries()) {
      const base = byBaseId.get(entry.baseId);
      if (!base) return { path: `${path}[${groupIndex}].bases[${baseIndex}].baseId`, issueKey: "missing_equipmentBases_reference" };
      if (entry.weight !== 100 || base.slot !== group.slot) return { path: `${path}[${groupIndex}].bases[${baseIndex}]`, issueKey: "base_pool_slot_or_weight" };
    }
    for (let itemLevel = itemLevelMin; itemLevel <= itemLevelMax; itemLevel += 1) {
      if (!group.bases.some((entry) => { const base = byBaseId.get(entry.baseId); return base && itemLevel >= base.minItemLevel && itemLevel <= base.maxItemLevel; })) return { path: `${path}[${groupIndex}]`, issueKey: `base_pool_empty_at_level:${itemLevel}` };
    }
  }
  return null;
}

function validateAffixPools(root: ContentRootV1): { path: string; issueKey: string } | null {
  for (const [index, affix] of root.equipmentAffixes.entries()) {
    if (affix.weight <= 0 || new Set(affix.allowedQualities).size !== affix.allowedQualities.length || affix.allowedQualities.includes("common")) return { path: `equipmentAffixes[${index}]`, issueKey: "illegal_affix_pool" };
    if (!affix.allowedSlots.includes("weapon") && affix.allowedWeaponTypes.length > 0) return { path: `equipmentAffixes[${index}].allowedWeaponTypes`, issueKey: "weapon_filter_without_weapon_slot" };
    if (affix.pool === "abyss" && (affix.minItemLevel < 26 || affix.canBeCraftEmpowered || affix.allowedQualities.length !== 1 || affix.allowedQualities[0] !== "abyss")) return { path: `equipmentAffixes[${index}]`, issueKey: "illegal_abyss_affix_pool" };
    if (affix.pool === "normal" && (affix.category === "trigger" || affix.category === "skillAmp" || affix.category === "mechanic") && affix.canBeCraftEmpowered) return { path: `equipmentAffixes[${index}].canBeCraftEmpowered`, issueKey: "illegal_craft_empowerment" };
  }
  for (const [index, affix] of root.skillAffixes.entries()) {
    if (affix.weight <= 0 || new Set(affix.allowedQualities).size !== affix.allowedQualities.length) return { path: `skillAffixes[${index}]`, issueKey: "illegal_affix_pool" };
    if (affix.pool === "abyss" && (affix.minItemLevel < 26 || affix.allowedQualities.length !== 1 || affix.allowedQualities[0] !== "abyss")) return { path: `skillAffixes[${index}]`, issueKey: "illegal_abyss_affix_pool" };
  }
  const equipmentMatches = (affix: EquipmentAffixDefinition, base: EquipmentBaseDefinition, quality: import("./contracts").EquipmentQuality, itemLevel: number, pool: "normal" | "abyss") => affix.pool === pool
    && affix.minItemLevel <= itemLevel
    && affix.allowedQualities.includes(quality)
    && affix.allowedSlots.includes(base.slot)
    && (base.slot !== "weapon" || base.weaponType !== null && (affix.allowedWeaponTypes.length === 0 || affix.allowedWeaponTypes.includes(base.weaponType)));
  const characterSkillIds = (character: CharacterDefinition) => [character.basicSkillId, ...character.activeSkillIds, character.ultimateSkillId, character.passiveSkillId];
  const skillTargetMatches = (affix: SkillAffixDefinition, character: CharacterDefinition) => {
    if (affix.target.kind === "allSkills") return true;
    const ids = characterSkillIds(character);
    if (affix.target.kind === "skill") return ids.includes(affix.target.skillId);
    const familyId = affix.target.familyId;
    return root.skills.some((skill) => ids.includes(skill.id) && skill.familyIds.includes(familyId));
  };
  const skillMatches = (affix: SkillAffixDefinition, character: CharacterDefinition, quality: import("./contracts").SkillStoneQuality, itemLevel: number, pool: "normal" | "abyss") => affix.pool === pool
    && affix.minItemLevel <= itemLevel
    && affix.allowedQualities.includes(quality)
    && skillTargetMatches(affix, character);
  const maxConflictFreeCount = (affixes: readonly { exclusiveGroup: string | null }[]) => affixes.filter((affix) => affix.exclusiveGroup === null).length
    + new Set(affixes.flatMap((affix) => affix.exclusiveGroup === null ? [] : [affix.exclusiveGroup])).size;
  const equipmentAffixCount = { common: 0, magic: 2, rare: 3, epic: 4, abyss: 4 } as const;
  const skillAffixCount = { magic: 1, rare: 2, epic: 3, abyss: 3 } as const;
  const checkEquipmentQualities = (qualities: readonly import("./contracts").EquipmentQuality[], min: number, max: number, pools: readonly import("./contracts").EquipmentBasePoolGroupV1[], path: string) => {
    const baseById = new Map(root.equipmentBases.map((base) => [base.id, base]));
    for (const quality of qualities) for (let level = min; level <= max; level += 1) for (const group of pools) for (const entry of group.bases) {
      const base = baseById.get(entry.baseId);
      if (!base || level < base.minItemLevel || level > base.maxItemLevel) continue;
      const normalCandidates = root.equipmentAffixes.filter((affix) => equipmentMatches(affix, base, quality, level, "normal"));
      if (maxConflictFreeCount(normalCandidates) < equipmentAffixCount[quality]) return { path, issueKey: `normal_equipment_affix_pool_insufficient:${base.id}:${quality}:${level}` };
      if (quality === "abyss" && maxConflictFreeCount(root.equipmentAffixes.filter((affix) => equipmentMatches(affix, base, quality, level, "abyss"))) < 1) return { path, issueKey: `abyss_equipment_affix_pool_empty:${base.id}:${level}` };
    }
    return null;
  };
  const checkSkillQualities = (qualities: readonly import("./contracts").SkillStoneQuality[], min: number, max: number, path: string) => {
    for (const quality of qualities) for (let level = min; level <= max; level += 1) for (const character of root.characters) {
      const normalCandidates = root.skillAffixes.filter((affix) => skillMatches(affix, character, quality, level, "normal"));
      if (maxConflictFreeCount(normalCandidates) < skillAffixCount[quality]) return { path, issueKey: `normal_skill_affix_pool_insufficient:${character.id}:${quality}:${level}` };
      if (quality === "abyss" && maxConflictFreeCount(root.skillAffixes.filter((affix) => skillMatches(affix, character, quality, level, "abyss"))) < 1) return { path, issueKey: `abyss_skill_affix_pool_empty:${character.id}:${level}` };
    }
    return null;
  };
  const equipmentOrder: readonly import("./contracts").EquipmentQuality[] = ["common", "magic", "rare", "epic", "abyss"];
  const skillOrder: readonly import("./contracts").SkillStoneQuality[] = ["magic", "rare", "epic", "abyss"];
  const reachableQualities = <Quality extends string>(weights: readonly { quality: Quality; weight: number }[], order: readonly Quality[], guaranteed: Quality | null): Quality[] => {
    const minimum = guaranteed === null ? 0 : order.indexOf(guaranteed);
    return weights.filter((entry) => entry.weight > 0 && order.indexOf(entry.quality) >= minimum).map((entry) => entry.quality);
  };
  for (const [shopIndex, shop] of root.shops.entries()) for (const [tierIndex, tier] of shop.tiers.entries()) {
    let issue = tier.offerKindWeights.equipment > 0 ? checkEquipmentQualities(reachableQualities(tier.equipmentQualityWeights, equipmentOrder, null), tier.itemLevelMin, tier.itemLevelMax, tier.equipmentBasePools, `shops[${shopIndex}].tiers[${tierIndex}].equipmentQualityWeights`) : null; if (issue) return issue;
    issue = tier.offerKindWeights.skillStone > 0 ? checkSkillQualities(reachableQualities(tier.skillStoneQualityWeights, skillOrder, null), tier.itemLevelMin, tier.itemLevelMax, `shops[${shopIndex}].tiers[${tierIndex}].skillStoneQualityWeights`) : null; if (issue) return issue;
  }
  for (const [tableIndex, table] of root.dropTables.entries()) for (const [rollIndex, roll] of table.rolls.entries()) {
    if (roll.kind === "equipment") {
      const weightedQualities = roll.abyssUpgradeChanceBps < 10_000 ? reachableQualities(roll.qualityWeights, equipmentOrder, roll.guaranteedMinQuality) : [];
      if (roll.abyssUpgradeChanceBps < 10_000 && weightedQualities.length === 0) return { path: `dropTables[${tableIndex}].rolls[${rollIndex}].qualityWeights`, issueKey: "guaranteed_quality_pool_empty" };
      const qualities = roll.abyssUpgradeChanceBps > 0 ? [...new Set([...weightedQualities, "abyss" as const])] : weightedQualities;
      const issue = checkEquipmentQualities(qualities, roll.itemLevelMin, roll.itemLevelMax, roll.equipmentBasePools, `dropTables[${tableIndex}].rolls[${rollIndex}].qualityWeights`); if (issue) return issue;
    }
    if (roll.kind === "skillStone") {
      const qualities = reachableQualities(roll.qualityWeights, skillOrder, roll.guaranteedMinQuality);
      if (qualities.length === 0) return { path: `dropTables[${tableIndex}].rolls[${rollIndex}].qualityWeights`, issueKey: "guaranteed_quality_pool_empty" };
      const issue = checkSkillQualities(qualities, roll.itemLevelMin, roll.itemLevelMax, `dropTables[${tableIndex}].rolls[${rollIndex}].qualityWeights`); if (issue) return issue;
    }
    if (roll.kind === "fixedEquipment" && roll.quality !== "common") {
      const base = root.equipmentBases.find((candidate) => candidate.id === roll.baseId);
      const normalCandidates = base ? root.equipmentAffixes.filter((affix) => equipmentMatches(affix, base, roll.quality, roll.itemLevel, "normal")) : [];
      if (maxConflictFreeCount(normalCandidates) < equipmentAffixCount[roll.quality]) return { path: `dropTables[${tableIndex}].rolls[${rollIndex}]`, issueKey: "fixed_normal_affix_pool_insufficient" };
      const empoweredRequired = roll.craftGrade === "exalted" || roll.craftGrade === "weighted" && root.economy.craftGradeWeights.exalted > 0 ? 2 : roll.craftGrade === "tempered" || roll.craftGrade === "weighted" && root.economy.craftGradeWeights.tempered > 0 ? 1 : 0;
      if (maxConflictFreeCount(normalCandidates.filter((affix) => affix.canBeCraftEmpowered)) < empoweredRequired) return { path: `dropTables[${tableIndex}].rolls[${rollIndex}].craftGrade`, issueKey: "fixed_craft_pool_insufficient" };
      if (base && roll.fixedAbyssAffixId) {
        const fixed = root.equipmentAffixes.find((affix) => affix.id === roll.fixedAbyssAffixId);
        if (!fixed || !equipmentMatches(fixed, base, "abyss", roll.itemLevel, "abyss")) return { path: `dropTables[${tableIndex}].rolls[${rollIndex}].fixedAbyssAffixId`, issueKey: "fixed_abyss_affix_incompatible" };
      }
    }
  }
  return null;
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

type CollectionEntityByName = {
  characters: CharacterDefinition;
  skills: SkillDefinition;
  statuses: StatusDefinition;
  equipmentBases: EquipmentBaseDefinition;
  equipmentAffixes: EquipmentAffixDefinition;
  affixTriggers: AffixTriggerDefinition;
  skillAffixes: SkillAffixDefinition;
  combos: ComboDefinition;
  enemies: EnemyDefinition;
  encounters: EncounterDefinition;
  encounterModifiers: EncounterModifierDefinition;
  bossIntents: BossIntentDefinition;
  abyssEchoes: AbyssEchoDefinition;
  floors: FloorDefinition;
  maps: MapDefinition;
  npcs: NpcDefinition;
  dialogues: DialogueDefinition;
  quests: QuestDefinition;
  recruitments: RecruitmentDefinition;
  shops: ShopDefinition;
  items: StackableItemDefinition;
  dropTables: DropTableDefinition;
};

type CatalogIndexes = { readonly [Key in CollectionName]: ReadonlyMapLike<DeepReadonly<CollectionEntityByName[Key]>> };

/** 按每个 root 集合分别比较累计批次的精确 ID 集合，不使用全局 contains 兜底。 */
export function validateBatchManifest(root: unknown, batchId: BatchId): { path: string; issueKey: string } | null {
  const expected = FROZEN_BATCH_MANIFESTS[batchId];
  if (!expected) return { path: `batch.${batchId}`, issueKey: "unknown_batch" };
  const source = root as Partial<Record<CollectionName, readonly Entity[]>>;
  for (const collection of rootCollections) {
    const actual = (source[collection] ?? []).map((item) => item.id);
    const expectedIds = expected[collection];
    const actualSet = new Set(actual);
    const expectedSet = new Set(expectedIds);
    if (actual.length !== actualSet.size) return { path: `batch.${batchId}.${collection}`, issueKey: "duplicate_id" };
    for (const id of expectedIds) if (!actualSet.has(id)) return { path: `batch.${batchId}.${collection}`, issueKey: `missing_id:${id}` };
    for (const id of actual) if (!expectedSet.has(id)) return { path: `batch.${batchId}.${collection}`, issueKey: `unexpected_id:${id}` };
    if (actual.length !== expectedIds.length || actualSet.size !== expectedSet.size) return { path: `batch.${batchId}.${collection}`, issueKey: "manifest_size_mismatch" };
  }
  return null;
}

function validateCounts(root: ContentRootV1, mode: ValidationMode): { path: string; issueKey: string } | null {
  if (mode === "fixture") return null;
  if (typeof mode !== "string") {
    const batchIssue = validateBatchManifest(root, mode.batchId);
    if (batchIssue) return batchIssue;
    const batchLocale = validateLocale(zhCN);
    if (!batchLocale.ok) return { path: "locale", issueKey: "locale_invalid" };
    return null;
  }
  for (const [collection, expected] of Object.entries(FINAL_CONTENT_COUNTS) as Array<[CollectionName, number]>) {
    if (root[collection].length !== expected) return { path: collection, issueKey: `expected_count_${expected}` };
  }
  const finalPoolCounts = {
    equipmentNormal: root.equipmentAffixes.filter((affix) => affix.pool === "normal").length,
    equipmentAbyss: root.equipmentAffixes.filter((affix) => affix.pool === "abyss").length,
    skillNormal: root.skillAffixes.filter((affix) => affix.pool === "normal").length,
    skillAbyss: root.skillAffixes.filter((affix) => affix.pool === "abyss").length,
  };
  if (finalPoolCounts.equipmentNormal !== 40 || finalPoolCounts.equipmentAbyss !== 8 || finalPoolCounts.skillNormal !== 20 || finalPoolCounts.skillAbyss !== 4) return { path: "affixPools", issueKey: "final_pool_counts" };
  const locale = validateLocale(zhCN);
  if (!locale.ok) return { path: "locale", issueKey: "locale_invalid" };
  if (expectedLocaleKeys.length < 1) return { path: "locale", issueKey: "locale_empty" };
  return null;
}

export class ContentCatalog {
  public readonly mode: ValidationMode;
  private readonly root: DeepReadonly<ContentRootV1>;
  private readonly indexes: CatalogIndexes;

  private constructor(root: ContentRootV1, mode: ValidationMode) {
    this.root = deepFreeze(root) as DeepReadonly<ContentRootV1>;
    this.mode = mode;
    this.indexes = Object.freeze(Object.fromEntries(rootCollections.map((name) => [name, byId(this.root[name] as readonly Entity[])]))) as CatalogIndexes;
  }

  public static create(root: unknown, mode: ValidationMode = "final"): DomainResult<ContentCatalog> {
    const parsed = contentRootSchema.safeParse(root);
    if (!parsed.success) return invalid("root", "schema");
    const uniqueIssue = validateUniqueIds(parsed.data as ContentRootV1);
    if (uniqueIssue) return invalid(uniqueIssue.path, uniqueIssue.issueKey);
    const referenceIssue = validateReferences(parsed.data as ContentRootV1);
    if (referenceIssue) return invalid(referenceIssue.path, referenceIssue.issueKey);
    const countIssue = validateCounts(parsed.data as ContentRootV1, mode);
    if (countIssue) return invalid(countIssue.path, countIssue.issueKey);
    return success(new ContentCatalog(parsed.data as ContentRootV1, mode));
  }

  public getRoot(): DeepReadonly<ContentRootV1> { return this.root; }
  public getCharacter(id: string): DomainResult<DeepReadonly<CharacterDefinition>> { return this.get("characters", id); }
  public getSkill(id: string): DomainResult<DeepReadonly<SkillDefinition>> { return this.get("skills", id); }
  public getStatus(id: string): DomainResult<DeepReadonly<StatusDefinition>> { return this.get("statuses", id); }
  public getEquipmentBase(id: string): DomainResult<DeepReadonly<EquipmentBaseDefinition>> { return this.get("equipmentBases", id); }
  public getEquipmentAffix(id: string): DomainResult<DeepReadonly<EquipmentAffixDefinition>> { return this.get("equipmentAffixes", id); }
  public getAffixTrigger(id: string): DomainResult<DeepReadonly<AffixTriggerDefinition>> { return this.get("affixTriggers", id); }
  public getSkillAffix(id: string): DomainResult<DeepReadonly<SkillAffixDefinition>> { return this.get("skillAffixes", id); }
  public getCombo(id: string): DomainResult<DeepReadonly<ComboDefinition>> { return this.get("combos", id); }
  public getEnemy(id: string): DomainResult<DeepReadonly<EnemyDefinition>> { return this.get("enemies", id); }
  public getEncounter(id: string): DomainResult<DeepReadonly<EncounterDefinition>> { return this.get("encounters", id); }
  public getEncounterModifier(id: string): DomainResult<DeepReadonly<EncounterModifierDefinition>> { return this.get("encounterModifiers", id); }
  public getBossIntent(id: string): DomainResult<DeepReadonly<BossIntentDefinition>> { return this.get("bossIntents", id); }
  public getAbyssEcho(id: string): DomainResult<DeepReadonly<AbyssEchoDefinition>> { return this.get("abyssEchoes", id); }
  public getFloor(id: string): DomainResult<DeepReadonly<FloorDefinition>> { return this.get("floors", id); }
  public getMap(id: string): DomainResult<DeepReadonly<MapDefinition>> { return this.get("maps", id); }
  public getNpc(id: string): DomainResult<DeepReadonly<NpcDefinition>> { return this.get("npcs", id); }
  public getDialogue(id: string): DomainResult<DeepReadonly<DialogueDefinition>> { return this.get("dialogues", id); }
  public getQuest(id: string): DomainResult<DeepReadonly<QuestDefinition>> { return this.get("quests", id); }
  public getRecruitment(id: string): DomainResult<DeepReadonly<RecruitmentDefinition>> { return this.get("recruitments", id); }
  public getShop(id: string): DomainResult<DeepReadonly<ShopDefinition>> { return this.get("shops", id); }
  public getItem(id: string): DomainResult<DeepReadonly<StackableItemDefinition>> { return this.get("items", id); }
  public getDropTable(id: string): DomainResult<DeepReadonly<DropTableDefinition>> { return this.get("dropTables", id); }

  private get<K extends CollectionName>(collection: K, id: string): DomainResult<DeepReadonly<CollectionEntityByName[K]>> {
    const value = this.indexes[collection].get(id);
    return value ? success(value) : invalid(`${collection}.${id}`, "missing_content");
  }
}

type ReadonlyMapLike<T = unknown> = { readonly get: (key: string) => T | undefined; readonly has: (key: string) => boolean };
