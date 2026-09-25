import { assetUrl } from "./assetUrl";
import {
  createDomainError,
  failure,
  success,
  type DomainErrorV1,
  type DomainResult,
} from "../domain/common/DomainResult";
import type {
  AssetCatalog,
  AssetValidationMode,
} from "./AssetCatalog";
import type {
  AssetEntryV1,
  AssetManifestV1,
} from "../content/data/assets.manifest";
import type {
  AudioBufferLike,
  AudioService,
  MusicId,
  SfxId,
} from "./AudioService";

export interface AssetBackend {
  init?(): void | Promise<void>;
  loadBundle(bundleId: string): Promise<unknown>;
  backgroundLoadBundle?(bundleId: string): void | Promise<void>;
  unloadBundle?(bundleId: string): void | Promise<void>;
  /** Pixi bundle 返回 alias map；生产 backend 展开为可交给 PrepareSystem 的真实资源。 */
  getUploadResources?(resource: unknown, bundleId: string): readonly unknown[];
}

export type AssetFetchResult = ArrayBuffer | { arrayBuffer(): Promise<ArrayBuffer> };
export type AssetFetch = (src: string) => Promise<AssetFetchResult>;
export type AssetCanPlayType = (mimeType: string) => string;
export type AssetSleep = (ms: number) => Promise<void>;
export type AssetUploader = (resource: unknown, bundleId: string) => void | Promise<void>;

export interface AssetAudioServiceLike {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  registerBuffer(id: MusicId | SfxId, buffer: AudioBufferLike): void;
  unregisterBuffer?(id: MusicId | SfxId): void;
  getRegisteredBuffer?(id: MusicId | SfxId): AudioBufferLike | undefined;
}

export interface AssetServiceOptions {
  catalog: AssetCatalog;
  backend?: AssetBackend;
  audioService?: AssetAudioServiceLike | AudioService;
  fetch?: AssetFetch;
  canPlayType?: AssetCanPlayType;
  sleep?: AssetSleep;
  uploader?: AssetUploader;
}

export interface AssetLease {
  readonly bundleId: string;
  release(options?: AssetReleaseOptions): Promise<void>;
}

export interface AssetReleaseOptions {
  /** 场景节点 detach/destroy 应在此回调中完成，随后 AssetService 才执行 unload。 */
  beforeUnload?: () => void | Promise<void>;
}

interface LoadedBundle {
  resource: unknown;
  audioIds: readonly string[];
  sourceKeys: readonly string[];
}

interface AudioSnapshot {
  id: MusicId | SfxId;
  buffer: AudioBufferLike | undefined;
}

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;
const MUSIC_IDS = new Set<string>(["bgm_title", "bgm_town", "bgm_field", "bgm_abyss", "bgm_boss", "bgm_final_boss"]);
const SFX_IDS = new Set<string>(["sfx_ui_confirm", "sfx_ui_cancel", "sfx_ui_error", "sfx_step", "sfx_encounter", "sfx_attack", "sfx_skill", "sfx_hit", "sfx_heal", "sfx_status", "sfx_combo_unlock", "sfx_combo_trigger", "sfx_loot_rare", "sfx_loot_abyss", "sfx_boss_phase", "sfx_battle_result"]);

const defaultSleep: AssetSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultCanPlayType(mimeType: string): string {
  if (typeof document === "undefined") return "";
  return document.createElement("audio").canPlayType(mimeType);
}

async function defaultFetch(src: string): Promise<ArrayBuffer> {
  const response = await fetch(assetUrl(src));
  if (!response.ok) throw new Error(`asset_fetch_${response.status}`);
  return response.arrayBuffer();
}

let pixiAssetsInitPromise: Promise<void> | null = null;
let pixiModulePromise: Promise<typeof import("pixi.js")> | null = null;

async function loadPixiModule(): Promise<typeof import("pixi.js")> {
  if (pixiModulePromise === null) {
    pixiModulePromise = import("pixi.js").catch((error) => {
      pixiModulePromise = null;
      throw error;
    });
  }
  return pixiModulePromise;
}

