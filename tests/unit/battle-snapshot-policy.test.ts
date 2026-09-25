import { describe, expect, it } from "vitest";

import type { BattleSnapshotV1, BattleUnitStateV1 } from "../../src/content/contracts";
import {
  BattleSnapshotPolicy,
  evaluateBattleOutcome,
  type SnapshotEventContext,
} from "../../src/domain/battle/BattleSnapshotPolicy";

const stats = { maxHp: 100, attack: 50, defense: 10, speed: 10, critRateBps: 0, critDamageBps: 15000, effectHitBps: 0, effectResistBps: 0 };

function unit(unitId: string, faction: "party" | "enemy", hp: number): BattleUnitStateV1 {
  return { unitId, definitionId: unitId, faction, slot: 0, level: 1, prePercentStats: { ...stats }, staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 }, stats: { ...stats }, currentHp: hp, energy: 0, cooldowns: {}, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [] };
}

function snapshot(overrides: Partial<BattleSnapshotV1> = {}): BattleSnapshotV1 {
  return {
    battleId: "battle_snapshot",
    expeditionId: "exp_snapshot",
    battleRevision: 1,
    encounterId: "enc_snapshot",
    encounterObjectId: "object_snapshot",
    phase: "AWAIT_COMMAND",
    outcome: "ongoing",
    round: 1,
    units: [unit("party:0", "party", 100), unit("enemy:0", "enemy", 100)],
    initiativeQueueUnitIds: ["party:0", "enemy:0"],
    currentUnitId: "party:0",
    pendingEvents: [],
    pendingBossIntents: [],
    successfulItemUses: 0,
    abyssEchoOutcome: "notApplicable",
    rngState: [1, 2, 3, 4],
    firedComboKeys: [],
    roundTriggerCounts: {},
    battleTriggerCounts: {},
    metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 },
    reward: null,
    returnMapId: "map_town",
    returnSafePosition: { x: 0, y: 0 },
    ...overrides,
  };
}

const eventContext: SnapshotEventContext = { battleId: "battle_snapshot", round: 1, rootActionId: "root_snapshot", rootActionDefinitionId: "skill_snapshot" };

describe("BattleSnapshotPolicy", () => {
  it("只允许稳定 phase 且 pendingEvents 必须为空，保存/恢复保持确定性", () => {
    const policy = new BattleSnapshotPolicy();
    for (const phase of ["AWAIT_COMMAND", "TURN_START", "REWARD_PENDING", "COMPLETE"] as const) {
      const result = policy.prepare(snapshot({ phase, outcome: phase === "AWAIT_COMMAND" || phase === "TURN_START" ? "ongoing" : "victory" }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(policy.restore(result.value)).toEqual(result);
    }
    expect(policy.prepare(snapshot({ phase: "DRAIN_TRIGGERS" }))).toMatchObject({ ok: false, error: { code: "INVALID_BATTLE_PHASE" } });
    expect(policy.prepare(snapshot({ pendingEvents: [{ eventId: "pending", rootActionId: "root", rootActionDefinitionId: "skill_snapshot", chainDepth: 1, sourceUnitId: "party:0", targetUnitIds: ["enemy:0"], effectIndex: 0, effect: { kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }, triggerSource: null, visualSkillId: null, contextSkillKind: null }] }))).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
  });

  it("所有领域事件与 pending 队列清空后才判定终局，我方全灭优先于敌方全灭", () => {
    const bothDefeated = evaluateBattleOutcome(snapshot({ units: [unit("party:0", "party", 0), unit("enemy:0", "enemy", 0)] }), { pendingEvents: [], unappliedDomainEventCount: 0, eventContext });
    expect(bothDefeated.ok).toBe(true);
    if (bothDefeated.ok) {
      expect(bothDefeated.value.outcome).toBe("defeat");
      expect(bothDefeated.value.events.map((event) => event.type)).toEqual(["BATTLE_FINISHED"]);
    }

    const victory = evaluateBattleOutcome(snapshot({ units: [unit("party:0", "party", 100), unit("enemy:0", "enemy", 0)] }), { pendingEvents: [], unappliedDomainEventCount: 0, eventContext });
    expect(victory.ok).toBe(true);
    if (victory.ok) expect(victory.value.events.map((event) => event.type)).toEqual(["BATTLE_FINISHED", "REWARD_PREPARED"]);

    expect(evaluateBattleOutcome(snapshot({ units: [unit("party:0", "party", 0), unit("enemy:0", "enemy", 0)] }), { pendingEvents: [{ eventId: "still_pending" } as never], unappliedDomainEventCount: 0, eventContext })).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
    expect(evaluateBattleOutcome(snapshot(), { pendingEvents: [], unappliedDomainEventCount: 1, eventContext })).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
  });
});
