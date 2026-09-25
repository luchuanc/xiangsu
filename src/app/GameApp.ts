import type { ApplicationOptions } from "pixi.js";
import { AudioService } from "./AudioService";
import { AssetCatalog } from "./AssetCatalog";
import { AssetService, type AssetServiceOptions } from "./AssetService";
import {
  candidateAssetManifest,
  type AssetManifestV1,
} from "../content/data/assets.manifest";
import {
  DomSystemOverlay,
  type SystemOverlayState,
  type SystemOverlayUpdate,
} from "./DomSystemOverlay";
import {
  type SafeAreaInsets,
  type ViewportResult,
  ViewportService,
} from "./ViewportService";
import type { SceneRootLike } from "./Scene";
import type { SceneRouter, SceneStageLike } from "./SceneRouter";
import type { BootScene } from "../scenes/boot/BootScene";
import { createApplicationOptions } from "../main";
import { applyQualityPreset } from "./QualityPreset";
import type { DomainErrorV1 } from "../domain/common/DomainResult";

export interface GameTickerLike {
  maxFPS: number;
  deltaMS?: number;
  add(listener: (ticker: GameTickerLike) => void): unknown;
  remove(listener: (ticker: GameTickerLike) => void): unknown;
  start?(): void;
  stop?(): void;
}

export interface GameRendererLike {
  resize?(width: number, height: number): void;
  /** Pixi v8 EventSystem 的公开挂载接口，用于暂停时断开原生指针监听。 */
  events?: {
    setTargetElement?(element: HTMLCanvasElement | null): void;
  };
  /** Pixi prepare 副作用扩展；通过小接口避免 Node fake 依赖真实 renderer。 */
  prepare?: {
    upload?(resource: unknown): void | Promise<void>;
  };
}

export interface GameApplicationLike {
  readonly stage: unknown;
  readonly canvas: HTMLCanvasElement;
  readonly ticker: GameTickerLike;
  readonly renderer: GameRendererLike;
  init(options: Partial<ApplicationOptions>): Promise<void>;
  render(): void;
  start?(): void;
  stop?(): void;
  destroy(rendererOptions?: unknown, stageOptions?: unknown): void;
}

/** Pixi prepare 在部分移动浏览器可能永不完成；资源本体已成功加载时允许安全降级。 */
export const PREPARE_UPLOAD_TIMEOUT_MS = 1_000;

export type ApplicationFactory = () => GameApplicationLike | Promise<GameApplicationLike>;
export type LayerFactory = (stage: unknown) => unknown | Promise<unknown>;

export interface AudioServiceLike {
  unlock(): Promise<void>;
  suspend(): Promise<void>;
  resumeIfUnlocked(): Promise<void>;
  destroy(): void;
}

export interface SystemOverlayLike {
  update(update: SystemOverlayUpdate): void;
  destroy(): void;
}

export interface ErrorOverlayLike {
  show(error: DomainErrorV1): void;
  hide?(): void;
  destroy?(): void;
}

export interface ViewportServiceLike {
  calculate(
    size: { width: number; height: number },
    safeArea?: SafeAreaInsets,
  ): ViewportResult;
}

export type ViewportListener = (viewport: ViewportResult) => void;

export interface AssetServiceLike {
  restoreLoadedBundles(): Promise<void>;
  acquire?(bundleId: string): Promise<unknown>;
  getReferenceCount?(bundleId: string): number;
  getLoadedBundleIds?(): readonly string[];
  getLoadedResource?(bundleId: string): unknown | undefined;
  destroy?(): void | Promise<void>;
}

export interface GameViewportInput {
  width: number;
  height: number;
  safeArea: SafeAreaInsets;
}

