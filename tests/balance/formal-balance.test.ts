import { describe, expect, it } from "vitest";

import { deriveBalanceSeed, runBalanceSimulation } from "../../scripts/run-balance-simulation";

describe("PROFILE-1.2 formal balance runner", () => {
  it("formal floor 1 ready runs a real battle instead of fabricating timeout rows", () => {
    const result = runBalanceSimulation({ fixture: "formal", floors: [1], seeds: 1, profiles: ["ready"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blocked).toBe(false);
    expect(result.value.results).toHaveLength(1);
    const [battle] = result.value.results;
    expect(battle).toBeDefined();
    expect(battle?.contentVersion).toBe("content-1.2.0");
    expect(["victory", "defeat", "timeout"]).toContain(battle?.outcome);
    expect(battle?.rootActionCount).toBeGreaterThan(0);
    expect(battle?.finalRngState).not.toEqual(battle?.initialRngState);
    expect(battle?.seedNamespace).toBe("balance:content-1.2.0:floor:01:seed:000");
  });

  it("同一楼层和 seed 的档位共享初始 RNG，不把 profile 写入 namespace", () => {
    const result = runBalanceSimulation({ fixture: "formal", floors: [1], seeds: 1, profiles: ["ready", "breakthrough"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results.map((battle) => battle.initialRngState)).toEqual([
      deriveBalanceSeed(1, 0),
      deriveBalanceSeed(1, 0),
    ]);
  });

  it("突破档在开战前通过声明 Combo 匹配门禁", () => {
    const result = runBalanceSimulation({ fixture: "formal", floors: [1], seeds: 1, profiles: ["breakthrough"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [battle] = result.value.results;
    expect(battle?.declaredComboId).toBe("combo_ember_chain");
    expect(battle?.declaredComboMatched).toBe(true);
  });

  it("正式推进会把根技能的召唤效果交给 reducer", () => {
    const result = runBalanceSimulation({ fixture: "formal", floors: [1], seeds: 1, profiles: ["lagging"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [battle] = result.value.results;
    expect(battle?.summonedEnemyIds).toContain("enemy_fang_wolf");
  });

  it("正式推进执行周期状态伤害并保持同 seed 的 RNG 可重放", () => {
    const first = runBalanceSimulation({ fixture: "formal", floors: [8], seeds: 20, profiles: ["ready"] });
    const second = runBalanceSimulation({ fixture: "formal", floors: [8], seeds: 20, profiles: ["ready"] });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.results.map((value) => value.finalRngState)).toEqual(second.value.results.map((value) => value.finalRngState));
    expect(first.value.results.some((value) => value.damageBySource.some((damage) => (damage as { sourceKind?: string }).sourceKind === "status"))).toBe(true);
  });
});
