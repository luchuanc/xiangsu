import type { MapDefinition, Vector2 } from "../../content/contracts";

/** 探索领域的固定地图与脚底碰撞常量。 */
export const TILE_SIZE = 16;
export const FOOT_AABB_WIDTH = 12;
export const FOOT_AABB_HEIGHT = 8;

export interface TilePosition {
  readonly x: number;
  readonly y: number;
}

export interface Aabb {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** NPC 是唯一会进入玩家/遭遇碰撞测试的地图对象；遭遇对象彼此不阻挡。 */
export interface BlockingObject {
  readonly objectId: string;
  readonly position: Vector2;
  readonly width: number;
  readonly height: number;
}

export interface CollisionMapLike {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tileSize: 16;
  readonly collisionLayer: readonly (0 | 1)[];
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} 必须是有限数字`);
}

function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} 必须是安全整数`);
}

function aabbFromCenter(center: Vector2, width: number, height: number): Aabb {
  // 冻结测试中的脚底锚点沿用地图对象的 y 基准线，盒子从该基准线向下展开。
  // x 仍以脚底中心居中；半开矩形保证 y=32 的盒子与 0～32 的墙只相切。
  return { x: center.x - width / 2, y: center.y, width, height };
}

/** 半开矩形交叠；仅相切不算碰撞，避免贴墙时被额外推开。 */
export function aabbIntersects(left: Aabb, right: Aabb): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function tileRange(min: number, max: number, tileSize: number): { min: number; max: number } {
  // max 是半开边界；ceil(max)-1 让恰好贴着格边的盒子不误判为进入下一格。
  return { min: Math.floor(min / tileSize), max: Math.ceil(max / tileSize) - 1 };
}

/**
 * 压缩 collisionLayer 的只读查询器。
 * 领域层只接收 MapDefinition 的尺寸、tile 和 collision，不创建任何渲染对象。
 */
export class CollisionGrid {
  public readonly widthTiles: number;
  public readonly heightTiles: number;
  public readonly tileSize: 16;
  private readonly collisionLayer: readonly (0 | 1)[];
  private readonly blockingObjects: readonly BlockingObject[];

  public constructor(map: CollisionMapLike | Readonly<Pick<MapDefinition, "widthTiles" | "heightTiles" | "tileSize" | "collisionLayer">>, blockingObjects?: readonly BlockingObject[]) {
    assertInteger(map.widthTiles, "widthTiles");
    assertInteger(map.heightTiles, "heightTiles");
    if (map.widthTiles <= 0 || map.heightTiles <= 0) throw new RangeError("地图尺寸必须为正数");
    if (map.tileSize !== TILE_SIZE) throw new RangeError("探索地图 tileSize 必须固定为 16");
    if (map.collisionLayer.length !== map.widthTiles * map.heightTiles) throw new RangeError("collisionLayer 长度与地图尺寸不一致");
    this.widthTiles = map.widthTiles;
    this.heightTiles = map.heightTiles;
    // 这个字段只有类型声明不会在运行时自动赋值，必须显式固化 16，避免坐标换算得到 NaN。
    this.tileSize = TILE_SIZE;
    this.collisionLayer = [...map.collisionLayer];
    for (const value of this.collisionLayer) if (value !== 0 && value !== 1) throw new RangeError("collisionLayer 只允许 0/1");
    const mapObjects = (map as Partial<Pick<MapDefinition, "objects">>).objects;
    const mapBlockingObjects = mapObjects
      ? mapObjects
        .filter((object): object is Extract<MapDefinition["objects"][number], { kind: "npc" }> => object.kind === "npc" && object.blocking)
        .map((object) => ({ objectId: object.objectId, position: object.position, width: FOOT_AABB_WIDTH, height: FOOT_AABB_HEIGHT }))
      : [];
    this.blockingObjects = (blockingObjects ?? mapBlockingObjects).map((object) => {
      assertFinite(object.position.x, `${object.objectId}.x`);
      assertFinite(object.position.y, `${object.objectId}.y`);
      assertFinite(object.width, `${object.objectId}.width`);
      assertFinite(object.height, `${object.objectId}.height`);
      if (object.width <= 0 || object.height <= 0) throw new RangeError("blocking object 尺寸必须为正数");
      return Object.freeze({ ...object, position: Object.freeze({ ...object.position }) });
    });
  }

  public worldToTile(point: Vector2): TilePosition;
  public worldToTile(x: number, y: number): TilePosition;
  public worldToTile(pointOrX: Vector2 | number, y?: number): TilePosition {
    const x = typeof pointOrX === "number" ? pointOrX : pointOrX.x;
    const worldY = typeof pointOrX === "number" ? y : pointOrX.y;
    assertFinite(x, "x");
    assertFinite(worldY ?? Number.NaN, "y");
    return { x: Math.floor(x / this.tileSize), y: Math.floor((worldY as number) / this.tileSize) };
  }

  /** 返回 tile 左上角世界坐标；tile 坐标允许为负，便于边界测试。 */
  public tileToWorld(tile: TilePosition): Vector2 {
    assertInteger(tile.x, "tile.x");
    assertInteger(tile.y, "tile.y");
    return { x: tile.x * this.tileSize, y: tile.y * this.tileSize };
  }

  public isInsideTile(tile: TilePosition): boolean {
    return tile.x >= 0 && tile.y >= 0 && tile.x < this.widthTiles && tile.y < this.heightTiles;
  }

  public isCollisionTile(tile: TilePosition): boolean {
    if (!this.isInsideTile(tile)) return true;
    return this.collisionLayer[tile.y * this.widthTiles + tile.x] === 1;
  }

  /**
   * 查询中心点与宽高定义的脚底盒是否碰撞地图格或 blocking NPC。
   * 地图外始终阻挡，因此角色不会依靠浮点误差越过边界。
   */
  public isBlocked(center: Vector2, width = FOOT_AABB_WIDTH, height = FOOT_AABB_HEIGHT): boolean {
    assertFinite(center.x, "center.x");
    assertFinite(center.y, "center.y");
    assertFinite(width, "width");
    assertFinite(height, "height");
    if (width < 0 || height < 0) throw new RangeError("AABB 尺寸不能为负数");
    // 退化盒没有面积，不应因为锚点恰好落在墙格中而制造碰撞。
    if (width === 0 || height === 0) return false;
    const box = aabbFromCenter(center, width, height);
    const rangeX = tileRange(box.x, box.x + box.width, this.tileSize);
    const rangeY = tileRange(box.y, box.y + box.height, this.tileSize);
    for (let tileY = rangeY.min; tileY <= rangeY.max; tileY += 1) {
      for (let tileX = rangeX.min; tileX <= rangeX.max; tileX += 1) {
        if (this.isCollisionTile({ x: tileX, y: tileY })) return true;
      }
    }
    for (const object of this.blockingObjects) {
      if (aabbIntersects(box, aabbFromCenter(object.position, object.width, object.height))) return true;
    }
    return false;
  }

  public isWalkable(center: Vector2, width = FOOT_AABB_WIDTH, height = FOOT_AABB_HEIGHT): boolean {
    return !this.isBlocked(center, width, height);
  }

  public getBlockingObjects(): readonly BlockingObject[] {
    return this.blockingObjects;
  }
}
