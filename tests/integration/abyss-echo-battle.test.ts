import { describe, expect, it, vi } from "vitest";
import { ABYSS_ECHO_DEFINITIONS } from "../../src/content/data/abyssEchoes";
import { abyssEchoContentRoot } from "../../src/content/data/abyssEchoes";
import { floors06To10Content } from "../../src/content/data/floors06-10";
import { BattleFactory } from "../../src/domain/battle/BattleFactory";
import { evaluateAbyssEchoOutcome } from "../../src/domain/battle/BattleReducer";
import type { BattleSnapshotV1, GameSaveV1 } from "../../src/content/contracts";
import { SequentialIdFactory } from "../../src/domain/common/DomainContext";
import { createDomainError } from "../../src/domain/common/DomainResult";
import { createNewGameSave, validateGameSave } from "../../src/domain/save/GameSave";
import { AbyssEchoCoordinator } from "../../src/app/AbyssEchoCoordinator";
import { AbyssEchoService } from "../../src/domain/town/AbyssEchoService";
import type { SaveCandidate, SaveCoordinatorResult } from "../../src/app/GameStore";
import { GameStore } from "../../src/app/GameStore";
import { SaveCoordinator, type SaveRepositoryWriter } from "../../src/app/SaveCoordinator";
import { failure, success, type DomainResult } from "../../src/domain/common/DomainResult";
import { BattleCommandGateway } from "../../src/app/BattleCommandGateway";

const timestamp = "2026-08-25T00:00:00.000Z";

class EchoRepository implements SaveRepositoryWriter {
  public fail = false;
  public calls: GameSaveV1[] = [];

  public async save(_expectedRevision: number, nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    this.calls.push(structuredClone(nextSave));
    if (this.fail) return failure({ code: "SAVE_FAILED", details: { operation: "save" } });
    return success({ ...structuredClone(nextSave), revision: nextSave.revision + 1 });
  }
}

function content() {
  const get = <T extends { id: string }>(values: readonly T[], id: string) => {
    const value = values.find((candidate) => candidate.id === id);
    return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: id, issueKey: "missing" } } };
  };
  return {
    getCharacter: (id: string) => get(floors06To10Content.characters, id),
    getSkill: (id: string) => get(floors06To10Content.skills, id),
    getEnemy: (id: string) => get(floors06To10Content.enemies, id),
    getEncounter: (id: string) => get(floors06To10Content.encounters, id),
    getMap: (id: string) => get(floors06To10Content.maps, id),
    getAbyssEcho: (id: string) => get(ABYSS_ECHO_DEFINITIONS, id),
    getFloor: (id: string) => get(floors06To10Content.floors, id),
  };
}

function battleSave(): GameSaveV1 {
  const value = createNewGameSave(floors06To10Content, timestamp, { newGameSeed: 1, idFactory: new SequentialIdFactory() });
  value.world.highestUnlockedFloor = 10;
  value.world.storyCompleted = true;
  value.world.clearedBossEncounterIds = floors06To10Content.floors.map((floor) => floor.bossEncounterId);
  value.world.echoCharges = 1;
  return value;
}

function makeEchoInput(echoId = "echo_f06_iron") {
  const save = battleSave();
  const echo = ABYSS_ECHO_DEFINITIONS.find((value) => value.id === echoId)!;
  const floor = floors06To10Content.floors.find((value) => value.id === echo.floorId)!;
  const map = floors06To10Content.maps.find((value) => value.id === floor.mapId)!;
  const encounter = floors06To10Content.encounters.find((value) => value.id === echo.bossEncounterId)!;
  const expedition = { expeditionId: "exp_echo", expeditionSeed: 7, mode: "abyssEcho" as const, abyssEchoId: echo.id, floorId: floor.id, mapId: map.id, playerPosition: map.spawnPoint, safePosition: map.spawnPoint, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: timestamp };
  const encounterObject = { kind: "encounter" as const, objectId: "", position: map.spawnPoint, encounterId: encounter.id, behavior: { mode: "stationary" as const, patrolPoints: [], wanderRadius: 0, detectionRadius: 0, leashRadius: 0, moveSpeed: 0 } };
  return { save, echo, floor, map, encounter, expedition, encounterObject, input: { battleId: "battle_echo", expedition, map, encounter, encounterObject, party: save.party, characters: save.characters, returnMapId: "map_town", returnSafePosition: { x: 16, y: 16 }, comboIds: floors06To10Content.combos.map((combo) => combo.id), rngState: [1, 2, 3, 4] as [number, number, number, number], echo } };
}

