import { describe, expect, it } from "vitest";

import type {
  CharacterProgressV1,
  EquipmentInstance,
  InventoryStateV1,
  SkillStoneInstance,
} from "../../src/content/contracts";
import {
  CHARACTER_DEFINITIONS,
} from "../../src/content/data/characters";
import {
  EQUIPMENT_AFFIX_DEFINITIONS,
  EQUIPMENT_BASE_DEFINITIONS,
} from "../../src/content/data/equipment";
import { SKILL_AFFIX_DEFINITIONS } from "../../src/content/data/skillAffixes";
import { SKILL_DEFINITIONS } from "../../src/content/data/skills";
import { COMBO_DEFINITIONS } from "../../src/content/data/combos";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { createCharacterProgress } from "../../src/domain/character/Character";
import {
  ComboMatcher,
  type ComboMatcherContentSource,
} from "../../src/domain/combo/ComboMatcher";

const content: ComboMatcherContentSource = {
  getCharacter: (id) => {
    const value = CHARACTER_DEFINITIONS.find((candidate) => candidate.id === id);
    return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: `characters.${id}`, issueKey: "missing_content" }));
  },
  getSkill: (id) => {
    const value = SKILL_DEFINITIONS.find((candidate) => candidate.id === id);
    return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: `skills.${id}`, issueKey: "missing_content" }));
  },
  getEquipmentBase: (id) => {
    const value = EQUIPMENT_BASE_DEFINITIONS.find((candidate) => candidate.id === id);
    return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: `equipmentBases.${id}`, issueKey: "missing_content" }));
  },
  getEquipmentAffix: (id) => {
    const value = EQUIPMENT_AFFIX_DEFINITIONS.find((candidate) => candidate.id === id);
    return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: `equipmentAffixes.${id}`, issueKey: "missing_content" }));
  },
  getSkillAffix: (id) => {
    const value = SKILL_AFFIX_DEFINITIONS.find((candidate) => candidate.id === id);
    return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: `skillAffixes.${id}`, issueKey: "missing_content" }));
  },
  getCombo: (id) => {
    const value = COMBO_DEFINITIONS.find((candidate) => candidate.id === id);
    return value ? success(value) : failure(createDomainError("INVALID_CONTENT", { path: `combos.${id}`, issueKey: "missing_content" }));
  },
};

function progress(characterId: string, active: [string | null, string | null] = [null, null]): CharacterProgressV1 {
  const character = CHARACTER_DEFINITIONS.find((candidate) => candidate.id === characterId)!;
  const result = createCharacterProgress(character, { recruited: true, level: 10, xp: 640, currentHp: character.baseStats.maxHp, skillPoints: 9 });
  if (!result.ok) throw new Error("Combo 测试角色创建失败");
  result.value.equippedActiveSkillIds = active;
  for (const skillId of active) if (skillId !== null) result.value.skillLevels[skillId] = 1;
  return result.value;
}

