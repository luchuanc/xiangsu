import type { AffixTriggerDefinition, BossIntentDefinition, EffectSpec, TriggerSpec } from "../contracts";

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

function damage(targetRule: Extract<EffectSpec, { kind: "damage" }>["targetRule"], element: Extract<EffectSpec, { kind: "damage" }>["element"], powerBps: number, canCrit: boolean, hitCount = 1, retargetEachHit = false): EffectSpec {
  return { kind: "damage", targetRule, element, powerBps, flatPower: 0, canCrit, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount, retargetEachHit, conditionalMultipliers: [] };
}

function applyStatus(targetRule: Extract<EffectSpec, { kind: "applyStatus" }>["targetRule"], statusId: string, baseChanceBps: number, stacks: number, durationOwnerTurns: number): EffectSpec {
  return { kind: "applyStatus", targetRule, statusId, baseChanceBps, stacks, durationOwnerTurns };
}

const triggerBudget = { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 999 } as const;
function affixTrigger(id: string, triggerSpec: TriggerSpec, effects: EffectSpec[], budget = triggerBudget): AffixTriggerDefinition {
  return { id, trigger: triggerSpec, chance: { kind: "affixRoll", scaleBps: 10_000 }, effects, budget };
}

/** RPG-025 深渊词条触发器；10 个回响不在本批提前注册。 */
export const abyssAffixTriggers: readonly AffixTriggerDefinition[] = Object.freeze([
  affixTrigger("tr_abyss_twinstrike", trigger("afterDirectHit", { requiredSkillKinds: ["basic"] }), [damage("singleEnemy", "physical", 7000, true)]),
  affixTrigger("tr_abyss_soulburn", trigger("afterDirectHit", { requiredTargetStatusIds: ["status_burn"] }), [
    { kind: "consumeStatus", targetRule: "singleEnemy", statusId: "status_burn", stacks: 3 },
    damage("singleEnemy", "dark", 10_000, false),
  ]),
  affixTrigger("tr_abyss_bloodmoon", trigger("afterDirectHit", { requiredSourceHpAtMostBps: 4000 }), [{ kind: "heal", targetRule: "self", scalingStat: "attack", powerBps: 2500, flatPower: 0, canCrit: false }]),
  affixTrigger("tr_abyss_permafrost", trigger("afterDirectHit", { requiredSkillKinds: ["basic"] }), [applyStatus("singleEnemy", "status_freeze", 10_000, 1, 1)]),
  affixTrigger("tr_abyss_stormcrown", trigger("afterDirectHit", { requiredHitResult: "critical" }), [damage("allEnemies", "lightning", 4500, false)]),
  affixTrigger("tr_abyss_sanctuary", trigger("onHeal"), [{ kind: "shield", targetRule: "allAllies", scalingStat: "attack", powerBps: 5000, flatPower: 0, statusId: "status_shield", durationOwnerTurns: 2 }]),
  {
    id: "tr_abyss_timefracture",
    trigger: trigger("afterRootAction", { requiredSkillKinds: ["ultimate"] }),
    chance: { kind: "fixed", valueBps: 10_000 },
    effects: [{ kind: "grantExtraTurn", targetRule: "self" }],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 },
  },
]);

/** RPG-025 五条深渊 Boss intent，延迟与反制字段按 SKILL-1.2 原样落盘。 */
export const abyssBossIntents: readonly BossIntentDefinition[] = Object.freeze([
  { id: "intent_butcher_cleaver", bossId: "boss_abyss_butcher", skillId: "skill_boss_butcher_cleaver", targetStrategy: "lowestHpOpponent", delayLegalActions: 1, counterKind: "heal" },
  { id: "intent_crimson_flurry", bossId: "boss_crimson_knight", skillId: "skill_boss_crimson_flurry", targetStrategy: "frontFirstOpponent", delayLegalActions: 1, counterKind: "guard" },
  { id: "intent_jailer_prison", bossId: "boss_pale_jailer", skillId: "skill_boss_jailer_prison", targetStrategy: "self", delayLegalActions: 1, counterKind: "cleanse" },
  { id: "intent_eye_chain", bossId: "boss_thousand_eye", skillId: "skill_boss_eye_chain", targetStrategy: "randomValid", delayLegalActions: 1, counterKind: "shield" },
  { id: "intent_king_annihilation", bossId: "boss_abyss_king", skillId: "skill_boss_king_annihilation", targetStrategy: "self", delayLegalActions: 1, counterKind: "guard" },
]);
