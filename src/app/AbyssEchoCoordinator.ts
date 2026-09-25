import type {
  BattleSnapshotV1,
  GameSaveV1,
} from "../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../domain/common/DomainResult";
import type {
  AbyssEchoBattleInput,
  AbyssEchoService,
} from "../domain/town/AbyssEchoService";
import type { AssetLease } from "./AssetService";
import type { SaveCandidate, SaveCoordinator } from "./GameStore";

export interface AbyssEchoAssetService {
  acquire(bundleId: string): Promise<DomainResult<AssetLease>>;
}

export interface AbyssEchoStore {
  getSnapshot(): Readonly<GameSaveV1>;
}

export interface AbyssEchoBattleFactory {
  create(input: AbyssEchoBattleInput): DomainResult<BattleSnapshotV1>;
}

export interface AbyssEchoAudio {
  playSfx(id: "sfx_encounter"): boolean;
}

export interface AbyssEchoCoordinatorOptions {
  readonly assetService: AbyssEchoAssetService;
  readonly store: AbyssEchoStore;
  readonly saveCoordinator: Pick<SaveCoordinator, "createCandidate" | "submit">;
  readonly service: Pick<AbyssEchoService, "prepareStart">;
  readonly battleFactory: AbyssEchoBattleFactory;
  readonly battleBundleId: string;
  readonly audio?: AbyssEchoAudio;
  /** 保存成功后才通知战斗场景；失败时不挂载半成品。 */
  readonly attach?: (battle: Readonly<BattleSnapshotV1>) => void | Promise<void>;
}

export interface AbyssEchoStartInput {
  readonly echoId: string;
  readonly expectedRevision?: number;
}

export interface AbyssEchoStartResult {
  readonly battle: BattleSnapshotV1;
  readonly candidateId: string;
  readonly save: GameSaveV1;
  readonly lease: AssetLease;
  readonly attemptNumber: number;
}

interface PendingEcho {
  readonly candidate: SaveCandidate;
  readonly battle: BattleSnapshotV1;
  readonly attemptNumber: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stale(expectedRevision: number, actualRevision: number): DomainResult<never> {
  return failure(createDomainError("STALE_REVISION", { expectedRevision, actualRevision }));
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

/**
 * 深渊回响的 detached prepare 与单候选保存编排。
 *
 * 领域服务先物化扣次数、ID、seed 和 battle 输入；本协调器再创建战斗并
 * 通过 SaveCoordinator 做一次 CAS。保存失败只保留同一 candidate/battle，
 * 重试不会再次扣次数或生成另一场战斗。
 */
export class AbyssEchoCoordinator {
  private readonly options: AbyssEchoCoordinatorOptions;
  private readonly pending = new Map<string, PendingEcho>();
  private readonly inFlight = new Map<string, Promise<DomainResult<AbyssEchoStartResult>>>();

  public constructor(options: AbyssEchoCoordinatorOptions) {
    this.options = options;
  }

  public start(input: AbyssEchoStartInput): Promise<DomainResult<AbyssEchoStartResult>> {
    const snapshot = this.options.store.getSnapshot();
    const key = `${input.echoId}:${input.expectedRevision ?? snapshot.revision}`;
    const current = this.inFlight.get(key);
    if (current) return current;
    const operation = this.run(input, key);
    this.inFlight.set(key, operation);
    void operation.finally(() => {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
    }).catch(() => undefined);
    return operation;
  }

  /** 失败保存的重试沿用同一个 candidate，不重新进入随机/扣费路径。 */
  public retry(input: AbyssEchoStartInput): Promise<DomainResult<AbyssEchoStartResult>> {
    return this.start(input);
  }

  private async run(input: AbyssEchoStartInput, key: string): Promise<DomainResult<AbyssEchoStartResult>> {
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
        if (pending.candidate.expectedRevision !== snapshot.revision) {
          return await this.failWithLease(stale(pending.candidate.expectedRevision, snapshot.revision), lease);
        }
        let committed;
        try {
          committed = await this.options.saveCoordinator.submit(pending.candidate);
        } catch {
          return await this.failWithLease(failure(createDomainError("SAVE_FAILED", { operation: "save" })), lease);
        }
        if (!committed.ok) return await this.failWithLease(committed, lease);
        this.pending.delete(key);
        await this.options.attach?.(pending.battle);
        this.options.audio?.playSfx("sfx_encounter");
        return success({
          battle: pending.battle,
          candidateId: committed.candidateId,
          save: committed.save,
          lease,
          attemptNumber: pending.attemptNumber,
        });
      }

      const prepared = this.options.service.prepareStart({ save: snapshot, echoId: input.echoId });
      if (!prepared.ok) return await this.failWithLease(prepared, lease);

      const battleResult = this.options.battleFactory.create(prepared.value.battleInput);
      if (!battleResult.ok) return await this.failWithLease(battleResult, lease);
      const battle = battleResult.value;
      if (
        battle.battleId !== prepared.value.battleInput.battleId
        || battle.expeditionId !== prepared.value.expedition.expeditionId
        || battle.encounterId !== prepared.value.echo.bossEncounterId
        || battle.encounterObjectId !== ""
        || battle.returnMapId !== "map_town"
        || battle.abyssEchoOutcome !== "pending"
        || battle.reward !== null
      ) {
        return await this.failWithLease(invalid("battle", "abyss_echo_binding_mismatch"), lease);
      }

      const nextSave = clone(prepared.value.save) as GameSaveV1;
      nextSave.battle = clone(battle);
      for (const unit of battle.units) {
        if (unit.faction === "enemy" && !nextSave.world.discoveredEnemyIds.includes(unit.definitionId)) {
          nextSave.world.discoveredEnemyIds.push(unit.definitionId);
        }
      }
      const candidate = this.options.saveCoordinator.createCandidate("modeStart", nextSave, {
        expectedRevision: snapshot.revision,
      });
      const pendingValue: PendingEcho = { candidate, battle, attemptNumber: prepared.value.attemptNumber };
      let committed;
      try {
        committed = await this.options.saveCoordinator.submit(candidate);
      } catch {
        this.pending.set(key, pendingValue);
        return await this.failWithLease(failure(createDomainError("SAVE_FAILED", { operation: "save" })), lease);
      }
      if (!committed.ok) {
        this.pending.set(key, pendingValue);
        return await this.failWithLease(committed, lease);
      }
      await this.options.attach?.(battle);
      this.options.audio?.playSfx("sfx_encounter");
      return success({
        battle,
        candidateId: committed.candidateId,
        save: committed.save,
        lease,
        attemptNumber: prepared.value.attemptNumber,
      });
    } catch {
      return await this.failWithLease(failure(createDomainError("SAVE_FAILED", { operation: "save" })), lease);
    }
  }

  private async failWithLease<T>(result: DomainResult<T>, lease: AssetLease): Promise<DomainResult<T>> {
    await lease.release().catch(() => undefined);
    return result;
  }
}

