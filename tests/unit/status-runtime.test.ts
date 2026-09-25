import { describe, expect, it } from "vitest";

import type { BattleUnitStateV1, StatusDefinition } from "../../src/content/contracts";
import { SeededRng } from "../../src/domain/common/SeededRng";
import {
  absorbDamageWithStatuses,
  applyStatus,
  clearStatusesOnDefeat,
  createPeriodicStatusEvents,
  grantShieldStatus,
  type StatusEventContext,
} from "../../src/domain/battle/StatusRuntime";

const baseStats = {
  maxHp: 300,
  attack: 100,
  defense: 300,
  speed: 10,
  critRateBps: 0,
  critDamageBps: 15000,
  effectHitBps: 0,
  effectResistBps: 0,
};

function unit(unitId: string, faction: "party" | "enemy" = "party", hp = 300): BattleUnitStateV1 {
  return {
    unitId,
    definitionId: unitId,
    faction,
    slot: faction === "party" ? 0 : 0,
    level: 1,
    prePercentStats: { ...baseStats },
    staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
    stats: { ...baseStats },
    currentHp: hp,
    energy: 0,
    cooldowns: {},
    statuses: [],
    eligibleRound: 1,
    usedExtraTurnThisRound: false,
    directHitEnergyRootActionIds: [],
  };
}

function context(overrides: Partial<StatusEventContext> = {}): StatusEventContext {
  const sequence = 0;
  return {
    battleId: "battle_status",
    round: 1,
    rootActionId: "root_status",
    rootActionDefinitionId: "skill_status",
    chainDepth: 0,
    nextEventId: () => `status_event_${sequence}`,
    ...overrides,
  };
}

function status(overrides: Partial<StatusDefinition> = {}): StatusDefinition {
  return {
    id: "status_burn",
    nameKey: "status.burn",
    polarity: "debuff",
    maxStacks: 5,
    refreshRule: "independentStacks",
    triggerTiming: "turnEnd",
    effect: { kind: "periodicDamage", element: "fire", snapshotPowerBps: 5000 },
    canDispel: true,
    immunityTag: null,
    iconId: "status_burn",
    ...overrides,
  };
}

describe("StatusRuntime", () => {
  it("按一次命中刷新/叠层/cap，且 beforeAction 新建状态不跳过本次 TURN_END", () => {
    const target = unit("party:0");
    const source = unit("party:1");
    const first = applyStatus({
      target,
      source,
      status: status(),
      stacks: 2,
      durationOwnerTurns: 2,
      baseChanceBps: 10000,
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextStatusId: (() => { let i = 0; return () => `burn_${i++}`; })(),
      eventContext: context({ phase: "DRAIN_PRE_ACTION", targetTurnStarted: true, targetTurnEndCompleted: false }),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.unit.statuses).toHaveLength(2);
    expect(first.value.unit.statuses.every((value) => value.skipNextOwnerTurnEndDecrement === false)).toBe(true);
    expect(first.value.events.map((event) => event.type)).toEqual(["STATUS_CHANGED", "STATUS_CHANGED"]);

    const capped = applyStatus({
      target: first.value.unit,
      source,
      status: status(),
      stacks: 5,
      durationOwnerTurns: 3,
      baseChanceBps: 10000,
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextStatusId: (() => { let i = 2; return () => `burn_${i++}`; })(),
      eventContext: context(),
    });
    expect(capped.ok).toBe(true);
    if (capped.ok) {
      expect(capped.value.unit.statuses).toHaveLength(5);
      expect(capped.value.events.at(-1)).toMatchObject({ type: "STATUS_CHANGED", change: "capped", statusStackId: null });
    }

    const refreshed = applyStatus({
      target: first.value.unit,
      source,
      status: status({ refreshRule: "replaceDuration", maxStacks: 1 }),
      stacks: 1,
      durationOwnerTurns: 4,
      baseChanceBps: 10000,
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextStatusId: () => "burn_refresh",
      eventContext: context(),
    });
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      expect(refreshed.value.unit.statuses.filter((value) => value.statusId === "status_burn")).toHaveLength(1);
      expect(refreshed.value.events[0]).toMatchObject({ type: "STATUS_CHANGED", change: "refreshed" });
    }
  });

  it("周期伤害在入队时冻结攻击快照，按创建顺序生成 flatPower/目标当前防御字段", () => {
    const holder = unit("enemy:0", "enemy", 200);
    holder.statuses = [
      { stackId: "burn_a", statusId: "status_burn", sourceUnitId: "party:0", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 120, shieldRemaining: 0 },
      { stackId: "burn_b", statusId: "status_burn", sourceUnitId: "party:gone", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 80, shieldRemaining: 0 },
    ];
    const cycle = createPeriodicStatusEvents({
      unit: holder,
      timing: "turnEnd",
      getStatus: (id) => id === "status_burn" ? status() : undefined,
      eventContext: context(),
      nextEventId: (() => { let i = 0; return () => `periodic_${i++}`; })(),
    });
    expect(cycle.ok).toBe(true);
    if (!cycle.ok) return;
    expect(cycle.value.pendingEvents.map((event) => event.effect.kind === "damage" ? event.effect.flatPower : null)).toEqual([60, 40]);
    expect(cycle.value.pendingEvents.every((event) => event.effect.kind === "damage" && event.effect.canCrit === false && event.effect.powerBps === 0)).toBe(true);
    expect(cycle.value.pendingEvents.map((event) => event.targetUnitIds)).toEqual([["enemy:0"], ["enemy:0"]]);
    expect(cycle.value.unit.statuses).toHaveLength(0);
    expect(cycle.value.events.map((event) => event.type)).toEqual(["STATUS_CHANGED", "STATUS_CHANGED"]);
  });

  it("护盾按旧到新吸收并在耗尽时清理，死亡时清空剩余状态", () => {
    const target = unit("party:0", "party", 100);
    const shield = grantShieldStatus({
      target,
      sourceUnitId: "party:0",
      desired: 80,
      durationOwnerTurns: 2,
      nextStatusId: () => "shield_0",
      eventContext: context(),
    });
    expect(shield.ok).toBe(true);
    if (!shield.ok) return;
    const second = grantShieldStatus({
      target: shield.value.unit,
      sourceUnitId: "party:0",
      desired: 50,
      durationOwnerTurns: 2,
      nextStatusId: () => "shield_1",
      eventContext: context(),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const absorbed = absorbDamageWithStatuses({
      target: second.value.unit,
      damage: 100,
      sourceUnitId: "enemy:0",
      eventContext: context(),
    });
    expect(absorbed.ok).toBe(true);
    if (!absorbed.ok) return;
    expect(absorbed.value.shieldDamage).toBe(100);
    expect(absorbed.value.hpDamage).toBe(0);
    expect(absorbed.value.unit.statuses).toHaveLength(1);
    const defeated = clearStatusesOnDefeat({ target: { ...absorbed.value.unit, currentHp: 0 }, eventContext: context() });
    expect(defeated.ok).toBe(true);
    if (defeated.ok) expect(defeated.value.unit.statuses).toEqual([]);
  });
});
