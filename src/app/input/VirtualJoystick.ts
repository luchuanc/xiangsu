import {
  bindInputDisplayEvent,
  InputState,
  toFinitePoint,
  type InputDisplayObjectLike,
  type InputPoint,
  type PointerInputEvent,
} from "./InputState";

export const VIRTUAL_JOYSTICK_DEAD_ZONE = 0.18;
export const DEFAULT_VIRTUAL_JOYSTICK_RADIUS = 64;

export interface VirtualJoystickOptions {
  inputState: InputState;
  displayObject?: InputDisplayObjectLike;
  radius?: number;
  deadZone?: number;
  onVectorChange?(vector: InputPoint): void;
}

function assertNumberInRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} 必须在 ${min} 到 ${max} 之间`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 动态摇杆：起点取 pointerdown 的逻辑 global 坐标，拖动统一监听 globalpointermove。
 * 每个摇杆只接受一个 pointerId，并通过 InputState 再做一次全局指针所有权校验。
 */
export class VirtualJoystick {
  public readonly displayObject?: InputDisplayObjectLike;
  private readonly inputState: InputState;
  private readonly radius: number;
  private readonly deadZone: number;
  private readonly onVectorChange?: (vector: InputPoint) => void;
  private readonly unbinds: Array<() => void> = [];
  private currentVector: InputPoint = { x: 0, y: 0 };
  private origin: InputPoint | null = null;
  private ownerPointerId: number | null = null;
  private enabled = true;

  public constructor(options: VirtualJoystickOptions) {
    if (!Number.isFinite(options.radius) && options.radius !== undefined) {
      throw new RangeError("摇杆 radius 必须是有限正数");
    }
    this.radius = options.radius ?? DEFAULT_VIRTUAL_JOYSTICK_RADIUS;
    if (this.radius <= 0) throw new RangeError("摇杆 radius 必须是有限正数");
    this.deadZone = options.deadZone ?? VIRTUAL_JOYSTICK_DEAD_ZONE;
    assertNumberInRange(this.deadZone, 0, 1, "摇杆 deadZone");
    this.inputState = options.inputState;
    this.displayObject = options.displayObject;
    this.onVectorChange = options.onVectorChange;

    if (this.displayObject) this.attach();
  }

  public get vector(): InputPoint {
    return { ...this.currentVector };
  }

  public get activePointerId(): number | null {
    return this.ownerPointerId;
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

  public pointerDown(event: PointerInputEvent): boolean {
    if (!this.enabled || this.ownerPointerId !== null) return false;
    const point = toFinitePoint(event.global);
    if (!point || !this.inputState.claimPointer(event.pointerId)) return false;

    this.ownerPointerId = event.pointerId;
    this.origin = point;
    this.updateVector(point);
    event.preventDefault?.();
    return true;
  }

  public globalPointerMove(event: PointerInputEvent): void {
    if (!this.enabled || this.ownerPointerId !== event.pointerId || this.origin === null) return;
    const point = toFinitePoint(event.global);
    if (!point) return;
    this.updateVector(point);
    event.preventDefault?.();
  }

  public pointerUp(event: PointerInputEvent): boolean {
    if (this.ownerPointerId !== event.pointerId) return false;
    this.release(event.pointerId);
    event.preventDefault?.();
    return true;
  }

  public pointerUpOutside(event: PointerInputEvent): boolean {
    return this.pointerUp(event);
  }

  public pointerCancel(event: PointerInputEvent): boolean {
    if (this.ownerPointerId !== event.pointerId) return false;
    this.release(event.pointerId);
    event.preventDefault?.();
    return true;
  }

  /** 主动复位用于 blur、visibilitychange、竖屏、context lost 和路由暂停。 */
  public reset(): void {
    if (this.ownerPointerId !== null) this.inputState.releasePointer(this.ownerPointerId);
    this.ownerPointerId = null;
    this.origin = null;
    this.setVector({ x: 0, y: 0 });
  }

  public destroy(): void {
    this.reset();
    while (this.unbinds.length > 0) this.unbinds.pop()?.();
    this.enabled = false;
  }

  private release(pointerId: number): void {
    this.inputState.releasePointer(pointerId);
    this.ownerPointerId = null;
    this.origin = null;
    this.setVector({ x: 0, y: 0 });
  }

  private updateVector(point: InputPoint): void {
    if (this.origin === null) return;
    const dx = point.x - this.origin.x;
    const dy = point.y - this.origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
      this.setVector({ x: 0, y: 0 });
      return;
    }

    const clampedDistance = Math.min(distance, this.radius);
    const rawMagnitude = clampedDistance / this.radius;
    if (rawMagnitude <= this.deadZone) {
      this.setVector({ x: 0, y: 0 });
      return;
    }

    // 死区外重新映射到 0..1，避免摇杆过了死区后仍然有一段迟钝区。
    const magnitude = clamp(
      (rawMagnitude - this.deadZone) / (1 - this.deadZone),
      0,
      1,
    );
    this.setVector({
      x: (dx / distance) * magnitude,
      y: (dy / distance) * magnitude,
    });
  }

  private setVector(vector: InputPoint): void {
    this.currentVector = vector;
    this.inputState.setMove(vector.x, vector.y);
    this.onVectorChange?.({ ...vector });
  }
}

export type { InputDisplayObjectLike, PointerInputEvent } from "./InputState";
