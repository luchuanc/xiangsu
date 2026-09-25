import { describe, expect, it, vi } from "vitest";

// Node 单测不加载 Pixi 浏览器适配器；BootScene 的正式 root 仍由生产入口注入真实 Container。
vi.mock("pixi.js", () => ({
  Container: class MockContainer {
    public parent: unknown | null = null;
    public destroy(): void {}
  },
}));
import { SceneRouter } from "../../src/app/SceneRouter";
import type { Scene, SceneRootLike } from "../../src/app/Scene";
import { BootScene } from "../../src/scenes/boot/BootScene";
import type { AssetLease, AssetService } from "../../src/app/AssetService";
import { createDomainError, success, failure, type DomainErrorV1, type DomainResult } from "../../src/domain/common/DomainResult";

class FakeRoot implements SceneRootLike {
  public parent: unknown | null = null;
  public destroyed = false;
  public destroy(): void {
    this.destroyed = true;
  }
}

class FakeStage {
  public readonly events: string[] = [];
  public addChild(root: FakeRoot): void {
    root.parent = this;
    this.events.push("attach");
  }
  public removeChild(root: FakeRoot): void {
    root.parent = null;
    this.events.push("detach");
  }
}

function scene(name: string, events: string[], overrides: Partial<Scene<{ name: string }>> = {}): Scene<{ name: string }> {
  const root = new FakeRoot();
  return {
    root,
    prepare: async () => { events.push(`${name}.prepare`); },
    enter: async () => { events.push(`${name}.enter`); },
    pause: async () => { events.push(`${name}.pause`); },
    resume: async () => { events.push(`${name}.resume`); },
    exit: async () => { events.push(`${name}.exit`); },
    destroy: async () => { events.push(`${name}.destroy`); root.destroy(); },
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolvePromise: ((value: T) => void) | null = null;
  let rejectPromise: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => { resolvePromise?.(value); },
    reject: (error) => { rejectPromise?.(error); },
  };
}

function fakeAssetService(acquire: (bundleId: string) => Promise<DomainResult<AssetLease>>): AssetService {
  return { acquire } as unknown as AssetService;
}

