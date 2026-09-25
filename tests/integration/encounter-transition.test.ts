import { describe, expect, it, vi } from "vitest";

import type { BattleSnapshotV1, EncounterDefinition, GameSaveV1, MapDefinition } from "../../src/content/contracts";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { EncounterTransitionService } from "../../src/app/EncounterTransitionService";

function save(): GameSaveV1 {
  return {
    schemaVersion: 1, contentVersion: "content-1.2.0", saveId: "slot_1", revision: 3, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", gold: 0, skillStoneFocusCharacterId: "char", characters: {}, party: { slots: [null, null, null, null] }, inventory: { equipment: [], skillStones: [], stackables: {}, overflowEquipment: [], overflowSkillStones: [] }, shop: { stockRevision: 1, generatedFromExpeditionId: null, offers: [] }, world: { highestUnlockedFloor: 1, clearedBossEncounterIds: [], bossRetryUnlockedFloorIds: [], completedQuestIds: [], discoveredComboIds: [], discoveredEnemyIds: [], echoCharges: 0, echoAttemptSequence: 0, clearedEchoIds: [], storyCompleted: false }, expedition: { expeditionId: "exp", expeditionSeed: 1, mode: "exploration", abyssEchoId: null, floorId: "floor", mapId: "map", playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: "2026-01-01T00:00:00.000Z" }, battle: null, battleAssist: { enabled: false, lastActionByCharacter: {} }, settings: { qualityPreset: "standard", battleAnimationSpeed: 1, musicVolume: 80, sfxVolume: 80, reducedFlashes: false, reducedScreenShake: false }, claimedRewardTransactionIds: [],
  };
}

const map: MapDefinition = { id: "map", nameKey: "map", widthTiles: 2, heightTiles: 2, tileSize: 16, assetBundleId: "floor", spawnPoint: { x: 0, y: 0 }, groundLayer: [0, 0, 0, 0], decorBackLayer: [0, 0, 0, 0], decorFrontLayer: [0, 0, 0, 0], collisionLayer: [0, 0, 0, 0], objects: [{ kind: "encounter", objectId: "object", encounterId: "enc", position: { x: 0, y: 0 }, behavior: { mode: "stationary", patrolPoints: [], wanderRadius: 0, detectionRadius: 0, leashRadius: 0, moveSpeed: 0 } }] };
const encounter: EncounterDefinition = { id: "enc", kind: "normal", fieldSpriteId: "sprite", enemyIdsBySlot: [], xpReward: 0, goldRewardMin: 0, goldRewardMax: 0, dropTableId: "drop", canRetreat: true, modifierIds: [] };

function battle(id: string): BattleSnapshotV1 {
  return { battleId: id, expeditionId: "exp", battleRevision: 0, encounterId: "enc", encounterObjectId: "object", phase: "INIT", outcome: "ongoing", round: 0, units: [], initiativeQueueUnitIds: [], currentUnitId: null, pendingEvents: [], pendingBossIntents: [], successfulItemUses: 0, abyssEchoOutcome: "notApplicable", rngState: [1, 2, 3, 4], firedComboKeys: [], roundTriggerCounts: {}, battleTriggerCounts: {}, metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 }, reward: null, returnMapId: "map", returnSafePosition: { x: 0, y: 0 } };
}

function service(overrides: Partial<ConstructorParameters<typeof EncounterTransitionService>[0]> = {}) {
  const current = save();
  const lease = { bundleId: "battle_common", release: vi.fn(async () => undefined) };
  const coordinator = { createCandidate: vi.fn((kind: "battle", next: GameSaveV1) => ({ candidateId: "root_1", kind, expectedRevision: current.revision, save: next, events: [] })), submit: vi.fn(async (candidate: { candidateId: string; kind: "battle"; save: GameSaveV1 }) => ({ ok: true as const, candidateId: candidate.candidateId, kind: candidate.kind, save: candidate.save, value: candidate.save, events: [] })) };
  const options = {
    assetService: { acquire: vi.fn(async () => success(lease)) }, store: { getSnapshot: () => current }, saveCoordinator: coordinator, content: { getMap: () => success(map), getEncounter: () => success(encounter) }, battleFactory: { create: vi.fn(({ battleId }: { battleId: string }) => success(battle(battleId))) }, idFactory: { next: vi.fn(() => "battle_1") }, battleBundleId: "battle_common", audio: { playSfx: vi.fn(() => true) }, ...overrides,
  } as const;
  return { service: new EncounterTransitionService(options as unknown as ConstructorParameters<typeof EncounterTransitionService>[0]), options, lease, current };
}

