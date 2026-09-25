import { describe, expect, it } from "vitest";

import type { BattleUnitStateV1, StatusDefinition } from "../../src/content/contracts";
import { SeededRng } from "../../src/domain/common/SeededRng";
import { resolveDamage, resolveHeal, resolvePeriodicDamage, resolveShield } from "../../src/domain/battle/DamageResolver";

function unit(unitId: string, currentHp = 100, defense = 0): BattleUnitStateV1 {
  return {
    unitId, definitionId: unitId, faction: unitId.startsWith("party") ? "party" : "enemy", slot: 0, level: 1,
    prePercentStats: { maxHp: 100, attack: 100, defense, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 },
    staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
    stats: { maxHp: 100, attack: 100, defense, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 },
    currentHp, energy: 0, cooldowns: {}, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [],
  };
}

describe("DamageResolver", () => {
  it("使用 300 防御常数并逐步向下取整", () => {
    const result = resolveDamage({ attacker: unit("party:0"), target: unit("enemy:0", 100, 300), effect: { kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }, rng: SeededRng.fromState([1, 2, 3, 4]) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.hpDamage).toBe(50);
  });

  it("护盾先吸收且过量治疗不计入 resolved", () => {
    const target = unit("party:0", 80);
    target.statuses.push({ stackId: "shield:1", statusId: "status_shield", sourceUnitId: "party:0", remainingOwnerTurns: 2, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 0, shieldRemaining: 30 });
    const damage = resolveDamage({ attacker: unit("enemy:0"), target, effect: { kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }, rng: SeededRng.fromState([1, 2, 3, 4]) });
    expect(damage.ok).toBe(true);
    if (damage.ok) expect(damage.value).toMatchObject({ shieldDamage: 30, hpDamage: 70, overkill: 0 });
    const heal = resolveHeal({ source: unit("party:0"), target: unit("party:1", 99), effect: { kind: "heal", targetRule: "singleAlly", scalingStat: "maxHp", powerBps: 10_000, flatPower: 0, canCrit: false }, healingBonusBps: 0, rng: SeededRng.fromState([1, 2, 3, 4]) });
    expect(heal.ok).toBe(true);
    if (heal.ok) expect(heal.value).toMatchObject({ healed: 1, overheal: 99 });
  });

  it("严格应用 true/弱点/抗性倍率，并固定暴击波动与最少 1 点伤害", () => {
    const attacker = unit("party:0");
    const largeTarget = unit("enemy:0", 1_000, 9_999);
    largeTarget.stats = { ...largeTarget.stats, maxHp: 1_000 };
    const baseEffect = {
      kind: "damage" as const,
      targetRule: "singleEnemy" as const,
      powerBps: 10_000,
      flatPower: 0,
      canCrit: false,
      ignoreDefenseBps: 0,
      flatIgnoreDefense: 0,
      hitCount: 1,
      retargetEachHit: false,
      conditionalMultipliers: [],
    };
    const trueDamage = resolveDamage({
      attacker,
      target: largeTarget,
      effect: { ...baseEffect, element: "true" },
      rng: SeededRng.fromState([1, 2, 3, 4]),
    });
    expect(trueDamage.ok).toBe(true);
    if (!trueDamage.ok) return;
    expect(trueDamage.value).toMatchObject({ effectiveDefense: 0, elementMultiplierBps: 10_000, finalDamage: 100, hpDamage: 100, varianceBps: 10_009 });

    const weakTarget = { ...largeTarget, stats: { ...largeTarget.stats, defense: 0 } };
    const weak = resolveDamage({
      attacker,
      target: weakTarget,
      effect: { ...baseEffect, element: "fire" },
      targetElementWeaknesses: ["fire"],
      rng: SeededRng.fromState([1, 2, 3, 4]),
    });
    expect(weak.ok).toBe(true);
    if (!weak.ok) return;
    expect(weak.value).toMatchObject({ elementMultiplierBps: 12_500, finalDamage: 125, hpDamage: 125, varianceBps: 10_009 });

    const resistant = resolveDamage({
      attacker,
      target: weakTarget,
      effect: { ...baseEffect, element: "fire" },
      targetElementResistances: ["fire"],
      rng: SeededRng.fromState([1, 2, 3, 4]),
    });
    expect(resistant.ok).toBe(true);
    if (!resistant.ok) return;
    expect(resistant.value).toMatchObject({ elementMultiplierBps: 7_500, finalDamage: 75, hpDamage: 75, varianceBps: 10_009 });

    const critAttacker = unit("party:crit");
    critAttacker.stats = { ...critAttacker.stats, critRateBps: 10_000, critDamageBps: 15_000 };
    const crit = resolveDamage({
      attacker: critAttacker,
      target: weakTarget,
      effect: { ...baseEffect, canCrit: true, element: "physical" },
      rng: SeededRng.fromState([1, 2, 3, 4]),
    });
    expect(crit.ok).toBe(true);
    if (!crit.ok) return;
    expect(crit.value).toMatchObject({ critical: true, hitResult: "critical", finalDamage: 150, varianceBps: 10_009 });

    const minimum = resolveDamage({
      attacker,
      target: unit("enemy:min", 100, 1_000_000),
      effect: { ...baseEffect, powerBps: 1, flatPower: 1, element: "physical" },
      rng: SeededRng.fromState([1, 2, 3, 4]),
    });
    expect(minimum.ok).toBe(true);
    if (!minimum.ok) return;
    expect(minimum.value).toMatchObject({ finalDamage: 1, hpDamage: 1, overkill: 0 });
  });

  it("伤害和治疗读取当前状态的有效属性", () => {
    const attacker = unit("party:0");
    attacker.statuses.push({ stackId: "attack-up:1", statusId: "status_attack_up", sourceUnitId: "party:0", remainingOwnerTurns: 2, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 100, shieldRemaining: 0 });
    const target = unit("enemy:0", 100, 100);
    target.statuses.push({ stackId: "marked:1", statusId: "status_marked", sourceUnitId: "party:0", remainingOwnerTurns: 2, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 100, shieldRemaining: 0 });
    const attackUp: StatusDefinition = { id: "status_attack_up", nameKey: "attack", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "attack", flat: 0, percentBps: 2_500 }, canDispel: true, immunityTag: null, iconId: "attack" };
    const marked: StatusDefinition = { id: "status_marked", nameKey: "marked", polarity: "debuff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "defense", flat: 0, percentBps: -1_500 }, canDispel: true, immunityTag: "marked", iconId: "marked" };
    const getStatus = (id: string) => id === attackUp.id ? { ok: true as const, value: attackUp } : { ok: true as const, value: marked };
    const damage = resolveDamage({
      attacker,
      target,
      effect: { kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      getStatus,
    });
    expect(damage).toMatchObject({ ok: true, value: { scaled: 125, effectiveDefense: 85 } });

    const healTarget = unit("party:1", 0);
    healTarget.statuses.push({ stackId: "vitality:1", statusId: "status_vitality", sourceUnitId: "party:1", remainingOwnerTurns: 2, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 100, shieldRemaining: 0 });
    const vitality: StatusDefinition = { id: "status_vitality", nameKey: "vitality", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "maxHp", flat: 50, percentBps: 0 }, canDispel: true, immunityTag: null, iconId: "vitality" };
    const healed = resolveHeal({
      source: attacker,
      target: healTarget,
      effect: { kind: "heal", targetRule: "singleAlly", scalingStat: "maxHp", powerBps: 10_000, flatPower: 0, canCrit: false },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      getStatus: (id) => id === vitality.id ? { ok: true as const, value: vitality } : { ok: true as const, value: attackUp },
    });
    expect(healed).toMatchObject({ ok: true, value: { raw: 150, finalHeal: 150, healed: 150 } });

    const shield = resolveShield({
      source: attacker,
      target: unit("party:shield"),
      effect: { kind: "shield", targetRule: "self", scalingStat: "attack", powerBps: 10_000, flatPower: 0, statusId: "status_shield", durationOwnerTurns: 2 },
      statusStackId: "shield:dynamic",
      getStatus,
    });
    expect(shield).toMatchObject({ ok: true, value: { raw: 125, granted: 125 } });
    if (shield.ok) expect(shield.value.nextTarget.statuses[0].sourceAttackSnapshot).toBe(125);
  });

  it("周期伤害是无 RNG/暴击/guard 减伤的 flatPower 入口，并先吸收旧护盾", () => {
    const target = unit("enemy:periodic", 100, 300);
    target.statuses.push({ stackId: "guard:periodic", statusId: "status_guard_30", sourceUnitId: "enemy:periodic", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 100, shieldRemaining: 0 });
    target.statuses.push({ stackId: "shield:periodic", statusId: "status_shield", sourceUnitId: "enemy:periodic", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 100, shieldRemaining: 20 });
    const before = SeededRng.fromState([1, 2, 3, 4]).getState();
    const rng = SeededRng.fromState([1, 2, 3, 4]);
    const result = resolvePeriodicDamage({
      target,
      effect: { kind: "damage", targetRule: "singleEnemy", element: "fire", powerBps: 0, flatPower: 100, canCrit: true, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] },
      targetElementWeaknesses: ["fire"],
      targetElementResistances: [],
    });
    expect(result).toMatchObject({ ok: true, value: { effectiveDefense: 300, elementMultiplierBps: 12_500, finalDamage: 62, shieldDamage: 20, hpDamage: 42, varianceBps: null, critical: false, hitResult: "notApplicable" } });
    expect(rng.getState()).toEqual(before);
    if (result.ok) expect(result.value.nextTarget.statuses.find((status) => status.statusId === "status_shield")?.shieldRemaining).toBe(0);
  });
});
