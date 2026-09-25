import { describe, expect, it } from "vitest";

import { BALANCE_PROFILES, buildBalanceProfiles, deriveBalanceSeed, runBalanceSimulation } from "../../scripts/run-balance-simulation";

describe("PROFILE-1.2 balance smoke", () => {
  it("输出四档固定 schema，profile 名不进入配对 seed", () => {
    expect(BALANCE_PROFILES).toEqual(["lagging", "ready", "breakthrough", "alternative"]);
    const profiles = buildBalanceProfiles(3);
    expect(profiles.map((profile) => profile.profile)).toEqual(BALANCE_PROFILES);
    expect(deriveBalanceSeed(3, 7)).toEqual(deriveBalanceSeed(3, 7));
    expect(deriveBalanceSeed(3, 7, "ready")).toEqual(deriveBalanceSeed(3, 7, "breakthrough"));
    expect(runBalanceSimulation({ fixture: "smoke", floors: [1], seeds: 3 })).toMatchObject({ ok: true, value: { blocked: true, reason: "MISSING_FORMAL_CONTENT_BATCH" } });
  });

  it("固定楼层等级、装备等级与队伍构成，不允许用通用公式漂移", () => {
    expect(buildBalanceProfiles(1)).toEqual([
      { profile: "lagging", floorNumber: 1, level: 2, itemLevel: null, party: ["char_wanderer", "char_iron_guard", "char_ember_mage", null] },
      { profile: "ready", floorNumber: 1, level: 4, itemLevel: 3, party: ["char_wanderer", "char_iron_guard", "char_ember_mage", null] },
      { profile: "breakthrough", floorNumber: 1, level: 4, itemLevel: 3, party: ["char_wanderer", "char_iron_guard", "char_ember_mage", null] },
      { profile: "alternative", floorNumber: 1, level: 4, itemLevel: 3, party: ["char_wanderer", "char_iron_guard", "char_ember_mage", null] },
    ]);
    expect(buildBalanceProfiles(9).map(({ profile, level, itemLevel, party }) => ({ profile, level, itemLevel, party }))).toEqual([
      { profile: "lagging", level: 41, itemLevel: 38, party: ["char_wanderer", "char_frost_seer", "char_ranger", "char_ember_mage"] },
      { profile: "ready", level: 43, itemLevel: 43, party: ["char_wanderer", "char_frost_seer", "char_ranger", "char_ember_mage"] },
      { profile: "breakthrough", level: 43, itemLevel: 43, party: ["char_wanderer", "char_frost_seer", "char_ranger", "char_ember_mage"] },
      { profile: "alternative", level: 43, itemLevel: 43, party: ["char_wanderer", "char_frost_seer", "char_ranger", "char_ember_mage"] },
    ]);
    expect(buildBalanceProfiles(10).map(({ profile, level, itemLevel, party }) => ({ profile, level, itemLevel, party }))).toEqual([
      { profile: "lagging", level: 48, itemLevel: 43, party: ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"] },
      { profile: "ready", level: 50, itemLevel: 48, party: ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"] },
      { profile: "breakthrough", level: 50, itemLevel: 48, party: ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"] },
      { profile: "alternative", level: 50, itemLevel: 48, party: ["char_wanderer", "char_ranger", "char_frost_seer", "char_ember_mage"] },
    ]);
  });
});
