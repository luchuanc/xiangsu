import { describe, expect, it } from "vitest";
import {
  calculateViewport,
  getHitAreaThresholds,
} from "../../src/app/ViewportService";

describe("ViewportService", () => {
  it("在 568×320 横屏下保持完整逻辑画布", () => {
    expect(calculateViewport({ width: 568, height: 320 })).toEqual({
      scale: 0.8875,
      offsetX: 0,
      offsetY: 0.25,
      cssWidth: 568,
      cssHeight: 319.5,
      safeRect: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        right: 640,
        bottom: 360,
      },
      blockedReason: null,
    });
  });

  it("在 1024×768 下 contain 居中并保持 640×360", () => {
    const result = calculateViewport({ width: 1024, height: 768 });
    expect(result.scale).toBe(1024 / 640);
    expect(result.cssWidth).toBe(1024);
    expect(result.cssHeight).toBe(576);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(96);
    expect(result.safeRect).toMatchObject({ x: 0, y: 0, width: 640, height: 360 });
    expect(result.blockedReason).toBeNull();
  });

  it.each([
    [{ width: 567, height: 320 }, "tooSmall"],
    [{ width: 568, height: 319 }, "tooSmall"],
    [{ width: 320, height: 568 }, "portrait"],
  ] as const)("阻断 %j 视口", (size, reason) => {
    expect(calculateViewport(size).blockedReason).toBe(reason);
  });

  it("只把侵入 canvas 的安全区换算到逻辑边界，并使用保守取整", () => {
    const result = calculateViewport(
      { width: 844, height: 390 },
      { top: 20, right: 0, bottom: 34, left: 0 },
    );
    expect(result.scale).toBe(390 / 360);
    expect(result.offsetX).toBeCloseTo(75.3333333333);
    expect(result.safeRect).toEqual({
      x: 0,
      y: 19,
      width: 640,
      height: 309,
      right: 640,
      bottom: 328,
    });
  });

  it("安全区无法容纳完整探索 HUD 时沿用 tooSmall 门禁", () => {
    const result = calculateViewport(
      { width: 640, height: 360 },
      { top: 0, right: 0, bottom: 190, left: 0 },
    );
    expect(result.safeRect.height).toBe(170);
    expect(result.blockedReason).toBe("tooSmall");
  });

  it("导出 48/8 CSS px 的逻辑命中门槛", () => {
    expect(getHitAreaThresholds(0.8888888888888888)).toEqual({
      hitSizeLogical: 54,
      gapLogical: 9,
      longPressMoveLogical: 9,
    });
  });

  it("拒绝无效 viewport、inset 和 scale", () => {
    expect(() => calculateViewport({ width: 0, height: 320 })).toThrow(RangeError);
    expect(() => calculateViewport({ width: Number.NaN, height: 320 })).toThrow(RangeError);
    expect(() =>
      calculateViewport({ width: 640, height: 360 }, { top: -1, right: 0, bottom: 0, left: 0 }),
    ).toThrow(RangeError);
    expect(() => getHitAreaThresholds(0)).toThrow(RangeError);
  });
});