export interface GameAppOptions {
  gameRoot: HTMLElement;
  placeholder?: HTMLElement | null;
  application?: GameApplicationLike;
  applicationFactory?: ApplicationFactory;
  overlay?: SystemOverlayLike;
  errorOverlay?: ErrorOverlayLike;
  audioService?: AudioServiceLike;
  assetService?: AssetServiceLike;
  viewportService?: ViewportServiceLike;
  viewportProvider?: () => GameViewportInput;
  layerFactory?: LayerFactory;
  registerPixiExtensions?: () => Promise<void>;
  restoreContextResources?: () => Promise<void>;
  rebuildSceneFromStore?: () => void | Promise<void>;
  onFixedUpdate?: (deltaMs: number) => void;
  /** 运行时主流程在启动后接管同一 fixed-step；不另开渲染计时器。 */
  assetManifest?: AssetManifestV1;
  assetManifestMode?: "fixture" | "final" | { kind: "batch"; batchId: "verticalSlice" | "floors02_05" | "floors06_10" | "abyssEchoes" };
  onDroppedTime?: (info: { frameDeltaMs: number; droppedMs: number; steps: number }) => void;
  onInputEnabled?: (enabled: boolean) => void;
  onClearPointerState?: () => void;
  fpsMode?: "battery" | "standard" | "high";
}

export type GameAppLifecycleState =
  | "created"
  | "initializing"
  | "running"
  | "blocked"
  | "hidden"
  | "contextLost"
  | "recovering"
  | "fatal"
  | "destroyed";

export const FIXED_STEP_MS = 1000 / 60;
export const MAX_FRAME_DELTA_MS = 50;
export const MAX_CATCH_UP_STEPS = 3;

function defaultApplicationFactory(): Promise<GameApplicationLike> {
  return import("pixi.js").then(({ Application }) => {
    return new Application() as unknown as GameApplicationLike;
  });
}

async function registerDefaultPixiExtensions(): Promise<void> {
  const pixi = await import("pixi.js");
  if (pixi.extensions && pixi.CullerPlugin) {
    pixi.extensions.add(pixi.CullerPlugin);
  }
  // prepare 是 Pixi v8 的副作用扩展，供后续资源层在转场前预上传。
  // Pixi v8 暴露该副作用入口但当前包缺少独立声明文件；保留字面量让 Vite 正确打包它。
  // @ts-expect-error 该入口由 pixi.js package exports 提供，类型包未声明子路径。
  await import("pixi.js/prepare");
}

function defaultLayerFactory(stage: unknown): Promise<unknown> {
  return import("./PixiRootLayers").then(({ createPixiRootLayers }) => {
    return createPixiRootLayers(stage as Parameters<typeof createPixiRootLayers>[0]);
  });
}

