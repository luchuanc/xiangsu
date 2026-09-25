import type { BattleCommandV1, BattleDomainEventV1, BattleResolutionV1, BattleSnapshotV1, GameSaveV1 } from "../../content/contracts";
import { createDomainError, failure, success, type DomainErrorV1, type DomainResult } from "../../domain/common/DomainResult";
import type { Scene, SceneRootLike } from "../../app/Scene";
import type { ViewportResult } from "../../app/ViewportService";
import { BattleAnimator, type BattleAnimatorOptions } from "./BattleAnimator";
import { BattleHud, type BattleHudActionId } from "./BattleHud";
import type { BattleSceneFrame, BattleSceneViewLike } from "./BattleSceneView";
import { TargetSelector } from "./TargetSelector";
import { BattleView, type BattleBossProjectionOptions, type BattleViewModel } from "./BattleView";

export interface BattleInputLike {
  setEnabled(enabled: boolean): void;
  resetAll?(): void;
}

export interface BattleGatewaySuccess {
  readonly ok: true;
  readonly value: BattleResolutionV1;
  readonly save: GameSaveV1;
  readonly events: BattleResolutionV1["events"];
  readonly candidateId: string;
}

export interface BattleGatewayFailure {
  readonly ok: false;
  readonly error: DomainErrorV1;
  readonly events: readonly [];
  readonly candidateId?: string;
}

export type BattleGatewayResult = BattleGatewaySuccess | BattleGatewayFailure;

export interface BattleGatewayLike {
  execute(command: BattleCommandV1): Promise<BattleGatewaySuccess | BattleGatewayFailure>;
  executeControlSkip?(): Promise<BattleGatewaySuccess | BattleGatewayFailure>;
}

export interface BattleAnimatorLike {
  play(events: readonly import("../../content/contracts").BattleDomainEventV1[], finalSnapshot: Readonly<BattleSnapshotV1>): Promise<unknown>;
  cancel(): void;
  destroy(): void;
}

export interface BattleSceneOptions {
  readonly root?: SceneRootLike;
  readonly getSnapshot: () => Readonly<BattleSnapshotV1>;
  readonly gateway: BattleGatewayLike;
  readonly input?: BattleInputLike;
  readonly animator?: BattleAnimatorLike;
  readonly animatorOptions?: BattleAnimatorOptions;
  readonly boss?: BattleBossProjectionOptions;
  /** 生产 Pixi 战斗画面；Node 适配器可以不注入，领域场景仍可独立测试。 */
  readonly view?: BattleSceneViewLike;
  readonly hud?: BattleHud;
  readonly viewport?: ViewportResult;
  readonly onCommittedSnapshot?: (snapshot: Readonly<BattleSnapshotV1>) => void;
}

/** 战斗场景是应用适配器：保存成功前不把事件交给动画，也不改权威 Store。 */
export class BattleScene implements Scene<void> {
  public readonly root: SceneRootLike;
  public readonly hud: BattleHud;
  public readonly targetSelector: TargetSelector;
  public readonly animator: BattleAnimatorLike;
  private readonly getSnapshot: () => Readonly<BattleSnapshotV1>;
  private readonly gateway: BattleGatewayLike;
  private readonly input: BattleInputLike | undefined;
  private readonly boss: BattleBossProjectionOptions | undefined;
  private readonly presentation: BattleSceneViewLike | undefined;
  private readonly onCommittedSnapshot: ((snapshot: Readonly<BattleSnapshotV1>) => void) | undefined;
  private view: BattleView | null = null;
  private snapshotValue: Readonly<BattleSnapshotV1> | null = null;
  private prepared = false;
  private entered = false;
  private destroyed = false;

