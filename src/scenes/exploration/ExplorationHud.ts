import {
  EXPLORATION_JOYSTICK_HIT_SIZE,
  EXPLORATION_JOYSTICK_INSET,
  getHitAreaThresholds,
  type HitAreaThresholds,
  type SafeRect,
  type ViewportResult,
} from "../../app/ViewportService";

export const EXPLORATION_INTERACTION_BUTTON_SIZE = 56;

export type ExplorationHudControlId = "map" | "inventory" | "party" | "settings" | "joystick" | "interaction" | "menu";

export interface ExplorationHudControl {
  readonly id: ExplorationHudControlId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly interactive: boolean;
}

export interface ExplorationHudLayout {
  readonly safeRect: SafeRect;
  readonly controls: readonly ExplorationHudControl[];
}

export type ExplorationHudLayoutOptions = Pick<HitAreaThresholds, "hitSizeLogical" | "gapLogical"> & {
  readonly joystickHitSizeLogical?: number;
};

function control(id: ExplorationHudControlId, x: number, y: number, width: number, height: number, interactive: boolean): ExplorationHudControl {
  return Object.freeze({ id, x: Math.round(x), y: Math.round(y), width, height, interactive });
}

/**
 * 探索 HUD 只输出逻辑布局和可用态，具体 Pixi Text/Sprite 由场景绑定。
 * 所有控件都锚定 safeRect；战斗接触后统一关闭交互而不销毁场景。
 */
export class ExplorationHud {
  private safeRectValue: SafeRect;
  private hitSizeLogical = 48;
  private gapLogical = 8;
  private joystickHitSizeLogical = EXPLORATION_JOYSTICK_HIT_SIZE;
  private enabled = true;
  private interactionEnabled = false;

  public constructor(safeRect: SafeRect, options?: ExplorationHudLayoutOptions) {
    this.safeRectValue = Object.freeze({ ...safeRect });
    if (options) this.setLayoutOptions(options);
  }

  public setSafeRect(safeRect: SafeRect): void {
    this.safeRectValue = Object.freeze({ ...safeRect });
  }

  /** 视口变化时同时更新安全区与命中门槛，避免只移动控件而保留旧尺寸。 */
  public setViewport(viewport: ViewportResult): void {
    this.setSafeRect(viewport.safeRect);
    this.setLayoutOptions(getHitAreaThresholds(viewport.scale));
  }

  public setLayoutOptions(options: ExplorationHudLayoutOptions): void {
    this.hitSizeLogical = Math.max(1, Math.ceil(options.hitSizeLogical));
    this.gapLogical = Math.max(1, Math.ceil(options.gapLogical));
    this.joystickHitSizeLogical = Math.max(
      EXPLORATION_JOYSTICK_HIT_SIZE,
      Math.ceil(options.joystickHitSizeLogical ?? this.hitSizeLogical),
    );
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public setInteractionEnabled(enabled: boolean): void {
    this.interactionEnabled = enabled;
  }

  public getLayout(): ExplorationHudLayout {
    const rect = this.safeRectValue;
    const topY = rect.y + this.gapLogical;
    // Keep room for both the icon and label when a large screen scales up the canvas.
    const iconSize = Math.max(44, this.hitSizeLogical);
    const actionSize = Math.max(EXPLORATION_INTERACTION_BUTTON_SIZE, this.hitSizeLogical);
    const joystickSize = this.joystickHitSizeLogical;
    const joystickInset = Math.max(EXPLORATION_JOYSTICK_INSET, this.gapLogical);
    const minimumWidth = Math.max(
      iconSize * 4 + this.gapLogical * 3,
      joystickInset + joystickSize + actionSize * 2 + this.gapLogical * 3,
    );
    const minimumHeight = iconSize + joystickSize + joystickInset + this.gapLogical * 2;
    if (rect.width < minimumWidth || rect.height < minimumHeight) {
      // ViewportService 会在生产路径提前给出 tooSmall；这里保护独立 HUD 适配器不输出越界控件。
      return Object.freeze({ safeRect: this.safeRectValue, controls: Object.freeze([]) });
    }
    const rightStart = rect.right - iconSize * 4 - this.gapLogical * 3;
    // 为拇指留出左侧和底部余量；右侧动作行保持原来的位置，不随摇杆放大上移。
    const joystickY = rect.bottom - joystickSize - joystickInset;
    const bottomY = rect.bottom - Math.max(104, this.hitSizeLogical) - this.gapLogical;
    const controls: ExplorationHudControl[] = [
      control("map", rightStart, topY, iconSize, iconSize, this.enabled),
      control("inventory", rightStart + (iconSize + this.gapLogical), topY, iconSize, iconSize, this.enabled),
      control("party", rightStart + (iconSize + this.gapLogical) * 2, topY, iconSize, iconSize, this.enabled),
      control("settings", rightStart + (iconSize + this.gapLogical) * 3, topY, iconSize, iconSize, this.enabled),
      control("joystick", rect.x + joystickInset, joystickY, joystickSize, joystickSize, this.enabled),
      control("interaction", rect.right - actionSize - this.gapLogical, bottomY, actionSize, actionSize, this.enabled && this.interactionEnabled),
      control("menu", rect.right - actionSize * 2 - this.gapLogical * 2, bottomY, actionSize, actionSize, this.enabled),
    ];
    return Object.freeze({ safeRect: this.safeRectValue, controls: Object.freeze(controls) });
  }
}
