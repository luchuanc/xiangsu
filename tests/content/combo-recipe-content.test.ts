import { describe, expect, it } from "vitest";

import { floors02To05Content } from "../../src/content/data/floors02-05";

describe("累计 Combo 可达配方来源", () => {
  it("storm circuit 的暴击与连锁来源分别来自技能和铭石", () => {
    const combo = floors02To05Content.combos.find((value) => value.id === "combo_storm_circuit");
    expect(combo?.requirements).toEqual([
      { source: "equipmentAffix", tagId: "shock", count: 1 },
      { source: "equippedSkill", tagId: "crit", count: 1 },
      { source: "skillAffix", tagId: "chain", count: 1 },
    ]);
  });

  it("perfect strike 的第二个暴击来自固定被动，focus 来自铭石", () => {
    const combo = floors02To05Content.combos.find((value) => value.id === "combo_perfect_strike");
    expect(combo?.requirements).toEqual([
      { source: "equipmentAffix", tagId: "crit", count: 2 },
      { source: "equippedSkill", tagId: "crit", count: 1 },
      { source: "skillAffix", tagId: "focus", count: 1 },
    ]);
  });
});