describe("EncounterTransitionService", () => {
  it("prepare 失败不建战、不播音效", async () => {
    const base = service({ assetService: { acquire: vi.fn(async () => failure(createDomainError("ASSET_LOAD_FAILED", { bundleId: "battle_common", attempts: 3 }))) } });
    const result = await base.service.transition({ contact: { objectId: "object", encounterId: "enc", position: { x: 0, y: 0 } }, playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 } });
    expect(result.ok).toBe(false);
    expect(base.options.battleFactory.create).not.toHaveBeenCalled();
    expect(base.options.audio?.playSfx).not.toHaveBeenCalled();
  });

  it("保存成功后才 attach/播 encounter，并在同一候选写 battle 与发现敌人", async () => {
    const base = service();
    const attach = vi.fn();
    const withAttach = service({ attach });
    const result = await withAttach.service.transition({ contact: { objectId: "object", encounterId: "enc", position: { x: 0, y: 0 } }, playerPosition: { x: 4, y: 4 }, safePosition: { x: 0, y: 0 } });
    expect(result.ok).toBe(true);
    expect(withAttach.options.saveCoordinator.createCandidate).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(withAttach.options.audio?.playSfx).toHaveBeenCalledWith("sfx_encounter");
    expect(base.current.battle).toBeNull();
  });

  it("提交候选时把 fixed-step 小数位置归一化为存档整数", async () => {
    const base = service();
    const result = await base.service.transition({
      contact: { objectId: "object", encounterId: "enc", position: { x: 0, y: 0 } },
      playerPosition: { x: 494.8, y: 863.2 },
      safePosition: { x: 480.4, y: 848.6 },
    });
    expect(result.ok).toBe(true);
    const candidate = vi.mocked(base.options.saveCoordinator.createCandidate).mock.calls[0]?.[1];
    expect(candidate.expedition?.playerPosition).toEqual({ x: 495, y: 863 });
    expect(candidate.expedition?.safePosition).toEqual({ x: 480, y: 849 });
  });

  it("expected revision 过期只释放资源", async () => {
    const base = service();
    const result = await base.service.transition({ expectedRevision: 2, contact: { objectId: "object", encounterId: "enc", position: { x: 0, y: 0 } }, playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 } });
    expect(result.ok).toBe(false);
    expect(base.lease.release).toHaveBeenCalledTimes(1);
    expect(base.options.saveCoordinator.submit).not.toHaveBeenCalled();
  });

  it("保存失败后同一接触重试复用 battle ID/candidate，成功后才播音效", async () => {
    const first = service();
    const submit = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: createDomainError("SAVE_FAILED", { operation: "save" }),
        candidateId: "root_1",
        kind: "battle" as const,
        events: [] as const,
        blocked: false,
        requiresReload: false,
      })
      .mockImplementation(async (candidate: { candidateId: string; kind: "battle"; save: GameSaveV1 }) => ({
        ok: true as const,
        candidateId: candidate.candidateId,
        kind: candidate.kind,
        save: candidate.save,
        value: candidate.save,
        events: [],
      }));
    const withRetry = service({ saveCoordinator: { ...first.options.saveCoordinator, submit } });
    const input = { contact: { objectId: "object", encounterId: "enc", position: { x: 0, y: 0 } }, playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 } };
    const failed = await withRetry.service.transition(input);
    expect(failed.ok).toBe(false);
    expect(withRetry.options.idFactory.next).toHaveBeenCalledTimes(1);
    expect(withRetry.options.audio?.playSfx).not.toHaveBeenCalled();
    expect(withRetry.lease.release).toHaveBeenCalledTimes(1);

    const retried = await withRetry.service.transition(input);
    expect(retried.ok).toBe(true);
    expect(withRetry.options.idFactory.next).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]?.[0].candidateId).toBe(submit.mock.calls[1]?.[0].candidateId);
    expect(withRetry.options.audio?.playSfx).toHaveBeenCalledTimes(1);
  });

  it("已在存档中击败的遭遇不可再次转场", async () => {
    const base = service();
    base.current.expedition?.defeatedEncounterObjectIds.push("object");
    const result = await base.service.transition({ contact: { objectId: "object", encounterId: "enc", position: { x: 0, y: 0 } }, playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 } });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("INVALID_TARGET");
    expect(base.options.battleFactory.create).not.toHaveBeenCalled();
    expect(base.options.saveCoordinator.submit).not.toHaveBeenCalled();
    expect(base.lease.release).toHaveBeenCalledTimes(1);
  });
});
