import { describe, expect, it, vi } from "vitest";
import type { FederatedPointerEvent, Texture } from "pixi.js";

type MockHandler = (...args: unknown[]) => void;

// Node 集成测试只验证显示对象组合和事件契约，不启动浏览器 WebGL；fake 保留标题渲染器依赖的最小 Pixi 行为。
vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: MockContainer[] = [];
    public parent: MockContainer | null = null;
    public eventMode = "auto";
    public cursor = "default";
    public hitArea: unknown = null;
    public x = 0;
    public y = 0;
    public visible = true;
    public destroyed = false;
    private readonly handlers = new Map<string, MockHandler[]>();

    public constructor(options?: unknown) { void options; }

    public addChild<T extends MockContainer>(...children: T[]): T {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
      return children[0];
    }

    public removeChild<T extends MockContainer>(child: T): T {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parent = null;
      return child;
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
      this.handlers.set(eventName, handlers.filter((candidate) => candidate !== handler));
      return this;
    }

    public destroy(options?: { children?: boolean }): void {
      this.destroyed = true;
      if (options?.children === true) {
        for (const child of [...this.children]) child.destroy(options);
      }
      this.children.length = 0;
      this.handlers.clear();
      this.parent = null;
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

  class MockSprite extends MockContainer {
    public texture: unknown;
    public width = 0;
    public height = 0;

    public constructor(options: { texture?: unknown }) {
      super();
      this.texture = options.texture;
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
    Sprite: MockSprite,
    Text: MockText,
  };
});

import { createPixiSceneRoot } from "../../src/app/PixiSceneRoot";
import { calculateViewport } from "../../src/app/ViewportService";
import { TitleScene } from "../../src/scenes/title/TitleScene";
import type { TitleSceneView } from "../../src/scenes/title/TitleScene";
import {
  layoutTitleButtons,
  TITLE_BUTTON_RECTS,
  TitleSceneRenderer,
} from "../../src/ui/rendering/TitleSceneRenderer";

function pointerEvent(): FederatedPointerEvent {
  return { stopPropagation: () => undefined } as unknown as FederatedPointerEvent;
}

function collectText(nodes: Array<{ children?: unknown[] }>): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    const candidate = node as { text?: unknown; children?: unknown[] };
    if (typeof candidate.text === "string") result.push(candidate.text);
    if (Array.isArray(candidate.children)) result.push(...collectText(candidate.children as Array<{ children?: unknown[] }>));
  }
  return result;
}

