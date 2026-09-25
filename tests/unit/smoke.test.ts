import { afterEach, describe, expect, it, vi } from "vitest";

const pixiMock = vi.hoisted(() => {
  const init = vi.fn<(options: unknown) => Promise<void>>();
  const render = vi.fn<() => void>();
  const canvas = { tagName: "CANVAS" } as unknown as HTMLCanvasElement;

  class Application {
    public readonly canvas = canvas;

    public init(options: unknown): Promise<void> {
      return init(options);
    }

    public render(): void {
      render();
    }
  }

  return { Application, canvas, init, render };
});

vi.mock("pixi.js", () => ({ Application: pixiMock.Application }));

import {
  STARTUP_PLACEHOLDER_ID,
  startApplication,
} from "../../src/main";

type FakePlaceholder = {
  setAttribute: ReturnType<typeof vi.fn>;
  textContent: string;
};

function installFakeDocument() {
  const placeholder: FakePlaceholder = {
    setAttribute: vi.fn(),
    textContent: "像素远征 · 工程占位",
  };
  const gameRoot = { insertBefore: vi.fn() };
  const querySelector = vi.fn((selector: string) => {
    if (selector === "#game-root") {
      return gameRoot;
    }

    if (selector === `#${STARTUP_PLACEHOLDER_ID}`) {
      return placeholder;
    }

    return null;
  });

  vi.stubGlobal("document", { querySelector });

  return { gameRoot, placeholder };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("工程启动行为", () => {
  it("仅在 Pixi 初始化完成后插入 canvas 并渲染", async () => {
    const { gameRoot, placeholder } = installFakeDocument();
    let resolveInit!: () => void;
    const initPromise = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });
    pixiMock.init.mockReturnValueOnce(initPromise);

    const startPromise = startApplication();

    await vi.waitFor(() => {
      expect(pixiMock.init).toHaveBeenCalledTimes(1);
    });
    expect(pixiMock.init).toHaveBeenCalledWith({
      width: 640,
      height: 360,
      preference: "webgl",
      antialias: false,
      backgroundAlpha: 1,
      autoDensity: true,
      resolution: 1,
      sharedTicker: false,
      autoStart: false,
    });
    expect(gameRoot.insertBefore).not.toHaveBeenCalled();
    expect(pixiMock.render).not.toHaveBeenCalled();

    resolveInit();
    await startPromise;

    expect(gameRoot.insertBefore).toHaveBeenCalledWith(
      pixiMock.canvas,
      placeholder,
    );
    expect(pixiMock.render).toHaveBeenCalledTimes(1);
  });

  it("Pixi 初始化失败时显示失败状态且不向外抛出 rejection", async () => {
    const { gameRoot, placeholder } = installFakeDocument();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    pixiMock.init.mockRejectedValueOnce(new Error("WebGL 初始化失败"));

    await expect(startApplication()).resolves.toBeUndefined();

    expect(gameRoot.insertBefore).not.toHaveBeenCalled();
    expect(pixiMock.render).not.toHaveBeenCalled();
    expect(placeholder.textContent).toBe("启动失败，请刷新重试");
    expect(placeholder.setAttribute).toHaveBeenCalledWith(
      "data-status",
      "error",
    );
    expect(consoleError).not.toHaveBeenCalled();
  });
});
