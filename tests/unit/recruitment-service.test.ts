import { describe, expect, it } from "vitest";

import type {
  CharacterDefinition,
  CharacterProgressV1,
  GameSaveV1,
  RecruitmentDefinition,
  WorldProgressV1,
} from "../../src/content/contracts";
import { fixtureContentRoot } from "../../src/content/data";
import { RECRUITMENT_DEFINITIONS } from "../../src/content/data/recruitment";
import { QUEST_DEFINITIONS } from "../../src/content/data/quests";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { createCharacterProgress } from "../../src/domain/character/Character";
import {
  experienceThresholdForLevel,
  ProgressionService,
} from "../../src/domain/character/ProgressionService";
import { QuestService } from "../../src/domain/party/QuestService";
import { RecruitmentService } from "../../src/domain/party/RecruitmentService";
import { createNewGameSave } from "../../src/domain/save/GameSave";

const protagonist = fixtureContentRoot.characters[0];
const characterIds = [
  "char_iron_guard",
  "char_ember_mage",
  "char_priest",
  "char_ranger",
  "char_frost_seer",
] as const;
const characters = new Map<string, CharacterDefinition>([
  [protagonist.id, protagonist],
  ...characterIds.map((id) => [id, { ...protagonist, id }] as const),
]);
const recruitmentDefinitions = new Map<string, RecruitmentDefinition>(RECRUITMENT_DEFINITIONS.map((definition) => [definition.id, definition]));
const questDefinitions = new Map(QUEST_DEFINITIONS.map((definition) => [definition.id, definition]));

const characterContent = {
  getCharacter: (id: string) => {
    const character = characters.get(id);
    return character
      ? success(character)
      : failure(createDomainError("INVALID_CONTENT", { path: `characters.${id}`, issueKey: "missing_content" }));
  },
  getSkill: (id: string) => {
    const skill = fixtureContentRoot.skills.find((candidate) => candidate.id === id);
    return skill
      ? success(skill)
      : failure(createDomainError("INVALID_CONTENT", { path: `skills.${id}`, issueKey: "missing_content" }));
  },
};

const recruitmentContent = {
  getRecruitment: (id: string) => {
    const definition = recruitmentDefinitions.get(id);
    return definition
      ? success(definition)
      : failure(createDomainError("INVALID_CONTENT", { path: `recruitments.${id}`, issueKey: "missing_content" }));
  },
};

const questContent = {
  getQuest: (id: string) => {
    const definition = questDefinitions.get(id);
    return definition
      ? success(definition)
      : failure(createDomainError("INVALID_CONTENT", { path: `quests.${id}`, issueKey: "missing_content" }));
  },
};

const progression = new ProgressionService(characterContent);
const recruitmentService = new RecruitmentService({
  content: recruitmentContent,
  progression,
  protagonistCharacterId: protagonist.id,
});

function progress(character: CharacterDefinition, recruited: boolean, level = 1): CharacterProgressV1 {
  const result = createCharacterProgress(character, {
    recruited,
    level,
    xp: experienceThresholdForLevel(level),
    currentHp: character.baseStats.maxHp,
    skillPoints: level - 1,
  });
  if (!result.ok) throw new Error("招募测试角色创建失败");
  return result.value;
}

function world(overrides: Partial<WorldProgressV1> = {}): WorldProgressV1 {
  const save = createNewGameSave(fixtureContentRoot, "2026-08-21T00:00:00.000Z");
  return { ...save.world, ...overrides, completedQuestIds: [...(overrides.completedQuestIds ?? save.world.completedQuestIds)], clearedBossEncounterIds: [...(overrides.clearedBossEncounterIds ?? save.world.clearedBossEncounterIds)] };
}

function save(overrides: Partial<WorldProgressV1> = {}, level = 1): GameSaveV1 {
  const value = createNewGameSave(fixtureContentRoot, "2026-08-21T00:00:00.000Z");
  value.characters[protagonist.id] = progress(protagonist, true, level);
  for (const characterId of characterIds) {
    const character = characters.get(characterId);
    if (!character) throw new Error("招募角色夹具缺失");
    value.characters[characterId] = progress(character, false);
  }
  value.world = world(overrides);
  value.gold = 200;
  return value;
}

function commitWriter(nextSave: GameSaveV1, expectedRevision: number): ReturnType<typeof success<GameSaveV1>> {
  return success({ ...nextSave, revision: expectedRevision + 1 });
}

