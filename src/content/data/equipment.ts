/**
 * RPG-010 垂直切片装备数据。
 *
 * 首版完整 60 底材/48 词条由后续内容批次转录；这里先提供第一层可玩的
 * 六部位底材池和 12 条教学词条，字段已经展开为运行时契约，不保留表格缩写。
 */
import type {
  EquipmentAffixDefinition,
  EquipmentBaseDefinition,
  EquipmentBasePoolGroupV1,
  EquipmentSlot,
  ModifierSpec,
  TagContribution,
} from "../contracts";

function base(
  id: string,
  slot: EquipmentSlot,
  weaponType: EquipmentBaseDefinition["weaponType"],
  baseStat: EquipmentBaseDefinition["baseStat"],
  baseValueAtMinLevel: number,
  growthPerItemLevel: number,
  baseGoldValue: number,
  goldValuePerItemLevel: number,
  minItemLevel = 1,
  maxItemLevel = 5,
): EquipmentBaseDefinition {
  return {
    id,
    nameKey: `equipment.${id}.name`,
    slot,
    weaponType,
    minItemLevel,
    maxItemLevel,
    baseStat,
    baseValueAtMinLevel,
    growthPerItemLevel,
    baseGoldValue,
    goldValuePerItemLevel,
    spriteId: `sprite_${id}`,
  };
}