function toPixiManifest(manifest: AssetManifestV1): { bundles: Array<{ name: string; assets: Array<{ alias: string; src: string }> }> } {
  const byBundle = new Map(manifest.bundles.map((bundle) => [bundle.id, bundle]));
  const assetsById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  return {
    bundles: manifest.bundles.map((bundle) => ({
      name: bundle.id,
      assets: bundle.assetIds.flatMap((id) => {
        const asset = assetsById.get(id);
        if (!asset || asset.kind === "audio") return [];
        const src = asset.kind === "atlas"
          ? asset.dataSrc
          : asset.kind === "bitmapFont"
            ? asset.descriptorSrc
            : asset.src;
        return [{ alias: asset.id, src: assetUrl(src) }];
      }),
    })).filter((bundle) => byBundle.has(bundle.name)),
  };
}

function createPixiBackend(manifest: AssetManifestV1): AssetBackend {
  return {
    async init(): Promise<void> {
      if (pixiAssetsInitPromise === null) {
        const initPromise = loadPixiModule()
          .then(({ Assets }) => Assets.init({ manifest: toPixiManifest(manifest) }))
          .then(() => undefined);
        const guardedPromise = initPromise.catch((error) => {
          // Pixi 全局 init 失败后允许下一次 GameApp 重新建立 manifest/init。
          if (pixiAssetsInitPromise === guardedPromise) pixiAssetsInitPromise = null;
          throw error;
        });
        pixiAssetsInitPromise = guardedPromise;
      }
      await pixiAssetsInitPromise;
    },
    async loadBundle(bundleId: string): Promise<unknown> {
      const { Assets } = await loadPixiModule();
      return Assets.loadBundle(bundleId);
    },
    async backgroundLoadBundle(bundleId: string): Promise<void> {
      const { Assets } = await loadPixiModule();
      await Assets.backgroundLoadBundle(bundleId);
    },
    async unloadBundle(bundleId: string): Promise<void> {
      const { Assets } = await loadPixiModule();
      await Assets.unloadBundle(bundleId);
    },
    getUploadResources(resource: unknown): readonly unknown[] {
      return collectPixiUploadResources(resource);
    },
  };
}

function configurePixiTexture(resource: Record<string, unknown>): void {
  // PixiJS v8 使用公开 textureSource；不读取已弃用的 Texture.baseTexture，
  // 避免移动端启动阶段产生兼容警告并触发旧适配器路径。
  const source = resource.source ?? resource.textureSource;
  if (!source || typeof source !== "object") return;
  const textureSource = source as Record<string, unknown>;
  // ASSET-1.2 固定像素采样；字段存在时才写入，避免依赖 Pixi 私有实现。
  if ("scaleMode" in textureSource) textureSource.scaleMode = "nearest";
  if ("mipmap" in textureSource) textureSource.mipmap = "off";
}

function collectPixiUploadResources(resource: unknown): readonly unknown[] {
  const result: unknown[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    const children = record.children;
    const nested = [record.texture, record.source, record.textureSource, record.graphicsContext, record.context, record.geometry];
    const isPixiLike = nested.some((item) => item !== undefined) || Array.isArray(children) || "renderable" in record || "instructions" in record || "uid" in record;
    if (isPixiLike) {
      configurePixiTexture(record);
      result.push(value);
    }
    for (const item of nested) visit(item);
    if (Array.isArray(children)) for (const child of children) visit(child);
    // Assets.loadBundle 返回 alias -> resource；仅展开值，不把 map 本身当作可上传资源。
    if (!isPixiLike) for (const item of Object.values(record)) visit(item);
  };
  visit(resource);
  return result;
}

function toAudioId(id: string): MusicId | SfxId {
  if (MUSIC_IDS.has(id) || SFX_IDS.has(id)) return id as MusicId | SfxId;
  throw new Error(`未知音频 ID: ${id}`);
}

function failureError(bundleId: string): DomainErrorV1 {
  return createDomainError("ASSET_LOAD_FAILED", { bundleId, attempts: RETRY_ATTEMPTS });
}

export class AssetLoadError extends Error {
  public readonly domainError: DomainErrorV1;

