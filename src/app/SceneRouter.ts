import {
  isRecoverableScene,
  isSceneRootDetached,
  type Scene,
  type SceneRootLike,
} from "./Scene";

export interface SceneStageLike {
  addChild?(root: SceneRootLike): unknown;
  removeChild?(root: SceneRootLike): unknown;
}

export interface SceneTransitionOptions<Params = unknown> {
  /** prepare 完成后、暂停旧场景前执行的已提交事务。 */
  commit?: () => void | Promise<void>;
  /** commit 成功而 enter 失败时，必须从权威 Store 重建 View。 */
  recoverAfterCommittedEnterFailure?: (error: unknown) => void | Promise<void>;
  /** 仅用于诊断，不参与切换语义。 */
  label?: string;
  /** 保留泛型位置，避免调用方把参数误当成 commit。 */
  readonly paramsType?: Params;
}

export interface SceneRouterOptions {
  stage: SceneStageLike;
  initialScene?: Scene<unknown> | null;
}

export type SceneTransitionErrorCode = "SCENE_ALREADY_CURRENT" | "SCENE_ROOT_MOUNTED" | "SCENE_ROUTER_DESTROYED";

export class SceneTransitionError extends Error {
  public readonly code: SceneTransitionErrorCode;

  public constructor(code: SceneTransitionErrorCode) {
    super(code);
    this.name = "SceneTransitionError";
    this.code = code;
  }
}

type AnyScene = Scene<unknown>;

/**
 * 串行化 detached 场景切换。队列保证重入请求不会并发执行，旧场景在新场景 enter 成功前始终保留。
 */
export class SceneRouter {
  private readonly stage: SceneStageLike;
  private queue: Promise<void> = Promise.resolve();
  private transitioning = false;
  private closing = false;
  private destroyPromise: Promise<void> | null = null;
  private current: AnyScene | null;
  private attached = new Set<SceneRootLike>();
  /** 所有清理入口共用的身份表，避免同一 Scene 在竞态路径中重复 destroy。 */
  private readonly destroyedScenes = new WeakSet<AnyScene>();

  public constructor(options: SceneRouterOptions) {
    this.stage = options.stage;
    this.current = options.initialScene ?? null;
    if (this.current !== null) this.attach(this.current.root);
  }

  public get currentScene(): AnyScene | null {
    return this.current;
  }

  public get isTransitioning(): boolean {
    return this.transitioning;
  }

  /** 把初始场景以同样的 detached 语义放入队列。 */
  public setInitialScene<Params>(
    scene: Scene<Params>,
    params: Params,
    options: SceneTransitionOptions<Params> = {},
  ): Promise<void> {
    return this.transition(scene, params, options);
  }

