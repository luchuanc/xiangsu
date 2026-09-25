import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GameApp,
  type AudioServiceLike,
  type GameApplicationLike,
  type GameTickerLike,
} from "../../src/app/GameApp";

class FakeTarget extends EventTarget {}

type FakeViewportTarget = FakeTarget & {
  width: number;
  height: number;
};

class FakeTicker implements GameTickerLike {
  public maxFPS = 60;
  public deltaMS = 0;
  public running = false;
  private readonly listeners = new Set<(ticker: GameTickerLike) => void>();

  public add(listener: (ticker: GameTickerLike) => void): void {
    this.listeners.add(listener);
  }

  public remove(listener: (ticker: GameTickerLike) => void): void {
    this.listeners.delete(listener);
  }

  public start(): void {
    this.running = true;
  }

  public stop(): void {
    this.running = false;
  }

  public emit(deltaMS: number): void {
    this.deltaMS = deltaMS;
    for (const listener of this.listeners) {
      listener(this);
    }
  }
}

class RecordingAudioService implements AudioServiceLike {
  public readonly calls: string[] = [];

  public constructor(private readonly order: string[] = []) {
    // calls 独立记录音频调用，order 额外记录跨布局、输入和音频适配器的顺序。
  }

  public async unlock(): Promise<void> {
    this.record("audio.unlock");
  }

  public async suspend(): Promise<void> {
    this.record("audio.suspend");
  }

  public async resumeIfUnlocked(): Promise<void> {
    this.record("audio.resume");
  }

  public destroy(): void {
    this.record("audio.destroy");
  }

  private record(call: string): void {
    this.calls.push(call);
    this.order.push(call);
  }
}

type HarnessOptions = {
  audioService?: AudioServiceLike;
  fpsMode?: "battery" | "standard" | "high";
  order?: string[];
  restoreContextResources?: () => Promise<void>;
  onDroppedTime?: (info: {
    frameDeltaMs: number;
    droppedMs: number;
    steps: number;
  }) => void;
};

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(options: HarnessOptions = {}) {
  const order = options.order ?? [];
  const windowTarget = new FakeTarget() as FakeTarget & {
    visualViewport: FakeViewportTarget;
    innerWidth: number;
    innerHeight: number;
  };
  const visualViewportTarget = new FakeTarget() as FakeViewportTarget;
  visualViewportTarget.width = 640;
  visualViewportTarget.height = 360;
  windowTarget.visualViewport = visualViewportTarget;
  windowTarget.innerWidth = 640;
  windowTarget.innerHeight = 360;
  vi.stubGlobal("window", windowTarget);
  const documentTarget = new FakeTarget() as FakeTarget & {
    visibilityState: DocumentVisibilityState;
    defaultView: null;
  };
  documentTarget.visibilityState = "visible";
  documentTarget.defaultView = null;
  const root = {
    ownerDocument: documentTarget,
    insertBefore: vi.fn(),
    appendChild: vi.fn(),
  } as unknown as HTMLElement & {
    ownerDocument: typeof documentTarget;
    insertBefore: ReturnType<typeof vi.fn>;
    appendChild: ReturnType<typeof vi.fn>;
  };

  const placeholder = { parentNode: root } as unknown as HTMLElement;
  const canvas = new FakeTarget() as FakeTarget & {
    style: CSSStyleDeclaration;
  };
  canvas.style = {} as CSSStyleDeclaration;
  const ticker = new FakeTicker();
  const events = {
    setTargetElement: vi.fn((element: HTMLCanvasElement | null) => {
      order.push(element === null ? "events.detach" : "events.attach");
    }),
  };
  const app: GameApplicationLike = {
    stage: {},
    canvas: canvas as unknown as HTMLCanvasElement,
    ticker,
    renderer: {
      resize: vi.fn(() => order.push("layout")),
      events,
    },
    init: vi.fn(async () => undefined),
    render: vi.fn(() => order.push("render")),
    start: vi.fn(() => ticker.start()),
    stop: vi.fn(() => ticker.stop()),
    destroy: vi.fn(),
  };
  const overlay = {
    update: vi.fn(),
    destroy: vi.fn(),
  };
  const fixedUpdates: number[] = [];
  const clearPointer = vi.fn();
  const inputState: boolean[] = [];
  const audio = options.audioService ?? new RecordingAudioService(order);
  let viewport = { width: 640, height: 360 };
  const gameApp = new GameApp({
    gameRoot: root,
    placeholder,
    application: app,
    overlay: overlay as never,
    audioService: audio,
    registerPixiExtensions: async () => undefined,
    layerFactory: () => undefined,
    restoreContextResources: options.restoreContextResources,
    viewportProvider: () => ({
      ...viewport,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    }),
    onFixedUpdate: (deltaMs) => fixedUpdates.push(deltaMs),
    onDroppedTime: options.onDroppedTime,
    onInputEnabled: (enabled) => {
      inputState.push(enabled);
      order.push(enabled ? "input.enable" : "input.disable");
    },
    onClearPointerState: clearPointer,
    fpsMode: options.fpsMode,
  });

  return {
    app,
    audio,
    canvas,
    clearPointer,
    documentTarget,
    fixedUpdates,
    gameApp,
    inputState,
    order,
    overlay,
    root,
    setViewport(next: { width: number; height: number }) {
      viewport = next;
    },
    ticker,
    events,
    visualViewportTarget,
  };
}

