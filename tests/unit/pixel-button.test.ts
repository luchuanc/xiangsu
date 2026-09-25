import { describe, expect, it, vi } from "vitest";
import type { FederatedPointerEvent } from "pixi.js";

type MockHandler = (...args: unknown[]) => void;

// Node 单测不启动浏览器渲染器，但这些 fake 保留按钮依赖的真实公开行为：子节点、事件、命中区和销毁。
vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: MockContainer[] = [];
    public parent: MockContainer | null = null;
    public eventMode = "auto";
    public cursor = "default";
    public hitArea: unknown = null;
    public x = 0;
    public y = 0;
    public destroyed = false;
    private readonly handlers = new Map<string, MockHandler[]>();

    public constructor() {}

    public addChild<T extends MockContainer>(...children: T[]): T {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
      return children[0];
    }

    public on(eventName: string, handler: MockHandler): this {
      const handlers = this.handlers.get(eventName) ?? [];
      handlers.push(handler);
      this.handlers.set(eventName, handlers);
      return this;
    }

    public emit(eventName: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(eventName) ?? []) handler(...args);
    }

    public off(eventName: string, handler: MockHandler): this {
      const handlers = this.handlers.get(eventName);
      if (handlers === undefined) return this;
      this.handlers.set(
        eventName,
        handlers.filter((candidate) => candidate !== handler),
      );
      return this;
    }

    public destroy(options?: { children?: boolean }): void {
      this.destroyed = true;
      if (options?.children === true) {
        for (const child of this.children) child.destroy(options);
      }
      this.children.length = 0;
      this.handlers.clear();
    }
  }

  class MockGraphics extends MockContainer {
    public tint = 0xffffff;
    public readonly drawCalls: Array<{ type: string; values: unknown[] }> = [];

    public rect(x: number, y: number, width: number, height: number): this {
      this.drawCalls.push({ type: "rect", values: [x, y, width, height] });
      return this;
    }

    public fill(style: unknown): this {
      this.drawCalls.push({ type: "fill", values: [style] });
      return this;
    }

    public stroke(style: unknown): this {
      this.drawCalls.push({ type: "stroke", values: [style] });
      return this;
    }
  }

  class MockText extends MockContainer {
    public text: string;
    public readonly style: { fill: unknown };
    public readonly anchor = {
      x: 0,
      y: 0,
      set: (x: number, y = x): void => {
        this.anchor.x = x;
        this.anchor.y = y;
      },
    };

    public constructor(options: { text?: string; style?: { fill?: unknown } }) {
      super();
      this.text = options.text ?? "";
      this.style = { fill: options.style?.fill ?? 0xffffff };
    }
  }

  class MockRectangle {
    public constructor(
      public readonly x: number,
      public readonly y: number,
      public readonly width: number,
      public readonly height: number,
    ) {}
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
    Rectangle: MockRectangle,
    Text: MockText,
  };
});

import { PixelButton } from "../../src/ui/rendering/PixelButton";

function pointerEvent(event: { stopPropagation?(): void } = {}): FederatedPointerEvent {
  return event as unknown as FederatedPointerEvent;
}

describe("PixelButton", () => {
  it("创建方形像素按钮并在启用时只由 pointertap 触发一次", () => {
    const clicks: string[] = [];
    const button = new PixelButton({
      label: "开始远征",
      width: 152,
      height: 48,
      onPress: () => clicks.push("pressed"),
    });

    expect(button.children).toHaveLength(4);
    expect((button.hitArea as { width: number } | null)?.width).toBe(152);
    expect((button.hitArea as { height: number } | null)?.height).toBe(48);
    expect(button.eventMode).toBe("static");

    button.emit("pointerdown", pointerEvent());
    expect(clicks).toEqual([]);
    button.emit("pointerup", pointerEvent());
    expect(clicks).toEqual([]);

    const stopPropagation = vi.fn();
    button.emit("pointertap", pointerEvent({ stopPropagation }));
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(clicks).toEqual(["pressed"]);
  });

  it("按下时面板整数位移，抬起或移出后恢复，并能切换禁用态", () => {
    const onPress = vi.fn();
    const button = new PixelButton({
      label: "继续",
      width: 96,
      height: 48,
      onPress,
    });

    expect(button.face.x).toBe(0);
    expect(button.face.y).toBe(0);
    button.emit("pointerdown", pointerEvent());
    expect(button.face.x).toBe(1);
    expect(button.face.y).toBe(1);
    button.emit("pointerup", pointerEvent());
    expect(button.face.x).toBe(0);
    expect(button.face.y).toBe(0);

    button.emit("pointerdown", pointerEvent());
    button.emit("pointerout", pointerEvent());
    expect(button.face.x).toBe(0);
    expect(button.face.y).toBe(0);
    button.emit("pointertap", pointerEvent({ stopPropagation() {} }));
    expect(onPress).toHaveBeenCalledTimes(1);

    button.setDisabled(true);
    expect(button.eventMode).toBe("none");
    expect(button.face.tint).not.toBe(0xffffff);
    button.emit("pointertap", pointerEvent({ stopPropagation() {} }));
    expect(button.face.x).toBe(0);
    expect(onPress).toHaveBeenCalledTimes(1);

    button.setDisabled(false);
    expect(button.eventMode).toBe("static");
  });

  it("焦点态只改变视觉，不改变命中区或按下位置", () => {
    const button = new PixelButton({
      label: "继续",
      width: 96,
      height: 48,
      onPress: () => undefined,
    });
    const hitArea = button.hitArea;
    const baseLabelX = button.labelText.x;
    const baseLabelY = button.labelText.y;

    button.setFocused(true);
    expect(button.face.tint).not.toBe(0xffffff);
    expect(button.hitArea).toBe(hitArea);
    expect(button.labelText.x).toBe(baseLabelX);
    expect(button.labelText.y).toBe(baseLabelY);

    button.setDisabled(true);
    expect(button.face.tint).not.toBe(0xffffff);
    button.setFocused(false);
    expect(button.face.tint).not.toBe(0xffffff);
    button.setDisabled(false);
    expect(button.face.tint).toBe(0xffffff);
    expect(button.hitArea).toBe(hitArea);
  });

  it("拒绝小于 44 的命中区并更新可见标签", () => {
    expect(
      () =>
        new PixelButton({
          label: "太小",
          width: 43,
          height: 48,
          onPress: () => undefined,
        }),
    ).toThrow("PIXEL_BUTTON_HIT_AREA_TOO_SMALL");
    expect(
      () =>
        new PixelButton({
          label: "太小",
          width: 48,
          height: 43,
          onPress: () => undefined,
        }),
    ).toThrow("PIXEL_BUTTON_HIT_AREA_TOO_SMALL");

    const button = new PixelButton({
      label: "旧标签",
      width: 96,
      height: 48,
      onPress: () => undefined,
    });
    expect(button.labelText.text).toBe("旧标签");
    button.setLabel("新标签");
    expect(button.labelText.text).toBe("新标签");
  });

  it("销毁时释放自身和全部视觉子节点", () => {
    const onPress = vi.fn();
    const button = new PixelButton({
      label: "销毁",
      width: 96,
      height: 48,
      onPress,
    });
    const children = [...button.children];

    button.destroy();

    expect(button.destroyed).toBe(true);
    expect(children.every((child) => child.destroyed)).toBe(true);
    button.emit("pointertap", pointerEvent({ stopPropagation() {} }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
