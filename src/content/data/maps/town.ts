import { buildMapBlueprint } from "../../builders/mapBlueprint";
import { buildMapVisualLayers } from "../../builders/mapVisualLayers";
import type { MapDefinition } from "../../contracts";

const blueprint = buildMapBlueprint("map_town");
const visualLayers = buildMapVisualLayers(blueprint);

/** 城镇视觉层由确定性 builder 生成，碰撞与对象仍来自冻结蓝图。 */
export const townMap: MapDefinition = {
  id: "map_town",
  nameKey: "map.map_town.name",
  widthTiles: blueprint.widthTiles,
  heightTiles: blueprint.heightTiles,
  tileSize: 16,
  assetBundleId: "town",
  spawnPoint: { x: 640, y: 800 },
  groundLayer: visualLayers.groundLayer,
  decorBackLayer: visualLayers.decorBackLayer,
  decorFrontLayer: visualLayers.decorFrontLayer,
  collisionLayer: blueprint.collisionLayer,
  objects: [
    { kind: "npc", objectId: "obj_town_tavern", position: { x: 320, y: 320 }, npcId: "npc_tavern_keeper", blocking: true },
    { kind: "npc", objectId: "obj_town_blacksmith", position: { x: 512, y: 320 }, npcId: "npc_blacksmith", blocking: true },
    { kind: "npc", objectId: "obj_town_skill_mentor", position: { x: 704, y: 320 }, npcId: "npc_skill_mentor", blocking: true },
    { kind: "npc", objectId: "obj_town_merchant", position: { x: 896, y: 320 }, npcId: "npc_merchant", blocking: true },
    { kind: "npc", objectId: "obj_town_innkeeper", position: { x: 416, y: 576 }, npcId: "npc_innkeeper", blocking: true },
    { kind: "npc", objectId: "obj_town_cartographer", position: { x: 704, y: 576 }, npcId: "npc_cartographer", blocking: true },
    { kind: "npc", objectId: "obj_town_abyss_watcher", position: { x: 992, y: 576 }, npcId: "npc_abyss_watcher", blocking: true },
    { kind: "portal", objectId: "obj_town_floor_portal", position: { x: 640, y: 128 }, action: { kind: "openFloorSelect" }, frameId: "object_portal_floor" },
  ],
};

export const mapTown = townMap;
