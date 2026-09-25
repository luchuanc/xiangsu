import { describe, expect, it } from "vitest";
import { InputState } from "../../src/app/input/InputState";

describe("InputState", () => {
  it("固定步返回归一化移动向量，并一次性消费 action", () => {
    const state = new InputState();
    state.setMove(3, 4);
    state.press("interact");

    const first = state.snapshot();
    expect(first.frameNo).toBe(1);
    expect(first.move).toEqual({ x: 0.6, y: 0.8 });
    expect(first.actions).toEqual(["interact"]);
    expect(state.snapshot()).toEqual({
      frameNo: 2,
      move: { x: 0.6, y: 0.8 },
      actions: [],
    });
  });

  it("同一 pointer 只能被一个控件占用，resetAll 清空所有持续状态", () => {
    const state = new InputState();
    expect(state.claimPointer(7)).toBe(true);
    expect(state.claimPointer(7)).toBe(false);
    expect(state.isPointerClaimed(7)).toBe(true);
    state.setMove(1, 0);
    state.press("attack");

    state.resetAll();

    expect(state.activePointerCount).toBe(0);
    expect(state.snapshot()).toEqual({
      frameNo: 2,
      move: { x: 0, y: 0 },
      actions: [],
    });
  });

  it("忽略非有限轴值并限制动作重复触发", () => {
    const state = new InputState();
    state.setMove(Number.NaN, Number.POSITIVE_INFINITY);
    state.press("confirm");
    state.press("confirm");

    expect(state.snapshot()).toEqual({
      frameNo: 1,
      move: { x: 0, y: 0 },
      actions: ["confirm"],
    });
  });
});
