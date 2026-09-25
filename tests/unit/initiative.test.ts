import { describe, expect, it } from "vitest";

import type { BattleUnitStateV1, StatBlock, StatusDefinition } from "../../src/content/contracts";
import { success } from "../../src/domain/common/DomainResult";
import { buildRoundInitiative } from "../../src/domain/battle/Initiative";

function stat(speed: number): StatBlock {
  return { maxHp: 100, attack: 10, defense: 10, speed, critRateBps: 0, critDamageBps: 15000, effectHitBps: 0, effectResistBps: 0 };
}

function unit(
  unitId: string,
  faction: "party" | "enemy",
  slot: number,
  speed: number,
  currentHp = 100,
  eligibleRound = 1,
): BattleUnitStateV1 {
  return {
    unitId,
    definitionId: unitId,
    faction,
    slot,
    level: 1,
    prePercentStats: stat(speed),
    staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
    stats: stat(speed),
    currentHp,
    energy: 0,
    cooldowns: {},
    statuses: [],
    eligibleRound,
    usedExtraTurnThisRound: false,
    directHitEnergyRootActionIds: [],
  };
}

describe("buildRoundInitiative", () => {
  it("按速度、我方优先、槽位和 UTF-16 unitId 稳定排序", () => {
    const result = buildRoundInitiative([
      unit("enemy-z", "enemy", 0, 100),
      unit("party-b", "party", 2, 100),
      unit("party-a", "party", 1, 100),
      unit("enemy-a", "enemy", 0, 100),
      unit("party-fast", "party", 0, 110),
    ], 1);
    expect(result).toEqual({
      ok: true,
      value: {
        queueUnitIds: ["party-fast", "party-a", "party-b", "enemy-a", "enemy-z"],
        speedByUnitId: { "party-fast": 110, "party-a": 100, "party-b": 100, "enemy-a": 100, "enemy-z": 100 },
      },
    });
  });

  it("排除死亡和未到 eligibleRound 的召唤物，并固化当轮速度快照", () => {
    const units = [unit("party", "party", 0, 50), unit("dead", "enemy", 0, 999, 0), unit("summon", "enemy", 1, 500, 100, 2)];
    const result = buildRoundInitiative(units, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queueUnitIds).toEqual(["party"]);
      expect(result.value.speedByUnitId).toEqual({ party: 50 });
      units[0].stats.speed = 999;
      expect(result.value.speedByUnitId.party).toBe(50);
    }
  });

  it("拒绝重复 unitId 和非法轮次", () => {
    expect(buildRoundInitiative([unit("same", "party", 0, 10), unit("same", "enemy", 0, 10)], 1)).toMatchObject({
      ok: false,
      error: { code: "INVALID_CONTENT", details: { issueKey: "duplicate_id" } },
    });
    expect(buildRoundInitiative([], 0)).toMatchObject({
      ok: false,
      error: { code: "INVALID_CONTENT", details: { path: "currentRound", issueKey: "round" } },
    });
  });

  it("ROUND_START 速度快照读取状态动态 speed，且不写回静态 stats", () => {
    const party = unit("party", "party", 0, 90);
    const enemy = unit("enemy", "enemy", 0, 95);
    enemy.statuses.push({ stackId: "shock:1", statusId: "status_shock", sourceUnitId: "party", remainingOwnerTurns: 2, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 10, shieldRemaining: 0 });
    const shock: StatusDefinition = { id: "status_shock", nameKey: "shock", polarity: "debuff", maxStacks: 3, refreshRule: "independentStacks", triggerTiming: "none", effect: { kind: "statModifier", stat: "speed", flat: 0, percentBps: -500 }, canDispel: true, immunityTag: "shock", iconId: "shock" };
    const result = buildRoundInitiative([party, enemy], 1, { getStatus: () => success(shock) });

    expect(result).toMatchObject({ ok: true, value: { queueUnitIds: ["party", "enemy"], speedByUnitId: { party: 90, enemy: 90 } } });
    expect(enemy.stats.speed).toBe(95);
  });
});