  public constructor(domainError: DomainErrorV1, cause?: unknown) {
    const details = domainError.code === "ASSET_LOAD_FAILED" ? domainError.details : null;
    super(`${domainError.code}:${details?.bundleId ?? "unknown"}`);
    this.name = "AssetLoadError";
    this.domainError = domainError;
    this.cause = cause;
  }
}

/**
 * 资源层只按 AssetCatalog 的显式关系工作；Pixi Assets 是生产 backend，测试可完全注入 fake backend。
 */
export class AssetService {
  private readonly catalog: AssetCatalog;
  private readonly backend: AssetBackend;
  private readonly audio: AssetAudioServiceLike | undefined;
  private readonly fetchAsset: AssetFetch;
  private readonly canPlayType: AssetCanPlayType;
  private readonly sleep: AssetSleep;
  private readonly uploader: AssetUploader | undefined;
  private readonly refs = new Map<string, number>();
  private readonly ownerRefs = new Map<string, number>();
  private readonly loaded = new Map<string, LoadedBundle>();
  private readonly loading = new Map<string, Promise<LoadedBundle>>();
  private initPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private destroyed = false;

  public constructor(options: AssetServiceOptions) {
    this.catalog = options.catalog;
    this.backend = options.backend ?? createPixiBackend(options.catalog.getManifest() as AssetManifestV1);
    this.audio = options.audioService;
    this.fetchAsset = options.fetch ?? defaultFetch;
    this.canPlayType = options.canPlayType ?? defaultCanPlayType;
    this.sleep = options.sleep ?? defaultSleep;
    this.uploader = options.uploader;
  }

  public acquire(bundleId: string): Promise<DomainResult<AssetLease>> {
    return this.enqueue(() => this.acquireSerial(bundleId));
  }

  private async acquireSerial(bundleId: string): Promise<DomainResult<AssetLease>> {
    if (this.destroyed) throw new Error("AssetService 已销毁");
    const bundleResult = this.catalog.getBundle(bundleId);
    if (!bundleResult.ok) return bundleResult as DomainResult<AssetLease>;
    const orderResult = this.dependencyOrder(bundleId);
    if (!orderResult.ok) return orderResult as DomainResult<AssetLease>;
    const incremented: string[] = [];
    try {
      await this.ensureInitialized();
      for (const id of orderResult.value) {
        const count = this.refs.get(id) ?? 0;
        this.refs.set(id, count + 1);
        incremented.push(id);
        // 即使已有引用也必须等待同一 bundle 的 in-flight load，不能越过未完成的 boot。
        await this.loadBundle(id);
      }
      this.ownerRefs.set(bundleId, (this.ownerRefs.get(bundleId) ?? 0) + 1);
    } catch (error) {
      const zeroBundles: string[] = [];
      for (const id of [...incremented].reverse()) {
        const count = this.refs.get(id) ?? 0;
        if (count <= 1) {
          this.refs.delete(id);
          zeroBundles.push(id);
        } else this.refs.set(id, count - 1);
      }
      // 失败回滚必须同时卸载本次已经成功加载的依赖，避免 0 引用残留。
      for (const id of zeroBundles) {
        try {
          await this.unloadBundle(id);
        } catch {
          // acquire 没有向调用方提交 lease；逻辑缓存仍强制清掉，避免 loaded=true/ref=0。
          this.forceDropLoadedBundle(id);
        }
      }
      const domainError = error instanceof AssetLoadError ? error.domainError : failureError(bundleId);
      return failure(domainError);
    }

    let released = false;
    const lease: AssetLease = {
      bundleId,
      release: async (releaseOptions = {}) => {
        if (released) return;
        await this.release(bundleId, releaseOptions);
        // unload 成功后才消费 lease；失败可由同一个 lease 重试。
        released = true;
      },
    };
    return success(lease);
  }

  public release(bundleId: string, options: AssetReleaseOptions = {}): Promise<void> {
    return this.enqueue(() => this.releaseSerial(bundleId, options));
  }

