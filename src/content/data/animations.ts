import {
  failure,
  success,
  type DomainResult,
} from "../../domain/common/DomainResult";
import type {
  EffectSpec,
  Element,
  SkillDefinition,
  SkillKind,
  TargetRule,
} from "../contracts";
import { FROZEN_BATCH_MANIFESTS } from "../Catalog";

export type AnimationPresetId =
  | "melee"
  | "projectile"
  | "area"
  | "heal"
  | "shield"
  | "status"
  | "summon"
  | "passive";
export type AnimationScreenShake = "none" | "light" | "heavy";
export type AnimationSfxId = "sfx_attack" | "sfx_skill" | "sfx_heal" | "sfx_status" | null;

/** ASSET-1.2 的逻辑动画定义，不携带帧资源或领域状态。 */
export interface AnimationDefinitionV1 {
  id: string;
  bundleId: "battle_common";
  presetId: AnimationPresetId;
  element: Element;
  durationMs: 0 | 300 | 450 | 600;
  screenShake: AnimationScreenShake;
  sfxId: AnimationSfxId;
}

export interface AnimationSkillInput {
  id: string;
  kind: SkillKind;
  targetRule: TargetRule;
  requiresFrontAccess: boolean;
  effectsByLevel?: readonly (readonly EffectSpec[])[];
  effects?: readonly (EffectSpec | AnimationFirstEffect)[];
  animationId?: string;
}

/** 动画只读取首效果字段；其余领域数值仍由 SkillDefinition 自己负责。 */
export type AnimationFirstEffect =
  | { kind: EffectSpec["kind"]; element?: Element };

const ELEMENTS: readonly Element[] = [
  "physical",
  "fire",
  "frost",
  "lightning",
  "holy",
  "dark",
  "poison",
  "true",
];
const STATUS_EFFECT_KINDS = new Set<EffectSpec["kind"]>([
  "applyStatus",
  "dispel",
  "consumeStatus",
  "changeEnergy",
  "changeCooldown",
  "grantExtraTurn",
]);

function invalid(path: string, issueKey: string): DomainResult<AnimationDefinitionV1> {
  return failure({
    code: "INVALID_CONTENT",
    details: { path, issueKey },
  });
}

function isElement(value: unknown): value is Element {
  return typeof value === "string" && ELEMENTS.includes(value as Element);
}

function firstEffects(skill: AnimationSkillInput): readonly (EffectSpec | AnimationFirstEffect)[] | null {
  if (skill.effects) return skill.effects;
  const levels = skill.effectsByLevel;
  return levels && levels.length > 0 ? levels[0] ?? null : null;
}

/**
 * 按 ASSET-1.2 4.2 自上而下选择首效果；不为非法字段补 element、target 或 requiresFrontAccess。
 */
export function deriveAnimationDefinition(
  skill: AnimationSkillInput | SkillDefinition,
): DomainResult<AnimationDefinitionV1> {
  const effects = firstEffects(skill);
  if (effects === null) return invalid(`skills.${skill.id}.effects`, "missing_effects");
  const id = skill.animationId ?? `anim_${skill.id}`;
  if (!/^anim_[^\s]+$/.test(id)) return invalid(`skills.${skill.id}.animationId`, "invalid_animation_id");

  if (effects.length === 0) {
    if (skill.kind !== "passive" && skill.kind !== "effect") {
      return invalid(`skills.${skill.id}.effects`, "empty_effects_not_allowed");
    }
    return success({
      id,
      bundleId: "battle_common",
      presetId: "passive",
      element: "physical",
      durationMs: 0,
      screenShake: "none",
      sfxId: null,
    });
  }

  const first = effects[0] as EffectSpec | undefined;
  if (!first || typeof first !== "object" || typeof first.kind !== "string") {
    return invalid(`skills.${skill.id}.effects[0]`, "unknown_first_effect");
  }

  if (first.kind === "heal" || first.kind === "revive") {
    return success({ id, bundleId: "battle_common", presetId: "heal", element: "holy", durationMs: 450, screenShake: "none", sfxId: "sfx_heal" });
  }
  if (first.kind === "shield") {
    return success({ id, bundleId: "battle_common", presetId: "shield", element: "holy", durationMs: 450, screenShake: "none", sfxId: "sfx_heal" });
  }
  if (STATUS_EFFECT_KINDS.has(first.kind)) {
    return success({ id, bundleId: "battle_common", presetId: "status", element: "physical", durationMs: 300, screenShake: "none", sfxId: "sfx_status" });
  }
  if (first.kind === "summon") {
    return success({ id, bundleId: "battle_common", presetId: "summon", element: "physical", durationMs: 600, screenShake: "heavy", sfxId: "sfx_status" });
  }
  if (first.kind !== "damage") {
    return invalid(`skills.${skill.id}.effects[0].kind`, "unknown_first_effect");
  }
  if (!isElement(first.element)) {
    return invalid(`skills.${skill.id}.effects[0].element`, "damage_element_required");
  }
  if (typeof skill.requiresFrontAccess !== "boolean") {
    return invalid(`skills.${skill.id}.requiresFrontAccess`, "requires_front_access_required");
  }
  if (skill.targetRule === "allEnemies") {
    return success({ id, bundleId: "battle_common", presetId: "area", element: first.element, durationMs: 600, screenShake: "heavy", sfxId: "sfx_skill" });
  }
  if (skill.requiresFrontAccess) {
    return success({ id, bundleId: "battle_common", presetId: "melee", element: first.element, durationMs: 300, screenShake: "light", sfxId: "sfx_attack" });
  }
  return success({ id, bundleId: "battle_common", presetId: "projectile", element: first.element, durationMs: 450, screenShake: "light", sfxId: "sfx_skill" });
}

