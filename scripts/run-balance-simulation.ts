/**
 * PROFILE-1.2 无渲染平衡模拟器。
 *
 * 夹具只负责构造合法存档，战斗推进仍使用正式 BattleFactory、命令校验、
 * ActionResolver、EnemyAi 和 BattleReducer。模拟器不修改产品数值，也不按
 * 目标胜率筛选 seed；发现内容或领域错误会直接返回失败。
 */
import type {
  BattleCommandV1,
  BattleDomainEventV1,
  BattleSnapshotV1,
  CharacterDefinition,
  CharacterProgressV1,
  ContentRootV1,
  Element,
  EquipmentAffixDefinition,
  EquipmentBaseDefinition,
  EquipmentInstance,
  EquipmentSlot,
  EquipmentQuality,
  EncounterDefinition,
  EffectSpec,
  GameSaveV1,
  PendingBattleEventV1,
  SkillDefinition,
  SkillStoneInstance,
  SkillStoneQuality,
} from "../src/content/contracts";
import { ContentCatalog } from "../src/content/Catalog";
import { abyssEchoContentRoot } from "../src/content/data/abyssEchoes";
import { calculateStats } from "../src/domain/character/StatCalculator";
import { createDomainError, failure, success, type DomainResult } from "../src/domain/common/DomainResult";
import { SequentialIdFactory } from "../src/domain/common/DomainContext";
import { fnv1a32, SeededRng } from "../src/domain/common/SeededRng";
import { calculateEquipmentStatModifiers } from "../src/domain/inventory/EquipmentService";
import { createNewGameSave, validateGameSave } from "../src/domain/save/GameSave";
import { resolveBattleDynamicModifiers } from "../src/domain/battle/BattleLoadoutRuntime";
import { resolveBattleAction } from "../src/domain/battle/ActionResolver";
import { resolveDamage } from "../src/domain/battle/DamageResolver";
import { createBattleComboRuntime, type BattleComboRuntimeAdapter } from "../src/domain/battle/BattleComboRuntime";
import { ComboMatcher } from "../src/domain/combo/ComboMatcher";
import { BattleFactory } from "../src/domain/battle/BattleFactory";
import { decideEnemyAction } from "../src/domain/battle/EnemyAi";
import { reduceBattle } from "../src/domain/battle/BattleReducer";
import { createPeriodicStatusEvents, type StatusEventContext } from "../src/domain/battle/StatusRuntime";
import type { BattleContentSource, BattleFactoryInput, BattleStatBaseline } from "../src/domain/battle/BattleTypes";
import { validateBattleCommand } from "../src/domain/battle/BattleCommandValidator";
import { selectPrimaryTarget } from "../src/domain/battle/Targeting";
import { SkillModifierResolver } from "../src/domain/skill/SkillModifierResolver";

export const BALANCE_CONTENT_VERSION = "content-1.2.0" as const;
export const BALANCE_SEED_COUNT = 200;
export const BALANCE_MAX_ROUNDS = 30;
export const BALANCE_PROFILES = ["lagging", "ready", "breakthrough", "alternative"] as const;
export type BalanceProfile = (typeof BALANCE_PROFILES)[number];

export interface BalanceProfileSpec {
  readonly profile: BalanceProfile;
  readonly floorNumber: number;
  readonly level: number;
  readonly itemLevel: number | null;
  readonly party: readonly (string | null)[];
}

export interface BalanceBattleResultV1 {
  readonly contentVersion: typeof BALANCE_CONTENT_VERSION;
  readonly floorNumber: number;
  readonly profile: BalanceProfile;
  readonly seedIndex: number;
  readonly seedNamespace: string;
  readonly initialRngState: readonly [number, number, number, number];
  readonly activatedComboIds: readonly string[];
  readonly extraActivatedComboIds: readonly string[];
  readonly outcome: "victory" | "defeat" | "timeout";
  readonly endRound: number;
  readonly rootActionCount: number;
  readonly bossEnrageCast: boolean;
  readonly partyKnockoutCount: number;
  readonly bossRemainingHp: number;
  /** 根技能交给 reducer 后实际进入战斗快照的召唤物定义 ID。 */
  readonly summonedEnemyIds: readonly string[];
  readonly partyDamageTaken: number;
  readonly partyHealingDone: number;
  readonly partyShieldGranted: number;
  readonly damageBySource: readonly unknown[];
  readonly comboTriggerCounts: Readonly<Record<string, number>>;
  readonly maxChainDepth: number;
  readonly triggerBudgetExhaustedCount: number;
  readonly finalRngState: readonly [number, number, number, number];
  /** 开战前的固定配方门禁；普通档位没有宣告 Combo。 */
  readonly declaredComboId?: string | null;
  readonly declaredComboMatched?: boolean;
}

export interface BalanceSimulationOptions {
  readonly fixture?: "smoke" | "formal";
  readonly floors?: readonly number[];
  readonly seeds?: number;
  readonly profiles?: readonly BalanceProfile[];
  /** 兼容 RPG-016 smoke 门禁；formal fixture 会强制使用正式累计根。 */
  readonly formalContentAvailable?: boolean;
}

export interface BalanceSimulationSummary {
  readonly blocked: boolean;
  readonly reason?: "MISSING_FORMAL_CONTENT_BATCH";
  readonly contentVersion: typeof BALANCE_CONTENT_VERSION;
  readonly requestedFloors: readonly number[];
  readonly profiles: readonly BalanceProfile[];
  readonly seeds: number;
  readonly results: readonly BalanceBattleResultV1[];
}

const FLOOR_LEVELS = [
  [2, 4], [6, 8], [10, 12], [14, 16], [19, 21],
  [23, 25], [29, 31], [35, 37], [41, 43], [48, 50],
] as const;
const READY_ITEM_LEVELS = [3, 8, 13, 18, 23, 28, 33, 38, 43, 48] as const;
const PARTY_BY_FLOOR: readonly (readonly (string | null)[])[] = [
  ["char_wanderer", "char_iron_guard", "char_ember_mage", null],
  ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"],
  ["char_wanderer", "char_iron_guard", "char_ranger", "char_priest"],
  ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"],
  ["char_wanderer", "char_iron_guard", "char_frost_seer", "char_priest"],
  ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"],
  ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"],
  ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"],
  ["char_wanderer", "char_frost_seer", "char_ranger", "char_ember_mage"],
  ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"],
];

const NORMAL_AFFIXES: Readonly<Record<EquipmentSlot, readonly string[]>> = {
  weapon: ["af_might", "af_precision"],
  helmet: ["af_vitality", "af_guard"],
  armor: ["af_vitality", "af_guard"],
  gloves: ["af_might", "af_precision"],
  boots: ["af_haste", "af_vitality"],
  accessory: ["af_vitality", "af_might"],
};
const RARE_THIRD_AFFIX: Readonly<Record<EquipmentSlot, string>> = {
  weapon: "af_high_spirit",
  helmet: "af_resolve",
  armor: "af_resolve",
  gloves: "af_ferocity",
  boots: "af_guard",
  accessory: "af_precision",
};
const SLOT_GROUP: Readonly<Record<EquipmentSlot, 0 | 1 | 2>> = {
  weapon: 0, armor: 0, helmet: 1, gloves: 1, boots: 2, accessory: 2,
};
const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"];

interface EquipmentOverride { readonly characterId: string; readonly slot: EquipmentSlot; readonly quality: EquipmentQuality; readonly affixes: readonly string[]; readonly abyssAffix?: string; }
interface StoneOverride { readonly characterId: string; readonly quality: SkillStoneQuality; readonly affixes: readonly string[]; readonly abyssAffix?: string; }

