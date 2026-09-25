/** 逻辑视口尺寸固定，输入层只输出逻辑坐标，不把 CSS 坐标泄漏给领域层。 */
export const INPUT_LOGICAL_VIEWPORT_WIDTH = 640;
export const INPUT_LOGICAL_VIEWPORT_HEIGHT = 360;

/** 移动轴和快照的基础类型。 */
export interface InputVector {
  readonly x: number;
  readonly y: number;
}

export interface InputSnapshot {
  readonly frameNo: number;
  readonly move: InputVector;
  readonly actions: readonly string[];
}

export interface InputPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Pixi FederatedPointerEvent 的输入层最小字段。
 * 这里使用结构类型，Node 单测可以注入 fake 事件而不初始化浏览器 Pixi 适配器。
 */
export interface PointerInputEvent {
  readonly pointerId: number;
  readonly global?: InputPoint;
  readonly client?: InputPoint;
  readonly timeStamp?: number;
  preventDefault?(): void;
}

export type InputEventListener = (event: PointerInputEvent) => void;

/**
 * Pixi DisplayObject 与 Node fake adapter 共用的最小交互接口。
 * 生产环境传入真实 Container；测试环境只需要实现 on/off 或 add/removeEventListener。
 */
export interface InputDisplayObjectLike {
  eventMode?: string;
  hitArea?: unknown;
  parent?: unknown | null;
  on?(eventName: string, listener: InputEventListener): unknown;
  off?(eventName: string, listener: InputEventListener): unknown;
  addEventListener?(eventName: string, listener: InputEventListener): void;
  removeEventListener?(eventName: string, listener: InputEventListener): void;
  addChild?(...children: InputDisplayObjectLike[]): unknown;
  removeChild?(child: InputDisplayObjectLike): unknown;
}

export interface InputLifecycleTargetLike {
  addEventListener(eventName: string, listener: EventListener): void;
  removeEventListener(eventName: string, listener: EventListener): void;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizeVector(x: number, y: number): InputVector {
  const safeX = finiteOrZero(x);
  const safeY = finiteOrZero(y);
  const length = Math.hypot(safeX, safeY);
  if (length <= 1 || length === 0) {
    return { x: safeX, y: safeY };
  }
  return { x: safeX / length, y: safeY / length };
}

/**
 * 连续移动轴与一次性动作的唯一输入真源。
 * Scene 在固定步开始时消费 snapshot；View/控件不能直接修改领域状态。
 */
export class InputState {
  private move: InputVector = { x: 0, y: 0 };
  private readonly pendingActions = new Set<string>();
  private readonly activePointers = new Set<number>();
  private frame = 0;

  public get frameNo(): number {
    return this.frame;
  }

  public get activePointerCount(): number {
    return this.activePointers.size;
  }

  public setMove(x: number, y: number): void {
    this.move = normalizeVector(x, y);
  }

  public press(action: string): void {
    if (action.trim().length === 0) return;
    this.pendingActions.add(action);
  }

  /** 控件在 pointerdown 时登记所有权；同一个 pointer 不能被第二个控件夺走。 */
  public claimPointer(pointerId: number): boolean {
    if (!Number.isInteger(pointerId) || pointerId < 0 || this.activePointers.has(pointerId)) {
      return false;
    }
    this.activePointers.add(pointerId);
    return true;
  }

  public releasePointer(pointerId: number): void {
    this.activePointers.delete(pointerId);
  }

  public isPointerClaimed(pointerId: number): boolean {
    return this.activePointers.has(pointerId);
  }

  /**
   * 每个固定步只消费一次动作集合；返回值全部是新对象，调用方不能污染下一步输入。
   */
  public snapshot(): InputSnapshot {
    this.frame += 1;
    const snapshot: InputSnapshot = {
      frameNo: this.frame,
      move: { ...this.move },
      actions: Object.freeze([...this.pendingActions]),
    };
    this.pendingActions.clear();
    return Object.freeze(snapshot);
  }

  /** 系统中断、场景暂停和销毁统一调用，确保不会残留粘滞移动或动作。 */
  public resetAll(): void {
    this.move = { x: 0, y: 0 };
    this.pendingActions.clear();
    this.activePointers.clear();
    this.frame += 1;
  }
}

/** 为 Pixi on/off 和 DOM add/removeEventListener 提供统一绑定。 */
export function bindInputDisplayEvent(
  target: InputDisplayObjectLike,
  eventName: string,
  listener: InputEventListener,
): () => void {
  if (target.on && target.off) {
    target.on(eventName, listener);
    return () => target.off?.(eventName, listener);
  }
  if (target.addEventListener && target.removeEventListener) {
    target.addEventListener(eventName, listener);
    return () => target.removeEventListener?.(eventName, listener);
  }
  throw new TypeError(`输入对象不支持事件绑定: ${eventName}`);
}

export function toFinitePoint(point: InputPoint | undefined): InputPoint | null {
  if (
    point === undefined ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return null;
  }
  return { x: point.x, y: point.y };
}
