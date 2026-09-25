import type { GameSaveV1, MapDefinition, EncounterDefinition, BattleSnapshotV1, ExpeditionSnapshotV1, FloorDefinition } from "../content/contracts";
import type { DomainResult } from "../domain/common/DomainResult";
import { createDomainError, failure, success } from "../domain/common/DomainResult";
import type { EncounterContact } from "../domain/exploration/EncounterAi";
import type { AssetLease } from "./AssetService";
import type { SaveCandidate, SaveCoordinator } from "./GameStore";

export interface EncounterTransitionAssetService {
  acquire(bundleId: string): Promise<DomainResult<AssetLease>>;
}

export interface EncounterTransitionStore {
  getSnapshot(): Readonly<GameSaveV1>;
}

export interface EncounterTransitionContent {
  getMap(id: string): DomainResult<Readonly<MapDefinition>>;
  getEncounter(id: string): DomainResult<Readonly<EncounterDefinition>>;
  /** 首次接触 Boss 时用于读取冻结 floor.bossEncounterId；旧适配器可暂不提供。 */
  getFloor?(id: string): DomainResult<Readonly<FloorDefinition>>;
}

export interface EncounterTransitionBattleInput {
  readonly battleId: string;
  readonly expedition: Readonly<ExpeditionSnapshotV1>;
  readonly map: Readonly<MapDefinition>;
  readonly encounter: Readonly<EncounterDefinition>;
  readonly encounterObject: Extract<MapDefinition["objects"][number], { kind: "encounter" }>;
  readonly save: Readonly<GameSaveV1>;
}

export interface EncounterTransitionBattleFactory {
  create(input: EncounterTransitionBattleInput): DomainResult<BattleSnapshotV1>;
}

export interface EncounterTransitionIdFactory {
  next(kind: "battle"): string;
}

export interface EncounterTransitionAudio {
  playSfx(id: "sfx_encounter"): boolean;
}

export interface EncounterTransitionOptions {
  readonly assetService: EncounterTransitionAssetService;
  readonly store: EncounterTransitionStore;
  readonly saveCoordinator: Pick<SaveCoordinator, "createCandidate" | "submit">;
  readonly content: EncounterTransitionContent;
  readonly battleFactory: EncounterTransitionBattleFactory;
  readonly idFactory: EncounterTransitionIdFactory;
  readonly battleBundleId: string;
  readonly audio?: EncounterTransitionAudio;
  readonly attach?: (battle: Readonly<BattleSnapshotV1>) => void | Promise<void>;
}

export interface EncounterTransitionInput {
  readonly contact: EncounterContact;
  readonly expectedRevision?: number;
  readonly playerPosition: { readonly x: number; readonly y: number };
  readonly safePosition: { readonly x: number; readonly y: number };
}

export interface EncounterTransitionResult {
  readonly battle: BattleSnapshotV1;
  readonly candidateId: string;
  readonly save: GameSaveV1;
  readonly lease: AssetLease;
}

interface PendingTransition {
  readonly candidate: SaveCandidate;
  readonly battle: BattleSnapshotV1;
}

function clone<T>(value: T): T { return structuredClone(value); }

function normalizeSavePosition(position: { readonly x: number; readonly y: number }): { x: number; y: number } {
  // GameSave 的位置字段冻结为整数；探索运行态允许 fixed-step 小数，提交候选时统一四舍五入。
  return { x: Math.round(position.x), y: Math.round(position.y) };
}

function stale(expectedRevision: number, actualRevision: number): DomainResult<never> {
  return failure(createDomainError("STALE_REVISION", { expectedRevision, actualRevision }));
}

/**
 * 野外接触转场的事务编排：资源先 detached prepare，随后只以最新 Store 建战候选。
 * 保存成功前不 attach、不播 encounter 音效；失败释放 lease 且不修改输入对象。
 */
export class EncounterTransitionService {
  private readonly options: EncounterTransitionOptions;
  private readonly pending = new Map<string, PendingTransition>();

  public constructor(options: EncounterTransitionOptions) {
    this.options = options;
  }

