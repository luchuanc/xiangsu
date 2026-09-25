import { describe, expect, it } from "vitest";

import { frozenErrorTemplateKeys, localeCounts, zhCN, validateLocale } from "../../src/content/locales/zh-CN";

describe("zh-CN locale", () => {
  it("has the frozen tag and skill-family keys", () => {
    const result = validateLocale(zhCN);
    expect(result.ok).toBe(true);
    expect(zhCN["tag.area"]).toBe("范围");
    expect(zhCN["skill_family.area"]).toBe("范围技能");
    expect(frozenErrorTemplateKeys).toHaveLength(60);
    expect(localeCounts).toEqual({
      contentNames: 348,
      contentDescriptions: 206,
      dialogues: 7,
      locks: 2,
      comboTags: 34,
      skillFamilies: 25,
      skillAffixTargets: 3,
      modifiers: 12,
      skillAffixOperations: 9,
      errorTemplates: 60,
    });
  });

  it("rejects missing, extra, raw-ID, and token mismatches", () => {
    const missing = { ...zhCN };
    delete missing["tag.area"];
    expect(validateLocale(missing).ok).toBe(false);

    const extra = { ...zhCN, "tag.extra": "额外" };
    expect(validateLocale(extra).ok).toBe(false);

    const raw = { ...zhCN, "tag.area": "tag.area" };
    expect(validateLocale(raw).ok).toBe(false);

    for (const rawId of ["skill_fire_ball", "effect_ember_echo_burst", "eq_sword_t1_windblade", "af_vitality", "tr_bleed_edge", "sa_ember_focus", "boss_horned_king", "modifier_assault", "recruit_priest_first_elite"]) {
      const embeddedRaw = { ...zhCN, "tag.area": `内部 ${rawId} 不应展示` };
      expect(validateLocale(embeddedRaw).ok, rawId).toBe(false);
    }

    const tokens = { ...zhCN, "battle.enrage.countdown": "狂暴 {unknown} 轮" };
    expect(validateLocale(tokens).ok).toBe(false);

    const missingToken = { ...zhCN, "error.FLOOR_LOCKED": "楼层未解锁" };
    expect(validateLocale(missingToken).ok).toBe(false);

    const extraToken = { ...zhCN, "error.INVALID_CONTENT": "内容错误 {path}" };
    expect(validateLocale(extraToken).ok).toBe(false);
  });

  it("rejects replacing a frozen key even when the total count stays unchanged", () => {
    const replaced = { ...zhCN };
    delete replaced["error.WEAPON_NOT_ALLOWED"];
    replaced["error.UNKNOWN"] = "未知错误";
    expect(validateLocale(replaced).ok).toBe(false);
  });
});
