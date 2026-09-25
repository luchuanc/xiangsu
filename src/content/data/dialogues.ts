import type { DialogueDefinition } from "../contracts";

/** 首版每个 NPC 固定一页；文本 key 由 LOC-1.2 维护。 */
export const dialogues: DialogueDefinition[] = [
  { id: "dialogue_tavern_keeper", pages: [{ speakerNpcId: "npc_tavern_keeper", textKey: "dialogue.tavern_keeper.greeting" }] },
  { id: "dialogue_blacksmith", pages: [{ speakerNpcId: "npc_blacksmith", textKey: "dialogue.blacksmith.greeting" }] },
  { id: "dialogue_skill_mentor", pages: [{ speakerNpcId: "npc_skill_mentor", textKey: "dialogue.skill_mentor.greeting" }] },
  { id: "dialogue_merchant", pages: [{ speakerNpcId: "npc_merchant", textKey: "dialogue.merchant.greeting" }] },
  { id: "dialogue_innkeeper", pages: [{ speakerNpcId: "npc_innkeeper", textKey: "dialogue.innkeeper.greeting" }] },
  { id: "dialogue_cartographer", pages: [{ speakerNpcId: "npc_cartographer", textKey: "dialogue.cartographer.greeting" }] },
  { id: "dialogue_abyss_watcher", pages: [{ speakerNpcId: "npc_abyss_watcher", textKey: "dialogue.abyss_watcher.greeting" }] },
];

export default dialogues;
