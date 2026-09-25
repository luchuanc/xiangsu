import { SeededRng, assertUint32 } from "./SeededRng";

export type IdKind =
  | "eq"
  | "stone"
  | "exp"
  | "battle"
  | "root"
  | "event"
  | "reward";

export const ID_KINDS: readonly IdKind[] = [
  "eq",
  "stone",
  "exp",
  "battle",
  "root",
  "event",
  "reward",
];

export interface Clock {
  now(): string;
}

export interface IdFactory {
  next(kind: IdKind): string;
}

export interface SeedFactory {
  nextUint32(): number;
}

export interface DomainContextOptions {
  readonly clock: Clock;
  readonly idFactory: IdFactory;
  readonly seedFactory: SeedFactory;
}

function assertIdKind(kind: string): asserts kind is IdKind {
  if (!ID_KINDS.includes(kind as IdKind)) {
    throw new RangeError(`不支持的 ID kind: ${kind}`);
  }
}

/** RFC 4122 v4 只接受小写十六进制和合法的版本/变体位。 */
export function isLowercaseUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
}

export class SystemClock implements Clock {
  public now(): string {
    return new Date().toISOString();
  }
}

/** 生产 ID 适配器只调用 Web Crypto 的 randomUUID。 */
export class CryptoIdFactory implements IdFactory {
  private readonly randomUUID: () => string;

  public constructor(randomUUID?: () => string) {
    this.randomUUID =
      randomUUID ??
      (() => {
        const cryptoApi = globalThis.crypto;
        if (typeof cryptoApi?.randomUUID !== "function") {
          throw new Error("当前运行环境不支持 crypto.randomUUID");
        }

        return cryptoApi.randomUUID();
      });
  }

  public next(kind: IdKind): string {
    assertIdKind(kind);
    const uuid = this.randomUUID();
    if (!isLowercaseUuidV4(uuid)) {
      throw new Error("crypto.randomUUID 必须返回小写 RFC 4122 v4 UUID");
    }

    return `${kind}_${uuid}`;
  }
}

/** 测试用按 kind 独立递增的 ID 工厂，不伪装成生产 UUID。 */
export class SequentialIdFactory implements IdFactory {
  private readonly counters = new Map<IdKind, number>();

  public next(kind: IdKind): string {
    assertIdKind(kind);
    const next = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, next);
    return `${kind}_test_${String(next).padStart(6, "0")}`;
  }
}

/** 生产 seed 适配器只调用 Web Crypto 的 getRandomValues。 */
export class CryptoSeedFactory implements SeedFactory {
  private readonly getRandomValues: (array: Uint32Array) => Uint32Array;

  public constructor(
    getRandomValues?: (array: Uint32Array) => Uint32Array,
  ) {
    this.getRandomValues =
      getRandomValues ??
      ((array) => {
        const cryptoApi = globalThis.crypto;
        if (typeof cryptoApi?.getRandomValues !== "function") {
          throw new Error("当前运行环境不支持 crypto.getRandomValues");
        }

        const getRandomValues = cryptoApi.getRandomValues.bind(
          cryptoApi,
        ) as unknown as (target: Uint32Array) => Uint32Array;
        return getRandomValues(array);
      });
  }

  public nextUint32(): number {
    const values = this.getRandomValues(new Uint32Array(1));
    const seed = values[0];
    assertUint32(seed, "seed");
    return seed;
  }
}

/** 领域服务依赖的唯一环境入口，时间、ID 和 seed 均由外部注入。 */
export class DomainContext {
  public readonly clock: Clock;
  public readonly idFactory: IdFactory;
  public readonly seedFactory: SeedFactory;

  public constructor(options: DomainContextOptions) {
    this.clock = options.clock;
    this.idFactory = options.idFactory;
    this.seedFactory = options.seedFactory;
  }

  public now(): string {
    return this.clock.now();
  }

  public nextId(kind: IdKind): string {
    return this.idFactory.next(kind);
  }

  public nextSeed(): number {
    return this.seedFactory.nextUint32();
  }

  /** 创建根流；namespace 由 SeededRng 统一按 UTF-8 规则派生。 */
  public createRng(namespace?: string, seed = this.nextSeed()): SeededRng {
    const root = SeededRng.fromSeed(seed);
    return namespace === undefined ? root : root.derive(namespace);
  }

  /** 从已保存的根流派生子流，不推进根流。 */
  public deriveRng(root: SeededRng, namespace: string): SeededRng {
    return root.derive(namespace);
  }
}

export function createProductionDomainContext(): DomainContext {
  return new DomainContext({
    clock: new SystemClock(),
    idFactory: new CryptoIdFactory(),
    seedFactory: new CryptoSeedFactory(),
  });
}