const BREAKTHROUGH_OVERRIDES: Readonly<Record<number, readonly EquipmentOverride[]>> = {
  1: [{ characterId: "char_ember_mage", slot: "weapon", quality: "rare", affixes: ["af_flame", "af_fireball_mastery", "af_searing_edge"] }],
  2: [{ characterId: "char_iron_guard", slot: "armor", quality: "rare", affixes: ["af_counterweight", "af_bulwark", "af_guard"] }],
  3: [{ characterId: "char_ranger", slot: "weapon", quality: "rare", affixes: ["af_lightning", "af_precision", "af_twinshot_mastery"] }],
  4: [{ characterId: "char_priest", slot: "armor", quality: "rare", affixes: ["af_bulwark", "af_guard", "af_vitality"] }],
  5: [{ characterId: "char_frost_seer", slot: "weapon", quality: "rare", affixes: ["af_frost", "af_might", "af_ice_nova_mastery"] }],
  6: [{ characterId: "char_iron_guard", slot: "armor", quality: "abyss", affixes: ["af_frontline_wall", "af_guard", "af_bulwark", "af_vitality"], abyssAffix: "af_abyss_bloodmoon" }],
  7: [
    { characterId: "char_wanderer", slot: "weapon", quality: "rare", affixes: ["af_dark", "af_might", "af_rending_mastery"] },
    { characterId: "char_wanderer", slot: "gloves", quality: "rare", affixes: ["af_dark", "af_pursuit", "af_precision"] },
  ],
  8: [{ characterId: "char_ember_mage", slot: "weapon", quality: "abyss", affixes: ["af_flame", "af_might", "af_fireball_mastery", "af_high_spirit"], abyssAffix: "af_abyss_twinstrike" }],
  9: [
    { characterId: "char_ranger", slot: "accessory", quality: "abyss", affixes: ["af_lightning", "af_precision", "af_backline_focus", "af_prismatic"], abyssAffix: "af_abyss_stormcrown" },
    { characterId: "char_ember_mage", slot: "weapon", quality: "rare", affixes: ["af_flame", "af_fireball_mastery", "af_high_spirit"] },
  ],
  10: [
    { characterId: "char_ember_mage", slot: "weapon", quality: "abyss", affixes: ["af_flame", "af_might", "af_fireball_mastery", "af_high_spirit"], abyssAffix: "af_abyss_twinstrike" },
    { characterId: "char_ember_mage", slot: "boots", quality: "rare", affixes: ["af_backline_focus", "af_haste", "af_vitality"] },
  ],
};
const BREAKTHROUGH_STONES: Readonly<Record<number, StoneOverride>> = {
  1: { characterId: "char_ember_mage", quality: "rare", affixes: ["sa_ember_echo", "sa_ember_focus"] },
  2: { characterId: "char_iron_guard", quality: "rare", affixes: ["sa_guard_ripple", "sa_fortress_focus"] },
  3: { characterId: "char_ranger", quality: "rare", affixes: ["sa_storm_chain", "sa_ranger_twin_echo"] },
  4: { characterId: "char_priest", quality: "rare", affixes: ["sa_heal_overflow", "sa_priest_mend_focus"] },
  5: { characterId: "char_frost_seer", quality: "rare", affixes: ["sa_frost_nova_focus", "sa_frost_zero_echo"] },
  6: { characterId: "char_iron_guard", quality: "epic", affixes: ["sa_guard_shared_wall", "sa_guard_ripple", "sa_fortress_focus"] },
  7: { characterId: "char_wanderer", quality: "abyss", affixes: ["sa_bleed_doublecut", "sa_execution_focus", "sa_universal_focus"], abyssAffix: "sa_abyss_unbound_power" },
  8: { characterId: "char_ember_mage", quality: "epic", affixes: ["sa_ember_echo", "sa_ember_focus", "sa_ember_detonate_cycle"] },
  9: { characterId: "char_ranger", quality: "epic", affixes: ["sa_storm_chain", "sa_ranger_twin_echo", "sa_universal_focus"] },
  10: { characterId: "char_ember_mage", quality: "abyss", affixes: ["sa_universal_focus", "sa_ember_echo", "sa_ember_focus"], abyssAffix: "sa_abyss_shadow_echo" },
};
const ALTERNATIVE_OVERRIDES: Readonly<Record<number, readonly EquipmentOverride[]>> = {
  1: [{ characterId: "char_wanderer", slot: "weapon", quality: "rare", affixes: ["af_bleed_edge", "af_pursuit", "af_might"] }],
  3: [{ characterId: "char_ranger", slot: "weapon", quality: "rare", affixes: ["af_precision", "af_ferocity", "af_might"] }],
  6: [{ characterId: "char_iron_guard", slot: "armor", quality: "epic", affixes: ["af_guard", "af_resolve", "af_bulwark", "af_vitality"] }],
  10: [
    { characterId: "char_ranger", slot: "accessory", quality: "abyss", affixes: ["af_lightning", "af_precision", "af_might", "af_prismatic"], abyssAffix: "af_abyss_stormcrown" },
    { characterId: "char_ember_mage", slot: "weapon", quality: "rare", affixes: ["af_flame", "af_fireball_mastery", "af_high_spirit"] },
  ],
};
const ALTERNATIVE_STONES: Readonly<Record<number, StoneOverride>> = {
  1: { characterId: "char_wanderer", quality: "rare", affixes: ["sa_bleed_doublecut", "sa_execution_focus"] },
  3: { characterId: "char_ranger", quality: "magic", affixes: ["sa_universal_focus"] },
  6: { characterId: "char_iron_guard", quality: "rare", affixes: ["sa_fortress_focus", "sa_guard_ripple"] },
  10: { characterId: "char_ranger", quality: "epic", affixes: ["sa_storm_chain", "sa_ranger_twin_echo", "sa_universal_focus"] },
};

const BREAKTHROUGH_COMBOS: Readonly<Record<number, string>> = {
  1: "combo_ember_chain",
  2: "combo_iron_reprise",
  3: "combo_storm_circuit",
  4: "combo_holy_bulwark",
  5: "combo_frozen_verdict",
  6: "combo_front_fortress",
  7: "combo_dark_covenant",
  8: "combo_ember_chain",
  9: "combo_triune_elements",
  10: "combo_backline_barrage",
};
const ALTERNATIVE_COMBOS: Readonly<Record<number, string>> = {
  1: "combo_blood_hunt",
  3: "combo_perfect_strike",
  6: "combo_steadfast_aegis",
  10: "combo_triune_elements",
};

function declaredComboId(spec: BalanceProfileSpec): string | null {
  if (spec.profile === "breakthrough") return BREAKTHROUGH_COMBOS[spec.floorNumber] ?? null;
  if (spec.profile === "alternative") return ALTERNATIVE_COMBOS[spec.floorNumber] ?? null;
  return null;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}
function assertFloor(floor: number): boolean { return Number.isSafeInteger(floor) && floor >= 1 && floor <= 10; }

/** 构造 PROFILE-1.2 固定档位；任何楼层都不再使用通用等级公式。 */
export function buildBalanceProfiles(floorNumber: number): BalanceProfileSpec[] {
  if (!assertFloor(floorNumber)) throw new RangeError("floorNumber 必须是 1～10");
  const index = floorNumber - 1;
  const readyLevel = FLOOR_LEVELS[index][1];
  const laggingLevel = FLOOR_LEVELS[index][0];
  const readyItemLevel = READY_ITEM_LEVELS[index];
  const laggingItemLevel = floorNumber === 1 ? null : READY_ITEM_LEVELS[index - 1];
  const party = PARTY_BY_FLOOR[index];
  return BALANCE_PROFILES.map((profile) => ({
    profile,
    floorNumber,
    level: profile === "lagging" ? laggingLevel : readyLevel,
    itemLevel: profile === "lagging" ? laggingItemLevel : readyItemLevel,
    party: profile === "alternative" && floorNumber === 10
      ? ["char_wanderer", "char_ranger", "char_frost_seer", "char_ember_mage"]
      : [...party],
  }));
}

