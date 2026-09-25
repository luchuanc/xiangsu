import { describe, expect, it } from "vitest";

import type {
  BattleSnapshotV1,
  BattleUnitStateV1,
  EnemyDefinition,
  StatBlock,
  StatusDefinition,
} from "../../src/content/contracts";
import { success } from "../../src/domain/common/DomainResult";
import { reduceBattle } from "../../src/domain/battle/BattleReducer";
import { buildRoundInitiative } from "../../src/domain/battle/Initiative";

function stat(speed = 50, maxHp = 100): StatBlock {
  return { maxHp, attack: 20, defense: 10, speed, critRateBps: 0, critDamageBps: 15000, effectHitBps: 0, effectResistBps: 0 };
}

function unit(
  unitId: string,
  faction: "party" | "enemy",
  slot: number,
  speed = 50,
  currentHp = 100,
  eligibleRound = 1,
  statuses: BattleUnitStateV1["statuses"] = [],
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
    cooldowns: { skill_basic: 0 },
    statuses,
    eligibleRound,
    usedExtraTurnThisRound: false,
    directHitEnergyRootActionIds: [],
  };
}

function snapshot(overrides: Partial<BattleSnapshotV1> = {}): BattleSnapshotV1 {
  return {
    battleId: "battle-1",
    expeditionId: "expedition-1",
    battleRevision: 0,
    encounterId: "encounter-1",
    encounterObjectId: "encounter-object",
    phase: "INIT",
    outcome: "ongoing",
    round: 0,
    units: [unit("party:0", "party", 0, 60), unit("enemy:0", "enemy", 0, 50)],
    initiativeQueueUnitIds: [],
    currentUnitId: null,
    pendingEvents: [],
    pendingBossIntents: [],
    successfulItemUses: 0,
    abyssEchoOutcome: "notApplicable",
    rngState: [1, 2, 3, 4],
    firedComboKeys: [],
    roundTriggerCounts: {},
    battleTriggerCounts: {},
    metrics: {
      damage: [],
      partyDamageTaken: 0,
      partyHealingDone: 0,
      partyShieldGranted: 0,
      knockouts: [],
      comboTriggerCounts: { combo_alpha: 0 },
      bossEnrageCast: false,
      maxChainDepth: 0,
      triggerBudgetExhaustedCount: 0,
    },
    reward: null,
    returnMapId: "map_field_1",
    returnSafePosition: { x: 1, y: 1 },
    ...overrides,
  };
}

const summonEnemy: EnemyDefinition = {
  id: "enemy_summon",
  nameKey: "enemy.summon",
  level: 1,
  stats: stat(45, 70),
  elementWeaknesses: [],
  elementResistances: [],
  immunityTags: [],
  basicSkillId: "skill_basic",
  basicTargetStrategy: "frontFirstOpponent",
  skillIds: [],
  aiRules: [],
  spriteId: "enemy_summon",
};

