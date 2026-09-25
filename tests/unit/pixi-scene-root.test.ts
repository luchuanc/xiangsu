import { describe, expect, it, vi } from "vitest";

// Node 单测不加载 Pixi 浏览器适配器；这里只保留复合根所需的 Container 合约。
vi.mock("pixi.js", () => {
  class MockContainer {
    public parent: unknown | null = null;
    public readonly children: MockContainer[] = [];
    public sortableChildren = false;
    public eventMode = "auto";

    public constructor(options?: { sortableChildren?: boolean }) {
      this.sortableChildren = options?.sortableChildren ?? false;
    }

    public addChild(...children: MockContainer[]): MockContainer[] {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
      return children;
    }
  }

  return { Container: MockContainer };
});

import { Container } from "pixi.js";
import { createPixiSceneRoot, isPixiSceneRoot } from "../../src/app/PixiSceneRoot";

describe("PixiSceneRoot", () => {
  it("按冻结顺序创建场景内层级并保持 detached", () => {
    const root = createPixiSceneRoot();

    expect(root).toBeInstanceOf(Container);
    expect(root.parent).toBeNull();
    expect(root.children).toEqual([
      root.mapBack,
      root.actors,
      root.mapFront,
      root.worldFx,
      root.hud,
      root.screen,
      root.modal,
      root.transition,
    ]);
    expect(root.actors.sortableChildren).toBe(true);
    expect(isPixiSceneRoot(root)).toBe(true);
    expect(isPixiSceneRoot({ parent: null })).toBe(false);
  });

  it("将地图与世界特效层设为不可交互", () => {
    const root = createPixiSceneRoot();

    expect(root.mapBack.eventMode).toBe("none");
    expect(root.mapFront.eventMode).toBe("none");
    expect(root.worldFx.eventMode).toBe("none");
  });
});