type MainApplicationDouble = {
  stage: object;
  canvas: HTMLCanvasElement;
  init: ReturnType<typeof vi.fn>;
};

type MainRuntimeDouble = {
  options: unknown;
  start: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

/**
 * 只替换 Pixi Application 和 GameApp 适配器，保留 main.ts 的 stage 分支与 singleton 状态。
 * 通过先在无 document 环境加载模块，避免 main.ts 文件末尾的自动启动干扰显式 bootstrap。
 */
async function loadMainWithStageDoubles(options: { initFailures?: Error[] } = {}) {
  await vi.resetModules();
  const initFailures = [...(options.initFailures ?? [])];
  const applications: MainApplicationDouble[] = [];
  const runtimes: MainRuntimeDouble[] = [];

  class FakePixiApplication {
    public readonly stage = {};
    public readonly canvas = new FakeTarget() as unknown as HTMLCanvasElement;
    public readonly init = vi.fn(async () => {
      const failure = initFailures.shift();
      if (failure) {
        throw failure;
      }
    });

    public constructor() {
      applications.push(this as unknown as MainApplicationDouble);
    }
  }

  class FakeGameApp {
    public readonly start = vi.fn(async () => {
      const application = (this.options as { application: MainApplicationDouble }).application;
      await application.init({});
    });
    public readonly destroy = vi.fn(() => undefined);

    public constructor(public readonly options: unknown) {
      runtimes.push(this as unknown as MainRuntimeDouble);
    }
  }

  vi.doMock("pixi.js", () => ({ Application: FakePixiApplication }));
  vi.doMock("../../src/app/GameApp", () => ({ GameApp: FakeGameApp }));

  // main.ts 在无 document 时不会触发文件末尾的自动启动。
  const main = await import("../../src/main");
  const placeholder = {};
  const gameRoot = {
    insertBefore: vi.fn(),
  };
  const documentTarget = {
    querySelector: vi.fn((selector: string) => {
      if (selector === "#game-root") {
        return gameRoot;
      }
      if (selector === "#startup-placeholder") {
        return placeholder;
      }
      return null;
    }),
  };
  vi.stubGlobal("document", documentTarget);

  return { applications, documentTarget, gameRoot, main, placeholder, runtimes };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("pixi.js");
  vi.doUnmock("../../src/app/GameApp");
});

