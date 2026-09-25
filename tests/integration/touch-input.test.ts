import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InputLayer,
  InputState,
  TouchButton,
  VirtualJoystick,
  type InputDisplayObjectLike,
  type InputEventListener,
  type InputLifecycleTargetLike,
  type PointerInputEvent,
} from "../../src/app/input/InputLayer";

class FakeDisplay implements InputDisplayObjectLike {
  public eventMode = "none";
  public hitArea: unknown;
  public parent: unknown | null = null;
  private readonly listeners = new Map<string, Set<InputEventListener>>();

  public on(eventName: string, listener: InputEventListener): void {
    const listeners = this.listeners.get(eventName) ?? new Set<InputEventListener>();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
  }

  public off(eventName: string, listener: InputEventListener): void {
    this.listeners.get(eventName)?.delete(listener);
  }

  public emit(eventName: string, event: PointerInputEvent): void {
    for (const listener of this.listeners.get(eventName) ?? []) listener(event);
  }
}

class FakeRoot extends FakeDisplay {
  public readonly children: InputDisplayObjectLike[] = [];

  public addChild(...children: InputDisplayObjectLike[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  public removeChild(child: InputDisplayObjectLike): void {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
  }
}

class FakeLifecycleTarget implements InputLifecycleTargetLike {
  private readonly listeners = new Map<string, Set<EventListener>>();

  public addEventListener(eventName: string, listener: EventListener): void {
    const listeners = this.listeners.get(eventName) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
  }

  public removeEventListener(eventName: string, listener: EventListener): void {
    this.listeners.get(eventName)?.delete(listener);
  }

  public emit(eventName: string): void {
    for (const listener of this.listeners.get(eventName) ?? []) listener(new Event(eventName));
  }
}

function pointer(
  pointerId: number,
  global: { x: number; y: number },
  client = global,
): PointerInputEvent {
  return { pointerId, global, client, preventDefault: vi.fn() };
}

describe("mobile touch input", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("支持摇杆与按钮双指并行，并保持 pointerId 独占", () => {
    const input = new InputState();
    const joystickDisplay = new FakeDisplay();
    const buttonDisplay = new FakeDisplay();
    const joystick = new VirtualJoystick({
      inputState: input,
      displayObject: joystickDisplay,
      radius: 100,
    });
    const button = new TouchButton({
      inputState: input,
      displayObject: buttonDisplay,
      action: "attack",
      clock: () => 0,
    });
    const layer = new InputLayer({
      inputState: input,
      joystick,
      buttons: [button],
      root: new FakeRoot(),
      lifecycleTarget: new FakeLifecycleTarget(),
    });

    joystickDisplay.emit("pointerdown", pointer(1, { x: 100, y: 100 }));
    buttonDisplay.emit("pointerdown", pointer(2, { x: 200, y: 200 }));
    // 18% 死区内没有移动输出；死区外重新映射，半径边界归一化为 1。
    joystickDisplay.emit("globalpointermove", pointer(1, { x: 110, y: 100 }));
    expect(input.snapshot().move).toEqual({ x: 0, y: 0 });
    joystickDisplay.emit("globalpointermove", pointer(1, { x: 200, y: 100 }));
    expect(input.snapshot().move).toEqual({ x: 1, y: 0 });

    // 错误 pointer 不能释放摇杆或按钮；按钮 pointerup 才消费一次 action。
    joystickDisplay.emit("pointerup", pointer(2, { x: 200, y: 100 }));
    buttonDisplay.emit("pointerup", pointer(1, { x: 200, y: 200 }));
    expect(input.activePointerCount).toBe(2);
    buttonDisplay.emit("pointerup", pointer(2, { x: 200, y: 200 }));
    const snapshot = input.snapshot();
    expect(snapshot.move).toEqual({ x: 1, y: 0 });
    expect(snapshot.actions).toEqual(["attack"]);

    joystickDisplay.emit("pointercancel", pointer(1, { x: 200, y: 100 }));
    expect(input.snapshot().move).toEqual({ x: 0, y: 0 });
    layer.destroy();
  });

  it("按 CSS 坐标取消长按，450ms 到达后只发送一次 long action", () => {
    const input = new InputState();
    const display = new FakeDisplay();
    const button = new TouchButton({
      inputState: input,
      displayObject: display,
      action: "open",
      longAction: "inspect",
      clock: () => 0,
      scale: 2,
    });
    expect(button.hitArea.width).toBe(24);
    expect(button.hitArea.height).toBe(24);

    display.emit("pointerdown", pointer(3, { x: 0, y: 0 }));
    display.emit("globalpointermove", pointer(3, { x: 0, y: 0 }, { x: 9, y: 0 }));
    expect(button.checkLongPress(450)).toBe(false);
    display.emit("pointerup", pointer(3, { x: 0, y: 0 }));
    expect(input.snapshot().actions).toEqual(["open"]);

    display.emit("pointerdown", pointer(4, { x: 0, y: 0 }));
    expect(button.checkLongPress(449)).toBe(false);
    expect(button.checkLongPress(450)).toBe(true);
    expect(button.checkLongPress(900)).toBe(false);
    display.emit("pointerup", pointer(4, { x: 0, y: 0 }));
    expect(input.snapshot().actions).toEqual(["inspect"]);
  });

  it("blur、visibility、竖屏、context lost 和路由暂停统一清空并禁用输入", () => {
    const input = new InputState();
    const joystickDisplay = new FakeDisplay();
    const lifecycle = new FakeLifecycleTarget();
    const joystick = new VirtualJoystick({ inputState: input, displayObject: joystickDisplay});
    const layer = new InputLayer({
      inputState: input,
      joystick,
      lifecycleTarget: lifecycle,
    });

    joystickDisplay.emit("pointerdown", pointer(5, { x: 10, y: 10 }));
    joystickDisplay.emit("globalpointermove", pointer(5, { x: 60, y: 10 }));
    lifecycle.emit("blur");
    expect(layer.isEnabled).toBe(false);
    expect(input.activePointerCount).toBe(0);
    expect(input.snapshot()).toMatchObject({ move: { x: 0, y: 0 }, actions: [] });
    joystickDisplay.emit("pointerdown", pointer(6, { x: 10, y: 10 }));
    expect(input.activePointerCount).toBe(0);

    layer.resume();
    joystickDisplay.emit("pointerdown", pointer(6, { x: 10, y: 10 }));
    lifecycle.emit("visibilitychange");
    lifecycle.emit("portrait");
    lifecycle.emit("webglcontextlost");
    lifecycle.emit("routePause");
    expect(input.activePointerCount).toBe(0);
    expect(input.snapshot().move).toEqual({ x: 0, y: 0 });
    layer.destroy();
  });

  it("默认同时监听 window 与 document，document visibilitychange 会禁用并清空输入", () => {
    const windowTarget = new FakeLifecycleTarget();
    const documentTarget = new FakeLifecycleTarget();
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("document", documentTarget);
    const input = new InputState();
    const joystickDisplay = new FakeDisplay();
    const layer = new InputLayer({
      inputState: input,
      joystick: new VirtualJoystick({ inputState: input, displayObject: joystickDisplay }),
    });

    joystickDisplay.emit("pointerdown", pointer(8, { x: 0, y: 0 }));
    joystickDisplay.emit("globalpointermove", pointer(8, { x: 80, y: 0 }));
    documentTarget.emit("visibilitychange");

    expect(layer.isEnabled).toBe(false);
    expect(input.activePointerCount).toBe(0);
    expect(input.snapshot().move).toEqual({ x: 0, y: 0 });
    layer.destroy();
  });
});
