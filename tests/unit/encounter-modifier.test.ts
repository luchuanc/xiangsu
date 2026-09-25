import { describe, expect, it } from "vitest";

import type { EncounterModifierDefinition, StatBlock } from "../../src/content/contracts";
import { applyEncounterModifiers, resolveEncounterDamage, resolveEncounterHealing } from "../../src/domain/battle/EncounterModifierResolver";

const stats: StatBlock = { maxHp: 100, attack: 100, defense: 100, speed: 100, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 };

function modifier(id: string, rule: EncounterModifierDefinition["rule"]): EncounterModifierDefinition {
  return { id, nameKey: id, descriptionKey: id, rule };
}

describe("EncounterModifierResolver", () => {
  it("按 modifierIds 原数组计算 8 条修正，timed/escalating/start shield/execute/heal 全部无 RNG", () => {
    const modifiers: EncounterModifierDefinition[] = [
      modifier("timed_attack", { kind: "timedStat", faction: "enemy", stat: "attack", valueBps: 1000, fromRound: 1, throughRound: 2 }),
      modifier("timed_defense", { kind: "timedStat", faction: "party", stat: "defense", valueBps: 500, fromRound: 2, throughRound: 3 }),
      modifier("timed_speed", { kind: "timedStat", faction: "enemy", stat: "speed", valueBps: 1000, fromRound: 3, throughRound: 3 }),
      modifier("start_shield", { kind: "battleStartShield", faction: "enemy", maxHpBps: 2000 }),
      modifier("execute", { kind: "executeDamage", faction: "enemy", targetHpAtMostBps: 5000, damageBonusBps: 2500 }),
      modifier("escalate", { kind: "escalatingStat", faction: "enemy", stat: "attack", perRoundBps: 500, capBps: 1000 }),
      modifier("suppression_a", { kind: "healingSuppression", faction: "party", valueBps: 1000 }),
      modifier("suppression_b", { kind: "healingSuppression", faction: "party", valueBps: 500 }),
    ];
    const before = JSON.stringify(modifiers);
    const round1 = applyEncounterModifiers({ modifiers, round: 1, faction: "enemy", stats, maxHpByUnitId: { "enemy:0": 100 } });
    expect(round1).toMatchObject({ ok: true, value: { stats: { attack: 110 }, startShieldByUnitId: { "enemy:0": 20 } } });
    const round3 = applyEncounterModifiers({ modifiers, round: 3, faction: "enemy", stats, maxHpByUnitId: { "enemy:0": 100 } });
    expect(round3).toMatchObject({ ok: true, value: { stats: { attack: 110, speed: 110 } } });
    expect(resolveEncounterDamage({ modifiers, round: 1, sourceFaction: "enemy", targetCurrentHp: 40, targetMaxHp: 100, baseDamage: 100, damageKind: "direct" })).toMatchObject({ ok: true, value: { damage: 125 } });
    expect(resolveEncounterDamage({ modifiers, round: 1, sourceFaction: "enemy", targetCurrentHp: 40, targetMaxHp: 100, baseDamage: 100, damageKind: "periodic" })).toMatchObject({ ok: true, value: { damage: 100 } });
    expect(resolveEncounterHealing({ modifiers, faction: "party", amount: 100 })).toMatchObject({ ok: true, value: { amount: 85 } });
    expect(JSON.stringify(modifiers)).toBe(before);
  });
});
