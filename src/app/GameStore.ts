/**
 * 权威 GameSave 内存快照与保存协调器的共同实现模块。
 *
 * GameStore 对外只暴露递归只读快照。写闭包和 SaveCoordinator 放在同一
 * 模块，普通业务模块既拿不到 token，也没有可调用的 replace 方法。
 */
import type { GameSaveV1 } from "../content/contracts";
import type { IdFactory } from "../domain/common/DomainContext";
import { CryptoIdFactory } from "../domain/common/DomainContext";
import { createDomainError, type DomainErrorV1, type DomainResult } from "../domain/common/DomainResult";

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly (infer Item)[] ? ReadonlyArray<DeepReadonly<Item>>
      : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T;

export type ReadonlyGameSave = DeepReadonly<GameSaveV1>;
export type GameStoreListener = (snapshot: ReadonlyGameSave) => void;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Reflect.ownKeys(value).forEach((key) => {
      const child = (value as Record<PropertyKey, unknown>)[key];
      deepFreeze(child);
    });
    Object.freeze(value);
  }
  return value;
}

export function cloneAndFreeze<T>(value: T): T {
  return deepFreeze(clone(value));
}

type StoreWriter = (next: GameSaveV1) => void;
const privateWriters = new WeakMap<GameStore, StoreWriter>();

export class GameStore {
  private snapshot: ReadonlyGameSave;
  private readonly listeners = new Set<GameStoreListener>();

  public constructor(initial: GameSaveV1) {
    this.snapshot = cloneAndFreeze(initial) as ReadonlyGameSave;
    // 只有本实现模块内的 coordinator 能从 WeakMap 取出这个闭包。
    privateWriters.set(this, (next) => this.replaceSnapshot(next));
  }

  public getSnapshot(): ReadonlyGameSave {
    return this.snapshot;
  }

