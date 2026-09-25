import { webcrypto } from "node:crypto";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  DOMAIN_ERROR_CODES,
  createDomainError,
  failure,
  isFailure,
  isSuccess,
  success,
  type BattlePhase,
  type DomainErrorCode,
  type WeaponType,
} from "../../src/domain/common/DomainResult";
import { DomainEvent } from "../../src/domain/common/DomainEvent";
import {
  CryptoIdFactory,
  DomainContext,
  SequentialIdFactory,
  type IdKind,
} from "../../src/domain/common/DomainContext";

describe("DomainResult 和领域上下文", () => {
  it("严格保留 41 个领域错误码并提供可判别结果 helpers", () => {
    expect(DOMAIN_ERROR_CODES).toHaveLength(41);
    expect(new Set(DOMAIN_ERROR_CODES).size).toBe(41);

    const ok = success({ value: 1 });
    expect(ok).toEqual({ ok: true, value: { value: 1 } });
    expect(isSuccess(ok)).toBe(true);
    expect(isFailure(ok)).toBe(false);

    const error = createDomainError("NOT_IN_TOWN", null);
    const bad = failure(error);
    expect(bad).toEqual({ ok: false, error });
    expect(isFailure(bad)).toBe(true);
    expect(isSuccess(bad)).toBe(false);
  });

  it("DomainEvent 基类恰好只有 eventId 和 sequence", () => {
    const event = new DomainEvent("event_test_1", 3);
    expect(Object.keys(event)).toEqual(["eventId", "sequence"]);
    expect(event).toEqual({ eventId: "event_test_1", sequence: 3 });
    expect(() => new DomainEvent("", 0)).toThrow();
    expect(() => new DomainEvent("event_test_1", -1)).toThrow();
  });

  it("测试 ID factory 按 kind 独立单调递增", () => {
    const factory = new SequentialIdFactory();
    const kinds: readonly IdKind[] = [
      "eq",
      "stone",
      "exp",
      "battle",
      "root",
      "event",
      "reward",
    ];

    for (const kind of kinds) {
      expect(factory.next(kind)).toBe(`${kind}_test_000001`);
      expect(factory.next(kind)).toBe(`${kind}_test_000002`);
    }

    expect(factory.next("eq")).toBe("eq_test_000003");
  });

  it("生产 ID 为七类 kind 逐类添加严格前缀", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const factory = new CryptoIdFactory(() => uuid);
    const kinds: readonly IdKind[] = [
      "eq",
      "stone",
      "exp",
      "battle",
      "root",
      "event",
      "reward",
    ];

    for (const kind of kinds) {
      expect(factory.next(kind)).toBe(`${kind}_${uuid}`);
    }
  });

  it("生产 ID 严格校验小写 RFC 4122 v4，100000 个样本无碰撞", () => {
    vi.stubGlobal("crypto", webcrypto);
    const factory = new CryptoIdFactory();
    const ids = new Set<string>();

    for (let index = 0; index < 100_000; index += 1) {
      const id = factory.next("reward");
      expect(id).toMatch(
        /^reward_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      ids.add(id);
    }

    expect(ids).toHaveLength(100_000);
    expect(() =>
      new CryptoIdFactory(() => "550E8400-E29B-41D4-A716-446655440000").next(
        "eq",
      ),
    ).toThrow();
    expect(() =>
      new CryptoIdFactory(() => "550e8400-e29b-31d4-a716-446655440000").next(
        "eq",
      ),
    ).toThrow();
  }, 30_000);

  it("DomainContext 注入时钟、seed 和 ID，不直接读取环境状态", () => {
    let seedCalls = 0;
    const context = new DomainContext({
      clock: { now: () => "2026-08-20T00:00:00.000Z" },
      idFactory: new SequentialIdFactory(),
      seedFactory: {
        nextUint32: () => {
          seedCalls += 1;
          return 0x12345678;
        },
      },
    });

    expect(context.now()).toBe("2026-08-20T00:00:00.000Z");
    expect(context.nextId("battle")).toBe("battle_test_000001");
    expect(context.nextSeed()).toBe(0x12345678);
    expect(seedCalls).toBe(1);
  });

  it("DomainErrorCode 类型包含契约中的首尾值", () => {
    const first: DomainErrorCode = DOMAIN_ERROR_CODES[0];
    const last: DomainErrorCode = DOMAIN_ERROR_CODES.at(-1)!;
    expect(first).toBe("INVALID_CONTENT");
    expect(last).toBe("ASSET_LOAD_FAILED");
    expectTypeOf<"ROUND_END">().toMatchTypeOf<BattlePhase>();
    expectTypeOf<"focus">().toMatchTypeOf<WeaponType>();
    expectTypeOf<"NOT_A_PHASE">().not.toMatchTypeOf<BattlePhase>();
    expectTypeOf<"axe">().not.toMatchTypeOf<WeaponType>();
    expectTypeOf<BattlePhase>().toEqualTypeOf<
      | "INIT"
      | "ROUND_START"
      | "TURN_START"
      | "AWAIT_COMMAND"
      | "AI_DECIDE"
      | "VALIDATE"
      | "DRAIN_PRE_ACTION"
      | "RESOLVE_ACTION"
      | "DRAIN_TRIGGERS"
      | "TURN_END"
      | "ROUND_END"
      | "VICTORY"
      | "DEFEAT"
      | "RETREAT"
      | "REWARD_PENDING"
      | "COMPLETE"
    >();
  });
});
