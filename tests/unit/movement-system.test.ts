import { describe, expect, it } from "vitest";

import { CollisionGrid } from "../../src/domain/exploration/CollisionGrid";
import { MAX_AXIS_SWEEP_PER_STEP, movePlayer, PLAYER_SPEED_PER_STEP } from "../../src/domain/exploration/MovementSystem";

function openGrid(): CollisionGrid {
  const widthTiles = 12;
  const heightTiles = 12;
  const layer = new Array<0 | 1>(widthTiles * heightTiles).fill(0);
  for (let x = 0; x < widthTiles; x += 1) {
    layer[x] = 1;
    layer[(heightTiles - 1) * widthTiles + x] = 1;
  }
  for (let y = 0; y < heightTiles; y += 1) {
    layer[y * widthTiles] = 1;
    layer[y * widthTiles + widthTiles - 1] = 1;
  }
  return new CollisionGrid({ widthTiles, heightTiles, tileSize: 16, collisionLayer: layer });
}

describe("MovementSystem", () => {
  it("固定步每次只读取一个归一化方向，三步距离一致", () => {
    const grid = openGrid();
    let position = { x: 32, y: 32 };
    for (let step = 0; step < 3; step += 1) position = movePlayer(position, { x: 1, y: 0 }, grid).position;
    expect(position.x).toBeCloseTo(32 + PLAYER_SPEED_PER_STEP * 3, 8);
    expect(position.y).toBe(32);
  });

  it("先处理绝对位移较大的轴，第一轴碰撞后仍尝试第二轴并能贴墙滑动", () => {
    const grid = openGrid();
    const result = movePlayer({ x: 32, y: 32 }, { x: 1, y: 0.2 }, grid);
    expect(result.position.x).toBeCloseTo(32 + PLAYER_SPEED_PER_STEP, 8);
    expect(result.position.y).toBeCloseTo(32 + PLAYER_SPEED_PER_STEP * 0.2, 8);
  });

  it("地图边界、顶墙与 blocking NPC 都不能穿越", () => {
    const grid = new CollisionGrid({
      widthTiles: 5,
      heightTiles: 5,
      tileSize: 16,
      collisionLayer: [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1],
    }, [{ objectId: "npc", position: { x: 40, y: 40 }, width: 12, height: 8 }]);
    const result = movePlayer({ x: 40, y: 56 }, { x: 0, y: -1 }, grid);
    expect(result.position.y).toBeGreaterThanOrEqual(52);
    const npcResult = movePlayer({ x: 24, y: 40 }, { x: 1, y: 0 }, grid);
    expect(npcResult.position.x).toBeLessThan(34);
  });

  it("自定义速度也受每轴每步 4px 上限约束", () => {
    const result = movePlayer({ x: 32, y: 32 }, { x: 1, y: 1 }, openGrid(), 10_000);
    expect(Math.abs(result.moved.x)).toBeLessThanOrEqual(MAX_AXIS_SWEEP_PER_STEP);
    expect(Math.abs(result.moved.y)).toBeLessThanOrEqual(MAX_AXIS_SWEEP_PER_STEP);
  });
});
