import { describe, expect, it } from "vitest";

import {
  fnv1a32,
  SeededRng,
  UINT32_MAX,
  UINT32_RANGE_SIZE,
  type RngState,
  type WeightedChoice,
} from "../../src/domain/common/SeededRng";

const INITIAL_STATE: RngState = [
  2_986_037_511,
  744_488_920,
  2_204_577_711,
  2_810_942_300,
];

describe("SeededRng", () => {
  it("锁定 seed 0x12345678 的初始状态、20 个输出和最终状态", () => {
    const rng = SeededRng.fromSeed(0x12345678);
    expect(rng.getState()).toEqual(INITIAL_STATE);
    const outputs = Array.from({ length: 20 }, () => rng.nextUint32());

    expect(rng.getState()).toEqual([
      3_436_654_534,
      1_636_222_966,
      3_049_801_367,
      838_880_439,
    ]);
    expect(outputs).toEqual([
      1_878_818_782,
      786_455_212,
      462_225_631,
      2_155_212_579,
      411_377_898,
      3_167_696_138,
      1_785_522_653,
      3_592_849_924,
      609_211_532,
      3_713_860_673,
      3_931_107_074,
      3_110_254_264,
      3_169_712_676,
      3_032_225_663,
      45_091_845,
      1_211_551_780,
      185_791_654,
      443_690_745,
      1_454_244_678,
      2_582_382_595,
    ]);
  });

  it("可以从保存状态恢复同一条随机流", () => {
    const source = SeededRng.fromState(INITIAL_STATE);
    source.nextUint32();
    const saved = source.getState();
    const restored = SeededRng.fromState(saved);

    expect(Array.from({ length: 16 }, () => restored.nextUint32())).toEqual(
      Array.from({ length: 16 }, () => source.nextUint32()),
    );
  });

  it("derive loot 使用固定 FNV-1a hash，不推进父流", () => {
    const parent = SeededRng.fromState(INITIAL_STATE);
    const before = parent.getState();
    const child = parent.derive("loot");
    const stateBytes = new Uint8Array(16);
    INITIAL_STATE.forEach((value, stateIndex) => {
      const offset = stateIndex * 4;
      stateBytes[offset] = value & 0xff;
      stateBytes[offset + 1] = (value >>> 8) & 0xff;
      stateBytes[offset + 2] = (value >>> 16) & 0xff;
      stateBytes[offset + 3] = (value >>> 24) & 0xff;
    });
    const namespaceBytes = new TextEncoder().encode("loot");
    const hashInput = new Uint8Array(stateBytes.length + namespaceBytes.length);
    hashInput.set(stateBytes);
    hashInput.set(namespaceBytes, stateBytes.length);

    expect(parent.getState()).toEqual(before);
    expect(fnv1a32(hashInput)).toBe(3_284_357_482);
    expect(child.getState()).toEqual([
      195_995_783,
      4_150_676_434,
      722_383_666,
      719_531_309,
    ]);
    expect(parent.derive("loot").getState()).toEqual(child.getState());
    expect(parent.derive("loot-雪").getState()).not.toEqual(child.getState());
  });

  it("概率边界 0/10000 不消费，1/9999 按 draw 精确判定且只消费一次", () => {
    class ControlledRng extends SeededRng {
      private readonly draws: number[];
      private calls = 0;

      public constructor(draws: number[]) {
        super(INITIAL_STATE);
        this.draws = draws;
      }

      public override nextUint32(): number {
        this.calls += 1;
        const draw = this.draws.shift();
        if (draw === undefined) {
          throw new Error("测试 draw 已耗尽");
        }

        return draw;
      }

      public get drawCount(): number {
        return this.calls;
      }
    }

    const zero = SeededRng.fromState(INITIAL_STATE);
    expect(zero.chanceBps(0)).toBe(false);
    expect(zero.getState()).toEqual(INITIAL_STATE);

    const full = SeededRng.fromState(INITIAL_STATE);
    expect(full.chanceBps(10_000)).toBe(true);
    expect(full.getState()).toEqual(INITIAL_STATE);

    const chanceOneTrue = new ControlledRng([0]);
    expect(chanceOneTrue.chanceBps(1)).toBe(true);
    expect(chanceOneTrue.drawCount).toBe(1);
    const chanceOneFalse = new ControlledRng([1]);
    expect(chanceOneFalse.chanceBps(1)).toBe(false);
    expect(chanceOneFalse.drawCount).toBe(1);
    const chance9999True = new ControlledRng([9_998]);
    expect(chance9999True.chanceBps(9_999)).toBe(true);
    expect(chance9999True.drawCount).toBe(1);
    const chance9999False = new ControlledRng([9_999]);
    expect(chance9999False.chanceBps(9_999)).toBe(false);
    expect(chance9999False.drawCount).toBe(1);
  });

  it("拒绝采样会丢弃 draw>=limit 后再返回闭区间结果", () => {
    class StubRng extends SeededRng {
      private readonly draws: number[] = [0xffff_ffff, 7];

      public override nextUint32(): number {
        const draw = this.draws.shift();
        if (draw === undefined) {
          throw new Error("测试 draw 已耗尽");
        }

        return draw;
      }

      public get drawCount(): number {
        return 2 - this.draws.length;
      }
    }

    const rng = new StubRng(INITIAL_STATE);
    expect(rng.nextIntInclusive(0, 9)).toBe(7);
    expect(rng.drawCount).toBe(2);
  });

  it("按原数组顺序做稳定加权选择，单一候选也消费一次", () => {
    class ControlledRng extends SeededRng {
      private readonly draw: number;

      public constructor(draw: number) {
        super(INITIAL_STATE);
        this.draw = draw;
      }

      public override nextUint32(): number {
        return this.draw;
      }
    }

    const choices: readonly WeightedChoice<string>[] = [
      { value: "a", weight: 1 },
      { value: "b", weight: 2 },
      { value: "c", weight: 3 },
    ];

    expect(new ControlledRng(0).pickWeighted(choices)).toBe("a");
    expect(new ControlledRng(1).pickWeighted(choices)).toBe("b");
    expect(new ControlledRng(2).pickWeighted(choices)).toBe("b");
    expect(new ControlledRng(3).pickWeighted(choices)).toBe("c");
    expect(new ControlledRng(5).pickWeighted(choices)).toBe("c");
    expect(
      new ControlledRng(0).pickWeighted([
        { value: "first", weight: 1 },
        { value: "zero", weight: 0 },
        { value: "second", weight: 1 },
      ]),
    ).toBe("first");
    expect(
      new ControlledRng(1).pickWeighted([
        { value: "first", weight: 1 },
        { value: "zero", weight: 0 },
        { value: "second", weight: 1 },
      ]),
    ).toBe("second");

    const only = SeededRng.fromState(INITIAL_STATE);
    const before = only.getState();
    expect(only.pickWeighted([{ value: "only", weight: 1 }])).toBe("only");
    expect(only.getState()).not.toEqual(before);

    const fullRange = [
      { value: "max", weight: UINT32_MAX },
      { value: "last", weight: 1 },
    ] as const;
    expect(new ControlledRng(0).pickWeighted(fullRange)).toBe("max");
    expect(new ControlledRng(UINT32_MAX).pickWeighted(fullRange)).toBe("last");
    expect(UINT32_RANGE_SIZE).toBe(UINT32_MAX + 1);
  });

  it("拒绝非法状态、范围、概率和权重", () => {
    expect(() => SeededRng.fromState([0, 0, 0, 0])).toThrow();
    expect(() => SeededRng.fromState([1, 2, 3, 4.5])).toThrow();
    expect(() => SeededRng.fromState([1, 2, 3, 4_294_967_296])).toThrow();

    const rng = SeededRng.fromState(INITIAL_STATE);
    expect(() => rng.nextIntInclusive(2, 1)).toThrow();
    expect(() => rng.nextIntInclusive(0, 4_294_967_296)).toThrow();
    expect(() => rng.chanceBps(-1)).toThrow();
    expect(() => rng.chanceBps(10_001)).toThrow();
    expect(() => rng.pickWeighted([])).toThrow();
    expect(() => rng.pickWeighted([{ value: "bad", weight: 0 }])).toThrow();
    expect(() =>
      rng.pickWeighted([
        { value: "bad", weight: -1 },
        { value: "also-bad", weight: 0 },
      ]),
    ).toThrow();
  });
});
