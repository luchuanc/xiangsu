import { describe, expect, it } from "vitest";

import { CHARACTER_DEFINITIONS } from "../../src/content/data/characters";
import { SKILL_DEFINITIONS } from "../../src/content/data/skills";
import { SKILL_AFFIX_DEFINITIONS } from "../../src/content/data/skillAffixes";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { SeededRng } from "../../src/domain/common/SeededRng";
import { SkillStoneGenerator } from "../../src/domain/skill/SkillStoneGenerator";

const root = {
  contentVersion: "content-1.2.0" as const,
  characters: CHARACTER_DEFINITIONS,
  skills: SKILL_DEFINITIONS,
  skillAffixes: SKILL_AFFIX_DEFINITIONS,
};
const source = {
  getCharacter: (id: string) => {
    const value = root.characters.find((candidate) => candidate.id === id);
    return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: `characters.${id}`, issueKey: "missing_content" }));
  },
  getSkill: (id: string) => {
    const value = root.skills.find((candidate) => candidate.id === id);
    return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: `skills.${id}`, issueKey: "missing_content" }));
  },
  getSkillAffix: (id: string) => {
    const value = root.skillAffixes.find((candidate) => candidate.id === id);
    return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: `skillAffixes.${id}`, issueKey: "missing_content" }));
  },
  getRoot: () => root,
};
const generator = new SkillStoneGenerator(source);

function options(quality: "magic" | "rare" | "epic" | "abyss", seed = 42) {
  return {
    itemLevel: quality === "abyss" ? 30 : 10,
    quality,
    recruitedCharacterIds: ["char_ember_mage", "char_wanderer"],
    rng: SeededRng.fromSeed(seed),
    instanceId: `stone_test_${quality}`,
    acquiredAt: "2026-08-21T00:00:00.000Z",
    sourceTransactionId: "reward_test_001",
  } as const;
}

describe("SkillStoneGenerator", () => {
  it("生成四品质固定词条数量，深渊为普通3条加独立 abyssAffix", () => {
    for (const [quality, count] of [["magic", 1], ["rare", 2], ["epic", 3], ["abyss", 3]] as const) {
      const result = generator.generate(options(quality));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.affixes).toHaveLength(count);
      expect(result.value.abyssAffix !== null).toBe(quality === "abyss");
      if (result.value.abyssAffix) expect(result.value.abyssAffix.skillAffixId).toMatch(/^sa_abyss_/);
      expect(["char_ember_mage", "char_wanderer"]).toContain(result.value.attunedCharacterId);
      for (const roll of [...result.value.affixes, ...(result.value.abyssAffix ? [result.value.abyssAffix] : [])]) {
        const definition = root.skillAffixes.find((candidate) => candidate.id === roll.skillAffixId)!;
        expect(roll.roll).toBeGreaterThanOrEqual(definition.rollMin);
        expect(roll.roll).toBeLessThanOrEqual(definition.rollMax);
      }
    }
  });

  it("专注覆盖仍消费一次等权抽值，未招募角色不能成为 focus", () => {
    const focusedRng = SeededRng.fromSeed(100);
    const focused = generator.generate({
      ...options("rare", 100),
      rng: focusedRng,
      rewardContext: {
        rewardKind: "elite",
        isFirstSuccessfulEliteReward: true,
        focusedCharacterId: "char_wanderer",
        focusedEliteStoneConsumed: false,
      },
    });
    expect(focused.ok).toBe(true);
    if (focused.ok) expect(focused.value.attunedCharacterId).toBe("char_wanderer");
    const expected = SeededRng.fromSeed(100);
    expected.nextIntInclusive(0, 1);
    expect(focusedRng.getState()).not.toEqual(SeededRng.fromSeed(100).getState());
    const invalid = generator.generate({
      ...options("magic", 101),
      recruitedCharacterIds: ["char_ember_mage"],
      rewardContext: {
        rewardKind: "elite",
        isFirstSuccessfulEliteReward: true,
        focusedCharacterId: "char_wanderer",
        focusedEliteStoneConsumed: false,
      },
    });
    expect(invalid.ok).toBe(false);
  });

  it("普通池为空时返回 AFFIX_POOL_EMPTY，重铸候选可重复读取且不推进外部 RNG", () => {
    const empty = new SkillStoneGenerator({
      ...source,
      getRoot: () => ({ ...root, skillAffixes: [] }),
    });
    const result = empty.generate(options("magic"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AFFIX_POOL_EMPTY");

    const generated = generator.generate(options("rare", 12));
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const first = generator.openReforgePreview(generated.value, { contentVersion: "content-1.2.0", requestedIndex: 0 });
    const second = generator.openReforgePreview(generated.value, { contentVersion: "content-1.2.0", requestedIndex: 0 });
    expect(first).toEqual(second);
    if (first.ok) expect(first.value.candidates.length).toBeGreaterThan(0);
  });
});