function gatewayContent() {
  const base = content();
  const get = <T extends { id: string }>(values: readonly T[], id: string) => {
    const value = values.find((candidate) => candidate.id === id);
    return value ? success(value) : failure({ code: "INVALID_CONTENT" as const, details: { path: id, issueKey: "missing" } });
  };
  return {
    ...base,
    getItem: (id: string) => get(abyssEchoContentRoot.items, id),
    getDropTable: (id: string) => get(abyssEchoContentRoot.dropTables, id),
    getSkillAffix: (id: string) => get(abyssEchoContentRoot.skillAffixes, id),
    getRoot: () => abyssEchoContentRoot,
  };
}

function makeGatewayEchoSave(echoId = "echo_f06_iron", round = 1): GameSaveV1 {
  const value = makeEchoInput(echoId);
  const battleResult = new BattleFactory(content()).create(value.input);
  if (!battleResult.ok) throw new Error(JSON.stringify(battleResult.error));
  const battle = structuredClone(battleResult.value);
  battle.phase = "AWAIT_COMMAND";
  battle.round = round;
  battle.currentUnitId = "party:0";
  const boss = battle.units.find((unit) => unit.faction === "enemy");
  if (!boss) throw new Error("missing echo boss");
  boss.currentHp = 1;
  value.save.expedition = structuredClone(value.expedition);
  value.save.battle = battle;
  value.save.world.highestUnlockedFloor = 10;
  value.save.world.storyCompleted = true;
  value.save.world.clearedBossEncounterIds = floors06To10Content.floors.map((floor) => floor.bossEncounterId);
  value.save.world.echoAttemptSequence = 1;
  return value.save;
}

