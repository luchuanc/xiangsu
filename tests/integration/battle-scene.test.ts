import { describe, expect, it, vi } from "vitest";

import type {
  BattleDomainEventV1,
  BattleSnapshotV1,
  GameSaveV1,
} from "../../src/content/contracts";
import { calculateViewport } from "../../src/app/ViewportService";
import { BattleAnimator } from "../../src/scenes/battle/BattleAnimator";
import { BattleHud } from "../../src/scenes/battle/BattleHud";
import { BattleScene } from "../../src/scenes/battle/BattleScene";
import { BattleView } from "../../src/scenes/battle/BattleView";
import { TargetSelector } from "../../src/scenes/battle/TargetSelector";
import { RewardScreen } from "../../src/ui/screens/RewardScreen";

const stat = { maxHp: 100, attack: 10, defense: 10, speed: 10, critRateBps: 0, critDamageBps: 15000, effectHitBps: 0, effectResistBps: 0 };

function snapshot(overrides: Partial<BattleSnapshotV1> = {}): BattleSnapshotV1 {
  return {
    battleId: "battle_test",
    expeditionId: "exp_test",
    battleRevision: 1,
    encounterId: "encounter_test",
    encounterObjectId: "object_test",
    phase: "AWAIT_COMMAND",
    outcome: "ongoing",
    round: 1,
    units: [
      { unitId: "p1", definitionId: "char_p1", faction: "party", slot: 0, level: 1, prePercentStats: stat, staticPercentByStatBps: stat, stats: stat, currentHp: 80, energy: 25, cooldowns: {}, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [] },
      { unitId: "e1", definitionId: "enemy_e1", faction: "enemy", slot: 0, level: 1, prePercentStats: stat, staticPercentByStatBps: stat, stats: stat, currentHp: 100, energy: 0, cooldowns: {}, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [] },
    ],
    initiativeQueueUnitIds: ["p1", "e1"],
    currentUnitId: "p1",
    pendingEvents: [],
    pendingBossIntents: [],
    successfulItemUses: 0,
    abyssEchoOutcome: "notApplicable",
    rngState: [1, 2, 3, 4],
    firedComboKeys: [],
    roundTriggerCounts: {},
    battleTriggerCounts: {},
    metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 },
    reward: null,
    returnMapId: "map_town",
    returnSafePosition: { x: 1, y: 1 },
    ...overrides,
  };
}

function event(type: BattleDomainEventV1["type"], overrides: Record<string, unknown> = {}): BattleDomainEventV1 {
  return {
    type,
    eventId: `event_${type}`,
    sequence: 0,
    battleId: "battle_test",
    round: 1,
    rootActionId: "root_test",
    rootActionDefinitionId: "skill_test",
    chainDepth: 0,
    triggerSource: null,
    visualSkillId: null,
    contextSkillKind: null,
    effect: null,
    ...overrides,
  } as BattleDomainEventV1;
}

