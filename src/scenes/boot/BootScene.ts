import { Container } from "pixi.js";
import type { AssetLease, AssetService } from "../../app/AssetService";
import type { Scene, SceneRootLike } from "../../app/Scene";
import type { DomainErrorV1 } from "../../domain/common/DomainResult";

export interface BootSceneOptions {
  assetService: AssetService;
  root?: SceneRootLike;
  onProgress?: (progress: number) => void;
  onFailure?: (error: DomainErrorV1) => void;
}

export interface BootSceneParams {
  readonly [key: string]: unknown;
}

/** BootScene 的可观察状态，供启动遮罩和失败重试 UI 使用。 */
export type BootSceneStatus = "idle" | "preparing" | "ready" | "failed" | "destroyed";

export class BootSceneFailure extends Error {
  public readonly domainError: DomainErrorV1;

  public constructor(error: DomainErrorV1) {
    const details = error.code === "INVALID_CONTENT" ? error.details : null;
    super(`${error.code}:${details?.path ?? "boot"}`);
    this.name = "BootSceneFailure";
    this.domainError = error;
  }
}

/** 启动场景只负责加载 boot/core_ui 和进度反馈，不在 prepare 期间挂载或接收输入。 */
export class BootScene implements Scene<BootSceneParams> {
  public readonly root: SceneRootLike;
  private readonly assets: AssetService;
  private readonly onProgress?: (progress: number) => void;
  private readonly onFailure?: (error: DomainErrorV1) => void;
  private leases: AssetLease[] = [];
  private preparePromise: Promise<void> | null = null;
  private prepared = false;
  private entered = false;
  private destroyed = false;
  private paused = false;
  private progressValue = 0;
  private failure: DomainErrorV1 | null = null;
  private lastErrorValue: unknown | null = null;
  private statusValue: BootSceneStatus = "idle";

  public constructor(options: BootSceneOptions) {
    this.assets = options.assetService;
    this.root = options.root ?? (new Container() as unknown as SceneRootLike);
    this.onProgress = options.onProgress;
    this.onFailure = options.onFailure;
  }

  public get lastFailure(): DomainErrorV1 | null {
    return this.failure;
  }

  public get lastError(): unknown | null {
    return this.lastErrorValue;
  }

  public get status(): BootSceneStatus {
    return this.statusValue;
  }

  public get progress(): number {
    return this.progressValue;
  }

  public get isPreparing(): boolean {
    return this.preparePromise !== null;
  }

  public async prepare(): Promise<void> {
    if (this.destroyed) throw new Error("BootScene 已销毁");
    if (this.prepared) return;
    if (this.preparePromise !== null) return this.preparePromise;

    const attempt = this.prepareInternal();
    const tracked = attempt.finally(() => {
      if (this.preparePromise === tracked) this.preparePromise = null;
    });
    this.preparePromise = tracked;
    return tracked;
  }

  public enter(): void {
    if (this.destroyed) throw new Error("BootScene 已销毁");
    if (!this.prepared) throw new Error("BootScene 必须先 prepare");
    this.entered = true;
    this.paused = false;
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    if (!this.destroyed && this.entered) this.paused = false;
  }

  public async exit(): Promise<void> {
    if (this.preparePromise !== null) {
      try {
        await this.preparePromise;
      } catch {
        // prepare 已完成清理；exit 仍继续释放可能保留的重试 lease。
      }
    }
    if (this.leases.length === 0 && !this.prepared) return;
    this.entered = false;
    this.paused = false;
    await this.releaseLeases();
    this.prepared = false;
  }

  public async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.statusValue = "destroyed";
    if (this.preparePromise !== null) {
      try {
        await this.preparePromise;
      } catch {
        // 下面再次释放保留 lease，避免并发 destroy 产生未处理 rejection。
      }
    }
    this.entered = false;
    this.paused = false;
    await this.releaseLeases();
    this.prepared = false;
    this.root.destroy?.({ children: true });
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  private async prepareInternal(): Promise<void> {
    this.statusValue = "preparing";
    this.failure = null;
    this.lastErrorValue = null;
    this.progressValue = 0;
    this.onProgressSafely(0);
    try {
      if (this.leases.length > 0) {
        // 上一次失败若有 unload 可重试 lease，必须先清掉再开始新一轮 acquire。
        await this.releaseLeases();
      }
      const boot = await this.assets.acquire("boot");
      if (!boot.ok) throw new BootSceneFailure(boot.error);
      this.leases.push(boot.value);
      this.progressValue = 0.5;
      this.onProgressSafely(0.5);

      const core = await this.assets.acquire("core_ui");
      if (!core.ok) throw new BootSceneFailure(core.error);
      this.leases.push(core.value);
      this.prepared = true;
      this.statusValue = "ready";
      this.progressValue = 1;
      this.onProgressSafely(1);
    } catch (error) {
      try {
        await this.releaseLeases();
      } catch {
        // 失败 lease 会保留在数组中，下一次 prepare/destroy 会再次尝试释放。
      }
      this.prepared = false;
      this.lastErrorValue = error;
      this.failure = error instanceof BootSceneFailure ? error.domainError : null;
      this.statusValue = "failed";
      if (this.failure) this.onFailureSafely(this.failure);
      throw error;
    }
  }

  private async releaseLeases(): Promise<void> {
    const leases = this.leases.splice(0);
    const failed: AssetLease[] = [];
    let firstError: unknown;
    for (const lease of leases.reverse()) {
      try {
        await lease.release();
      } catch (error) {
        failed.push(lease);
        firstError ??= error;
      }
    }
    // 只移除成功 release 的 lease；失败项保留给下一轮重试，避免静默泄漏。
    this.leases.push(...failed.reverse());
    if (firstError !== undefined) throw firstError;
  }

  private onProgressSafely(progress: number): void {
    try {
      this.onProgress?.(progress);
    } catch {
      // UI 观察者异常不应让资源 lease 遗留或产生未处理 rejection。
    }
  }

  private onFailureSafely(error: DomainErrorV1): void {
    try {
      this.onFailure?.(error);
    } catch {
      // 失败展示回调不是资源生命周期的一部分。
    }
  }
}
