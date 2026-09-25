import type { MapDefinition, Vector2 } from "../../content/contracts";

export const LOGICAL_VIEWPORT_WIDTH = 640;
export const LOGICAL_VIEWPORT_HEIGHT = 360;
export const CAMERA_DEAD_ZONE_WIDTH = 96;
export const CAMERA_DEAD_ZONE_HEIGHT = 54;

export interface CameraMapSize {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tileSize: 16;
}

export interface CameraOptions {
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly deadZoneWidth?: number;
  readonly deadZoneHeight?: number;
  readonly previous?: Vector2;
}

export interface CameraPosition extends Vector2 {
  /** 世界根节点应使用该整数反向平移，避免像素纹理抖动。 */
  readonly rootOffsetX: number;
  readonly rootOffsetY: number;
}

function mapSize(map: CameraMapSize): { width: number; height: number } {
  return { width: map.widthTiles * map.tileSize, height: map.heightTiles * map.tileSize };
}

function integer(value: number): number {
  return Math.round(value);
}

function clampCamera(value: number, mapPixels: number, viewport: number): number {
  if (mapPixels <= viewport) return (mapPixels - viewport) / 2;
  return Math.min(mapPixels - viewport, Math.max(0, value));
}

/**
 * 计算世界相机左上角。previous 存在时使用 96×54 死区，否则从玩家中心初始化。
 * 输出 x/y 及 rootOffset 都是稳定整数；地图小于视口时保留负半余量以居中。
 */
export function calculateCameraPosition(
  playerPosition: Vector2,
  map: CameraMapSize | Readonly<Pick<MapDefinition, "widthTiles" | "heightTiles" | "tileSize">>,
  options: CameraOptions = {},
): CameraPosition {
  const viewportWidth = options.viewportWidth ?? LOGICAL_VIEWPORT_WIDTH;
  const viewportHeight = options.viewportHeight ?? LOGICAL_VIEWPORT_HEIGHT;
  const deadZoneWidth = options.deadZoneWidth ?? CAMERA_DEAD_ZONE_WIDTH;
  const deadZoneHeight = options.deadZoneHeight ?? CAMERA_DEAD_ZONE_HEIGHT;
  if (viewportWidth <= 0 || viewportHeight <= 0 || deadZoneWidth < 0 || deadZoneHeight < 0) throw new RangeError("camera 尺寸必须合法");
  const pixels = mapSize(map);
  const halfWidth = viewportWidth / 2;
  const halfHeight = viewportHeight / 2;
  const previous = options.previous;
  let x = previous ? previous.x : playerPosition.x - halfWidth;
  let y = previous ? previous.y : playerPosition.y - halfHeight;
  if (previous) {
    const centerX = previous.x + halfWidth;
    const centerY = previous.y + halfHeight;
    const left = centerX - deadZoneWidth / 2;
    const right = centerX + deadZoneWidth / 2;
    const top = centerY - deadZoneHeight / 2;
    const bottom = centerY + deadZoneHeight / 2;
    // 越过哪一侧就把玩家放在对应死区边界，避免右/下方向跳到死区另一侧。
    if (playerPosition.x < left) x = playerPosition.x - (halfWidth - deadZoneWidth / 2);
    else if (playerPosition.x > right) x = playerPosition.x - (halfWidth + deadZoneWidth / 2);
    if (playerPosition.y < top) y = playerPosition.y - (halfHeight - deadZoneHeight / 2);
    else if (playerPosition.y > bottom) y = playerPosition.y - (halfHeight + deadZoneHeight / 2);
  }
  const cameraX = integer(clampCamera(x, pixels.width, viewportWidth));
  const cameraY = integer(clampCamera(y, pixels.height, viewportHeight));
  return { x: cameraX, y: cameraY, rootOffsetX: -cameraX, rootOffsetY: -cameraY };
}

export class CameraSystem {
  private previous: Vector2 | undefined;
  public constructor(
    private readonly map: CameraMapSize | Readonly<Pick<MapDefinition, "widthTiles" | "heightTiles" | "tileSize">>,
    private readonly options: Omit<CameraOptions, "previous"> = {},
  ) {}

  public update(playerPosition: Vector2): CameraPosition {
    const next = calculateCameraPosition(playerPosition, this.map, { ...this.options, previous: this.previous });
    this.previous = { x: next.x, y: next.y };
    return next;
  }

  public reset(previous?: Vector2): void {
    this.previous = previous ? { ...previous } : undefined;
  }
}
