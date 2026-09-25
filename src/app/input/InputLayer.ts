import {
  InputState,
  type InputDisplayObjectLike,
  type InputLifecycleTargetLike,
  type InputSnapshot,
} from "./InputState";
import {
  VirtualJoystick,
  type VirtualJoystickOptions,
} from "./VirtualJoystick";
import { TouchButton, type TouchButtonOptions } from "./TouchButton";

export type InputLifecycleEventName =
  | "blur"
  | "visibilitychange"
  | "orientationchange"
  | "portrait"
  | "webglcontextlost"
  | "contextlost"
  | "contextLost"
  | "pause"
  | "blocked"
  | "routePause";

export interface InputControlLike {
  readonly displayObject?: InputDisplayObjectLike;
  setEnabled(enabled: boolean): void;
  reset(): void;
  destroy(): void;
}

export interface InputLayerOptions {
  root?: InputDisplayObjectLike;
  inputState?: InputState;
  joystick?: VirtualJoystick | Omit<VirtualJoystickOptions, "inputState">;
  buttons?: readonly (TouchButton | Omit<TouchButtonOptions, "inputState">)[];
  lifecycleTarget?: InputLifecycleTargetLike;
  lifecycleTargets?: readonly InputLifecycleTargetLike[];
  enabled?: boolean;
}

const RESET_EVENTS: readonly InputLifecycleEventName[] = [
  "blur",
  "visibilitychange",
  "orientationchange",
  "portrait",
  "webglcontextlost",
  "contextlost",
  "contextLost",
  "pause",
  "blocked",
  "routePause",
];

function isVirtualJoystick(value: InputLayerOptions["joystick"]): value is VirtualJoystick {
  return value instanceof VirtualJoystick;
}

function isTouchButton(
  value: NonNullable<InputLayerOptions["buttons"]>[number],
): value is TouchButton {
  return value instanceof TouchButton;
}

function browserLifecycleTargets(): InputLifecycleTargetLike[] {
  const targets: InputLifecycleTargetLike[] = [];
  if (typeof window !== "undefined") targets.push(window);
  // visibilitychange 由 document 派发；不能只监听 window，否则后台切换不会复位输入。
  if (typeof document !== "undefined") targets.push(document);
  return targets;
}

function uniqueTargets(
  targets: readonly (InputLifecycleTargetLike | undefined)[],
): InputLifecycleTargetLike[] {
  const unique: InputLifecycleTargetLike[] = [];
  for (const target of targets) {
    if (target !== undefined && !unique.includes(target)) unique.push(target);
  }
  return unique;
}

/**
 * 组合摇杆、按钮和系统生命周期。
 * 该层只负责输入适配与清理，不直接驱动 Scene 或修改领域状态。
 */
export class InputLayer {
  public readonly inputState: InputState;
  public readonly joystick: VirtualJoystick | null;
  public readonly buttons: readonly TouchButton[];
  private readonly root?: InputDisplayObjectLike;
  private lifecycleTargets: readonly InputLifecycleTargetLike[] = [];
  private readonly lifecycleUnbinds: Array<() => void> = [];
  private enabled: boolean;
  private destroyed = false;

  public constructor(options: InputLayerOptions = {}) {
    this.inputState = options.inputState ?? new InputState();
    this.root = options.root;
    const joystick = options.joystick;
    this.joystick =
      joystick === undefined
        ? null
        : isVirtualJoystick(joystick)
          ? joystick
          : new VirtualJoystick({ ...joystick, inputState: this.inputState });
    this.buttons = (options.buttons ?? []).map((button) =>
      isTouchButton(button)
        ? button
        : new TouchButton({ ...button, inputState: this.inputState }),
    );
    this.enabled = options.enabled ?? true;

    this.mountControls();
    this.bindLifecycle(options);
    this.setEnabled(this.enabled);
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public snapshot(): InputSnapshot {
    return this.inputState.snapshot();
  }

  /** 供 GameApp 的 blocked/hidden/context lost 和 SceneRouter pause 直接调用。 */
  public resetAll(): void {
    this.inputState.resetAll();
    this.joystick?.reset();
    for (const button of this.buttons) button.reset();
  }

  public setEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.enabled = enabled;
    this.joystick?.setEnabled(enabled);
    for (const button of this.buttons) button.setEnabled(enabled);
    if (!enabled) this.resetAll();
  }

  public resume(): void {
    this.setEnabled(true);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    while (this.lifecycleUnbinds.length > 0) this.lifecycleUnbinds.pop()?.();
    this.inputState.resetAll();
    this.joystick?.destroy();
    for (const button of this.buttons) button.destroy();
    this.unmountControls();
    this.enabled = false;
  }

  private mountControls(): void {
    if (!this.root) return;
    const controls: InputControlLike[] = [
      ...(this.joystick ? [this.joystick] : []),
      ...this.buttons,
    ];
    for (const control of controls) {
      const displayObject = control.displayObject;
      if (!displayObject || !this.root.addChild || displayObject.parent !== null && displayObject.parent !== undefined) {
        continue;
      }
      this.root.addChild(displayObject);
    }
  }

  private unmountControls(): void {
    if (!this.root?.removeChild) return;
    const controls: InputControlLike[] = [
      ...(this.joystick ? [this.joystick] : []),
      ...this.buttons,
    ];
    for (const control of controls) {
      if (control.displayObject) this.root.removeChild(control.displayObject);
    }
  }

  private bindLifecycle(options: InputLayerOptions): void {
    const configuredTargets = [
      ...(options.lifecycleTargets ?? []),
      ...(options.lifecycleTarget ? [options.lifecycleTarget] : []),
    ];
    const targets = configuredTargets.length > 0 ? configuredTargets : browserLifecycleTargets();
    this.lifecycleTargets = uniqueTargets(targets);

    const resetListener: EventListener = () => {
      // 生命周期函数可能在 pointerup 之后异步到达，重复 reset 是有意的幂等操作。
      this.setEnabled(false);
    };
    for (const target of this.lifecycleTargets) {
      for (const eventName of RESET_EVENTS) {
        target.addEventListener(eventName, resetListener);
        this.lifecycleUnbinds.push(() => target.removeEventListener(eventName, resetListener));
      }
    }
  }
}

export { InputState } from "./InputState";
export type {
  InputDisplayObjectLike,
  InputLifecycleTargetLike,
  InputEventListener,
  InputPoint,
  InputSnapshot,
  PointerInputEvent,
} from "./InputState";
export { TouchButton } from "./TouchButton";
export { VirtualJoystick } from "./VirtualJoystick";