function defaultViewportProvider(root: HTMLElement): GameViewportInput {
  const browserWindow = typeof window === "undefined" ? undefined : window;
  const visualViewport = browserWindow?.visualViewport;
  const width = visualViewport?.width ?? browserWindow?.innerWidth ?? root.clientWidth;
  const height = visualViewport?.height ?? browserWindow?.innerHeight ?? root.clientHeight;
  const computedStyle = root.ownerDocument.defaultView?.getComputedStyle(root);
  const readInset = (name: string): number => {
    const raw = computedStyle?.getPropertyValue(name).trim() ?? "";
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  return {
    width,
    height,
    safeArea: {
      top: readInset("--safe-area-inset-top"),
      right: readInset("--safe-area-inset-right"),
      bottom: readInset("--safe-area-inset-bottom"),
      left: readInset("--safe-area-inset-left"),
    },
  };
}

function overlayStateForViewport(result: ViewportResult): SystemOverlayState | null {
  if (result.blockedReason === "portrait") {
    return "rotate";
  }
  if (result.blockedReason === "tooSmall") {
    return "tooSmall";
  }
  return null;
}

function sceneMountFromLayers(layers: unknown, fallbackStage: unknown): SceneStageLike {
  if (layers !== null && typeof layers === "object") {
    const candidate = (layers as { sceneRoot?: unknown }).sceneRoot;
    if (candidate !== null && typeof candidate === "object") {
      const mount = candidate as SceneStageLike;
      if (typeof mount.addChild === "function" && typeof mount.removeChild === "function") {
        return mount;
      }
    }
  }
  return fallbackStage as SceneStageLike;
}

/**
 * Pixi 应用外壳：固定步、DOM 门禁、WebGL 恢复和可重启销毁均在此收口。
 */
export class GameApp {
  private readonly applicationFactory: ApplicationFactory;
  private readonly overlayFactory: () => SystemOverlayLike;
  private readonly audio: AudioServiceLike;
  private readonly viewportService: ViewportServiceLike;
  private readonly viewportProvider: () => GameViewportInput;
  private readonly layerFactory: LayerFactory;
  private readonly registerPixiExtensions: () => Promise<void>;
  private readonly restoreContextResources: () => Promise<void>;
  private readonly rebuildSceneFromStore?: () => void | Promise<void>;
  private readonly shouldCreateDefaultAssetService: boolean;
  private readonly initialFixedUpdate?: (deltaMs: number) => void;
  private readonly onDroppedTime?: GameAppOptions["onDroppedTime"];
  private readonly onInputEnabled?: (enabled: boolean) => void;
  private readonly onClearPointerState?: () => void;
  private readonly fpsMode: NonNullable<GameAppOptions["fpsMode"]>;
  private readonly listeners: Array<{
    target: EventTarget;
    type: string;
    listener: EventListener;
  }> = [];
  private readonly viewportListeners = new Set<ViewportListener>();

  private application: GameApplicationLike | null;
  private assetServiceValue: AssetServiceLike | null;
  private overlay: SystemOverlayLike | null;
  private readonly errorOverlay: ErrorOverlayLike | null;
  private layersValue: unknown | null = null;
  private sceneRouterValue: SceneRouter | null = null;
  private bootSceneValue: BootScene | null = null;
  private startPromise: Promise<void> | null = null;
  private state: GameAppLifecycleState = "created";
  private viewport: ViewportResult | null = null;
  private accumulatorMs = 0;
  private inputEnabled = false;
  private canvasAttached = false;
  private contextLost = false;
  private recovering = false;
  private hidden = false;
  private destroyed = false;
  private pixiEventsDetached = false;
  private tickerListener: ((ticker: GameTickerLike) => void) | null = null;
  private fixedUpdateHandler: ((deltaMs: number) => void) | null = null;
  private readonly assetManifest: AssetManifestV1;
  private readonly assetManifestMode: NonNullable<GameAppOptions["assetManifestMode"]>;

  public constructor(private readonly options: GameAppOptions) {
    this.application = options.application ?? null;
    this.applicationFactory = options.applicationFactory ?? defaultApplicationFactory;
    this.audio = options.audioService ?? new AudioService();
    this.assetServiceValue = options.assetService ?? null;
    this.shouldCreateDefaultAssetService =
      options.assetService === undefined &&
      options.audioService === undefined &&
      options.restoreContextResources === undefined;
    this.viewportService = options.viewportService ?? new ViewportService();
    this.viewportProvider = options.viewportProvider ?? (() => defaultViewportProvider(options.gameRoot));
    this.layerFactory = options.layerFactory ?? defaultLayerFactory;
    this.registerPixiExtensions =
      options.registerPixiExtensions ?? registerDefaultPixiExtensions;
    this.restoreContextResources =
      options.restoreContextResources ?? (() => this.restoreDefaultAssetService());
    this.rebuildSceneFromStore = options.rebuildSceneFromStore;
    this.initialFixedUpdate = options.onFixedUpdate;
    this.fixedUpdateHandler = options.onFixedUpdate ?? null;
    this.assetManifest = options.assetManifest ?? candidateAssetManifest;
    this.assetManifestMode = options.assetManifestMode ?? (options.assetManifest ? "final" : "fixture");
    this.onDroppedTime = options.onDroppedTime;
    this.onInputEnabled = options.onInputEnabled;
    this.onClearPointerState = options.onClearPointerState;
    this.fpsMode = options.fpsMode ?? "standard";
    this.overlay = options.overlay ?? null;
    this.errorOverlay = options.errorOverlay ?? null;
    this.overlayFactory = () => {
      if (this.overlay !== null) {
        return this.overlay;
      }
      this.overlay = new DomSystemOverlay(options.gameRoot);
      return this.overlay;
    };
  }

  public get lifecycleState(): GameAppLifecycleState {
    return this.state;
  }

  public get lastViewport(): ViewportResult | null {
    return this.viewport;
  }

  /** 只读暴露当前系统是否允许业务输入，供稍后挂载的语义根同步门禁。 */
  public get isInputEnabled(): boolean {
    return this.inputEnabled;
  }

  /** 订阅成功布局后的不可变 viewport；已有布局会同步交给新订阅者。 */
  public subscribeViewport(listener: ViewportListener): () => void {
    if (this.destroyed) return () => undefined;
    this.viewportListeners.add(listener);
    const current = this.viewport;
    if (current !== null) this.notifyViewportListener(listener, current);
    return () => {
      this.viewportListeners.delete(listener);
    };
  }

  /** 仅真实 AssetService 生产启动才暴露路由；fake adapter 不会被强制接入业务场景。 */
  public get sceneRouter(): SceneRouter | null {
    return this.sceneRouterValue;
  }

  /** 启动场景由路由持有；后续正式场景可从此只读入口接入。 */
  public get bootScene(): BootScene | null {
    return this.bootSceneValue;
  }

  /** 资源服务只读暴露给主流程；生产时由 GameApp 负责销毁。 */
  public get assetService(): AssetServiceLike | null {
    return this.assetServiceValue;
  }

  /** 主流程只能替换固定步回调，不能启动第二个 ticker。 */
  public setFixedUpdateHandler(handler: ((deltaMs: number) => void) | null): void {
    if (this.destroyed) return;
    this.fixedUpdateHandler = handler ?? this.initialFixedUpdate ?? null;
  }

  /** 业务错误统一从显式 ErrorOverlay 适配器进入；不把 raw error details 写到 DOM。 */
  public reportDomainError(error: DomainErrorV1): void {
    this.errorOverlay?.show(error);
  }

  public async start(): Promise<void> {
    if (this.destroyed || this.state === "destroyed") {
      throw new Error("GameApp 已销毁，不能再次启动");
    }
    if (this.state === "running" || this.state === "blocked" || this.state === "hidden") {
      return;
    }
    if (this.startPromise !== null) {
      return this.startPromise;
    }

    this.state = "initializing";
    this.startPromise = this.initialize();
    try {
      await this.startPromise;
    } catch (error) {
      this.cleanupAfterFailedInitialization();
      throw error;
    } finally {
      this.startPromise = null;
    }
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.state = "destroyed";
    this.stopTicker();
    this.removeListeners();
    this.setInputEnabled(false);
    const sceneDestroy = this.destroySceneRuntime();
    const assetService = this.assetServiceValue;
    this.assetServiceValue = null;
    this.destroyAssetServiceSafely(assetService, sceneDestroy);
    this.audio.destroy();
    this.errorOverlay?.destroy?.();
    this.overlay?.destroy();
    this.overlay = null;

    const application = this.application;
    this.application = null;
    if (application !== null) {
      try {
        application.destroy(
          { removeView: true, releaseGlobalResources: true },
          { children: true },
        );
      } catch {
        // 销毁必须幂等；渲染器已经部分失败时仍释放 DOM 和本地引用。
      }
    }
    this.canvasAttached = false;
    this.pixiEventsDetached = false;
    this.tickerListener = null;
    this.fixedUpdateHandler = null;
    this.accumulatorMs = 0;
    this.viewportListeners.clear();
  }

  private async initialize(): Promise<void> {
    await this.registerPixiExtensions();
    const application = this.application ?? (await this.applicationFactory());
    this.application = application;
    await application.init({
      ...createApplicationOptions(),
      eventFeatures: {
        move: true,
        globalMove: true,
        click: true,
        wheel: false,
      },
    });

    await this.ensureDefaultAssetService();

    // init 完成后才访问 canvas、renderer 和 ticker。
    this.attachCanvas(application.canvas);
    this.overlayFactory();
    // 保留固定根层返回值；Router 只会把 detached 场景根挂到 sceneRoot。
    this.layersValue = await this.layerFactory(application.stage);
    await this.setupSceneRuntime(application);
    this.configureTicker(application.ticker);
    this.attachListeners(application.canvas);
    this.hidden = this.readHiddenState();
    if (this.hidden) {
      this.pauseForSystem("hidden");
      void this.audio.suspend().catch(() => undefined);
    }
    await this.applyViewport();
  }

  private configureTicker(ticker: GameTickerLike): void {
    applyQualityPreset(ticker, this.fpsMode);
    this.tickerListener = (currentTicker) => this.handleTick(currentTicker);
    ticker.add(this.tickerListener);
  }

  private attachCanvas(canvas: HTMLCanvasElement): void {
    if (this.canvasAttached) {
      return;
    }

    const placeholder = this.options.placeholder;
    if (placeholder && placeholder.parentNode === this.options.gameRoot) {
      this.options.gameRoot.insertBefore(canvas, placeholder);
    } else {
      this.options.gameRoot.appendChild(canvas);
    }
    this.canvasAttached = true;
  }

  private attachListeners(canvas: HTMLCanvasElement): void {
    const browserWindow = typeof window === "undefined" ? null : window;
    const browserDocument = this.options.gameRoot.ownerDocument;
    const add = (target: EventTarget | null, type: string, listener: EventListener): void => {
      if (target === null) {
        return;
      }
      target.addEventListener(type, listener);
      this.listeners.push({ target, type, listener });
    };

    add(browserWindow, "resize", this.handleResize);
    add(browserWindow?.visualViewport ?? null, "resize", this.handleResize);
    add(browserDocument, "visibilitychange", this.handleVisibilityChange);
    add(browserWindow, "pagehide", this.handlePageHide);
    add(browserWindow, "pageshow", this.handlePageShow);
    add(canvas, "pointerdown", this.handlePointerDown);
    add(canvas, "webglcontextlost", this.handleContextLost);
    add(canvas, "webglcontextrestored", this.handleContextRestored);
  }

  private removeListeners(): void {
    for (const { target, type, listener } of this.listeners.splice(0)) {
      target.removeEventListener(type, listener);
    }
  }

  private readonly handleResize = (): void => {
    if (this.destroyed || this.recovering) {
      return;
    }
    void this.applyViewport()
      .then(async (recoveredFromBlocked) => {
        // blocked 恢复必须在布局、渲染和输入启用之后才恢复音频；隐藏期间不恢复。
        if (recoveredFromBlocked && !this.hidden && this.state === "running") {
          await this.audio.resumeIfUnlocked();
        }
      })
      .catch(() => undefined);
  };

  private readonly handleVisibilityChange = (): void => {
    const hidden = this.readHiddenState();
    if (hidden === this.hidden) {
      return;
    }
    this.hidden = hidden;
    if (hidden) {
      this.pauseForSystem("hidden");
      void this.audio.suspend().catch(() => undefined);
      return;
    }
    void this.resumeAfterSystemChange().catch(() => undefined);
  };

  private readonly handlePageHide = (): void => {
    this.hidden = true;
    this.pauseForSystem("hidden");
    void this.audio.suspend().catch(() => undefined);
  };

  private readonly handlePageShow = (): void => {
    this.hidden = false;
    void this.resumeAfterSystemChange().catch(() => undefined);
  };

  private readonly handlePointerDown = (): void => {
    void this.audio.unlock().catch(() => undefined);
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.recovering = false;
    this.pauseForSystem("contextLost");
    void this.audio.suspend().catch(() => undefined);
    this.overlay?.update({ state: "contextLost", reason: "webglcontextlost" });
  };

  private readonly handleContextRestored = (): void => {
    if (this.destroyed || !this.contextLost || this.recovering) {
      return;
    }

    this.recovering = true;
    this.state = "recovering";
    this.overlay?.update({ state: "contextLost", reason: "webglcontextrestored" });
    void this.restoreContextResources()
      .then(async () => {
      this.contextLost = false;
        this.recovering = false;
        await this.rebuildSceneFromStore?.();
        if (!this.hidden) {
          await this.applyViewport();
        } else {
          this.state = "hidden";
        }
        if (this.state === "running") {
          await this.audio.resumeIfUnlocked();
        }
      })
      .catch(() => {
        this.recovering = false;
        this.contextLost = true;
        this.stopTicker();
        this.setInputEnabled(false);
        this.state = "fatal";
        this.overlay?.update({ state: "fatal", reason: "context_restore_failed" });
      });
  };

  private async applyViewport(): Promise<boolean> {
    if (this.destroyed || this.application === null) {
      return false;
    }

    const recoveredFromBlocked = this.state === "blocked";
    const input = this.viewportProvider();
    const calculatedViewport = this.viewportService.calculate(
      { width: input.width, height: input.height },
      input.safeArea,
    );
    // ViewportService 返回的结构用于计算，发布前复制并冻结，阻止订阅者意外篡改当前布局。
    const viewport = Object.freeze({
      ...calculatedViewport,
      safeRect: Object.freeze({ ...calculatedViewport.safeRect }),
    });
    this.viewport = viewport;
    const canvas = this.application.canvas;
    canvas.style.width = `${viewport.cssWidth}px`;
    canvas.style.height = `${viewport.cssHeight}px`;
    canvas.style.left = `${viewport.offsetX}px`;
    canvas.style.top = `${viewport.offsetY}px`;
    this.application.renderer.resize?.(640, 360);
    this.publishViewport(viewport);

    const blockedState = overlayStateForViewport(viewport);
    if (blockedState !== null) {
      this.pauseForSystem("blocked");
      this.overlay?.update({ state: blockedState, reason: viewport.blockedReason ?? undefined });
      // 进入竖屏/过小门禁时必须静音；不改变用户音量设置。
      await this.audio.suspend().catch(() => undefined);
      return false;
    }
    if (this.hidden || this.contextLost || this.recovering || this.state === "fatal") {
      return false;
    }

    this.overlay?.update({ state: null });
    // 恢复顺序固定为 layout → render 一帧 → enable input → ticker start。
    this.application.render();
    this.setInputEnabled(true);
    this.startTicker();
    this.state = "running";
    return recoveredFromBlocked;
  }

  private handleTick(ticker: GameTickerLike): void {
    if (
      this.destroyed ||
      !this.inputEnabled ||
      this.hidden ||
      this.contextLost ||
      this.recovering ||
      this.state === "fatal"
    ) {
      return;
    }

    const frameDeltaMs = Number.isFinite(ticker.deltaMS)
      ? Math.max(0, ticker.deltaMS ?? 0)
      : 0;
    const boundedDeltaMs = Math.min(MAX_FRAME_DELTA_MS, frameDeltaMs);
    let droppedMs = Math.max(0, frameDeltaMs - boundedDeltaMs);
    this.accumulatorMs += boundedDeltaMs;
    let steps = 0;
    while (
      this.accumulatorMs + 0.000001 >= FIXED_STEP_MS &&
      steps < MAX_CATCH_UP_STEPS
    ) {
      this.fixedUpdateHandler?.(FIXED_STEP_MS);
      this.accumulatorMs -= FIXED_STEP_MS;
      if (this.accumulatorMs < 0.000001) {
        this.accumulatorMs = 0;
      }
      steps += 1;
    }

    if (steps === MAX_CATCH_UP_STEPS && this.accumulatorMs >= FIXED_STEP_MS) {
      droppedMs += this.accumulatorMs;
      this.accumulatorMs = 0;
    }
    if (droppedMs > 0) {
      this.onDroppedTime?.({ frameDeltaMs, droppedMs, steps });
    }
  }

  private async resumeAfterSystemChange(): Promise<void> {
    if (this.destroyed || this.contextLost || this.recovering) {
      return;
    }
    this.accumulatorMs = 0;
    await this.applyViewport();
    // 无论本次是否从 blocked 恢复，只要最终已可运行且页面可见，就恢复已解锁音频。
    if (this.state === "running" && !this.hidden) {
      await this.audio.resumeIfUnlocked();
    }
  }

  private async ensureDefaultAssetService(): Promise<void> {
    if (!this.shouldCreateDefaultAssetService || this.assetServiceValue !== null) return;
    const catalog = AssetCatalog.create(this.assetManifest, this.assetManifestMode, { runtime: true });
    if (!catalog.ok) {
      throw new Error(`默认资源目录无效:${catalog.error.code}`);
    }
    const audio = this.audio as AudioService;
    const options: AssetServiceOptions = {
      catalog: catalog.value,
      audioService: audio,
      uploader: (resource) => this.uploadPrepareResource(resource),
    };
    this.assetServiceValue = new AssetService(options);
  }

  private async uploadPrepareResource(resource: unknown): Promise<void> {
    const upload = this.application?.renderer.prepare?.upload;
    if (!upload) return;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      // upload 是 Pixi v8 的公开 prepare 入口；超时只降级预上传，不吞掉
      // backend.loadBundle 或音频 decode 的失败，后者仍由 AssetService 重试。
      await Promise.race([
        Promise.resolve().then(() => upload(resource)),
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(resolve, PREPARE_UPLOAD_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Pixi 可在首次 render 时按需上传；prepare 适配器失败不应阻塞启动。
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  private async setupSceneRuntime(application: GameApplicationLike): Promise<void> {
    const assetService = this.assetServiceValue;
    if (!(assetService instanceof AssetService)) {
      return;
    }

    // 只在真实生产资源服务存在时加载 Pixi 场景实现，Node fake adapter 不触发 Pixi Container。
    const [{ SceneRouter }, { BootScene }, { Container }] = await Promise.all([
      import("./SceneRouter"),
      import("../scenes/boot/BootScene"),
      import("pixi.js"),
    ]);
    const stage = sceneMountFromLayers(this.layersValue, application.stage);
    // sceneRoot 已由 PixiRootLayers 挂到 stage，BootScene 根必须保持 detached 直到 enter。
    const bootRoot = new Container() as unknown as SceneRootLike;
    const router = new SceneRouter({ stage });
    const bootScene = new BootScene({
      assetService,
      root: bootRoot,
      onProgress: (progress) => {
        if (progress >= 1) {
          this.overlay?.update({ state: null });
          return;
        }
        // 系统遮罩没有独立 loading 状态，复用资源恢复文案并保留进度原因供诊断。
        this.overlay?.update({
          state: "contextLost",
          reason: `boot_progress_${Math.round(progress * 100)}`,
        });
      },
      onFailure: (error) => {
        this.overlay?.update({ state: "fatal", reason: error.code });
      },
    });
    this.sceneRouterValue = router;
    this.bootSceneValue = bootScene;
    // prepare 失败直接传播，禁止以缺图占位进入正式流程。
    await router.setInitialScene(bootScene, {});
  }

  private async restoreDefaultAssetService(): Promise<void> {
    await this.ensureDefaultAssetService();
    await this.assetServiceValue?.restoreLoadedBundles();
  }

  private pauseForSystem(reason: "hidden" | "blocked" | "contextLost"): void {
    this.stopTicker();
    this.accumulatorMs = 0;
    this.setInputEnabled(false);
    this.state = reason;
  }

  private startTicker(): void {
    if (this.application === null) {
      return;
    }
    if (this.application.start && this.application.ticker) {
      this.application.start();
    } else {
      this.application.ticker?.start?.();
    }
  }

  private stopTicker(): void {
    if (this.application === null) {
      return;
    }
    try {
      if (this.application.stop && this.application.ticker) {
        this.application.stop();
      } else {
        this.application.ticker?.stop?.();
      }
    } catch {
      // init 尚未完成时 Pixi 可能尚未挂载 TickerPlugin，清理阶段无需放大原始错误。
    }
  }

  private setInputEnabled(enabled: boolean): void {
    if (this.application !== null) {
      this.application.canvas.style.pointerEvents = enabled ? "auto" : "none";
    }
    if (!enabled) {
      this.detachPixiPointerEvents();
    } else {
      this.attachPixiPointerEvents();
    }
    const gameRootWithQuery = this.options.gameRoot as HTMLElement & {
      querySelector?: (selector: string) => Element | null;
    };
    const semanticRoot = typeof gameRootWithQuery.querySelector === "function"
      ? gameRootWithQuery.querySelector("#game-flow-ui") as HTMLElement | null
      : null;
    if (semanticRoot) {
      (semanticRoot as HTMLElement & { inert?: boolean }).inert = !enabled;
      semanticRoot.setAttribute("aria-disabled", enabled ? "false" : "true");
    }
    if (this.inputEnabled === enabled) {
      return;
    }
    this.inputEnabled = enabled;
    if (!enabled) {
      this.onClearPointerState?.();
    }
    this.onInputEnabled?.(enabled);
  }

  private publishViewport(viewport: ViewportResult): void {
    for (const listener of [...this.viewportListeners]) {
      this.notifyViewportListener(listener, viewport);
    }
  }

  private notifyViewportListener(listener: ViewportListener, viewport: ViewportResult): void {
    try {
      listener(viewport);
    } catch {
      // 布局发布是旁路通知；单个场景适配器异常不能破坏 canvas 已完成的系统布局。
    }
  }

  private detachPixiPointerEvents(): void {
    const events = this.application?.renderer.events;
    if (events?.setTargetElement === undefined || this.pixiEventsDetached) {
      return;
    }

    // Pixi v8 官方 EventSystem API：移除 target 会同时解绑 canvas、document 与 window 的原生指针监听，
    // 使暂停期间不会残留 pointerdown/pointerup；恢复时再挂回同一 canvas。
    events.setTargetElement(null);
    this.pixiEventsDetached = true;
  }

  private attachPixiPointerEvents(): void {
    if (!this.pixiEventsDetached || this.application === null) {
      return;
    }

    const events = this.application.renderer.events;
    if (events?.setTargetElement === undefined) {
      this.pixiEventsDetached = false;
      return;
    }

    events.setTargetElement(this.application.canvas);
    this.pixiEventsDetached = false;
  }

  private readHiddenState(): boolean {
    return this.options.gameRoot.ownerDocument.visibilityState === "hidden";
  }

  private cleanupAfterFailedInitialization(): void {
    this.removeListeners();
    this.stopTicker();
    this.setInputEnabled(false);
    const sceneDestroy = this.destroySceneRuntime();
    this.overlay?.destroy();
    this.overlay = null;
    const assetService = this.assetServiceValue;
    this.assetServiceValue = null;
    this.destroyAssetServiceSafely(assetService, sceneDestroy);
    this.audio.destroy();
    this.errorOverlay?.destroy?.();
    try {
      this.application?.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true },
      );
    } catch {
      // 初始化失败后的清理不能覆盖原始失败原因。
    }
    this.application = null;
    this.layersValue = null;
    this.canvasAttached = false;
    this.pixiEventsDetached = false;
    this.state = "created";
  }

  private destroySceneRuntime(): Promise<void> {
    const router = this.sceneRouterValue;
    this.sceneRouterValue = null;
    this.bootSceneValue = null;
    this.layersValue = null;
    if (router === null) return Promise.resolve();
    try {
      // destroy 保持同步公开 API；调用方用 Promise chain 等待场景 lease 完整释放。
      return router.destroy();
    } catch {
      // 清理阶段不覆盖原始启动/销毁错误。
      return Promise.resolve();
    }
  }

  private destroyAssetServiceSafely(
    assetService: AssetServiceLike | null,
    waitForSceneDestroy: Promise<void>,
  ): void {
    if (assetService?.destroy === undefined) return;
    // 场景 exit 可能释放 BootScene lease；AssetService.destroy 必须排在其后，避免并发清理。
    const destroy = waitForSceneDestroy
      .catch(() => undefined)
      .then(() => {
        try {
          return Promise.resolve(assetService.destroy?.());
        } catch {
          return undefined;
        }
      });
    void destroy.catch(() => undefined);
  }
}