  private async releaseSerial(bundleId: string, options: AssetReleaseOptions = {}): Promise<void> {
    if (this.destroyed) return;
    const ownerCount = this.ownerRefs.get(bundleId) ?? 0;
    if (ownerCount <= 0) return;

    const orderResult = this.dependencyOrder(bundleId);
    if (!orderResult.ok) return;
    const zeroBundles: string[] = [];
    for (const id of [...orderResult.value].reverse()) {
      const count = this.refs.get(id) ?? 0;
      if (count <= 1) {
        zeroBundles.push(id);
      }
    }
    if (zeroBundles.length > 0) await options.beforeUnload?.();
    // 先完成所有 backend unload，再一次性提交 refs/ownerRefs；中途失败可安全重试。
    for (const id of zeroBundles) await this.unloadBundle(id);
    if (ownerCount === 1) this.ownerRefs.delete(bundleId);
    else this.ownerRefs.set(bundleId, ownerCount - 1);
    for (const id of orderResult.value) {
      const count = this.refs.get(id) ?? 0;
      if (count <= 1) this.refs.delete(id);
      else this.refs.set(id, count - 1);
    }
  }

  /** 预热不增加引用；正式 acquire 仍然 await loadBundle。 */
  public preload(bundleId: string): Promise<DomainResult<void>> {
    return this.enqueue(() => this.preloadSerial(bundleId));
  }