describe("GameApp lifecycle", () => {
  it("发布不可变 viewport，监听 window 与 visualViewport resize，并在取消订阅/销毁后停止回调", async () => {
    const harness = createHarness();
    const emitted: unknown[] = [];
    const unsubscribe = harness.gameApp.subscribeViewport((viewport) => emitted.push(viewport));

    await harness.gameApp.start();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toBe(harness.gameApp.lastViewport);
    expect(Object.isFrozen(emitted[0])).toBe(true);
    expect(Object.isFrozen((emitted[0] as { safeRect: object }).safeRect)).toBe(true);

    harness.setViewport({ width: 568, height: 320 });
    window.dispatchEvent(new Event("resize"));
    await flushAsync();
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toBe(harness.gameApp.lastViewport);
    expect((emitted[1] as { safeRect: { width: number } }).safeRect.width).toBe(640);

    harness.setViewport({ width: 844, height: 390 });
    harness.visualViewportTarget.dispatchEvent(new Event("resize"));
    await flushAsync();
    expect(emitted).toHaveLength(3);
    expect(emitted[2]).toBe(harness.gameApp.lastViewport);

    unsubscribe();
    harness.setViewport({ width: 640, height: 360 });
    window.dispatchEvent(new Event("resize"));
    await flushAsync();
    expect(emitted).toHaveLength(3);

    harness.gameApp.destroy();
    harness.setViewport({ width: 568, height: 320 });
    window.dispatchEvent(new Event("resize"));
    harness.visualViewportTarget.dispatchEvent(new Event("resize"));
    await flushAsync();
    expect(emitted).toHaveLength(3);
  });

  it("已有 viewport 的立即回放隔离 listener 异常并仍返回可用取消订阅", async () => {
    const harness = createHarness();
    await harness.gameApp.start();
    const failing = vi.fn(() => { throw new Error("listener failed"); });
    let unsubscribe: (() => void) | undefined;
    expect(() => {
      unsubscribe = harness.gameApp.subscribeViewport(failing);
    }).not.toThrow();
    expect(failing).toHaveBeenCalledTimes(1);
    unsubscribe?.();
    harness.setViewport({ width: 568, height: 320 });
    window.dispatchEvent(new Event("resize"));
    await flushAsync();
    expect(failing).toHaveBeenCalledTimes(1);
    harness.gameApp.destroy();
  });

  it("只读暴露当前输入允许态", async () => {
    const harness = createHarness();
    expect(harness.gameApp.isInputEnabled).toBe(false);
    await harness.gameApp.start();
    expect(harness.gameApp.isInputEnabled).toBe(true);
    harness.documentTarget.visibilityState = "hidden";
    harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(harness.gameApp.isInputEnabled).toBe(false);
    harness.gameApp.destroy();
  });

  it("blocked/hidden/context-lost resize 仍发布布局但不重新启用输入", async () => {
    const harness = createHarness();
    const emitted: unknown[] = [];
    harness.gameApp.subscribeViewport((viewport) => emitted.push(viewport));
    await harness.gameApp.start();
    expect(emitted).toHaveLength(1);

    harness.setViewport({ width: 320, height: 568 });
    window.dispatchEvent(new Event("resize"));
    await flushAsync();
    expect(emitted).toHaveLength(2);
    expect(harness.gameApp.lifecycleState).toBe("blocked");
    expect(harness.inputState).toEqual([true, false]);

    harness.documentTarget.visibilityState = "hidden";
    harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
    harness.setViewport({ width: 640, height: 360 });
    window.dispatchEvent(new Event("resize"));
    await flushAsync();
    expect(emitted).toHaveLength(3);
    expect(harness.gameApp.lifecycleState).toBe("hidden");
    expect(harness.inputState).toEqual([true, false]);

    harness.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    harness.setViewport({ width: 844, height: 390 });
    window.dispatchEvent(new Event("resize"));
    await flushAsync();
    expect(emitted).toHaveLength(4);
    expect(harness.gameApp.lifecycleState).toBe("contextLost");
    expect(harness.inputState).toEqual([true, false]);
    harness.gameApp.destroy();
  });

  it("重复 start 只初始化一次，fixed-step 恢复时从零开始", async () => {
    const harness = createHarness();
    await Promise.all([harness.gameApp.start(), harness.gameApp.start()]);

    expect(harness.app.init).toHaveBeenCalledTimes(1);
    expect(harness.app.render).toHaveBeenCalledTimes(1);
    expect(harness.ticker.maxFPS).toBe(60);
    expect(harness.inputState).toEqual([true]);
    expect(harness.canvas.style.pointerEvents).toBe("auto");

    harness.ticker.emit(50);
    expect(harness.fixedUpdates).toHaveLength(3);

    harness.documentTarget.visibilityState = "hidden";
    harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(harness.ticker.running).toBe(false);
    expect(harness.clearPointer).toHaveBeenCalledTimes(1);
    expect(harness.canvas.style.pointerEvents).toBe("none");
    expect(harness.events.setTargetElement).toHaveBeenLastCalledWith(null);
    const updatesWhileHidden = harness.fixedUpdates.length;
    harness.ticker.emit(50);
    expect(harness.fixedUpdates).toHaveLength(updatesWhileHidden);

    harness.documentTarget.visibilityState = "visible";
    harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();
    expect(harness.app.render).toHaveBeenCalledTimes(2);
    expect(harness.inputState).toEqual([true, false, true]);
    expect(harness.canvas.style.pointerEvents).toBe("auto");
    expect(harness.events.setTargetElement).toHaveBeenLastCalledWith(harness.canvas);
    expect(harness.audio).toBeInstanceOf(RecordingAudioService);
    expect((harness.audio as RecordingAudioService).calls).toEqual([
      "audio.suspend",
      "audio.resume",
    ]);
    harness.ticker.emit(1000 / 60);
    expect(harness.fixedUpdates).toHaveLength(updatesWhileHidden + 1);
  });

  it("省电档固定 30FPS，约 33.33ms 会执行两个 fixed step", async () => {
    const harness = createHarness({ fpsMode: "battery" });
    await harness.gameApp.start();

    expect(harness.ticker.maxFPS).toBe(30);
    harness.ticker.emit(1000 / 30);
    expect(harness.fixedUpdates).toHaveLength(2);
  });

  it("单帧超过 50ms 时最多追赶三步并记录丢弃时间", async () => {
    const dropped: Array<{ frameDeltaMs: number; droppedMs: number; steps: number }> = [];
    const harness = createHarness({
      fpsMode: "battery",
      onDroppedTime: (info) => dropped.push(info),
    });

    await harness.gameApp.start();
    expect(harness.ticker.maxFPS).toBe(30);
    harness.ticker.emit(100);
    expect(harness.fixedUpdates).toHaveLength(3);
    expect(dropped).toEqual([{ frameDeltaMs: 100, droppedMs: 50, steps: 3 }]);
  });

  it("页面初始 hidden 时暂停 ticker、音频和 canvas 输入，恢复按顺序启用", async () => {
    const harness = createHarness();
    harness.documentTarget.visibilityState = "hidden";
    await harness.gameApp.start();
    await flushAsync();

    expect(harness.gameApp.lifecycleState).toBe("hidden");
    expect(harness.ticker.running).toBe(false);
    expect(harness.inputState).toEqual([]);
    expect(harness.canvas.style.pointerEvents).toBe("none");
    expect(harness.events.setTargetElement).toHaveBeenCalledWith(null);
    expect((harness.audio as RecordingAudioService).calls).toEqual(["audio.suspend"]);

    harness.documentTarget.visibilityState = "visible";
    harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();

    expect(harness.gameApp.lifecycleState).toBe("running");
    expect(harness.order.slice(-5)).toEqual([
      "layout",
      "render",
      "events.attach",
      "input.enable",
      "audio.resume",
    ]);
    expect(harness.canvas.style.pointerEvents).toBe("auto");
  });

  it("竖屏和过小横屏进入门禁时暂停音频并阻断输入", async () => {
    const harness = createHarness();
    harness.setViewport({ width: 320, height: 568 });
    await harness.gameApp.start();
    expect(harness.gameApp.lifecycleState).toBe("blocked");
    expect(harness.inputState).toEqual([]);
    expect(harness.overlay.update).toHaveBeenCalledWith({ state: "rotate", reason: "portrait" });
    expect((harness.audio as RecordingAudioService).calls).toEqual(["audio.suspend"]);
    expect(harness.events.setTargetElement).toHaveBeenCalledWith(null);
    expect(harness.canvas.style.pointerEvents).toBe("none");

    harness.setViewport({ width: 567, height: 320 });
    window.dispatchEvent(new Event("resize"));
    await flushAsync();
    expect(harness.overlay.update).toHaveBeenLastCalledWith({
      state: "tooSmall",
      reason: "tooSmall",
    });
    expect((harness.audio as RecordingAudioService).calls).toEqual([
      "audio.suspend",
      "audio.suspend",
    ]);
    expect(harness.canvas.style.pointerEvents).toBe("none");
    harness.gameApp.destroy();
    expect(harness.app.destroy).toHaveBeenCalledTimes(1);
    expect(harness.overlay.destroy).toHaveBeenCalledTimes(1);
  });

  it("blocked 恢复严格按 layout、render、input、audio 顺序执行，hidden 不恢复音频", async () => {
    const harness = createHarness();
    harness.setViewport({ width: 320, height: 568 });
    await harness.gameApp.start();

    harness.order.length = 0;
    harness.setViewport({ width: 640, height: 360 });
    window.dispatchEvent(new Event("resize"));
    await flushAsync();

    expect(harness.gameApp.lifecycleState).toBe("running");
    expect(harness.order).toEqual([
      "layout",
      "render",
      "events.attach",
      "input.enable",
      "audio.resume",
    ]);

    const hiddenHarness = createHarness();
    await hiddenHarness.gameApp.start();
    hiddenHarness.canvas.dispatchEvent(new Event("pointerdown"));
    await flushAsync();
    hiddenHarness.documentTarget.visibilityState = "hidden";
    hiddenHarness.documentTarget.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();

    hiddenHarness.setViewport({ width: 320, height: 568 });
    window.dispatchEvent(new Event("resize"));
    await flushAsync();
    expect(hiddenHarness.gameApp.lifecycleState).toBe("blocked");

    hiddenHarness.setViewport({ width: 640, height: 360 });
    window.dispatchEvent(new Event("resize"));
    await flushAsync();

    expect(hiddenHarness.gameApp.lifecycleState).toBe("blocked");
    expect(hiddenHarness.audio).toBeInstanceOf(RecordingAudioService);
    expect((hiddenHarness.audio as RecordingAudioService).calls).toEqual([
      "audio.unlock",
      "audio.suspend",
      "audio.suspend",
    ]);
    expect((hiddenHarness.audio as RecordingAudioService).calls).not.toContain("audio.resume");
    expect(hiddenHarness.canvas.style.pointerEvents).toBe("none");

    // 后台已经完成合法 resize，但仍不可恢复音频；可见事件才触发最终恢复。
    hiddenHarness.order.length = 0;
    hiddenHarness.documentTarget.visibilityState = "visible";
    hiddenHarness.documentTarget.dispatchEvent(new Event("visibilitychange"));
    await flushAsync();

    expect(hiddenHarness.gameApp.lifecycleState).toBe("running");
    expect(hiddenHarness.order).toEqual([
      "layout",
      "render",
      "events.attach",
      "input.enable",
      "audio.resume",
    ]);
    expect((hiddenHarness.audio as RecordingAudioService).calls).toEqual([
      "audio.unlock",
      "audio.suspend",
      "audio.suspend",
      "audio.resume",
    ]);
  });

  it("context lost 会 suspend，恢复资源后按顺序恢复并重新挂回 Pixi 事件", async () => {
    let restoreCalls = 0;
    const harness = createHarness({
      restoreContextResources: async () => {
        restoreCalls += 1;
      },
    });
    await harness.gameApp.start();
    const lost = new Event("webglcontextlost", { cancelable: true });
    harness.canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(harness.gameApp.lifecycleState).toBe("contextLost");
    expect(harness.ticker.running).toBe(false);
    expect(harness.canvas.style.pointerEvents).toBe("none");
    expect((harness.audio as RecordingAudioService).calls).toEqual(["audio.suspend"]);
    harness.canvas.dispatchEvent(new Event("webglcontextrestored"));
    await flushAsync();
    expect(restoreCalls).toBe(1);
    expect(harness.gameApp.lifecycleState).toBe("running");
    expect(harness.order.slice(-5)).toEqual([
      "layout",
      "render",
      "events.attach",
      "input.enable",
      "audio.resume",
    ]);
    expect(harness.events.setTargetElement).toHaveBeenCalledWith(null);
    expect(harness.events.setTargetElement).toHaveBeenCalledWith(harness.canvas);
    expect((harness.audio as RecordingAudioService).calls).toEqual([
      "audio.suspend",
      "audio.resume",
    ]);
  });

  it("context restore 失败进入 fatal 且不恢复输入和音频", async () => {
    const failedHarness = createHarness({
      restoreContextResources: async () => {
        throw new Error("restore failed");
      },
    });
    await failedHarness.gameApp.start();
    failedHarness.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    failedHarness.canvas.dispatchEvent(new Event("webglcontextrestored"));
    await flushAsync();
    expect(failedHarness.gameApp.lifecycleState).toBe("fatal");
    expect(failedHarness.overlay.update).toHaveBeenLastCalledWith({
      state: "fatal",
      reason: "context_restore_failed",
    });
    expect(failedHarness.ticker.running).toBe(false);
    expect(failedHarness.canvas.style.pointerEvents).toBe("none");
    expect(failedHarness.events.setTargetElement).toHaveBeenCalledWith(null);
    expect((failedHarness.audio as RecordingAudioService).calls).toEqual([
      "audio.suspend",
    ]);
  });
});