/** 需要在构建期直接得到定义时使用；非法内容以异常终止构建，不猜测缺省值。 */
export function deriveAnimationDefinitionOrThrow(
  skill: AnimationSkillInput | SkillDefinition,
): AnimationDefinitionV1 {
  const result = deriveAnimationDefinition(skill);
  if (!result.ok) {
    const details = result.error.code === "INVALID_CONTENT" ? result.error.details : null;
    throw new Error(`${details?.path ?? "animation"}:${details?.issueKey ?? "invalid"}`);
  }
  return result.value;
}

/** RPG-006 冻结的 97 个 SkillDefinition ID，来源只能是冻结批次 manifest。 */
export const FROZEN_SKILL_IDS = FROZEN_BATCH_MANIFESTS.floors06_10.skills;

export const PASSIVE_SKILL_IDS = [
  "skill_wanderer_instinct",
  "skill_guard_unyielding",
  "skill_ranger_eagle_eye",
  "skill_ember_kindling",
  "skill_frost_clarity",
  "skill_priest_benediction",
] as const;

interface FrozenAnimationInput {
  readonly id: string;
  readonly kind: SkillKind;
  readonly targetRule: TargetRule;
  readonly requiresFrontAccess: boolean;
  readonly firstEffect: AnimationFirstEffect | null;
}

const passive = (id: string): FrozenAnimationInput => ({ id, kind: "passive", targetRule: "self", requiresFrontAccess: false, firstEffect: null });
const frozen = (
  id: string,
  kind: SkillKind,
  targetRule: TargetRule,
  requiresFrontAccess: boolean,
  firstEffect: AnimationFirstEffect,
): FrozenAnimationInput => ({ id, kind, targetRule, requiresFrontAccess, firstEffect });
const damage = (kind: SkillKind, id: string, targetRule: TargetRule, requiresFrontAccess: boolean, element: Element): FrozenAnimationInput => frozen(id, kind, targetRule, requiresFrontAccess, { kind: "damage", element });
const status = (kind: SkillKind, id: string, targetRule: TargetRule, requiresFrontAccess = false): FrozenAnimationInput => frozen(id, kind, targetRule, requiresFrontAccess, { kind: "applyStatus" });
const shield = (kind: SkillKind, id: string, targetRule: TargetRule): FrozenAnimationInput => frozen(id, kind, targetRule, false, { kind: "shield" });
const heal = (kind: SkillKind, id: string, targetRule: TargetRule, firstKind: "heal" | "revive" = "heal"): FrozenAnimationInput => frozen(id, kind, targetRule, false, { kind: firstKind });
const summon = (kind: SkillKind, id: string): FrozenAnimationInput => frozen(id, kind, "self", false, { kind: "summon" });

/**
 * 逐条转录 ASSET-1.2/skills-table 的首效果、targetRule 与 front 约束。
 * 这里禁止按 ID、名称、路径或集合猜测；任何新技能必须先进入冻结表。
 */
