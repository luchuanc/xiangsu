import type { MapDefinition } from "../../content/contracts";

export const EXPLORATION_TILE_SIZE = 16;

export type TileLayerName = "ground" | "decorBack" | "collision" | "decorFront";

export interface TileMapResourceSource {
  hasBundle(bundleId: string): boolean;
  hasAsset(assetId: string): boolean;
}

export interface TileMapViewOptions {
  readonly map: Readonly<MapDefinition>;
  /** 由 AssetCatalog/manifest 显式提供，禁止从 map id 猜测。 */
  readonly tilesetAssetId: string;
  readonly resources: TileMapResourceSource;
}

export interface TileMapLayerSnapshot {
  readonly name: TileLayerName;
  readonly values: readonly number[];
}

function assertLayer(name: string, values: readonly number[], expectedLength: number): readonly number[] {
  if (values.length !== expectedLength) throw new Error(`MAP_LAYER_INVALID:${name}`);
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`MAP_LAYER_INVALID:${name}`);
  }
  return Object.freeze([...values]);
}

/**
 * 只保存地图层的只读投影；Pixi Sprite/Texture 由后续场景适配器消费。
 * 构造阶段严格检查 bundle、tileset 和四层长度，缺资源直接阻断 prepare。
 */
export class TileMapView {
  public readonly mapId: string;
  public readonly assetBundleId: string;
  public readonly tilesetAssetId: string;
  public readonly widthTiles: number;
  public readonly heightTiles: number;
  public readonly tileSize = EXPLORATION_TILE_SIZE;
  private readonly layers: readonly TileMapLayerSnapshot[];

  public constructor(options: TileMapViewOptions) {
    const { map, resources, tilesetAssetId } = options;
    if (map.tileSize !== EXPLORATION_TILE_SIZE) throw new Error("MAP_TILE_SIZE_INVALID");
    const expectedLength = map.widthTiles * map.heightTiles;
    if (!Number.isSafeInteger(expectedLength) || expectedLength <= 0) throw new Error("MAP_SIZE_INVALID");
    if (!resources.hasBundle(map.assetBundleId)) throw new Error(`ASSET_BUNDLE_MISSING:${map.assetBundleId}`);
    if (tilesetAssetId.length === 0 || !resources.hasAsset(tilesetAssetId)) throw new Error(`ASSET_MISSING:${tilesetAssetId}`);
    this.mapId = map.id;
    this.assetBundleId = map.assetBundleId;
    this.tilesetAssetId = tilesetAssetId;
    this.widthTiles = map.widthTiles;
    this.heightTiles = map.heightTiles;
    this.layers = Object.freeze([
      Object.freeze({ name: "ground", values: assertLayer("ground", map.groundLayer, expectedLength) }),
      Object.freeze({ name: "decorBack", values: assertLayer("decorBack", map.decorBackLayer, expectedLength) }),
      Object.freeze({ name: "collision", values: assertLayer("collision", map.collisionLayer, expectedLength) }),
      Object.freeze({ name: "decorFront", values: assertLayer("decorFront", map.decorFrontLayer, expectedLength) }),
    ]);
  }

  public getLayer(name: TileLayerName): TileMapLayerSnapshot {
    const layer = this.layers.find((value) => value.name === name);
    if (!layer) throw new Error(`MAP_LAYER_UNKNOWN:${name}`);
    return layer;
  }

  public getLayers(): readonly TileMapLayerSnapshot[] {
    return this.layers;
  }
}
