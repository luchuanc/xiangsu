import { describe, expect, it } from "vitest";

import type { BattleUnitStateV1, StatBlock, StatusDefinition } from "../../src/content/contracts";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { resolveEffectiveStats } from "../../src/domain/battle/BattleStatRuntime";

function stats(overrides: Partial<StatBlock> = {}): StatBlock {
  return {
    maxHp: 100,
    attack: 100,
    defense: 100,
    speed: 101,
    critRateBps: 1_000,
    critDamageBps: 15_000,
    effectHitBps: 2_000,
    effectResistBps: 3_000,
    ...overrides,
  };
}

function unit(statuses: BattleUnitStateV1["statuses"] = []): BattleUnitStateV1 {
  const base = stats();
  return {
    unitId: "party:0",
    definitionId: "char_test",
    faction: "party",
    slot: 0,
    level: 1,
    prePercentStats: { ...base },
    staticPercentByStatBps: { maxHp: 1_000, attack: 1_000, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
    // 故意与 pre/static 不一致，确保有 getter 时不会从最终 stats 叠加动态百分比。
    stats: stats({ attack: 999, speed: 999 }),
    currentHp: 100,
    energy: 0,
    cooldowns: {},
    statuses,
    eligibleRound: 1,
    usedExtraTurnThisRound: false,
    directHitEnergyRootActionIds: [],
  };
}

function status(id: string, effect: StatusDefinition["effect"]): StatusDefinition {
  return {
    id,
    nameKey: `status.${id}`,
    polarity: "buff",
    maxStacks: 99,
    refreshRule: "independentStacks",
    triggerTiming: "none",
    effect,
    canDispel: true,
    immunityTag: null,
    iconId: id,
  };
}

function stack(statusId: string, index = 0): BattleUnitStateV1["statuses"][number] {
  return {
    stackId: `${statusId}:${index}`,
    statusId,
    sourceUnitId: "enemy:0",
    remainingOwnerTurns: 2,
    skipNextOwnerTurnEndDecrement: false,
    sourceAttackSnapshot: 10,
    shieldRemaining: 0,
  };
}

describe("BattleStatRuntime", () => {
  it("按 prePercent + static 与状态动态百分比解析攻击，不修改单位", () => {
    const value = unit([stack("status_attack_up")]);
    const before = structuredClone(value);
    const attackUp = status("status_attack_up", { kind: "statModifier", stat: "attack", flat: 0, percentBps: 2_500 });
    const result = resolveEffectiveStats(value, (id) => id === attackUp.id ? success(attackUp) : failure(createDomainError("INVALID_CONTENT", { path: `statuses.${id}`, issueKey: "missing" })));

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ attack: 135 }),
    });
    expect(value).toEqual(before);
  });

  it("每个 shock 栈各贡献一次速度动态百分比", () => {
    const value = unit([stack("status_shock", 0), stack("status_shock", 1)]);
    const shock = status("status_shock", { kind: "statModifier", stat: "speed", flat: 0, percentBps: -500 });
    const result = resolveEffectiveStats(value, () => success(shock));

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ speed: 90 }) });
  });

  it("按动态 flat 先加再乘百分比并限制边界", () => {
    const value = unit([stack("status_flat")]);
    value.prePercentStats = stats({ maxHp: 1, attack: 1, defense: 1, speed: 1, critRateBps: 9_900, critDamageBps: 29_900, effectHitBps: 9_900, effectResistBps: 9_900 });
    value.staticPercentByStatBps = { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 };
    const modifier = status("status_flat", { kind: "statModifier", stat: "attack", flat: -10, percentBps: 0 });
    const result = resolveEffectiveStats(value, () => success(modifier));

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ maxHp: 1, attack: 1, defense: 1, speed: 1, critRateBps: 9_900, critDamageBps: 29_900, effectHitBps: 9_900, effectResistBps: 9_900 }),
    });
  });

  it("状态 getter 缺失或返回错误 ID 时严格返回 INVALID_CONTENT", () => {
    const missing = resolveEffectiveStats(unit([stack("status_missing")]), () => failure(createDomainError("INVALID_CONTENT", { path: "statuses.status_missing", issueKey: "missing" })));
    expect(missing).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });

    const mismatch = resolveEffectiveStats(unit([stack("status_attack_up")]), () => success(status("status_other", { kind: "statModifier", stat: "attack", flat: 0, percentBps: 2_500 })));
    expect(mismatch).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT", details: { issueKey: "id_mismatch" } } });
  });

  it("没有状态 getter 时保持旧 stats 快照兼容", () => {
    const value = unit([stack("status_attack_up")]);
    const result = resolveEffectiveStats(value);
    expect(result).toEqual({ ok: true, value: value.stats });
    if (result.ok) expect(result.value).not.toBe(value.stats);
  });
});