export const EQUIPMENT_BASE_DEFINITIONS: readonly EquipmentBaseDefinition[] = Object.freeze([
  base("eq_sword_t1_windblade", "weapon", "sword", "attack", 12, 2, 45, 8, 1, 10),
  base("eq_hammer_t1_stonemaul", "weapon", "hammer", "attack", 15, 2, 50, 8, 1, 10),
  base("eq_bow_t1_reed", "weapon", "bow", "attack", 13, 2, 46, 8, 1, 10),
  base("eq_staff_t1_oak", "weapon", "staff", "attack", 14, 2, 48, 8, 1, 10),
  base("eq_focus_t1_frostglass", "weapon", "focus", "attack", 12, 2, 45, 8, 1, 10),
  base("eq_relic_t1_prayer", "weapon", "relic", "attack", 11, 2, 44, 8, 1, 10),
  base("eq_helmet_t1_traveler", "helmet", null, "maxHp", 40, 8, 35, 6),
  base("eq_armor_t1_leather", "armor", null, "defense", 6, 1, 38, 6),
  base("eq_gloves_t1_hide", "gloves", null, "attack", 4, 1, 34, 6),
  base("eq_boots_t1_cloth", "boots", null, "speed", 1, 0, 32, 6),
  base("eq_accessory_t1_charm", "accessory", null, "critRateBps", 100, 20, 40, 6),
  // RPG-024：第 2～5 层底材严格按冻结装等区间展开，不在运行时从 tier 后缀推断。
  base("eq_sword_t2_bloodiron", "weapon", "sword", "attack", 34, 3, 130, 12, 11, 20),
  base("eq_hammer_t2_bastion", "weapon", "hammer", "attack", 40, 3, 145, 12, 11, 20),
  base("eq_bow_t2_hawkeye", "weapon", "bow", "attack", 36, 3, 135, 12, 11, 20),
  base("eq_staff_t2_cinder", "weapon", "staff", "attack", 38, 3, 140, 12, 11, 20),
  base("eq_focus_t2_mist_orb", "weapon", "focus", "attack", 34, 3, 130, 12, 11, 20),
  base("eq_relic_t2_silver_bell", "weapon", "relic", "attack", 32, 3, 128, 12, 11, 20),
  base("eq_helmet_t2_iron", "helmet", null, "maxHp", 85, 10, 70, 8, 6, 10),
  base("eq_armor_t2_chain", "armor", null, "defense", 12, 1, 78, 8, 6, 10),
  base("eq_gloves_t2_rivet", "gloves", null, "attack", 9, 1, 72, 8, 6, 10),
  base("eq_boots_t2_scout", "boots", null, "speed", 2, 0, 68, 8, 6, 10),
  base("eq_accessory_t2_gem", "accessory", null, "critRateBps", 200, 25, 82, 8, 6, 10),
  base("eq_sword_t3_emberedge", "weapon", "sword", "attack", 68, 4, 320, 18, 21, 30),
  base("eq_hammer_t3_magma", "weapon", "hammer", "attack", 76, 4, 350, 18, 21, 30),
  base("eq_bow_t3_bloodstring", "weapon", "bow", "attack", 70, 4, 330, 18, 21, 30),
  base("eq_staff_t3_volcano", "weapon", "staff", "attack", 74, 4, 345, 18, 21, 30),
  base("eq_focus_t3_iceheart", "weapon", "focus", "attack", 68, 4, 320, 18, 21, 30),
  base("eq_relic_t3_sun_shard", "weapon", "relic", "attack", 66, 4, 315, 18, 21, 30),
  base("eq_helmet_t3_ember", "helmet", null, "maxHp", 140, 12, 145, 11, 11, 20),
  base("eq_armor_t3_plate", "armor", null, "defense", 18, 2, 155, 11, 11, 20),
  base("eq_gloves_t3_flame", "gloves", null, "attack", 14, 1, 142, 11, 11, 20),
  base("eq_boots_t3_ash", "boots", null, "speed", 3, 0, 138, 11, 11, 20),
  base("eq_accessory_t3_sigil", "accessory", null, "critRateBps", 350, 30, 165, 11, 11, 20),
  // 第 4～5 层保留 t4 武器底材；累计第 2～5 层批次另登记五个 t4 非武器底材。
  base("eq_sword_t4_voidcutter", "weapon", "sword", "attack", 110, 5, 680, 26, 31, 40),
  base("eq_hammer_t4_jailer", "weapon", "hammer", "attack", 122, 5, 730, 26, 31, 40),
  base("eq_bow_t4_starchaser", "weapon", "bow", "attack", 114, 5, 700, 26, 31, 40),
  base("eq_staff_t4_nightflame", "weapon", "staff", "attack", 120, 5, 720, 26, 31, 40),
  base("eq_focus_t4_thousand_lens", "weapon", "focus", "attack", 112, 5, 690, 26, 31, 40),
  base("eq_relic_t4_pale_grail", "weapon", "relic", "attack", 108, 5, 670, 26, 31, 40),
  // RPG-025：第 6～10 层物化 t5 武器与 t5/t6 防具，逐项按冻结装等区间写入。
  base("eq_sword_t5_kingbreaker", "weapon", "sword", "attack", 165, 6, 1250, 38, 41, 50),
  base("eq_hammer_t5_worldfall", "weapon", "hammer", "attack", 180, 6, 1330, 38, 41, 50),
  base("eq_bow_t5_voidrain", "weapon", "bow", "attack", 170, 6, 1285, 38, 41, 50),
  base("eq_staff_t5_abyss_sun", "weapon", "staff", "attack", 176, 6, 1320, 38, 41, 50),
  base("eq_focus_t5_zero_core", "weapon", "focus", "attack", 168, 6, 1270, 38, 41, 50),
  base("eq_relic_t5_dawn_crown", "weapon", "relic", "attack", 162, 6, 1240, 38, 41, 50),
  base("eq_helmet_t4_abyss", "helmet", null, "maxHp", 280, 16, 330, 16, 21, 30),
  base("eq_armor_t4_abyss", "armor", null, "defense", 38, 3, 350, 16, 21, 30),
  base("eq_gloves_t4_crimson", "gloves", null, "attack", 28, 2, 320, 16, 21, 30),
  base("eq_boots_t4_bloodstep", "boots", null, "speed", 4, 0, 310, 16, 21, 30),
  base("eq_accessory_t4_eye", "accessory", null, "critRateBps", 650, 40, 370, 16, 21, 30),
  base("eq_helmet_t5_pale", "helmet", null, "maxHp", 470, 22, 700, 24, 31, 40),
  base("eq_helmet_t6_king", "helmet", null, "maxHp", 720, 30, 1250, 34, 41, 50),
  base("eq_armor_t5_frost", "armor", null, "defense", 72, 4, 740, 24, 31, 40),
  base("eq_armor_t6_sovereign", "armor", null, "defense", 118, 6, 1320, 34, 41, 50),
  base("eq_gloves_t5_void", "gloves", null, "attack", 48, 3, 680, 24, 31, 40),
  base("eq_gloves_t6_king", "gloves", null, "attack", 75, 4, 1220, 34, 41, 50),
  base("eq_boots_t5_starless", "boots", null, "speed", 5, 0, 660, 24, 31, 40),
  base("eq_boots_t6_throne", "boots", null, "speed", 6, 0, 1180, 34, 41, 50),
  base("eq_accessory_t5_star", "accessory", null, "critRateBps", 1050, 50, 780, 24, 31, 50),
  base("eq_accessory_t6_crown", "accessory", null, "critRateBps", 2500, 0, 2500, 0, 50, 50),
]);

