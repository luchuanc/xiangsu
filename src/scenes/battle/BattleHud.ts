import { getHitAreaThresholds, type SafeRect, type ViewportResult } from "../../app/ViewportService";

export type BattlePrimaryActionId = "basic" | "skill" | "defend" | "item" | "more";
export type BattleSecondaryActionId = "active_1" | "active_2" | "ultimate" | "retreat" | "log";
export type BattleHudActionId = BattlePrimaryActionId | BattleSecondaryActionId;

export interface BattleHudAction {
  readonly id: BattleHudActionId;
  readonly enabled: boolean;
  readonly disabledReasonKey: string | null;
  readonly width: number;
  readonly height: number;
}

export interface BattleHudLayoutAction extends BattleHudAction {
  readonly x: number;
  readonly y: number;
}

export interface BattleHudLayout {
  readonly safeRect: SafeRect;
  readonly primary: readonly BattleHudLayoutAction[];
  readonly secondary: readonly BattleHudLayoutAction[];
}

export interface BattleHudAssistState {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly countdownMs: number;
}

const ACTION_SIZE = 48;
const GAP = 8;
const PRIMARY: readonly BattlePrimaryActionId[] = ["basic", "skill", "defend", "item", "more"];

function makeAction(id: BattleHudActionId, enabled = true, disabledReasonKey: string | null = null): BattleHudAction {
  return Object.freeze({ id, enabled, disabledReasonKey, width: ACTION_SIZE, height: ACTION_SIZE });
}

/** 战斗 HUD 只维护按钮状态与安全区布局，不调用领域服务。 */
export class BattleHud {
  private readonly availability = new Map<BattleHudActionId, { enabled: boolean; reason: string | null }>();
  private secondary: readonly BattleSecondaryActionId[] = [];
  private secondaryModeValue: "skill" | "more" | null = null;
  private frozen = false;
  private safeRect: SafeRect | null = null;
  private actionSize = ACTION_SIZE;
  private gap = GAP;
  private assist: BattleHudAssistState = Object.freeze({ visible: false, enabled: false, countdownMs: 0 });

  public constructor() {
    for (const id of [...PRIMARY, "active_1", "active_2", "ultimate", "retreat", "log"] as BattleHudActionId[]) {
      this.availability.set(id, { enabled: true, reason: null });
    }
  }

  public primaryActions(): readonly BattleHudAction[] {
    return Object.freeze(PRIMARY.map((id) => this.action(id)));
  }

  public secondaryActions(): readonly BattleHudAction[] {
    return Object.freeze(this.secondary.map((id) => this.action(id)));
  }

  public openSecondary(kind: "skill" | "more"): void {
    this.secondaryModeValue = kind;
    this.secondary = kind === "skill"
      ? ["active_1", "active_2", "ultimate"]
      : ["retreat", "log"];
  }

  /** 当前抽屉类型只供表现层决定返回按钮回调，不改变领域动作集合。 */
  public get secondaryMode(): "skill" | "more" | null {
    return this.secondaryModeValue;
  }

  /** 同一个一级入口再次点击会收起抽屉，避免把“战报”伪装成关闭按钮。 */
  public toggleSecondary(kind: "skill" | "more"): void {
    const expected: readonly BattleSecondaryActionId[] = kind === "skill"
      ? ["active_1", "active_2", "ultimate"]
      : ["retreat", "log"];
    const alreadyOpen = this.secondary.length === expected.length
      && this.secondary.every((id, index) => id === expected[index]);
    if (alreadyOpen) this.closeSecondary();
    else this.openSecondary(kind);
  }

  public closeSecondary(): void {
    this.secondary = [];
    this.secondaryModeValue = null;
  }

  public setActionAvailability(id: BattleHudActionId, enabled: boolean, disabledReasonKey: string | null = null): void {
    this.availability.set(id, { enabled, reason: enabled ? null : disabledReasonKey });
  }

  public setInputFrozen(frozen: boolean): void {
    this.frozen = frozen;
  }

  public get isInputFrozen(): boolean {
    return this.frozen;
  }

  /** 辅助开关独立于技能按钮，不改变原有 48×48 主按钮布局。 */
  public setAssistState(state: BattleHudAssistState): void {
    this.assist = Object.freeze({
      visible: state.visible,
      enabled: state.visible && state.enabled,
      countdownMs: Math.max(0, Math.floor(state.countdownMs)),
    });
  }

  public get assistState(): BattleHudAssistState {
    return this.assist;
  }

  public setSafeRect(safeRect: SafeRect): void {
    this.safeRect = Object.freeze({ ...safeRect });
  }

  /** 48/8 是 CSS 像素门槛；缩放画布下必须向上换算为更大的逻辑命中区。 */
  public setViewport(viewport: Pick<ViewportResult, "safeRect" | "scale">): void {
    const thresholds = getHitAreaThresholds(viewport.scale);
    this.safeRect = Object.freeze({ ...viewport.safeRect });
    this.actionSize = Math.max(ACTION_SIZE, thresholds.hitSizeLogical);
    this.gap = Math.max(GAP, thresholds.gapLogical);
  }

  public getLayout(): BattleHudLayout | null {
    if (this.safeRect === null) return null;
    const rect = this.safeRect;
    const actionSize = this.actionSize;
    const gap = this.gap;
    const withSize = (action: BattleHudAction): BattleHudAction => Object.freeze({
      ...action,
      width: actionSize,
      height: actionSize,
    });
    // 保留原有逻辑首点，旧版 H5 点击坐标 (24,328) 仍命中第一颗按钮；安全区本身已由
    // ViewportService 吸收设备 inset，按钮视觉阴影和边框再提供 8px 的内边缘感。
    const rowStart = rect.x;
    const primary = Object.freeze(this.primaryActions().map((source, index): BattleHudLayoutAction => Object.freeze({
      ...withSize(source),
      x: rowStart + index * (actionSize + gap),
      y: rect.bottom - actionSize - gap,
    })));
    const secondary = Object.freeze(this.secondaryActions().map((source, index): BattleHudLayoutAction => Object.freeze({
      ...withSize(source),
      // 抽屉打开时由 renderer 替换主按钮行，始终贴着底部独立显示，
      // 不覆盖角色脚下的信息卡；返回按钮占用 rowStart 的第一个位置。
      x: rowStart + index * (actionSize + gap),
      y: rect.bottom - actionSize - gap,
    })));
    return Object.freeze({
      safeRect: rect,
      primary,
      secondary,
    });
  }

  private action(id: BattleHudActionId): BattleHudAction {
    const value = this.availability.get(id) ?? { enabled: false, reason: "battle.action_unavailable" };
    return makeAction(id, !this.frozen && value.enabled, this.frozen ? "battle.animation_locked" : value.reason);
  }
}

export const BATTLE_BUTTON_SIZE = ACTION_SIZE;
export const BATTLE_BUTTON_GAP = GAP;
