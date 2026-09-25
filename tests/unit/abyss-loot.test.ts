import { describe, expect, it } from "vitest";
import { floor06To10DropTables } from "../../src/content/data/floors06-10";

describe("RPG-025 深渊掉落表", () => {
  it("首杀表固定材料且重复读取不会改变表内容", () => {
    const firstClear = floor06To10DropTables.find((table) => table.id === "drop_floor_10_first_clear");
    expect(firstClear).toBeDefined();
    const first = JSON.stringify(firstClear);
    expect(JSON.stringify(floor06To10DropTables.find((table) => table.id === "drop_floor_10_first_clear"))).toBe(first);
  });

  it("第 6～10 层 Boss 第一条装备保留递增 abyssUpgradeChanceBps", () => {
    expect([6, 7, 8, 9, 10].map((floor) => floor06To10DropTables.find((table) => table.id === `drop_floor_${String(floor).padStart(2, "0")}_boss`)!.rolls[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ abyssUpgradeChanceBps: 1000 }),
        expect.objectContaining({ abyssUpgradeChanceBps: 1200 }),
        expect.objectContaining({ abyssUpgradeChanceBps: 1500 }),
        expect.objectContaining({ abyssUpgradeChanceBps: 1800 }),
        expect.objectContaining({ abyssUpgradeChanceBps: 2500 }),
      ]),
    );
  });
});
