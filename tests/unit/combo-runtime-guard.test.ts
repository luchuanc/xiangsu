import { describe, expect, it } from "vitest";

import type { ComboDefinition } from "../../src/content/contracts";
import { COMBO_DEFINITIONS } from "../../src/content/data/combos";
import {
  ComboRuntimeGuard,
  DEFAULT_MAX_DERIVED_DAMAGE_PER_UNIT_PER_ROOT,
  DEFAULT_MAX_DERIVED_EVENTS_PER_ROOT,
} from "../../src/domain/combo/ComboRuntimeGuard";

const combo: ComboDefinition = COMBO_DEFINITIONS.find((value) => value.id === "combo_ember_chain")!;

function request(overrides: Partial<Parameters<ComboRuntimeGuard["check"]>[0]> = {}) {
  return {
    combo,
    rootActionId: "root_1",
    ownerUnitId: "unit_1",
    chainDepth: 0,
    round: 1,
    derivedDamageCount: 0,
    derivedEventCount: 1,
    ...overrides,
  };
}

describe("ComboRuntimeGuard", () => {
  it("先检查后提交：重复 key、深度和 Combo 预算均可诊断拒绝", () => {
    const guard = new ComboRuntimeGuard();
    expect(guard.check(request())).toMatchObject({ ok: true });
    expect(guard.snapshot().firedKeys).toEqual([]);
    expect(guard.commit(request())).toMatchObject({ ok: true });
    expect(guard.snapshot().firedKeys).toEqual(["root_1:unit_1:combo_ember_chain"]);
    expect(guard.check(request())).toMatchObject({ ok: false, error: { reason: "DUPLICATE_KEY", observed: 1, limit: 1 } });
    expect(guard.check(request({ rootActionId: "root_2", chainDepth: 4 }))).toMatchObject({ ok: false, error: { reason: "CHAIN_DEPTH", observed: 4, limit: 3 } });
  });

  it("party key 固定使用 rootActionId:party:comboId，轮次重置不清除 battle 记录", () => {
    const partyCombo = { ...combo, id: "combo_holy_bulwark", scope: "party" as const };
    const guard = new ComboRuntimeGuard();
    const input = request({ combo: partyCombo, ownerUnitId: "unit_priest" });
    expect(guard.commit(input)).toMatchObject({ ok: true, value: { key: "root_1:party:combo_holy_bulwark" } });
    guard.resetRound();
    expect(guard.snapshot().firedKeys).toEqual(["root_1:party:combo_holy_bulwark"]);
    guard.resetBattle();
    expect(guard.snapshot().firedKeys).toEqual([]);
  });

  it("支持零预算和通用单根派生伤害/事件门禁", () => {
    const zero = new ComboRuntimeGuard();
    const zeroCombo = { ...combo, budget: { maxPerRootAction: 0, maxPerRound: 0, maxPerBattle: 0 } };
    expect(zero.check(request({ combo: zeroCombo }))).toMatchObject({ ok: false, error: { reason: "ROOT_BUDGET", observed: 0, limit: 0 } });

    const guard = new ComboRuntimeGuard();
    const openCombo = { ...combo, budget: { maxPerRootAction: 999, maxPerRound: 999, maxPerBattle: 999 } };
    const openCombo2 = { ...openCombo, id: "combo_blood_hunt" };
    const openCombo3 = { ...openCombo, id: "combo_iron_reprise" };
    expect(guard.commit(request({ combo: openCombo, derivedDamageCount: DEFAULT_MAX_DERIVED_DAMAGE_PER_UNIT_PER_ROOT, derivedEventCount: DEFAULT_MAX_DERIVED_EVENTS_PER_ROOT }))).toMatchObject({ ok: true });
    const tooMuchDamage = guard.check(request({ combo: openCombo2, derivedDamageCount: 1, derivedEventCount: 0 }));
    expect(tooMuchDamage).toMatchObject({ ok: false, error: { reason: "UNIT_DAMAGE_BUDGET", observed: DEFAULT_MAX_DERIVED_DAMAGE_PER_UNIT_PER_ROOT + 1, limit: DEFAULT_MAX_DERIVED_DAMAGE_PER_UNIT_PER_ROOT } });
    const tooManyEvents = guard.check(request({ combo: openCombo3, derivedDamageCount: 0, derivedEventCount: 1 }));
    expect(tooManyEvents).toMatchObject({ ok: false, error: { reason: "GLOBAL_EVENT_BUDGET", observed: DEFAULT_MAX_DERIVED_EVENTS_PER_ROOT + 1, limit: DEFAULT_MAX_DERIVED_EVENTS_PER_ROOT } });
  });

  it("按 round/battle 分别累计，并只在 commit 后改变计数", () => {
    const limited = { ...combo, budget: { maxPerRootAction: 2, maxPerRound: 1, maxPerBattle: 2 } };
    const guard = new ComboRuntimeGuard();
    const first = request({ combo: limited, rootActionId: "root_1" });
    const secondRound = request({ combo: limited, rootActionId: "root_2" });
    expect(guard.check(first)).toMatchObject({ ok: true });
    expect(guard.check(first)).toMatchObject({ ok: true });
    expect(guard.commit(first)).toMatchObject({ ok: true });
    expect(guard.check(secondRound)).toMatchObject({ ok: false, error: { reason: "ROUND_BUDGET", observed: 1, limit: 1 } });
    guard.resetRound();
    expect(guard.commit(secondRound)).toMatchObject({ ok: true });
    guard.resetRound();
    expect(guard.commit(request({ combo: limited, rootActionId: "root_3" }))).toMatchObject({ ok: false, error: { reason: "BATTLE_BUDGET", observed: 2, limit: 2 } });
  });
});