describe("BattleReducer", () => {
  it("严格推进 1v1 的 round/turn/action 阶段", () => {
    const initial = snapshot();
    const round = reduceBattle(initial, { type: "ROUND_START" });
    expect(round).toMatchObject({ ok: true, value: { phase: "ROUND_START", round: 1, initiativeQueueUnitIds: ["party:0", "enemy:0"] } });
    if (!round.ok) return;
    const turn = reduceBattle(round.value, { type: "TURN_START" });
    expect(turn).toMatchObject({ ok: true, value: { phase: "AWAIT_COMMAND", currentUnitId: "party:0", initiativeQueueUnitIds: ["enemy:0"] } });
    if (!turn.ok) return;
    const valid = reduceBattle(turn.value, { type: "COMMAND_VALID" });
    const drained = valid.ok ? reduceBattle(valid.value, { type: "DRAIN_PRE_ACTION_COMPLETE" }) : valid;
    const resolved = drained.ok ? reduceBattle(drained.value, { type: "RESOLVE_ACTION_COMPLETE" }) : drained;
    const ended = resolved.ok ? reduceBattle(resolved.value, { type: "DRAIN_TRIGGERS_COMPLETE" }) : resolved;
    expect(ended).toMatchObject({ ok: true, value: { phase: "TURN_END", outcome: "ongoing" } });
  });

  it("死亡队列项被过滤，控制状态进入 RESOLVE_ACTION 而不是直接结束回合", () => {
    const deadQueued = snapshot({
      phase: "ROUND_START",
      round: 1,
      units: [unit("party:0", "party", 0, 60), unit("enemy:0", "enemy", 0, 50, 0)],
      initiativeQueueUnitIds: ["enemy:0", "party:0"],
    });
    const afterDead = reduceBattle(deadQueued, { type: "TURN_START" });
    expect(afterDead).toMatchObject({ ok: true, value: { currentUnitId: "party:0", phase: "AWAIT_COMMAND", initiativeQueueUnitIds: [] } });

    const controlled = snapshot({
      phase: "ROUND_START",
      round: 1,
      units: [unit("party:0", "party", 0, 60, 100, 1, [{ stackId: "stun-1", statusId: "status_stun", sourceUnitId: "enemy:0", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 20, shieldRemaining: 0 }])],
      initiativeQueueUnitIds: ["party:0", "enemy:0"],
    });
    expect(reduceBattle(controlled, { type: "TURN_START" })).toMatchObject({ ok: true, value: { phase: "RESOLVE_ACTION", currentUnitId: "party:0" } });
  });

  it("速度变化只改实时 stats.speed，不重排既有队列", () => {
    const before = snapshot({ phase: "ROUND_START", round: 1, initiativeQueueUnitIds: ["party:0", "enemy:0"] });
    const beforeJson = JSON.stringify(before);
    const result = reduceBattle(before, { type: "SPEED_CHANGED", unitId: "enemy:0", speed: 999 });
    expect(result).toMatchObject({ ok: true, value: { initiativeQueueUnitIds: ["party:0", "enemy:0"] } });
    expect(before.units[1].stats.speed).toBe(50);
    expect(JSON.stringify(before)).toBe(beforeJson);
    if (result.ok) {
      expect(result.value.units[1].stats.speed).toBe(999);
      expect(result.value.units[1].prePercentStats.speed).toBe(50);
    }
  });

  it("只在当前单位自己的 TURN_END 递减 cooldown，跨到 ROUND_END 不重复递减", () => {
    const before = snapshot({
      phase: "TURN_END",
      round: 1,
      currentUnitId: "party:0",
      initiativeQueueUnitIds: [],
      units: [
        { ...unit("party:0", "party", 0), cooldowns: { skill_active: 2, skill_ready: 0 } },
        unit("enemy:0", "enemy", 0),
      ],
    });
    const ended = reduceBattle(before, { type: "TURN_END" });
    expect(ended).toMatchObject({ ok: true, value: { phase: "ROUND_END", currentUnitId: null } });
    if (!ended.ok) return;
    expect(ended.value.units[0].cooldowns).toEqual({ skill_active: 1, skill_ready: 0 });
    const nextRound = reduceBattle(ended.value, { type: "ROUND_END" });
    expect(nextRound).toMatchObject({ ok: true, value: { phase: "ROUND_START", round: 2 } });
    if (nextRound.ok) expect(nextRound.value.units[0].cooldowns).toEqual({ skill_active: 1, skill_ready: 0 });
  });

  it("TURN_END 后的 TURN_START 只选择下一位并按状态 getter 保留控制判定", () => {
    const before = snapshot({
      phase: "TURN_END",
      round: 1,
      currentUnitId: "party:0",
      initiativeQueueUnitIds: ["enemy:0"],
      units: [
        { ...unit("party:0", "party", 0), cooldowns: { skill_active: 2 } },
        {
          ...unit("enemy:0", "enemy", 0),
          cooldowns: { skill_enemy: 3 },
          statuses: [{
            stackId: "stun-next",
            statusId: "status_stun",
            sourceUnitId: "party:0",
            remainingOwnerTurns: 1,
            skipNextOwnerTurnEndDecrement: false,
            sourceAttackSnapshot: 20,
            shieldRemaining: 0,
          }],
        },
      ],
    });

    const ended = reduceBattle(before, { type: "TURN_END" });
    expect(ended).toMatchObject({
      ok: true,
      value: { phase: "TURN_START", currentUnitId: null, initiativeQueueUnitIds: ["enemy:0"] },
    });
    if (!ended.ok) return;
    expect(ended.value.units[0].cooldowns).toEqual({ skill_active: 1 });
    expect(ended.value.units[1].cooldowns).toEqual({ skill_enemy: 3 });

    const controlled = reduceBattle(ended.value, { type: "TURN_START" }, {
      getStatus: (statusId) => success({
        id: statusId,
        nameKey: statusId,
        polarity: "debuff",
        maxStacks: 1,
        refreshRule: "replaceDuration",
        triggerTiming: "none",
        effect: { kind: "skipTurn" },
        canDispel: true,
        immunityTag: null,
        iconId: statusId,
      }),
    });
    expect(controlled).toMatchObject({
      ok: true,
      value: { phase: "RESOLVE_ACTION", currentUnitId: "enemy:0", initiativeQueueUnitIds: [] },
    });
    if (controlled.ok) expect(controlled.value.units[1].cooldowns).toEqual({ skill_enemy: 3 });
  });

  it("VICTORY/DEFEAT 的终局转换不递减 cooldown，非法值拒绝且不改输入", () => {
    const victory = snapshot({
      phase: "VICTORY",
      outcome: "victory",
      currentUnitId: "party:0",
      units: [{ ...unit("party:0", "party", 0), cooldowns: { skill_active: 2 } }, unit("enemy:0", "enemy", 0)],
    });
    const victoryResult = reduceBattle(victory, { type: "TURN_END" });
    expect(victoryResult).toMatchObject({ ok: true, value: { phase: "REWARD_PENDING" } });
    if (victoryResult.ok) expect(victoryResult.value.units[0].cooldowns).toEqual({ skill_active: 2 });

    const defeat = snapshot({
      phase: "DEFEAT",
      outcome: "defeat",
      currentUnitId: "party:0",
      units: [{ ...unit("party:0", "party", 0), cooldowns: { skill_active: 2 } }, unit("enemy:0", "enemy", 0)],
    });
    const defeatResult = reduceBattle(defeat, { type: "TURN_END" });
    expect(defeatResult).toMatchObject({ ok: true, value: { phase: "COMPLETE" } });
    if (defeatResult.ok) expect(defeatResult.value.units[0].cooldowns).toEqual({ skill_active: 2 });

    const invalid = snapshot({
      phase: "TURN_END",
      currentUnitId: "party:0",
      units: [{ ...unit("party:0", "party", 0), cooldowns: { skill_active: -1 } }, unit("enemy:0", "enemy", 0)],
    });
    const beforeJson = JSON.stringify(invalid);
    const invalidResult = reduceBattle(invalid, { type: "TURN_END" });
    expect(invalidResult).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT", details: { issueKey: "cooldown" } } });
    expect(JSON.stringify(invalid)).toBe(beforeJson);
  });

  it("召唤按 preferredSlots 填空槽、受 alive 上限限制并只能下轮进入 initiative", () => {
    const before = snapshot({
      phase: "DRAIN_TRIGGERS",
      round: 2,
      units: [unit("party:0", "party", 0), unit("enemy:0", "enemy", 0), unit("enemy:1", "enemy", 1, 45, 0)],
    });
    const result = reduceBattle(before, {
      type: "UNIT_SUMMONED",
      enemy: summonEnemy,
      preferredSlots: [1, 2],
      maxAliveCopies: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summoned = result.value.units.find((value) => value.definitionId === summonEnemy.id);
    expect(summoned).toMatchObject({ faction: "enemy", slot: 1, eligibleRound: 3, currentHp: 70 });
    expect(result.value.initiativeQueueUnitIds).toEqual([]);
    expect(buildRoundInitiative(result.value.units, 2)).toMatchObject({ ok: true, value: { queueUnitIds: ["party:0", "enemy:0"] } });

    const capped = reduceBattle({ ...result.value, units: [...result.value.units, unit("enemy:2", "enemy", 2)] }, {
      type: "UNIT_SUMMONED",
      enemy: summonEnemy,
      preferredSlots: [2, 3],
      maxAliveCopies: 1,
    });
    expect(capped.ok).toBe(true);
    if (capped.ok) expect(capped.value.units.filter((value) => value.definitionId === summonEnemy.id && value.currentHp > 0)).toHaveLength(1);
  });

  it("拒绝非法阶段，成功事件返回不可变深拷贝", () => {
    const initial = snapshot();
    const invalid = reduceBattle(initial, { type: "TURN_END" });
    expect(invalid).toMatchObject({ ok: false, error: { code: "INVALID_BATTLE_PHASE", details: { actual: "INIT" } } });
    const clone = reduceBattle(initial, { type: "SPEED_CHANGED", unitId: "party:0", speed: 70 });
    expect(clone.ok).toBe(true);
    if (clone.ok) {
      expect(clone.value).not.toBe(initial);
      clone.value.units[0].stats.speed = 999;
      expect(initial.units[0].stats.speed).toBe(60);
    }
  });

  it("ROUND_START 通过状态 getter 读取有效 speed 再建立队列", () => {
    const before = snapshot({
      units: [unit("party:0", "party", 0, 55), {
        ...unit("enemy:0", "enemy", 0, 50),
        statuses: [{ stackId: "haste:1", statusId: "status_haste", sourceUnitId: "party:0", remainingOwnerTurns: 2, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 20, shieldRemaining: 0 }],
      }],
    });
    const haste: StatusDefinition = { id: "status_haste", nameKey: "haste", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "speed", flat: 0, percentBps: 2_000 }, canDispel: true, immunityTag: null, iconId: "haste" };
    const result = reduceBattle(before, { type: "ROUND_START" }, { getStatus: () => success(haste) });

    expect(result).toMatchObject({ ok: true, value: { phase: "ROUND_START", round: 1, initiativeQueueUnitIds: ["enemy:0", "party:0"] } });
    expect(before.units[1].stats.speed).toBe(50);
  });

  it("TURN_START 控制判定前只移除 guard，并拒绝状态 getter 的非法引用", () => {
    const guard: StatusDefinition = { id: "status_guard_30", nameKey: "guard", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "guard", directDamageReductionBps: 3_000 }, canDispel: true, immunityTag: null, iconId: "guard" };
    const haste: StatusDefinition = { id: "status_haste_keep", nameKey: "haste", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "speed", flat: 1, percentBps: 0 }, canDispel: true, immunityTag: null, iconId: "haste" };
    const before = snapshot({
      phase: "ROUND_START",
      round: 1,
      initiativeQueueUnitIds: ["party:0", "enemy:0"],
      units: [
        unit("party:0", "party", 0, 60, 100, 1, [
          { stackId: "guard:turn-start", statusId: guard.id, sourceUnitId: "party:0", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 20, shieldRemaining: 0 },
          { stackId: "haste:turn-start", statusId: haste.id, sourceUnitId: "party:0", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 20, shieldRemaining: 0 },
        ]),
        unit("enemy:0", "enemy", 0),
      ],
    });
    const selected = reduceBattle(before, { type: "TURN_START" }, { getStatus: (id) => success(id === guard.id ? guard : haste) });
    expect(selected).toMatchObject({ ok: true, value: { phase: "AWAIT_COMMAND" } });
    if (selected.ok) expect(selected.value.units[0].statuses.map((status) => status.statusId)).toEqual([haste.id]);

    const invalid = reduceBattle(before, { type: "TURN_START" }, { getStatus: () => success(guard) });
    expect(invalid).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT", details: { issueKey: "missing_status" } } });
    expect(before.units[0].statuses).toHaveLength(2);
  });
});