describe("AbyssEcho battle wiring", () => {
  it("四项倍率只作用初始 Boss，回响直达战斗 objectId 为空并返回城镇", () => {
    const value = makeEchoInput("echo_f06_iron");
    const result = new BattleFactory(content()).create(value.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.encounterObjectId).toBe("");
    expect(result.value.returnMapId).toBe("map_town");
    const boss = result.value.units.find((unit) => unit.faction === "enemy");
    expect(boss?.staticPercentByStatBps).toMatchObject({ maxHp: 1500, attack: 1000, defense: 0, speed: 0 });
  });

  it("按固定顺序检查回合、倒地和 Combo，并把 objective 失败置为 failed", () => {
    const value = makeEchoInput("echo_f06_hunger");
    const base = new BattleFactory(content()).create(value.input);
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const overRounds = evaluateAbyssEchoOutcome(base.value, value.echo, { round: 13, comboTriggers: 1 });
    expect(overRounds).toMatchObject({ ok: true, value: { success: false, failedReasons: ["MAX_ROUNDS"] } });
    const knockouts = evaluateAbyssEchoOutcome(base.value, value.echo, { round: 1, knockouts: 1, comboTriggers: 1 });
    expect(knockouts).toMatchObject({ ok: true, value: { success: false, failedReasons: ["MAX_KNOCKOUTS"] } });
    const combo = evaluateAbyssEchoOutcome(base.value, value.echo, { round: 1, comboTriggers: 0 });
    expect(combo).toMatchObject({ ok: true, value: { success: false, failedReasons: ["COMBO_REQUIRED"] } });
  });

  it("目标全部满足时成功，失败不会改变传入快照", () => {
    const value = makeEchoInput("echo_f06_iron");
    const base = new BattleFactory(content()).create(value.input);
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const before = structuredClone(base.value) as BattleSnapshotV1;
    const result = evaluateAbyssEchoOutcome(base.value, value.echo, { round: 5, knockouts: 0, comboTriggers: 0 });
    expect(result).toMatchObject({ ok: true, value: { success: true, failedReasons: [] } });
    expect(base.value).toEqual(before);
  });

  it("保存失败保留同一回响候选，重试不重复扣次数、分配 ID 或创建战斗", async () => {
    const value = makeEchoInput("echo_f06_iron");
    const idFactory = new SequentialIdFactory();
    const service = new AbyssEchoService({
      content: content(),
      idFactory,
      seedFactory: { nextUint32: () => 777 },
      now: () => timestamp,
    });
    const save = value.save;
    save.world.storyCompleted = true;
    save.world.highestUnlockedFloor = 10;
    save.world.echoCharges = 1;
    const store = { getSnapshot: () => save };
    const firstLease = { bundleId: "battle_common", release: vi.fn(async () => undefined) };
    const secondLease = { bundleId: "battle_common", release: vi.fn(async () => undefined) };
    const assetService = { acquire: vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: firstLease })
      .mockResolvedValueOnce({ ok: true as const, value: secondLease }) };
    const created: SaveCandidate[] = [];
    let submitCount = 0;
    const submit = vi.fn(async (candidate: SaveCandidate): Promise<SaveCoordinatorResult> => {
      submitCount += 1;
      if (submitCount === 1) return { ok: false, error: createDomainError("SAVE_FAILED", { operation: "save" }), candidateId: candidate.candidateId, kind: candidate.kind, events: [], blocked: false, requiresReload: false };
      return { ok: true, value: candidate.save, save: candidate.save, candidateId: candidate.candidateId, kind: candidate.kind, events: candidate.events };
    });
    const saveCoordinator = {
      createCandidate: vi.fn((kind: SaveCandidate["kind"], nextSave: GameSaveV1, options: { expectedRevision?: number } = {}) => {
        const candidate = { candidateId: `candidate_${created.length + 1}`, kind, expectedRevision: options.expectedRevision ?? save.revision, save: structuredClone(nextSave), events: [] } satisfies SaveCandidate;
        created.push(candidate);
        return candidate;
      }),
      submit,
    };
    const battleFactory = {
      create: (input: Parameters<BattleFactory["create"]>[0]) => {
        const result = new BattleFactory(content()).create(input);
        return result;
      },
    };
    const attach = vi.fn();
    const coordinator = new AbyssEchoCoordinator({
      assetService,
      store,
      saveCoordinator,
      service,
      battleFactory,
      battleBundleId: "battle_common",
      attach,
    });

    const first = coordinator.start({ echoId: value.echo.id });
    const same = coordinator.start({ echoId: value.echo.id });
    expect(same).toBe(first);
    const failed = await first;
    expect(failed.ok).toBe(false);
    expect(created).toHaveLength(1);
    expect(created[0]?.save.world.echoCharges).toBe(0);
    expect(created[0]?.save.expedition?.mode).toBe("abyssEcho");
    expect(created[0]?.save.battle?.encounterObjectId).toBe("");
    expect(validateGameSave(created[0]?.save, abyssEchoContentRoot)).toMatchObject({ ok: true });

    const retried = await coordinator.retry({ echoId: value.echo.id });
    expect(retried.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]?.[0]).toBe(submit.mock.calls[1]?.[0]);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(firstLease.release).toHaveBeenCalledTimes(1);
    expect(secondLease.release).not.toHaveBeenCalled();
  });

  it("Gateway 在回响终局按目标写 COMPLETE/回城，成功追加奖励且终局事件沿用根行动", async () => {
    const initial = makeGatewayEchoSave("echo_f06_iron", 1);
    const store = new GameStore(initial);
    const repository = new EchoRepository();
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    const gateway = new BattleCommandGateway({
      store,
      coordinator,
      content: gatewayContent(),
      nextId: (kind) => `${kind}_echo_gateway`,
    });

    const result = await gateway.execute({ type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:1"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.expedition).toBeNull();
    expect(result.save.battle?.phase).toBe("COMPLETE");
    expect(result.save.battle?.abyssEchoOutcome).toBe("success");
    expect(result.save.battle?.reward?.source).toEqual({ kind: "abyssEcho", echoId: "echo_f06_iron", encounterId: "encounter_floor_06_boss" });
    expect(result.save.world.clearedEchoIds).toEqual(["echo_f06_iron"]);
    const rootActionId = result.events.find((event) => event.type === "ACTION_STARTED")?.rootActionId;
    const rootActionDefinitionId = result.events.find((event) => event.type === "ACTION_STARTED")?.rootActionDefinitionId;
    const evaluated = result.events.find((event) => event.type === "ABYSS_ECHO_EVALUATED");
    const reward = result.events.find((event) => event.type === "REWARD_PREPARED");
    expect(evaluated).toMatchObject({ type: "ABYSS_ECHO_EVALUATED", success: true, failedReasons: [] });
    expect(reward).toMatchObject({ type: "REWARD_PREPARED" });
    expect(evaluated?.rootActionId).toBe(rootActionId);
    expect(evaluated?.rootActionDefinitionId).toBe(rootActionDefinitionId);
    expect(reward?.rootActionId).toBe(rootActionId);
    expect(result.events.map((event) => event.sequence)).toEqual(result.events.map((_event, index) => index));
    expect(validateGameSave(result.save, abyssEchoContentRoot)).toMatchObject({ ok: true });
  });

  it("相同回响远征 seed/attempt 的 loot 不受终端战斗 RNG 轨迹影响，且保留战斗 RNG", async () => {
    const run = async (rngState: [number, number, number, number]) => {
      const initial = makeGatewayEchoSave("echo_f06_iron", 1);
      if (!initial.battle) throw new Error("missing echo battle");
      initial.battle.rngState = [...rngState];
      const store = new GameStore(initial);
      const repository = new EchoRepository();
      const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
      let idIndex = 0;
      const gateway = new BattleCommandGateway({
        store,
        coordinator,
        content: gatewayContent(),
        nextId: (kind) => `${kind}_echo_rng_${idIndex++}`,
      });
      const result = await gateway.execute({ type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:1"] });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      return result;
    };

    const first = await run([1, 2, 3, 4]);
    const second = await run([101, 202, 303, 404]);
    expect(first.save.expedition).toBeNull();
    expect(second.save.expedition).toBeNull();
    expect(first.save.battle?.reward).toEqual(second.save.battle?.reward);
    expect(first.save.gold).toBe(second.save.gold);
    expect(first.save.inventory).toEqual(second.save.inventory);
    expect(first.save.claimedRewardTransactionIds).toEqual(second.save.claimedRewardTransactionIds);
    expect(first.save.battle?.rngState).not.toEqual(second.save.battle?.rngState);
    expect(first.save.battle?.rngState).toEqual(first.value.snapshot.rngState);
    expect(second.save.battle?.rngState).toEqual(second.value.snapshot.rngState);
  });

  it("成功奖励保存失败后重试复用同一 candidate，不重抽 loot 或覆盖战斗 RNG", async () => {
    const initial = makeGatewayEchoSave("echo_f06_iron", 1);
    const store = new GameStore(initial);
    const repository = new EchoRepository();
    repository.fail = true;
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    let idIndex = 0;
    const gateway = new BattleCommandGateway({
      store,
      coordinator,
      content: gatewayContent(),
      nextId: (kind) => `${kind}_echo_retry_${idIndex++}`,
    });

    const failed = await gateway.execute({ type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:1"] });
    expect(failed.ok).toBe(false);
    if (failed.ok || !failed.candidateId) return;
    const pending = coordinator.pendingCandidates[0]?.save;
    if (!pending?.battle) throw new Error("missing pending echo reward");
    repository.fail = false;
    const retried = await gateway.retry(failed.candidateId);
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(repository.calls).toHaveLength(2);
    expect(repository.calls[0]).toEqual(repository.calls[1]);
    expect(retried.save.battle?.reward).toEqual(pending.battle.reward);
    expect(retried.save.battle?.rngState).toEqual(pending.battle.rngState);
  });

  it("目标失败仍完成回城但不生成奖励/新增 clearedEchoId，保存失败重试复用同一终局候选", async () => {
    const initial = makeGatewayEchoSave("echo_f06_iron", 12);
    const store = new GameStore(initial);
    const repository = new EchoRepository();
    repository.fail = true;
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    const gateway = new BattleCommandGateway({
      store,
      coordinator,
      content: gatewayContent(),
      nextId: (kind) => `${kind}_echo_gateway_failure`,
    });

    const failed = await gateway.execute({ type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:1"] });
    expect(failed.ok).toBe(false);
    expect(store.getSnapshot()).toEqual(initial);
    if (failed.ok || !failed.candidateId) return;
    const candidateSave = coordinator.pendingCandidates[0]?.save;
    expect(candidateSave?.expedition).toBeNull();
    expect(candidateSave?.battle?.phase).toBe("COMPLETE");
    expect(candidateSave?.battle?.abyssEchoOutcome).toBe("failed");
    expect(candidateSave?.battle?.reward).toBeNull();
    expect(candidateSave?.world.clearedEchoIds).toEqual([]);
    expect(candidateSave?.battle?.pendingBossIntents).toEqual([]);
    expect(candidateSave?.battle?.pendingEvents).toEqual([]);

    repository.fail = false;
    const retried = await gateway.retry(failed.candidateId);
    expect(retried.ok).toBe(true);
    expect(repository.calls).toHaveLength(2);
    expect(repository.calls[0]).toEqual(repository.calls[1]);
    expect(validateGameSave(store.getSnapshot(), abyssEchoContentRoot)).toMatchObject({ ok: true });
  });
});