function tiers(profile: readonly (readonly [number, number, number])[]): EquipmentAffixDefinition["tiers"] {
  return profile.map(([minItemLevel, rollMin, rollMax], index) => ({
    tier: (index + 1) as 1 | 2 | 3 | 4 | 5,
    minItemLevel,
    rollMin,
    rollMax,
  }));
}

function affix(
  id: string,
  category: EquipmentAffixDefinition["category"],
  allowedSlots: EquipmentSlot[],
  minItemLevel: number,
  exclusiveGroup: string | null,
  stackRule: EquipmentAffixDefinition["stackRule"],
  weight: number,
  goldValue: number,
  canBeCraftEmpowered: boolean,
  profile: readonly (readonly [number, number, number])[],
  modifiers: ModifierSpec[],
  tags: TagContribution[],
  allowedQualities: EquipmentAffixDefinition["allowedQualities"] = ["magic", "rare", "epic", "abyss"],
  allowedWeaponTypes: EquipmentAffixDefinition["allowedWeaponTypes"] = [],
): EquipmentAffixDefinition {
  return {
    id,
    nameKey: `equipment_affix.${id}.name`,
    descriptionKey: `equipment_affix.${id}.description`,
    category,
    pool: "normal",
    allowedSlots,
    allowedWeaponTypes,
    minItemLevel,
    allowedQualities,
    exclusiveGroup,
    stackRule,
    weight,
    goldValue,
    canBeCraftEmpowered,
    tiers: tiers(profile),
    modifiers,
    tags,
  };
}

function abyssAffix(
  id: string,
  category: EquipmentAffixDefinition["category"],
  allowedSlots: EquipmentSlot[],
  minItemLevel: number,
  exclusiveGroup: string | null,
  stackRule: EquipmentAffixDefinition["stackRule"],
  weight: number,
  goldValue: number,
  profile: readonly (readonly [number, number, number])[],
  modifiers: ModifierSpec[],
  tags: TagContribution[],
): EquipmentAffixDefinition {
  return {
    ...affix(id, category, allowedSlots, minItemLevel, exclusiveGroup, stackRule, weight, goldValue, false, profile, modifiers, tags, ["abyss"]),
    pool: "abyss",
  };
}

const hpFlat = [[1, 25, 40], [11, 55, 75], [21, 90, 120], [31, 135, 175], [41, 190, 240]] as const;
const atkFlat = [[1, 3, 5], [11, 7, 10], [21, 12, 16], [31, 18, 23], [41, 25, 32]] as const;
const defFlat = [[1, 2, 3], [11, 4, 6], [21, 7, 10], [31, 11, 14], [41, 15, 20]] as const;
const speedFlat = [[1, 1, 1], [11, 1, 2], [21, 2, 3], [31, 3, 4], [41, 4, 5]] as const;
const rating = [[1, 200, 350], [11, 400, 600], [21, 650, 900], [31, 950, 1250], [41, 1300, 1700]] as const;
const damage = [[1, 300, 500], [11, 600, 850], [21, 900, 1200], [31, 1250, 1600], [41, 1650, 2100]] as const;
const trigger = [[1, 3000, 4000], [11, 4000, 5000], [21, 5000, 6000], [31, 6000, 7000], [41, 7000, 8000]] as const;