  private async preloadSerial(bundleId: string): Promise<DomainResult<void>> {
    const orderResult = this.dependencyOrder(bundleId);
    if (!orderResult.ok) return orderResult as DomainResult<void>;
    if (!this.backend.backgroundLoadBundle) {
      // DomainErrorV1 没有独立 UNSUPPORTED_ASSET_PRELOAD；明确以资源失败返回，绝不静默成功。
      return failure(failureError(bundleId));
    }
    try {
      await this.ensureInitialized();
      for (const id of orderResult.value) {
        if (this.loaded.has(id)) continue;
        let backgroundError: unknown;
        for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
          try {
            await this.backend.backgroundLoadBundle(id);
            backgroundError = undefined;
            break;
          } catch (error) {
            backgroundError = error;
            if (attempt < RETRY_ATTEMPTS) await this.sleep(RETRY_DELAY_MS);
          }
        }
        if (backgroundError !== undefined) throw backgroundError;
        // backgroundLoadBundle 只预热 Pixi；loadBundle 负责音频 fetch/decode/register 与上传。
        await this.loadBundle(id);
      }
      return success(undefined);
    } catch {
      return failure(failureError(bundleId));
    }
  }

  /** context restored 后只重传直接被场景持有的 owner bundle。 */
  public restoreLoadedBundles(): Promise<void> {
    return this.enqueue(() => this.restoreLoadedBundlesSerial());
  }

  private async restoreLoadedBundlesSerial(): Promise<void> {
    if (this.destroyed) throw new Error("AssetService 已销毁");
    await this.ensureInitialized();
    const owners: string[] = [];
    const seen = new Set<string>();
    for (const owner of this.ownerRefs.keys()) {
      const order = this.dependencyOrder(owner);
      if (!order.ok) continue;
      for (const id of order.value) if (!seen.has(id) && (this.refs.get(id) ?? 0) > 0) {
        seen.add(id);
        owners.push(id);
      }
    }
    const snapshots: AudioSnapshot[] = [];
    for (const id of owners) {
      const bundle = this.catalog.getBundle(id);
      if (!bundle.ok) continue;
      for (const assetId of bundle.value.assetIds) {
        const asset = this.catalog.getAsset(assetId);
        if (asset.ok && asset.value.kind === "audio" && this.audio?.getRegisteredBuffer) {
          snapshots.push({ id: toAudioId(asset.value.id), buffer: this.audio.getRegisteredBuffer(toAudioId(asset.value.id)) });
        }
      }
    }
    try {
      for (const owner of owners) await this.loadBundle(owner, true);
    } catch (error) {
      // 恢复失败不得改变引用；音频适配器存在快照能力时恢复原 buffer。
      for (const snapshot of snapshots) {
        if (snapshot.buffer) this.audio?.registerBuffer(snapshot.id, snapshot.buffer);
      }
      throw error;
    }
  }

  public getReferenceCount(bundleId: string): number {
    return this.refs.get(bundleId) ?? 0;
  }

  public getOwnerReferenceCount(bundleId: string): number {
    return this.ownerRefs.get(bundleId) ?? 0;
  }

  public getLoadedBundleIds(): readonly string[] {
    return [...this.loaded.keys()];
  }

  public getLoadedResource(bundleId: string): unknown | undefined {
    return this.loaded.get(bundleId)?.resource;
  }

  public destroy(): Promise<void> {
    return this.enqueue(async () => {
      if (this.destroyed) return;
      const owners = [...this.ownerRefs.entries()];
      for (const [id, count] of owners) {
        for (let index = 0; index < count; index += 1) {
          try {
            await this.releaseSerial(id);
          } catch {
            // 销毁阶段不能产生 unhandled rejection；下面仍清空本实例逻辑缓存。
          }
        }
      }
      this.ownerRefs.clear();
      this.refs.clear();
      this.loaded.clear();
      this.destroyed = true;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation);
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initPromise === null) {
      const initAttempt = Promise.resolve(this.backend.init?.()).then(() => undefined);
      const guarded = initAttempt.catch((error) => {
        if (this.initPromise === guarded) this.initPromise = null;
        throw error;
      });
      this.initPromise = guarded;
    }
    await this.initPromise;
  }

  private dependencyOrder(bundleId: string): DomainResult<string[]> {
    const result = this.catalog.getBundle(bundleId);
    if (!result.ok) return result as DomainResult<string[]>;
    const ordered: string[] = [];
    const visited = new Set<string>();
    const visit = (id: string): DomainResult<void> => {
      if (visited.has(id)) return success(undefined);
      const bundle = this.catalog.getBundle(id);
      if (!bundle.ok) return bundle as DomainResult<void>;
      for (const dependency of bundle.value.dependsOn) {
        const dependencyResult = visit(dependency);
        if (!dependencyResult.ok) return dependencyResult;
      }
      visited.add(id);
      ordered.push(id);
      return success(undefined);
    };
    const visitResult = visit(bundleId);
    return visitResult.ok ? success(ordered) : visitResult as DomainResult<string[]>;
  }

  private async loadBundle(bundleId: string, force = false): Promise<LoadedBundle> {
    if (!force) {
      const existing = this.loaded.get(bundleId);
      if (existing) return existing;
    }
    const current = this.loading.get(bundleId);
    if (current) return current;
    const promise = this.performLoad(bundleId, force);
    this.loading.set(bundleId, promise);
    try {
      return await promise;
    } finally {
      if (this.loading.get(bundleId) === promise) this.loading.delete(bundleId);
    }
  }

  private async performLoad(bundleId: string, force: boolean): Promise<LoadedBundle> {
    const bundleResult = this.catalog.getBundle(bundleId);
    if (!bundleResult.ok) throw new AssetLoadError(failureError(bundleId));
    const previous = this.loaded.get(bundleId);
    const previousBuffers = new Map<string, AudioBufferLike>();
    if (force && previous && this.audio?.getRegisteredBuffer) {
      for (const id of previous.audioIds) {
        const buffer = this.audio.getRegisteredBuffer(toAudioId(id));
        if (buffer) previousBuffers.set(id, buffer);
      }
    }
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
      const registered: string[] = [];
      try {
        const resource = await this.backend.loadBundle(bundleId);
        for (const assetId of bundleResult.value.assetIds) {
          const assetResult = this.catalog.getAsset(assetId);
          if (!assetResult.ok) throw new AssetLoadError(failureError(bundleId));
          const asset = assetResult.value;
          if (asset.kind === "audio") {
            await this.loadAudio(asset, registered);
          }
        }
        if (this.uploader) {
          const uploadResources = this.backend.getUploadResources?.(resource, bundleId) ?? [resource];
          for (const uploadResource of uploadResources) await this.uploader(uploadResource, bundleId);
        }
        const loaded: LoadedBundle = { resource, audioIds: [...registered], sourceKeys: this.sourceKeysForBundle(bundleId) };
        this.loaded.set(bundleId, loaded);
        return loaded;
      } catch (error) {
        for (const id of registered) {
          try {
            this.audio?.unregisterBuffer?.(toAudioId(id));
          } catch {
            // 失败回滚不能覆盖原始资源错误。
          }
        }
        if (force && previous && this.audio) {
          for (const [id, buffer] of previousBuffers) {
            try {
              this.audio.registerBuffer(toAudioId(id), buffer);
            } catch {
              // 旧 buffer 恢复失败仍由本次 restore 失败向上报告。
            }
          }
        }
        try {
          await this.backend.unloadBundle?.(bundleId);
        } catch {
          // 本次 attempt 的 backend 清理失败不能吞掉资源加载原始错误。
        }
        if (attempt === RETRY_ATTEMPTS) {
          if (error instanceof AssetLoadError && error.domainError.code === "ASSET_LOAD_FAILED") throw error;
          throw new AssetLoadError(failureError(bundleId), error);
        }
        await this.sleep(RETRY_DELAY_MS);
      }
    }
    throw new AssetLoadError(failureError(bundleId));
  }

  private async loadAudio(asset: Extract<AssetEntryV1, { kind: "audio" }>, registered: string[]): Promise<void> {
    const candidates: Array<{ src: string; mime: string }> = [];
    const oggSupport = this.canPlayType("audio/ogg");
    if (oggSupport === "probably" || oggSupport === "maybe") candidates.push({ src: asset.oggSrc, mime: "audio/ogg" });
    const mp3Support = this.canPlayType("audio/mpeg");
    if (mp3Support === "probably" || mp3Support === "maybe") candidates.push({ src: asset.mp3Src, mime: "audio/mpeg" });
    if (candidates.length === 0 || !this.audio) throw new Error(`audio_source_unavailable:${asset.id}`);
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const fetched = await this.fetchAsset(candidate.src);
        const bytes = fetched instanceof ArrayBuffer ? fetched : await fetched.arrayBuffer();
        const buffer = await this.audio.decodeAudioData(bytes);
        const audioId = toAudioId(asset.id);
        try {
          this.audio.registerBuffer(audioId, buffer);
          registered.push(asset.id);
        } catch (error) {
          try {
            this.audio.unregisterBuffer?.(audioId);
          } catch {
            // 注册器失败时仍继续让本组重试。
          }
          throw error;
        }
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error(`audio_decode_failed:${asset.id}`);
  }

  private async unloadBundle(bundleId: string): Promise<void> {
    const loaded = this.loaded.get(bundleId);
    if (!loaded) return;
    // backend 成功前不注销 AudioBuffer 或删除 loaded，release 失败即可完整重试。
    await this.backend.unloadBundle?.(bundleId);
    for (const id of loaded.audioIds) {
      try {
        this.audio?.unregisterBuffer?.(toAudioId(id));
      } catch {
        // AudioService 生命周期已结束时无需让资源卸载产生 unhandled rejection。
      }
    }
    this.loaded.delete(bundleId);
  }

  private forceDropLoadedBundle(bundleId: string): void {
    const loaded = this.loaded.get(bundleId);
    if (!loaded) return;
    for (const id of loaded.audioIds) {
      try {
        this.audio?.unregisterBuffer?.(toAudioId(id));
      } catch {
        // 逻辑回滚必须继续清理其余资源。
      }
    }
    this.loaded.delete(bundleId);
  }

  private sourceKeysForBundle(bundleId: string): readonly string[] {
    const bundle = this.catalog.getBundle(bundleId);
    if (!bundle.ok) return [];
    const keys: string[] = [];
    for (const assetId of bundle.value.assetIds) {
      const asset = this.catalog.getAsset(assetId);
      if (!asset.ok) continue;
      if (asset.value.kind === "audio") keys.push(asset.value.oggSrc, asset.value.mp3Src);
      else if (asset.value.kind === "atlas") keys.push(asset.value.imageSrc, asset.value.dataSrc);
      else if (asset.value.kind === "bitmapFont") keys.push(asset.value.descriptorSrc, asset.value.textureSrc);
      else keys.push(asset.value.src);
    }
    return keys;
  }
}

export const ASSET_RETRY_ATTEMPTS = RETRY_ATTEMPTS;
export const ASSET_RETRY_DELAY_MS = RETRY_DELAY_MS;
export type { AssetValidationMode };
