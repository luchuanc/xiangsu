import { UI_FONT } from "./UiTheme";
import { battleEffectFrames, skillAnimation } from "./BattleEffectArt";
import type { AnimationPresetId } from "../../content/data/animations";
import { AnimatedSprite, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import type { PixiSceneRoot } from "../../app/PixiSceneRoot";
import type { ViewportResult } from "../../app/ViewportService";
import {
  BattleHud,
  type BattleHudActionId,
  type BattleHudLayout,
  type BattleHudLayoutAction,
} from "../../scenes/battle/BattleHud";
import type { BattleUnitViewModel } from "../../scenes/battle/BattleView";
import type { BattleSceneFrame, BattleUnitNameResolver } from "../../scenes/battle/BattleSceneView";
import type { BattleDomainEventV1, Element } from "../../content/contracts";
import { BattleCommandButton, type BattleCommandIcon } from "./BattleCommandButton";
import type { PixiRenderAssetSource } from "./PixiAssetResolver";
import type { AssetEntryV1, BattleActorClipsV1 } from "../../content/data/assets.manifest";
import type { BattleArtResources } from "./BattleArtResources";

const ACTION_LABELS: Readonly<Record<BattleHudActionId, string>> = Object.freeze({
  basic: "普攻",
  skill: "技能",
  defend: "防御",
  item: "药水",
  more: "更多",
  active_1: "主动",
  active_2: "锁定",
  ultimate: "终极",
  retreat: "撤退",
  log: "战报",
});

const ACTION_ICONS: Readonly<Record<BattleHudActionId, BattleCommandIcon>> = Object.freeze({
  basic: "sword",
  skill: "spell",
  defend: "shield",
  item: "potion",
  more: "more",
  active_1: "active",
  active_2: "spell",
  ultimate: "ultimate",
  retreat: "retreat",
  log: "log",
});

const PARTY_DARK = 0x274c70;
const ENEMY_DARK = 0x642f42;
const PARCHMENT = 0xf4dfb2;
const MUTED = 0xb8b7c8;

export interface BattleUnitNode {
  readonly group: Container;
  readonly unitId: string;
  readonly assetId: string;
  readonly sprite: AnimatedSprite;
  readonly alive: boolean;
  readonly position: Readonly<{ x: number; y: number }>;
  readonly cardBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
}

export interface BattleSceneRendererOptions {
  readonly root: PixiSceneRoot;
  readonly hud: BattleHud;
  readonly viewport: ViewportResult;
  readonly unitName: BattleUnitNameResolver;
  /** 技能/Combo 名称必须由上层按当前 ContentCatalog 显式解析后注入。 */
  readonly skillLabel: (skillId: string) => string;
  readonly comboLabel: (comboId: string) => string;
  /** 一级战斗指令的动态文案由 GameFlow 按当前装备注入，空值回退到固定中文标签。 */
  readonly actionLabel?: (actionId: BattleHudActionId) => string | null;
  readonly assets: PixiRenderAssetSource;
  readonly battleSpriteId: (unit: BattleUnitViewModel) => string;
  readonly animationSpeed?: 1 | 2;
  readonly reducedFlashes?: boolean;
  readonly onAction: (action: BattleHudActionId) => void | Promise<void>;
}

function textStyle(fill: number, fontSize: number): Record<string, unknown> {
  return {
    fontFamily: UI_FONT,
    fontSize,
    fill,
    stroke: { color: 0x111827, width: 2 },
    align: "left",
  };
}

function setTextPosition(text: Text, x: number, y: number): void {
  text.x = Math.round(x);
  text.y = Math.round(y);
}

/** 战斗表现只消费正式 battle actor sheet；领域快照与资源 ID 由上层显式注入。 */
export class BattleSceneRenderer {
  public readonly layer: Container;
  public readonly background: Graphics;
  public readonly partyNodes: BattleUnitNode[] = [];
  public readonly enemyNodes: BattleUnitNode[] = [];
  public readonly primaryButtons = new Map<BattleHudActionId, BattleCommandButton>();
  public readonly secondaryButtons = new Map<BattleHudActionId, BattleCommandButton>();

  private readonly root: PixiSceneRoot;
  private readonly hud: BattleHud;
  private readonly unitName: BattleUnitNameResolver;
  private readonly skillLabel: BattleSceneRendererOptions["skillLabel"];
  private readonly comboLabel: BattleSceneRendererOptions["comboLabel"];
  private readonly actionLabel: BattleSceneRendererOptions["actionLabel"];
  private readonly assets: PixiRenderAssetSource;
  private readonly battleSpriteId: BattleSceneRendererOptions["battleSpriteId"];
  private readonly animationSpeed: 1 | 2;
  private readonly reducedFlashes: boolean;
  private readonly onAction: BattleSceneRendererOptions["onAction"];
  private viewportValue: ViewportResult;
  private frame: BattleSceneFrame | null = null;
  private prepared = false;
  private active = false;
  private destroyed = false;
  private readonly timelineLayer = new Container({ label: "battle-timeline" });
  private readonly statusLayer = new Container({ label: "battle-status" });
  private readonly feedbackLayer = new Container({ label: "battle-feedback" });
  private readonly buttonLayer = new Container({ label: "battle-actions" });
  private readonly bottomBar = new Graphics({ label: "battle-action-bar" });
  private readonly bottomHintText = new Text({ text: "", style: textStyle(MUTED, 10), roundPixels: true });
  private drawerBackButton: BattleCommandButton | null = null;
  private backgroundSprite: Sprite | null = null;
  private artResources: BattleArtResources | null = null;
  private readonly actorGroups = new Set<Container>();
  private readonly actorNodes = new Map<string, BattleUnitNode>();
  private readonly timelineTexts: Text[] = [];
  private readonly derivedTextures: Texture[] = [];
  private readonly actorFrameTextures = new Map<string, Texture>();
  /** 临时位移、染色和浮字都由 renderer 自己持有，pause/destroy 时统一撤销。 */
  private readonly transientTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly transientMoveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly transientPositions = new Map<string, Readonly<{ x: number; y: number }>>();
  private readonly defeatedVisualUnits = new Set<string>();
  private readonly revivedVisualUnits = new Set<string>();
  private readonly transientTexts = new Set<Text>();
  private readonly transientContainers = new Set<Container>();
  private readonly intentMarkers = new Map<string, Container>();
  private readonly comboDisplayKeys = new Set<string>();
  private lastFeedbackBattleId: string | null = null;
  private readonly headerText = new Text({ text: "", style: textStyle(PARCHMENT, 15), roundPixels: true });
  private readonly currentActorText = new Text({ text: "", style: textStyle(MUTED, 11), roundPixels: true });

  public constructor(options: BattleSceneRendererOptions) {
    this.root = options.root;
    this.hud = options.hud;
    this.viewportValue = options.viewport;
    this.unitName = options.unitName;
    this.skillLabel = options.skillLabel;
    this.comboLabel = options.comboLabel;
    this.actionLabel = options.actionLabel;
    this.assets = options.assets;
    this.battleSpriteId = options.battleSpriteId;
    this.animationSpeed = options.animationSpeed ?? 1;
    this.reducedFlashes = options.reducedFlashes ?? false;
    this.onAction = options.onAction;
    this.layer = new Container({ label: "battle-ui" });
    this.background = new Graphics({ label: "battle-background" });
    this.root.mapBack.addChild(this.background);
    this.root.hud.addChild(this.layer);
    this.layer.addChild(this.timelineLayer, this.statusLayer, this.feedbackLayer, this.buttonLayer);
    this.headerText.eventMode = "none";
    this.currentActorText.eventMode = "none";
    this.currentActorText.anchor.set(1, 0);
    this.bottomHintText.eventMode = "none";
    this.drawBackground();
    this.statusLayer.addChild(this.headerText, this.currentActorText);
    this.buttonLayer.addChild(this.bottomBar, this.bottomHintText);
    this.layer.visible = false;
  }

  public prepare(frame: BattleSceneFrame): void {
    this.assertAlive();
    if (this.prepared) {
      this.update(frame);
      return;
    }
    this.frame = frame;
    this.renderFrame(frame);
    this.prepared = true;
  }

  public enter(frame: BattleSceneFrame): void {
    this.assertAlive();
    if (!this.prepared) throw new Error("BATTLE_RENDERER_NOT_PREPARED");
    this.active = true;
    this.layer.visible = true;
    this.renderFrame(frame);
  }

  public update(frame: BattleSceneFrame): void {
    if (this.destroyed) return;
    if (!this.prepared) return;
    this.frame = frame;
    this.renderFrame(frame);
  }

  public setViewport(viewport: ViewportResult): void {
    if (this.destroyed) return;
    this.viewportValue = viewport;
    this.hud.setViewport(viewport);
    if (this.frame !== null) this.renderFrame({ ...this.frame, hud: this.hud.getLayout() ?? this.frame.hud });
  }

  /**
   * 接入主流程提供的正式战斗美术资源。背景图覆盖 fallback Graphics，
   * 单帧角色图只接管明确提供的 assetId，其余角色继续使用原有正式横向图集。
   */
  public setArtResources(resources: BattleArtResources): void {
    if (this.destroyed) return;
    if (this.backgroundSprite === null) {
      this.backgroundSprite = new Sprite();
      this.backgroundSprite.eventMode = "none";
      this.backgroundSprite.x = 0;
      this.backgroundSprite.y = 0;
      this.backgroundSprite.width = 640;
      this.backgroundSprite.height = 360;
      this.root.mapBack.addChildAt(this.backgroundSprite, 0);
    }
    this.backgroundSprite.texture = resources.background;
    this.backgroundSprite.visible = true;
    this.background.visible = false;
    this.artResources = resources;
    if (this.prepared && this.frame !== null) this.renderFrame(this.frame);
  }

  /**
   * 表现层只根据已提交的事件切换动作 clip；按钮点击不会直接调用这里。
   * 领域事件中的 unitId 是唯一的目标/行动者引用，不根据名称猜测角色。
   */
  public animateEvent(event: BattleDomainEventV1): void {
    if (this.destroyed || !this.prepared || !this.active) return;
    switch (event.type) {
      case "ACTION_STARTED":
        this.dashActor(event.actorUnitId, event.targetUnitIds[0] ?? null);
        {
          const animation = skillAnimation(event.visualSkillId);
          if (animation && (animation.presetId === "projectile" || animation.presetId === "area")) {
            for (const target of event.targetUnitIds) this.showSkillEffect(target, animation.presetId, animation.element, event.actorUnitId);
          }
        }
        if (event.actionKind === "basic") this.playActorClip(event.actorUnitId, "attack");
        else if (event.actionKind === "active" || event.actionKind === "ultimate") {
          this.playActorClip(event.actorUnitId, "skill");
          if (event.visualSkillId !== null && event.visualSkillId.trim().length > 0) {
            this.showBanner(`技能 · ${this.skillLabel(event.visualSkillId)}`, this.bannerDuration(480, 320));
          }
        }
        return;
      case "COMBO_TRIGGERED":
        this.showComboBanner(event);
        return;
      case "INTENT_DECLARED":
        this.showIntentMarker(event.intentId, event.sourceUnitId, event.skillId);
        return;
      case "INTENT_RELEASED":
      case "INTENT_CLEARED":
        this.removeIntentMarker(event.intentId);
        return;
      case "DAMAGE_RESOLVED":
        // 周期伤害没有直接命中表现；只有领域明确标记为 direct 才播放受击帧。
        if (event.damageKind === "direct") {
          this.knockBack(event.targetUnitId, event.sourceUnitId);
          this.showDamageText(event.targetUnitId, event.shieldDamage + event.hpDamage, event.hitResult === "critical", event.element);
          this.tintHit(event.targetUnitId);
          this.playActorClip(event.targetUnitId, "hit");
        }
        return;
      case "HEAL_RESOLVED":
        this.showValueText(event.targetUnitId, event.healed, 0x75e6a2);
        this.showSkillEffect(event.targetUnitId, "heal", "holy");
        return;
      case "SHIELD_GRANTED":
        this.showValueText(event.targetUnitId, event.granted, 0x6dc8ff);
        this.showSkillEffect(event.targetUnitId, "shield", "holy");
        return;
      case "STATUS_CHANGED":
        if (["applied", "refreshed", "stacked", "dispelled"].includes(event.change)) this.showSkillEffect(event.targetUnitId, "status", "physical");
        return;
      case "UNIT_SUMMONED":
        this.showSkillEffect(event.unitId, "summon", "dark");
        return;
      case "UNIT_DEFEATED":
        this.playActorClip(event.unitId, "down");
        return;
      case "UNIT_REVIVED":
        this.defeatedVisualUnits.delete(event.unitId);
        this.revivedVisualUnits.add(event.unitId);
        this.playActorClip(event.unitId, "idle");
        this.showSkillEffect(event.unitId, "heal", "holy");
        return;
      case "ACTION_FINISHED":
        this.restoreActorClip(event.actorUnitId);
        return;
      default:
        return;
    }
  }

  public pause(): void {
    if (this.destroyed) return;
    this.active = false;
    this.layer.visible = false;
    this.clearTransientEffects();
    this.clearIntentMarkers();
    for (const node of this.actorNodes.values()) {
      node.sprite.stop();
      node.sprite.onComplete = undefined;
    }
    for (const button of this.primaryButtons.values()) button.setDisabled(true);
    for (const button of this.secondaryButtons.values()) button.setDisabled(true);
    this.drawerBackButton?.setDisabled(true);
  }

  public resume(frame: BattleSceneFrame): void {
    if (this.destroyed) return;
    this.active = true;
    this.layer.visible = true;
    this.renderFrame(frame);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    this.clearTransientEffects();
    this.clearIntentMarkers();
    this.clearActors();
    for (const button of this.primaryButtons.values()) button.destroy();
    for (const button of this.secondaryButtons.values()) button.destroy();
    this.primaryButtons.clear();
    this.secondaryButtons.clear();
    if (this.drawerBackButton !== null) {
      this.drawerBackButton.destroy();
      this.drawerBackButton = null;
    }
    this.root.mapBack.removeChild(this.background);
    this.background.destroy();
    if (this.backgroundSprite !== null) {
      this.backgroundSprite.removeFromParent();
      this.backgroundSprite.destroy();
      this.backgroundSprite = null;
    }
    this.root.hud.removeChild(this.layer);
    this.layer.destroy({ children: true });
    this.timelineTexts.length = 0;
    for (const texture of this.derivedTextures) texture.destroy(false);
    this.derivedTextures.length = 0;
    this.actorFrameTextures.clear();
    this.artResources = null;
    this.defeatedVisualUnits.clear();
    this.revivedVisualUnits.clear();
    this.comboDisplayKeys.clear();
    this.lastFeedbackBattleId = null;
    this.frame = null;
  }

  private renderFrame(frame: BattleSceneFrame): void {
    this.frame = frame;
    this.clearTransientEffects();
    // 每次重建都从快照重新投影意图标记；旧 marker 不跨 render 偷留在场景树中。
    this.clearIntentMarkers();
    this.clearActors();
    if (this.lastFeedbackBattleId !== null && this.lastFeedbackBattleId !== frame.model.battleId) {
      this.comboDisplayKeys.clear();
    }
    this.lastFeedbackBattleId = frame.model.battleId;
    this.partyNodes.push(...frame.model.party.map((unit) => this.createUnitNode(unit)));
    this.enemyNodes.push(...frame.model.enemies.map((unit) => this.createUnitNode(unit)));
    this.renderPendingIntent(frame.model.boss?.intent ?? null);
    this.renderHeader(frame.model.round);
    this.renderTimeline(frame.model.timeline);
    this.renderButtons(frame.hud);
    this.layer.visible = this.active;
  }

  private clearActors(): void {
    for (const group of this.actorGroups) {
      group.removeFromParent();
      group.destroy({ children: true });
    }
    this.actorGroups.clear();
    this.actorNodes.clear();
    this.defeatedVisualUnits.clear();
    this.revivedVisualUnits.clear();
    this.partyNodes.length = 0;
    this.enemyNodes.length = 0;
  }

  private createUnitNode(unit: BattleUnitViewModel): BattleUnitNode {
    const group = new Container({ label: `battle-unit-${unit.unitId}` });
    const position = this.layoutPosition(unit);
    group.x = Math.round(position.x);
    group.y = Math.round(position.y);
    group.eventMode = "none";
    const assetId = this.battleSpriteId(unit);
    if (assetId.trim().length === 0) throw new Error(`PIXEL_BATTLE_ACTOR_ID_INVALID:${unit.unitId}`);
    const entry = this.assets.requireEntry(assetId);
    if (entry.kind !== "battleActorSheet") throw new Error(`PIXEL_BATTLE_ACTOR_ENTRY_KIND_INVALID:${assetId}`);
    const actorSprite = this.createActorSprite(entry, assetId, unit.alive);
    const hasSingleArt = this.artResources?.actors.has(assetId) === true;
    // 新美术以 384×512 单姿势 cell 提供；统一缩放到约 70×94 逻辑像素，
    // 旧正式横向图集仍沿用 manifest 的 48/64 cell 比例。
    const singleTexture = this.artResources?.actors.get(assetId);
    const actorScale = singleTexture
      ? Math.min(
        (entry.frameWidth === 64 ? 110 : 80) / Math.max(1, singleTexture.width),
        (entry.frameHeight === 64 ? 110 : 92) / Math.max(1, singleTexture.height),
      )
      : entry.frameWidth === 64 ? 1.25 : 1.5;
    actorSprite.scale.set(actorScale);
    if (hasSingleArt) actorSprite.anchor.set(0.5, 0.9);
    // 信息卡放在脚底正下方，角色脚边与卡片边界相接；这样 1.5 倍角色不会被左右卡片挤住，
    // 上下排仍保留可辨识的空隙，且卡片先绘制、角色后绘制。
    const cardX = -32;
    const cardY = 5;
    const cardWidth = 64;
    const cardHeight = 37;
    const shadow = new Graphics({ label: "battle-unit-shadow" });
    shadow.ellipse(0, 5, entry.frameWidth === 64 ? 29 : 24, 5).fill({ color: 0x050914, alpha: 0.72 });
    if (unit.isCurrentActor) {
      shadow.ellipse(0, 5, entry.frameWidth === 64 ? 34 : 28, 7).stroke({ color: 0xffd36b, width: 2, alpha: 0.9, pixelLine: true });
      shadow.rect(-8, 3, 16, 2).fill({ color: 0xffe4a1, alpha: 0.8 });
    }
    const card = new Graphics();
    card.rect(cardX, cardY, cardWidth, cardHeight).fill({ color: 0x111b31, alpha: 0.97 });
    card.rect(cardX, cardY, cardWidth, cardHeight).stroke({ color: unit.isCurrentActor ? 0xffd36b : 0x53627e, width: unit.isCurrentActor ? 3 : 2, pixelLine: true });
    card.rect(cardX + 4, cardY + 4, cardWidth - 8, 1).fill({ color: unit.isCurrentActor ? 0xffd36b : 0x355274, alpha: 0.9 });
    const name = new Text({ text: this.unitName(unit).slice(0, 7), style: textStyle(unit.alive ? PARCHMENT : 0x999aa5, 8), roundPixels: true });
    const hp = new Text({ text: `HP ${Math.max(0, unit.unit.currentHp)}/${unit.unit.stats.maxHp}`, style: textStyle(MUTED, 8), roundPixels: true });
    const energy = new Text({ text: `EN ${unit.unit.energy}`, style: textStyle(MUTED, 8), roundPixels: true });
    setTextPosition(name, cardX + 6, cardY + 1);
    setTextPosition(hp, cardX + 6, cardY + 10);
    setTextPosition(energy, cardX + 6, cardY + 23);
    const hpRatio = unit.unit.stats.maxHp > 0 ? Math.max(0, Math.min(1, unit.unit.currentHp / unit.unit.stats.maxHp)) : 0;
    const energyRatio = Math.max(0, Math.min(1, unit.unit.energy / 100));
    card.rect(cardX + 6, cardY + 18, cardWidth - 12, 3).fill({ color: 0x26334a });
    card.rect(cardX + 6, cardY + 18, (cardWidth - 12) * hpRatio, 3).fill(unit.alive ? 0xd05d63 : 0x626979);
    card.rect(cardX + 6, cardY + 32, cardWidth - 12, 2).fill({ color: 0x26334a });
    card.rect(cardX + 6, cardY + 32, (cardWidth - 12) * energyRatio, 2).fill(0x62a5cf);

    if (!unit.alive) {
      group.alpha = 0.48;
      const fallen = new Text({ text: "倒下", style: textStyle(0xb9bbc5, 9), roundPixels: true });
      fallen.anchor.set(0.5, 0);
      fallen.x = 0;
      fallen.y = -3;
      group.addChild(fallen);
    }
    card.eventMode = "none";
    actorSprite.eventMode = "none";
    name.eventMode = "none";
    hp.eventMode = "none";
    energy.eventMode = "none";
    // 卡片先绘制，角色后绘制；卡片作为脚下/背后的信息底板，不能盖住像素角色。
    group.addChild(shadow, card, actorSprite, name, hp, energy);
    this.root.actors.addChild(group);
    this.actorGroups.add(group);
    const node = {
      group,
      unitId: unit.unitId,
      assetId,
      sprite: actorSprite,
      alive: unit.alive,
      position,
      cardBounds: Object.freeze({ x: group.x + cardX, y: group.y + cardY, width: cardWidth, height: cardHeight }),
    };
    this.actorNodes.set(node.unitId, node);
    return node;
  }

  private playActorClip(unitId: string, clipName: keyof BattleActorClipsV1): void {
    const node = this.actorNodes.get(unitId);
    if (!node || !this.actorGroups.has(node.group)) return;
    const entry = this.assets.requireEntry(node.assetId);
    if (entry.kind !== "battleActorSheet") throw new Error(`PIXEL_BATTLE_ACTOR_ENTRY_KIND_INVALID:${node.assetId}`);
    const clip = entry.clips[clipName];
    const textures = this.getBattleFrameTextures(entry, node.assetId, clipName);
    node.sprite.textures = textures;
    if (this.artResources?.actors.has(node.assetId) === true) {
      // 单姿势图没有动作帧，但保留提交事件驱动的位移、浮字和生命周期。
      if (clipName === "down") this.defeatedVisualUnits.add(unitId);
      node.sprite.animationSpeed = 0;
      node.sprite.loop = false;
      node.sprite.onComplete = undefined;
      node.sprite.anchor.set(0.5, 0.9);
      node.sprite.gotoAndStop(0);
      return;
    }
    node.sprite.animationSpeed = clip.fps / 60 * this.animationSpeed;
    node.sprite.loop = clip.loop;
    node.sprite.onComplete = clip.loop ? undefined : () => {
      if (clipName === "down") {
        // 倒下事件要完整播放 down 过程，结束后才停在最终帧；静态已死亡单位仍由 createActorSprite 直接停最终帧。
        if (this.actorGroups.has(node.group) && !this.destroyed) node.sprite.gotoAndStop(textures.length - 1);
        return;
      }
      this.restoreActorClip(unitId);
    };
    node.sprite.anchor.set(entry.frameWidth === 64 ? 32 / 64 : 24 / 48, entry.frameHeight === 64 ? 58 / 64 : 42 / 48);
    if (clipName === "down") {
      this.defeatedVisualUnits.add(unitId);
      node.sprite.gotoAndPlay(0);
    } else {
      node.sprite.gotoAndPlay(0);
    }
  }

  private restoreActorClip(unitId: string): void {
    const node = this.actorNodes.get(unitId);
    if (!node || !this.actorGroups.has(node.group)) return;
    if (this.defeatedVisualUnits.has(unitId) || (!node.alive && !this.revivedVisualUnits.has(unitId))) {
      const entry = this.assets.requireEntry(node.assetId);
      if (entry.kind !== "battleActorSheet") throw new Error(`PIXEL_BATTLE_ACTOR_ENTRY_KIND_INVALID:${node.assetId}`);
      const textures = this.getBattleFrameTextures(entry, node.assetId, "down");
      node.sprite.textures = textures;
      node.sprite.loop = false;
      node.sprite.onComplete = undefined;
      node.sprite.gotoAndStop(textures.length - 1);
      return;
    }
    this.playActorClip(unitId, "idle");
  }

  private layoutPosition(unit: BattleUnitViewModel): Readonly<{ x: number; y: number; anchorX: number; anchorY: number }> {
    // 只按显式 faction/slot 排前后排，不读取 y 反推槽位；这样内容换一套槽位坐标时不会误排。
    // 下排卡片底部必须留在操作栏上方，避免能量行被底栏遮挡。
    const y = unit.slot % 2 === 0 ? 150 : 240;
    return Object.freeze({ ...unit.position, y });
  }

  private dashActor(actorUnitId: string, targetUnitId: string | null): void {
    const actor = this.actorNodes.get(actorUnitId);
    const target = targetUnitId === null ? null : this.actorNodes.get(targetUnitId);
    if (!actor || !target || !this.actorGroups.has(actor.group) || !this.actorGroups.has(target.group)) return;
    const direction = Math.sign(target.group.x - actor.group.x) || 1;
    this.moveTransient(actorUnitId, direction * 8);
  }

  private knockBack(targetUnitId: string, sourceUnitId: string): void {
    const target = this.actorNodes.get(targetUnitId);
    const source = this.actorNodes.get(sourceUnitId);
    if (!target || !this.actorGroups.has(target.group)) return;
    const direction = source && this.actorGroups.has(source.group)
      ? Math.sign(target.group.x - source.group.x) || 1
      : target.group.x >= 320 ? 1 : -1;
    this.moveTransient(targetUnitId, direction * 6);
  }

  private moveTransient(unitId: string, deltaX: number): void {
    const node = this.actorNodes.get(unitId);
    if (!node || !this.actorGroups.has(node.group)) return;
    const original = this.transientPositions.get(unitId) ?? Object.freeze({ x: node.group.x, y: node.group.y });
    const previousTimer = this.transientMoveTimers.get(unitId);
    if (previousTimer !== undefined) {
      clearTimeout(previousTimer);
      this.transientTimers.delete(previousTimer);
      this.transientMoveTimers.delete(unitId);
    }
    this.clearTransientMove(unitId, false);
    this.transientPositions.set(unitId, original);
    node.group.x = original.x + deltaX;
    const timer = setTimeout(() => {
      this.transientTimers.delete(timer);
      this.transientMoveTimers.delete(unitId);
      this.clearTransientMove(unitId, true);
    }, this.reducedFlashes ? 90 : 140);
    this.transientTimers.add(timer);
    this.transientMoveTimers.set(unitId, timer);
  }

  private tintHit(unitId: string): void {
    if (this.reducedFlashes) return;
    const node = this.actorNodes.get(unitId);
    if (!node || !this.actorGroups.has(node.group)) return;
    node.sprite.tint = 0xff9b9b;
    const timer = setTimeout(() => {
      this.transientTimers.delete(timer);
      if (!this.destroyed && this.actorGroups.has(node.group)) node.sprite.tint = 0xffffff;
    }, 110);
    this.transientTimers.add(timer);
  }

  private showDamageText(unitId: string, amount: number, critical: boolean, element: Element): void {
    this.showValueText(
      unitId,
      amount,
      critical ? 0xffd36b : 0xff8b8b,
      true,
      critical ? "暴击 " : "",
      critical ? 18 : 14,
    );
    this.showElementBurst(unitId, element);
  }

  private showValueText(
    unitId: string,
    amount: number,
    color: number,
    negative = false,
    prefix = "",
    fontSize = 14,
  ): void {
    const node = this.actorNodes.get(unitId);
    if (!node || !this.actorGroups.has(node.group)) return;
    const text = new Text({
      text: `${prefix}${negative ? "-" : "+"}${Math.max(0, Math.round(amount))}`,
      style: textStyle(color, fontSize),
      roundPixels: true,
    });
    text.anchor.set(0.5, 0.5);
    text.x = node.group.x;
    text.y = node.group.y - 66;
    text.eventMode = "none";
    this.root.worldFx.addChild(text);
    this.transientTexts.add(text);
    const timer = setTimeout(() => {
      this.transientTimers.delete(timer);
      this.transientTexts.delete(text);
      if (!this.destroyed && text.parent) text.removeFromParent();
      if (!this.destroyed) text.destroy();
    }, this.reducedFlashes ? 260 : 420);
    this.transientTimers.add(timer);
  }

  /** 元素爆点只使用领域事件里的 element 做固定颜色映射，不读取内容猜效果。 */
  private showElementBurst(unitId: string, element: Element): void {
    this.showSkillEffect(unitId, "melee", element);
  }

  /** Timer-driven atlas playback shares the renderer's pause/destroy lifecycle and speed setting. */
  private showSkillEffect(unitId: string, preset: AnimationPresetId, element: Element, sourceId?: string): void {
    const node = this.actorNodes.get(unitId);
    if (!node || !this.actorGroups.has(node.group)) return;
    const frames = battleEffectFrames(preset, element, this.artResources?.effects !== undefined);
    if (frames.length === 0) return;
    // Bound effects during multi-hit / status-heavy chains, without dropping domain events.
    if (this.transientContainers.size >= 32) return;
    const textures = frames.map((frame) => this.artResources?.effects?.get(frame) ?? this.assets.requireAtlasFrame("atlas_battle_fx", frame));
    const burst = new Container({ label: `skill-fx-${preset}-${unitId}` });
    const sprite = new Sprite(textures[this.reducedFlashes ? Math.min(2, textures.length - 1) : 0]);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = preset === "area" || preset === "summon" ? 112 : 76;
    if (element === "poison") sprite.tint = 0x9ee672;
    burst.alpha = this.reducedFlashes ? 0.45 : 0.9;
    burst.addChild(sprite);
    burst.x = node.group.x;
    burst.y = node.group.y - 36;
    burst.eventMode = "none";
    this.root.worldFx.addChild(burst);
    this.transientContainers.add(burst);
    const source = sourceId ? this.actorNodes.get(sourceId) : undefined;
    const destination = { x: burst.x, y: burst.y };
    const duration = (this.reducedFlashes ? 180 : preset === "area" || preset === "summon" ? 600 : 420) / this.animationSpeed;
    if (!this.reducedFlashes) {
      for (let index = 0; index < textures.length; index++) {
        const timer = setTimeout(() => {
          this.transientTimers.delete(timer);
          if (this.destroyed || !this.transientContainers.has(burst)) return;
          sprite.texture = textures[index]!;
          if (preset === "projectile" && source) {
            const progress = Math.min(1, index / Math.max(1, textures.length - 4));
            burst.x = source.group.x + (destination.x - source.group.x) * progress;
            burst.y = source.group.y - 36 + (destination.y - source.group.y + 36) * progress;
          }
        }, index * duration / textures.length);
        this.transientTimers.add(timer);
      }
    }
    const timer = setTimeout(() => {
      this.transientTimers.delete(timer);
      this.transientContainers.delete(burst);
      if (burst.parent) burst.removeFromParent();
      burst.destroy({ children: true });
    }, duration);
    this.transientTimers.add(timer);
  }

  private bannerDuration(normalMs: number, reducedMs: number): number {
    return this.reducedFlashes ? reducedMs : normalMs;
  }

  private showBanner(label: string, durationMs: number): void {
    const safe = this.viewportValue.safeRect;
    const banner = new Container({ label: "battle-feedback-banner" });
    const text = new Text({ text: label, style: textStyle(PARCHMENT, 14), roundPixels: true });
    // Node/focused 测试没有 DOM Canvas，宽度按固定像素字体估算；生产像素字体同样保持硬边布局。
    const estimatedWidth = label.length * 8 + 24;
    const rightFeedbackWidth = Math.max(132, safe.right - 8 - (safe.x + 320));
    const width = Math.min(Math.max(132, estimatedWidth), rightFeedbackWidth);
    const background = new Graphics();
    background.rect(0, 0, width, 26).fill({ color: 0x131b30, alpha: 0.98 });
    background.rect(0, 0, width, 26).stroke({ color: 0xffd36b, width: 2, pixelLine: true });
    text.anchor.set(0.5, 0.5);
    text.x = width / 2;
    text.y = 13;
    text.eventMode = "none";
    banner.addChild(background, text);
    // 顶部右侧反馈区避开行动顺序、敌我信息卡和底部操作按钮。
    banner.x = Math.round(safe.right - width - 8);
    banner.y = Math.round(safe.y + 8);
    banner.eventMode = "none";
    this.feedbackLayer.addChild(banner);
    this.transientContainers.add(banner);
    const timer = setTimeout(() => {
      this.transientTimers.delete(timer);
      this.transientContainers.delete(banner);
      if (banner.parent) banner.removeFromParent();
      banner.destroy({ children: true });
    }, durationMs);
    this.transientTimers.add(timer);
  }

  private showComboBanner(event: Extract<BattleDomainEventV1, { type: "COMBO_TRIGGERED" }>): void {
    const rootActionId = event.rootActionId ?? event.eventId;
    const key = [event.battleId, rootActionId, event.ownerKey, event.comboId].join("\u0000");
    if (this.comboDisplayKeys.has(key)) return;
    this.comboDisplayKeys.add(key);
    this.showBanner(`COMBO · ${this.comboLabel(event.comboId)}`, this.bannerDuration(700, 400));
  }

  private renderPendingIntent(intent: NonNullable<BattleSceneFrame["model"]["boss"]>["intent"]): void {
    if (!intent) return;
    this.showIntentMarker(intent.intentId, intent.sourceUnitId, intent.skillId);
  }

  private showIntentMarker(intentId: string, sourceUnitId: string, skillId: string): void {
    const node = this.actorNodes.get(sourceUnitId);
    if (!node || !this.enemyNodes.some((enemy) => enemy.unitId === sourceUnitId)) return;
    this.removeIntentMarker(intentId);
    const marker = new Container({ label: `battle-intent-${intentId}` });
    const text = new Text({ text: `蓄力 · ${this.skillLabel(skillId)}`, style: textStyle(0xffd36b, 11), roundPixels: true });
    const width = Math.max(70, text.text.length * 8 + 12);
    const background = new Graphics();
    background.rect(0, 0, width, 18).fill({ color: 0x332531, alpha: 0.96 });
    background.rect(0, 0, width, 18).stroke({ color: 0xff8e57, width: 1, pixelLine: true });
    text.x = 6;
    text.y = 3;
    text.eventMode = "none";
    marker.addChild(background, text);
    marker.x = Math.round(node.group.x - width / 2);
    marker.y = Math.round(node.group.y - 70);
    marker.eventMode = "none";
    this.feedbackLayer.addChild(marker);
    this.intentMarkers.set(intentId, marker);
  }

  private removeIntentMarker(intentId: string): void {
    const marker = this.intentMarkers.get(intentId);
    if (!marker) return;
    this.intentMarkers.delete(intentId);
    if (marker.parent) marker.removeFromParent();
    marker.destroy({ children: true });
  }

  private clearIntentMarkers(): void {
    for (const intentId of [...this.intentMarkers.keys()]) this.removeIntentMarker(intentId);
  }

  private clearTransientMove(unitId: string, restore: boolean): void {
    const original = this.transientPositions.get(unitId);
    const node = this.actorNodes.get(unitId);
    if (restore && original && node && this.actorGroups.has(node.group)) {
      node.group.x = original.x;
      node.group.y = original.y;
    }
    if (restore || !node || !this.actorGroups.has(node.group)) this.transientPositions.delete(unitId);
  }

  private clearTransientEffects(): void {
    for (const timer of this.transientTimers) clearTimeout(timer);
    this.transientTimers.clear();
    this.transientMoveTimers.clear();
    for (const [unitId, original] of this.transientPositions) {
      const node = this.actorNodes.get(unitId);
      if (node && this.actorGroups.has(node.group)) {
        node.group.x = original.x;
        node.group.y = original.y;
      }
    }
    for (const node of this.actorNodes.values()) {
      if (this.actorGroups.has(node.group)) node.sprite.tint = 0xffffff;
    }
    this.transientPositions.clear();
    for (const text of this.transientTexts) {
      if (text.parent) text.removeFromParent();
      text.destroy();
    }
    this.transientTexts.clear();
    for (const container of this.transientContainers) {
      if (container.parent) container.removeFromParent();
      container.destroy({ children: true });
    }
    this.transientContainers.clear();
  }

  private createActorSprite(
    entry: Extract<AssetEntryV1, { kind: "battleActorSheet" }>,
    assetId: string,
    alive: boolean,
  ): AnimatedSprite {
    const clipName: keyof BattleActorClipsV1 = alive ? "idle" : "down";
    const clip = entry.clips[clipName];
    const textures = this.getBattleFrameTextures(entry, assetId, clipName);
    const sprite = new AnimatedSprite(textures);
    if (this.artResources?.actors.has(assetId) === true) {
      sprite.animationSpeed = 0;
      sprite.loop = false;
      sprite.anchor.set(0.5, 0.9);
      sprite.roundPixels = true;
      sprite.gotoAndStop(0);
      return sprite;
    }
    sprite.animationSpeed = clip.fps / 60 * this.animationSpeed;
    sprite.loop = clip.loop;
    sprite.anchor.set(entry.frameWidth === 64 ? 32 / 64 : 24 / 48, entry.frameHeight === 64 ? 58 / 64 : 42 / 48);
    sprite.roundPixels = true;
    if (alive) sprite.play();
    else sprite.gotoAndStop(textures.length - 1);
    return sprite;
  }

  private getBattleFrameTextures(
    entry: Extract<AssetEntryV1, { kind: "battleActorSheet" }>,
    assetId: string,
    clipName: keyof BattleActorClipsV1,
  ): Texture[] {
    const singleTexture = this.artResources?.actors.get(assetId);
    if (singleTexture) return [singleTexture];
    const clip = entry.clips[clipName];
    const sourceTexture = this.assets.requireTexture(assetId);
    sourceTexture.source.style.scaleMode = "nearest";
    const frames: Texture[] = [];
    for (let index = 0; index < clip.frameCount; index += 1) {
      const column = clip.startFrame + index;
      if (column < 0 || column >= entry.columns) throw new Error(`PIXEL_BATTLE_ACTOR_CLIP_OUT_OF_RANGE:${assetId}/${clipName}`);
      const key = `${assetId}:${clipName}:${index}`;
      const cached = this.actorFrameTextures.get(key);
      if (cached) {
        frames.push(cached);
        continue;
      }
      const texture = new Texture({
        source: sourceTexture.source,
        frame: new Rectangle(column * entry.frameWidth, 0, entry.frameWidth, entry.frameHeight),
        label: `battle:${key}`,
      });
      texture.source.style.scaleMode = "nearest";
      this.actorFrameTextures.set(key, texture);
      this.derivedTextures.push(texture);
      frames.push(texture);
    }
    return frames;
  }

  private renderHeader(round: number): void {
    const safe = this.viewportValue.safeRect;
    this.headerText.text = `第 ${round} 回合  ·  回合制战斗`;
    setTextPosition(this.headerText, safe.x + 10, safe.y + 12);
    // 当前行动者已经从 remaining initiativeQueue 移出，必须从双方单位投影读取。
    const model = this.frame?.model;
    const current = [...(model?.party ?? []), ...(model?.enemies ?? [])].find((unit) => unit.isCurrentActor) ?? null;
    this.currentActorText.text = current ? `当前行动：${this.unitName(current)}  ·  速度 ${current.unit.stats.speed}` : "等待行动顺序推进";
    setTextPosition(this.currentActorText, safe.right - 10, safe.y + 14);
  }

  private renderTimeline(units: readonly BattleUnitViewModel[]): void {
    this.timelineLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.timelineTexts.length = 0;
    const title = new Text({ text: "行动顺序", style: textStyle(MUTED, 10), roundPixels: true });
    const safe = this.viewportValue.safeRect;
    const titleX = safe.x + 8;
    // 立绘脚底基准在 150/240，单帧角色最高约 94px；行动条固定在顶部面板内，
    // 不能落到 y57 以后，否则会压住前排角色的头部。
    const timelineY = safe.y + 31;
    const timelineBar = new Graphics({ label: "battle-timeline-bar" });
    timelineBar.rect(safe.x + 6, timelineY - 3, Math.max(0, safe.width - 12), 25)
      .fill({ color: 0x0b1428, alpha: 0.84 })
      .stroke({ color: 0x344766, width: 1, pixelLine: true });
    this.timelineLayer.addChild(timelineBar);
    setTextPosition(title, titleX, timelineY + 5);
    this.timelineLayer.addChild(title);
    const chipStart = titleX + 68;
    const chipGap = 3;
    const available = Math.max(0, safe.right - 8 - chipStart);
    const chipWidth = units.length === 0
      ? 44
      : Math.max(8, Math.min(44, Math.floor((available - chipGap * Math.max(0, units.length - 1)) / units.length)));
    if (units.length === 0) {
      const empty = new Text({ text: "本轮最后行动", style: textStyle(MUTED, 8), roundPixels: true });
      setTextPosition(empty, chipStart, timelineY + 6);
      this.timelineLayer.addChild(empty);
      this.timelineTexts.push(empty);
    }
    units.forEach((unit, index) => {
      const x = chipStart + index * (chipWidth + chipGap);
      const chip = new Graphics();
      chip.rect(x, timelineY, chipWidth, 22).fill({ color: unit.unit.faction === "party" ? PARTY_DARK : ENEMY_DARK, alpha: 0.9 });
      chip.rect(x, timelineY, chipWidth, 22).stroke({ color: unit.isCurrentActor ? 0xffd36b : 0x4c5973, width: unit.isCurrentActor ? 2 : 1, pixelLine: true });
      const nameLength = Math.max(2, Math.floor((chipWidth - 6) / 8));
      const name = new Text({ text: this.unitName(unit).slice(0, nameLength), style: textStyle(unit.alive ? PARCHMENT : 0x858795, 8), roundPixels: true });
      const speed = new Text({ text: `${unit.unit.stats.speed}`, style: textStyle(MUTED, 8), roundPixels: true });
      setTextPosition(name, x + 3, timelineY + 2);
      setTextPosition(speed, x + Math.max(3, chipWidth - 12), timelineY + 12);
      this.timelineLayer.addChild(chip, name, speed);
      this.timelineTexts.push(name, speed);
    });
  }

  private renderButtons(layout: BattleHudLayout): void {
    this.renderBottomBar(layout);
    const drawerOpen = layout.secondary.length > 0;
    // 抽屉使用底部同一行，避免第二行按钮压住下排角色卡；主按钮仍保留在 HUD 状态里，
    // 关闭抽屉后会原位重建，旧动作 ID 和回调完全不变。
    this.reconcileButtons(this.primaryButtons, drawerOpen ? [] : layout.primary);
    const drawerActions = drawerOpen ? layout.secondary.map((action, index) => Object.freeze({
      ...action,
      x: layout.secondary[0]!.x + (index + 1) * (layout.secondary[0]!.width + this.hudGap(layout)),
      y: layout.safeRect.bottom - action.height - this.hudGap(layout),
    })) : [];
    this.reconcileButtons(this.secondaryButtons, drawerActions);
    this.reconcileDrawerBackButton(layout, drawerOpen);
  }

  private renderBottomBar(layout: BattleHudLayout): void {
    const safe = layout.safeRect;
    const size = layout.primary[0]?.height ?? layout.secondary[0]?.height ?? 48;
    const gap = this.hudGap(layout);
    const barY = safe.bottom - size - gap - 8;
    this.bottomBar.clear();
    this.bottomBar
      .rect(safe.x, barY, safe.width, Math.max(0, safe.bottom - barY))
      .fill({ color: 0x091326, alpha: 0.96 })
      .stroke({ color: 0x526783, width: 2, pixelLine: true });
    this.bottomBar.rect(safe.x + 8, barY + 3, Math.max(0, safe.width - 16), 2).fill({ color: 0xc18c4c, alpha: 0.82 });
    const model = this.frame?.model;
    const current = [...(model?.party ?? []), ...(model?.enemies ?? [])].find((unit) => unit.isCurrentActor) ?? null;
    this.bottomHintText.text = current ? `行动者 · ${this.unitName(current)}   速度 ${current.unit.stats.speed}` : "等待指令";
    this.bottomHintText.anchor.set(1, 0.5);
    setTextPosition(this.bottomHintText, safe.right - 12, barY + size / 2 + 4);
  }

  private reconcileButtons(
    collection: Map<BattleHudActionId, BattleCommandButton>,
    actions: readonly BattleHudLayoutAction[],
  ): void {
    const wanted = new Set(actions.map((action) => action.id));
    for (const [id, button] of collection) {
      if (wanted.has(id)) continue;
      button.removeFromParent();
      button.destroy();
      collection.delete(id);
    }
    for (const action of actions) {
      let button = collection.get(action.id);
      const hitArea = button?.hitArea;
      if (button && (!(hitArea instanceof Rectangle) || hitArea.width !== action.width || hitArea.height !== action.height)) {
        // viewport scale 改变时 48 CSS px 会对应不同逻辑尺寸；旧按钮必须整体重建。
        button.removeFromParent();
        button.destroy();
        collection.delete(action.id);
        button = undefined;
      }
      if (!button) {
        button = new BattleCommandButton({
          label: ACTION_LABELS[action.id],
          icon: ACTION_ICONS[action.id],
          width: action.width,
          height: action.height,
          onPress: () => {
            try {
              void Promise.resolve(this.onAction(action.id)).catch(() => undefined);
            } catch {
              // UI 回调异常由应用层状态投影处理，不能形成未处理 Promise。
            }
          },
        });
        collection.set(action.id, button);
        this.buttonLayer.addChild(button);
      }
      button.setLabel(this.actionLabel?.(action.id) ?? ACTION_LABELS[action.id]);
      button.x = Math.round(action.x);
      button.y = Math.round(action.y);
      button.setDisabled(!this.active || !action.enabled);
      button.alpha = action.enabled ? 1 : 0.58;
    }
  }

  private reconcileDrawerBackButton(layout: BattleHudLayout, drawerOpen: boolean): void {
    if (!drawerOpen) {
      if (this.drawerBackButton !== null) {
        this.drawerBackButton.removeFromParent();
        this.drawerBackButton.destroy();
        this.drawerBackButton = null;
      }
      return;
    }
    const action = layout.secondary[0];
    if (!action) return;
    const width = action.width;
    const height = action.height;
    const existingArea = this.drawerBackButton?.hitArea;
    if (this.drawerBackButton !== null
      && (!(existingArea instanceof Rectangle) || existingArea.width !== width || existingArea.height !== height)) {
      this.drawerBackButton.removeFromParent();
      this.drawerBackButton.destroy();
      this.drawerBackButton = null;
    }
    if (this.drawerBackButton === null) {
      this.drawerBackButton = new BattleCommandButton({
        label: "返回",
        icon: "back",
        width,
        height,
        onPress: () => {
          const actionId: BattleHudActionId = this.hud.secondaryMode === "more" ? "more" : "skill";
          try {
            void Promise.resolve(this.onAction(actionId)).catch(() => undefined);
          } catch {
            // 表现层不吞掉领域状态，应用层负责展示错误；这里仅避免触控回调产生未处理异常。
          }
        },
      });
      this.buttonLayer.addChild(this.drawerBackButton);
    }
    this.drawerBackButton.x = Math.round(action.x);
    this.drawerBackButton.y = Math.round(layout.safeRect.bottom - height - this.hudGap(layout));
    this.drawerBackButton.setDisabled(!this.active || this.hud.isInputFrozen);
  }

  private hudGap(layout: BattleHudLayout): number {
    const first = layout.primary[0] ?? layout.secondary[0];
    if (!first) return 8;
    const next = layout.primary[1] ?? layout.secondary[1];
    return next ? Math.max(8, next.x - first.x - first.width) : 8;
  }

  private drawBackground(): void {
    this.background.rect(0, 0, 640, 360).fill(0x0e1424);
    this.background.rect(0, 96, 640, 196).fill(0x17233a);
    this.background.rect(0, 96, 640, 3).fill(0x475575);
    this.background.rect(0, 288, 640, 72).fill(0x111827);
    for (let x = 0; x < 640; x += 32) {
      this.background.rect(x, 112, 1, 160).fill({ color: 0x243351, alpha: 0.72 });
    }
    for (let y = 112; y < 272; y += 32) {
      this.background.rect(0, y, 640, 1).fill({ color: 0x243351, alpha: 0.72 });
    }
    for (const [x, y, width, height, color] of [
      [32, 126, 86, 8, 0x304363], [520, 130, 76, 8, 0x3b324b],
      [286, 112, 68, 6, 0x765347], [302, 266, 38, 7, 0x8c583f],
      [60, 256, 45, 9, 0x243c55], [535, 248, 42, 10, 0x4d3046],
    ] as const) this.background.rect(x, y, width, height).fill(color);
    // 顶部和底部面板不使用圆角/渐变，保证首版在低分辨率设备上仍保持硬边像素感。
    this.background.rect(16, 8, 608, 48).fill({ color: 0x111827, alpha: 0.94 }).stroke({ color: 0x596581, width: 2, pixelLine: true });
    this.background.rect(16, 58, 608, 36).fill({ color: 0x111827, alpha: 0.9 }).stroke({ color: 0x3f4b69, width: 1, pixelLine: true });
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("BATTLE_RENDERER_DESTROYED");
  }
}