  public async transition(input: EncounterTransitionInput): Promise<DomainResult<EncounterTransitionResult>> {
    const acquired = await this.options.assetService.acquire(this.options.battleBundleId);
    if (!acquired.ok) return acquired;
    const lease = acquired.value;
    try {
      const snapshot = this.options.store.getSnapshot();
      if (input.expectedRevision !== undefined && input.expectedRevision !== snapshot.revision) return await this.failWithLease(stale(input.expectedRevision, snapshot.revision), lease);
      if (!snapshot.expedition || snapshot.battle !== null) return await this.failWithLease(failure(createDomainError("INVALID_BATTLE_PHASE", { expected: ["INIT"], actual: snapshot.battle ? snapshot.battle.phase : "INIT" })), lease);
      if (snapshot.expedition.defeatedEncounterObjectIds.includes(input.contact.objectId)) return await this.failWithLease(failure(createDomainError("INVALID_TARGET", { reason: "UNKNOWN", targetUnitId: input.contact.objectId })), lease);
      const pendingKey = `${input.contact.objectId}:${snapshot.revision}`;
      const pending = this.pending.get(pendingKey);
      if (pending) {
        const committed = await this.options.saveCoordinator.submit(pending.candidate);
        if (!committed.ok) return await this.failWithLease(committed, lease);
        this.pending.delete(pendingKey);
        await this.options.attach?.(pending.battle);
        this.options.audio?.playSfx("sfx_encounter");
        return success({ battle: pending.battle, candidateId: committed.candidateId, save: committed.save, lease });
      }
      const mapResult = this.options.content.getMap(snapshot.expedition.mapId);
      if (!mapResult.ok) return await this.failWithLease(mapResult, lease);
      const encounterResult = this.options.content.getEncounter(input.contact.encounterId);
      if (!encounterResult.ok) return await this.failWithLease(encounterResult, lease);
      const encounterObject = mapResult.value.objects.find((object): object is Extract<MapDefinition["objects"][number], { kind: "encounter" }> => object.kind === "encounter" && object.objectId === input.contact.objectId);
      if (!encounterObject || encounterObject.encounterId !== encounterResult.value.id) return await this.failWithLease(failure(createDomainError("INVALID_TARGET", { reason: "UNKNOWN", targetUnitId: input.contact.objectId })), lease);
      const battleId = this.options.idFactory.next("battle");
      const battleResult = this.options.battleFactory.create({ battleId, expedition: snapshot.expedition, map: mapResult.value, encounter: encounterResult.value, encounterObject, save: snapshot });
      if (!battleResult.ok) return await this.failWithLease(battleResult, lease);
      const nextSave = clone(snapshot) as GameSaveV1;
      if (!nextSave.expedition) return await this.failWithLease(failure(createDomainError("INVALID_CONTENT", { path: "expedition", issueKey: "missing" })), lease);
      nextSave.expedition.playerPosition = normalizeSavePosition(input.playerPosition);
      nextSave.expedition.safePosition = normalizeSavePosition(input.safePosition);
      nextSave.battle = battleResult.value;
      // 只有 exploration 首次成功创建该层 Boss 战时解锁重试入口；资源与保存
      // 任一步失败都不会触碰这个数组，首通后历史标记也不主动删除。
      if (nextSave.expedition.mode === "exploration" && this.options.content.getFloor) {
        const floorResult = this.options.content.getFloor(nextSave.expedition.floorId);
        if (!floorResult.ok) return await this.failWithLease(floorResult, lease);
        const floor = floorResult.value;
        if (floor.bossEncounterId === encounterResult.value.id && !nextSave.world.clearedBossEncounterIds.includes(floor.bossEncounterId) && !nextSave.world.bossRetryUnlockedFloorIds.includes(floor.id)) {
          nextSave.world.bossRetryUnlockedFloorIds.push(floor.id);
        }
      }
      for (const unit of battleResult.value.units) {
        if (unit.faction === "enemy" && !nextSave.world.discoveredEnemyIds.includes(unit.definitionId)) nextSave.world.discoveredEnemyIds.push(unit.definitionId);
      }
      nextSave.revision = snapshot.revision + 1;
      const candidate = this.options.saveCoordinator.createCandidate("battle", nextSave, { expectedRevision: snapshot.revision });
      const committed = await this.options.saveCoordinator.submit(candidate);
      if (!committed.ok) {
        this.pending.set(pendingKey, { candidate, battle: battleResult.value });
        return await this.failWithLease(committed, lease);
      }
      await this.options.attach?.(battleResult.value);
      this.options.audio?.playSfx("sfx_encounter");
      return success({ battle: battleResult.value, candidateId: committed.candidateId, save: committed.save, lease });
    } catch {
      await lease.release().catch(() => undefined);
      return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
    }
  }

  private async failWithLease<T>(result: DomainResult<T>, lease: AssetLease): Promise<DomainResult<T>> {
    await lease.release().catch(() => undefined);
    return result;
  }
}
