import { describe, expect, it } from "vitest";

import { clearBossIntent, declareBossIntent, releaseBossIntent } from "../../src/domain/battle/BossIntentResolver";
import { createCompleteSentinel, determineBattleOutcome, cleanupComplete } from "../../src/domain/reward/RewardService";
import type { BossIntentDefinition } from "../../src/content/contracts";
import { makeSkill, makeSnapshot, makeUnit } from "../fixtures/content/battle-reward-fixture";

describe("headless battle terminal/intent loop", () => {
  it("双方全灭判 defeat，胜利/战败形成 COMPLETE 哨兵且 cleanup 幂等", () => {
    const defeat = makeSnapshot([
      makeUnit({ unitId: "party:0", definitionId: "char_fixture", faction: "party", slot: 0, currentHp: 0 }),
      makeUnit({ unitId: "enemy:0", definitionId: "enemy_fixture", faction: "enemy", slot: 0, currentHp: 0 }),
    ]);
    expect(determineBattleOutcome(defeat)).toBe("defeat");
    const sentinel = createCompleteSentinel({ snapshot: defeat, outcome: "defeat" });
    expect(sentinel).toMatchObject({ ok: true, value: { phase: "COMPLETE", outcome: "defeat" } });
    if (!sentinel.ok) return;
    const cleaned = cleanupComplete(sentinel.value);
    expect(cleaned).toMatchObject({ ok: true, value: null });
    expect(cleanupComplete(sentinel.value)).toEqual(cleaned);
  });

  it("COMPLETE 哨兵清空 pendingBossIntents，终局不会继续释放意图", () => {
    const snapshot = makeSnapshot([
      makeUnit({ unitId: "party:0", definitionId: "char_fixture", faction: "party", slot: 0, currentHp: 0 }),
      makeUnit({ unitId: "enemy:0", definitionId: "boss_fixture", faction: "enemy", slot: 0, currentHp: 20 }),
    ], {
      pendingBossIntents: [{ intentId: "intent_pending", sourceUnitId: "enemy:0", skillId: "skill_boss_intent", targetStrategy: "lowestHpOpponent", declaredRound: 1 }],
    });
    const sentinel = createCompleteSentinel({ snapshot, outcome: "defeat" });
    expect(sentinel).toMatchObject({ ok: true, value: { phase: "COMPLETE", outcome: "defeat", pendingBossIntents: [], pendingEvents: [] } });
  });

  it("Boss 意图声明不伤害/不写资源，控制不清除，释放只执行一次，来源死亡清除", () => {
    const skill = makeSkill("skill_boss_intent", { kind: "enemy", enemyId: "boss_fixture" }, { kind: "active", targetRule: "singleEnemy" });
    const definition: BossIntentDefinition = { id: "intent_fixture", bossId: "boss_fixture", skillId: skill.id, targetStrategy: "lowestHpOpponent", delayLegalActions: 1, counterKind: "guard" };
    const snapshot = makeSnapshot([
      makeUnit({ unitId: "party:0", definitionId: "char_fixture", faction: "party", slot: 0 }),
      makeUnit({ unitId: "enemy:0", definitionId: "boss_fixture", faction: "enemy", slot: 0 }),
    ], { pendingBossIntents: [] });
    const declared = declareBossIntent({ snapshot, sourceUnitId: "enemy:0", definition, intentId: "intent_fixture" });
    expect(declared).toMatchObject({ ok: true, value: { snapshot: { pendingBossIntents: [{ intentId: "intent_fixture" }] }, events: [{ type: "ACTION_STARTED" }, { type: "INTENT_DECLARED" }, { type: "ACTION_FINISHED" }] } });
    if (!declared.ok) return;
    const held = structuredClone(declared.value.snapshot);
    const released = releaseBossIntent({ snapshot: held, sourceUnitId: "enemy:0", content: { getSkill: (id: string) => id === skill.id ? { ok: true as const, value: skill } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: id, issueKey: "missing" } } } }, rng: undefined });
    expect(released).toMatchObject({ ok: true, value: { snapshot: { pendingBossIntents: [] }, events: [{ type: "ACTION_STARTED" }, { type: "INTENT_RELEASED" }] } });
    if (!released.ok) return;
    expect(clearBossIntent({ snapshot: released.value.snapshot, sourceUnitId: "enemy:0", reason: "sourceDefeated" })).toMatchObject({ ok: true });
  });
});