  public constructor(options: BattleSceneOptions) {
    this.root = options.root ?? { parent: null };
    this.getSnapshot = options.getSnapshot;
    this.gateway = options.gateway;
    this.input = options.input;
    this.boss = options.boss;
    this.onCommittedSnapshot = options.onCommittedSnapshot;
    this.hud = options.hud ?? new BattleHud();
    this.targetSelector = new TargetSelector();
    this.presentation = options.view;
    const suppliedOnEvent = options.animatorOptions?.onEvent;
    this.animator = options.animator ?? new BattleAnimator({
      ...options.animatorOptions,
      onEvent: (event: BattleDomainEventV1) => {
        suppliedOnEvent?.(event);
        this.presentation?.animateEvent?.(event);
      },
    });
    if (options.viewport) this.hud.setViewport(options.viewport);
  }

  public async prepare(): Promise<void> {
    this.assertAlive();
    const snapshot = this.getSnapshot();
    this.snapshotValue = snapshot;
    this.view = new BattleView({ snapshot, boss: this.boss });
    await this.presentation?.prepare(this.presentationFrame());
    this.prepared = true;
  }

  public async enter(): Promise<void> {
    this.assertAlive();
    if (!this.prepared || this.view === null) throw new Error("BattleScene 必须先 prepare");
    this.entered = true;
    this.setInputEnabled(true);
    this.presentation?.enter(this.presentationFrame());
  }

  public async pause(): Promise<void> {
    if (this.destroyed) return;
    this.entered = false;
    this.setInputEnabled(false);
    this.animator.cancel();
    this.presentation?.pause();
  }

  public async resume(): Promise<void> {
    this.assertAlive();
    if (!this.prepared) await this.prepare();
    this.entered = true;
    this.setInputEnabled(true);
    this.refreshFromStore();
    this.presentation?.resume(this.presentationFrame());
  }

  public async exit(): Promise<void> {
    await this.pause();
  }