function equipment(instanceId: string, baseId: string, affixIds: readonly string[]): EquipmentInstance {
  return {
    instanceId,
    baseId,
    itemLevel: 1,
    quality: "rare",
    craftGrade: "ordinary",
    affixes: affixIds.map((affixId) => ({ affixId, tier: 1, roll: 1, craftEmpowered: false, reforged: false })),
    abyssAffix: null,
    locked: false,
    acquiredAt: "2026-08-24T00:00:00.000Z",
    sourceTransactionId: "combo_test",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
}

function stone(instanceId: string, characterId: string, affixIds: readonly string[]): SkillStoneInstance {
  return {
    instanceId,
    attunedCharacterId: characterId,
    itemLevel: 1,
    quality: "rare",
    affixes: affixIds.map((skillAffixId) => ({ skillAffixId, roll: 1, reforged: false })),
    abyssAffix: null,
    locked: false,
    acquiredAt: "2026-08-24T00:00:00.000Z",
    sourceTransactionId: "combo_test",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
}

function inventory(values: { equipment?: EquipmentInstance[]; skillStones?: SkillStoneInstance[] } = {}): InventoryStateV1 {
  return {
    equipment: values.equipment ?? [],
    skillStones: values.skillStones ?? [],
    stackables: {},
    overflowEquipment: [],
    overflowSkillStones: [],
  };
}

describe("ComboMatcher", () => {
  it("只按已装备的三类来源精确激活余烬链爆，并保持来源/顺序可解释", () => {
    const character = progress("char_ember_mage", ["skill_ember_fireball", null]);
    const result = new ComboMatcher(content).matchPersonal({
      character: { ...character, equipmentBySlot: { ...character.equipmentBySlot, weapon: "eq_ember" }, skillStoneInstanceId: "stone_ember" },
      inventory: inventory({
        equipment: [equipment("eq_ember", "eq_staff_t1_oak", ["af_flame"])],
        skillStones: [stone("stone_ember", character.characterId, ["sa_ember_echo"])],
      }),
      comboIds: ["combo_ember_chain"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matchedComboIds).toEqual(["combo_ember_chain"]);
    expect(result.value.tagContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "equipmentAffix", tagId: "burn", count: 1, instanceId: "eq_ember" }),
      expect.objectContaining({ source: "equippedSkill", tagId: "burn", count: 1, instanceId: null }),
      expect.objectContaining({ source: "skillAffix", tagId: "detonate", count: 2, instanceId: "stone_ember" }),
    ]));
    const collected = new ComboMatcher(content).collectPersonal(
      { ...character, equipmentBySlot: { ...character.equipmentBySlot, weapon: "eq_ember" }, skillStoneInstanceId: "stone_ember" },
      inventory({
        equipment: [equipment("eq_ember", "eq_staff_t1_oak", ["af_flame"])],
        skillStones: [stone("stone_ember", character.characterId, ["sa_ember_echo"])],
      }),
    );
    expect(collected.ok).toBe(true);
    if (collected.ok) expect(result.value.tagContributions).toEqual(collected.value);
  });

  it("不把背包装备、familyIds、普攻或未装备主动技能冒充 Combo 标签", () => {
    const character = progress("char_ember_mage", [null, null]);
    const result = new ComboMatcher(content).matchPersonal({
      character,
      inventory: inventory({
        equipment: [equipment("eq_backpack", "eq_staff_t1_oak", ["af_flame"])],
        skillStones: [stone("stone_ember", character.characterId, ["sa_ember_echo"])],
      }),
      comboIds: ["combo_ember_chain"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.matchedComboIds).toEqual([]);
      expect(result.value.tagContributions.some((value) => value.source === "equippedSkill" && value.sourceIndex === 0)).toBe(false);
    }
  });

  it("来源必须分别满足，不能用同标签的其它来源拼接", () => {
    const character = progress("char_ember_mage", ["skill_ember_fireball", null]);
    const result = new ComboMatcher(content).matchPersonal({
      character: { ...character, equipmentBySlot: { ...character.equipmentBySlot, weapon: "eq_wrong" }, skillStoneInstanceId: "stone_ember" },
      inventory: inventory({
        equipment: [equipment("eq_wrong", "eq_staff_t1_oak", ["af_might"])],
        skillStones: [stone("stone_ember", character.characterId, ["sa_ember_echo"])],
      }),
      comboIds: ["combo_ember_chain"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.matchedComboIds).toEqual([]);
  });

  it("party 只汇总当前队伍角色，并与 personal 作用域隔离", () => {
    const priest = progress("char_priest", ["skill_priest_mend", null]);
    const ranger = progress("char_ranger", ["skill_ranger_twin_shot", null]);
    const matcher = new ComboMatcher(content);
    const result = matcher.matchParty({
      party: { slots: [priest.characterId, ranger.characterId, null, null] },
      characters: {
        [priest.characterId]: { ...priest, equipmentBySlot: { ...priest.equipmentBySlot, armor: "eq_priest" }, skillStoneInstanceId: "stone_priest" },
        [ranger.characterId]: ranger,
      },
      inventory: inventory({
        equipment: [equipment("eq_priest", "eq_armor_t1_leather", ["af_bulwark"])],
        skillStones: [stone("stone_priest", priest.characterId, ["sa_heal_overflow"])],
      }),
      comboIds: ["combo_holy_bulwark", "combo_ember_chain"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.matchedComboIds).toEqual(["combo_holy_bulwark"]);
    const personal = matcher.matchPersonal({ character: ranger, inventory: inventory(), comboIds: ["combo_holy_bulwark"] });
    expect(personal.ok).toBe(true);
    if (personal.ok) expect(personal.value.matchedComboIds).toEqual([]);
  });

  it("未知实例、槽位不一致或重复实例返回结构化失败，不静默跳过", () => {
    const character = progress("char_ember_mage", ["skill_ember_fireball", null]);
    const missing = new ComboMatcher(content).matchPersonal({
      character,
      inventory: inventory(),
      comboIds: ["combo_ember_chain"],
    });
    expect(missing.ok).toBe(true);

    const wrongSlot = new ComboMatcher(content).matchPersonal({
      character: { ...character, equipmentBySlot: { ...character.equipmentBySlot, accessory: "eq_wrong_slot" } },
      inventory: inventory({ equipment: [equipment("eq_wrong_slot", "eq_staff_t1_oak", ["af_flame"])] }),
      comboIds: ["combo_ember_chain"],
    });
    expect(wrongSlot).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });

    const duplicate = new ComboMatcher(content).matchPersonal({
      character: { ...character, equipmentBySlot: { ...character.equipmentBySlot, weapon: "eq_duplicate" } },
      inventory: inventory({ equipment: [equipment("eq_duplicate", "eq_staff_t1_oak", ["af_flame"])], skillStones: [stone("eq_duplicate", character.characterId, ["sa_ember_echo"])] }),
      comboIds: ["combo_ember_chain"],
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
  });
});
