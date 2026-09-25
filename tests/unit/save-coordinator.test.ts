import { describe, expect, it } from "vitest";

import { fixtureContentRoot } from "../../src/content/data";
import { SequentialIdFactory } from "../../src/domain/common/DomainContext";
import { createDomainError, failure, success, type DomainResult } from "../../src/domain/common/DomainResult";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { AppLifecycleBridge } from "../../src/app/AppLifecycleBridge";
import { GameStore } from "../../src/app/GameStore";
import { SaveCoordinator, type SaveRepositoryWriter } from "../../src/app/SaveCoordinator";
import type { GameSaveV1 } from "../../src/content/contracts";

const timestamp = "2026-08-21T00:00:00.000Z";

class FakeRepository implements SaveRepositoryWriter {
  public calls: Array<{ expectedRevision: number; save: GameSaveV1 }> = [];
  public failures = 0;

  public async save(expectedRevision: number, nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    this.calls.push({ expectedRevision, save: structuredClone(nextSave) });
    if (this.failures > 0) {
      this.failures -= 1;
      return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
    }
    return success({ ...structuredClone(nextSave), revision: expectedRevision + 1, updatedAt: "2026-08-21T00:00:01.000Z" });
  }
}

class DeferredRepository implements SaveRepositoryWriter {
  public calls: Array<{ expectedRevision: number; save: GameSaveV1 }> = [];
  private readonly deferred: Array<{ expectedRevision: number; resolve: (result: DomainResult<GameSaveV1>) => void }> = [];

  public save(expectedRevision: number, nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    this.calls.push({ expectedRevision, save: structuredClone(nextSave) });
    return new Promise((resolve) => this.deferred.push({ expectedRevision, resolve }));
  }

  public resolveNext(value: GameSaveV1): void {
    const next = this.deferred.shift();
    if (!next) throw new Error("没有待完成的 repository 调用");
    next.resolve(success({ ...structuredClone(value), revision: next.expectedRevision + 1, updatedAt: "2026-08-21T00:00:01.000Z" }));
  }
}

function setup() {
  const initial = createNewGameSave(fixtureContentRoot, timestamp);
  const store = new GameStore(initial);
  const repository = new FakeRepository();
  const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
  return { initial, store, repository, coordinator };
}