/** 规范 namespace：balance:content-1.2.0:floor:03:seed:007。 */
export function balanceSeedNamespace(floorNumber: number, seedIndex: number): string {
  return `balance:${BALANCE_CONTENT_VERSION}:floor:${String(floorNumber).padStart(2, "0")}:seed:${String(seedIndex).padStart(3, "0")}`;
}
export function deriveBalanceSeed(floorNumber: number, seedIndex: number, _profile?: BalanceProfile): readonly [number, number, number, number] {
  void _profile;
  if (!assertFloor(floorNumber) || !Number.isSafeInteger(seedIndex) || seedIndex < 0) throw new RangeError("balance seed 参数非法");
  return new SeededRng(fnv1a32(new TextEncoder().encode(balanceSeedNamespace(floorNumber, seedIndex)))).getState();
}
export function nearestRank(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null;
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) throw new RangeError("percentile 必须位于 0～1");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)] ?? null;
}
export function aggregateBalanceResults(results: readonly BalanceBattleResultV1[]): Readonly<Record<string, unknown>> {
  const groups = new Map<string, BalanceBattleResultV1[]>();
  for (const result of results) {
    const key = `${result.floorNumber}:${result.profile}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return Object.fromEntries([...groups.entries()].map(([key, values]) => [key, {
    floorNumber: values[0].floorNumber,
    profile: values[0].profile,
    sampleCount: values.length,
    victoryCount: values.filter((value) => value.outcome === "victory").length,
    winRateBps: Math.floor(values.filter((value) => value.outcome === "victory").length * 10_000 / values.length),
    victoryP75EndRound: nearestRank(values.filter((value) => value.outcome === "victory").map((value) => value.endRound), 0.75),
  }]));
}

function clone<T>(value: T): T { return structuredClone(value); }

/** Catalog 采用 DeepReadonly；脚本的领域适配器只暴露合同要求的只读定义。 */
function adaptCatalogGetter<T>(getter: (id: string) => DomainResult<unknown>): (id: string) => DomainResult<Readonly<T>> {
  return (id: string) => {
    const result = getter(id);
    if (!result.ok) return result as DomainResult<Readonly<T>>;
    return success(result.value as Readonly<T>);
  };
}
function getHighestTier(definition: { readonly tiers: readonly { readonly tier: 1 | 2 | 3 | 4 | 5; readonly minItemLevel: number }[] }, itemLevel: number): 1 | 2 | 3 | 4 | 5 | null {
  return [...definition.tiers].filter((tier) => tier.minItemLevel <= itemLevel).pop()?.tier ?? null;
}
function getEquipmentRoll(definition: EquipmentAffixDefinition, itemLevel: number, breakthrough: boolean): EquipmentInstance["affixes"][number] | null {
  const tierNumber = getHighestTier(definition, itemLevel);
  if (tierNumber === null) return null;
  const tier = definition.tiers.find((candidate) => candidate.tier === tierNumber);
  if (!tier) return null;
  return { affixId: definition.id, tier: tierNumber, roll: breakthrough ? tier.rollMax : Math.floor((tier.rollMin + tier.rollMax) / 2), craftEmpowered: false, reforged: false };
}
function getStoneRoll(id: string, itemLevel: number, root: ContentRootV1, breakthrough: boolean): SkillStoneInstance["affixes"][number] | null {
  const definition = root.skillAffixes.find((value) => value.id === id);
  if (!definition || definition.minItemLevel > itemLevel) return null;
  return { skillAffixId: id, roll: breakthrough ? definition.rollMax : Math.floor((definition.rollMin + definition.rollMax) / 2), reforged: false };
}
function findBase(root: ContentRootV1, slot: EquipmentSlot, itemLevel: number, character: CharacterDefinition): DomainResult<EquipmentBaseDefinition> {
  const matches = root.equipmentBases.filter((base) => base.id !== "eq_accessory_t6_crown" && base.slot === slot && base.minItemLevel <= itemLevel && itemLevel <= base.maxItemLevel && (slot !== "weapon" || (base.weaponType !== null && character.allowedWeaponTypes.includes(base.weaponType))));
  if (matches.length !== 1) return invalid(`equipmentBases.${slot}.${itemLevel}`, matches.length === 0 ? "missing_unique_base" : "multiple_bases");
  return success(matches[0]);
}
function sourceFloorFor(floor: number, slot: EquipmentSlot): number | null {
  const group = SLOT_GROUP[slot];
  for (let source = floor; source >= 1; source -= 1) if ((source - 1) % 3 === group) return source;
  return null;
}
function overrideFor(overrides: readonly EquipmentOverride[], characterId: string, slot: EquipmentSlot): EquipmentOverride | undefined {
  return overrides.find((value) => value.characterId === characterId && value.slot === slot);
}
function stoneFor(profile: BalanceProfile, floor: number): StoneOverride | undefined {
  return profile === "breakthrough" ? BREAKTHROUGH_STONES[floor] : profile === "alternative" ? ALTERNATIVE_STONES[floor] : undefined;
}

function buildEquipment(
  root: ContentRootV1,
  profile: BalanceProfile,
  floor: number,
  character: CharacterDefinition,
  partySlot: number,
  itemLevel: number | null,
): DomainResult<{ readonly equipment: EquipmentInstance[]; readonly bySlot: Record<EquipmentSlot, string | null> }> {
  const equipment: EquipmentInstance[] = [];
  const bySlot: Record<EquipmentSlot, string | null> = { weapon: null, helmet: null, armor: null, gloves: null, boots: null, accessory: null };
  if (itemLevel === null) return success({ equipment, bySlot });
  const referenceFloor = profile === "lagging" ? floor - 1 : floor;
  const overrides = profile === "breakthrough" ? (BREAKTHROUGH_OVERRIDES[floor] ?? []) : profile === "alternative" ? (ALTERNATIVE_OVERRIDES[floor] ?? []) : [];
  for (const slot of EQUIPMENT_SLOTS) {
    const sourceFloor = sourceFloorFor(referenceFloor, slot);
    if (sourceFloor === null) continue;
    const sourceItemLevel = READY_ITEM_LEVELS[sourceFloor - 1];
    const override = profile === "lagging" || profile === "ready" ? undefined : overrideFor(overrides, character.id, slot);
    const effectiveItemLevel = override ? itemLevel : sourceItemLevel;
    const baseResult = findBase(root, slot, effectiveItemLevel, character);
    if (!baseResult.ok) return baseResult;
    const quality: EquipmentQuality = override?.quality ?? (sourceFloor === 10 ? "rare" : "magic");
    const affixIds = override?.affixes ?? [...NORMAL_AFFIXES[slot], ...(quality === "rare" ? [RARE_THIRD_AFFIX[slot]] : [])];
    const affixes: EquipmentInstance["affixes"] = [];
    for (const id of affixIds) {
      const definition = root.equipmentAffixes.find((value) => value.id === id);
      if (!definition) return invalid(`equipmentAffixes.${id}`, "missing_content");
      const roll = getEquipmentRoll(definition, effectiveItemLevel, override !== undefined);
      if (!roll) return invalid(`equipmentAffixes.${id}`, "tier_unavailable");
      affixes.push(roll);
    }
    let abyssAffix: EquipmentInstance["abyssAffix"] = null;
    if (override?.abyssAffix) {
      const definition = root.equipmentAffixes.find((value) => value.id === override.abyssAffix);
      if (!definition) return invalid(`equipmentAffixes.${override.abyssAffix}`, "missing_content");
      const roll = getEquipmentRoll(definition, effectiveItemLevel, true);
      if (!roll) return invalid(`equipmentAffixes.${override.abyssAffix}`, "tier_unavailable");
      abyssAffix = roll;
    }
    const instanceId = `sim_${profile}_f${String(floor).padStart(2, "0")}_p${partySlot}_${slot}`;
    const instance: EquipmentInstance = { instanceId, baseId: baseResult.value.id, itemLevel: effectiveItemLevel, quality, craftGrade: "ordinary", affixes, abyssAffix, locked: true, acquiredAt: "2000-01-01T00:00:00.000Z", sourceTransactionId: "balance_fixture", reforgeLockedIndex: null, reforgeCount: 0 };
    equipment.push(instance);
    bySlot[slot] = instanceId;
  }
  return success({ equipment, bySlot });
}

function allocateSkills(root: ContentRootV1, character: CharacterDefinition, level: number): DomainResult<{ readonly levels: Record<string, number>; readonly points: number; readonly equipped: [string | null, string | null] }> {
  const levels = Object.fromEntries(character.activeSkillIds.map((id) => [id, 0]));
  let remaining = level - 1;
  while (remaining > 0) {
    let changed = false;
    for (const id of character.activeSkillIds) {
      const skill = root.skills.find((value) => value.id === id);
      if (!skill) return invalid(`skills.${id}`, "missing_content");
      if (skill.unlockLevel <= level && levels[id] < skill.maxLevel && remaining > 0) {
        levels[id] += 1;
        remaining -= 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const unlocked = (id: string): boolean => {
    const skill = root.skills.find((value) => value.id === id);
    return Boolean(skill && skill.unlockLevel <= level && levels[id] > 0);
  };
  const choose = (ids: readonly (string | null)[]): string | null => ids.find((id): id is string => id !== null && unlocked(id)) ?? null;
  let equipped: [string | null, string | null];
  switch (character.id) {
    case "char_wanderer": equipped = [choose(["skill_wanderer_rending_slash"]), choose(["skill_wanderer_execution", "skill_wanderer_guarding_blow"])]; break;
    case "char_iron_guard": {
      const first = choose(["skill_guard_fortify", "skill_guard_shield_bash"]);
      equipped = [first, choose(["skill_guard_banner", first === "skill_guard_shield_bash" ? null : "skill_guard_shield_bash"])];
      break;
    }
    case "char_ranger": equipped = [choose(["skill_ranger_twin_shot"]), choose(["skill_ranger_marking_arrow"])]; break;
    case "char_ember_mage": equipped = [choose(["skill_ember_fireball"]), choose(["skill_ember_detonate", "skill_ember_flame_wave"])]; break;
    case "char_frost_seer": equipped = [choose(["skill_frost_chill_lance"]), choose(["skill_frost_ice_nova"])]; break;
    case "char_priest": equipped = [choose(["skill_priest_mend"]), choose(["skill_priest_purifying_light", "skill_priest_sanctuary"])]; break;
    default: equipped = [null, null];
  }
  return success({ levels, points: remaining, equipped });
}

function buildSimulationSave(root: ContentRootV1, catalog: ContentCatalog, spec: BalanceProfileSpec, seedIndex: number): DomainResult<GameSaveV1> {
  const source = contentSource(catalog);
  let save: GameSaveV1;
  try {
    save = createNewGameSave(root, "2000-01-01T00:00:00.000Z", { newGameSeed: seedIndex, idFactory: new SequentialIdFactory() });
  } catch (error) {
    return invalid("balance.save", error instanceof Error ? error.message : "new_game_invalid");
  }
  save.inventory.equipment = [];
  save.inventory.skillStones = [];
  save.inventory.overflowEquipment = [];
  save.inventory.overflowSkillStones = [];
  save.inventory.stackables = Object.fromEntries(root.items.map((item) => [item.id, 0]));
  save.world.highestUnlockedFloor = spec.floorNumber;
  save.world.clearedBossEncounterIds = root.floors.filter((floor) => floor.floorNumber < spec.floorNumber).sort((a, b) => a.floorNumber - b.floorNumber).map((floor) => floor.bossEncounterId);
  save.world.bossRetryUnlockedFloorIds = [];
  save.world.storyCompleted = false;
  save.party.slots = [...spec.party] as GameSaveV1["party"]["slots"];
  const partyIds = new Set(spec.party.filter((id): id is string => id !== null));
  for (const definition of root.characters) {
    const progress = save.characters[definition.id];
    if (!progress) return invalid(`characters.${definition.id}`, "missing_progress");
    const isParty = partyIds.has(definition.id);
    progress.recruited = isParty;
    progress.level = isParty ? spec.level : 1;
    progress.xp = 0;
    progress.equipmentBySlot = { weapon: null, helmet: null, armor: null, gloves: null, boots: null, accessory: null };
    progress.skillStoneInstanceId = null;
    const skills = allocateSkills(root, definition, progress.level);
    if (!skills.ok) return skills;
    progress.skillLevels = skills.value.levels;
    progress.skillPoints = skills.value.points;
    const equipped: [string | null, string | null] = [...skills.value.equipped] as [string | null, string | null];
    if (spec.profile === "breakthrough" && spec.floorNumber === 10 && definition.id === "char_ember_mage") {
      const forcedSkillId = "skill_ember_flame_wave";
      const forcedSkill = root.skills.find((skill) => skill.id === forcedSkillId);
      if (!forcedSkill || forcedSkill.unlockLevel > progress.level || (progress.skillLevels[forcedSkillId] ?? 0) < 1) {
        return invalid(`characters.${definition.id}.equippedActiveSkillIds[1]`, "forced_skill_unavailable");
      }
      equipped[1] = forcedSkillId;
    }
    progress.equippedActiveSkillIds = equipped;
    if (!isParty) continue;
    const partySlot = spec.party.indexOf(definition.id);
    const built = buildEquipment(root, spec.profile, spec.floorNumber, definition, partySlot, spec.itemLevel);
    if (!built.ok) return built;
    progress.equipmentBySlot = built.value.bySlot;
    save.inventory.equipment.push(...built.value.equipment);
    const stone = stoneFor(spec.profile, spec.floorNumber);
    if (stone && stone.characterId === definition.id) {
      const stoneRolls: SkillStoneInstance["affixes"] = [];
      for (const id of stone.affixes) {
        const roll = getStoneRoll(id, spec.itemLevel ?? 1, root, true);
        if (!roll) return invalid(`skillAffixes.${id}`, "tier_unavailable");
        stoneRolls.push(roll);
      }
      let abyssAffix: SkillStoneInstance["abyssAffix"] = null;
      if (stone.abyssAffix) {
        const roll = getStoneRoll(stone.abyssAffix, spec.itemLevel ?? 1, root, true);
        if (!roll) return invalid(`skillAffixes.${stone.abyssAffix}`, "tier_unavailable");
        abyssAffix = roll;
      }
      const stoneInstance: SkillStoneInstance = { instanceId: `sim_${spec.profile}_f${String(spec.floorNumber).padStart(2, "0")}_p${partySlot}_stone`, attunedCharacterId: definition.id, itemLevel: spec.itemLevel ?? 1, quality: stone.quality, affixes: stoneRolls, abyssAffix, locked: true, acquiredAt: "2000-01-01T00:00:00.000Z", sourceTransactionId: "balance_fixture", reforgeLockedIndex: null, reforgeCount: 0 };
      save.inventory.skillStones.push(stoneInstance);
      progress.skillStoneInstanceId = stoneInstance.instanceId;
    }
  }
  for (const definition of root.characters) {
    const progress = save.characters[definition.id];
    if (!progress) return invalid(`characters.${definition.id}`, "missing_progress");
    const maxHp = calculateStaticMaxHpForSave(root, source, save, definition.id);
    if (!maxHp.ok) return maxHp;
    progress.currentHp = maxHp.value;
  }
  const map = root.maps.find((value) => value.id === `map_floor_${String(spec.floorNumber).padStart(2, "0")}`);
  const floor = root.floors.find((value) => value.floorNumber === spec.floorNumber);
  if (!map || !floor) return invalid("balance.floor", "missing_content");
  const seed = deriveBalanceSeed(spec.floorNumber, seedIndex)[0];
  save.expedition = { expeditionId: `sim_exp_${spec.profile}_f${String(spec.floorNumber).padStart(2, "0")}_${seedIndex}`, expeditionSeed: seed, mode: "exploration", abyssEchoId: null, floorId: floor.id, mapId: map.id, playerPosition: { ...map.spawnPoint }, safePosition: { ...map.spawnPoint }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: "2000-01-01T00:00:00.000Z" };
  const valid = validateGameSave(save, root);
  if (!valid.ok) return invalid("balance.save", `validation:${valid.error.code}`);
  return success(valid.value);
}

function calculateStaticMaxHpForSave(root: ContentRootV1, source: BalanceContentSource, save: GameSaveV1, characterId: string): DomainResult<number> {
  const content = equipmentContent(root, source);
  const character = source.getCharacter(characterId);
  if (!character.ok) return character;
  const progress = save.characters[characterId];
  if (!progress) return invalid(`characters.${characterId}`, "missing_progress");
  const stats = calculateStats(character.value as unknown as CharacterDefinition, progress.level);
  if (!stats.ok) return stats as DomainResult<number>;
  // 使用与 GameFlow 相同的三段式静态 maxHp；这里只需返回最大生命，战斗基线另算完整八项。
  const modifiers = calculateEquipmentStatModifiers(content, save, characterId);
  if (!modifiers.ok) return modifiers;
  const calculated = calculateStats(character.value as unknown as CharacterDefinition, progress.level, modifiers.value);
  if (!calculated.ok) return calculated as DomainResult<number>;
  return success(calculated.value.stats.maxHp);
}

function createBaselineResolver(root: ContentRootV1, source: BalanceContentSource, save: GameSaveV1) {
  return (character: Readonly<CharacterDefinition>, progress: Readonly<CharacterProgressV1>): DomainResult<BattleStatBaseline> => {
    const content = equipmentContent(root, source);
    const modifiers = calculateEquipmentStatModifiers(content, save, character.id);
    if (!modifiers.ok) return modifiers;
    const stats = calculateStats(character as unknown as CharacterDefinition, progress.level, modifiers.value);
    if (!stats.ok) return stats;
    return success({ prePercentStats: stats.value.prePercentStats, staticPercentByStatBps: stats.value.staticPercentByStatBps, stats: stats.value.stats });
  };
}

function commandTargets(snapshot: Readonly<BattleSnapshotV1>, actorId: string, skill: Readonly<SkillDefinition>): readonly string[] | null {
  if (skill.targetRule === "singleEnemy" || skill.targetRule === "singleAlly" || skill.targetRule === "deadAlly") {
    const primary = selectPrimaryTarget(snapshot, actorId, skill.targetRule, skill.requiresFrontAccess);
    return primary.ok ? [primary.value.targetUnitId] : null;
  }
  return [];
}
function rootActionCount(events: readonly BattleDomainEventV1[]): number { return events.filter((event) => event.type === "ACTION_STARTED").length; }
function alive(unit: Readonly<BattleSnapshotV1["units"][number]>): boolean { return unit.currentHp > 0; }
function hasStatus(unit: Readonly<BattleSnapshotV1["units"][number]>, statusId: string): boolean {
  return unit.statuses.some((status) => status.statusId === statusId);
}
function hpAtMost(unit: Readonly<BattleSnapshotV1["units"][number]>, valueBps: number): boolean {
  return unit.currentHp * 10_000 <= unit.stats.maxHp * valueBps;
}
function stableLowestHp(
  units: readonly BattleSnapshotV1["units"][number][],
  isBoss: (unit: Readonly<BattleSnapshotV1["units"][number]>) => boolean = () => false,
): BattleSnapshotV1["units"][number] | null {
  return [...units].sort((left, right) => Number(!isBoss(left)) - Number(!isBoss(right)) || left.currentHp * right.stats.maxHp - right.currentHp * left.stats.maxHp || left.slot - right.slot || left.unitId.localeCompare(right.unitId))[0] ?? null;
}
function choosePartyCommand(snapshot: Readonly<BattleSnapshotV1>, save: Readonly<GameSaveV1>, catalog: ContentCatalog): DomainResult<BattleCommandV1> {
  const content = contentSource(catalog);
  const actor = snapshot.units.find((unit) => unit.unitId === snapshot.currentUnitId);
  if (!actor || actor.faction !== "party") return invalid("battle.currentUnitId", "party_actor_required");
  const character = content.getCharacter(actor.definitionId);
  if (!character.ok) return character;
  const progress = save.characters[actor.definitionId];
  if (!progress) return invalid(`characters.${actor.definitionId}`, "missing_progress");
  const stoneMap = Object.fromEntries(save.inventory.skillStones.map((stone) => [stone.attunedCharacterId, stone]));
  const skillById = (id: string): DomainResult<Readonly<SkillDefinition>> => content.getSkill(id);
  const commandFor = (id: string, kind: "USE_SKILL" | "USE_ULTIMATE", targetOverride?: readonly string[]): DomainResult<BattleCommandV1> | null => {
    if (!id) return null;
    const skill = skillById(id);
    if (!skill.ok) return skill;
    const targets = targetOverride ?? commandTargets(snapshot, actor.unitId, skill.value);
    if (targets === null) return null;
    const command = kind === "USE_ULTIMATE" ? { type: "USE_ULTIMATE" as const, expectedBattleRevision: snapshot.battleRevision, actorUnitId: actor.unitId, skillId: id, targetUnitIds: [...targets] } : { type: "USE_SKILL" as const, expectedBattleRevision: snapshot.battleRevision, actorUnitId: actor.unitId, skillId: id, targetUnitIds: [...targets] };
    const checked = validateBattleCommand({ snapshot, expedition: save.expedition, command, content, inventory: save.inventory, characters: save.characters, skillStones: stoneMap, skillModifierResolver: new SkillModifierResolver({ getSkillAffix: content.getSkillAffix }) });
    return checked.ok ? success(command) : null;
  };
  const tryEquipped = (id: string | null, targetOverride?: readonly string[]): DomainResult<BattleCommandV1> | null => {
    if (id === null || !progress.equippedActiveSkillIds.includes(id)) return null;
    return commandFor(id, "USE_SKILL", targetOverride);
  };
  const allies = snapshot.units.filter((unit) => unit.faction === "party" && alive(unit));
  const enemies = snapshot.units.filter((unit) => unit.faction === "enemy" && alive(unit));
  const encounter = content.getEncounter(snapshot.encounterId);
  if (!encounter.ok) return encounter;
  const bossIds = new Set(encounter.value.kind === "boss" ? encounter.value.enemyIdsBySlot.filter((id): id is string => id !== null) : []);
  const primaryEnemy = stableLowestHp(enemies, (unit) => bossIds.has(unit.definitionId));
  const deadAlly = snapshot.units.filter((unit) => unit.faction === "party" && !alive(unit));
  const isPriest = character.value.id === "char_priest";

  // 通用终极规则优先于角色主动技能；祭司只有队友倒地时才使用复活终极。
  if (isPriest && deadAlly.length > 0 && actor.energy >= 100) {
    const ultimate = commandFor(character.value.ultimateSkillId, "USE_ULTIMATE");
    if (ultimate) return ultimate;
  } else if (!isPriest && actor.energy >= 100) {
    const guardNeedsUltimate = character.value.id !== "char_iron_guard"
      || allies.some((unit) => hpAtMost(unit, 8_000))
      || allies.filter((unit) => unit.slot < 2).some((unit) => !hasStatus(unit, "status_shield"));
    if (guardNeedsUltimate) {
      const ultimate = commandFor(character.value.ultimateSkillId, "USE_ULTIMATE");
      if (ultimate) return ultimate;
    }
  }

  const equipped = progress.equippedActiveSkillIds;
  switch (character.value.id) {
    case "char_wanderer": {
      const execution = equipped.find((id) => id === "skill_wanderer_execution") ?? null;
      const rending = equipped.find((id) => id === "skill_wanderer_rending_slash") ?? null;
      const guarding = equipped.find((id) => id === "skill_wanderer_guarding_blow") ?? null;
      if (primaryEnemy && hpAtMost(primaryEnemy, 3_500)) {
        const action = tryEquipped(execution, [primaryEnemy.unitId]);
        if (action) return action;
      }
      const rendingAction = tryEquipped(rending, primaryEnemy ? [primaryEnemy.unitId] : undefined);
      if (rendingAction) return rendingAction;
      const guardingAction = tryEquipped(guarding, primaryEnemy ? [primaryEnemy.unitId] : undefined);
      if (guardingAction) return guardingAction;
      break;
    }
    case "char_iron_guard": {
      const fortify = equipped.find((id) => id === "skill_guard_fortify") ?? null;
      const banner = equipped.find((id) => id === "skill_guard_banner") ?? null;
      const shieldBash = equipped.find((id) => id === "skill_guard_shield_bash") ?? null;
      if (!hasStatus(actor, "status_shield")) {
        const action = tryEquipped(fortify);
        if (action) return action;
      }
      if (allies.filter((unit) => !hasStatus(unit, "status_defense_up")).length >= 2) {
        const action = tryEquipped(banner);
        if (action) return action;
      }
      const action = tryEquipped(shieldBash, primaryEnemy ? [primaryEnemy.unitId] : undefined);
      if (action) return action;
      break;
    }
    case "char_ranger": {
      const marking = equipped.find((id) => id === "skill_ranger_marking_arrow") ?? null;
      const twin = equipped.find((id) => id === "skill_ranger_twin_shot") ?? null;
      if (primaryEnemy && !hasStatus(primaryEnemy, "status_marked")) {
        const action = tryEquipped(marking, [primaryEnemy.unitId]);
        if (action) return action;
      }
      const twinAction = tryEquipped(twin, primaryEnemy ? [primaryEnemy.unitId] : undefined);
      if (twinAction) return twinAction;
      const markingAction = tryEquipped(marking, primaryEnemy ? [primaryEnemy.unitId] : undefined);
      if (markingAction) return markingAction;
      break;
    }
    case "char_ember_mage": {
      const fireball = equipped.find((id) => id === "skill_ember_fireball") ?? null;
      const flameWave = equipped.find((id) => id === "skill_ember_flame_wave") ?? null;
      const detonate = equipped.find((id) => id === "skill_ember_detonate") ?? null;
      const burnCount = primaryEnemy?.statuses.filter((status) => status.statusId === "status_burn").length ?? 0;
      if (burnCount >= 3) {
        const action = tryEquipped(detonate, primaryEnemy ? [primaryEnemy.unitId] : undefined);
        if (action) return action;
      }
      if (enemies.length >= 2) {
        const action = tryEquipped(flameWave);
        if (action) return action;
      }
      const fireballAction = tryEquipped(fireball, primaryEnemy ? [primaryEnemy.unitId] : undefined);
      if (fireballAction) return fireballAction;
      const otherAction = tryEquipped(detonate, primaryEnemy ? [primaryEnemy.unitId] : undefined) ?? tryEquipped(flameWave);
      if (otherAction) return otherAction;
      break;
    }
    case "char_frost_seer": {
      const nova = equipped.find((id) => id === "skill_frost_ice_nova") ?? null;
      const lance = equipped.find((id) => id === "skill_frost_chill_lance") ?? null;
      if (primaryEnemy && !hasStatus(primaryEnemy, "status_freeze")) {
        const action = tryEquipped(nova, [primaryEnemy.unitId]);
        if (action) return action;
      }
      const lanceAction = tryEquipped(lance, primaryEnemy ? [primaryEnemy.unitId] : undefined);
      if (lanceAction) return lanceAction;
      const novaAction = tryEquipped(nova, primaryEnemy ? [primaryEnemy.unitId] : undefined);
      if (novaAction) return novaAction;
      break;
    }
    case "char_priest": {
      const mend = equipped.find((id) => id === "skill_priest_mend") ?? null;
      const purifying = equipped.find((id) => id === "skill_priest_purifying_light") ?? null;
      const sanctuary = equipped.find((id) => id === "skill_priest_sanctuary") ?? null;
      const debuffed = allies.filter((unit) => unit.statuses.some((status) => {
        const definition = content.getStatus(status.statusId);
        return definition.ok && definition.value.polarity === "debuff" && definition.value.canDispel;
      }));
      if (debuffed.length > 0) {
        const target = stableLowestHp(debuffed);
        const action = tryEquipped(purifying, target ? [target.unitId] : undefined);
        if (action) return action;
      }
      const low = allies.filter((unit) => hpAtMost(unit, 7_000));
      if (low.length > 0) {
        const target = stableLowestHp(low);
        const action = tryEquipped(mend, target ? [target.unitId] : undefined);
        if (action) return action;
      }
      if (allies.filter((unit) => hpAtMost(unit, 8_500)).length >= 2) {
        const action = tryEquipped(sanctuary);
        if (action) return action;
      }
      break;
    }
    default:
      break;
  }

  // 角色规则没有可用主动时，才按合同尝试基础攻击和防御。
  const basic = skillById(character.value.basicSkillId);
  if (basic.ok) {
    const targets = commandTargets(snapshot, actor.unitId, basic.value);
    if (targets !== null) {
      const command: BattleCommandV1 = { type: "USE_BASIC", expectedBattleRevision: snapshot.battleRevision, actorUnitId: actor.unitId, targetUnitIds: [...targets] };
      const checked = validateBattleCommand({ snapshot, expedition: save.expedition, command, content, inventory: save.inventory, characters: save.characters, skillStones: stoneMap, skillModifierResolver: new SkillModifierResolver({ getSkillAffix: content.getSkillAffix }) });
      if (checked.ok) return success(command);
    }
  }
  return success({ type: "DEFEND", expectedBattleRevision: snapshot.battleRevision, actorUnitId: actor.unitId });
}

interface BalanceContentSource extends BattleContentSource {
  readonly getRoot: () => Readonly<ContentRootV1>;
  readonly getStatus: (id: string) => DomainResult<Readonly<import("../src/content/contracts").StatusDefinition>>;
  readonly getEncounter: (id: string) => DomainResult<Readonly<EncounterDefinition>>;
  readonly getItem: (id: string) => DomainResult<Readonly<import("../src/content/contracts").StackableItemDefinition>>;
  readonly getAbyssEcho: (id: string) => DomainResult<Readonly<import("../src/content/contracts").AbyssEchoDefinition>>;
  readonly getEquipmentBase: (id: string) => DomainResult<Readonly<EquipmentBaseDefinition>>;
  readonly getEquipmentAffix: (id: string) => DomainResult<Readonly<EquipmentAffixDefinition>>;
  readonly getCombo: (id: string) => DomainResult<Readonly<import("../src/content/contracts").ComboDefinition>>;
  readonly getSkillAffix: (id: string) => DomainResult<Readonly<import("../src/content/contracts").SkillAffixDefinition>>;
}

interface DeclaredComboCheck {
  readonly id: string | null;
  readonly matched: boolean;
}

/**
 * 开战前只按当前存档做静态配方匹配，不能用战斗中已经触发的 Combo 代替门禁。
 * 普通档位没有声明配方，因此只返回未声明状态；突破/替代档位必须命中精确 ID。
 */
function validateDeclaredCombo(
  root: ContentRootV1,
  source: BalanceContentSource,
  save: GameSaveV1,
  spec: BalanceProfileSpec,
): DomainResult<DeclaredComboCheck> {
  const comboId = declaredComboId(spec);
  if (comboId === null) return success({ id: null, matched: false });
  const definition = source.getCombo(comboId);
  if (!definition.ok) return definition;
  const matcher = new ComboMatcher({
    getCharacter: source.getCharacter,
    getSkill: source.getSkill,
    getEquipmentBase: source.getEquipmentBase,
    getEquipmentAffix: source.getEquipmentAffix,
    getSkillAffix: source.getSkillAffix,
    getCombo: source.getCombo,
  });
  if (definition.value.scope === "party") {
    const matched = matcher.matchParty({
      party: save.party,
      characters: save.characters,
      inventory: save.inventory,
      comboIds: [comboId],
    });
    if (!matched.ok) return matched;
    if (matched.value.matchedComboIds.includes(comboId)) return success({ id: comboId, matched: true });
  } else {
    for (const characterId of save.party.slots) {
      if (characterId === null) continue;
      const character = save.characters[characterId];
      if (!character) return invalid(`characters.${characterId}`, "missing_progress");
      const matched = matcher.matchPersonal({ character, inventory: save.inventory, comboIds: [comboId] });
      if (!matched.ok) return matched;
      if (matched.value.matchedComboIds.includes(comboId)) return success({ id: comboId, matched: true });
    }
  }
  return invalid(`combos.${comboId}`, "declared_combo_not_matched");
}

function contentSource(catalog: ContentCatalog): BalanceContentSource {
  return {
    getRoot: () => catalog.getRoot() as unknown as Readonly<ContentRootV1>,
    getCharacter: adaptCatalogGetter<CharacterDefinition>(catalog.getCharacter.bind(catalog) as (id: string) => DomainResult<unknown>),
    getSkill: adaptCatalogGetter<SkillDefinition>(catalog.getSkill.bind(catalog) as (id: string) => DomainResult<unknown>),
    getEnemy: adaptCatalogGetter<import("../src/content/contracts").EnemyDefinition>(catalog.getEnemy.bind(catalog) as (id: string) => DomainResult<unknown>),
    getEncounter: adaptCatalogGetter<EncounterDefinition>(catalog.getEncounter.bind(catalog) as (id: string) => DomainResult<unknown>),
    getMap: adaptCatalogGetter<import("../src/content/contracts").MapDefinition>(catalog.getMap.bind(catalog) as (id: string) => DomainResult<unknown>),
    getStatus: adaptCatalogGetter<import("../src/content/contracts").StatusDefinition>(catalog.getStatus.bind(catalog) as (id: string) => DomainResult<unknown>),
    getItem: adaptCatalogGetter<import("../src/content/contracts").StackableItemDefinition>(catalog.getItem.bind(catalog) as (id: string) => DomainResult<unknown>),
    getAbyssEcho: adaptCatalogGetter<import("../src/content/contracts").AbyssEchoDefinition>(catalog.getAbyssEcho.bind(catalog) as (id: string) => DomainResult<unknown>),
    getEquipmentBase: adaptCatalogGetter<EquipmentBaseDefinition>(catalog.getEquipmentBase.bind(catalog) as (id: string) => DomainResult<unknown>),
    getEquipmentAffix: adaptCatalogGetter<EquipmentAffixDefinition>(catalog.getEquipmentAffix.bind(catalog) as (id: string) => DomainResult<unknown>),
    getCombo: adaptCatalogGetter<import("../src/content/contracts").ComboDefinition>(catalog.getCombo.bind(catalog) as (id: string) => DomainResult<unknown>),
    getSkillAffix: adaptCatalogGetter<import("../src/content/contracts").SkillAffixDefinition>(catalog.getSkillAffix.bind(catalog) as (id: string) => DomainResult<unknown>),
  };
}

function equipmentContent(root: ContentRootV1, source: BalanceContentSource) {
  return {
    equipmentBases: root.equipmentBases,
    equipmentAffixes: root.equipmentAffixes,
    economy: root.economy,
    characters: root.characters,
    skills: root.skills,
    getCharacter: source.getCharacter,
    getSkill: source.getSkill,
  };
}

function makeComboRuntime(save: GameSaveV1, catalog: ContentCatalog): DomainResult<BattleComboRuntimeAdapter | undefined> {
  const content = contentSource(catalog);
  const result = createBattleComboRuntime({ save, content: { getRoot: content.getRoot, getCharacter: content.getCharacter, getSkill: content.getSkill, getEquipmentBase: content.getEquipmentBase, getEquipmentAffix: content.getEquipmentAffix, getSkillAffix: content.getSkillAffix, getCombo: content.getCombo } });
  return result;
}

function rootEffectsForCommand(
  skill: Readonly<SkillDefinition> | null,
  skillLevel: number,
  item: Readonly<import("../src/content/contracts").ConsumableItemDefinition> | null,
): readonly EffectSpec[] {
  if (item !== null) return item.effects;
  if (skill === null) return [];
  return skill.effectsByLevel[Math.max(0, Math.min(4, skillLevel - 1))];
}

/** 把领域事件重新接入模拟器的单一 trace；周期运行时不能沿用局部 sequence。 */
function appendBalanceEvents(
  target: BattleDomainEventV1[],
  events: readonly BattleDomainEventV1[],
): void {
  for (const event of events) target.push({ ...event, sequence: target.length });
}

function periodicEnemyElements(
  content: BalanceContentSource,
  target: Readonly<BattleSnapshotV1["units"][number]>,
): DomainResult<{ readonly weaknesses: readonly Element[]; readonly resistances: readonly Element[] }> {
  if (target.faction !== "enemy") return success({ weaknesses: [], resistances: [] });
  let result: DomainResult<Readonly<import("../src/content/contracts").EnemyDefinition>>;
  try {
    result = content.getEnemy(target.definitionId);
  } catch {
    return invalid(`enemies.${target.definitionId}`, "getter_failed");
  }
  if (!result.ok) return result;
  if (result.value.id !== target.definitionId) return invalid(`enemies.${target.definitionId}`, "id_mismatch");
  return success({ weaknesses: result.value.elementWeaknesses, resistances: result.value.elementResistances });
}

/** 记录周期伤害，sourceKind 必须与正式指标合同保持一致。 */
function addPeriodicDamageMetric(
  snapshot: BattleSnapshotV1,
  source: Readonly<BattleSnapshotV1["units"][number]>,
  pending: Readonly<PendingBattleEventV1>,
  element: Element,
  resolvedDamage: number,
  weakness: boolean,
): void {
  const sourceDefinitionId = pending.triggerSource?.kind === "status"
    ? pending.triggerSource.statusId
    : pending.effect.kind === "damage" ? pending.effect.element : "status";
  const existing = snapshot.metrics.damage.find((value) => value.sourceFaction === source.faction
    && value.sourceKind === "status"
    && value.sourceDefinitionId === sourceDefinitionId
    && value.element === element);
  if (existing) {
    existing.resolvedDamage += resolvedDamage;
    if (weakness) existing.weaknessResolvedDamage += resolvedDamage;
    return;
  }
  snapshot.metrics.damage.push({
    sourceFaction: source.faction,
    sourceKind: "status",
    sourceDefinitionId,
    element,
    resolvedDamage,
    weaknessResolvedDamage: weakness ? resolvedDamage : 0,
  });
}

function setPeriodicOutcome(snapshot: BattleSnapshotV1): void {
  const partyAlive = snapshot.units.some((unit) => unit.faction === "party" && alive(unit));
  const enemyAlive = snapshot.units.some((unit) => unit.faction === "enemy" && alive(unit));
  // 失败优先，避免周期伤害同时击倒双方时误报胜利。
  if (!partyAlive) {
    snapshot.outcome = "defeat";
    snapshot.phase = "DEFEAT";
  } else if (!enemyAlive) {
    snapshot.outcome = "victory";
    snapshot.phase = "VICTORY";
  }
}

/** 按 FIFO 消费周期 Pending；Pending 自身不是领域事件，消费后只输出完整伤害事件。 */
function applyPeriodicPendingEvents(
  snapshot: BattleSnapshotV1,
  pendingEvents: readonly PendingBattleEventV1[],
  content: BalanceContentSource,
  allEvents: BattleDomainEventV1[],
  nextId: (kind: "root" | "event") => string,
): DomainResult<true> {
  for (const pending of pendingEvents) {
    if (pending.effect.kind !== "damage") return invalid(`pendingEvents.${pending.eventId}.effect`, "periodic_damage_required");
    const source = snapshot.units.find((unit) => unit.unitId === pending.sourceUnitId);
    if (!source) return invalid(`pendingEvents.${pending.eventId}.sourceUnitId`, "missing_unit");
    for (const targetUnitId of pending.targetUnitIds) {
      const target = snapshot.units.find((unit) => unit.unitId === targetUnitId);
      if (!target) return invalid(`pendingEvents.${pending.eventId}.targetUnitIds`, "missing_unit");
      // 状态到期仍然要生成/消费 Pending，但已经死亡的目标不再消耗 RNG 或重复结算。
      if (!alive(target)) continue;
      const elements = periodicEnemyElements(content, target);
      if (!elements.ok) return elements;
      const rng = SeededRng.fromState(snapshot.rngState);
      const resolved = resolveDamage({
        attacker: source,
        target,
        effect: pending.effect,
        rng,
        getStatus: content.getStatus,
        targetElementWeaknesses: elements.value.weaknesses,
        targetElementResistances: elements.value.resistances,
      });
      if (!resolved.ok) return resolved;
      snapshot.rngState = [...rng.getState()];
      updateSimulationUnit(snapshot, resolved.value.nextTarget);
      const result = resolved.value;
      const total = result.shieldDamage + result.hpDamage;
      const damageEvent: BattleDomainEventV1 = {
        type: "DAMAGE_RESOLVED",
        // Pending 的 eventId 只用于队列身份；实际领域事件必须重新分配事件 ID。
        eventId: nextId("event"),
        sequence: allEvents.length,
        battleId: snapshot.battleId,
        round: snapshot.round,
        rootActionId: pending.rootActionId,
        rootActionDefinitionId: pending.rootActionDefinitionId,
        chainDepth: pending.chainDepth,
        triggerSource: pending.triggerSource,
        visualSkillId: pending.visualSkillId,
        contextSkillKind: pending.contextSkillKind,
        effect: pending.effect,
        sourceUnitId: source.unitId,
        targetUnitId: target.unitId,
        effectIndex: pending.effectIndex,
        hitIndex: 0,
        damageKind: "periodic",
        element: pending.effect.element,
        hitResult: result.hitResult,
        varianceBps: result.varianceBps,
        effectiveDefense: result.effectiveDefense,
        elementMultiplierBps: result.elementMultiplierBps,
        shieldDamage: result.shieldDamage,
        hpDamage: result.hpDamage,
        overkill: result.overkill,
        hpBefore: result.hpBefore,
        hpAfter: result.hpAfter,
      };
      appendBalanceEvents(allEvents, [damageEvent]);
      addPeriodicDamageMetric(snapshot, source, pending, pending.effect.element, total, result.elementMultiplierBps === 12_500);
      if (source.faction === "enemy" && target.faction === "party") snapshot.metrics.partyDamageTaken += total;
      setPeriodicOutcome(snapshot);
      if (snapshot.phase === "VICTORY" || snapshot.phase === "DEFEAT") break;
    }
    if (snapshot.phase === "VICTORY" || snapshot.phase === "DEFEAT") break;
  }
  snapshot.pendingEvents = [];
  return success(true);
}

/** 在三个冻结时点运行状态表；状态 getter 的失败不能被周期层静默吞掉。 */
function runPeriodicStatuses(
  snapshot: BattleSnapshotV1,
  unitId: string,
  timing: "turnStart" | "afterAction" | "turnEnd",
  content: BalanceContentSource,
  allEvents: BattleDomainEventV1[],
  nextId: (kind: "root" | "event") => string,
  context: Partial<StatusEventContext> & {
    readonly directDamageDealt?: boolean;
    readonly directDamageAmount?: number;
  } = {},
): DomainResult<true> {
  const unit = snapshot.units.find((value) => value.unitId === unitId);
  if (!unit) return invalid(`units.${unitId}`, "missing_unit");
  let getterError: import("../src/domain/common/DomainResult").DomainErrorV1 | null = null;
  const statusGetter = (statusId: string): Readonly<import("../src/content/contracts").StatusDefinition> | undefined => {
    let result: DomainResult<Readonly<import("../src/content/contracts").StatusDefinition>>;
    try {
      result = content.getStatus(statusId);
    } catch {
      getterError = createDomainError("INVALID_CONTENT", { path: `statuses.${statusId}`, issueKey: "getter_failed" });
      return undefined;
    }
    if (!result.ok) {
      getterError = result.error;
      return undefined;
    }
    if (result.value.id !== statusId) {
      getterError = createDomainError("INVALID_CONTENT", { path: `statuses.${statusId}`, issueKey: "id_mismatch" });
      return undefined;
    }
    return result.value;
  };
  const periodic = createPeriodicStatusEvents({
    unit,
    timing,
    getStatus: statusGetter,
    eventContext: {
      battleId: snapshot.battleId,
      round: snapshot.round,
      phase: timing === "turnStart" ? "TURN_START" : timing === "turnEnd" ? "TURN_END" : "DRAIN_TRIGGERS",
      currentUnitId: snapshot.currentUnitId,
      targetUnitId: unitId,
      ...context,
      nextEventId: () => nextId("event"),
    },
    nextEventId: () => nextId("event"),
    directDamageDealt: context.directDamageDealt,
    directDamageAmount: context.directDamageAmount,
  });
  if (!periodic.ok) return getterError ? failure(getterError) : periodic;
  if (getterError) return failure(getterError);
  updateSimulationUnit(snapshot, periodic.value.unit);
  appendBalanceEvents(allEvents, periodic.value.events);
  const applied = applyPeriodicPendingEvents(snapshot, periodic.value.pendingEvents, content, allEvents, nextId);
  if (!applied.ok) return applied;
  setPeriodicOutcome(snapshot);
  return success(true);
}

function updateSimulationUnit(snapshot: BattleSnapshotV1, updated: BattleSnapshotV1["units"][number]): void {
  const index = snapshot.units.findIndex((unit) => unit.unitId === updated.unitId);
  if (index < 0) throw new Error(`找不到战斗单位 ${updated.unitId}`);
  snapshot.units[index] = updated;
}

function advanceBattle(snapshot: BattleSnapshotV1, save: GameSaveV1, catalog: ContentCatalog, nextId: (kind: "root" | "event") => string): DomainResult<{ readonly snapshot: BattleSnapshotV1; readonly events: readonly BattleDomainEventV1[] }> {
  const allEvents: BattleDomainEventV1[] = [];
  let current = clone(snapshot);
  const content = contentSource(catalog);
  for (let guard = 0; guard < 20_000; guard += 1) {
    if (current.phase === "VICTORY" || current.phase === "DEFEAT" || current.phase === "RETREAT" || current.phase === "COMPLETE") return success({ snapshot: current, events: allEvents });
    if (current.round >= BALANCE_MAX_ROUNDS && (current.phase === "ROUND_END" || current.phase === "TURN_START" || current.phase === "ROUND_START")) return success({ snapshot: current, events: allEvents });
    if (current.phase === "INIT") {
      const reduced = reduceBattle(current, { type: "ROUND_START" }, { getEnemy: content.getEnemy, getStatus: content.getStatus });
      if (!reduced.ok) return reduced;
      current = reduced.value;
      continue;
    }
    if (current.phase === "ROUND_START") {
      const reduced = reduceBattle(current, { type: "TURN_START" }, { getEnemy: content.getEnemy, getStatus: content.getStatus });
      if (!reduced.ok) return reduced;
      current = reduced.value;
      if (current.currentUnitId !== null && current.phase !== "ROUND_END") {
        const periodic = runPeriodicStatuses(current, current.currentUnitId, "turnStart", content, allEvents, nextId);
        if (!periodic.ok) return periodic;
      }
      continue;
    }
    if (current.phase === "TURN_START") {
      const reduced = reduceBattle(current, { type: "TURN_START" }, { getEnemy: content.getEnemy, getStatus: content.getStatus });
      if (!reduced.ok) return reduced;
      current = reduced.value;
      if (current.currentUnitId !== null && current.phase !== "ROUND_END") {
        const periodic = runPeriodicStatuses(current, current.currentUnitId, "turnStart", content, allEvents, nextId);
        if (!periodic.ok) return periodic;
      }
      continue;
    }
    if (current.phase === "TURN_END") {
      if (current.currentUnitId !== null) {
        const periodic = runPeriodicStatuses(current, current.currentUnitId, "turnEnd", content, allEvents, nextId);
        if (!periodic.ok) return periodic;
        if (current.outcome !== "ongoing") continue;
      }
      const reduced = reduceBattle(current, { type: "TURN_END" }, { getEnemy: content.getEnemy, getStatus: content.getStatus });
      if (!reduced.ok) return reduced;
      current = reduced.value;
      continue;
    }
    if (current.phase === "ROUND_END") {
      const reduced = reduceBattle(current, { type: "ROUND_END" }, { getEnemy: content.getEnemy, getStatus: content.getStatus });
      if (!reduced.ok) return reduced;
      current = reduced.value;
      continue;
    }
    if (current.phase === "RESOLVE_ACTION") {
      const first = reduceBattle(current, { type: "RESOLVE_ACTION_COMPLETE" }, { getEnemy: content.getEnemy, getStatus: content.getStatus });
      if (!first.ok) return first;
      const second = reduceBattle(first.value, { type: "DRAIN_TRIGGERS_COMPLETE" }, { getEnemy: content.getEnemy, getStatus: content.getStatus });
      if (!second.ok) return second;
      current = second.value;
      continue;
    }
    if (current.phase === "DRAIN_PRE_ACTION") {
      const reduced = reduceBattle(current, { type: "DRAIN_PRE_ACTION_COMPLETE" }, { getEnemy: content.getEnemy, getStatus: content.getStatus });
      if (!reduced.ok) return reduced;
      current = reduced.value;
      continue;
    }
    if (current.phase === "DRAIN_TRIGGERS") {
      const reduced = reduceBattle(current, { type: "DRAIN_TRIGGERS_COMPLETE" }, { getEnemy: content.getEnemy, getStatus: content.getStatus });
      if (!reduced.ok) return reduced;
      current = reduced.value;
      continue;
    }
    if (current.phase === "AWAIT_COMMAND" || current.phase === "AI_DECIDE" || current.phase === "VALIDATE") {
      save.battle = current;
      const actor = current.units.find((unit) => unit.unitId === current.currentUnitId);
      if (!actor) return invalid("battle.currentUnitId", "missing_actor");
      let commandResult: DomainResult<BattleCommandV1>;
      if (actor.faction === "party") commandResult = choosePartyCommand(current, save, catalog);
      else {
        const enemy = content.getEnemy(actor.definitionId);
        if (!enemy.ok) return enemy;
        const decision = decideEnemyAction({ snapshot: current, actorUnitId: actor.unitId, enemy: enemy.value, content, rng: SeededRng.fromState(current.rngState) });
        if (!decision.ok) return decision;
        commandResult = success(decision.value.command);
      }
      if (!commandResult.ok) return commandResult;
      const checked = validateBattleCommand({ snapshot: current, expedition: save.expedition, command: commandResult.value, content, inventory: save.inventory, characters: save.characters, skillStones: Object.fromEntries(save.inventory.skillStones.map((stone) => [stone.attunedCharacterId, stone])), skillModifierResolver: new SkillModifierResolver({ getSkillAffix: content.getSkillAffix }) });
      if (!checked.ok) return checked;
      const combo = makeComboRuntime(save, catalog);
      if (!combo.ok) return combo;
      const resolution = resolveBattleAction({ snapshot: current, command: commandResult.value, skill: checked.value.skill, skillKind: checked.value.skillKind, skillLevel: checked.value.skillLevel, item: checked.value.item, skillModifierResolution: checked.value.skillModifierResolution, content, comboRuntime: combo.value, dynamicModifierResolver: ({ actor: source, target, effect, skill, round }) => resolveBattleDynamicModifiers({ save, actor: source, target, effect, skill, round, content: { getCharacter: content.getCharacter, getSkill: content.getSkill, getEquipmentAffix: content.getEquipmentAffix, getStatus: content.getStatus } }), rng: SeededRng.fromState(current.rngState), nextId });
      if (!resolution.ok) return resolution;
      allEvents.push(...resolution.value.events);
      let resolvedSnapshot = resolution.value.snapshot;
      // 直接命中后按事件顺序生成 bleed 等 afterAction 周期事件；终局不再追加新周期。
      if (!["VICTORY", "DEFEAT", "COMPLETE"].includes(resolvedSnapshot.phase)) {
        for (const event of resolution.value.events) {
          if (event.type !== "DAMAGE_RESOLVED" || event.damageKind !== "direct") continue;
          const directDamageAmount = event.shieldDamage + event.hpDamage;
          if (directDamageAmount <= 0) continue;
          const periodic = runPeriodicStatuses(
            resolvedSnapshot,
            event.targetUnitId,
            "afterAction",
            content,
            allEvents,
            nextId,
            {
              rootActionId: event.rootActionId,
              rootActionDefinitionId: event.rootActionDefinitionId,
              chainDepth: event.chainDepth,
              triggerSource: event.triggerSource,
              visualSkillId: event.visualSkillId,
              contextSkillKind: event.contextSkillKind,
              directDamageDealt: true,
              directDamageAmount,
            },
          );
          if (!periodic.ok) return periodic;
          if (resolvedSnapshot.phase === "VICTORY" || resolvedSnapshot.phase === "DEFEAT") break;
        }
      }
      // ActionResolver 保持“召唤由 reducer 接管”的边界；模拟器在根行动
      // 成功且仍未终局时，按技能/物品效果原顺序逐条交给正式 reducer，不能
      // 直接把单位塞进快照，也不能在终局后凭空复活敌方。
      if (!["VICTORY", "DEFEAT", "COMPLETE"].includes(resolvedSnapshot.phase)) {
        for (const effect of rootEffectsForCommand(checked.value.skill, checked.value.skillLevel, checked.value.item)) {
          if (effect.kind !== "summon") continue;
          const reduced = reduceBattle(resolvedSnapshot, {
            type: "UNIT_SUMMONED",
            enemyId: effect.enemyId,
            preferredSlots: effect.preferredSlots,
            maxAliveCopies: effect.maxAliveCopies,
          }, { getEnemy: content.getEnemy, getStatus: content.getStatus });
          if (!reduced.ok) return reduced;
          resolvedSnapshot = reduced.value;
        }
      }
      current = resolvedSnapshot;
      continue;
    }
    return invalid("battle.phase", "unsupported_simulation_phase");
  }
  return invalid("battle", "simulation_guard_exhausted");
}

function buildBattle(root: ContentRootV1, source: BalanceContentSource, save: GameSaveV1, spec: BalanceProfileSpec, seedIndex: number): DomainResult<BattleSnapshotV1> {
  const floor = root.floors.find((value) => value.floorNumber === spec.floorNumber);
  const map = root.maps.find((value) => value.id === `map_floor_${String(spec.floorNumber).padStart(2, "0")}`);
  if (!floor || !map || !save.expedition) return invalid("balance.floor", "missing_content");
  const encounter = root.encounters.find((value) => value.id === floor.bossEncounterId);
  const object = map.objects.find((value) => value.kind === "encounter" && value.encounterId === floor.bossEncounterId);
  if (!encounter || !object || object.kind !== "encounter") return invalid("balance.boss", "missing_encounter_object");
  const rngState = deriveBalanceSeed(spec.floorNumber, seedIndex);
  const factory = new BattleFactory(source, {});
  const input: BattleFactoryInput = { battleId: `sim_battle_${spec.profile}_f${String(spec.floorNumber).padStart(2, "0")}_${seedIndex}`, expedition: save.expedition, map, encounter, encounterObject: object, party: save.party, characters: save.characters, returnMapId: map.id, returnSafePosition: save.expedition.safePosition, comboIds: root.combos.map((combo) => combo.id), rngState, calculateCharacterBaseline: createBaselineResolver(root, source, save) };
  return factory.create(input);
}

function runOne(root: ContentRootV1, catalog: ContentCatalog, spec: BalanceProfileSpec, seedIndex: number): DomainResult<BalanceBattleResultV1> {
  const source = contentSource(catalog);
  const saveResult = buildSimulationSave(root, catalog, spec, seedIndex);
  if (!saveResult.ok) return saveResult;
  const save = saveResult.value;
  const declared = validateDeclaredCombo(root, source, save, spec);
  if (!declared.ok) return declared;
  const battleResult = buildBattle(root, source, save, spec, seedIndex);
  if (!battleResult.ok) return battleResult;
  const nextIdCounters = { root: 0, event: 0 };
  const nextId = (kind: "root" | "event"): string => `${kind}_sim_${++nextIdCounters[kind]}`;
  const simulated = advanceBattle(battleResult.value, save, catalog, nextId);
  if (!simulated.ok) return simulated;
  const finalBattle = simulated.value.snapshot;
  const resultEvents = simulated.value.events;
  const initialEnemyUnitIds = new Set(battleResult.value.units.filter((unit) => unit.faction === "enemy").map((unit) => unit.unitId));
  const summonedEnemyIds = finalBattle.units
    .filter((unit) => unit.faction === "enemy" && !initialEnemyUnitIds.has(unit.unitId))
    .map((unit) => unit.definitionId);
  const outcome: BalanceBattleResultV1["outcome"] = finalBattle.outcome === "victory" ? "victory" : finalBattle.outcome === "defeat" ? "defeat" : "timeout";
  const boss = finalBattle.units.filter((unit) => unit.faction === "enemy").sort((a, b) => a.slot - b.slot)[0];
  const activatedComboIds = root.combos.filter((combo) => finalBattle.metrics.comboTriggerCounts[combo.id] !== undefined && combo.id.startsWith("combo_")).map((combo) => combo.id).filter((id) => finalBattle.metrics.comboTriggerCounts[id] > 0);
  const extraActivatedComboIds = activatedComboIds.filter((id) => id !== declared.value.id);
  return success({ contentVersion: BALANCE_CONTENT_VERSION, floorNumber: spec.floorNumber, profile: spec.profile, seedIndex, seedNamespace: balanceSeedNamespace(spec.floorNumber, seedIndex), initialRngState: deriveBalanceSeed(spec.floorNumber, seedIndex), activatedComboIds, extraActivatedComboIds, declaredComboId: declared.value.id, declaredComboMatched: declared.value.matched, outcome, endRound: finalBattle.round, rootActionCount: rootActionCount(resultEvents), bossEnrageCast: resultEvents.some((event) => event.type === "ACTION_STARTED" && event.rootActionDefinitionId === "skill_boss_enrage"), partyKnockoutCount: finalBattle.metrics.knockouts.length, bossRemainingHp: boss?.currentHp ?? 0, summonedEnemyIds, partyDamageTaken: finalBattle.metrics.partyDamageTaken, partyHealingDone: finalBattle.metrics.partyHealingDone, partyShieldGranted: finalBattle.metrics.partyShieldGranted, damageBySource: finalBattle.metrics.damage, comboTriggerCounts: finalBattle.metrics.comboTriggerCounts, maxChainDepth: finalBattle.metrics.maxChainDepth, triggerBudgetExhaustedCount: finalBattle.metrics.triggerBudgetExhaustedCount, finalRngState: [...finalBattle.rngState] });
}

/** 正式档使用真实累计内容；smoke 仍保留缺正式批次阻断语义。 */
export function runBalanceSimulation(options: BalanceSimulationOptions = {}): DomainResult<BalanceSimulationSummary> {
  const floors = options.floors ?? [1];
  const profiles = options.profiles ?? BALANCE_PROFILES;
  const seeds = options.seeds ?? 20;
  if (floors.some((floor) => !assertFloor(floor)) || profiles.some((profile) => !BALANCE_PROFILES.includes(profile)) || !Number.isSafeInteger(seeds) || seeds < 1) return invalid("balance.options", "range");
  const formalAvailable = options.fixture === "formal" || options.formalContentAvailable === true;
  if (!formalAvailable) return success({ blocked: true, reason: "MISSING_FORMAL_CONTENT_BATCH", contentVersion: BALANCE_CONTENT_VERSION, requestedFloors: floors, profiles, seeds, results: [] });
  const catalogResult = ContentCatalog.create(abyssEchoContentRoot, "final");
  if (!catalogResult.ok) return invalid("content", "formal_catalog_invalid");
  const root = catalogResult.value.getRoot() as unknown as ContentRootV1;
  const results: BalanceBattleResultV1[] = [];
  for (const floor of floors) {
    for (const seedIndex of Array.from({ length: seeds }, (_, index) => index)) {
      for (const profile of profiles) {
        const spec = buildBalanceProfiles(floor).find((candidate) => candidate.profile === profile);
        if (!spec) return invalid(`balance.profiles.${profile}`, "missing_spec");
        const result = runOne(root, catalogResult.value, spec, seedIndex);
        if (!result.ok) return result;
        results.push(result.value);
      }
    }
  }
  return success({ blocked: false, contentVersion: BALANCE_CONTENT_VERSION, requestedFloors: floors, profiles, seeds, results });
}

function parseArgs(argv: readonly string[]): BalanceSimulationOptions {
  let fixture: "smoke" | "formal" = "formal";
  let floors: number[] | undefined;
  let seeds = 20;
  let profiles: BalanceProfile[] | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--fixture" && (value === "smoke" || value === "formal")) { fixture = value; index += 1; }
    else if (arg === "--seeds" && value) { seeds = Number(value); index += 1; }
    else if (arg === "--floors" && value) { floors = value.split(",").flatMap((part) => { const range = part.split("-").map(Number); return range.length === 2 && Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[1] >= range[0] ? Array.from({ length: range[1] - range[0] + 1 }, (_, offset) => range[0] + offset) : [Number(part)]; }); index += 1; }
    else if (arg === "--profiles" && value) { profiles = value.split(",") as BalanceProfile[]; index += 1; }
  }
  return { fixture, floors, seeds, profiles };
}
function main(): void {
  const result = runBalanceSimulation(parseArgs(process.argv.slice(2)));
  if (!result.ok) { console.error(JSON.stringify({ ok: false, error: result.error })); process.exitCode = 1; return; }
  const summary = result.value;
  console.log(JSON.stringify({ type: "balance-summary", ...summary, aggregates: aggregateBalanceResults(summary.results) }));
}
if (process.env.VITEST !== "true") main();
