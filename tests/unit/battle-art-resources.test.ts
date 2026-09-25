import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadAsset } = vi.hoisted(() => {
  vi.stubGlobal("navigator", {});
  return { loadAsset: vi.fn<(path: string) => Promise<unknown>>() };
});

vi.mock("pixi.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("pixi.js")>();
  return { ...original, Assets: { load: loadAsset } };
});

import { Texture, TextureSource } from "pixi.js";

const BACKGROUND = "/assets/art/battle-premium/v1/forest-arena.png";
const ROSTER = "/assets/art/battle-premium/v1/roster.png";
const FOREST_ROSTER = "/assets/art/battle-premium/v1/forest-roster.png";

function sourceTexture(width: number, height: number): Texture {
  return new Texture({ source: new TextureSource({ width, height }) });
}

function fixtures(): ReadonlyMap<string, Texture> {
  return new Map([
    [BACKGROUND, sourceTexture(1280, 720)],
    [ROSTER, sourceTexture(1024, 512)],
    [FOREST_ROSTER, sourceTexture(2172, 724)],
  ]);
}

function requireFixture(resources: ReadonlyMap<string, Texture>, path: string): Texture {
  const texture = resources.get(path);
  if (!texture) throw new Error(`UNEXPECTED_BATTLE_ART_PATH:${path}`);
  return texture;
}

beforeEach(() => {
  vi.resetModules();
  loadAsset.mockReset();
});

describe("BattleArtResources", () => {
  it("并发与后续场景复用同一加载任务和源纹理", async () => {
    const resources = fixtures();
    let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    loadAsset.mockImplementation(async (path) => {
      await ready;
      return requireFixture(resources, path);
    });
    const { loadBattleArtResources } = await import("../../src/ui/rendering/BattleArtResources");
    const first = loadBattleArtResources();
    const second = loadBattleArtResources();
    expect(second).toBe(first);
    release?.();
    expect(loadAsset.mock.calls.map(([path]) => path)).toEqual([BACKGROUND, ROSTER, FOREST_ROSTER]);
    const art = await first;
    expect(await second).toBe(art);
    expect(loadBattleArtResources()).toBe(first);
    expect(art.background).toBe(resources.get(BACKGROUND));
    expect(loadAsset).toHaveBeenCalledTimes(3);
  });

  it("加载失败向调用方报告，清理失败任务后可以重试", async () => {
    const resources = fixtures();
    const failure = new Error("BATTLE_ROSTER_NETWORK_FAILURE");
    loadAsset.mockImplementation(async (path) => {
      if (path === ROSTER) throw failure;
      return requireFixture(resources, path);
    });
    const { loadBattleArtResources } = await import("../../src/ui/rendering/BattleArtResources");
    const failed = loadBattleArtResources();
    await expect(failed).rejects.toBe(failure);
    loadAsset.mockImplementation(async (path) => requireFixture(resources, path));
    const retried = loadBattleArtResources();
    expect(retried).not.toBe(failed);
    const art = await retried;
    expect(art.background).toBe(resources.get(BACKGROUND));
    expect(loadBattleArtResources()).toBe(retried);
    expect(loadAsset).toHaveBeenCalledTimes(6);
  });

  it("十一个战斗资源 ID 精确对应已审阅的图集切片并共享源纹理", async () => {
    const resources = fixtures();
    loadAsset.mockImplementation(async (path) => requireFixture(resources, path));
    const { loadBattleArtResources } = await import("../../src/ui/rendering/BattleArtResources");
    const art = await loadBattleArtResources();
    // 显式列出美术布局，避免测试与生产代码共同通过错误的排序或推导。
    const frames = [
      ["sprite_battle_char_wanderer", 0, 0],
      ["sprite_battle_char_iron_guard", 256, 0],
      ["sprite_battle_char_ember_mage", 512, 0],
      ["sprite_battle_char_priest", 768, 0],
      ["sprite_battle_enemy_grass_slime", 0, 256],
      ["sprite_battle_enemy_thorn_rat", 256, 256],
      ["sprite_battle_enemy_fang_wolf", 512, 256],
      ["sprite_battle_enemy_goblin_scout", 768, 256],
    ] as const;
    const forestFrames = [
      ["sprite_battle_char_ranger", 0, 180, 540, 544],
      ["sprite_battle_enemy_stonehide_boar", 680, 220, 770, 504],
      ["sprite_battle_boss_horned_king", 1500, 0, 672, 724],
    ] as const;
    expect([...art.actors.keys()]).toEqual([...frames, ...forestFrames].map(([id]) => id));
    for (const [id, x, y] of frames) {
      const actor = art.actors.get(id);
      expect(actor, id).toBeDefined();
      expect(actor?.source, id).toBe(resources.get(ROSTER)?.source);
      expect(actor?.frame, id).toMatchObject({ x, y, width: 256, height: 256 });
    }
    for (const [id, x, y, width, height] of forestFrames) {
      const actor = art.actors.get(id);
      expect(actor, id).toBeDefined();
      expect(actor?.source, id).toBe(resources.get(FOREST_ROSTER)?.source);
      expect(actor?.frame, id).toMatchObject({ x, y, width, height });
      expect(x + width).toBeLessThanOrEqual(2172);
      expect(y + height).toBeLessThanOrEqual(724);
    }
    expect(resources.get(ROSTER)?.source.scaleMode).toBe("nearest");
    expect(resources.get(FOREST_ROSTER)?.source.scaleMode).toBe("nearest");
    expect(art.actors.has("char_wanderer")).toBe(false);
    expect(art.actors.has("sprite_battle_unknown")).toBe(false);
  });
});
