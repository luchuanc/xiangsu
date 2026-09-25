/**
 * 测试构建使用的公开状态钩子；只记录稳定快照，不持有 Pixi DisplayObject，
 * 也不允许通过钩子绕过领域命令或直接修改 GameSave。
 */
export interface TestHookState {
  readonly scene: string | null;
  readonly lifecycle: string;
  readonly lastError: string | null;
  readonly lastStableRevision: number | null;
}

export type TestHookListener = (state: TestHookState) => void;

export type StoragePersistOutcome = "granted" | "denied" | "unavailable";

export interface StoragePersistenceLike {
  persist?: () => Promise<boolean>;
}

/** 首次成功保存后使用；无论结果如何，本次页面会话只请求一次。 */
export class StoragePersistenceGate {
  private requestValue: Promise<StoragePersistOutcome> | null = null;

  public requestOnce(storage?: StoragePersistenceLike): Promise<StoragePersistOutcome> {
    if (this.requestValue !== null) return this.requestValue;
    const target = storage ?? this.browserStorage();
    if (target?.persist === undefined) {
      this.requestValue = Promise.resolve("unavailable");
      return this.requestValue;
    }
    this.requestValue = target.persist()
      .then((granted) => granted ? "granted" : "denied")
      .catch(() => "denied");
    return this.requestValue;
  }

  private browserStorage(): StoragePersistenceLike | undefined {
    if (typeof navigator === "undefined") return undefined;
    const storage = (navigator as Navigator & { storage?: StoragePersistenceLike }).storage;
    return storage;
  }
}

function cloneState(state: TestHookState): TestHookState {
  return Object.freeze({ ...state });
}

export class TestHooks {
  private stateValue: TestHookState = cloneState({ scene: null, lifecycle: "created", lastError: null, lastStableRevision: null });
  private readonly listeners = new Set<TestHookListener>();

  public get state(): TestHookState {
    return this.stateValue;
  }

  public subscribe(listener: TestHookListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public setLifecycle(lifecycle: string): void {
    this.patch({ lifecycle });
  }

  public setScene(scene: string | null): void {
    this.patch({ scene });
  }

  public recordError(errorCode: string | null): void {
    this.patch({ lastError: errorCode });
  }

  public recordStableRevision(revision: number | null): void {
    this.patch({ lastStableRevision: revision });
  }

  public reset(): void {
    this.stateValue = cloneState({ scene: null, lifecycle: "created", lastError: null, lastStableRevision: null });
    this.emit();
  }

  private patch(patch: Partial<TestHookState>): void {
    this.stateValue = cloneState({ ...this.stateValue, ...patch });
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener(this.stateValue);
  }
}
