import { describe, expect, it } from "vitest";

import type { CharacterDefinition, StatBlock } from "../../src/content/contracts";
import { fixtureContentRoot } from "../../src/content/data";
import { calculateStats } from "../../src/domain/character/StatCalculator";

const baseStats: StatBlock = {
  maxHp: 100,
  attack: 10,
  defense: 12,
  speed: 8,
  critRateBps: 1_000,
  critDamageBps: 15_000,
  effectHitBps: 2_000,
  effectResistBps: 3_000,
};

const growthPerLevel: StatBlock = {
  maxHp: 10,
  attack: 3,
  defense: 2,
  speed: 1,
  critRateBps: 100,
  critDamageBps: 0,
  effectHitBps: 200,
  effectResistBps: 150,
};

const character: CharacterDefinition = {
  ...fixtureContentRoot.characters[0],
  baseStats,
  growthPerLevel,
};

describe("StatCalculator", () => {
  it("按 Lv1/Lv2/Lv50 的累计成长和整数百分比生成可解释明细", () => {
    const levelOne = calculateStats(character, 1, {
      flat: { maxHp: 7, attack: 1 },
      percentBps: { maxHp: 500, attack: 1_000 },
    });
    const levelTwo = calculateStats(character, 2);
    const levelFifty = calculateStats(character, 50);

    expect(levelOne.ok).toBe(true);
    expect(levelTwo.ok).toBe(true);
    expect(levelFifty.ok).toBe(true);
    if (!levelOne.ok || !levelTwo.ok || !levelFifty.ok) return;

    expect(levelOne.value.prePercentStats).toMatchObject({ maxHp: 107, attack: 11 });
    expect(levelOne.value.staticPercentByStatBps).toMatchObject({ maxHp: 500, attack: 1_000 });
    expect(levelOne.value.postPercentStats).toMatchObject({ maxHp: 112, attack: 12 });
    expect(levelOne.value.stats).toMatchObject({ maxHp: 112, attack: 12, critDamageBps: 15_000 });
    expect(levelOne.value.sources.maxHp).toEqual({
      base: 100,
      growth: 0,
      flat: 7,
      prePercent: 107,
      percentBps: 500,
      postPercent: 112,
      final: 112,
    });

    expect(levelTwo.value.prePercentStats).toMatchObject({ maxHp: 110, attack: 13, defense: 14, speed: 9 });
    expect(levelTwo.value.stats).toMatchObject({ maxHp: 110, attack: 13, defense: 14, speed: 9 });
    expect(levelFifty.value.prePercentStats).toMatchObject({ maxHp: 590, attack: 157, defense: 110, speed: 57 });
    expect(levelFifty.value.stats).toMatchObject({ maxHp: 590, attack: 157, defense: 110, speed: 57 });
  });

  it("按 stat 类型应用最小值和 bps 范围 clamp，不引入浮点字段", () => {
    const result = calculateStats({
      ...character,
      baseStats: {
        ...baseStats,
        maxHp: -100,
        attack: 0,
        defense: 0,
        speed: 0,
        critRateBps: -1,
        critDamageBps: 1,
        effectHitBps: 20_000,
        effectResistBps: -20_000,
      },
    }, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stats).toEqual({
      maxHp: 1,
      attack: 1,
      defense: 1,
      speed: 1,
      critRateBps: 0,
      critDamageBps: 10_000,
      effectHitBps: 10_000,
      effectResistBps: 0,
    });
    for (const value of Object.values(result.value.stats)) expect(Number.isInteger(value)).toBe(true);
  });

  it("拒绝非法等级和非整数 modifier，而不是猜测或静默修正", () => {
    expect(calculateStats(character, 0).ok).toBe(false);
    expect(calculateStats(character, 51).ok).toBe(false);
    expect(calculateStats(character, 1, { flat: { attack: 1.5 } }).ok).toBe(false);
    expect(calculateStats(character, 1, { percentBps: { speed: 0.5 } }).ok).toBe(false);
  });
});

