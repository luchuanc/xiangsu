import { describe, expect, it } from "vitest";
import {
  AssetService,
  type AssetAudioServiceLike,
  type AssetBackend,
} from "../../src/app/AssetService";
import {
  AudioService,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioGainNodeLike,
  type AudioBufferSourceNodeLike,
  type AudioParamLike,
  type MusicId,
  type SfxId,
} from "../../src/app/AudioService";
import { AssetCatalog } from "../../src/app/AssetCatalog";
import { candidateAssetManifest } from "../../src/content/data/assets.manifest";

class FakeBackend implements AssetBackend {
  public readonly loads: string[] = [];
  public readonly backgroundLoads: string[] = [];
  public readonly unloads: string[] = [];
  public readonly failures = new Map<string, number>();
  public readonly unloadFailures = new Map<string, number>();
  public readonly alwaysFail = new Set<string>();
  public initCount = 0;

  public init(): void {
    this.initCount += 1;
  }

  public async loadBundle(bundleId: string): Promise<unknown> {
    this.loads.push(bundleId);
    if (this.alwaysFail.has(bundleId)) throw new Error(`load:${bundleId}`);
    const remaining = this.failures.get(bundleId) ?? 0;
    if (remaining > 0) {
      this.failures.set(bundleId, remaining - 1);
      throw new Error(`load:${bundleId}`);
    }
    return { bundleId };
  }

  public async backgroundLoadBundle(bundleId: string): Promise<void> {
    this.backgroundLoads.push(bundleId);
  }

  public async unloadBundle(bundleId: string): Promise<void> {
    this.unloads.push(bundleId);
    const remaining = this.unloadFailures.get(bundleId) ?? 0;
    if (remaining > 0) {
      this.unloadFailures.set(bundleId, remaining - 1);
      throw new Error(`unload:${bundleId}`);
    }
  }
}

class GatedBackend extends FakeBackend {
  private readonly bootGate: Promise<void>;
  private releaseBootGate!: () => void;
  private resolveBootStarted!: () => void;
  private bootReleased = false;
  public readonly bootStarted = new Promise<void>((resolve) => {
    this.resolveBootStarted = resolve;
  });

  public constructor() {
    super();
    this.bootGate = new Promise<void>((resolve) => {
      this.releaseBootGate = resolve;
    });
  }

  public releaseBoot(): void {
    if (this.bootReleased) return;
    this.bootReleased = true;
    this.releaseBootGate();
  }

  public override async loadBundle(bundleId: string): Promise<unknown> {
    // 让首个 boot 真正卡在 backend 内，验证后续 acquire 不会越过依赖门控。
    const loading = super.loadBundle(bundleId);
    if (bundleId === "boot" && !this.bootReleased) {
      this.resolveBootStarted();
      await this.bootGate;
    }
    return loading;
  }
}

class FakeAudio implements AssetAudioServiceLike {
  public readonly decoded: ArrayBuffer[] = [];
  public readonly registered = new Map<string, AudioBufferLike>();
  public readonly unregistered: string[] = [];
  public readonly registerFailures = new Set<string>();
  public decodeFailure = false;

  public async decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    this.decoded.push(data);
    if (this.decodeFailure) throw new Error("decode");
    return { duration: 1 };
  }

  public registerBuffer(id: MusicId | SfxId, buffer: AudioBufferLike): void {
    if (this.registerFailures.has(id)) throw new Error(`register:${id}`);
    this.registered.set(id, buffer);
  }

  public unregisterBuffer(id: MusicId | SfxId): void {
    this.unregistered.push(id);
    this.registered.delete(id);
  }

  public getRegisteredBuffer(id: MusicId | SfxId): AudioBufferLike | undefined {
    return this.registered.get(id);
  }
}

class TestAudioParam implements AudioParamLike {
  public value = 0;
  public setValueAtTime(value: number): this { this.value = value; return this; }
  public linearRampToValueAtTime(value: number): this { this.value = value; return this; }
  public cancelScheduledValues(): this { return this; }
}

