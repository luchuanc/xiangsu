import { buildMapBlueprint } from "../../builders/mapBlueprint";
import { buildMapVisualLayers } from "../../builders/mapVisualLayers";
import type { EncounterBehavior, MapDefinition, MapObjectDefinition } from "../../contracts";

const blueprint = buildMapBlueprint("map_floor_01");
const visualLayers = buildMapVisualLayers(blueprint);

function behavior(mode: EncounterBehavior["mode"], position: { x: number; y: number }, elite = false, boss = false): EncounterBehavior {
  return {
    mode,
    patrolPoints: mode === "patrol" ? [{ x: position.x - 32, y: position.y }, { x: position.x + 32, y: position.y }] : [],
    wanderRadius: mode === "wander" ? 64 : 0,
    detectionRadius: boss ? 0 : elite ? 96 : mode === "stationary" ? 64 : 80,
    leashRadius: boss ? 0 : elite ? 192 : 160,
    moveSpeed: boss ? 0 : elite ? 32 : 36,
  };
}

function encounter(objectId: string, position: { x: number; y: number }, encounterId: string, mode: EncounterBehavior["mode"], elite = false, boss = false): MapObjectDefinition {
  return { kind: "encounter", objectId, position, encounterId, behavior: behavior(mode, position, elite, boss) };
}

/** 第一层地图按冻结节点/边算法生成碰撞，视觉层独立且不推断业务对象。 */
export const floor01Map: MapDefinition = {
  id: "map_floor_01",
  nameKey: "floor.floor_01.name",
  widthTiles: blueprint.widthTiles,
  heightTiles: blueprint.heightTiles,
  tileSize: 16,
  assetBundleId: "floor_01",
  spawnPoint: { x: 96, y: 896 },
  groundLayer: visualLayers.groundLayer,
  decorBackLayer: visualLayers.decorBackLayer,
  decorFrontLayer: visualLayers.decorFrontLayer,
  collisionLayer: blueprint.collisionLayer,
  objects: [
    encounter("obj_f01_n01", { x: 256, y: 800 }, "encounter_floor_01_normal_a", "patrol"),
    encounter("obj_f01_n02", { x: 480, y: 864 }, "encounter_floor_01_normal_b", "wander"),
    encounter("obj_f01_n03", { x: 736, y: 736 }, "encounter_floor_01_normal_c", "stationary"),
    encounter("obj_f01_n04", { x: 1024, y: 832 }, "encounter_floor_01_normal_a", "patrol"),
    encounter("obj_f01_n05", { x: 1248, y: 704 }, "encounter_floor_01_normal_b", "wander"),
    encounter("obj_f01_n06", { x: 352, y: 512 }, "encounter_floor_01_normal_c", "stationary"),
    encounter("obj_f01_n07", { x: 800, y: 480 }, "encounter_floor_01_normal_a", "patrol"),
    encounter("obj_f01_n08", { x: 1184, y: 448 }, "encounter_floor_01_normal_b", "wander"),
    encounter("obj_f01_e01", { x: 576, y: 288 }, "encounter_floor_01_elite_boar", "stationary", true),
    encounter("obj_f01_e02", { x: 1120, y: 256 }, "encounter_floor_01_elite_boar", "stationary", true),
    { kind: "chest", objectId: "obj_f01_chest01", position: { x: 192, y: 320 }, dropTableId: "drop_floor_01_chest", frameId: "object_chest_closed" },
    { kind: "chest", objectId: "obj_f01_chest02", position: { x: 768, y: 160 }, dropTableId: "drop_floor_01_chest", frameId: "object_chest_closed" },
    { kind: "chest", objectId: "obj_f01_chest03", position: { x: 1344, y: 352 }, dropTableId: "drop_floor_01_chest", frameId: "object_chest_closed" },
    encounter("obj_f01_boss", { x: 1408, y: 128 }, "encounter_floor_01_boss", "stationary", false, true),
    { kind: "portal", objectId: "obj_f01_return", position: { x: 64, y: 928 }, action: { kind: "returnTown" }, frameId: "object_portal_return" },
  ],
};

export const mapFloor01 = floor01Map;
