import type { Vector2 } from "../../content/contracts";

export const FIELD_ACTOR_FOOT_ANCHOR = Object.freeze({ x: 12, y: 28 });

export type ActorResourceReference =
  | { readonly kind: "player"; readonly fieldSpriteId: string }
  | { readonly kind: "npc"; readonly spriteId: string }
  | { readonly kind: "encounter"; readonly fieldSpriteId: string }
  | { readonly kind: "object"; readonly frameId: "object_chest_closed" | "object_portal_floor" | "object_portal_return" };

export interface ActorResourceSource {
  hasFieldSprite(assetId: string): boolean;
  hasCoreFrame(frameId: string): boolean;
}

export interface ActorViewOptions {
  readonly objectId: string;
  readonly resource: ActorResourceReference;
  readonly displayName?: string;
  readonly resources: ActorResourceSource;
  readonly position: Vector2;
}

function assertPosition(position: Vector2): void {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new RangeError("Actor position 必须是有限坐标");
}

function resolveResourceId(resource: ActorResourceReference, resources: ActorResourceSource): string {
  if (resource.kind === "object") {
    if (!resources.hasCoreFrame(resource.frameId)) throw new Error(`ASSET_FRAME_MISSING:${resource.frameId}`);
    return resource.frameId;
  }
  const id = resource.kind === "npc" ? resource.spriteId : resource.fieldSpriteId;
  if (id.length === 0 || !resources.hasFieldSprite(id)) throw new Error(`ASSET_FIELD_SPRITE_MISSING:${id}`);
  return id;
}

/**
 * 探索 actor 的轻量 ViewModel。真实 Sprite 由 Scene 适配器绑定；这里固定脚底锚点、zIndex 和排序脏标记。
 */
export class ActorView {
  public readonly objectId: string;
  /** 保留资源判别字段的冻结副本，渲染器必须按 kind 精确分派。 */
  public readonly resource: ActorResourceReference;
  public readonly resourceId: string;
  public readonly displayName: string | null;
  public readonly footAnchor = FIELD_ACTOR_FOOT_ANCHOR;
  private positionValue: Vector2;
  private zIndexValue: number;
  private sortDirtyValue = true;

  public constructor(options: ActorViewOptions) {
    if (options.objectId.length === 0) throw new RangeError("Actor objectId 不能为空");
    assertPosition(options.position);
    this.objectId = options.objectId;
    this.resource = Object.freeze({ ...options.resource });
    this.resourceId = resolveResourceId(options.resource, options.resources);
    const trimmedName = options.displayName?.trim() ?? "";
    this.displayName = trimmedName.length > 0 ? trimmedName : null;
    this.positionValue = Object.freeze({ ...options.position });
    this.zIndexValue = Math.floor(options.position.y);
  }

  public get position(): Vector2 { return this.positionValue; }
  public get zIndex(): number { return this.zIndexValue; }
  public get sortDirty(): boolean { return this.sortDirtyValue; }

  public setPosition(position: Vector2): boolean {
    assertPosition(position);
    const nextZ = Math.floor(position.y);
    const crossedIntegerY = nextZ !== this.zIndexValue;
    this.positionValue = Object.freeze({ ...position });
    if (crossedIntegerY) {
      this.zIndexValue = nextZ;
      this.sortDirtyValue = true;
    }
    return crossedIntegerY;
  }

  public clearSortDirty(): void {
    this.sortDirtyValue = false;
  }
}