describe("SaveCoordinator and GameStore", () => {
  it("keeps failed battle dirty, discards events, and retries the same candidate without new IDs", async () => {
    const { initial, store, repository, coordinator } = setup();
    repository.failures = 1;
    const candidate = coordinator.createCandidate("battle", { ...initial, gold: 250 }, { events: [{ type: "DAMAGE_RESOLVED" }], command: { type: "USE_BASIC" } });
    const failed = await coordinator.submit(candidate);
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error("expected failure");
    expect(failed.events).toEqual([]);
    expect(coordinator.isDirty).toBe(true);
    expect(store.getSnapshot().gold).toBe(200);
    expect(coordinator.pendingCandidates).toHaveLength(1);

    const retried = await coordinator.retry(candidate.candidateId);
    expect(retried.ok).toBe(true);
    if (!retried.ok) throw new Error("expected success");
    expect(retried.events).toEqual([{ type: "DAMAGE_RESOLVED" }]);
    expect(store.getSnapshot().gold).toBe(250);
    expect(store.getSnapshot().revision).toBe(2);
    expect(coordinator.isDirty).toBe(false);
    expect(repository.calls).toHaveLength(2);
    expect(candidate.candidateId).toBe("root_test_000001");
    expect(coordinator.createCandidate("position", initial).candidateId).toBe("root_test_000002");
  });

  it("keeps only the newest failed position and blocks transaction writes while a blocking pending exists", async () => {
    const { initial, repository, coordinator } = setup();
    repository.failures = 2;
    const first = await coordinator.commit("position", { ...initial, gold: 201 });
    expect(first.ok).toBe(false);
    const second = await coordinator.commit("position", { ...initial, gold: 202 });
    expect(second.ok).toBe(false);
    expect(coordinator.pendingCandidates).toHaveLength(1);
    expect(coordinator.pendingCandidates[0].save.gold).toBe(202);

    repository.failures = 1;
    const failedAsset = await coordinator.commit("asset", { ...initial, gold: 300 });
    expect(failedAsset.ok).toBe(false);
    const blocking = await coordinator.commit("transaction", { ...initial, gold: 301 });
    expect(blocking.ok).toBe(false);
    if (blocking.ok) throw new Error("expected pending block");
    expect(blocking.blocked).toBe(true);
    expect(repository.calls).toHaveLength(3);
  });

  it("does not call repository when an unsubmitted candidate is cancelled", () => {
    const { initial, repository, coordinator } = setup();
    const candidate = coordinator.createCandidate("transaction", initial);
    expect(coordinator.cancel(candidate.candidateId)).toBe(false);
    expect(repository.calls).toHaveLength(0);
    expect(coordinator.isDirty).toBe(false);
  });

  it("exposes recursively frozen snapshots and only notifies after success", async () => {
    const { initial, store, coordinator } = setup();
    const notifications: number[] = [];
    store.subscribe((snapshot) => notifications.push(snapshot.gold));
    expect(() => {
      (store.getSnapshot() as unknown as { inventory: { stackables: Record<string, number> } }).inventory.stackables.item_forge_shard = 10;
    }).toThrow();
    await coordinator.commit("transaction", { ...initial, gold: 222 });
    expect(notifications).toEqual([222]);
  });

  it("keeps all shop fields byte-for-byte unchanged in bossRetry/abyssEcho modes", async () => {
    const { initial, repository, coordinator } = setup();
    const protectedSave = structuredClone(initial);
    protectedSave.expedition = {
      expeditionId: "exp_retry", expeditionSeed: 1, mode: "bossRetry", abyssEchoId: null, floorId: "floor_01", mapId: "map_floor_01",
      playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0,
      focusedEliteStoneConsumed: false, startedAt: timestamp,
    };
    const started = await coordinator.commit("modeStart", protectedSave);
    expect(started.ok).toBe(true);
    const changed = structuredClone(protectedSave);
    changed.shop.stockRevision = 2;
    const rejected = await coordinator.commit("battle", changed);
    expect(rejected.ok).toBe(false);
    expect(repository.calls).toHaveLength(1);
  });

  it("reserves a blocking candidate before returning and rejects a same-tick second write", async () => {
    const initial = createNewGameSave(fixtureContentRoot, timestamp);
    const store = new GameStore(initial);
    const repository = new DeferredRepository();
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    const first = coordinator.commit("asset", { ...initial, gold: 201 });
    const second = coordinator.commit("transaction", { ...initial, gold: 202 });
    const blocked = await second;
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("expected blocking reservation");
    expect(blocked.blocked).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(repository.calls).toHaveLength(1);
    repository.resolveNext(initial);
    await first;
  });

  it("merges same-tick positions and does not raise a stale reload", async () => {
    const initial = createNewGameSave(fixtureContentRoot, timestamp);
    const store = new GameStore(initial);
    const repository = new DeferredRepository();
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    const first = coordinator.commit("position", { ...initial, gold: 201 });
    const second = coordinator.commit("position", { ...initial, gold: 202 });
    expect(coordinator.pendingCandidates).toHaveLength(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(repository.calls).toHaveLength(1);
    expect(repository.calls[0].save.gold).toBe(202);
    repository.resolveNext({ ...initial, gold: 202 });
    await Promise.all([first, second]);
    expect(store.getSnapshot().gold).toBe(202);
    expect(coordinator.mustReload).toBe(false);
  });

  it("commits both in-flight positions, notifies in revision order, and keeps the latest pending candidate", async () => {
    const initial = createNewGameSave(fixtureContentRoot, timestamp);
    const store = new GameStore(initial);
    const repository = new DeferredRepository();
    const coordinator = new SaveCoordinator({ store, repository, idFactory: new SequentialIdFactory() });
    const notifications: number[] = [];
    store.subscribe((snapshot) => notifications.push(snapshot.gold));
    const first = coordinator.commit("position", { ...initial, gold: 201 });
    await Promise.resolve();
    await Promise.resolve();
    expect(repository.calls).toHaveLength(1);
    const second = coordinator.commit("position", { ...initial, gold: 202 });
    repository.resolveNext({ ...initial, gold: 201 });
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(repository.calls).toHaveLength(2);
    expect(repository.calls[1].expectedRevision).toBe(2);
    repository.resolveNext({ ...initial, gold: 202 });
    const secondResult = await second;
    expect(secondResult.ok).toBe(true);
    expect(coordinator.mustReload).toBe(false);
    expect(store.getSnapshot().gold).toBe(202);
    expect(store.getSnapshot().revision).toBe(3);
    expect(notifications).toEqual([201, 202]);
  });
});

describe("AppLifecycleBridge", () => {
  it("only emits hidden/visible/pagehide signals and can detach", () => {
    const documentTarget = new EventTarget() as EventTarget & { visibilityState: "hidden" | "visible" };
    documentTarget.visibilityState = "visible";
    const windowTarget = new EventTarget();
    const signals: string[] = [];
    const bridge = new AppLifecycleBridge({ documentTarget, windowTarget, onSignal: (signal) => signals.push(signal) });
    bridge.attach();
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("pagehide"));
    bridge.detach();
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(signals).toEqual(["visible", "hidden", "pagehide"]);
  });
});
