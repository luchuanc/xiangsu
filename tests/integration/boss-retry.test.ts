import { describe, expect, it, vi } from "vitest";
import { verticalSliceContentRoot } from "../../src/content/data/verticalSlice";
import type { BattleSnapshotV1, GameSaveV1 } from "../../src/content/contracts";
import { SequentialIdFactory } from "../../src/domain/common/DomainContext";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { BossRetryCoordinator } from "../../src/app/BossRetryCoordinator";
import type { SaveCandidate, SaveCoordinatorResult } from "../../src/app/GameStore";

const timestamp = "2026-08-25T00:00:00.000Z";

function lease(bundleId = "battle"): { bundleId: string; release: ReturnType<typeof vi.fn> } {
  return { bundleId, release: vi.fn(async () => undefined) };
}

function battleFor(save: GameSaveV1, expeditionId: string): BattleSnapshotV1 {
  return {
    battleId: "battle_test_000001",
    expeditionId,
    battleRevision: 1,
    encounterId: "encounter_floor_01_boss",
    encounterObjectId: "obj_f01_boss",
    phase: "INIT",
    outcome: "ongoing",
    round: 1,
    units: [],
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
    metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 },
    reward: null,
    returnMapId: "map_floor_01",
    returnSafePosition: save.expedition?.safePosition ?? { x: 96, y: 896 },
  };
}

function harness(options: { submit?: (candidate: SaveCandidate) => SaveCoordinatorResult | Promise<SaveCoordinatorResult> } = {}) {
  const save = createNewGameSave(verticalSliceContentRoot, timestamp, { newGameSeed: 9, idFactory: new SequentialIdFactory() });
  save.world.bossRetryUnlockedFloorIds.push("floor_01");
  const store = { getSnapshot: () => save };
  const idFactory = new SequentialIdFactory();
  const created: SaveCandidate[] = [];
  const submit = vi.fn(async (candidate: SaveCandidate): Promise<SaveCoordinatorResult> => options.submit ? options.submit(candidate) : {
    ok: true as const,
    value: candidate.save,
    save: candidate.save,
    candidateId: candidate.candidateId,
    kind: candidate.kind,
    events: candidate.events,
  });
  const saveCoordinator = {
    createCandidate: vi.fn((kind: SaveCandidate["kind"], nextSave: GameSaveV1, candidateOptions: { expectedRevision?: number } = {}) => {
      const candidate = { candidateId: `root_test_${created.length + 1}`, kind, expectedRevision: candidateOptions.expectedRevision ?? save.revision, save: structuredClone(nextSave), events: [] } satisfies SaveCandidate;
      created.push(candidate);
      return candidate;
    }),
    submit,
  };
  const acquiredLease = lease("floor_01");
  const assetService = { acquire: vi.fn(async () => success(acquiredLease)) };
  const battleFactory = {
    create: vi.fn((input: { battleId: string; expedition: NonNullable<GameSaveV1["expedition"]> }) => success(battleFor(save, input.expedition.expeditionId))),
  };
  const content = {
    getCharacter: (id: string) => {
      const value = verticalSliceContentRoot.characters.find((item) => item.id === id);
      return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: "characters", issueKey: "missing" }));
    },
    getFloor: (id: string) => {
      const value = verticalSliceContentRoot.floors.find((item) => item.id === id);
      return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: "floors", issueKey: "missing" }));
    },
    getMap: (id: string) => {
      const value = verticalSliceContentRoot.maps.find((item) => item.id === id);
      return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: "maps", issueKey: "missing" }));
    },
    getEncounter: (id: string) => {
      const value = verticalSliceContentRoot.encounters.find((item) => item.id === id);
      return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: "encounters", issueKey: "missing" }));
    },
  };
  const attach = vi.fn();
  const coordinator = new BossRetryCoordinator({
    assetService,
    store,
    saveCoordinator,
    content,
    battleFactory,
    idFactory,
    seedFactory: { nextUint32: () => 77 },
    now: () => timestamp,
    battleBundleId: "floor_01",
    attach,
  });
  return { save, coordinator, assetService, saveCoordinator, submit, battleFactory, attach, acquiredLease, created };
}

describe("BossRetryCoordinator", () => {
  it("只有接触且未首通的 Boss 才能 detached 直入，成功后不刷新商店", async () => {
    const harnessValue = harness();
    const beforeShop = structuredClone(harnessValue.save.shop);
    const result = await harnessValue.coordinator.start({ floorId: "floor_01" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.save.expedition?.mode).toBe("bossRetry");
    expect(result.value.save.expedition?.defeatedEncounterObjectIds).toEqual([]);
    expect(result.value.save.expedition?.openedChestObjectIds).toEqual([]);
    expect(result.value.save.world.echoCharges).toBe(0);
    expect(result.value.save.shop).toEqual(beforeShop);
    expect(harnessValue.attach).toHaveBeenCalledTimes(1);
  });

  it("未接触或已首通拒绝且不消耗 expedition/battle ID", async () => {
    const uncontacted = harness();
    uncontacted.save.world.bossRetryUnlockedFloorIds = [];
    const uncontactedResult = await uncontacted.coordinator.start({ floorId: "floor_01" });
    expect(uncontactedResult.ok).toBe(false);
    if (!uncontactedResult.ok) expect(uncontactedResult.error.code).toBe("EXPEDITION_MODE_LOCKED");

    const cleared = harness();
    cleared.save.world.clearedBossEncounterIds.push("encounter_floor_01_boss");
    const clearedResult = await cleared.coordinator.start({ floorId: "floor_01" });
    expect(clearedResult.ok).toBe(false);
    if (!clearedResult.ok) expect(clearedResult.error.code).toBe("EXPEDITION_MODE_LOCKED");
    expect(cleared.battleFactory.create).not.toHaveBeenCalled();
  });

  it("保存失败保留同一 candidate/battle，重试成功且重复调用复用 in-flight Promise", async () => {
    let attempts = 0;
    const deferred: { resolve: (() => void) | null } = { resolve: null };
    const harnessValue = harness({ submit: async (candidate) => {
      attempts += 1;
      if (attempts === 1) return { ok: false as const, error: createDomainError("SAVE_FAILED", { operation: "save" }), candidateId: candidate.candidateId, kind: candidate.kind, events: [], blocked: false, requiresReload: false };
      return { ok: true as const, value: candidate.save, save: candidate.save, candidateId: candidate.candidateId, kind: candidate.kind, events: candidate.events };
    } });
    const first = harnessValue.coordinator.start({ floorId: "floor_01" });
    const same = harnessValue.coordinator.start({ floorId: "floor_01" });
    expect(same).toBe(first);
    const failed = await first;
    expect(failed.ok).toBe(false);
    expect(harnessValue.created).toHaveLength(1);
    expect(harnessValue.battleFactory.create).toHaveBeenCalledTimes(1);
    const retried = await harnessValue.coordinator.retry({ floorId: "floor_01" });
    expect(retried.ok).toBe(true);
    expect(harnessValue.created).toHaveLength(1);
    expect(harnessValue.battleFactory.create).toHaveBeenCalledTimes(1);
    expect(harnessValue.submit).toHaveBeenCalledTimes(2);
    void deferred;
  });
});
