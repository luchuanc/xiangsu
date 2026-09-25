import { assetUrl } from "./app/assetUrl";
import type { ApplicationOptions } from "pixi.js";
import type { GameApplicationLike } from "./app/GameApp";
import { floors06To10AssetManifest } from "./content/data/assets.manifest";
import type { GameFlowRuntimeLike } from "./app/GameFlowController";

export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 360;
export const STARTUP_PLACEHOLDER_ID = "startup-placeholder";
export const BOOT_FAILURE_TEXT = "启动失败，请刷新重试";

type DestroyableApplication = {
  destroy(): void;
};

type DestroyableFlow = {
  destroy(): void;
};

let activeApplication: DestroyableApplication | null = null;
let activeFlow: DestroyableFlow | null = null;
let startInFlight: Promise<void> | null = null;
let destroyRequested = false;

/**
 * 返回工程基线固定的 PixiJS 初始化参数，后续场景只在此逻辑画布内布局。
 */
export function createApplicationOptions(): Partial<ApplicationOptions> {
  return {
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    preference: "webgl",
    antialias: false,
    backgroundAlpha: 1,
    autoDensity: true,
    resolution: 1,
    sharedTicker: false,
    autoStart: false,
  };
}

/**
 * 初始化 PixiJS 并把画布挂载到固定的游戏根节点；初始化完成前不读取 canvas 或 renderer。
 */
export async function bootstrap(): Promise<void> {
  if (activeApplication !== null) {
    return;
  }
  if (startInFlight !== null) {
    return startInFlight;
  }

  const gameRoot = document.querySelector<HTMLDivElement>("#game-root");
  const placeholder = document.querySelector<HTMLDivElement>(
    `#${STARTUP_PLACEHOLDER_ID}`,
  );

  if (!gameRoot || !placeholder) {
    throw new Error("游戏根节点或启动占位不存在");
  }

  const promise = (async () => {
    // 延迟加载 PixiJS，保证纯 Node 单测只验证启动契约，不提前触发浏览器环境探测。
    const { Application } = await import("pixi.js");
    const app = new Application() as unknown as {
      stage?: unknown;
      init(options: Partial<ApplicationOptions>): Promise<void>;
      canvas: HTMLCanvasElement;
      render(): void;
    };

    // RPG-001 的最小 mock 没有 stage；保留它的公开启动契约，真实 Pixi v8 走 GameApp。
    if (!("stage" in app)) {
      await app.init(createApplicationOptions());

      // 画布在 init 完成后才可访问，放在占位层之前以保留占位文案的可见性。
      gameRoot.insertBefore(app.canvas, placeholder);
      app.render();
      return;
    }

    const { GameApp } = await import("./app/GameApp");
    const { invalidatePixiTextTextures } = await import("./app/PixiTextRecovery");
    const runtime = new GameApp({
      gameRoot,
      placeholder,
      application: app as unknown as GameApplicationLike,
      // 正式入口使用累计到第 10 层的资源清单，首层地图/战斗资源包含在其中。
      // GameApp 未传该选项时仍保留 fixture 默认值，Node fake 测试不受影响。
      assetManifest: floors06To10AssetManifest,
      assetManifestMode: "final",
      // 文字源 Canvas 已被 Pixi 回收，恢复时必须先失效 GPU 缓存再渲染。
      rebuildSceneFromStore: () => invalidatePixiTextTextures(app.stage),
    });
    let flow: { destroy(): void } | null = null;
    try {
      await runtime.start();
      // RPG-001 的 fake GameApp 没有真实路由/资源服务，只验证 Pixi 启动契约；
      // 只有生产 runtime 暴露完整依赖时才接入可玩主流程。
      const runtimeAdapter = runtime as unknown as {
        readonly sceneRouter?: unknown;
        readonly assetService?: unknown;
      };
      if (runtimeAdapter.sceneRouter !== null && runtimeAdapter.sceneRouter !== undefined
        && runtimeAdapter.assetService !== null && runtimeAdapter.assetService !== undefined) {
        const { GameFlowController } = await import("./app/GameFlowController");
        const { Assets } = await import("pixi.js");
        const titleBackgroundTexture = await Assets.load<import("pixi.js").Texture>(assetUrl("/assets/art/interface-premium/v1/town-title.png"));
        const controller = new GameFlowController({ runtime: runtime as unknown as GameFlowRuntimeLike, gameRoot, titleBackgroundTexture });
        flow = controller;
        await controller.start();
        if (destroyRequested) {
          controller.destroy();
          flow = null;
          runtime.destroy();
          destroyRequested = false;
          return;
        }
        activeFlow = flow;
      }
      activeApplication = runtime;
    } catch (error) {
      flow?.destroy();
      runtime.destroy();
      destroyRequested = false;
      throw error;
    }
  })();

  startInFlight = promise;
  try {
    await promise;
  } finally {
    if (startInFlight === promise) {
      startInFlight = null;
    }
  }
}

/**
 * 销毁当前 Pixi 实例并清理 singleton，使下一次显式启动创建干净实例。
 */
export function destroyApplication(): void {
  destroyRequested = true;
  activeFlow?.destroy();
  activeFlow = null;
  activeApplication?.destroy();
  activeApplication = null;
  if (startInFlight === null) {
    destroyRequested = false;
  }
}

/**
 * 统一收口入口启动失败，避免异步入口产生未处理 rejection，并把失败状态留在可见占位层。
 */
export async function startApplication(): Promise<void> {
  try {
    await bootstrap();
  } catch {
    const placeholder = document.querySelector<HTMLDivElement>(
      `#${STARTUP_PLACEHOLDER_ID}`,
    );

    if (placeholder) {
      placeholder.textContent = BOOT_FAILURE_TEXT;
      placeholder.setAttribute("data-status", "error");
    }
  }
}

if (typeof document !== "undefined") {
  void startApplication();
}