class TestGain implements AudioGainNodeLike {
  public readonly gain = new TestAudioParam();
  public connect(destination: unknown): unknown { return destination; }
  public disconnect(): void { /* fake */ }
}

class TestSource implements AudioBufferSourceNodeLike {
  public buffer: AudioBufferLike | null = null;
  public loop = false;
  public onended: ((event: Event) => unknown) | null = null;
  public shouldThrowOnStart = false;
  public start(): void { if (this.shouldThrowOnStart) throw new Error("start"); }
  public stop(): void { /* fake */ }
  public connect(destination: unknown): unknown { return destination; }
  public disconnect(): void { /* fake */ }
}

class TestAudioContext implements AudioContextLike {
  public currentTime = 0;
  public readonly destination = {};
  public readonly sources: TestSource[] = [];
  public state: "suspended" | "running" | "closed" = "suspended";
  public throwOnStart = false;
  public createGain(): TestGain { return new TestGain(); }
  public createBufferSource(): TestSource {
    const source = new TestSource();
    source.shouldThrowOnStart = this.throwOnStart;
    this.sources.push(source);
    return source;
  }
  public async resume(): Promise<void> { this.state = "running"; }
  public async suspend(): Promise<void> { this.state = "suspended"; }
  public async close(): Promise<void> { this.state = "closed"; }
}

function createService(backend: FakeBackend, audio = new FakeAudio(), extra: Partial<ConstructorParameters<typeof AssetService>[0]> = {}) {
  const catalogResult = AssetCatalog.create(candidateAssetManifest, "fixture");
  if (!catalogResult.ok) throw new Error("fixture catalog invalid");
  const fetchCalls: string[] = [];
  const sleeps: number[] = [];
  const uploads: string[] = [];
  const service = new AssetService({
    catalog: catalogResult.value,
    backend,
    audioService: audio,
    canPlayType: () => "probably",
    fetch: async (src) => {
      fetchCalls.push(src);
      if (src.endsWith(".ogg")) throw new Error("ogg unavailable");
      return new ArrayBuffer(8);
    },
    sleep: async (ms) => { sleeps.push(ms); },
    uploader: async (_resource, bundleId) => { uploads.push(bundleId); },
    ...extra,
  });
  return { audio, fetchCalls, service, sleeps, uploads };
}