const FROZEN_ANIMATION_INPUTS: readonly FrozenAnimationInput[] = Object.freeze([
  damage("basic", "skill_wanderer_strike", "singleEnemy", true, "physical"),
  damage("active", "skill_wanderer_rending_slash", "singleEnemy", true, "physical"),
  damage("active", "skill_wanderer_guarding_blow", "singleEnemy", true, "physical"),
  damage("active", "skill_wanderer_execution", "singleEnemy", true, "physical"),
  damage("active", "skill_wanderer_blood_rally", "allEnemies", false, "physical"),
  damage("ultimate", "skill_wanderer_endless_edge", "allEnemies", false, "physical"),
  passive("skill_wanderer_instinct"),
  damage("basic", "skill_guard_hammer", "singleEnemy", true, "physical"),
  damage("active", "skill_guard_shield_bash", "singleEnemy", true, "physical"),
  shield("active", "skill_guard_fortify", "self"),
  shield("active", "skill_guard_banner", "allAllies"),
  status("active", "skill_guard_challenge", "allEnemies"),
  shield("ultimate", "skill_guard_iron_citadel", "allAllies"),
  passive("skill_guard_unyielding"),
  damage("basic", "skill_ranger_arrow", "singleEnemy", false, "physical"),
  damage("active", "skill_ranger_twin_shot", "singleEnemy", false, "physical"),
  damage("active", "skill_ranger_marking_arrow", "singleEnemy", false, "physical"),
  status("active", "skill_ranger_fleet_step", "self"),
  damage("active", "skill_ranger_predator_volley", "randomEnemy", false, "physical"),
  damage("ultimate", "skill_ranger_arrow_storm", "allEnemies", false, "physical"),
  passive("skill_ranger_eagle_eye"),
  damage("basic", "skill_ember_bolt", "singleEnemy", false, "fire"),
  damage("active", "skill_ember_fireball", "singleEnemy", false, "fire"),
  damage("active", "skill_ember_flame_wave", "allEnemies", false, "fire"),
  damage("active", "skill_ember_detonate", "singleEnemy", false, "fire"),
  shield("active", "skill_ember_ward", "self"),
  damage("ultimate", "skill_ember_inferno", "allEnemies", false, "fire"),
  passive("skill_ember_kindling"),
  damage("basic", "skill_frost_shard", "singleEnemy", false, "frost"),
  damage("active", "skill_frost_chill_lance", "singleEnemy", false, "frost"),
  damage("active", "skill_frost_ice_nova", "allEnemies", false, "frost"),
  shield("active", "skill_frost_crystal_aegis", "singleAlly"),
  damage("active", "skill_frost_winter_link", "allEnemies", false, "frost"),
  damage("ultimate", "skill_frost_absolute_zero", "allEnemies", false, "frost"),
  passive("skill_frost_clarity"),
  damage("basic", "skill_priest_smite", "singleEnemy", false, "holy"),
  heal("active", "skill_priest_mend", "singleAlly"),
  heal("active", "skill_priest_sanctuary", "allAllies"),
  heal("active", "skill_priest_purifying_light", "singleAlly"),
  shield("active", "skill_priest_aegis", "singleAlly"),
  heal("ultimate", "skill_priest_returning_light", "deadAlly", "revive"),
  passive("skill_priest_benediction"),
  damage("effect", "effect_ember_echo_burst", "allEnemies", false, "fire"),
  damage("effect", "effect_guard_ripple", "allEnemies", false, "physical"),
  damage("effect", "effect_bleed_doublecut", "singleEnemy", true, "physical"),
  heal("effect", "effect_holy_afterglow", "allAllies"),
  damage("effect", "effect_shadow_echo", "singleEnemy", true, "dark"),
  damage("effect", "effect_sweeping_basic", "allEnemies", true, "physical"),
  damage("basic", "skill_enemy_basic_physical", "singleEnemy", true, "physical"),
  damage("basic", "skill_enemy_basic_ranged", "singleEnemy", false, "physical"),
  status("active", "skill_enemy_defend", "self"),
  damage("active", "skill_enemy_double_hit", "singleEnemy", true, "physical"),
  damage("active", "skill_enemy_bleed_hit", "singleEnemy", true, "physical"),
  damage("active", "skill_enemy_slow_hit", "singleEnemy", false, "physical"),
  damage("active", "skill_enemy_charge", "singleEnemy", true, "physical"),
  damage("active", "skill_enemy_poison_hit", "singleEnemy", false, "poison"),
  damage("active", "skill_enemy_poison_double", "singleEnemy", false, "poison"),
  shield("active", "skill_enemy_guard_all", "allAllies"),
  status("active", "skill_enemy_haste", "self"),
  damage("active", "skill_enemy_stun_hit", "singleEnemy", true, "physical"),
  damage("active", "skill_enemy_all_physical", "allEnemies", false, "physical"),
  heal("active", "skill_enemy_self_heal", "self"),
  status("active", "skill_enemy_fear_all", "allEnemies"),
  damage("active", "skill_enemy_burn_hit", "singleEnemy", true, "fire"),
  damage("active", "skill_enemy_burn_all", "allEnemies", false, "fire"),
  damage("active", "skill_enemy_execute", "singleEnemy", true, "dark"),
  damage("active", "skill_enemy_fear_hit", "singleEnemy", false, "dark"),
  damage("active", "skill_enemy_bleed_double", "singleEnemy", true, "physical"),
  heal("active", "skill_enemy_ally_heal", "singleAlly"),
  shield("active", "skill_enemy_frost_guard", "allAllies"),
  damage("active", "skill_enemy_freeze_hit", "singleEnemy", false, "frost"),
  damage("active", "skill_enemy_shock_double", "randomEnemy", false, "lightning"),
  status("active", "skill_enemy_slow_all", "allEnemies"),
  shield("active", "skill_enemy_counter_guard", "self"),
  status("active", "skill_boss_enrage", "self"),
  damage("active", "skill_boss_horned_charge", "singleEnemy", true, "physical"),
  summon("active", "skill_boss_horned_call"),
  damage("active", "skill_boss_brood_venom_web", "allEnemies", false, "poison"),
  summon("active", "skill_boss_brood_hatch"),
  damage("active", "skill_boss_iron_quake", "allEnemies", false, "physical"),
  shield("active", "skill_boss_iron_overdrive", "self"),
  damage("active", "skill_boss_witch_miasma", "allEnemies", false, "poison"),
  status("active", "skill_boss_witch_rebirth", "self"),
  damage("active", "skill_boss_ember_sweep", "allEnemies", false, "fire"),
  status("active", "skill_boss_ember_eruption", "allEnemies"),
  damage("active", "skill_boss_butcher_cleaver", "singleEnemy", true, "dark"),
  status("active", "skill_boss_butcher_frenzy", "self"),
  damage("active", "skill_boss_crimson_flurry", "singleEnemy", true, "physical"),
  status("active", "skill_boss_crimson_bloodmoon", "self"),
  damage("active", "skill_boss_jailer_prison", "allEnemies", false, "frost"),
  status("active", "skill_boss_jailer_whitewall", "self"),
  damage("active", "skill_boss_eye_chain", "randomEnemy", false, "lightning"),
  status("active", "skill_boss_eye_rewrite", "allEnemies"),
  damage("active", "skill_boss_king_dark_wave", "allEnemies", false, "dark"),
  status("active", "skill_boss_king_phase_two", "self"),
  status("active", "skill_boss_king_phase_three", "allEnemies"),
  damage("active", "skill_boss_king_annihilation", "allEnemies", false, "dark"),
]);

