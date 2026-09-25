import { describe, expect, it } from "vitest";

import type {
  CharacterDefinition,
  CharacterProgressV1,
  SkillDefinition,
  StatBlock,
} from "../../src/content/contracts";
import { fixtureContentRoot } from "../../src/content/data";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import {
  createCharacterProgress,
  MAX_CHARACTER_XP,
} from "../../src/domain/character/Character";
import {
  awardExperience,
  createCaughtUpRecruit,
  experienceThresholdForLevel,
  levelFromExperience,
  nextLevelExperience,
  ProgressionService,
} from "../../src/domain/character/ProgressionService";

const baseStats: StatBlock = {
  maxHp: 100,
  attack: 10,
  defense: 10,
  speed: 10,
  critRateBps: 0,
  critDamageBps: 15_000,
  effectHitBps: 0,
  effectResistBps: 0,
};
const growth: StatBlock = {
  maxHp: 10,
  attack: 2,
  defense: 3,
  speed: 1,
  critRateBps: 0,
  critDamageBps: 0,
  effectHitBps: 0,
  effectResistBps: 0,
};

const character: CharacterDefinition = {
  ...fixtureContentRoot.characters[0],
  baseStats,
  growthPerLevel: growth,
};
const passive: SkillDefinition = {
  ...fixtureContentRoot.skills.find((skill) => skill.id === character.passiveSkillId)!,
  passiveModifiers: [{ kind: "flatStat", stat: "maxHp", value: 5 }],
};

const content = {
  getCharacter: (id: string) => id === character.id ? success(character) : failure(createDomainError("INVALID_CONTENT", { path: `characters.${id}`, issueKey: "missing_content" })),
  getSkill: (id: string) => id === passive.id ? success(passive) : failure(createDomainError("INVALID_CONTENT", { path: `skills.${id}`, issueKey: "missing_content" })),
};
const service = new ProgressionService(content);

function progress(overrides: Partial<CharacterProgressV1> = {}): CharacterProgressV1 {
  const created = createCharacterProgress(character, {
    recruited: true,
    level: 1,
    xp: 0,
    currentHp: 100,
    skillPoints: 0,
  });
  if (!created.ok) throw new Error("测试夹具创建失败");
  return { ...created.value, ...overrides, skillLevels: { ...created.value.skillLevels, ...(overrides.skillLevels ?? {}) }, equipmentBySlot: { ...created.value.equipmentBySlot, ...(overrides.equipmentBySlot ?? {}) } };
}

describe("ProgressionService", () => {
  it("固定累计经验阈值、下一级增量和 50 级钳制", () => {
    expect(experienceThresholdForLevel(1)).toBe(0);
    expect(experienceThresholdForLevel(2)).toBe(100);
    expect(experienceThresholdForLevel(3)).toBe(260);
    expect(experienceThresholdForLevel(50)).toBe(75_460);
    expect(nextLevelExperience(1)).toBe(100);
    expect(nextLevelExperience(2)).toBe(160);
    expect(nextLevelExperience(49)).toBe(2_980);
    expect(nextLevelExperience(50)).toBeNull();
    expect(levelFromExperience(MAX_CHARACTER_XP + 9_999)).toBe(50);
  });

  it("升级时只给存活角色补最大生命增量，技能点逐级增加且输入不可变", () => {
    const before = progress({ currentHp: 50 });
    const result = service.awardExperience(before, 260, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.level).toBe(3);
    expect(result.value.xp).toBe(260);
    expect(result.value.skillPoints).toBe(2);
    expect(result.value.currentHp).toBe(70);
    expect(before.level).toBe(1);
    expect(before.xp).toBe(0);
    expect(before.currentHp).toBe(50);

    const defeated = progress({ currentHp: 0 });
    const defeatedResult = service.awardExperience(defeated, 260, true);
    expect(defeatedResult.ok).toBe(true);
    if (defeatedResult.ok) expect(defeatedResult.value).toMatchObject({ level: 3, xp: 260, currentHp: 0, skillPoints: 2 });
  });

  it("出战给 100%、已招募未出战向下取整 50%、未招募为 0", () => {
    const full = service.awardExperience(progress(), 101, true);
    const half = service.awardExperience(progress(), 101, false);
    const unrecruited = progress({ recruited: false });
    const none = service.awardExperience(unrecruited, 101, false);
    expect(full.ok && full.value.xp).toBe(101);
    expect(half.ok && half.value.xp).toBe(50);
    expect(none.ok && none.value.xp).toBe(0);
    expect(none.ok && none.value.level).toBe(1);
  });

  it("50 级不继续累加经验，追赶招募在 Lv1/12/25/50 写入完整空 loadout", () => {
    const cappedInvalid = service.awardExperience(progress({ level: 50, xp: MAX_CHARACTER_XP, currentHp: 600 }), 100_000, true);
    expect(cappedInvalid.ok).toBe(false); // currentHp 不能超过包含被动后的 Lv50 maxHp，非法输入先阻断

    const validCapped = progress({ level: 50, xp: MAX_CHARACTER_XP, currentHp: 1, skillPoints: 49 });
    const cappedResult = service.awardExperience(validCapped, 100_000, true);
    expect(cappedResult.ok).toBe(true);
    if (cappedResult.ok) expect(cappedResult.value).toMatchObject({ level: 50, xp: MAX_CHARACTER_XP, currentHp: 1, skillPoints: 49 });

    for (const level of [1, 12, 25, 50]) {
      const caught = createCaughtUpRecruit(content, character.id, level);
      expect(caught.ok).toBe(true);
      if (!caught.ok) continue;
      expect(caught.value).toMatchObject({ characterId: character.id, recruited: true, level, xp: experienceThresholdForLevel(level), skillPoints: level - 1, currentHp: 100 + 5 + (level - 1) * 10, equippedActiveSkillIds: [null, null], skillStoneInstanceId: null });
      expect(Object.values(caught.value.skillLevels)).toEqual([0, 0, 0, 0]);
      expect(Object.values(caught.value.equipmentBySlot)).toEqual([null, null, null, null, null, null]);
    }
  });

  it("未知角色、非法等级和非整数经验都返回 INVALID_CONTENT", () => {
    const unknown = createCaughtUpRecruit(content, "char_unknown", 1);
    const invalidLevel = createCaughtUpRecruit(content, character.id, 12.5);
    const invalidAmount = awardExperience(content, progress(), 1.5, true);
    const invalidRecruited = { ...progress(), recruited: "yes" } as unknown as CharacterProgressV1;
    const invalidRecruitedResult = awardExperience(content, invalidRecruited, 1, true);
    expect(unknown.ok).toBe(false);
    expect(invalidLevel.ok).toBe(false);
    expect(invalidAmount.ok).toBe(false);
    expect(invalidRecruitedResult.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("INVALID_CONTENT");
    if (!invalidAmount.ok) expect(invalidAmount.error.code).toBe("INVALID_CONTENT");
    if (!invalidRecruitedResult.ok) expect(invalidRecruitedResult.error.code).toBe("INVALID_CONTENT");
  });
});
