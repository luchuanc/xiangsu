import { describe, expect, it, vi } from "vitest";
import { verticalSliceContentRoot } from "../../src/content/data/verticalSlice";
import type { BattleSnapshotV1, BattleUnitStateV1, GameSaveV1 } from "../../src/content/contracts";
import { SequentialIdFactory } from "../../src/domain/common/DomainContext";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { BattleAssistController, type BattleAssistClock } from "../../src/app/BattleAssistController";

const timestamp = "2026-08-25T00:00:00.000Z";

function unit(overrides: Partial<BattleUnitStateV1> = {}): BattleUnitStateV1 {
  return {
    unitId: "party_0", definitionId: "char_wanderer", faction: "party", slot: 0, level: 1,
    prePercentStats: { maxHp: 100, attack: 30, defense: 10, speed: 10, critRateBps: 0, critDamageBps: 15000, effectHitBps: 0, effectResistBps: 0 },
    staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
    stats: { maxHp: 100, attack: 30, defense: 10, speed: 10, critRateBps: 0, critDamageBps: 15000, effectHitBps: 0, effectResistBps: 0 },
    currentHp: 100, energy: 0, cooldowns: {}, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [],
    ...overrides,
  };
}

function snapshot(units: BattleUnitStateV1[], mode: "exploration" | "shortFarm" | "bossRetry" = "exploration"): { save: GameSaveV1; battle: BattleSnapshotV1 } {
  const save = createNewGameSave(verticalSliceContentRoot, timestamp, { newGameSeed: 2, idFactory: new SequentialIdFactory() });
  save.world.clearedBossEncounterIds.push("encounter_floor_01_boss");
  save.expedition = {
    expeditionId: "exp_test_000001", expeditionSeed: 1, mode, abyssEchoId: null, floorId: "floor_01", mapId: "map_floor_01",
    playerPosition: { x: 96, y: 896 }, safePosition: { x: 96, y: 896 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [],
    encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: timestamp,
  };
  const battle = {
    battleId: "battle_test_000001", expeditionId: "exp_test_000001", battleRevision: 4, encounterId: "encounter_floor_01_normal_a",
    encounterObjectId: "obj_f01_n01", phase: "AWAIT_COMMAND", outcome: "ongoing", round: 1, units,
    initiativeQueueUnitIds: units.map((item) => item.unitId), currentUnitId: "party_0", pendingEvents: [], pendingBossIntents: [],
    successfulItemUses: 0, abyssEchoOutcome: "notApplicable", rngState: [1, 2, 3, 4], firedComboKeys: [], roundTriggerCounts: {}, battleTriggerCounts: {},
    metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 },
    reward: null, returnMapId: "map_floor_01", returnSafePosition: { x: 96, y: 896 },
  } as BattleSnapshotV1;
  save.battle = battle;
  return { save, battle };
}

function clockHarness() {
  let pending: (() => void) | null = null;
  const clock: BattleAssistClock = { setTimeout: vi.fn((handler: () => void) => { pending = handler; return handler; }), clearTimeout: vi.fn(() => { pending = null; }) };
  return { clock, fire: () => { const handler = pending; pending = null; handler?.(); } };
}

function content() {
  return {
    getCharacter: (id: string) => { const value = verticalSliceContentRoot.characters.find((item) => item.id === id); return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: "characters", issueKey: "missing" } } }; },
    getFloor: (id: string) => { const value = verticalSliceContentRoot.floors.find((item) => item.id === id); return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: "floors", issueKey: "missing" } } }; },
    getEncounter: (id: string) => { const value = verticalSliceContentRoot.encounters.find((item) => item.id === id); return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: "encounters", issueKey: "missing" } } }; },
    getSkill: (id: string) => { const value = verticalSliceContentRoot.skills.find((item) => item.id === id); return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: "skills", issueKey: "missing" } } }; },
  };
}

describe("BattleAssistController", () => {
  it("只在已首通 exploration/shortFarm 的 normal/elite AWAIT_COMMAND 运行，350ms 后提交 basic", async () => {
    const harness = snapshot([unit(), unit({ unitId: "enemy_low", definitionId: "enemy_grass_slime", faction: "enemy", slot: 0, currentHp: 10, stats: { ...unit().stats, maxHp: 100 } }), unit({ unitId: "enemy_high", definitionId: "enemy_thorn_rat", faction: "enemy", slot: 1, currentHp: 50, stats: { ...unit().stats, maxHp: 100 } })]);
    const timer = clockHarness();
    const execute = vi.fn(async () => ({ ok: true }));
    const controller = new BattleAssistController({ content: content(), gateway: { execute }, clock: timer.clock, store: { getSnapshot: () => harness.save } });
    controller.setEnabled(true);
    expect(controller.onAwaitCommand({ save: harness.save, snapshot: harness.battle })).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    timer.fire();
    await Promise.resolve();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "USE_BASIC", expectedBattleRevision: 4, targetUnitIds: ["enemy_low"] }));
  });

  it("active 未学习/冷却或资源不足时只降级 basic，群体与随机命令目标数组为空", () => {
    const harness = snapshot([unit(), unit({ unitId: "enemy_1", definitionId: "enemy_grass_slime", faction: "enemy", slot: 0 })]);
    const timer = clockHarness();
    const controller = new BattleAssistController({ content: content(), gateway: { execute: vi.fn(async () => ({ ok: true })) }, clock: timer.clock });
    controller.setEnabled(true);
    controller.loadRecordedActions({ char_wanderer: { kind: "active", skillId: "skill_wanderer_rending_slash" } });
    const command = controller.buildCommand({ save: harness.save, snapshot: harness.battle });
    expect(command.ok).toBe(true);
    if (command.ok) expect(command.value.type).toBe("USE_BASIC");
    expect(controller.chooseTargets(harness.battle, "party_0", "allEnemies")).toEqual({ ok: true, value: [] });
    expect(controller.chooseTargets(harness.battle, "party_0", "randomEnemy")).toEqual({ ok: true, value: [] });
  });

  it("pointer/hidden/resize 会取消倒计时，bossRetry 与未满足场景不武装；同值目标按 slot/id 稳定", () => {
    const harness = snapshot([unit(), unit({ unitId: "enemy_b", definitionId: "enemy_grass_slime", faction: "enemy", slot: 1, currentHp: 20 }), unit({ unitId: "enemy_a", definitionId: "enemy_thorn_rat", faction: "enemy", slot: 0, currentHp: 20 })]);
    const timer = clockHarness();
    const controller = new BattleAssistController({ content: content(), gateway: { execute: vi.fn(async () => ({ ok: true })) }, clock: timer.clock });
    controller.setEnabled(true);
    expect(controller.onAwaitCommand({ save: harness.save, snapshot: harness.battle })).toBe(true);
    controller.onPointerDown();
    timer.fire();
    expect(controller.state.armed).toBe(false);
    expect(controller.chooseTargets(harness.battle, "party_0", "singleEnemy")).toEqual({ ok: true, value: ["enemy_a"] });
    const retry = snapshot(harness.battle.units, "bossRetry");
    expect(controller.onAwaitCommand({ save: retry.save, snapshot: retry.battle })).toBe(false);
  });
});

