import { describe, expect, it } from "vitest";

import {
  assertInteger,
  ceilDiv,
  clampInt,
  floorDiv,
  mulBpsFloor,
} from "../../src/domain/common/FixedMath";

describe("FixedMath", () => {
  it("执行整数 clamp 和 basis-point 向下乘法", () => {
    expect(clampInt(5, 0, 10)).toBe(5);
    expect(clampInt(-1, 0, 10)).toBe(0);
    expect(clampInt(11, 0, 10)).toBe(10);
    expect(mulBpsFloor(0, 5_000)).toBe(0);
    expect(mulBpsFloor(7, 10_000)).toBe(7);
    expect(mulBpsFloor(9, 3_333)).toBe(2);
    expect(mulBpsFloor(-3, 5_000)).toBe(-2);
    expect(mulBpsFloor(10, -1)).toBe(-1);
    expect(mulBpsFloor(10, 12_500)).toBe(12);
    expect(mulBpsFloor(10, 15_000)).toBe(15);
    expect(mulBpsFloor(3, 30_000)).toBe(9);
    expect(mulBpsFloor(-3, 12_500)).toBe(-4);
  });

  it("对正负数提供数学 floor/ceil 整除", () => {
    expect(floorDiv(7, 3)).toBe(2);
    expect(floorDiv(-7, 3)).toBe(-3);
    expect(floorDiv(7, -3)).toBe(-3);
    expect(floorDiv(-7, -3)).toBe(2);
    expect(ceilDiv(7, 3)).toBe(3);
    expect(ceilDiv(-7, 3)).toBe(-2);
    expect(ceilDiv(7, -3)).toBe(-2);
    expect(ceilDiv(-7, -3)).toBe(3);
  });

  it("拒绝非整数、非法范围和非法分母", () => {
    expect(() => assertInteger(1.5, "value")).toThrow();
    expect(() => clampInt(1, 2, 1)).toThrow();
    expect(() => floorDiv(1, 0)).toThrow();
    expect(() => ceilDiv(1, 0)).toThrow();
    expect(() => mulBpsFloor(1.1, 1_000)).toThrow();
  });
});