describe("RPG-009 fixed recruitment data", () => {
  it("录入恰好一条任务和五名非主角招募来源", () => {
    expect(QUEST_DEFINITIONS).toHaveLength(1);
    expect(QUEST_DEFINITIONS[0]).toMatchObject({
      id: "quest_first_elite",
      unlockCondition: { kind: "always" },
      completionCondition: { kind: "encounterCleared", encounterId: "encounter_floor_01_elite_boar" },
    });
    expect(RECRUITMENT_DEFINITIONS).toHaveLength(5);
    expect(RECRUITMENT_DEFINITIONS.map((definition) => definition.characterId)).toEqual(characterIds);
    expect(RECRUITMENT_DEFINITIONS.map((definition) => definition.condition.kind)).toEqual(["gold", "gold", "questCompleted", "firstClear", "firstClear"]);
  });

  it("按 gold/questCompleted/firstClear 严格判断招募条件", () => {
    const free = recruitmentService.evaluate("recruit_iron_guard_tavern", save());
    const priestLocked = recruitmentService.evaluate("recruit_priest_first_elite", save());
    const priestReady = recruitmentService.evaluate("recruit_priest_first_elite", save({ completedQuestIds: ["quest_first_elite"] }));
    const rangerLocked = recruitmentService.evaluate("recruit_ranger_floor_02", save({ highestUnlockedFloor: 2 }));
    const rangerReady = recruitmentService.evaluate("recruit_ranger_floor_02", save({ highestUnlockedFloor: 3 }));
    const frostReady = recruitmentService.evaluate("recruit_frost_floor_04", save({ highestUnlockedFloor: 5 }));

    expect(free.ok && free.value.goldCost).toBe(0);
    expect(priestLocked).toMatchObject({ ok: false, error: { code: "RECRUITMENT_LOCKED" } });
    expect(priestReady.ok).toBe(true);
    expect(rangerLocked).toMatchObject({ ok: false, error: { code: "RECRUITMENT_LOCKED" } });
    expect(rangerReady.ok).toBe(true);
    expect(frostReady.ok).toBe(true);
  });

  it("招募成功追赶主角等级、满血空配置且不自动入队", async () => {
    for (const level of [1, 12, 25, 50]) {
      const before = save({}, level);
      const beforeParty = structuredClone(before.party);
      const result = await recruitmentService.commit("recruit_iron_guard_tavern", before, {
        expectedRevision: 1,
        save: (expectedRevision, nextSave) => commitWriter(nextSave, expectedRevision),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const recruit = result.value.characters.char_iron_guard;
      expect(recruit).toMatchObject({
        characterId: "char_iron_guard",
        recruited: true,
        level,
        xp: experienceThresholdForLevel(level),
        skillPoints: level - 1,
        currentHp: 100,
        equippedActiveSkillIds: [null, null],
        skillStoneInstanceId: null,
      });
      expect(Object.values(recruit.skillLevels)).toEqual([0, 0, 0, 0]);
      expect(Object.values(recruit.equipmentBySlot)).toEqual([null, null, null, null, null, null]);
      expect(result.value.party).toEqual(beforeParty);
      expect(result.value.gold).toBe(before.gold);
      expect(before.characters.char_iron_guard.recruited).toBe(false);
    }
  });

  it("重复、金币不足和保存失败均不产生副作用", async () => {
    const duplicate = save();
    duplicate.characters.char_iron_guard.recruited = true;
    const duplicateResult = await recruitmentService.commit("recruit_iron_guard_tavern", duplicate, {
      expectedRevision: 1,
      save: () => { throw new Error("重复招募不应调用保存"); },
    });
    expect(duplicateResult).toMatchObject({ ok: false, error: { code: "CHARACTER_ALREADY_RECRUITED" } });

    const paidDefinition: RecruitmentDefinition = {
      id: "recruit_paid_test",
      characterId: "char_iron_guard",
      condition: { kind: "gold", goldCost: 250, minimumClearedFloor: 0 },
    };
    recruitmentDefinitions.set(paidDefinition.id, paidDefinition);
    const poor = save();
    const poorResult = recruitmentService.evaluate(paidDefinition.id, poor);
    expect(poorResult).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_GOLD", details: { required: 250, owned: 200 } } });

    const failedSave = save();
    const beforeJson = JSON.stringify(failedSave);
    const failed = await recruitmentService.commit("recruit_iron_guard_tavern", failedSave, {
      expectedRevision: 1,
      save: () => failure(createDomainError("STALE_REVISION", { expectedRevision: 1, actualRevision: 2 })),
    });
    expect(failed).toMatchObject({ ok: false, error: { code: "STALE_REVISION" } });
    expect(JSON.stringify(failedSave)).toBe(beforeJson);
  });
});

describe("QuestService", () => {
  it("只按 encounterCleared 完成任务、追加一次且保持其它 world 字段", async () => {
    const service = new QuestService(questContent);
    const notReady = service.complete("quest_first_elite", world());
    expect(notReady.ok).toBe(true);
    if (notReady.ok) expect(notReady.value.completedQuestIds).toEqual([]);

    const before = world({ clearedBossEncounterIds: [] });
    const beforeOtherFields = { ...before, completedQuestIds: [] };
    const evidence = { kind: "encounterCleared" as const, encounterId: "encounter_floor_01_elite_boar" };
    const completed = service.complete("quest_first_elite", before, evidence);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.value.completedQuestIds).toEqual(["quest_first_elite"]);
    expect(completed.value.highestUnlockedFloor).toBe(beforeOtherFields.highestUnlockedFloor);
    expect(completed.value.clearedBossEncounterIds).toEqual(beforeOtherFields.clearedBossEncounterIds);

    const repeated = service.complete("quest_first_elite", completed.value, evidence);
    expect(repeated.ok).toBe(true);
    if (repeated.ok) expect(repeated.value.completedQuestIds).toEqual(["quest_first_elite"]);

    const saved = save({ clearedBossEncounterIds: [] });
    let writes = 0;
    const firstCommit = await service.commit("quest_first_elite", saved, {
      expectedRevision: 1,
      save: (expectedRevision, nextSave) => {
        writes += 1;
        return commitWriter(nextSave, expectedRevision);
      },
    }, evidence);
    expect(firstCommit.ok).toBe(true);
    if (!firstCommit.ok) return;
    const secondCommit = await service.commit("quest_first_elite", firstCommit.value, {
      expectedRevision: 2,
      save: () => {
        writes += 1;
        return success(firstCommit.value);
      },
    }, evidence);
    expect(secondCommit.ok).toBe(true);
    expect(writes).toBe(1);
  });
});
