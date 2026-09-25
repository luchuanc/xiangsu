import { describe, expect, it } from "vitest";

import type { BattleSnapshotV1, BattleUnitStateV1 } from "../../src/content/contracts";
import { resolveTargets, validateTargetSelection } from "../../src/domain/battle/Targeting";

function unit(unitId: string, faction: "party" | "enemy", slot: number, currentHp = 100): BattleUnitStateV1 {
  return {
    unitId, definitionId: unitId, faction, slot, level: 1,
    prePercentStats: { maxHp: 100, attack: 50, defense: 20, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 },
    staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
    stats: { maxHp: 100, attack: 50, defense: 20, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 },
    currentHp, energy: 0, cooldowns: {}, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [],
  };
}

function snapshot(units: BattleUnitStateV1[]): BattleSnapshotV1 {
  return {
    battleId: "battle_targeting", expeditionId: "exp_targeting", battleRevision: 0, encounterId: "encounter_targeting", encounterObjectId: "object_targeting",
    phase: "AWAIT_COMMAND", outcome: "ongoing", round: 1, units, initiativeQueueUnitIds: [], currentUnitId: "party:0", pendingEvents: [], pendingBossIntents: [], successfulItemUses: 0,
    abyssEchoOutcome: "notApplicable", rngState: [1, 2, 3, 4], firedComboKeys: [], roundTriggerCounts: {}, battleTriggerCounts: {},
    metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 },
    reward: null, returnMapId: "map_targeting", returnSafePosition: { x: 0, y: 0 },
  };
}

describe("Targeting", () => {
  it("严格执行前排、taunt 和自动目标数量", () => {
    const target = unit("enemy:3", "enemy", 3);
    const front = unit("enemy:0", "enemy", 0);
    const value = snapshot([unit("party:0", "party", 0), front, target]);
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "singleEnemy", requiresFrontAccess: true, targetUnitIds: [] })).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "COUNT" } } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "singleEnemy", requiresFrontAccess: true, targetUnitIds: ["enemy:3"] })).toMatchObject({ ok: false, error: { code: "FORMATION_BLOCKED", details: { targetUnitId: "enemy:3" } } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "allEnemies", targetUnitIds: [] })).toMatchObject({ ok: true, value: { targetUnitIds: ["enemy:0", "enemy:3"] } });
  });

  it("self/all/random 必须使用空命令目标，deadAlly 只接受倒地友方", () => {
    const value = snapshot([unit("party:0", "party", 0), unit("party:1", "party", 1, 0), unit("enemy:0", "enemy", 0)]);
    expect(validateTargetSelection({ snapshot: value, actorUnitId: "party:0", targetRule: "self", targetUnitIds: ["party:0"] })).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "COUNT" } } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "deadAlly", targetUnitIds: ["party:1"] })).toMatchObject({ ok: true, value: { targetUnitIds: ["party:1"] } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "randomEnemy", targetUnitIds: [] })).toMatchObject({ ok: true, value: { targetUnitIds: ["enemy:0"] } });
  });

  it("逐条覆盖冻结的七种 targetRule 合法与非法输入", () => {
    const value = snapshot([
      unit("party:0", "party", 0),
      unit("party:1", "party", 1),
      unit("party:2", "party", 2, 0),
      unit("enemy:0", "enemy", 0),
      unit("enemy:1", "enemy", 1),
    ]);
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "self", targetUnitIds: [] })).toMatchObject({ ok: true, value: { targetUnitIds: ["party:0"] } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "self", targetUnitIds: ["party:0"] })).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "COUNT" } } });

    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "singleEnemy", targetUnitIds: ["enemy:0"] })).toMatchObject({ ok: true, value: { targetUnitIds: ["enemy:0"] } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "singleEnemy", targetUnitIds: ["party:1"] })).toMatchObject({ ok: false, error: { code: "INVALID_TARGET" } });

    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "singleAlly", targetUnitIds: ["party:1"] })).toMatchObject({ ok: true, value: { targetUnitIds: ["party:1"] } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "singleAlly", targetUnitIds: ["enemy:0"] })).toMatchObject({ ok: false, error: { code: "INVALID_TARGET" } });

    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "allEnemies", targetUnitIds: [] })).toMatchObject({ ok: true, value: { targetUnitIds: ["enemy:0", "enemy:1"] } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "allEnemies", targetUnitIds: ["enemy:0"] })).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "COUNT" } } });

    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "allAllies", targetUnitIds: [] })).toMatchObject({ ok: true, value: { targetUnitIds: ["party:0", "party:1"] } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "allAllies", targetUnitIds: ["party:1"] })).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "COUNT" } } });

    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "randomEnemy", targetUnitIds: [] })).toMatchObject({ ok: true, value: { targetUnitIds: ["enemy:0"] } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "randomEnemy", targetUnitIds: ["enemy:0"] })).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "COUNT" } } });

    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "deadAlly", targetUnitIds: ["party:2"] })).toMatchObject({ ok: true, value: { targetUnitIds: ["party:2"] } });
    expect(resolveTargets({ snapshot: value, actorUnitId: "party:0", targetRule: "deadAlly", targetUnitIds: ["party:1"] })).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "DEAD" } } });

    const gated = snapshot([...value.units, unit("enemy:3", "enemy", 3)]);
    expect(resolveTargets({ snapshot: gated, actorUnitId: "party:0", targetRule: "singleEnemy", requiresFrontAccess: true, targetUnitIds: ["enemy:3"] })).toMatchObject({ ok: false, error: { code: "FORMATION_BLOCKED", details: { targetUnitId: "enemy:3" } } });
  });

  it("只把其它规则下仍可选的存活施加者作为 taunt 目标", () => {
    const taunter = unit("enemy:0", "enemy", 0);
    const requested = unit("enemy:1", "enemy", 1);
    const another = unit("enemy:2", "enemy", 2);
    // requested 自身的嘲讽来源已经失效；another 的 status 才证明 enemy:0 是有效来源。
    requested.statuses = [{ stackId: "taunt-invalid", statusId: "status_taunt", sourceUnitId: "enemy:dead", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 0, shieldRemaining: 0 }];
    another.statuses = [{ stackId: "taunt-valid", statusId: "status_taunt", sourceUnitId: taunter.unitId, remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: taunter.stats.attack, shieldRemaining: 0 }];
    const value = snapshot([unit("party:0", "party", 0), taunter, requested, another]);
    expect(validateTargetSelection({ snapshot: value, actorUnitId: "party:0", targetRule: "singleEnemy", targetUnitIds: [requested.unitId] })).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "TAUNTED", targetUnitId: requested.unitId } } });
    expect(validateTargetSelection({ snapshot: value, actorUnitId: "party:0", targetRule: "singleEnemy", targetUnitIds: [taunter.unitId] })).toMatchObject({ ok: true });
  });
});
