import {
  bindInputDisplayEvent,
  InputState,
  toFinitePoint,
  type InputDisplayObjectLike,
  type InputPoint,
  type PointerInputEvent,
} from "./InputState";

export const TOUCH_BUTTON_MIN_CSS_SIZE = 48;
export const TOUCH_BUTTON_LONG_PRESS_MS = 450;
export const TOUCH_BUTTON_LONG_PRESS_CANCEL_CSS_DISTANCE = 8;

export interface InputHitArea {
  x: number;
  y: number;
  width: number;
  height: number;
  contains?(x: number, y: number): boolean;
}

export interface TouchButtonOptions {
  inputState: InputState;
  action: string;
  displayObject?: InputDisplayObjectLike;
  /** 长按没有单独 action 时，长按仍只发送一次 action，由回调区分长按语义。 */
  longAction?: string;
  scale?: number;
  longPressMs?: number;
  longPressCancelDistanceCssPx?: number;
  clock?(): number;
  onPressedChange?(pressed: boolean): void;
  onTap?(action: string): void;
  onLongPress?(action: string): void;
}

function defaultClock(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} 必须是有限正数`);
}

function readHitArea(value: unknown): InputHitArea | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<InputHitArea>;
  if (
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height)
  ) {
    return null;
  }
  return {
    x: candidate.x as number,
    y: candidate.y as number,
    width: candidate.width as number,
    height: candidate.height as number,
    ...(typeof candidate.contains === "function" ? { contains: candidate.contains } : {}),
  };
}

/** 计算逻辑命中矩形，保证换算回 CSS 后不小于 48×48。 */
export function createMinimumHitArea(
  scale: number,
  existing?: InputHitArea | null,
): InputHitArea {
  assertFinitePositive(scale, "scale");
  const minimumSize = Math.ceil(TOUCH_BUTTON_MIN_CSS_SIZE / scale);
  const base = existing ?? { x: 0, y: 0, width: 0, height: 0 };
  const width = Math.max(minimumSize, base.width);
  const height = Math.max(minimumSize, base.height);
  return {
    x: base.x - (width - base.width) / 2,
    y: base.y - (height - base.height) / 2,
    width,
    height,
    ...(base.contains ? { contains: base.contains } : {}),
  };
}

/**
 * 触控按钮按 pointerId 捕获自己的触点。
 * 位移阈值始终使用 event.client CSS 坐标，避免把逻辑像素误当成 CSS 像素。
 */
export class TouchButton {
  public readonly displayObject?: InputDisplayObjectLike;
  public readonly action: string;
  public readonly longAction: string;
  public readonly hitArea: InputHitArea;
  private readonly inputState: InputState;
  private readonly longPressMs: number;
  private readonly longPressCancelDistanceCssPx: number;
  private readonly clock: () => number;
  private readonly onPressedChange?: (pressed: boolean) => void;
  private readonly onTap?: (action: string) => void;
  private readonly onLongPress?: (action: string) => void;
  private readonly unbinds: Array<() => void> = [];
  private ownerPointerId: number | null = null;
  private startClient: InputPoint | null = null;
  private startedAt = 0;
  private longCanceled = false;
  private longFired = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pressed = false;
  private enabled = true;

  public constructor(options: TouchButtonOptions) {
    if (options.action.trim().length === 0) throw new TypeError("按钮 action 不能为空");
    this.action = options.action;
    this.longAction = options.longAction ?? options.action;
    this.inputState = options.inputState;
    this.displayObject = options.displayObject;
    const scale = options.scale ?? 1;
    assertFinitePositive(scale, "scale");
    this.longPressMs = options.longPressMs ?? TOUCH_BUTTON_LONG_PRESS_MS;
    assertFinitePositive(this.longPressMs, "longPressMs");
    this.longPressCancelDistanceCssPx =
      options.longPressCancelDistanceCssPx ?? TOUCH_BUTTON_LONG_PRESS_CANCEL_CSS_DISTANCE;
    assertFinitePositive(
      this.longPressCancelDistanceCssPx,
      "longPressCancelDistanceCssPx",
    );
    this.clock = options.clock ?? defaultClock;
    this.onPressedChange = options.onPressedChange;
    this.onTap = options.onTap;
    this.onLongPress = options.onLongPress;
    this.hitArea = createMinimumHitArea(scale, readHitArea(this.displayObject?.hitArea));
    if (this.displayObject) {
      this.displayObject.hitArea = this.hitArea;
      this.attach();
    }
  }

  public get activePointerId(): number | null {
    return this.ownerPointerId;
  }

  public get isPressed(): boolean {
    return this.pressed;
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public attach(): void {
    if (!this.displayObject || this.unbinds.length > 0) return;
    this.displayObject.eventMode = "static";
    this.unbinds.push(
      bindInputDisplayEvent(this.displayObject, "pointerdown", (event) => this.pointerDown(event)),
      bindInputDisplayEvent(
        this.displayObject,
        "globalpointermove",
        (event) => this.globalPointerMove(event),
      ),
      bindInputDisplayEvent(this.displayObject, "pointerup", (event) => this.pointerUp(event)),
      bindInputDisplayEvent(
        this.displayObject,
        "pointerupoutside",
        (event) => this.pointerUpOutside(event),
      ),
      bindInputDisplayEvent(
        this.displayObject,
        "pointercancel",
        (event) => this.pointerCancel(event),
      ),
    );
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  public pointerDown(event: PointerInputEvent, nowMs = this.clock()): boolean {
    if (!this.enabled || this.ownerPointerId !== null) return false;
    const point = toFinitePoint(event.client);
    if (!point || !this.inputState.claimPointer(event.pointerId)) return false;
    this.ownerPointerId = event.pointerId;
    this.startClient = point;
    this.startedAt = nowMs;
    this.longCanceled = false;
    this.longFired = false;
    this.setPressed(true);
    this.scheduleLongPress();
    event.preventDefault?.();
    return true;
  }

  public globalPointerMove(event: PointerInputEvent): void {
    if (!this.enabled || this.ownerPointerId !== event.pointerId || this.startClient === null) return;
    const point = toFinitePoint(event.client);
    if (!point || this.longCanceled || this.longFired) return;
    const distance = Math.hypot(point.x - this.startClient.x, point.y - this.startClient.y);
    if (distance > this.longPressCancelDistanceCssPx) this.longCanceled = true;
  }

  public pointerUp(event: PointerInputEvent, nowMs = this.clock()): boolean {
    if (this.ownerPointerId !== event.pointerId) return false;
    this.checkLongPress(nowMs);
    const longFired = this.longFired;
    this.clearPointer(event.pointerId);
    if (!longFired) {
      this.inputState.press(this.action);
      this.onTap?.(this.action);
    }
    event.preventDefault?.();
    return true;
  }

  /** pointerupoutside 是取消，不把滑出按钮的触点误判成点击。 */
  public pointerUpOutside(event: PointerInputEvent): boolean {
    if (this.ownerPointerId !== event.pointerId) return false;
    this.clearPointer(event.pointerId);
    event.preventDefault?.();
    return true;
  }

  public pointerCancel(event: PointerInputEvent): boolean {
    return this.pointerUpOutside(event);
  }

  /** 供固定步或测试在没有真实 timer 的环境检查长按阈值。 */
  public checkLongPress(nowMs = this.clock()): boolean {
    if (
      this.ownerPointerId === null ||
      !this.inputState.isPointerClaimed(this.ownerPointerId) ||
      this.longCanceled ||
      this.longFired ||
      nowMs - this.startedAt < this.longPressMs
    ) {
      return false;
    }
    this.longFired = true;
    this.inputState.press(this.longAction);
    this.onLongPress?.(this.longAction);
    return true;
  }

  public reset(): void {
    if (this.ownerPointerId !== null) this.inputState.releasePointer(this.ownerPointerId);
    this.clearTimer();
    this.ownerPointerId = null;
    this.startClient = null;
    this.longCanceled = false;
    this.longFired = false;
    this.setPressed(false);
  }

  public destroy(): void {
    this.reset();
    while (this.unbinds.length > 0) this.unbinds.pop()?.();
    this.enabled = false;
  }

  private scheduleLongPress(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.checkLongPress();
    }, this.longPressMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearPointer(pointerId: number): void {
    this.inputState.releasePointer(pointerId);
    this.clearTimer();
    this.ownerPointerId = null;
    this.startClient = null;
    this.longCanceled = false;
    this.setPressed(false);
  }

  private setPressed(pressed: boolean): void {
    if (this.pressed === pressed) return;
    this.pressed = pressed;
    this.onPressedChange?.(pressed);
  }
}

export type { InputDisplayObjectLike, PointerInputEvent } from "./InputState";
