import type { NpcDefinition } from "../contracts";

/** RPG-019 城镇七类 NPC 的显式内容；路由只读取 function，不从名称推断。 */
export const npcs: NpcDefinition[] = [
  { id: "npc_tavern_keeper", nameKey: "npc.npc_tavern_keeper.name", function: "tavern", unlockCondition: { kind: "always" }, lockReasonKey: "lock.none", dialogueId: "dialogue_tavern_keeper", spriteId: "sprite_npc_tavern_keeper" },
  { id: "npc_blacksmith", nameKey: "npc.npc_blacksmith.name", function: "blacksmith", unlockCondition: { kind: "always" }, lockReasonKey: "lock.none", dialogueId: "dialogue_blacksmith", spriteId: "sprite_npc_blacksmith" },
  { id: "npc_skill_mentor", nameKey: "npc.npc_skill_mentor.name", function: "skillMentor", unlockCondition: { kind: "always" }, lockReasonKey: "lock.none", dialogueId: "dialogue_skill_mentor", spriteId: "sprite_npc_skill_mentor" },
  { id: "npc_merchant", nameKey: "npc.npc_merchant.name", function: "merchant", unlockCondition: { kind: "always" }, lockReasonKey: "lock.none", dialogueId: "dialogue_merchant", spriteId: "sprite_npc_merchant" },
  { id: "npc_innkeeper", nameKey: "npc.npc_innkeeper.name", function: "inn", unlockCondition: { kind: "always" }, lockReasonKey: "lock.none", dialogueId: "dialogue_innkeeper", spriteId: "sprite_npc_innkeeper" },
  { id: "npc_cartographer", nameKey: "npc.npc_cartographer.name", function: "cartographer", unlockCondition: { kind: "always" }, lockReasonKey: "lock.none", dialogueId: "dialogue_cartographer", spriteId: "sprite_npc_cartographer" },
  { id: "npc_abyss_watcher", nameKey: "npc.npc_abyss_watcher.name", function: "abyssWatcher", unlockCondition: { kind: "floorCleared", floorNumber: 5 }, lockReasonKey: "lock.abyss_watcher.floor_05", dialogueId: "dialogue_abyss_watcher", spriteId: "sprite_npc_abyss_watcher" },
];

export default npcs;
