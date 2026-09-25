import { describe, expect, it } from "vitest";

import type { CharacterProgressV1 } from "../../src/content/contracts";
import { fixtureContentRoot } from "../../src/content/data";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { createCharacterProgress } from "../../src/domain/character/Character";
import { SkillService } from "../../src/domain/skill/SkillService";

const content = {
  getCharacter: (id: string) => id === fixtureContentRoot.characters[0].id
    ? success(fixtureContentRoot.characters[0])
    : failure(createDomainError("INVALID_CONTENT", { path: `characters.${id}`, issueKey: "missing_content" })),
  getSkill: (id: string) => {
    const skill = fixtureContentRoot.skills.find((candidate) => candidate.id === id);
    return skill ? success(skill) : failure(createDomainError("INVALID_CONTENT", { path: `skills.${id}`, issueKey: "missing_content" }));
  },
};
const character = fixtureContentRoot.characters[0];
const service = new SkillService(content);

function makeProgress(overrides: Partial<CharacterProgressV1> = {}): CharacterProgressV1 {
  const result = createCharacterProgress(character, { recruited: true, level: 2, xp: 0, currentHp: 100, skillPoints: 1 });
  if (!result.ok) throw new Error("技能服务夹具创建失败");
  return {
    ...result.value,
    ...overrides,
    skillLevels: { ...result.value.skillLevels, ...(overrides.skillLevels ?? {}) },
    equippedActiveSkillIds: overrides.equippedActiveSkillIds ?? result.value.equippedActiveSkillIds,
    equipmentBySlot: { ...result.value.equipmentBySlot, ...(overrides.equipmentBySlot ?? {}) },
  };
}

describe("SkillService", () => {
  it("按等级锁和技能点升级，并且不修改输入", () => {
    const before = makeProgress({ level: 2 });
    const upgraded = service.upgradeSkill(before, character.activeSkillIds[1]);
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) return;
    expect(upgraded.value.skillLevels[character.activeSkillIds[1]]).toBe(1);
    expect(upgraded.value.skillPoints).toBe(0);
    expect(before.skillLevels[character.activeSkillIds[1]]).toBe(0);

    const exhausted = service.upgradeSkill({ ...upgraded.value, skillPoints: 0 }, character.activeSkillIds[0]);
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) expect(exhausted.error.code).toBe("INSUFFICIENT_SKILL_POINTS");
  });

  it("只允许两个已解锁主动槽，重复装配和非城镇操作失败", () => {
    const skillId = character.activeSkillIds[0];
    const before = makeProgress({ skillPoints: 0, skillLevels: { [skillId]: 1 } });
    const equipped = service.equipActiveSkill(before, skillId, 0);
    expect(equipped.ok).toBe(true);
    if (!equipped.ok) return;
    const duplicate = service.equipActiveSkill(equipped.value, skillId, 1);
    expect(duplicate.ok).toBe(false);
    const blocked = service.equipActiveSkill(before, skillId, 0, { inTown: false });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("NOT_IN_TOWN");
  });

  it("免费重置返还投入点数并清空两个主动槽", () => {
    const first = character.activeSkillIds[0];
    const second = character.activeSkillIds[1];
    const before = makeProgress({ level: 4, skillPoints: 0, skillLevels: { [first]: 2, [second]: 1 }, equippedActiveSkillIds: [first, second] });
    const reset = service.resetSkills(before);
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.value.skillPoints).toBe(3);
    expect(Object.values(reset.value.skillLevels)).toEqual([0, 0, 0, 0]);
    expect(reset.value.equippedActiveSkillIds).toEqual([null, null]);
    expect(before.equippedActiveSkillIds).toEqual([first, second]);
  });

  it("拒绝技能点守恒被破坏的非法存档", () => {
    const invalidProgress = makeProgress({ skillPoints: 2 });
    const result = service.previewUpgrade(invalidProgress, character.activeSkillIds[0]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_CONTENT");
      expect(result.error.details).toEqual({
        path: "characterProgress.skillPoints",
        issueKey: "skill_points_conservation",
      });
    }
  });
});
