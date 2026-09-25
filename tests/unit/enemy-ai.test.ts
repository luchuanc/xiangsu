import { describe, expect, it } from "vitest";

import type { SkillDefinition } from "../../src/content/contracts";
import { decideEnemyAction, isFrontUnit } from "../../src/domain/battle/EnemyAi";
import { SeededRng } from "../../src/domain/common/SeededRng";
import { makeEnemy, makeSkill, makeSnapshot, makeUnit } from "../fixtures/content/battle-reward-fixture";

function source(skills: readonly SkillDefinition[]) {
  return {
    getSkill: (id: string) => {
      const skill = skills.find((value) => value.id === id);
      return skill
        ? { ok: true as const, value: skill }
        : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: `skills.${id}`, issueKey: "missing" } } };
    },
  };
}

describe("EnemyAi", () => {
  it("使用阵营感知的前排判定，party 槽位 2/3 不能被当作前排", () => {
    expect(isFrontUnit(makeUnit({ unitId: "party:0", definitionId: "char_fixture", faction: "party", slot: 0 }))).toBe(true);
    expect(isFrontUnit(makeUnit({ unitId: "party:2", definitionId: "char_fixture", faction: "party", slot: 2 }))).toBe(false);
    expect(isFrontUnit(makeUnit({ unitId: "enemy:2", definitionId: "enemy_fixture", faction: "enemy", slot: 2 }))).toBe(true);
    expect(isFrontUnit(makeUnit({ unitId: "enemy:3", definitionId: "enemy_fixture", faction: "enemy", slot: 3 }))).toBe(false);
  });

  it("按技能可用性、条件、优先级选择合法动作，冷却技能不应阻塞 fallback rule", () => {
    const basic = makeSkill("skill_enemy_basic", { kind: "enemy", enemyId: "enemy_fixture" }, { kind: "basic", targetRule: "singleEnemy" });
    const unavailable = makeSkill("skill_enemy_unavailable", { kind: "enemy", enemyId: "enemy_fixture" }, { kind: "active", targetRule: "singleEnemy", cooldownTurnsByLevel: [2, 2, 2, 2, 2] });
    const valid = makeSkill("skill_enemy_valid", { kind: "enemy", enemyId: "enemy_fixture" }, { kind: "active", targetRule: "singleEnemy" });
    const enemy = makeEnemy("enemy_fixture", {
      skillIds: [unavailable.id, valid.id],
      aiRules: [
        { priority: 10, conditions: [{ kind: "always" }], skillId: unavailable.id, targetStrategy: "lowestHpOpponent", weight: 100 },
        { priority: 5, conditions: [{ kind: "always" }], skillId: valid.id, targetStrategy: "frontFirstOpponent", weight: 100 },
      ],
    });
    const snapshot = makeSnapshot([
      makeUnit({ unitId: "party:0", definitionId: "char_fixture", faction: "party", slot: 0, currentHp: 20 }),
      makeUnit({ unitId: "party:1", definitionId: "char_fixture_2", faction: "party", slot: 1, currentHp: 80 }),
      makeUnit({ unitId: "enemy:0", definitionId: enemy.id, faction: "enemy", slot: 0, cooldowns: { [unavailable.id]: 2 } }),
    ]);
    const result = decideEnemyAction({ snapshot, actorUnitId: "enemy:0", enemy, content: source([basic, unavailable, valid]), rng: new SeededRng(1) });
    expect(result).toMatchObject({ ok: true, value: { command: { type: "USE_SKILL", skillId: valid.id, targetUnitIds: ["party:0"] }, usedFallback: false } });
  });

  it("同一状态和 seed 产生同一加权规则与目标；单候选仍消费一次规则 RNG", () => {
    const basic = makeSkill("skill_enemy_basic", { kind: "enemy", enemyId: "enemy_fixture" }, { kind: "basic", targetRule: "singleEnemy" });
    const first = makeSkill("skill_enemy_first", { kind: "enemy", enemyId: "enemy_fixture" }, { kind: "active", targetRule: "singleEnemy" });
    const second = makeSkill("skill_enemy_second", { kind: "enemy", enemyId: "enemy_fixture" }, { kind: "active", targetRule: "singleEnemy" });
    const enemy = makeEnemy("enemy_fixture", {
      skillIds: [first.id, second.id],
      aiRules: [
        { priority: 8, conditions: [{ kind: "always" }], skillId: first.id, targetStrategy: "randomValid", weight: 1 },
        { priority: 8, conditions: [{ kind: "always" }], skillId: second.id, targetStrategy: "randomValid", weight: 1 },
      ],
    });
    const snapshot = makeSnapshot([
      makeUnit({ unitId: "party:0", definitionId: "char_fixture", faction: "party", slot: 0 }),
      makeUnit({ unitId: "enemy:0", definitionId: enemy.id, faction: "enemy", slot: 0 }),
    ]);
    const left = decideEnemyAction({ snapshot, actorUnitId: "enemy:0", enemy, content: source([basic, first, second]), rng: new SeededRng(77) });
    const right = decideEnemyAction({ snapshot, actorUnitId: "enemy:0", enemy, content: source([basic, first, second]), rng: new SeededRng(77) });
    expect(right).toEqual(left);
    expect(left).toMatchObject({ ok: true, value: { command: { targetUnitIds: ["party:0"] } } });
  });

  it("target 条件无合法候选时丢弃规则；无合法 fallback 目标返回 INVALID_CONTENT", () => {
    const basic = makeSkill("skill_enemy_basic", { kind: "enemy", enemyId: "enemy_fixture" }, { kind: "basic", targetRule: "singleEnemy" });
    const mark = makeSkill("skill_enemy_mark", { kind: "enemy", enemyId: "enemy_fixture" }, { kind: "active", targetRule: "singleEnemy" });
    const enemy = makeEnemy("enemy_fixture", {
      skillIds: [mark.id],
      aiRules: [{ priority: 10, conditions: [{ kind: "targetHasStatus", statusId: "status_marked" }], skillId: mark.id, targetStrategy: "lowestHpOpponent", weight: 1 }],
    });
    const snapshot = makeSnapshot([makeUnit({ unitId: "enemy:0", definitionId: enemy.id, faction: "enemy", slot: 0 })]);
    const fallback = decideEnemyAction({ snapshot, actorUnitId: "enemy:0", enemy, content: source([basic, mark]), rng: new SeededRng(1) });
    expect(fallback).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
  });
});