describe("main stage singleton lifecycle", () => {
  it("真实 stage 分支并发 bootstrap 只创建并启动一次 Application", async () => {
    const harness = await loadMainWithStageDoubles();

    await Promise.all([harness.main.bootstrap(), harness.main.bootstrap()]);

    expect(harness.applications).toHaveLength(1);
    expect(harness.applications[0].init).toHaveBeenCalledTimes(1);
    expect(harness.runtimes).toHaveLength(1);
    expect(harness.runtimes[0].start).toHaveBeenCalledTimes(1);
    expect(harness.runtimes[0].options).toMatchObject({
      application: harness.applications[0],
    });

    harness.main.destroyApplication();
    expect(harness.runtimes[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("真实 stage 分支初始化失败后允许显式重试", async () => {
    const harness = await loadMainWithStageDoubles({
      initFailures: [new Error("初始化失败")],
    });

    await expect(harness.main.bootstrap()).rejects.toThrow("初始化失败");
    expect(harness.applications).toHaveLength(1);
    expect(harness.runtimes).toHaveLength(1);
    expect(harness.runtimes[0].start).toHaveBeenCalledTimes(1);

    await expect(harness.main.bootstrap()).resolves.toBeUndefined();
    expect(harness.applications).toHaveLength(2);
    expect(harness.applications[1].init).toHaveBeenCalledTimes(1);
    expect(harness.runtimes).toHaveLength(2);
    expect(harness.runtimes[1].start).toHaveBeenCalledTimes(1);

    harness.main.destroyApplication();
  });

  it("destroyApplication 后再次 bootstrap 会创建干净的 Application", async () => {
    const harness = await loadMainWithStageDoubles();

    await harness.main.bootstrap();
    harness.main.destroyApplication();
    await harness.main.bootstrap();

    expect(harness.applications).toHaveLength(2);
    expect(harness.applications[0].init).toHaveBeenCalledTimes(1);
    expect(harness.applications[1].init).toHaveBeenCalledTimes(1);
    expect(harness.runtimes).toHaveLength(2);
    expect(harness.runtimes[0].destroy).toHaveBeenCalledTimes(1);
    expect(harness.runtimes[1].start).toHaveBeenCalledTimes(1);

    harness.main.destroyApplication();
  });
});