describe("RPG-020 战斗表现适配器", () => {
  it("投影 1v1 与 4v6 槽位，不改变领域队列顺序", () => {
    const one = new BattleView({ snapshot: snapshot() }).project();
    expect(one.party).toHaveLength(1);
    expect(one.enemies).toHaveLength(1);
    expect(one.timeline.map((item) => item.unitId)).toEqual(["p1", "e1"]);

    const units = [
      ...Array.from({ length: 4 }, (_, index) => ({ ...snapshot().units[0], unitId: `p${index + 1}`, slot: index })),
      ...Array.from({ length: 6 }, (_, index) => ({ ...snapshot().units[1], unitId: `e${index + 1}`, slot: index })),
    ];
    const fourVsSix = new BattleView({ snapshot: snapshot({ units, initiativeQueueUnitIds: units.map((unit) => unit.unitId) }) }).project();
    expect(fourVsSix.party.map((unit) => unit.slot)).toEqual([0, 1, 2, 3]);
    expect(fourVsSix.enemies.map((unit) => unit.slot)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("一级按钮、技能/更多抽屉和禁用理由不越过领域状态", () => {
    const hud = new BattleHud();
    expect(hud.primaryActions().map((action) => action.id)).toEqual(["basic", "skill", "defend", "item", "more"]);
    hud.openSecondary("skill");
    expect(hud.secondaryActions().map((action) => action.id)).toEqual(["active_1", "active_2", "ultimate"]);
    hud.openSecondary("more");
    expect(hud.secondaryActions().map((action) => action.id)).toEqual(["retreat", "log"]);
    hud.toggleSecondary("more");
    expect(hud.secondaryActions()).toEqual([]);
    hud.toggleSecondary("skill");
    expect(hud.secondaryActions().map((action) => action.id)).toEqual(["active_1", "active_2", "ultimate"]);
    hud.setActionAvailability("skill", false, "battle.skill_locked");
    expect(hud.primaryActions().find((action) => action.id === "skill")).toMatchObject({ enabled: false, disabledReasonKey: "battle.skill_locked" });
  });

  it("目标选择只接受显式合法目标，确认/取消不会改写快照", () => {
    const selector = new TargetSelector();
    selector.begin({ action: "active", skillId: "skill_test", targetRule: "singleEnemy" });
    const selected = selector.select("e1", snapshot());
    expect(selected.ok && selected.value.targetUnitIds).toEqual(["e1"]);
    const confirmed = selector.confirm(snapshot());
    expect(confirmed.ok && confirmed.value.targetUnitIds).toEqual(["e1"]);
    selector.cancel();
    expect(selector.isSelecting).toBe(false);
  });

  it("目标候选复用领域前排/嘲讽规则，随机与群体确认不写目标", () => {
    const base = snapshot();
    const party = base.units[0]!;
    const requested = { ...base.units[1]!, unitId: "e_blocked", slot: 3 };
    const front = { ...base.units[1]!, unitId: "e_front", slot: 0 };
    const formationSnapshot = snapshot({ units: [party, requested, front] });
    const selector = new TargetSelector();
    selector.begin({ action: "active", skillId: "skill_test", targetRule: "singleEnemy", requiresFrontAccess: true });
    expect(selector.legalTargets(formationSnapshot)).toEqual(["e_front"]);
    expect(selector.select("e_blocked", formationSnapshot)).toMatchObject({
      ok: false,
      error: { code: "FORMATION_BLOCKED", details: { targetUnitId: "e_blocked" } },
    });

    const taunter = { ...front, unitId: "e_taunter", slot: 0 };
    const marker = {
      ...base.units[1]!,
      unitId: "e_marker",
      slot: 1,
      statuses: [{
        stackId: "taunt_marker",
        statusId: "status_taunt",
        sourceUnitId: "e_taunter",
        remainingOwnerTurns: 1,
        skipNextOwnerTurnEndDecrement: false,
        sourceAttackSnapshot: 10,
        shieldRemaining: 0,
      }],
    };
    const tauntSnapshot = snapshot({ units: [party, requested, taunter, marker] });
    selector.cancel();
    selector.begin({ action: "active", skillId: "skill_test", targetRule: "singleEnemy", requiresFrontAccess: true });
    expect(selector.legalTargets(tauntSnapshot)).toEqual(["e_taunter"]);
    expect(selector.select("e_blocked", tauntSnapshot)).toMatchObject({
      ok: false,
      error: { code: "INVALID_TARGET", details: { reason: "TAUNTED", targetUnitId: "e_blocked" } },
    });

    selector.cancel();
    selector.begin({ action: "active", skillId: "skill_test", targetRule: "randomEnemy" });
    expect(selector.legalTargets(formationSnapshot)).toEqual([]);
    expect(selector.select("e_front", formationSnapshot)).toMatchObject({ ok: true, value: { targetUnitIds: [] } });
    expect(selector.confirm(formationSnapshot)).toMatchObject({ ok: true, value: { targetUnitIds: [] } });
  });

  it("BattleAnimator 对事件显式排队，零时长/null sfx 不入队且取消投影最终快照", async () => {
    const playSfx = vi.fn();
    const animator = new BattleAnimator({
      durationMs: { ACTION_STARTED: 0, DAMAGE_RESOLVED: 100 },
      audio: { playSfx },
      eventSfx: { ACTION_STARTED: null, DAMAGE_RESOLVED: "sfx_hit" },
    });
    const final = snapshot({ battleRevision: 2, units: [{ ...snapshot().units[0], currentHp: 50 }, snapshot().units[1]] });
    await animator.play([event("ACTION_STARTED"), event("DAMAGE_RESOLVED", { targetUnitId: "e1", sourceUnitId: "p1", effectIndex: 0, hitIndex: 0, damageKind: "direct", element: "physical", hitResult: "nonCritical", varianceBps: 10000, effectiveDefense: 10, elementMultiplierBps: 10000, shieldDamage: 0, hpDamage: 50, overkill: 0, hpBefore: 100, hpAfter: 50 })], final);
    expect(playSfx).toHaveBeenCalledTimes(1);
    expect(animator.isPlaying).toBe(false);
    animator.destroy();
  });

  it("Boss 意图、狂暴、Combo 和回响状态均从结构化快照/event 投影", async () => {
    const boss = new BattleView({
      snapshot: snapshot({ pendingBossIntents: [{ intentId: "intent_1", sourceUnitId: "e1", skillId: "skill_boss", targetStrategy: "lowestHpOpponent", declaredRound: 1 }] }),
      boss: { phaseThresholdBps: [7000, 3500], enrageRound: 3, enrageState: "pending", counterKind: "guard" },
    }).project();
    expect(boss.boss?.intent?.skillId).toBe("skill_boss");
    expect(boss.boss?.phaseThresholdBps).toEqual([7000, 3500]);
    expect(boss.boss?.enrage.state).toBe("pending");

    const combo = new BattleAnimator({ durationMs: { COMBO_TRIGGERED: 700 } });
    const first = event("COMBO_TRIGGERED", { eventId: "combo_event_1", comboId: "combo_test", ownerKey: "p1", rootActionId: "root_a", targetUnitIds: ["e1"], firstInBattle: true });
    const sameRoot = event("COMBO_TRIGGERED", { eventId: "combo_event_2", comboId: "combo_test", ownerKey: "p1", rootActionId: "root_a", targetUnitIds: ["e1"], firstInBattle: false });
    const differentRoot = event("COMBO_TRIGGERED", { eventId: "combo_event_3", comboId: "combo_test", ownerKey: "p1", rootActionId: "root_b", targetUnitIds: ["e1"], firstInBattle: false });
    expect(combo.projectCombo(first)).toMatchObject({ visible: true, durationMs: 700, collapsed: false });
    expect(combo.projectCombo(sameRoot)).toMatchObject({ collapsed: true });
    expect(combo.projectCombo(differentRoot)).toMatchObject({ collapsed: false });
    const nextBattle = snapshot({ battleId: "battle_next" });
    await combo.play([], nextBattle);
    const nextBattleCombo = event("COMBO_TRIGGERED", { eventId: "combo_event_4", battleId: "battle_next", comboId: "combo_test", ownerKey: "p1", rootActionId: "root_a", targetUnitIds: ["e1"], firstInBattle: false });
    expect(combo.projectCombo(nextBattleCombo)).toMatchObject({ collapsed: false });
    const echo = event("ABYSS_ECHO_EVALUATED", { echoId: "echo_1", success: false, failedReasons: ["MAX_ROUNDS"] });
    expect(combo.projectEcho(echo)).toMatchObject({ status: "failed", failedReasons: ["MAX_ROUNDS"] });
  });

  it("BattleScene 只在 gateway 保存成功后交付动画，并在 pause/destroy 时清理输入", async () => {
    const setEnabled = vi.fn();
    const dispatch = vi.fn(async () => ({ ok: true as const, value: { snapshot: snapshot({ battleRevision: 2 }), events: [], consumedItem: null }, save: {} as GameSaveV1, events: [], candidateId: "root_1" }));
    const animator = { play: vi.fn(async () => undefined), cancel: vi.fn(), destroy: vi.fn() };
    const scene = new BattleScene({
      getSnapshot: () => snapshot(),
      input: { setEnabled, resetAll: vi.fn() },
      gateway: { execute: dispatch },
      animator,
    });
    await scene.prepare();
    await scene.enter();
    const result = await scene.submitCommand({ type: "USE_BASIC", expectedBattleRevision: 1, actorUnitId: "p1", targetUnitIds: ["e1"] });
    expect(result.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(animator.play).toHaveBeenCalledTimes(1);
    await scene.pause();
    expect(setEnabled).toHaveBeenLastCalledWith(false);
    await scene.destroy();
    expect(animator.destroy).toHaveBeenCalledTimes(1);
  });

  it("BattleScene 仅把 CAS 成功返回的事件按序交给表现层，保存失败不预播", async () => {
    let frozenDuringExecute = false;
    const committedEvents = [
      event("ACTION_STARTED", { actorUnitId: "p1", actionKind: "basic", targetUnitIds: ["e1"] }),
      event("ACTION_FINISHED", { actorUnitId: "p1", outcomeAfter: "ongoing" }),
    ];
    const dispatch = vi.fn()
      .mockImplementationOnce(async () => ({ ok: false as const, error: { code: "SAVE_FAILED", details: { operation: "save" } } }))
      .mockImplementationOnce(async () => {
        frozenDuringExecute = scene.hud.isInputFrozen;
        return {
          ok: true as const,
          value: { snapshot: snapshot({ battleRevision: 2 }), events: committedEvents, consumedItem: null },
          save: {} as GameSaveV1,
          events: committedEvents,
          candidateId: "root_committed",
        };
      });
    const animateEvent = vi.fn();
    const presentation = {
      prepare: vi.fn(),
      enter: vi.fn(),
      update: vi.fn(),
      setViewport: vi.fn(),
      animateEvent,
      pause: vi.fn(),
      resume: vi.fn(),
      destroy: vi.fn(),
    };
    const scene = new BattleScene({
      getSnapshot: () => snapshot(),
      gateway: { execute: dispatch },
      view: presentation,
      viewport: calculateViewport({ width: 640, height: 360 }),
      animatorOptions: { durationMs: { ACTION_STARTED: 0, ACTION_FINISHED: 0 } },
    });
    await scene.prepare();
    await scene.enter();

    const failed = await scene.submitCommand({ type: "USE_BASIC", expectedBattleRevision: 1, actorUnitId: "p1", targetUnitIds: ["e1"] });
    expect(failed.ok).toBe(false);
    expect(animateEvent).not.toHaveBeenCalled();

    const committed = await scene.submitCommand({ type: "USE_BASIC", expectedBattleRevision: 1, actorUnitId: "p1", targetUnitIds: ["e1"] });
    expect(committed.ok).toBe(true);
    expect(frozenDuringExecute).toBe(true);
    expect(animateEvent.mock.calls.map(([value]) => (value as BattleDomainEventV1).type)).toEqual(["ACTION_STARTED", "ACTION_FINISHED"]);
    await scene.destroy();
  });

  it("Gateway 成功时先保持旧 HP，动画完成后才刷新最终投影；pause/resume 从 Store 恢复", async () => {
    let authoritative = snapshot();
    const finalSnapshot = snapshot({ battleRevision: 2, units: [{ ...snapshot().units[0]!, currentHp: 40 }, snapshot().units[1]!] });
    let releaseAnimation: (() => void) | null = null;
    const animator = {
      play: vi.fn(() => new Promise<{ cancelled: false; finalSnapshot: BattleSnapshotV1 }>((resolve) => {
        releaseAnimation = () => resolve({ cancelled: false, finalSnapshot });
      })),
      cancel: vi.fn(() => releaseAnimation?.()),
      destroy: vi.fn(),
    };
    const presentation = {
      prepare: vi.fn(),
      enter: vi.fn(),
      update: vi.fn(),
      setViewport: vi.fn(),
      animateEvent: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      destroy: vi.fn(),
    };
    const scene = new BattleScene({
      getSnapshot: () => authoritative,
      gateway: {
        execute: vi.fn(async () => {
          authoritative = finalSnapshot;
          return { ok: true as const, value: { snapshot: finalSnapshot, events: [event("DAMAGE_RESOLVED", { targetUnitId: "e1", sourceUnitId: "p1", damageKind: "direct", shieldDamage: 0, hpDamage: 60 })], consumedItem: null }, save: {} as GameSaveV1, events: [], candidateId: "candidate_visual" };
        }),
      },
      view: presentation,
      animator,
      viewport: calculateViewport({ width: 640, height: 360 }),
    });
    await scene.prepare();
    await scene.enter();
    const pending = scene.submitCommand({ type: "USE_BASIC", expectedBattleRevision: 1, actorUnitId: "p1", targetUnitIds: ["e1"] });
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.viewModel?.party[0]?.unit.currentHp).toBe(80);
    expect(presentation.update.mock.calls.every(([frame]) => (frame as { model: { party: Array<{ unit: { currentHp: number } }> } }).model.party[0]?.unit.currentHp === 80)).toBe(true);
    expect(releaseAnimation).not.toBeNull();
    releaseAnimation!();
    await pending;
    expect(scene.viewModel?.party[0]?.unit.currentHp).toBe(40);
    const finalFrame = presentation.update.mock.calls.at(-1)?.[0] as { model: { party: Array<{ unit: { currentHp: number } }> } };
    expect(finalFrame.model.party[0]?.unit.currentHp).toBe(40);

    const secondFinal = snapshot({ battleRevision: 3, units: [{ ...snapshot().units[0]!, currentHp: 15 }, snapshot().units[1]!] });
    authoritative = secondFinal;
    const pendingPause = scene.submitCommand({ type: "USE_BASIC", expectedBattleRevision: 2, actorUnitId: "p1", targetUnitIds: ["e1"] });
    await Promise.resolve();
    await Promise.resolve();
    await scene.pause();
    await pendingPause;
    authoritative = secondFinal;
    await scene.resume();
    expect(scene.viewModel?.party[0]?.unit.currentHp).toBe(15);
    await scene.destroy();
  });

  it("skipAnimation 读取权威快照并立即显示最终 HP，不把旧 snapshotValue 投影回来", async () => {
    let authoritative = snapshot();
    const finalSnapshot = snapshot({ battleRevision: 2, units: [{ ...snapshot().units[0]!, currentHp: 20 }, snapshot().units[1]!] });
    let releaseAnimation: (() => void) | null = null;
    const animator = {
      play: vi.fn(() => new Promise<{ cancelled: boolean; finalSnapshot: BattleSnapshotV1 }>((resolve) => {
        releaseAnimation = () => resolve({ cancelled: true, finalSnapshot });
      })),
      cancel: vi.fn(() => releaseAnimation?.()),
      destroy: vi.fn(),
    };
    const scene = new BattleScene({
      getSnapshot: () => authoritative,
      gateway: {
        execute: vi.fn(async () => {
          authoritative = finalSnapshot;
          return { ok: true as const, value: { snapshot: finalSnapshot, events: [event("DAMAGE_RESOLVED", { targetUnitId: "e1", sourceUnitId: "p1", damageKind: "direct", shieldDamage: 0, hpDamage: 60 })], consumedItem: null }, save: {} as GameSaveV1, events: [], candidateId: "candidate_skip" };
        }),
      },
      animator,
      viewport: calculateViewport({ width: 640, height: 360 }),
    });
    await scene.prepare();
    await scene.enter();
    const pending = scene.submitCommand({ type: "USE_BASIC", expectedBattleRevision: 1, actorUnitId: "p1", targetUnitIds: ["e1"] });
    await Promise.resolve();
    await Promise.resolve();
    scene.skipAnimation();
    expect(scene.viewModel?.party[0]?.unit.currentHp).toBe(20);
    releaseAnimation!();
    await pending;
    expect(scene.viewModel?.party[0]?.unit.currentHp).toBe(20);
    await scene.destroy();
  });

  it("BattleScene prepare 等待异步表现层完成后才允许 enter", async () => {
    let releasePrepare: () => void = () => { throw new Error("prepare resolver 未安装"); };
    let prepared = false;
    const presentation = {
      prepare: vi.fn(() => new Promise<void>((resolve) => {
        releasePrepare = () => { prepared = true; resolve(); };
      })),
      enter: vi.fn(),
      update: vi.fn(),
      setViewport: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      destroy: vi.fn(),
    };
    const scene = new BattleScene({
      getSnapshot: () => snapshot(),
      gateway: { execute: vi.fn() },
      view: presentation,
      viewport: calculateViewport({ width: 640, height: 360 }),
    });
    const preparing = scene.prepare();
    await Promise.resolve();
    expect(prepared).toBe(false);
    await expect(scene.enter()).rejects.toThrow("BattleScene 必须先 prepare");
    releasePrepare();
    await preparing;
    await expect(scene.enter()).resolves.toBeUndefined();
    await scene.destroy();
  });

  it("RewardScreen 对容量阻断保留 reward，领取成功后幂等", async () => {
    const claim = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, error: { code: "INVENTORY_FULL", details: { kind: "overflow", requiredSlots: 1, availableSlots: 0 } } })
      .mockResolvedValueOnce({ ok: true as const, value: { claimed: true } });
    const screen = new RewardScreen({ claim });
    screen.setReward({ transactionId: "reward_1", keyItems: [{ id: "eq_1", quality: "rare", breakthrough: "counter" }] });
    expect((await screen.claimReward()).ok).toBe(false);
    expect(screen.state.status).toBe("error");
    expect(screen.state.reward?.transactionId).toBe("reward_1");
    expect((await screen.claimReward()).ok).toBe(true);
    expect(screen.state.status).toBe("success");
    expect((await screen.claimReward()).ok).toBe(true);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("RewardScreen 复用领取中的 Promise，双击只提交一次", async () => {
    const pending: { resolve: ((result: { ok: true }) => void) | null } = { resolve: null };
    const claim = vi.fn(() => new Promise<{ ok: true }>((resolve) => {
      pending.resolve = resolve;
    }));
    const screen = new RewardScreen({ claim });
    screen.setReward({ transactionId: "reward_concurrent", keyItems: [{ id: "eq_1", quality: "epic" }] });

    const first = screen.claimReward();
    const second = screen.claimReward();
    expect(second).toBe(first);
    expect(claim).toHaveBeenCalledTimes(1);
    pending.resolve?.({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });
    expect(screen.state.claimed).toBe(true);
  });

  it("战斗 HUD 按安全区输出 48×48 按钮并保持 8px 间隔", () => {
    const hud = new BattleHud();
    const safeRect = { x: 16, y: 12, width: 608, height: 336, right: 624, bottom: 348 };
    hud.setSafeRect(safeRect);
    const layout = hud.getLayout();
    expect(layout).not.toBeNull();
    const primary = layout!.primary;
    expect(primary).toHaveLength(5);
    primary.forEach((action, index) => {
      expect(action.width).toBe(48);
      expect(action.height).toBe(48);
      expect(action.x).toBe(16 + index * 56);
      expect(action.y).toBe(292);
      expect(action.x + action.width).toBeLessThanOrEqual(safeRect.right);
      expect(action.y + action.height).toBeLessThanOrEqual(safeRect.bottom);
      if (index > 0) expect(action.x - (primary[index - 1]!.x + primary[index - 1]!.width)).toBe(8);
    });
  });
});
