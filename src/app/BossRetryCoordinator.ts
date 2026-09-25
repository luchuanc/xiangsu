import type {
  BattleSnapshotV1,
  EncounterDefinition,
  ExpeditionSnapshotV1,
  FloorDefinition,
  GameSaveV1,
  MapDefinition,
} from "../content/contracts";
import type { IdFactory, SeedFactory } from "../domain/common/DomainContext";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../domain/common/DomainResult";
import { validatePartyForExpedition, type PartyContentSource } from "../domain/party/PartyService";
import type { AssetLease } from "./AssetService";
import type { SaveCandidate, SaveCoordinator } from "./GameStore";

export interface BossRetryAssetService {
  acquire(bundleId: string): Promise<DomainResult<AssetLease>>;
}

export interface BossRetryStore {
  getSnapshot(): Readonly<GameSaveV1>;
}

export interface BossRetryContent extends PartyContentSource {
  getFloor(id: string): DomainResult<Readonly<FloorDefinition>>;
  getMap(id: string): DomainResult<Readonly<MapDefinition>>;
  getEncounter(id: string): DomainResult<Readonly<EncounterDefinition>>;
}

export interface BossRetryBattleFactory {
  create(input: {
    readonly battleId: string;
    readonly expedition: Readonly<ExpeditionSnapshotV1>;
    readonly map: Readonly<MapDefinition>;
    readonly encounter: Readonly<EncounterDefinition>;
    readonly encounterObject: Extract<MapDefinition["objects"][number], { kind: "encounter" }>;
    readonly save: Readonly<GameSaveV1>;
  }): DomainResult<BattleSnapshotV1>;
}

export interface BossRetryAudio {
  playSfx(id: "sfx_encounter"): boolean;
}

export interface BossRetryOptions {
  readonly assetService: BossRetryAssetService;
  readonly store: BossRetryStore;
  readonly saveCoordinator: Pick<SaveCoordinator, "createCandidate" | "submit">;
  readonly content: BossRetryContent;
  readonly battleFactory: BossRetryBattleFactory;
  readonly idFactory: Pick<IdFactory, "next">;
  readonly seedFactory: Pick<SeedFactory, "nextUint32">;
  readonly now: () => string;
  readonly battleBundleId: string;
  readonly audio?: BossRetryAudio;
  /** bossRetry 不挂载 MapScene；该回调只在保存成功后通知战斗场景。 */
  readonly attach?: (battle: Readonly<BattleSnapshotV1>) => void | Promise<void>;
}

export interface BossRetryInput {
  readonly floorId: string;
  readonly expectedRevision?: number;
}

export interface BossRetryResult {
  readonly battle: BattleSnapshotV1;
  readonly candidateId: string;
  readonly save: GameSaveV1;
  readonly lease: AssetLease;
}

interface PendingRetry {
  readonly candidate: SaveCandidate;
  readonly battle: BattleSnapshotV1;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stale(expectedRevision: number, actualRevision: number): DomainResult<never> {
  return failure(createDomainError("STALE_REVISION", { expectedRevision, actualRevision }));
}

/**
 * Boss 重试的 detached prepare 与单候选保存编排。
 *
 * bossRetry 只创建带 BattleSnapshot 的 detached expedition，不创建地图对象
 * 列表、不刷新商店；保存失败时保留同一个 candidate/battle，重试不会重新抽
 * seed、ID 或敌方队伍。所有可见 attach 都在 repository 成功后才发生。
 */
export class BossRetryCoordinator {
  private readonly options: BossRetryOptions;
  private readonly pending = new Map<string, PendingRetry>();
  private readonly inFlight = new Map<string, Promise<DomainResult<BossRetryResult>>>();

  public constructor(options: BossRetryOptions) {
    this.options = options;
  }

