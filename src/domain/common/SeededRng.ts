/** 无符号 32 位整数的最大值。 */
export const UINT32_MAX = 0xffff_ffff;
/** xoshiro 每次抽取可覆盖的总整数数量。 */
export const UINT32_RANGE_SIZE = 0x1_0000_0000;

export type RngState = readonly [number, number, number, number];

export interface WeightedChoice<T> {
  readonly value: T;
  readonly weight: number;
}

function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} 必须是整数`);
  }
}

/** 校验可以进入 RNG 状态或种子展开的 uint32。 */
export function assertUint32(value: number, name = "value"): void {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new RangeError(`${name} 必须是 0～${UINT32_MAX} 的 uint32`);
  }
}

function normalizeState(state: readonly number[]): RngState {
  if (state.length !== 4) {
    throw new RangeError("RNG 状态必须恰好包含 4 个 uint32");
  }

  state.forEach((value, index) => assertUint32(value, `state[${index}]`));
  if (state.every((value) => value === 0)) {
    throw new RangeError("RNG 状态不能是全零");
  }

  return [state[0], state[1], state[2], state[3]];
}

/** SplitMix32 用于把一个 uint32 种子展开为四个状态字。 */
export function splitMix32(seed: number): () => number {
  assertUint32(seed, "seed");
  let x = seed;

  return () => {
    x = (x + 0x9e37_79b9) >>> 0;
    let z = Math.imul((x ^ (x >>> 16)) >>> 0, 0x21f0_aaad) >>> 0;
    z = Math.imul((z ^ (z >>> 15)) >>> 0, 0x735a_2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/** 对字节执行规范中的 FNV-1a 32 位 hash。 */
export function fnv1a32(bytes: Uint8Array): number {
  let hash = 0x811c_9dc5;
  for (const byte of bytes) {
    hash = Math.imul((hash ^ byte) >>> 0, 0x0100_0193) >>> 0;
  }

  return hash >>> 0;
}

function rotateLeft32(value: number, shift: number): number {
  const left = (value << shift) >>> 0;
  const right = value >>> (32 - shift);
  return (left | right) >>> 0;
}

/**
 * 可序列化的 xoshiro128** 随机流。
 * 所有随机边界都在这里统一实现，领域层不再自行抽取随机数。
 */
export class SeededRng {
  private state: [number, number, number, number];

  public constructor(seedOrState: number | RngState) {
    if (typeof seedOrState === "number") {
      const next = splitMix32(seedOrState);
      const expanded: RngState = [next(), next(), next(), next()];
      const seedState = expanded.every((value) => value === 0)
        ? ([0x9e37_79b9, 0x243f_6a88, 0xb7e1_5162, 0xdead_beef] as const)
        : expanded;
      this.state = [...normalizeState(seedState)] as [
        number,
        number,
        number,
        number,
      ];
      return;
    }

    if (!Array.isArray(seedOrState)) {
      throw new TypeError("RNG 构造参数必须是 uint32 seed 或四元状态");
    }

    this.state = [...normalizeState(seedOrState)] as [
      number,
      number,
      number,
      number,
    ];
  }

  public static fromSeed(seed: number): SeededRng {
    return new SeededRng(seed);
  }

  public static fromState(state: RngState): SeededRng {
    return new SeededRng(state);
  }

  /** 返回副本，避免调用方修改 RNG 内部状态。 */
  public getState(): RngState {
    return [this.state[0], this.state[1], this.state[2], this.state[3]];
  }

  /** 以适合写入快照的数组形式读取当前状态。 */
  public get stateSnapshot(): RngState {
    return this.getState();
  }

  /** xoshiro128** 单步，返回 uint32 并推进当前状态。 */
  public nextUint32(): number {
    const [s0, s1, s2, s3] = this.state;
    const result = Math.imul(rotateLeft32(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;

    this.state[2] = (s2 ^ s0) >>> 0;
    this.state[3] = (s3 ^ s1) >>> 0;
    this.state[1] = (s1 ^ this.state[2]) >>> 0;
    this.state[0] = (s0 ^ this.state[3]) >>> 0;
    this.state[2] = (this.state[2] ^ t) >>> 0;
    this.state[3] = rotateLeft32(this.state[3], 11);

    return result;
  }

  /** 在闭区间内使用拒绝采样取得稳定整数。 */
  public nextIntInclusive(min: number, max: number): number {
    assertInteger(min, "min");
    assertInteger(max, "max");
    if (max < min) {
      throw new RangeError("nextIntInclusive 要求 max 不小于 min");
    }

    const span = max - min + 1;
    if (!Number.isSafeInteger(span) || span < 1 || span > UINT32_RANGE_SIZE) {
      throw new RangeError("闭区间长度必须是 1～2^32 的整数");
    }

    const limit = Math.floor(UINT32_RANGE_SIZE / span) * span;
    let draw = this.nextUint32();
    while (draw >= limit) {
      draw = this.nextUint32();
    }

    return min + (draw % span);
  }

  /** 统一的 basis-point 概率抽取规则。 */
  public rollBps(chanceBps: number): boolean {
    assertInteger(chanceBps, "chanceBps");
    if (chanceBps < 0 || chanceBps > 10_000) {
      throw new RangeError("chanceBps 必须位于 0～10000");
    }
    if (chanceBps === 0) {
      return false;
    }
    if (chanceBps === 10_000) {
      return true;
    }

    return this.nextIntInclusive(1, 10_000) <= chanceBps;
  }

  /** chanceBps 是领域侧更直观的同义入口。 */
  public chanceBps(chanceBps: number): boolean {
    return this.rollBps(chanceBps);
  }

  /** 按原数组顺序执行稳定加权抽取。 */
  public pickWeighted<T>(choices: readonly WeightedChoice<T>[]): T {
    if (choices.length === 0) {
      throw new RangeError("加权候选数组不能为空");
    }

    let sumWeights = 0;
    for (const choice of choices) {
      assertInteger(choice.weight, "weight");
      if (choice.weight < 0) {
        throw new RangeError("权重不能为负数");
      }
      sumWeights += choice.weight;
      if (sumWeights > UINT32_RANGE_SIZE) {
        throw new RangeError("权重总和必须不超过 2^32");
      }
    }
    if (sumWeights <= 0) {
      throw new RangeError("权重总和必须为正数");
    }

    const roll = this.nextIntInclusive(1, sumWeights);
    let cumulative = 0;
    for (const choice of choices) {
      if (choice.weight === 0) {
        continue;
      }
      cumulative += choice.weight;
      if (roll <= cumulative) {
        return choice.value;
      }
    }

    throw new Error("加权抽取未找到候选，权重数据不一致");
  }

  /** 由当前状态和 UTF-8 namespace 派生独立子流，不推进父流。 */
  public derive(namespace: string): SeededRng {
    if (typeof namespace !== "string") {
      throw new TypeError("namespace 必须是字符串");
    }

    const bytes = new Uint8Array(16);
    this.state.forEach((value, stateIndex) => {
      const offset = stateIndex * 4;
      bytes[offset] = value & 0xff;
      bytes[offset + 1] = (value >>> 8) & 0xff;
      bytes[offset + 2] = (value >>> 16) & 0xff;
      bytes[offset + 3] = (value >>> 24) & 0xff;
    });
    const namespaceBytes = new TextEncoder().encode(namespace);
    const hashInput = new Uint8Array(bytes.length + namespaceBytes.length);
    hashInput.set(bytes);
    hashInput.set(namespaceBytes, bytes.length);

    return SeededRng.fromSeed(fnv1a32(hashInput));
  }
}