describe("AssetService", () => {
  it("图像/音频组前两次失败第 3 次成功，恰好两次 250ms，并注册 ogg→mp3 回退", async () => {
    const backend = new FakeBackend();
    backend.failures.set("floor_01", 2);
    const harness = createService(backend);
    const acquired = await harness.service.acquire("floor_01");
    expect(acquired.ok).toBe(true);
    expect(backend.loads.filter((id) => id === "floor_01")).toHaveLength(3);
    expect(harness.sleeps).toEqual([250, 250]);

    const core = await harness.service.acquire("core_ui");
    expect(core.ok).toBe(true);
    expect(harness.fetchCalls[0]).toMatch(/\.ogg$/);
    expect(harness.fetchCalls[1]).toMatch(/\.mp3$/);
    expect(harness.audio.registered.has("sfx_ui_confirm")).toBe(true);
    expect(harness.audio.decoded.length).toBeGreaterThan(0);
  });

  it("同 bundle 并发去重、依赖递归引用，town→floor→town 归零后先 detach 再 unload", async () => {
    const backend = new FakeBackend();
    const harness = createService(backend);
    const [townOne, townTwo] = await Promise.all([
      harness.service.acquire("town"),
      harness.service.acquire("town"),
    ]);
    expect(townOne.ok && townTwo.ok).toBe(true);
    if (!townOne.ok || !townTwo.ok) throw new Error("town acquire failed");
    expect(backend.loads.filter((id) => id === "town")).toHaveLength(1);
    expect(harness.service.getReferenceCount("town")).toBe(2);
    expect(harness.service.getReferenceCount("player_common")).toBe(2);

    await townOne.value.release();
    expect(harness.service.getReferenceCount("town")).toBe(1);
    const floor = await harness.service.acquire("floor_01");
    expect(floor.ok).toBe(true);
    await townTwo.value.release({ beforeUnload: () => { backend.unloads.push("detach"); } });
    expect(backend.unloads.indexOf("detach")).toBeLessThan(backend.unloads.indexOf("town"));
    if (!floor.ok) throw new Error("floor acquire failed");
    await floor.value.release();
    expect(harness.service.getReferenceCount("floor_01")).toBe(0);
    expect(harness.service.getReferenceCount("player_common")).toBe(0);
    expect(harness.audio.unregistered).toContain("sfx_step");
  });

  it("资源加载三次失败返回 ASSET_LOAD_FAILED 并回滚引用/部分资源", async () => {
    const backend = new FakeBackend();
    backend.alwaysFail.add("floor_02");
    const harness = createService(backend);
    const result = await harness.service.acquire("floor_02");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: "ASSET_LOAD_FAILED", details: { bundleId: "floor_02", attempts: 3 } });
    expect(harness.service.getReferenceCount("floor_02")).toBe(0);
    expect(harness.service.getLoadedBundleIds()).toEqual([]);
    expect(backend.loads.filter((id) => id === "floor_02")).toHaveLength(3);
  });

  it("context restore 只重传当前引用 bundle，失败不改 ref snapshot", async () => {
    const backend = new FakeBackend();
    const harness = createService(backend);
    const lease = await harness.service.acquire("town");
    expect(lease.ok).toBe(true);
    const before = [...candidateAssetManifest.bundles.map((bundle) => [bundle.id, harness.service.getReferenceCount(bundle.id)] as const)];
    backend.loads.length = 0;
    await harness.service.restoreLoadedBundles();
    expect(backend.loads).toEqual(["boot", "core_ui", "player_common", "town"]);
    expect([...candidateAssetManifest.bundles.map((bundle) => [bundle.id, harness.service.getReferenceCount(bundle.id)] as const)]).toEqual(before);

    backend.alwaysFail.add("town");
    await expect(harness.service.restoreLoadedBundles()).rejects.toMatchObject({ domainError: { code: "ASSET_LOAD_FAILED", details: { bundleId: "town", attempts: 3 } } });
    expect([...candidateAssetManifest.bundles.map((bundle) => [bundle.id, harness.service.getReferenceCount(bundle.id)] as const)]).toEqual(before);
    if (!lease.ok) throw new Error("town acquire failed");
    await lease.value.release();
  });

  it("并发 acquire 共享依赖门控，第二个 floor 不得越过首个 boot", async () => {
    const backend = new GatedBackend();
    const harness = createService(backend);
    const firstPromise = harness.service.acquire("floor_01");
    await backend.bootStarted;

    let secondDone = false;
    const secondPromise = harness.service.acquire("floor_02");
    void secondPromise.then(() => { secondDone = true; });
    await Promise.resolve();
    expect(secondDone).toBe(false);
    expect(backend.loads).toEqual(["boot"]);

    backend.releaseBoot();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok) await first.value.release();
    if (second.ok) await second.value.release();
  });

  it("unload 失败不提交 refs/loaded，lease 可在 backend 恢复后重试", async () => {
    const backend = new FakeBackend();
    const harness = createService(backend);
    const lease = await harness.service.acquire("floor_01");
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;

    backend.unloadFailures.set("floor_01", 1);
    await expect(lease.value.release()).rejects.toThrow("unload:floor_01");
    expect(harness.service.getReferenceCount("floor_01")).toBe(1);
    expect(harness.service.getLoadedBundleIds()).toContain("floor_01");

    await lease.value.release();
    expect(harness.service.getReferenceCount("floor_01")).toBe(0);
    expect(harness.service.getLoadedBundleIds()).toEqual([]);
  });

  it("preload 缺少 backend 能力时显式失败，不静默成功", async () => {
    const backend = new FakeBackend();
    const catalogResult = AssetCatalog.create(candidateAssetManifest, "fixture");
    if (!catalogResult.ok) throw new Error("fixture catalog invalid");
    const service = new AssetService({
      catalog: catalogResult.value,
      backend: { loadBundle: backend.loadBundle.bind(backend) },
      audioService: new FakeAudio(),
    });

    const result = await service.preload("floor_01");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ASSET_LOAD_FAILED");
    expect(backend.loads).toEqual([]);
  });

  it("音频部分注册失败会回滚已注册 buffer，并按资源组重试三次", async () => {
    const backend = new FakeBackend();
    const audio = new FakeAudio();
    audio.registerFailures.add("sfx_ui_cancel");
    const harness = createService(backend, audio);
    const result = await harness.service.acquire("core_ui");

    expect(result.ok).toBe(false);
    expect(backend.loads.filter((id) => id === "core_ui")).toHaveLength(3);
    expect(harness.sleeps).toEqual([250, 250]);
    expect(audio.registered.size).toBe(0);
    expect(audio.unregistered).toContain("sfx_ui_confirm");
    expect(harness.service.getLoadedBundleIds()).toEqual([]);
  });

  it("两源不可播放和 decode 失败都进入三次资源组重试", async () => {
    const unsupportedBackend = new FakeBackend();
    const unsupported = createService(unsupportedBackend, new FakeAudio(), { canPlayType: () => "" });
    const unsupportedResult = await unsupported.service.acquire("boot");
    expect(unsupportedResult.ok).toBe(false);
    expect(unsupportedBackend.loads.filter((id) => id === "boot")).toHaveLength(3);
    expect(unsupported.sleeps).toEqual([250, 250]);

    const decodeBackend = new FakeBackend();
    const decodeAudio = new FakeAudio();
    decodeAudio.decodeFailure = true;
    const decode = createService(decodeBackend, decodeAudio);
    const decodeResult = await decode.service.acquire("boot");
    expect(decodeResult.ok).toBe(false);
    expect(decodeBackend.loads.filter((id) => id === "boot")).toHaveLength(3);
    expect(decode.sleeps).toEqual([250, 250]);
    expect(decode.fetchCalls.filter((src) => src.endsWith(".ogg"))).toHaveLength(3);
    expect(decode.fetchCalls.filter((src) => src.endsWith(".mp3"))).toHaveLength(3);
    expect(decodeAudio.registered.size).toBe(0);
  });

  it("music/SFX source 活跃时延迟 unregister，onended 后释放 buffer", async () => {
    const musicContext = new TestAudioContext();
    const music = new AudioService({ context: musicContext });
    const musicBuffer = { duration: 1 } satisfies AudioBufferLike;
    music.registerBuffer("bgm_title", musicBuffer);
    await music.unlock();
    music.setMusic("bgm_title", 10000);
    music.unregisterBuffer("bgm_title");
    expect(music.getRegisteredBuffer("bgm_title")).toBe(musicBuffer);
    musicContext.sources[0]?.onended?.({} as Event);
    expect(music.getRegisteredBuffer("bgm_title")).toBeUndefined();
    music.destroy();

    const sfxContext = new TestAudioContext();
    const sfx = new AudioService({ context: sfxContext });
    const sfxBuffer = { duration: 1 } satisfies AudioBufferLike;
    sfx.registerBuffer("sfx_step", sfxBuffer);
    await sfx.unlock();
    expect(sfx.playSfx("sfx_step")).toBe(true);
    sfx.unregisterBuffer("sfx_step");
    expect(sfx.getRegisteredBuffer("sfx_step")).toBe(sfxBuffer);
    sfxContext.sources[0]?.onended?.({} as Event);
    expect(sfx.getRegisteredBuffer("sfx_step")).toBeUndefined();
    sfx.destroy();
  });

  it("music source.start 抛错时释放 usage，pending unregister 不会泄漏", async () => {
    const context = new TestAudioContext();
    const service = new AudioService({ context });
    const buffer = { duration: 1 } satisfies AudioBufferLike;
    service.registerBuffer("bgm_title", buffer);
    await service.unlock();
    context.throwOnStart = true;

    expect(() => service.setMusic("bgm_title", 10000)).toThrow("start");
    service.unregisterBuffer("bgm_title");
    expect(service.getRegisteredBuffer("bgm_title")).toBeUndefined();
    service.destroy();
  });
});
