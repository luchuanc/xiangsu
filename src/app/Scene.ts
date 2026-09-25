/**
 * 场景根节点的最小适配器；Scene 不依赖具体 Pixi 容器，便于 Node fake 适配器测试。
 */
export interface SceneRootLike {
  parent?: unknown | null;
  destroy?(options?: unknown): void;
}

/** 路由只接收没有父节点的根；具体 Pixi Container 由适配器自行提供 parent。 */
export function isSceneRootDetached(root: SceneRootLike): boolean {
  return root.parent === null || root.parent === undefined;
}

/**
 * 单主场景生命周期契约。root 在 prepare 期间必须保持 detached。
 */
export interface Scene<Params = unknown> {
  readonly root: SceneRootLike;
  prepare(params: Params): void | Promise<void>;
  enter(params: Params): void | Promise<void>;
  pause(): void | Promise<void>;
  resume(): void | Promise<void>;
  exit(): void | Promise<void>;
  destroy(): void | Promise<void>;
}

/**
 * 涉及已提交存档的场景可显式提供恢复入口；普通 Scene 不需要实现它。
 */
export interface RecoverableScene<Params = unknown> extends Scene<Params> {
  recoverAfterCommittedEnterFailure(params: Params, error: unknown): void | Promise<void>;
}

export function isRecoverableScene<Params>(
  scene: Scene<Params>,
): scene is RecoverableScene<Params> {
  return typeof (scene as Partial<RecoverableScene<Params>>).recoverAfterCommittedEnterFailure === "function";
}
