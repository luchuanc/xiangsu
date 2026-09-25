import { buildMapBlueprint, type MapBlueprint } from "../../../src/content/builders/mapBlueprint";
import { buildMapVisualLayers, type MapVisualLayers } from "../../../src/content/builders/mapVisualLayers";
import { createFloor01Tileset } from "./Floor01TilesetSource";
import { createTownTileset } from "./TownTilesetSource";
import type { PixelSurface } from "./PixelSurface";

export interface MapVisualComposition {
  readonly blueprint: MapBlueprint;
  readonly layers: MapVisualLayers;
  readonly tileset: PixelSurface;
}

/** 构建期把冻结碰撞蓝图、视觉层和对应 tileset 组合，运行时不依赖此 Node helper。 */
export function composeMapVisuals(mapId: "map_town" | "map_floor_01"): MapVisualComposition {
  const blueprint = buildMapBlueprint(mapId);
  return {
    blueprint,
    layers: buildMapVisualLayers(blueprint),
    tileset: mapId === "map_town" ? createTownTileset() : createFloor01Tileset(),
  };
}

export const composeMapVisualLayer = composeMapVisuals;