  /**
   * 请求场景切换；调用方拿到的 Promise 只代表本次请求，不会绕过前面的队列项目。
   */
  public transition<Params>(
    target: Scene<Params>,
    params: Params,
    options: SceneTransitionOptions<Params> = {},
  ): Promise<void> {
    // closing 后的新请求仍归调用方所有，不能被 Router 代为销毁。
    const acceptedBeforeClosing = !this.closing;
    if (!acceptedBeforeClosing) return Promise.reject(new SceneTransitionError("SCENE_ROUTER_DESTROYED"));
    const runTransitionTask = async (): Promise<void> => {
      if (this.closing) {
        const queuedTarget = target as AnyScene;
        // 关闭前已接受的请求若轮到执行时仍是外部 mounted 对象，只能拒绝。
        // current/Router 已拥有的对象由 destroyCurrent 或既有清理路径负责。
        const routerOwnsTarget = queuedTarget === this.current || this.attached.has(queuedTarget.root);
        if (!routerOwnsTarget && !this.destroyedScenes.has(queuedTarget) && this.isTargetDetached(queuedTarget)) {
          await this.destroyQuietly(queuedTarget);
        }
        throw new SceneTransitionError("SCENE_ROUTER_DESTROYED");
      }
      this.transitioning = true;
      try {
        await this.runTransition(target as AnyScene, params, options);
      } finally {
        this.transitioning = false;
      }
    };
    const run = this.queue.then(runTransitionTask, runTransitionTask);
    // 用一个不会被拒绝的尾节点维持后续请求继续排队。
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 兼容显式 ID 注册的调用点；ID 仍由调用方显式映射，不做模糊推断。 */
  public async transitionTo<Params>(
    scene: Scene<Params>,
    params: Params,
    options: SceneTransitionOptions<Params> = {},
  ): Promise<void> {
    await this.transition(scene, params, options);
  }

  public destroy(): Promise<void> {
    if (this.destroyPromise !== null) return this.destroyPromise;
    // closing 先同步落地，避免 destroy 排队期间再接收新的可见场景。
    this.closing = true;
    const destroyCurrent = async (): Promise<void> => {
      const scene = this.current;
      this.current = null;
      if (scene === null) return;

      let exitError: unknown = null;
      try {
        await scene.exit();
      } catch (error) {
        exitError = error;
      }
      this.detach(scene.root);
      try {
        await this.destroyOnce(scene);
      } catch (error) {
        if (exitError === null) throw error;
      }
      if (exitError !== null) throw exitError;
    };
    this.destroyPromise = this.queue.then(destroyCurrent, destroyCurrent);
    // destroy 自身失败也不能污染后续 queued transition 的拒绝路径。
    this.queue = this.destroyPromise.then(
      () => undefined,
      () => undefined,
    );
    return this.destroyPromise;
  }

  private async runTransition<Params>(
    target: AnyScene,
    params: Params,
    options: SceneTransitionOptions<Params>,
  ): Promise<void> {
    const old = this.current;

    if (target === old) {
      throw new SceneTransitionError("SCENE_ALREADY_CURRENT");
    }
    // prepare 的前置条件必须在调用目标生命周期前检查，避免路由接管外部已挂载节点。
    this.assertTargetDetached(target);

    // prepare 失败时目标从未 attach；仍销毁其可能已经构建的 detached 节点。
    try {
      await target.prepare(params);
      if (!this.isTargetDetached(target)) {
        throw new SceneTransitionError("SCENE_ROOT_MOUNTED");
      }
    } catch (error) {
      await this.destroyQuietly(target);
      throw error;
    }

    let committed = false;
    let oldPaused = false;
    let targetAttached = false;
    try {
      if (options.commit) {
        await options.commit();
        committed = true;
      }

      if (old !== null) {
        await old.pause();
        oldPaused = true;
      }
      this.attach(target.root);
      targetAttached = true;
      await target.enter(params);
    } catch (error) {
      if (targetAttached) {
        this.detach(target.root);
      }

      if (committed) {
        // 提交已成功后旧 Store 已不再是权威真源；先重建，再销毁失败目标，且不恢复旧场景。
        let recoveryFailed = false;
        let recoveryError: unknown;
        try {
          await this.recoverAfterCommittedEnterFailure(target, params, options, error);
        } catch (rebuildError) {
          recoveryFailed = true;
          recoveryError = rebuildError;
        }
        await this.destroyQuietly(target);
        if (recoveryFailed) throw recoveryError;
        throw error;
      }

      await this.destroyQuietly(target);
      // commit 抛错或 pause 未完成时 oldPaused 为 false，不能伪造 resume 生命周期。
      if (old !== null && oldPaused) await this.resumeQuietly(old);
      throw error;
    }

    // enter 成功后才提交 current 并销毁旧场景。
    this.current = target;
    if (old !== null && old !== target) {
      await old.exit();
      this.detach(old.root);
      await this.destroyOnce(old);
    }
  }

  private attach(root: SceneRootLike): void {
    if (this.attached.has(root)) return;
    this.stage.addChild?.(root);
    this.attached.add(root);
  }

  private detach(root: SceneRootLike): void {
    if (!this.attached.has(root)) return;
    this.stage.removeChild?.(root);
    this.attached.delete(root);
  }

  private async destroyQuietly(scene: AnyScene): Promise<void> {
    try {
      await this.destroyOnce(scene);
    } catch {
      // 清理异常不能覆盖原始 prepare/enter 失败。
    }
  }

  private async destroyOnce(scene: AnyScene): Promise<void> {
    if (this.destroyedScenes.has(scene)) return;
    // 必须在 await 前登记，覆盖 destroy 期间由另一路径重入的情况。
    this.destroyedScenes.add(scene);
    await scene.destroy();
  }

  private assertTargetDetached(target: AnyScene): void {
    if (!this.isTargetDetached(target)) {
      throw new SceneTransitionError("SCENE_ROOT_MOUNTED");
    }
  }

  private isTargetDetached(target: AnyScene): boolean {
    return !this.attached.has(target.root) && isSceneRootDetached(target.root);
  }

  private async resumeQuietly(scene: AnyScene): Promise<void> {
    try {
      await scene.resume();
    } catch {
      // 恢复异常不能覆盖未提交转场的原始 enter 错误。
    }
  }

  private async recoverAfterCommittedEnterFailure<Params>(
    target: AnyScene,
    params: Params,
    options: SceneTransitionOptions<Params>,
    error: unknown,
  ): Promise<void> {
    if (options.recoverAfterCommittedEnterFailure) {
      await options.recoverAfterCommittedEnterFailure(error);
      return;
    }
    if (isRecoverableScene(target)) {
      await target.recoverAfterCommittedEnterFailure(params, error);
      return;
    }
    // 没有恢复入口时不猜测 Store 回写；调用方仍会收到 enter 原异常。
  }
}
