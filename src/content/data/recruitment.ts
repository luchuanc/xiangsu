import type { RecruitmentDefinition } from "../contracts";

/** RPG-009 五名非主角角色的固定招募来源，不包含随机或重复角色。 */
const recruitmentDefinitions: RecruitmentDefinition[] = [
  {
    id: "recruit_iron_guard_tavern",
    characterId: "char_iron_guard",
    condition: { kind: "gold", goldCost: 0, minimumClearedFloor: 0 },
  },
  {
    id: "recruit_ember_mage_tavern",
    characterId: "char_ember_mage",
    condition: { kind: "gold", goldCost: 0, minimumClearedFloor: 0 },
  },
  {
    id: "recruit_priest_first_elite",
    characterId: "char_priest",
    condition: { kind: "questCompleted", questId: "quest_first_elite" },
  },
  {
    id: "recruit_ranger_floor_02",
    characterId: "char_ranger",
    condition: { kind: "firstClear", floorNumber: 2 },
  },
  {
    id: "recruit_frost_floor_04",
    characterId: "char_frost_seer",
    condition: { kind: "firstClear", floorNumber: 4 },
  },
];

export const RECRUITMENT_DEFINITIONS: readonly RecruitmentDefinition[] = Object.freeze(recruitmentDefinitions);
export const recruitments = RECRUITMENT_DEFINITIONS;

