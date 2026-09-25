import { Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";

import type { PixiSceneRoot } from "../../app/PixiSceneRoot";
import type { ViewportResult } from "../../app/ViewportService";
import { LOGICAL_VIEWPORT_HEIGHT, LOGICAL_VIEWPORT_WIDTH } from "../../app/ViewportService";
import type { FieldSceneView, FieldSceneFrame, FieldSceneRendererOptions } from "../../scenes/exploration/FieldSceneView";
import type { ActorResourceReference, ActorView } from "../../scenes/exploration/ActorView";
import type { TileLayerName } from "../../scenes/exploration/TileMapView";
import { FieldHudRenderer } from "./FieldHudRenderer";
import type { FieldDirectionClipsV1, AssetEntryV1 } from "../../content/data/assets.manifest";

export type { FieldSceneRendererOptions } from "../../scenes/exploration/FieldSceneView";

type Facing = "down" | "left" | "right" | "up";
type Motion = "idle" | "walk";

interface ActorNode {
  readonly actor: ActorView;
  readonly group: Container;
  readonly sprite: Sprite;
  readonly label: Text | null;
  readonly resource: ActorResourceReference;
  readonly fieldEntry: Extract<AssetEntryV1, { kind: "fieldActorSheet" }> | null;
  readonly objectTexture: Texture | null;
  readonly shadow: Graphics | null;
  readonly playerMarker: Graphics | null;
  previousPosition: Readonly<{ x: number; y: number }>;
  facing: Facing;
  mounted: boolean;
  readonly displayName: string | null;
}

interface NpcCandidate {
  readonly actor: ActorView;
  readonly distanceSquared: number;
}

function integer(value: number): number {
  return Math.round(value);
}

function resourceKey(resource: ActorResourceReference, displayName: string | null): string {
  const resourcePart = resource.kind === "object"
    ? `${resource.kind}:${resource.frameId}`
    : resource.kind === "npc"
    ? `${resource.kind}:${resource.spriteId}`
    : `${resource.kind}:${resource.fieldSpriteId}`;
  return `${resourcePart}:${displayName ?? ""}`;
}

function fieldSpriteId(resource: ActorResourceReference): string | null {
  if (resource.kind === "object") return null;
  return resource.kind === "npc" ? resource.spriteId : resource.fieldSpriteId;
}

function directionFromDelta(dx: number, dy: number, current: Facing): { facing: Facing; moving: boolean } {
  if (dx === 0 && dy === 0) return { facing: current, moving: false };
  // 绝对值相等时选择竖直轴，保证对角线输入在不同设备上仍得到稳定朝向。
  if (Math.abs(dy) >= Math.abs(dx)) return { facing: dy >= 0 ? "down" : "up", moving: true };
  return { facing: dx >= 0 ? "right" : "left", moving: true };
}

function setNearest(texture: Texture): void {
  texture.source.style.scaleMode = "nearest";
}

/**
 * 共享字段场景渲染器：只把不可变 frame 投影到路由根的显示层，不持有任何领域状态。
 * 地图派生纹理由本实例负责销毁，资源解析器返回的源纹理和 atlas frame 永不销毁。
 */
export class FieldSceneRenderer implements FieldSceneView {
  public readonly hudRenderer: FieldHudRenderer;
  public readonly actorSprites = new Map<string, Sprite>();
  /** 仅用于玩家定位，不冒充正式角色美术。 */
  public readonly playerShadowDisplays = new Map<string, Graphics>();
  public readonly playerMarkerDisplays = new Map<string, Graphics>();
  /** 城镇最近功能 NPC 的屏幕边缘指示器。 */
  public readonly nearestNpcSignpost = new Container();
  public readonly nearestNpcSignpostLabel = new Text({
    text: "",
    style: {
      fontFamily: "monospace",
      fontSize: 11,
      fill: 0xffe8b0,
      stroke: { color: 0x111827, width: 2 },
      align: "center",
    },
    roundPixels: true,
  });

  private readonly root: PixiSceneRoot;
  private readonly assets: FieldSceneRendererOptions["assets"];
  private readonly objectAtlasId: string;
  private readonly inputState: FieldSceneRendererOptions["inputState"];
  private readonly derivedTextures: Texture[] = [];
  private readonly tileSprites: Sprite[] = [];
  private readonly actorNodes = new Map<string, ActorNode>();
  private readonly actorFrameTextures = new Map<string, Texture>();
  private readonly interactionMarker = new Graphics();
  private readonly interactionPrompt = new Text({
    text: "",
    style: {
      fontFamily: "monospace",
      fontSize: 11,
      fill: 0xfff0bd,
      stroke: { color: 0x111827, width: 2 },
      align: "center",
    },
    roundPixels: true,
  });
  private readonly nearestNpcSignpostBackground = new Graphics();
  private readonly nearestNpcSignpostArrow = new Text({
    text: "↑",
    style: {
      fontFamily: "monospace",
      fontSize: 14,
      fill: 0xffd36b,
      stroke: { color: 0x111827, width: 2 },
      align: "center",
    },
    roundPixels: true,
  });
  private viewportValue: ViewportResult;
  private prepared = false;
  private active = false;
  private destroyed = false;
  private mapId: string | null = null;

  public constructor(options: FieldSceneRendererOptions) {
    this.root = options.root;
    this.assets = options.assets;
    this.objectAtlasId = options.objectAtlasId;
    this.inputState = options.inputState;
    this.viewportValue = options.viewport;
    this.hudRenderer = new FieldHudRenderer({ root: this.root.hud, inputState: options.inputState, viewport: options.viewport });
    this.interactionMarker.eventMode = "none";
    this.interactionMarker.visible = false;
    this.interactionMarker.rect(0, 0, 12, 3).fill({ color: 0xffd36b, alpha: 0.92 });
    this.interactionMarker.rect(4, -4, 4, 11).fill({ color: 0xffd36b, alpha: 0.92 });
    this.root.worldFx.addChild(this.interactionMarker);

    this.nearestNpcSignpost.eventMode = "none";
    this.nearestNpcSignpost.visible = false;
    this.nearestNpcSignpostBackground
      .roundRect(-58, -16, 116, 32, 2)
      .fill({ color: 0x111827, alpha: 0.92 })
      .stroke({ color: 0xffd36b, width: 2, alpha: 0.95 });
    this.nearestNpcSignpostArrow.anchor.set(0.5, 0.5);
    this.nearestNpcSignpostArrow.x = 43;
    this.nearestNpcSignpostArrow.y = 0;
    this.nearestNpcSignpostLabel.anchor.set(0.5, 0.5);
    this.nearestNpcSignpostLabel.x = -12;
    this.nearestNpcSignpostLabel.y = 0;
    this.nearestNpcSignpost.addChild(
      this.nearestNpcSignpostBackground,
      this.nearestNpcSignpostLabel,
      this.nearestNpcSignpostArrow,
    );
    this.root.hud.addChild(this.nearestNpcSignpost);
    this.interactionPrompt.anchor.set(0.5, 1);
    this.interactionPrompt.visible = false;
    this.root.hud.addChild(this.interactionPrompt);
  }

  public prepare(frame: FieldSceneFrame): void {
    if (this.destroyed) throw new Error("PIXEL_FIELD_RENDERER_DESTROYED");
    if (this.prepared) {
      if (this.mapId !== frame.map.mapId) throw new Error("PIXEL_FIELD_MAP_CHANGED");
      return;
    }
    this.mapId = frame.map.mapId;
    try {
      this.buildMap(frame);
      this.applyActors(frame);
      this.applyCamera(frame);
      this.applyInteraction(frame);
      this.applyNavigationHint(frame);
      this.hudRenderer.render(
        frame.hud,
        frame.hudStatus,
        frame.interactionTarget !== null,
        this.interactionLabel(frame),
      );
      this.prepared = true;
    } catch (error) {
      // prepare 失败不能留下半张地图或半组角色，避免下一次重试叠加旧对象。
      this.clearBuiltResources();
      this.mapId = null;
      throw error;
    }
  }

  public enter(frame: FieldSceneFrame): void {
    if (this.destroyed) return;
    if (!this.prepared) throw new Error("PIXEL_FIELD_RENDERER_NOT_PREPARED");
    this.active = true;
    this.applyFrame(frame);
    this.hudRenderer.enter(
      frame.hud,
      frame.hudStatus,
      frame.interactionTarget !== null,
      this.interactionLabel(frame),
    );
  }

  public update(frame: FieldSceneFrame): void {
    if (this.destroyed || !this.prepared) return;
    if (this.mapId !== frame.map.mapId) throw new Error("PIXEL_FIELD_MAP_CHANGED");
    this.applyFrame(frame);
    if (this.active) {
      this.hudRenderer.render(
        frame.hud,
        frame.hudStatus,
        frame.interactionTarget !== null,
        this.interactionLabel(frame),
      );
    }
  }

  public setViewport(viewport: ViewportResult): void {
    if (this.destroyed) return;
    this.viewportValue = viewport;
    this.hudRenderer.setViewport(viewport);
  }

  public pause(): void {
    if (this.destroyed) return;
    this.active = false;
    this.inputState.resetAll();
    this.hudRenderer.pause();
  }

  public resume(frame: FieldSceneFrame): void {
    if (this.destroyed) return;
    this.active = true;
    this.applyFrame(frame);
    this.hudRenderer.resume(
      frame.hud,
      frame.hudStatus,
      frame.interactionTarget !== null,
      this.interactionLabel(frame),
    );
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    this.inputState.resetAll();
    this.hudRenderer.destroy();
    this.root.worldFx.removeChild(this.interactionMarker);
    this.interactionMarker.destroy();
    this.root.hud.removeChild(this.nearestNpcSignpost);
    this.nearestNpcSignpost.destroy({ children: true });
    this.root.hud.removeChild(this.interactionPrompt);
    this.interactionPrompt.destroy();
    for (const node of this.actorNodes.values()) {
      this.root.actors.removeChild(node.group);
      node.group.destroy({ children: true });
    }
    this.actorNodes.clear();
    this.actorSprites.clear();
    this.playerShadowDisplays.clear();
    this.playerMarkerDisplays.clear();
    this.clearBuiltResources();
  }

  private clearBuiltResources(): void {
    for (const node of this.actorNodes.values()) {
      node.group.removeFromParent();
      node.group.destroy({ children: true });
    }
    this.actorNodes.clear();
    this.actorSprites.clear();
    this.playerShadowDisplays.clear();
    this.playerMarkerDisplays.clear();
    for (const sprite of this.tileSprites) {
      sprite.removeFromParent();
      sprite.destroy();
    }
    this.tileSprites.length = 0;
    for (const texture of this.derivedTextures) texture.destroy(false);
    this.derivedTextures.length = 0;
    this.actorFrameTextures.clear();
  }

  private applyFrame(frame: FieldSceneFrame): void {
    this.applyActors(frame);
    this.applyCamera(frame);
    this.applyInteraction(frame);
    this.applyNavigationHint(frame);
  }

  private buildMap(frame: FieldSceneFrame): void {
    const mapEntry = this.assets.requireEntry(frame.map.tilesetAssetId);
    if (mapEntry.kind !== "mapTileset") throw new Error(`PIXEL_TILESET_ENTRY_KIND_INVALID:${frame.map.tilesetAssetId}`);
    const sourceTexture = this.assets.requireTexture(frame.map.tilesetAssetId);
    setNearest(sourceTexture);
    this.buildLayer(frame, mapEntry, sourceTexture, "ground");
    this.buildLayer(frame, mapEntry, sourceTexture, "decorBack");
    this.buildLayer(frame, mapEntry, sourceTexture, "decorFront");
  }

  private buildLayer(
    frame: FieldSceneFrame,
    entry: Extract<AssetEntryV1, { kind: "mapTileset" }>,
    sourceTexture: Texture,
    layerName: Exclude<TileLayerName, "collision">,
  ): void {
    const layer = frame.map.getLayer(layerName);
    const target = layerName === "decorFront" ? this.root.mapFront : this.root.mapBack;
    for (let cellIndex = 0; cellIndex < layer.values.length; cellIndex += 1) {
      const rawValue = layer.values[cellIndex];
      if (layerName !== "ground" && rawValue === 0) continue;
      const tileIndex = layerName === "ground" ? rawValue : rawValue - 1;
      if (tileIndex < 0 || tileIndex >= entry.columns * entry.rows) {
        throw new Error(`PIXEL_TILE_INDEX_OUT_OF_RANGE:${frame.map.mapId}/${layerName}/${cellIndex}/${tileIndex}`);
      }
      const tileTexture = this.deriveTexture(sourceTexture, tileIndex, entry.columns, entry.tileSize, `tile:${frame.map.mapId}:${layerName}:${cellIndex}`);
      const sprite = new Sprite(tileTexture);
      const column = cellIndex % frame.map.widthTiles;
      const row = Math.floor(cellIndex / frame.map.widthTiles);
      sprite.x = integer(column * frame.map.tileSize);
      sprite.y = integer(row * frame.map.tileSize);
      sprite.roundPixels = true;
      target.addChild(sprite);
      this.tileSprites.push(sprite);
    }
  }

  private deriveTexture(sourceTexture: Texture, tileIndex: number, columns: number, tileSize: number, label: string): Texture {
    const frame = new Rectangle((tileIndex % columns) * tileSize, Math.floor(tileIndex / columns) * tileSize, tileSize, tileSize);
    const texture = new Texture({ source: sourceTexture.source, frame, label });
    setNearest(texture);
    this.derivedTextures.push(texture);
    return texture;
  }

  private applyActors(frame: FieldSceneFrame): void {
    const seen = new Set<string>();
    for (const actor of frame.actors) {
      seen.add(actor.objectId);
      const existing = this.actorNodes.get(actor.objectId);
      const node = existing && resourceKey(existing.resource, existing.displayName) === resourceKey(actor.resource, actor.displayName)
        ? existing
        : this.createActorNode(actor);
      if (existing !== node) {
        if (existing) {
          this.root.actors.removeChild(existing.group);
          existing.group.destroy({ children: true });
          this.playerShadowDisplays.delete(actor.objectId);
          this.playerMarkerDisplays.delete(actor.objectId);
          this.actorNodes.delete(actor.objectId);
        }
        this.actorNodes.set(actor.objectId, node);
        this.root.actors.addChild(node.group);
        node.mounted = true;
        this.actorSprites.set(actor.objectId, node.sprite);
        if (node.shadow) this.playerShadowDisplays.set(actor.objectId, node.shadow);
        if (node.playerMarker) this.playerMarkerDisplays.set(actor.objectId, node.playerMarker);
      }
      this.updateActorNode(node, actor, frame.animationStep, frame.hiddenObjectIds.includes(actor.objectId));
    }
    for (const [objectId, node] of this.actorNodes) {
      if (seen.has(objectId)) continue;
      this.root.actors.removeChild(node.group);
      node.group.destroy({ children: true });
      this.actorNodes.delete(objectId);
      this.actorSprites.delete(objectId);
      this.playerShadowDisplays.delete(objectId);
      this.playerMarkerDisplays.delete(objectId);
    }
    this.root.actors.sortChildren();
  }

  private createActorNode(actor: ActorView): ActorNode {
    const resource = actor.resource;
    const spriteId = fieldSpriteId(resource);
    let fieldEntry: Extract<AssetEntryV1, { kind: "fieldActorSheet" }> | null = null;
    let objectTexture: Texture | null = null;
    let sprite: Sprite;
    if (resource.kind === "object") {
      // objectAtlasId 是场景构造时的唯一 atlas 来源，frameId 不参与 atlas 推断。
      objectTexture = this.assets.requireAtlasFrame(this.objectAtlasId, resource.frameId);
      sprite = new Sprite(objectTexture);
      setNearest(objectTexture);
      sprite.anchor.set(0.5, 1);
    } else {
      if (spriteId === null) throw new Error(`PIXEL_FIELD_ACTOR_RESOURCE_INVALID:${actor.objectId}`);
      const entry = this.assets.requireEntry(spriteId);
      if (entry.kind !== "fieldActorSheet") throw new Error(`PIXEL_FIELD_ACTOR_ENTRY_KIND_INVALID:${spriteId}`);
      fieldEntry = entry;
      const firstTexture = this.getActorFrameTexture(entry, spriteId, "down", "idle", 0);
      sprite = new Sprite(firstTexture);
      sprite.anchor.set(12 / 24, 28 / 32);
    }
    sprite.roundPixels = true;
    sprite.eventMode = "none";
    let shadow: Graphics | null = null;
    let playerMarker: Graphics | null = null;
    if (resource.kind === "player") {
      // 纯程序图形只负责脚底定位和玩家识别，不替代正式角色图。
      shadow = new Graphics();
      shadow.rect(-10, -1, 20, 3).fill({ color: 0x080b14, alpha: 0.58 });
      shadow.rect(-6, -2, 12, 1).fill({ color: 0x080b14, alpha: 0.4 });
      shadow.eventMode = "none";
      playerMarker = new Graphics();
      playerMarker.moveTo(-5, -38).lineTo(0, -43).lineTo(5, -38);
      playerMarker.moveTo(-5, -38).lineTo(-5, -34);
      playerMarker.moveTo(5, -38).lineTo(5, -34);
      playerMarker.stroke({ color: 0x7ce8ff, width: 2, alpha: 0.98 });
      playerMarker.eventMode = "none";
    }
    const label = actor.displayName === null ? null : new Text({
      text: actor.displayName,
      style: {
        fontFamily: "monospace",
        fontSize: 10,
        fill: 0xffe7b1,
        stroke: { color: 0x121827, width: 2 },
        align: "center",
      },
      roundPixels: true,
    });
    if (label) {
      label.anchor.set(0.5, 1);
      label.x = 0;
      label.y = -30;
    }
    const group = new Container();
    group.eventMode = "none";
    if (shadow) group.addChild(shadow);
    group.addChild(sprite);
    if (playerMarker) group.addChild(playerMarker);
    if (label) group.addChild(label);
    return {
      actor,
      group,
      sprite,
      label,
      resource,
      fieldEntry,
      objectTexture,
      shadow,
      playerMarker,
      previousPosition: { ...actor.position },
      facing: "down",
      mounted: false,
      displayName: actor.displayName,
    };
  }

  private updateActorNode(node: ActorNode, actor: ActorView, animationStep: number, hidden: boolean): void {
    const current = actor.position;
    const dx = current.x - node.previousPosition.x;
    const dy = current.y - node.previousPosition.y;
    const direction = directionFromDelta(dx, dy, node.facing);
    node.facing = direction.facing;
    node.group.x = integer(current.x);
    node.group.y = integer(current.y);
    node.group.zIndex = actor.zIndex;
    node.group.visible = !hidden;
    if (hidden && node.mounted) {
      this.root.actors.removeChild(node.group);
      node.mounted = false;
    } else if (!hidden && !node.mounted) {
      this.root.actors.addChild(node.group);
      node.mounted = true;
    }
    node.previousPosition = { x: current.x, y: current.y };
    if (node.fieldEntry) {
      const spriteId = fieldSpriteId(node.resource);
      if (spriteId === null) throw new Error(`PIXEL_FIELD_ACTOR_RESOURCE_INVALID:${actor.objectId}`);
      node.sprite.texture = this.getActorFrameTexture(node.fieldEntry, spriteId, node.facing, direction.moving ? "walk" : "idle", animationStep);
      node.sprite.anchor.set(12 / 24, 28 / 32);
    }
  }

  private getActorFrameTexture(
    entry: Extract<AssetEntryV1, { kind: "fieldActorSheet" }>,
    spriteId: string,
    facing: Facing,
    motion: Motion,
    animationStep: number,
  ): Texture {
    const direction: FieldDirectionClipsV1 = entry.clips[facing];
    const clip = direction[motion];
    const phase = Math.floor(animationStep * clip.fps / 60) % clip.frameCount;
    const column = clip.startColumn + phase;
    const key = `${spriteId}:${facing}:${motion}:${column}`;
    const cached = this.actorFrameTextures.get(key);
    if (cached) return cached;
    if (column < 0 || column >= entry.columns || direction.row < 0 || direction.row >= entry.rows) {
      throw new Error(`PIXEL_FIELD_ACTOR_CLIP_OUT_OF_RANGE:${spriteId}/${facing}/${motion}`);
    }
    const sourceTexture = this.assets.requireTexture(spriteId);
    setNearest(sourceTexture);
    const texture = new Texture({
      source: sourceTexture.source,
      frame: new Rectangle(column * entry.frameWidth, direction.row * entry.frameHeight, entry.frameWidth, entry.frameHeight),
      label: `actor:${key}`,
    });
    setNearest(texture);
    this.actorFrameTextures.set(key, texture);
    this.derivedTextures.push(texture);
    return texture;
  }

  private applyCamera(frame: FieldSceneFrame): void {
    const x = integer(frame.camera.rootOffsetX);
    const y = integer(frame.camera.rootOffsetY);
    this.root.mapBack.position.set(x, y);
    this.root.actors.position.set(x, y);
    this.root.mapFront.position.set(x, y);
    this.root.worldFx.position.set(x, y);
    // HUD 位于独立根层，永远不跟随世界摄像机偏移。
    this.root.hud.position.set(0, 0);
  }

  private applyInteraction(frame: FieldSceneFrame): void {
    const target = frame.interactionTarget;
    if (!target) {
      this.interactionMarker.visible = false;
      this.interactionPrompt.visible = false;
      return;
    }
    this.interactionMarker.visible = true;
    this.interactionMarker.x = integer(target.object.position.x - 6);
    this.interactionMarker.y = integer(target.object.position.y - 38);
    this.interactionPrompt.text = target.object.kind === "npc"
      ? "交谈"
      : target.object.kind === "portal"
        ? "进入"
        : "交互";
    this.interactionPrompt.x = integer(target.object.position.x - frame.camera.x);
    this.interactionPrompt.y = integer(target.object.position.y - frame.camera.y - 40);
    this.interactionPrompt.visible = true;
  }

  private interactionLabel(frame: FieldSceneFrame): string {
    const target = frame.interactionTarget;
    if (!target) return "交互";
    return target.object.kind === "npc" ? "交谈" : target.object.kind === "portal" ? "进入" : "交互";
  }

  /**
   * 城镇首屏用边缘路标把玩家引向最近功能 NPC；NPC 进入当前相机视口后让位给角色本身。
   * 选择只依赖 ActorView 的 npc 判别、玩家位置和相机，按距离再按 objectId 固定排序。
   */
  private applyNavigationHint(frame: FieldSceneFrame): void {
    if (frame.hudStatus.sceneKind !== "town") {
      this.nearestNpcSignpost.visible = false;
      return;
    }
    const player = frame.actors.find((actor) => actor.resource.kind === "player");
    if (!player) {
      this.nearestNpcSignpost.visible = false;
      return;
    }
    const candidates: NpcCandidate[] = frame.actors
      .filter((actor) => actor.resource.kind === "npc")
      .map((actor) => {
        const dx = actor.position.x - player.position.x;
        const dy = actor.position.y - player.position.y;
        return { actor, distanceSquared: dx * dx + dy * dy };
      })
      .sort((left, right) => left.distanceSquared - right.distanceSquared || left.actor.objectId.localeCompare(right.actor.objectId));
    const nearest = candidates[0]?.actor;
    if (!nearest) {
      this.nearestNpcSignpost.visible = false;
      return;
    }
    const screenX = nearest.position.x - frame.camera.x;
    const screenY = nearest.position.y - frame.camera.y;
    const inViewport = screenX >= 0
      && screenX <= LOGICAL_VIEWPORT_WIDTH
      && screenY >= 0
      && screenY <= LOGICAL_VIEWPORT_HEIGHT;
    if (inViewport) {
      this.nearestNpcSignpost.visible = false;
      return;
    }

    const dx = nearest.position.x - player.position.x;
    const dy = nearest.position.y - player.position.y;
    const arrow = Math.abs(dx) >= Math.abs(dy)
      ? dx >= 0 ? "→" : "←"
      : dy >= 0 ? "↓" : "↑";
    // 冻结内容中的首屏制图师用玩家可理解的功能名，其余 NPC 使用现有显示名。
    const label = nearest.objectId.includes("cartographer") ? "制图师" : nearest.displayName ?? "功能 NPC";
    this.nearestNpcSignpostLabel.text = `${label} ${arrow}`;
    // 方向与文案合并为一个稳定可读的提示；保留独立箭头节点以便后续皮肤覆盖。
    this.nearestNpcSignpostArrow.visible = false;
    const safe = frame.hud.safeRect;
    const left = safe.x + 68;
    const right = safe.right - 68;
    const top = safe.y + 26;
    const bottom = safe.bottom - 26;
    const playerScreenX = player.position.x - frame.camera.x;
    const playerScreenY = player.position.y - frame.camera.y;
    const magnitude = Math.hypot(dx, dy) || 1;
    const directionX = dx / magnitude;
    const directionY = dy / magnitude;
    const edgeT = Math.min(
      Math.abs(directionX) > 0 ? (directionX > 0 ? (right - playerScreenX) / directionX : (left - playerScreenX) / directionX) : Number.POSITIVE_INFINITY,
      Math.abs(directionY) > 0 ? (directionY > 0 ? (bottom - playerScreenY) / directionY : (top - playerScreenY) / directionY) : Number.POSITIVE_INFINITY,
    );
    const edgeX = playerScreenX + directionX * Math.max(0, edgeT);
    const edgeY = playerScreenY + directionY * Math.max(0, edgeT);
    this.nearestNpcSignpost.position.set(
      // 顶部/侧边路标避开 HUD 首行，仍保持在安全区边缘带内。
      Math.round(Math.min(right, Math.max(left, Number.isFinite(edgeX) ? edgeX : (left + right) / 2))),
      Math.round(Math.min(bottom, Math.max(top + 92, Number.isFinite(edgeY) ? edgeY : top + 92))),
    );
    this.nearestNpcSignpost.visible = true;
  }
}