  public subscribe(listener: GameStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private replaceSnapshot(next: GameSaveV1): void {
    this.snapshot = cloneAndFreeze(next) as ReadonlyGameSave;
    const snapshot = this.snapshot;
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

function writeAfterRepositorySuccess(store: GameStore, next: GameSaveV1): void {
  const writer = privateWriters.get(store);
  if (!writer) throw new Error("GameStore 写入上下文已失效");
  writer(next);
}

export type SaveCandidateKind = "battle" | "position" | "asset" | "transaction" | "modeStart";

export interface SaveRepositoryWriter {
  save(expectedRevision: number, nextSave: GameSaveV1): Promise<DomainResult<GameSaveV1>>;
}

export interface SaveCandidateOptions {
  expectedRevision?: number;
  events?: readonly unknown[];
  command?: unknown;
}

export interface SaveCandidate {
  readonly candidateId: string;
  readonly kind: SaveCandidateKind;
  readonly expectedRevision: number;
  readonly save: GameSaveV1;
  readonly events: readonly unknown[];
  readonly command?: unknown;
}

export interface SaveCoordinatorOptions {
  store: GameStore;
  repository: SaveRepositoryWriter;
  idFactory?: IdFactory;
}

export interface SaveCoordinatorSuccess {
  readonly ok: true;
  readonly value: GameSaveV1;
  readonly save: GameSaveV1;
  readonly candidateId: string;
  readonly kind: SaveCandidateKind;
  readonly events: readonly unknown[];
}

export interface SaveCoordinatorFailure {
  readonly ok: false;
  readonly error: DomainErrorV1;
  readonly candidateId?: string;
  readonly kind?: SaveCandidateKind;
  readonly events: readonly [];
  readonly blocked: boolean;
  readonly requiresReload: boolean;
}

export type SaveCoordinatorResult = SaveCoordinatorSuccess | SaveCoordinatorFailure;

function coordinatorFailure(
  error: DomainErrorV1,
  candidate?: SaveCandidate,
  options: { blocked?: boolean; requiresReload?: boolean } = {},
): SaveCoordinatorFailure {
  return {
    ok: false,
    error,
    candidateId: candidate?.candidateId,
    kind: candidate?.kind,
    events: [],
    blocked: options.blocked ?? false,
    requiresReload: options.requiresReload ?? error.code === "STALE_REVISION",
  };
}

function cloneCandidate(candidate: SaveCandidate): SaveCandidate {
  return cloneAndFreeze({
    ...candidate,
    save: candidate.save,
    events: [...candidate.events],
    command: candidate.command,
  });
}

type ExpeditionMode = NonNullable<GameSaveV1["expedition"]>["mode"];

function protectedShopMode(mode: ExpeditionMode | undefined): boolean {
  return mode === "bossRetry" || mode === "abyssEcho";
}

function shopChangedDuringProtectedMode(previous: ReadonlyGameSave, next: GameSaveV1): boolean {
  const previousMode = previous.expedition?.mode;
  const nextMode = next.expedition?.mode;
  if (!protectedShopMode(previousMode) && !protectedShopMode(nextMode)) return false;
  return JSON.stringify(previous.shop) !== JSON.stringify(next.shop);
}

export class SaveCoordinator {
  private readonly store: GameStore;
  private readonly repository: SaveRepositoryWriter;
  private readonly idFactory: IdFactory;
  private readonly pending = new Map<string, SaveCandidate>();
  private queue: Promise<void> = Promise.resolve();
  private dirty = false;
  private requiresReload = false;
  private lastError: DomainErrorV1 | null = null;

  public constructor(options: SaveCoordinatorOptions) {
    this.store = options.store;
    this.repository = options.repository;
    this.idFactory = options.idFactory ?? new CryptoIdFactory();
  }

  public get isDirty(): boolean {
    return this.dirty;
  }

  public get mustReload(): boolean {
    return this.requiresReload;
  }

  public get pendingCandidates(): readonly SaveCandidate[] {
    return [...this.pending.values()];
  }

  public get error(): DomainErrorV1 | null {
    return this.lastError;
  }

  /** 候选创建时分配一次根 ID；重试不会再次调用 IdFactory。 */
  public createCandidate(kind: SaveCandidateKind, nextSave: GameSaveV1, options: SaveCandidateOptions = {}): SaveCandidate {
    return cloneCandidate({
      candidateId: this.idFactory.next("root"),
      kind,
      expectedRevision: options.expectedRevision ?? this.store.getSnapshot().revision,
      save: nextSave,
      events: options.events ?? [],
      command: options.command,
    });
  }

  public async commit(
    kind: SaveCandidateKind,
    nextSave: GameSaveV1,
    options: SaveCandidateOptions = {},
  ): Promise<SaveCoordinatorResult> {
    // blocking 状态在 candidate 创建前就拒绝新命令，避免被拒绝的命令白占一个 ID。
    if (this.hasBlockingPending()) {
      return coordinatorFailure(createDomainError("SAVE_FAILED", { operation: "save" }), undefined, { blocked: true });
    }
    const candidate = this.createCandidate(kind, nextSave, options);
    return this.submit(candidate);
  }

  /** 提交新候选或重试同一候选；预占在返回 Promise 前完成。 */
  public submit(candidate: SaveCandidate): Promise<SaveCoordinatorResult> {
    const frozen = cloneCandidate(candidate);
    if (shopChangedDuringProtectedMode(this.store.getSnapshot(), frozen.save)) {
      const error = createDomainError("INVALID_CONTENT", { path: "shop", issueKey: "protected_mode_shop_changed" });
      this.lastError = error;
      return Promise.resolve(coordinatorFailure(error, frozen));
    }
    const reservation = this.reserve(frozen);
    if (!reservation.ok) return Promise.resolve(reservation.value);
    return this.enqueue(() => this.submitSerial(frozen));
  }

  public async retry(candidateId: string): Promise<SaveCoordinatorResult> {
    const candidate = this.pending.get(candidateId);
    if (!candidate) return coordinatorFailure(createDomainError("SAVE_FAILED", { operation: "save" }));
    return this.submit(candidate);
  }

  /** 取消尚未提交的候选；调用方未调用 submit 时 repository 不会被触发。 */
  public cancel(candidateId: string): boolean {
    const removed = this.pending.delete(candidateId);
    if (removed && this.pending.size === 0) this.dirty = false;
    return removed;
  }

  public clearReloadRequirement(): void {
    this.requiresReload = false;
    this.lastError = null;
  }

  private hasBlockingPending(): boolean {
    return [...this.pending.values()].some((candidate) => candidate.kind !== "position");
  }

  /**
   * 在排队前同步登记 pending，避免两个同 tick 的 blocking commit 都通过
   * 检查；position 则先删掉旧候选，旧队列项只会被安全跳过。
   */
  private reserve(candidate: SaveCandidate): { ok: true } | { ok: false; value: SaveCoordinatorFailure } {
    const isRetry = this.pending.has(candidate.candidateId);
    if (this.hasBlockingPending() && !isRetry) {
      return { ok: false, value: coordinatorFailure(createDomainError("SAVE_FAILED", { operation: "save" }), candidate, { blocked: true }) };
    }
    if (candidate.kind === "position") {
      for (const [candidateId, pending] of this.pending) {
        if (pending.kind === "position" && candidateId !== candidate.candidateId) this.pending.delete(candidateId);
      }
    }
    this.pending.set(candidate.candidateId, candidate);
    this.dirty = true;
    return { ok: true };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async submitSerial(candidate: SaveCandidate): Promise<SaveCoordinatorResult> {
    const activeBeforeWrite = this.pending.get(candidate.candidateId) === candidate;
    if (!activeBeforeWrite) {
      return coordinatorFailure(createDomainError("SAVE_FAILED", { operation: "save" }), candidate, { blocked: true });
    }
    const expectedRevision = candidate.kind === "position" ? this.store.getSnapshot().revision : candidate.expectedRevision;
    const result = await this.repository.save(expectedRevision, candidate.save);
    const activeAfterWrite = this.pending.get(candidate.candidateId) === candidate;
    if (!result.ok) {
      // 被更新位置候选取代的旧结果不能触发 stale reload 或覆盖新错误。
      if (!activeAfterWrite) return coordinatorFailure(result.error, candidate, { blocked: true, requiresReload: false });
      this.lastError = result.error;
      this.requiresReload = result.error.code === "STALE_REVISION";
      return coordinatorFailure(result.error, candidate, { requiresReload: this.requiresReload });
    }
    writeAfterRepositorySuccess(this.store, result.value);
    if (activeAfterWrite) this.pending.delete(candidate.candidateId);
    this.dirty = this.pending.size > 0;
    this.lastError = null;
    this.requiresReload = false;
    if (!activeAfterWrite) {
      // 旧位置候选如果已经进入 repository，成功就是数据库真实提交；即使它
      // 随后被更新位置候选替代，也必须把这次真实 revision 反馈给调用方，
      // 不能把成功事务误报成失败或触发 stale reload。
      if (candidate.kind === "position") {
        return {
          ok: true,
          value: result.value,
          save: result.value,
          candidateId: candidate.candidateId,
          kind: candidate.kind,
          events: candidate.events,
        };
      }
      return coordinatorFailure(createDomainError("SAVE_FAILED", { operation: "save" }), candidate, { blocked: true, requiresReload: false });
    }
    return {
      ok: true,
      value: result.value,
      save: result.value,
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      events: candidate.events,
    };
  }
}
