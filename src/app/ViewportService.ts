export const LOGICAL_VIEWPORT_WIDTH = 640;
export const LOGICAL_VIEWPORT_HEIGHT = 360;
export const MIN_VIEWPORT_WIDTH = 568;
export const MIN_VIEWPORT_HEIGHT = 320;
export const EXPLORATION_JOYSTICK_HIT_SIZE = 136;
export const EXPLORATION_JOYSTICK_INSET = 24;

export type BlockedReason =
  | "invalidViewport"
  | "portrait"
  | "tooSmall"
  | null;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SafeRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface ViewportResult {
  scale: number;
  offsetX: number;
  offsetY: number;
  cssWidth: number;
  cssHeight: number;
  safeRect: SafeRect;
  blockedReason: BlockedReason;
}

export interface HitAreaThresholds {
  hitSizeLogical: number;
  gapLogical: number;
  longPressMoveLogical: number;
}

export interface ExplorationHudMinimumSize {
  readonly width: number;
  readonly height: number;
  readonly topRowWidth: number;
  readonly joystickHitSize: number;
  readonly actionSize: number;
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} 必须是有限正数`);
  }
}

function assertSafeInset(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} 必须是有限非负数`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createSafeRect(
  size: ViewportSize,
  insets: SafeAreaInsets,
  scale: number,
  offsetX: number,
  offsetY: number,
): SafeRect {
  const canvasLeft = offsetX;
  const canvasTop = offsetY;
  const canvasRight = offsetX + LOGICAL_VIEWPORT_WIDTH * scale;
  const canvasBottom = offsetY + LOGICAL_VIEWPORT_HEIGHT * scale;

  // 安全区先与 contain 后的 canvas 求交集，只有侵入 canvas 的部分才换算到逻辑坐标。
  const cssLeft = Math.max(canvasLeft, insets.left);
  const cssTop = Math.max(canvasTop, insets.top);
  const cssRight = Math.min(canvasRight, size.width - insets.right);
  const cssBottom = Math.min(canvasBottom, size.height - insets.bottom);

  const left = clamp(Math.ceil((cssLeft - canvasLeft) / scale), 0, LOGICAL_VIEWPORT_WIDTH);
  const top = clamp(Math.ceil((cssTop - canvasTop) / scale), 0, LOGICAL_VIEWPORT_HEIGHT);
  const right = clamp(Math.floor((cssRight - canvasLeft) / scale), 0, LOGICAL_VIEWPORT_WIDTH);
  const bottom = clamp(
    Math.floor((cssBottom - canvasTop) / scale),
    0,
    LOGICAL_VIEWPORT_HEIGHT,
  );

  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    right,
    bottom,
  };
}

/**
 * 由探索 HUD 的真实几何推导安全区下限；不足时必须走 tooSmall 门禁，不能挤压或重叠控件。
 */
export function getExplorationHudMinimumSize(scale: number): ExplorationHudMinimumSize {
  const thresholds = getHitAreaThresholds(scale);
  const joystickHitSize = Math.max(EXPLORATION_JOYSTICK_HIT_SIZE, thresholds.hitSizeLogical);
  const joystickInset = Math.max(EXPLORATION_JOYSTICK_INSET, thresholds.gapLogical);
  const actionSize = Math.max(56, thresholds.hitSizeLogical);
  const iconSize = Math.max(44, thresholds.hitSizeLogical);
  const topRowWidth = iconSize * 4 + thresholds.gapLogical * 3;
  const bottomRowWidth = joystickInset + joystickHitSize + actionSize * 2 + thresholds.gapLogical * 3;
  return {
    width: Math.max(topRowWidth, bottomRowWidth),
    height: iconSize + joystickHitSize + joystickInset + thresholds.gapLogical * 2,
    topRowWidth,
    joystickHitSize,
    actionSize,
  };
}

export function canFitExplorationHud(safeRect: SafeRect, scale: number): boolean {
  const minimum = getExplorationHudMinimumSize(scale);
  return safeRect.width >= minimum.width && safeRect.height >= minimum.height;
}

/**
 * 计算固定 640×360 逻辑画布在 CSS viewport 中的 contain 布局和安全区。
 */
export function calculateViewport(
  size: ViewportSize,
  safeArea: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 },
): ViewportResult {
  assertFinitePositive(size.width, "viewport.width");
  assertFinitePositive(size.height, "viewport.height");
  assertSafeInset(safeArea.top, "safeArea.top");
  assertSafeInset(safeArea.right, "safeArea.right");
  assertSafeInset(safeArea.bottom, "safeArea.bottom");
  assertSafeInset(safeArea.left, "safeArea.left");

  const scale = Math.min(
    size.width / LOGICAL_VIEWPORT_WIDTH,
    size.height / LOGICAL_VIEWPORT_HEIGHT,
  );
  const cssWidth = LOGICAL_VIEWPORT_WIDTH * scale;
  const cssHeight = LOGICAL_VIEWPORT_HEIGHT * scale;
  const offsetX = (size.width - cssWidth) / 2;
  const offsetY = (size.height - cssHeight) / 2;
  const safeRect = createSafeRect(size, safeArea, scale, offsetX, offsetY);
  const blockedReason: BlockedReason =
    size.height > size.width
      ? "portrait"
      : size.width < MIN_VIEWPORT_WIDTH
        || size.height < MIN_VIEWPORT_HEIGHT
        || !canFitExplorationHud(safeRect, scale)
        ? "tooSmall"
        : null;

  return {
    scale,
    offsetX,
    offsetY,
    cssWidth,
    cssHeight,
    safeRect,
    blockedReason,
  };
}

/**
 * 把 CSS 命中门槛换算成逻辑像素，并使用向上取整保证实际 CSS 命中矩形不缩水。
 */
export function getHitAreaThresholds(scale: number): HitAreaThresholds {
  assertFinitePositive(scale, "scale");

  return {
    hitSizeLogical: Math.ceil(48 / scale),
    gapLogical: Math.ceil(8 / scale),
    longPressMoveLogical: Math.ceil(8 / scale),
  };
}

export class ViewportService {
  public calculate(size: ViewportSize, safeArea?: SafeAreaInsets): ViewportResult {
    return calculateViewport(size, safeArea);
  }

  public getHitAreaThresholds(scale: number): HitAreaThresholds {
    return getHitAreaThresholds(scale);
  }
}