describe("TitleSceneRenderer", () => {
  it("在 screen 层创建完整像素标题构图和两个可触控按钮", () => {
    const root = createPixiSceneRoot();
    const onNewGame = vi.fn();
    const onContinue = vi.fn();
    const renderer = new TitleSceneRenderer({ root, onNewGame, onContinue });
    expect(renderer.layer.visible).toBe(false);
    expect(renderer.continueButton.eventMode).toBe("none");
    expect(renderer.newGameButton.eventMode).toBe("none");
    renderer.continueButton.emit("pointertap", pointerEvent());
    renderer.newGameButton.emit("pointertap", pointerEvent());
    expect(onContinue).not.toHaveBeenCalled();
    expect(onNewGame).not.toHaveBeenCalled();

    renderer.enter({ canContinue: true, busy: false, errorText: null });

    expect(root.screen.children).toHaveLength(1);
    const layer = root.screen.children[0];
    const labels = collectText([layer]);
    expect(labels).toEqual(expect.arrayContaining([
      "像素远征",
      "构筑你的队伍，踏入十层深渊",
      "继续远征",
      "开始新游戏",
      "本地存档 · 自动保存",
    ]));
    expect(renderer.continueButton.eventMode).toBe("static");
    expect(renderer.newGameButton.eventMode).toBe("static");
    expect(renderer.continueButton).toMatchObject({ x: TITLE_BUTTON_RECTS.continue.x, y: TITLE_BUTTON_RECTS.continue.y });
    expect(renderer.newGameButton).toMatchObject({ x: TITLE_BUTTON_RECTS.newGame.x, y: TITLE_BUTTON_RECTS.newGame.y });
    expect(renderer.continueButton.hitArea).toMatchObject({ width: TITLE_BUTTON_RECTS.continue.width, height: TITLE_BUTTON_RECTS.continue.height });
    expect(renderer.newGameButton.hitArea).toMatchObject({ width: TITLE_BUTTON_RECTS.newGame.width, height: TITLE_BUTTON_RECTS.newGame.height });
    expect(TITLE_BUTTON_RECTS.newGame.y - (TITLE_BUTTON_RECTS.continue.y + TITLE_BUTTON_RECTS.continue.height)).toBeGreaterThanOrEqual(9);
    expect(TITLE_BUTTON_RECTS.continue.height * (568 / 640)).toBeGreaterThanOrEqual(48);

    renderer.continueButton.emit("pointertap", pointerEvent());
    renderer.newGameButton.emit("pointertap", pointerEvent());
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onNewGame).toHaveBeenCalledTimes(1);

    renderer.update({ canContinue: false, busy: false, errorText: null });
    expect(renderer.continueButton.eventMode).toBe("none");
    renderer.update({ canContinue: true, busy: true, errorText: "读取失败" });
    expect(renderer.newGameButton.eventMode).toBe("none");
    expect(renderer.errorText.text).toBe("读取失败");
    expect(renderer.errorText.visible).toBe(true);
    renderer.update({ canContinue: true, busy: false, errorText: null });
    expect(renderer.errorText.text).toBe("");
    expect(renderer.errorText.visible).toBe(false);
    expect(labels).toContain("像素远征");

    renderer.destroy();
    expect(root.screen.children).toHaveLength(0);
    expect(() => renderer.destroy()).not.toThrow();
  });

  it("标题按钮组整体平移到安全区，恢复正常视口时回到基准矩形", () => {
    const root = createPixiSceneRoot();
    const narrowSafeViewport = calculateViewport(
      { width: 640, height: 360 },
      { top: 0, right: 340, bottom: 0, left: 0 },
    );
    expect(narrowSafeViewport.blockedReason).toBeNull();
    const expected = layoutTitleButtons(narrowSafeViewport.safeRect);
    const renderer = new TitleSceneRenderer({ root, onNewGame: vi.fn(), onContinue: vi.fn() });

    renderer.setViewport(narrowSafeViewport);
    renderer.enter({ canContinue: true, busy: false, errorText: null });

    expect(renderer.continueButton.x).toBe(expected.continue.x);
    expect(renderer.continueButton.y).toBe(expected.continue.y);
    expect(renderer.newGameButton.x).toBe(expected.newGame.x);
    expect(renderer.newGameButton.y).toBe(expected.newGame.y);
    expect(renderer.continueButton.x + TITLE_BUTTON_RECTS.continue.width)
      .toBeLessThanOrEqual(narrowSafeViewport.safeRect.right);
    expect(renderer.newGameButton.x + TITLE_BUTTON_RECTS.newGame.width)
      .toBeLessThanOrEqual(narrowSafeViewport.safeRect.right);

    const normalViewport = calculateViewport({ width: 640, height: 360 });
    renderer.setViewport(normalViewport);
    expect(renderer.continueButton).toMatchObject({ x: TITLE_BUTTON_RECTS.continue.x, y: TITLE_BUTTON_RECTS.continue.y });
    expect(renderer.newGameButton).toMatchObject({ x: TITLE_BUTTON_RECTS.newGame.x, y: TITLE_BUTTON_RECTS.newGame.y });

    const continueBeforeDestroy = renderer.continueButton.x;
    renderer.destroy();
    renderer.setViewport(narrowSafeViewport);
    expect(renderer.continueButton.x).toBe(continueBeforeDestroy);
  });

  it("接入标题背景时铺满逻辑画布，销毁 Sprite 但保留共享纹理", () => {
    const root = createPixiSceneRoot();
    const backgroundTexture = {} as Texture;
    const renderer = new TitleSceneRenderer({
      root,
      backgroundTexture,
      onNewGame: vi.fn(),
      onContinue: vi.fn(),
    });

    expect(renderer.backgroundSprite).not.toBeNull();
    expect(renderer.backgroundSprite).toMatchObject({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      eventMode: "none",
      texture: backgroundTexture,
    });
    renderer.destroy();
    expect(renderer.backgroundSprite?.destroyed).toBe(true);
  });

  it("通过可选 view 严格转发 TitleScene 生命周期，且 destroy 幂等", async () => {
    const root = createPixiSceneRoot();
    const calls: string[] = [];
    const music = vi.fn();
    const setViewport = vi.fn();
    const view: TitleSceneView = {
      prepare: () => { calls.push("prepare"); },
      enter: () => { calls.push("enter"); },
      update: () => { calls.push("update"); },
      pause: () => { calls.push("pause"); },
      resume: () => { calls.push("resume"); },
      destroy: () => { calls.push("destroy"); },
      setViewport,
    };
    const scene = new TitleScene({
      root,
      audio: { setMusic: music },
      view,
      getViewState: () => ({ canContinue: true, busy: false, errorText: null }),
      createNewGame: async () => ({ ok: false as const, error: { code: "SAVE_FAILED" as const, details: { operation: "create" as const } } }),
    });

    await scene.prepare();
    const viewport = calculateViewport({ width: 640, height: 360 });
    scene.setViewport(viewport);
    scene.enter();
    scene.update();
    scene.pause();
    scene.resume();
    scene.pause();
    await scene.destroy();
    await scene.destroy();

    const callsAfterDestroy = [...calls];
    scene.enter();
    scene.pause();
    scene.resume();
    scene.update();
    scene.setViewport(calculateViewport({ width: 568, height: 320 }));

    expect(calls).toEqual(["prepare", "enter", "update", "pause", "resume", "pause", "destroy"]);
    expect(calls).toEqual(callsAfterDestroy);
    expect(music).toHaveBeenCalledTimes(2);
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport).toHaveBeenCalledWith(viewport);
  });
});
