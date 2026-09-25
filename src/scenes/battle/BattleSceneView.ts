import type { PixiSceneRoot } from "../../app/PixiSceneRoot";
import type { ViewportResult } from "../../app/ViewportService";
import type { BattleDomainEventV1 } from "../../content/contracts";
import { BattleHud, type BattleHudLayout, type BattleHudActionId } from "./BattleHud";
import type { BattleUnitViewModel, BattleViewModel } from "./BattleView";
import { BattleSceneRenderer } from "../../ui/rendering/BattleSceneRenderer";
import type { PixiRenderAssetSource } from "../../ui/rendering/PixiAssetResolver";
import type { BattleArtResources } from "../../ui/rendering/BattleArtResources";

/** 战斗表现帧只携带领域投影和 HUD 布局，不允许渲染层直接读取存档。 */
export interface BattleSceneFrame {
  readonly model: BattleViewModel;
  readonly hud: BattleHudLayout;
}

export type BattleUnitNameResolver = (unit: BattleUnitViewModel) => string;

export interface BattleSceneViewOptions {
  readonly loadArtResources?: () => Promise<BattleArtResources>;
  readonly actionLabel?: (action: BattleHudActionId) => string | null;
  readonly root: PixiSceneRoot;
  readonly hud: BattleHud;
  readonly viewport: ViewportResult;
  readonly unitName: BattleUnitNameResolver;
  /** 技能与 Combo 文案由 GameFlow 按当前内容版本解析后注入。 */
  readonly skillLabel: (skillId: string) => string;
  readonly comboLabel: (comboId: string) => string;
  /** 资源 ID 必须由内容定义显式提供，渲染层不根据 definitionId 猜路径。 */
  readonly assets: PixiRenderAssetSource;
  readonly battleSpriteId: (unit: BattleUnitViewModel) => string;
  readonly animationSpeed?: 1 | 2;
  readonly reducedFlashes?: boolean;
  readonly onAction: (action: BattleHudActionId) => void | Promise<void>;
}

export interface BattleSceneViewLike {
  prepare(frame: BattleSceneFrame): void | Promise<void>;
  enter(frame: BattleSceneFrame): void;
  update(frame: BattleSceneFrame): void;
  setViewport(viewport: ViewportResult): void;
  /** 只接收已经由 Gateway/CAS 提交的领域事件。 */
  animateEvent?(event: BattleDomainEventV1): void;
  pause(): void;
  resume(frame: BattleSceneFrame): void;
  destroy(): void;
}

/**
 * 战斗场景的生命周期适配器；它只把 BattleScene 的不可变投影交给 renderer，
 * 指令仍通过 onAction 回到 GameFlowController 的既有 Gateway 链路。
 */
export class BattleSceneView implements BattleSceneViewLike {
  public readonly renderer: BattleSceneRenderer;
  private destroyed = false;

  public constructor(private readonly options: BattleSceneViewOptions) {
    options.hud.setViewport(options.viewport);
    this.renderer = new BattleSceneRenderer(options);
  }

  public async prepare(frame: BattleSceneFrame): Promise<void> {
    if (this.destroyed) throw new Error("BATTLE_SCENE_VIEW_DESTROYED");
    if (this.options.loadArtResources) {
      const art = await this.options.loadArtResources();
      // 异步资源结束时场景可能已退出，禁止向已销毁的根节点安装精灵。
      if (this.destroyed) return;
      this.renderer.setArtResources(art);
    }
    this.renderer.prepare(frame);
  }

  public enter(frame: BattleSceneFrame): void {
    if (this.destroyed) return;
    this.renderer.enter(frame);
  }

  public update(frame: BattleSceneFrame): void {
    if (this.destroyed) return;
    this.renderer.update(frame);
  }

  public setViewport(viewport: ViewportResult): void {
    if (this.destroyed) return;
    this.renderer.setViewport(viewport);
  }

  public animateEvent(event: BattleDomainEventV1): void {
    if (this.destroyed) return;
    this.renderer.animateEvent(event);
  }

  public pause(): void {
    if (this.destroyed) return;
    this.renderer.pause();
  }

  public resume(frame: BattleSceneFrame): void {
    if (this.destroyed) return;
    this.renderer.resume(frame);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.destroy();
  }
}
