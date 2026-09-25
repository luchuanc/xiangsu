import { describe, expect, it } from "vitest";

import { CollisionGrid, FOOT_AABB_HEIGHT, FOOT_AABB_WIDTH } from "../../src/domain/exploration/CollisionGrid";

function grid(collisionLayer: Array<0 | 1>, widthTiles = 5, heightTiles = 5): CollisionGrid {
  return new CollisionGrid({ widthTiles, heightTiles, tileSize: 16, collisionLayer });
}

describe("CollisionGrid", () => {
  it("对负坐标使用数学 floor，并在边界外视为阻挡", () => {
    const value = grid(new Array<0 | 1>(25).fill(0));
    expect(value.worldToTile({ x: -0.01, y: -16 })).toEqual({ x: -1, y: -1 });
    expect(value.tileToWorld({ x: -2, y: 3 })).toEqual({ x: -32, y: 48 });
    expect(value.isBlocked({ x: -1, y: 20 }, 1, 1)).toBe(true);
    expect(value.isBlocked({ x: 80, y: 20 }, 1, 1)).toBe(true);
  });

  it("能检测顶墙、窄道和脚底 AABB，刚好贴边不算穿入", () => {
    const layer = new Array<0 | 1>(25).fill(0);
    layer[1 * 5 + 2] = 1;
    const value = grid(layer);
    expect(value.isBlocked({ x: 40, y: 24 }, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)).toBe(true);
    expect(value.isBlocked({ x: 40, y: 32 }, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)).toBe(false);
    expect(value.isBlocked({ x: 40 - FOOT_AABB_WIDTH / 2, y: 24 }, 0, 0)).toBe(false);
  });

  it("把 blocking NPC 作为独立 AABB，不把遭遇对象当作障碍", () => {
    const value = new CollisionGrid({ widthTiles: 5, heightTiles: 5, tileSize: 16, collisionLayer: new Array<0 | 1>(25).fill(0) }, [
      { objectId: "npc-block", position: { x: 40, y: 40 }, width: FOOT_AABB_WIDTH, height: FOOT_AABB_HEIGHT },
    ]);
    expect(value.isBlocked({ x: 40, y: 40 }, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)).toBe(true);
    expect(value.isBlocked({ x: 72, y: 72 }, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)).toBe(false);
  });
});
