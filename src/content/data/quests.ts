import type { QuestDefinition } from "../contracts";

/** RPG-009 固定任务：第一层精英胜利后开放牧师招募。 */
const questDefinitions: QuestDefinition[] = [
  {
    id: "quest_first_elite",
    nameKey: "quest.quest_first_elite.name",
    descriptionKey: "quest.quest_first_elite.description",
    unlockCondition: { kind: "always" },
    completionCondition: {
      kind: "encounterCleared",
      encounterId: "encounter_floor_01_elite_boar",
    },
  },
];

export const QUEST_DEFINITIONS: readonly QuestDefinition[] = Object.freeze(questDefinitions);
export const quests = QUEST_DEFINITIONS;

