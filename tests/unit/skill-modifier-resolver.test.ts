import { describe, expect, it } from "vitest";

import type { SkillStoneInstance } from "../../src/content/contracts";
import { SKILL_AFFIX_DEFINITIONS } from "../../src/content/data/skillAffixes";
import { SKILL_DEFINITIONS } from "../../src/content/data/skills";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { SkillModifierResolver } from "../../src/domain/skill/SkillModifierResolver";

const source = {
  getSkillAffix: (id: string) => {
    const value = SKILL_AFFIX_DEFINITIONS.find((candidate) => candidate.id === id);
    return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: `skillAffixes.${id}`, issueKey: "missing_content" }));
  },
};
const resolver = new SkillModifierResolver(source);

function stone(characterId: string, ids: readonly string[]): SkillStoneInstance {
  return {
    instanceId: "stone_resolver_test",
    attunedCharacterId: characterId,
    itemLevel: 30,
    quality: "abyss",
    affixes: ids.map((skillAffixId) => {
      const definition = SKILL_AFFIX_DEFINITIONS.find((value) => value.id === skillAffixId)
        ?? SKILL_AFFIX_DEFINITIONS.find((value) => value.id === "sa_ember_echo")!;
      return { skillAffixId, roll: definition.rollMin, reforged: false };
    }),
    abyssAffix: null,
    locked: false,
    acquiredAt: "2026-08-21T00:00:00.000Z",
    sourceTransactionId: "reward_resolver_test",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
}

describe("SkillModifierResolver", () => {
  it("按显式目标汇总 amplify/repeat/resource，并保留静态技能不变", () => {
    const skill = SKILL_DEFINITIONS.find((value) => value.id === "skill_wanderer_rending_slash")!;
    const result = resolver.resolve({
      characterId: "char_wanderer",
      skill,
      equippedSkillIds: [skill.id, "skill_wanderer_endless_edge", "skill_wanderer_instinct"],
      skillStone: stone("char_wanderer", ["sa_bleed_doublecut", "sa_universal_focus", "sa_swift_charge"]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.powerBonusBps).toBe(400);
    expect(result.value.repeatChanceBps).toBe(2500);
    expect(result.value.repeatExtraHits).toBe(1);
    expect(result.value.energyGainDelta).toBe(0);
    expect(result.value.resolvedSkill.effectsByLevel[0][0]).not.toBe(skill.effectsByLevel[0][0]);
    expect(skill.effectsByLevel[0][0].kind === "damage" && skill.effectsByLevel[0][0].powerBps).toBe(11_000);
  });

  it("morph 修改克隆技能的 target/element，未装备的 family 词条不生效", () => {
    const skill = SKILL_DEFINITIONS.find((value) => value.id === "skill_frost_chill_lance")!;
    const morph = resolver.resolve({
      characterId: "char_frost_seer",
      skill,
      equippedSkillIds: [skill.id, "skill_frost_absolute_zero", "skill_frost_clarity"],
      skillStone: stone("char_frost_seer", ["sa_frost_spread"]),
    });
    expect(morph.ok).toBe(true);
    if (morph.ok) {
      expect(morph.value.resolvedSkill.targetRule).toBe("allEnemies");
      expect(morph.value.resolvedSkill.effectsByLevel[0][0]).toMatchObject({ targetRule: "allEnemies" });
    }
    const inactive = resolver.resolve({
      characterId: "char_frost_seer",
      skill,
      equippedSkillIds: ["skill_frost_absolute_zero", "skill_frost_clarity"],
      skillStone: stone("char_frost_seer", ["sa_frost_spread"]),
    });
    expect(inactive.ok).toBe(true);
    if (inactive.ok) expect(inactive.value.suppressedSources[0]?.reason).toBe("target_skill_not_active");
  });

  it("同 exclusiveGroup 在确认前返回 AFFIX_CONFLICT，并保留来源解释字段", () => {
    const skill = SKILL_DEFINITIONS.find((value) => value.id === "skill_ember_fireball")!;
    const conflictResolver = new SkillModifierResolver({
      getSkillAffix: (id: string) => id === "sa_ember_echo_2"
        ? success({ ...SKILL_AFFIX_DEFINITIONS.find((value) => value.id === "sa_ember_echo")!, id: "sa_ember_echo_2" })
        : source.getSkillAffix(id),
    });
    const result = conflictResolver.resolve({
      characterId: "char_ember_mage",
      skill,
      equippedSkillIds: [skill.id, "skill_ember_inferno", "skill_ember_kindling"],
      skillStone: stone("char_ember_mage", ["sa_ember_echo", "sa_ember_echo_2"]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AFFIX_CONFLICT");
  });
});