function assertFrozenAnimationInputs(): void {
  if (FROZEN_ANIMATION_INPUTS.length !== FROZEN_SKILL_IDS.length) {
    throw new Error("ASSET 动画 canonical 输入数量与冻结技能 manifest 不一致");
  }
  for (const [index, input] of FROZEN_ANIMATION_INPUTS.entries()) {
    if (input.id !== FROZEN_SKILL_IDS[index]) {
      throw new Error(`ASSET 动画 canonical 输入顺序不一致:${input.id}`);
    }
  }
}

function canonicalSkillInput(input: FrozenAnimationInput): AnimationSkillInput {
  if (input.firstEffect === null) {
    return { id: input.id, kind: input.kind, targetRule: input.targetRule, requiresFrontAccess: input.requiresFrontAccess, effects: [] };
  }
  return {
    id: input.id,
    kind: input.kind,
    targetRule: input.targetRule,
    requiresFrontAccess: input.requiresFrontAccess,
    effects: [{ kind: input.firstEffect.kind, targetRule: input.targetRule, ...(input.firstEffect.element === undefined ? {} : { element: input.firstEffect.element }) } as AnimationFirstEffect],
  };
}

assertFrozenAnimationInputs();

/** 由冻结首效果逐条调用纯函数派生；物理图集由后续资源卡提供。 */
export const ANIMATION_DEFINITIONS: readonly AnimationDefinitionV1[] = Object.freeze(
  FROZEN_ANIMATION_INPUTS.map((input) => deriveAnimationDefinitionOrThrow(canonicalSkillInput(input))),
);

export const animations = ANIMATION_DEFINITIONS;
