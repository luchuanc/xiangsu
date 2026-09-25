/** RPG-010 垂直切片装备触发器。 */
import type { AffixTriggerDefinition, EffectSpec, TriggerSpec } from "../contracts";

function trigger(
  event: TriggerSpec["event"],
  requiredSkillKinds: TriggerSpec["requiredSkillKinds"],
  requiredSourceStatusIds: string[] = [],
): TriggerSpec {
  return {
    event,
    requiredSkillKinds,
    requiredHitResult: "any",
    requiredSourceHpAtMostBps: null,
    requiredTargetHpAtMostBps: null,
    requiredSourceStatusIds,
    requiredTargetStatusIds: [],
    consumeTargetStatus: null,
  };
}

function ailment(statusId: string): EffectSpec {
  return {
    kind: "applyStatus",
    targetRule: "singleEnemy",
    statusId,
    baseChanceBps: 10_000,
    stacks: 1,
    durationOwnerTurns: 3,
  };
}

const definitions: AffixTriggerDefinition[] = [
  {
    id: "tr_bleed_edge",
    trigger: trigger("afterDirectHit", ["basic"]),
    chance: { kind: "affixRoll", scaleBps: 10_000 },
    effects: [ailment("status_bleed")],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 999 },
  },
  {
    id: "tr_searing_edge",
    trigger: trigger("afterDirectHit", ["basic"]),
    chance: { kind: "affixRoll", scaleBps: 10_000 },
    effects: [ailment("status_burn")],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 999 },
  },
  {
    id: "tr_counterweight",
    trigger: trigger("onDirectDamageTaken", [], ["status_shield"]),
    chance: { kind: "affixRoll", scaleBps: 10_000 },
    effects: [{ kind: "shield", targetRule: "self", scalingStat: "maxHp", powerBps: 500, flatPower: 0, statusId: "status_shield", durationOwnerTurns: 1 }],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 20 },
  },
];

export const AFFIX_TRIGGER_DEFINITIONS: readonly AffixTriggerDefinition[] = Object.freeze(definitions);
export const affixTriggers = AFFIX_TRIGGER_DEFINITIONS;