  public async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.entered = false;
    this.setInputEnabled(false);
    this.animator.cancel();
    this.animator.destroy();
    this.targetSelector.cancel();
    this.presentation?.destroy();
    this.view = null;
    this.snapshotValue = null;
  }

  public get viewModel(): BattleViewModel | null {
    return this.view?.project() ?? null;
  }

  public get snapshot(): Readonly<BattleSnapshotV1> | null {
    return this.snapshotValue;
  }

  public async submitCommand(command: BattleCommandV1): Promise<DomainResult<BattleSnapshotV1>> {
    const result = await this.submitGatewayCommand(command);
    if (!result.ok) return failure(result.error as import("../../domain/common/DomainResult").DomainErrorV1);
    return success(result.value.snapshot);
  }

  /**
   * GameFlow 的玩家与敌方 AI 共用这一提交入口；只有 Gateway/CAS 成功返回后才启动表现队列，
   * 同时保留完整 save/events 给终局、奖励和回合推进逻辑使用。
   */
  public async submitGatewayCommand(command: BattleCommandV1): Promise<BattleGatewayResult> {
    return this.submitCommittedGateway(() => this.gateway.execute(command));
  }

  /** 控制状态推进也必须使用同一提交后事件入口，不能绕过当前战斗表现层。 */
  public async submitControlSkip(): Promise<BattleGatewayResult> {
    if (!this.gateway.executeControlSkip) {
      return { ok: false, error: createDomainError("SAVE_FAILED", { operation: "save" }), events: [] };
    }
    return this.submitCommittedGateway(() => this.gateway.executeControlSkip!());
  }

  private async submitCommittedGateway(execute: () => Promise<BattleGatewayResult>): Promise<BattleGatewayResult> {
    if (this.destroyed || !this.entered || this.hud.isInputFrozen) {
      return {
        ok: false,
        error: createDomainError("INVALID_BATTLE_PHASE", { expected: ["AWAIT_COMMAND"], actual: this.snapshotValue?.phase ?? "COMPLETE" }),
        events: [],
      };
    }
    this.setCommandInputFrozen(true);
    try {
      const result = await execute();
      if (!result.ok) return result;
      // 权威存档在 Gateway 成功返回后立即生效，但表现快照要等事件队列播放完再替换；
      // 这样受击动画期间仍能看到命中前的 HP，而不是先把血条瞬移到结算值。
      const finalSnapshot = result.value.snapshot;
      this.onCommittedSnapshot?.(finalSnapshot);
      // 页面在提交期间可能被系统隐藏或用户返回；此时提交仍已成功，但表现层只保留最终快照，
      // 不在暂停/销毁后的场景中重新启动动画队列。
      if (this.destroyed || !this.entered) return result;
      await this.animator.play(result.value.events, finalSnapshot);
      if (this.destroyed || !this.entered) return result;
      // 动画结束才替换 View 的投影；pause/destroy 会在上面的分支中跳过，resume 再从权威 Store 恢复。
      this.snapshotValue = finalSnapshot;
      this.view?.setSnapshot(finalSnapshot);
      this.presentation?.update(this.presentationFrame());
      return result;
    } finally {
      this.setCommandInputFrozen(false);
    }
  }

  public refreshFromStore(): void {
    if (this.destroyed) return;
    const snapshot = this.getSnapshot();
    this.snapshotValue = snapshot;
    this.view?.setSnapshot(snapshot);
    if (this.view !== null && this.presentation !== undefined) this.presentation.update(this.presentationFrame());
  }

  public setViewport(viewport: ViewportResult): void {
    if (this.destroyed) return;
    this.hud.setViewport(viewport);
    this.presentation?.setViewport(viewport);
    if (this.view !== null && this.presentation !== undefined && this.prepared) this.presentation.update(this.presentationFrame());
  }

  public openSkillDrawer(): void {
    this.hud.openSecondary("skill");
    if (this.view !== null && this.presentation !== undefined) this.presentation.update(this.presentationFrame());
  }

  public toggleSkillDrawer(): void {
    this.hud.toggleSecondary("skill");
    if (this.view !== null && this.presentation !== undefined) this.presentation.update(this.presentationFrame());
  }

  public openMoreDrawer(): void {
    this.hud.openSecondary("more");
    if (this.view !== null && this.presentation !== undefined) this.presentation.update(this.presentationFrame());
  }

  public toggleMoreDrawer(): void {
    this.hud.toggleSecondary("more");
    if (this.view !== null && this.presentation !== undefined) this.presentation.update(this.presentationFrame());
  }

  public closeDrawer(): void {
    this.hud.closeSecondary();
    if (this.view !== null && this.presentation !== undefined) this.presentation.update(this.presentationFrame());
  }

  public setActionAvailability(id: BattleHudActionId, enabled: boolean, disabledReasonKey: string | null = null): void {
    if (this.destroyed) return;
    this.hud.setActionAvailability(id, enabled, disabledReasonKey);
    if (this.view !== null && this.presentation !== undefined && this.prepared) this.presentation.update(this.presentationFrame());
  }

  public skipAnimation(): void {
    // 动画期间 snapshotValue 仍是旧的表现快照；跳过必须读取已 CAS 提交的权威 Store，
    // 否则 cancel 后会把旧 HP 再次投影回来。
    const snapshot = this.getSnapshot();
    this.animator.cancel();
    this.snapshotValue = snapshot;
    this.view?.setSnapshot(snapshot);
    if (this.view !== null && this.presentation !== undefined && this.prepared && !this.destroyed) {
      this.presentation.update(this.presentationFrame());
    }
    this.onCommittedSnapshot?.(snapshot);
  }

  private refreshInputSnapshot(): void {
    this.input?.resetAll?.();
  }

  private setInputEnabled(enabled: boolean): void {
    this.input?.setEnabled(enabled);
    if (!enabled) this.refreshInputSnapshot();
  }

  private setCommandInputFrozen(frozen: boolean): void {
    this.hud.setInputFrozen(frozen);
    // 动画锁定状态也要立即投影到 Pixi 按钮，避免视觉仍显示可点击而由领域层静默拒绝。
    if (this.prepared && this.view !== null && this.presentation !== undefined && !this.destroyed) {
      this.presentation.update(this.presentationFrame());
    }
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("BattleScene 已销毁");
  }

  private presentationFrame(): BattleSceneFrame {
    const model = this.view?.project();
    const hud = this.hud.getLayout();
    if (model === undefined || model === null || hud === null) throw new Error("BATTLE_SCENE_PRESENTATION_NOT_READY");
    return { model, hud };
  }
}