describe("SceneRouter", () => {
  it("按 Promise queue 排队重入，并在 enter 成功后才销毁旧场景", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });
    let releasePrepare!: () => void;
    const prepareGate = new Promise<void>((resolve) => { releasePrepare = resolve; });
    const second = scene("second", events, {
      prepare: async () => { events.push("second.prepare"); await prepareGate; },
    });
    const third = scene("third", events);

    const secondTransition = router.transition(second, { name: "second" });
    const thirdTransition = router.transition(third, { name: "third" });
    await Promise.resolve();
    expect(events).toEqual(["second.prepare"]);
    expect(router.currentScene).toBe(first);
    releasePrepare();
    await secondTransition;
    await thirdTransition;

    expect(events).toEqual([
      "second.prepare", "first.pause", "second.enter", "first.exit", "first.destroy",
      "third.prepare", "second.pause", "third.enter", "second.exit", "second.destroy",
    ]);
    expect(router.currentScene).toBe(third);
    expect(stage.events).toEqual(["attach", "attach", "detach", "attach", "detach"]);
  });

  it("prepare/enter 失败保留旧场景并恢复，commit 后调用显式 rebuild", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });
    const prepareFailure = scene("prepareFailure", events, {
      prepare: async () => { events.push("prepareFailure.prepare"); throw new Error("prepare"); },
    });
    await expect(router.transition(prepareFailure, { name: "prepareFailure" })).rejects.toThrow("prepare");
    expect(router.currentScene).toBe(first);
    expect(events).toEqual(["prepareFailure.prepare", "prepareFailure.destroy"]);

    const enterFailure = scene("enterFailure", events, {
      enter: async () => { events.push("enterFailure.enter"); throw new Error("enter"); },
    });
    await expect(router.transition(enterFailure, { name: "enterFailure" })).rejects.toThrow("enter");
    expect(router.currentScene).toBe(first);
    expect(events.slice(-5)).toEqual(["enterFailure.prepare", "first.pause", "enterFailure.enter", "enterFailure.destroy", "first.resume"]);

    let rebuilt = false;
    const committedFailure = scene("committedFailure", events, {
      enter: async () => { events.push("committedFailure.enter"); throw new Error("committed-enter"); },
    });
    await expect(router.transition(committedFailure, { name: "committedFailure" }, {
      commit: () => { events.push("commit"); },
      recoverAfterCommittedEnterFailure: () => { rebuilt = true; events.push("rebuild"); },
    })).rejects.toThrow("committed-enter");
    expect(rebuilt).toBe(true);
    expect(router.currentScene).toBe(first);
    expect(events.slice(-6)).toEqual([
      "committedFailure.prepare", "commit", "first.pause", "committedFailure.enter", "rebuild", "committedFailure.destroy",
    ]);
  });

  it("commit 抛错时 old 未 pause，不调用 resume；目标仍会销毁", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });
    const target = scene("target", events);

    await expect(router.transition(target, { name: "target" }, {
      commit: () => { events.push("commit"); throw new Error("commit"); },
    })).rejects.toThrow("commit");
    expect(events).toEqual(["target.prepare", "commit", "target.destroy"]);
    expect(router.currentScene).toBe(first);
    expect(first.root.parent).toBe(stage);
  });

  it("same target 明确拒绝，预挂载 target 不会进入 prepare", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });

    await expect(router.transition(first, { name: "first" })).rejects.toMatchObject({
      code: "SCENE_ALREADY_CURRENT",
    });
    expect(events).toEqual([]);

    const mountedRoot = new FakeRoot();
    mountedRoot.parent = {};
    const mounted = scene("mounted", events, { root: mountedRoot });
    await expect(router.transition(mounted, { name: "mounted" })).rejects.toMatchObject({
      code: "SCENE_ROOT_MOUNTED",
    });
    expect(events).toEqual([]);
    expect(mountedRoot.destroyed).toBe(false);
  });

  it("target 在 prepare 中挂载也会被拒绝并清理，old 不受影响", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });
    const targetRoot = new FakeRoot();
    const target = scene("target", events, {
      root: targetRoot,
      prepare: async () => {
        events.push("target.prepare");
        targetRoot.parent = {};
      },
    });

    await expect(router.transition(target, { name: "target" })).rejects.toMatchObject({
      code: "SCENE_ROOT_MOUNTED",
    });
    expect(events).toEqual(["target.prepare", "target.destroy"]);
    expect(router.currentScene).toBe(first);
    expect(first.root.parent).toBe(stage);
  });

  it("committed enter 失败先 recovery 再 destroy，且不恢复陈旧 old", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });
    const target = scene("target", events, {
      enter: async () => { events.push("target.enter"); throw new Error("enter"); },
    });

    await expect(router.transition(target, { name: "target" }, {
      commit: () => { events.push("commit"); },
      recoverAfterCommittedEnterFailure: () => { events.push("rebuild"); },
    })).rejects.toThrow("enter");
    expect(events).toEqual([
      "target.prepare", "commit", "first.pause", "target.enter", "rebuild", "target.destroy",
    ]);
    expect(router.currentScene).toBe(first);
  });

  it("未提交 enter 失败只在 old 已 pause 后 resume", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });
    const target = scene("target", events, {
      enter: async () => { events.push("target.enter"); throw new Error("enter"); },
    });

    await expect(router.transition(target, { name: "target" })).rejects.toThrow("enter");
    expect(events).toEqual([
      "target.prepare", "first.pause", "target.enter", "target.destroy", "first.resume",
    ]);
  });

  it("destroy 在 enter 阻塞期间排队，已进入目标随后必须 exit、detach、destroy 且重复调用幂等", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });
    const enterGate = deferred<void>();
    const target = scene("target", events, {
      enter: async () => {
        events.push("target.enter");
        await enterGate.promise;
      },
    });

    const transition = router.transition(target, { name: "target" });
    await vi.waitFor(() => expect(events).toContain("target.enter"));
    const destroy = router.destroy();
    expect(router.destroy()).toBe(destroy);
    enterGate.resolve(undefined);

    await transition;
    await destroy;

    expect(router.currentScene).toBeNull();
    expect(target.root.parent).toBeNull();
    expect(events).toEqual([
      "target.prepare", "first.pause", "target.enter", "first.exit", "first.destroy",
      "target.exit", "target.destroy",
    ]);
    expect(stage.events).toEqual(["attach", "attach", "detach", "detach"]);
  });

  it("destroy 之后排队的 target 只销毁 detached 根并以稳定错误拒绝，不执行 prepare/enter", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });
    const enterGate = deferred<void>();
    const target = scene("target", events, {
      enter: async () => {
        events.push("target.enter");
        await enterGate.promise;
      },
    });
    const queued = scene("queued", events);

    const transition = router.transition(target, { name: "target" });
    await vi.waitFor(() => expect(events).toContain("target.enter"));
    const queuedTransition = router.transition(queued, { name: "queued" });
    const destroy = router.destroy();
    enterGate.resolve(undefined);

    await transition;
    await expect(queuedTransition).rejects.toMatchObject({ code: "SCENE_ROUTER_DESTROYED" });
    await destroy;

    expect(queued.root.parent).toBeNull();
    expect(events).not.toContain("queued.prepare");
    expect(events).not.toContain("queued.enter");
    expect(events).toContain("queued.destroy");
    expect(events.filter((event) => event === "queued.destroy")).toHaveLength(1);
    expect(router.currentScene).toBeNull();
  });

  it("closing 前已接受的 current transition 不会重复销毁 current scene", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });
    const enterGate = deferred<void>();
    const target = scene("target", events, {
      enter: async () => {
        events.push("target.enter");
        await enterGate.promise;
      },
    });

    const transition = router.transition(target, { name: "target" });
    await vi.waitFor(() => expect(events).toContain("target.enter"));
    const currentTransition = router.transition(first, { name: "first" });
    const destroy = router.destroy();
    enterGate.resolve(undefined);

    await transition;
    await expect(currentTransition).rejects.toMatchObject({ code: "SCENE_ROUTER_DESTROYED" });
    await destroy;

    expect(events.filter((event) => event === "first.destroy")).toHaveLength(1);
    expect(events.filter((event) => event === "target.destroy")).toHaveLength(1);
    expect(router.currentScene).toBeNull();
  });

  it("closing 后新提交的外部 mounted target 只拒绝，不销毁调用方对象", async () => {
    const events: string[] = [];
    const stage = new FakeStage();
    const first = scene("first", events);
    const router = new SceneRouter({ stage, initialScene: first });
    await router.destroy();

    const externalRoot = new FakeRoot();
    externalRoot.parent = {};
    const external = scene("external", events, { root: externalRoot });
    await expect(router.transition(external, { name: "external" })).rejects.toMatchObject({
      code: "SCENE_ROUTER_DESTROYED",
    });
    expect(events).not.toContain("external.destroy");
    expect(externalRoot.parent).not.toBeNull();
  });

  it("BootScene 并发 prepare 只 acquire 一次，失败后释放 lease 并可重试", async () => {
    const calls: string[] = [];
    const releases: string[] = [];
    const progress: number[] = [];
    const failures: DomainErrorV1[] = [];
    const coreFailure = createDomainError("ASSET_LOAD_FAILED", { bundleId: "core_ui", attempts: 3 });
    let attempt = 0;
    let releaseBoot!: () => void;
    const bootGate = new Promise<void>((resolve) => { releaseBoot = resolve; });
    const assets = fakeAssetService(async (bundleId) => {
      calls.push(bundleId);
      if (attempt === 0 && bundleId === "boot") await bootGate;
      if (attempt === 0 && bundleId === "core_ui") return failure(coreFailure);
      return success({
        bundleId,
        release: async () => { releases.push(bundleId); },
      });
    });
    const bootScene = new BootScene({
      assetService: assets,
      onProgress: (value) => progress.push(value),
      onFailure: (error) => failures.push(error),
    });

    const firstPrepare = bootScene.prepare();
    const secondPrepare = bootScene.prepare();
    await Promise.resolve();
    expect(calls).toEqual(["boot"]);
    expect(bootScene.status).toBe("preparing");
    releaseBoot();
    await expect(firstPrepare).rejects.toThrow("ASSET_LOAD_FAILED");
    await expect(secondPrepare).rejects.toThrow("ASSET_LOAD_FAILED");
    expect(calls).toEqual(["boot", "core_ui"]);
    expect(releases).toEqual(["boot"]);
    expect(bootScene.status).toBe("failed");
    expect(bootScene.lastFailure).toEqual(coreFailure);
    expect(bootScene.lastError).toBeInstanceOf(Error);
    expect(failures).toEqual([coreFailure]);

    attempt = 1;
    await bootScene.prepare();
    expect(calls).toEqual(["boot", "core_ui", "boot", "core_ui"]);
    expect(bootScene.status).toBe("ready");
    expect(bootScene.lastFailure).toBeNull();
    expect(bootScene.progress).toBe(1);
    expect(progress).toEqual([0, 0.5, 0, 0.5, 1]);
  });
});
