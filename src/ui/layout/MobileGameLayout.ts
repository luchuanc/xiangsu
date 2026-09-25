import { getHitAreaThresholds, type ViewportResult } from "../../app/ViewportService";

export interface MobileGameLayout {
  readonly viewport: ViewportResult;
  readonly hitSize: number;
  readonly gap: number;
  readonly fieldHud: {
    readonly top: number;
    readonly left: number;
    readonly right: number;
    readonly bottom: number;
    readonly joystickVisibleSize: 96;
    readonly joystickHitSize: number;
  };
}

/**
 * 移动端 HUD 只从同一份 viewport 计算布局，避免页面 resize 后出现第二套命中门槛。
 * 返回值及嵌套字段均冻结，场景可以安全地把它作为当前帧的只读快照传递。
 */
export function createMobileGameLayout(viewport: ViewportResult): MobileGameLayout {
  const thresholds = getHitAreaThresholds(viewport.scale);
  const safeRect = viewport.safeRect;
  const joystickHitSize = Math.max(104, thresholds.hitSizeLogical);

  return Object.freeze({
    viewport,
    hitSize: thresholds.hitSizeLogical,
    gap: thresholds.gapLogical,
    fieldHud: Object.freeze({
      top: safeRect.y + thresholds.gapLogical,
      left: safeRect.x + thresholds.gapLogical,
      right: safeRect.right - thresholds.gapLogical,
      bottom: safeRect.bottom - joystickHitSize - thresholds.gapLogical,
      joystickVisibleSize: 96 as const,
      joystickHitSize,
    }),
  });
}