  public start(input: BossRetryInput): Promise<DomainResult<BossRetryResult>> {
    const snapshot = this.options.store.getSnapshot();
    const key = `${input.floorId}:${input.expectedRevision ?? snapshot.revision}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const operation = this.run(input, key);
    this.inFlight.set(key, operation);
    void operation.finally(() => {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
    }).catch(() => undefined);
    return operation;
  }

  /** 语义化别名，供层数入口和读档恢复共用同一幂等路径。 */
  public retry(input: BossRetryInput): Promise<DomainResult<BossRetryResult>> {
    return this.start(input);
  }

  private async run(input: BossRetryInput, key: string): Promise<DomainResult<BossRetryResult>> {
    let acquired: DomainResult<AssetLease>;
    try {
      acquired = await this.options.assetService.acquire(this.options.battleBundleId);
    } catch {
      return failure(createDomainError("ASSET_LOAD_FAILED", { bundleId: this.options.battleBundleId, attempts: 3 }));
    }
    if (!acquired.ok) return acquired;
    const lease = acquired.value;
    try {
      const snapshot = this.options.store.getSnapshot();
      if (input.expectedRevision !== undefined && input.expectedRevision !== snapshot.revision) {
        return await this.failWithLease(stale(input.expectedRevision, snapshot.revision), lease);
      }

      const pending = this.pending.get(key);
      if (pending) {
        const committed = await this.options.saveCoordinator.submit(pending.candidate);
        if (!committed.ok) return await this.failWithLease(committed, lease);
        this.pending.delete(key);
        await this.options.attach?.(pending.battle);
        this.options.audio?.playSfx("sfx_encounter");
        return success({ battle: pending.battle, candidateId: committed.candidateId, save: committed.save, lease });
      }

      if (snapshot.expedition !== null || snapshot.battle !== null) {
        return await this.failWithLease(failure(createDomainError("NOT_IN_TOWN", null)), lease);
      }
      if (snapshot.inventory.overflowEquipment.length > 0 || snapshot.inventory.overflowSkillStones.length > 0) {
        return await this.failWithLease(failure(createDomainError("OVERFLOW_NOT_EMPTY", {
          count: snapshot.inventory.overflowEquipment.length + snapshot.inventory.overflowSkillStones.length,
        })), lease);
      }

      const floorResult = this.options.content.getFloor(input.floorId);
      if (!floorResult.ok) return await this.failWithLease(floorResult, lease);
      const floor = floorResult.value;
      if (floor.floorNumber > snapshot.world.highestUnlockedFloor) {
        return await this.failWithLease(failure(createDomainError("FLOOR_LOCKED", { floorNumber: floor.floorNumber })), lease);
      }
      if (snapshot.world.clearedBossEncounterIds.includes(floor.bossEncounterId)) {
        return await this.failWithLease(failure(createDomainError("EXPEDITION_MODE_LOCKED", {
          mode: "bossRetry",
          floorId: floor.id,
          reason: "BOSS_ALREADY_CLEARED",
        })), lease);
      }
      if (!snapshot.world.bossRetryUnlockedFloorIds.includes(floor.id)) {
        return await this.failWithLease(failure(createDomainError("EXPEDITION_MODE_LOCKED", {
          mode: "bossRetry",
          floorId: floor.id,
          reason: "BOSS_NOT_CONTACTED",
        })), lease);
      }

      const mapResult = this.options.content.getMap(floor.mapId);
      if (!mapResult.ok) return await this.failWithLease(mapResult, lease);
      const map = mapResult.value;
      const encounterResult = this.options.content.getEncounter(floor.bossEncounterId);
      if (!encounterResult.ok) return await this.failWithLease(encounterResult, lease);
      const encounterObject = map.objects.find((object): object is Extract<MapDefinition["objects"][number], { kind: "encounter" }> => (
        object.kind === "encounter" && object.objectId === `obj_f${String(floor.floorNumber).padStart(2, "0")}_boss` && object.encounterId === floor.bossEncounterId
      ));
      if (!encounterObject) {
        return await this.failWithLease(failure(createDomainError("INVALID_CONTENT", {
          path: `floors.${floor.id}`,
          issueKey: "boss_object_mismatch",
        })), lease);
      }
      const partyResult = validatePartyForExpedition(this.options.content, snapshot.party, {
        protagonistCharacterId: snapshot.skillStoneFocusCharacterId,
        characters: snapshot.characters,
      });
      if (!partyResult.ok) return await this.failWithLease(partyResult, lease);

      const startedAt = this.options.now();
      const expedition: ExpeditionSnapshotV1 = {
        expeditionId: this.options.idFactory.next("exp"),
        expeditionSeed: this.options.seedFactory.nextUint32(),
        mode: "bossRetry",
        abyssEchoId: null,
        floorId: floor.id,
        mapId: map.id,
        playerPosition: clone(map.spawnPoint),
        safePosition: clone(map.spawnPoint),
        defeatedEncounterObjectIds: [],
        openedChestObjectIds: [],
        encounterProtectionStepsRemaining: 0,
        focusedEliteStoneConsumed: false,
        startedAt,
      };
      const battleResult = this.options.battleFactory.create({
        battleId: this.options.idFactory.next("battle"),
        expedition,
        map,
        encounter: encounterResult.value,
        encounterObject,
        save: snapshot,
      });
      if (!battleResult.ok) return await this.failWithLease(battleResult, lease);
      if (
        battleResult.value.expeditionId !== expedition.expeditionId
        || battleResult.value.encounterId !== encounterResult.value.id
        || battleResult.value.encounterObjectId !== encounterObject.objectId
        || battleResult.value.returnMapId !== map.id
      ) {
        return await this.failWithLease(failure(createDomainError("INVALID_CONTENT", {
          path: "battle",
          issueKey: "boss_retry_binding_mismatch",
        })), lease);
      }

      const nextSave = clone(snapshot) as GameSaveV1;
      nextSave.expedition = expedition;
      nextSave.battle = battleResult.value;
      for (const unit of battleResult.value.units) {
        if (unit.faction === "enemy" && !nextSave.world.discoveredEnemyIds.includes(unit.definitionId)) {
          nextSave.world.discoveredEnemyIds.push(unit.definitionId);
        }
      }
      nextSave.revision = snapshot.revision + 1;
      nextSave.updatedAt = startedAt;
      const candidate = this.options.saveCoordinator.createCandidate("modeStart", nextSave, { expectedRevision: snapshot.revision });
      const committed = await this.options.saveCoordinator.submit(candidate);
      if (!committed.ok) {
        this.pending.set(key, { candidate, battle: battleResult.value });
        return await this.failWithLease(committed, lease);
      }
      await this.options.attach?.(battleResult.value);
      this.options.audio?.playSfx("sfx_encounter");
      return success({ battle: battleResult.value, candidateId: committed.candidateId, save: committed.save, lease });
    } catch {
      return await this.failWithLease(failure(createDomainError("SAVE_FAILED", { operation: "save" })), lease);
    }
  }

  private async failWithLease<T>(result: DomainResult<T>, lease: AssetLease): Promise<DomainResult<T>> {
    await lease.release().catch(() => undefined);
    return result;
  }
}