export const EQUIPMENT_AFFIX_DEFINITIONS: readonly EquipmentAffixDefinition[] = Object.freeze([
  affix("af_vitality", "baseStat", ["helmet", "armor", "gloves", "boots", "accessory"], 1, null, "add", 100, 25, true, hpFlat, [{ kind: "flatStat", stat: "maxHp", rollScaleBps: 10_000 }], [{ tagId: "vitality", count: 1 }]),
  affix("af_might", "baseStat", ["weapon", "gloves", "accessory"], 1, null, "add", 100, 25, true, atkFlat, [{ kind: "flatStat", stat: "attack", rollScaleBps: 10_000 }], [{ tagId: "might", count: 1 }]),
  affix("af_guard", "baseStat", ["helmet", "armor", "boots", "accessory"], 1, null, "add", 100, 25, true, defFlat, [{ kind: "flatStat", stat: "defense", rollScaleBps: 10_000 }], [{ tagId: "guard", count: 1 }]),
  affix("af_haste", "baseStat", ["boots", "accessory"], 1, null, "add", 70, 30, true, speedFlat, [{ kind: "flatStat", stat: "speed", rollScaleBps: 10_000 }], [{ tagId: "speed", count: 1 }]),
  affix("af_precision", "baseStat", ["weapon", "gloves", "accessory"], 1, null, "add", 85, 28, true, rating, [{ kind: "flatStat", stat: "critRateBps", rollScaleBps: 10_000 }], [{ tagId: "crit", count: 1 }]),
  affix("af_flame", "damageType", ["weapon", "gloves", "accessory"], 1, null, "add", 85, 32, true, damage, [{ kind: "damageBonus", element: "fire", rollScaleBps: 10_000 }], [{ tagId: "fire", count: 1 }, { tagId: "burn", count: 1 }]),
  affix("af_frost", "damageType", ["weapon", "gloves", "accessory"], 1, null, "add", 85, 32, true, damage, [{ kind: "damageBonus", element: "frost", rollScaleBps: 10_000 }], [{ tagId: "frost", count: 1 }]),
  affix("af_bleed_edge", "trigger", ["weapon"], 1, "basic_ailment", "unique", 55, 42, false, trigger, [{ kind: "trigger", triggerId: "tr_bleed_edge" }], [{ tagId: "bleed", count: 2 }]),
  // 技能增幅词条不能进入锻造强化候选池，避免普通装备的 craftGrade 生成非法强化。
  affix("af_bulwark", "skillAmp", ["helmet", "armor", "accessory"], 1, null, "add", 75, 34, false, damage, [{ kind: "shieldBonus", rollScaleBps: 10_000 }], [{ tagId: "shield", count: 2 }]),
  affix("af_counterweight", "trigger", ["armor", "gloves", "accessory"], 1, "counter_trigger", "unique", 50, 48, false, trigger, [{ kind: "trigger", triggerId: "tr_counterweight" }], [{ tagId: "counter", count: 2 }, { tagId: "shield", count: 1 }], ["rare", "epic", "abyss"]),
  affix("af_pursuit", "conditional", ["weapon", "gloves", "boots"], 1, null, "add", 65, 40, true, damage, [{ kind: "conditionalDamageBonus", condition: { kind: "targetHasStatus", statusId: "status_bleed" }, element: "physical", rollScaleBps: 10_000 }], [{ tagId: "bleed", count: 1 }, { tagId: "chase", count: 2 }]),
  affix("af_searing_edge", "trigger", ["weapon"], 1, "basic_ailment", "unique", 55, 42, false, trigger, [{ kind: "trigger", triggerId: "tr_searing_edge" }], [{ tagId: "burn", count: 2 }, { tagId: "basicAttack", count: 1 }]),
  affix("af_ferocity", "baseStat", ["weapon", "gloves", "accessory"], 1, null, "add", 75, 30, true, rating, [{ kind: "flatStat", stat: "critDamageBps", rollScaleBps: 10_000 }], [{ tagId: "crit", count: 1 }]),
  affix("af_focus", "baseStat", ["helmet", "gloves", "accessory"], 1, null, "add", 80, 28, true, rating, [{ kind: "flatStat", stat: "effectHitBps", rollScaleBps: 10_000 }], [{ tagId: "control", count: 1 }]),
  affix("af_resolve", "baseStat", ["helmet", "armor", "accessory"], 1, null, "add", 80, 28, true, rating, [{ kind: "flatStat", stat: "effectResistBps", rollScaleBps: 10_000 }], [{ tagId: "guard", count: 1 }]),
  affix("af_physical_edge", "damageType", ["weapon", "gloves", "accessory"], 1, null, "add", 85, 32, true, damage, [{ kind: "damageBonus", element: "physical", rollScaleBps: 10_000 }], [{ tagId: "physical", count: 1 }]),
  affix("af_lightning", "damageType", ["weapon", "gloves", "accessory"], 11, null, "add", 75, 36, true, damage, [{ kind: "damageBonus", element: "lightning", rollScaleBps: 10_000 }], [{ tagId: "shock", count: 1 }]),
  affix("af_holy", "damageType", ["weapon", "gloves", "accessory"], 11, null, "add", 75, 36, true, damage, [{ kind: "damageBonus", element: "holy", rollScaleBps: 10_000 }], [{ tagId: "holy", count: 1 }, { tagId: "heal", count: 1 }]),
  affix("af_poison", "damageType", ["weapon", "gloves", "accessory"], 6, null, "add", 80, 34, true, damage, [{ kind: "damageBonus", element: "poison", rollScaleBps: 10_000 }], [{ tagId: "poison", count: 1 }]),
  affix("af_high_spirit", "conditional", ["weapon", "gloves", "accessory"], 1, null, "add", 60, 38, true, damage, [{ kind: "conditionalDamageBonus", condition: { kind: "selfHpAtLeastBps", valueBps: 8000 }, element: "all", rollScaleBps: 10_000 }], [{ tagId: "healthy", count: 1 }]),
  affix("af_executioner", "conditional", ["weapon", "gloves", "accessory"], 11, null, "add", 55, 44, true, damage, [{ kind: "conditionalDamageBonus", condition: { kind: "targetHpAtMostBps", valueBps: 3000 }, element: "all", rollScaleBps: 10_000 }], [{ tagId: "execute", count: 1 }], ["rare", "epic", "abyss"]),
  affix("af_last_stand", "conditional", ["armor", "helmet", "accessory"], 11, null, "add", 55, 44, true, defFlat, [{ kind: "conditionalPercentStat", condition: { kind: "selfHpAtMostBps", valueBps: 4000 }, stat: "defense", rollScaleBps: 10_000 }], [{ tagId: "guard", count: 1 }]),
  affix("af_frontline_wall", "conditional", ["helmet", "armor", "boots"], 1, null, "add", 70, 35, true, defFlat, [{ kind: "conditionalPercentStat", condition: { kind: "formationRow", row: "front" }, stat: "defense", rollScaleBps: 10_000 }], [{ tagId: "guard", count: 1 }, { tagId: "front", count: 1 }]),
  affix("af_backline_focus", "conditional", ["gloves", "boots", "accessory"], 1, null, "add", 70, 35, true, atkFlat, [{ kind: "conditionalPercentStat", condition: { kind: "formationRow", row: "back" }, stat: "attack", rollScaleBps: 10_000 }], [{ tagId: "focus", count: 1 }, { tagId: "back", count: 1 }]),
  affix("af_marked_prey", "conditional", ["weapon", "gloves", "accessory"], 11, null, "add", 55, 44, true, damage, [{ kind: "conditionalDamageBonus", condition: { kind: "targetHasStatus", statusId: "status_marked" }, element: "all", rollScaleBps: 10_000 }], [{ tagId: "mark", count: 1 }, { tagId: "chase", count: 1 }], ["rare", "epic", "abyss"]),
  affix("af_venom_edge", "trigger", ["weapon"], 6, "basic_ailment", "unique", 55, 42, false, trigger, [{ kind: "trigger", triggerId: "tr_venom_edge" }], [{ tagId: "poison", count: 2 }, { tagId: "basicAttack", count: 1 }]),
  // RPG-025：14 条普通高阶词条按冻结槽位、品质和操作逐条展开。
  affix("af_dark", "damageType", ["weapon", "gloves", "accessory"], 21, null, "add", 60, 44, true, damage, [{ kind: "damageBonus", element: "dark", rollScaleBps: 10_000 }], [{ tagId: "dark", count: 1 }], ["rare", "epic", "abyss"]),
  affix("af_prismatic", "damageType", ["accessory"], 31, null, "add", 30, 70, true, damage, [{ kind: "damageBonus", element: "all", rollScaleBps: 10_000 }], [{ tagId: "element", count: 1 }], ["epic", "abyss"]),
  affix("af_frostbite_edge", "trigger", ["weapon"], 11, "basic_ailment", "unique", 50, 46, false, trigger, [{ kind: "trigger", triggerId: "tr_frostbite_edge" }], [{ tagId: "frost", count: 1 }, { tagId: "control", count: 1 }], ["rare", "epic", "abyss"]),
  affix("af_storm_spark", "trigger", ["weapon", "gloves", "accessory"], 21, "crit_resource", "unique", 45, 52, false, trigger, [{ kind: "trigger", triggerId: "tr_storm_spark" }], [{ tagId: "crit", count: 1 }, { tagId: "shock", count: 1 }], ["rare", "epic", "abyss"]),
  affix("af_healing_echo", "trigger", ["weapon", "accessory"], 11, "heal_follow", "unique", 45, 50, false, trigger, [{ kind: "trigger", triggerId: "tr_healing_echo" }], [{ tagId: "heal", count: 2 }, { tagId: "shield", count: 1 }], ["rare", "epic", "abyss"], ["staff", "focus", "relic"]),
  affix("af_guardian_pulse", "trigger", ["helmet", "armor", "accessory"], 21, "shield_follow", "unique", 40, 55, false, trigger, [{ kind: "trigger", triggerId: "tr_guardian_pulse" }], [{ tagId: "shield", count: 1 }, { tagId: "counter", count: 1 }], ["rare", "epic", "abyss"]),
  affix("af_rending_mastery", "skillAmp", ["weapon", "accessory"], 1, null, "add", 45, 45, false, [[1, 500, 700], [11, 800, 1100], [21, 1200, 1500], [31, 1550, 1950], [41, 2000, 2500]], [{ kind: "skillPower", skillId: "skill_wanderer_rending_slash", rollScaleBps: 10_000 }], [{ tagId: "bleed", count: 1 }]),
  affix("af_fortress_mastery", "skillAmp", ["helmet", "armor", "accessory"], 1, null, "add", 45, 45, false, [[1, 500, 700], [11, 800, 1100], [21, 1200, 1500], [31, 1550, 1950], [41, 2000, 2500]], [{ kind: "skillPower", skillId: "skill_guard_fortify", rollScaleBps: 10_000 }], [{ tagId: "shield", count: 1 }]),
  affix("af_twinshot_mastery", "skillAmp", ["weapon", "gloves", "accessory"], 6, null, "add", 45, 45, false, [[1, 500, 700], [11, 800, 1100], [21, 1200, 1500], [31, 1550, 1950], [41, 2000, 2500]], [{ kind: "skillPower", skillId: "skill_ranger_twin_shot", rollScaleBps: 10_000 }], [{ tagId: "chase", count: 1 }]),
  affix("af_fireball_mastery", "skillAmp", ["weapon", "gloves", "accessory"], 1, null, "add", 45, 45, false, [[1, 500, 700], [11, 800, 1100], [21, 1200, 1500], [31, 1550, 1950], [41, 2000, 2500]], [{ kind: "skillPower", skillId: "skill_ember_fireball", rollScaleBps: 10_000 }], [{ tagId: "burn", count: 1 }]),
  affix("af_ice_nova_mastery", "skillAmp", ["weapon", "gloves", "accessory"], 11, null, "add", 40, 50, false, [[1, 500, 700], [11, 800, 1100], [21, 1200, 1500], [31, 1550, 1950], [41, 2000, 2500]], [{ kind: "skillPower", skillId: "skill_frost_ice_nova", rollScaleBps: 10_000 }], [{ tagId: "frost", count: 1 }, { tagId: "control", count: 1 }], ["rare", "epic", "abyss"]),
  affix("af_mend_mastery", "skillAmp", ["weapon", "gloves", "accessory"], 1, null, "add", 45, 45, false, [[1, 500, 700], [11, 800, 1100], [21, 1200, 1500], [31, 1550, 1950], [41, 2000, 2500]], [{ kind: "skillPower", skillId: "skill_priest_mend", rollScaleBps: 10_000 }], [{ tagId: "heal", count: 1 }]),
  affix("af_sweeping_form", "mechanic", ["weapon"], 31, "basic_shape", "replace", 18, 95, false, [[31, 1, 1], [41, 1, 1]], [{ kind: "replaceBasicSkill", skillId: "effect_sweeping_basic" }], [{ tagId: "basicAttack", count: 2 }, { tagId: "area", count: 1 }], ["epic", "abyss"]),
  affix("af_elemental_recast", "mechanic", ["weapon"], 31, "basic_element", "replace", 18, 95, false, [[31, 1, 1], [41, 1, 1]], [{ kind: "replaceDamageElement", from: "physical", to: "fire" }], [{ tagId: "basicAttack", count: 1 }, { tagId: "fire", count: 2 }], ["epic", "abyss"]),
  // 深渊槽只能由 abyss 品质生成，且所有词条均不可锻造强化。
  abyssAffix("af_abyss_twinstrike", "trigger", ["weapon"], 26, "basic_follow", "unique", 25, 180, [[26, 7000, 8000], [36, 8000, 9000], [46, 9000, 10000]], [{ kind: "trigger", triggerId: "tr_abyss_twinstrike" }], [{ tagId: "basicAttack", count: 2 }, { tagId: "chase", count: 2 }]),
  abyssAffix("af_abyss_soulburn", "trigger", ["weapon", "gloves", "accessory"], 26, "burn_consume", "unique", 25, 180, [[26, 7000, 8000], [36, 8000, 9000], [46, 9000, 10000]], [{ kind: "trigger", triggerId: "tr_abyss_soulburn" }], [{ tagId: "burn", count: 2 }, { tagId: "dark", count: 2 }, { tagId: "detonate", count: 1 }]),
  abyssAffix("af_abyss_bloodmoon", "trigger", ["armor", "gloves", "accessory"], 26, "lowhp_sustain", "unique", 22, 200, [[26, 7000, 8000], [36, 8000, 9000], [46, 9000, 10000]], [{ kind: "trigger", triggerId: "tr_abyss_bloodmoon" }], [{ tagId: "bleed", count: 2 }, { tagId: "heal", count: 1 }]),
  abyssAffix("af_abyss_permafrost", "trigger", ["weapon", "accessory"], 26, "basic_ailment", "unique", 22, 200, [[26, 7000, 8000], [36, 8000, 9000], [46, 9000, 10000]], [{ kind: "trigger", triggerId: "tr_abyss_permafrost" }], [{ tagId: "frost", count: 2 }, { tagId: "control", count: 2 }]),
  abyssAffix("af_abyss_stormcrown", "trigger", ["helmet", "gloves", "accessory"], 31, "crit_follow", "unique", 20, 220, [[26, 7000, 8000], [36, 8000, 9000], [46, 9000, 10000]], [{ kind: "trigger", triggerId: "tr_abyss_stormcrown" }], [{ tagId: "crit", count: 2 }, { tagId: "shock", count: 2 }, { tagId: "chain", count: 1 }]),
  abyssAffix("af_abyss_sanctuary", "trigger", ["helmet", "armor", "accessory"], 26, "heal_follow", "unique", 20, 220, [[26, 7000, 8000], [36, 8000, 9000], [46, 9000, 10000]], [{ kind: "trigger", triggerId: "tr_abyss_sanctuary" }], [{ tagId: "heal", count: 2 }, { tagId: "shield", count: 2 }]),
  abyssAffix("af_abyss_timefracture", "trigger", ["boots", "accessory"], 26, "extra_turn", "unique", 12, 280, [[26, 1, 1]], [{ kind: "trigger", triggerId: "tr_abyss_timefracture" }], [{ tagId: "speed", count: 2 }, { tagId: "ultimate", count: 1 }]),
  abyssAffix("af_abyss_kingbrand", "damageType", ["accessory"], 46, null, "max", 10, 320, [[46, 2300, 3000]], [{ kind: "finalDamageMultiplier", rollScaleBps: 10_000 }], [{ tagId: "dark", count: 1 }, { tagId: "execute", count: 2 }]),
]);

export const EQUIPMENT_BASE_POOLS: readonly EquipmentBasePoolGroupV1[] = Object.freeze([
  { slot: "weapon", weight: 100, bases: EQUIPMENT_BASE_DEFINITIONS.filter((value) => value.slot === "weapon").map((value) => ({ baseId: value.id, weight: 100 })) },
  ...(["helmet", "armor", "gloves", "boots", "accessory"] as const).map((slot) => ({
    slot,
    weight: 100,
    bases: EQUIPMENT_BASE_DEFINITIONS.filter((value) => value.slot === slot).map((value) => ({ baseId: value.id, weight: 100 })),
  })),
]);

export const equipmentBases = EQUIPMENT_BASE_DEFINITIONS;
export const equipmentAffixes = EQUIPMENT_AFFIX_DEFINITIONS;
export const equipmentBasePools = EQUIPMENT_BASE_POOLS;
