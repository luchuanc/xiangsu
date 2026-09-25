import { UI_FONT } from "./UiTheme";
import { Container, Graphics, Rectangle, Text } from "pixi.js";

import { EXPLORATION_JOYSTICK_HIT_SIZE, type ViewportResult } from "../../app/ViewportService";
import {
  InputState,
  bindInputDisplayEvent,
  type InputDisplayObjectLike,
} from "../../app/input/InputState";
import { TouchButton } from "../../app/input/TouchButton";
import { VirtualJoystick } from "../../app/input/VirtualJoystick";
import type { ExplorationHudControlId, ExplorationHudLayout } from "../../scenes/exploration/ExplorationHud";
import type { FieldHudStatus, FieldInputAction } from "../../scenes/exploration/FieldSceneView";

/** 控件 id 与领域层消费的动作 token 一一对应；interaction 的 token 固定为既有 interact。 */
export const FIELD_INPUT_ACTIONS: Readonly<Record<Exclude<ExplorationHudControlId, "joystick">, FieldInputAction>> = Object.freeze({
  map: "map",
  inventory: "inventory",
  party: "party",
  settings: "settings",
  interaction: "interact",
  menu: "menu",
});

const CONTROL_LABELS: Readonly<Record<Exclude<ExplorationHudControlId, "joystick">, string>> = {
  map: "地图",
  inventory: "背包",
  party: "队伍",
  settings: "设置",
  interaction: "交互",
  menu: "菜单",
};

const CONTROL_IDS: readonly Exclude<ExplorationHudControlId, "joystick">[] = [
  "map",
  "inventory",
  "party",
  "settings",
  "interaction",
  "menu",
];

interface PartyRow {
  readonly container: Container;
  readonly frame: Graphics;
  readonly name: Text;
  readonly hp: Text;
  readonly bar: Graphics;
}

interface ButtonVisual {
  readonly display: Container;
  readonly visual: Container;
  readonly background: Graphics;
  readonly icon: Graphics;
  readonly label: Text;
  readonly width: number;
  readonly height: number;
  pressed: boolean;
  highlighted: boolean;
}

type FieldHudIcon = Exclude<ExplorationHudControlId, "joystick">;

const FIELD_NAVY = 0x101a30;
const FIELD_NAVY_DEEP = 0x080d1b;
const FIELD_BLUE = 0x294662;
const FIELD_TEAL = 0x4f9aa0;
const FIELD_GOLD = 0xd8aa5b;
const FIELD_GOLD_BRIGHT = 0xffd77a;
const FIELD_PARCHMENT = 0xffe8b0;

/** 统一野外 HUD 的像素图标；使用 Graphics 避免新增纹理请求和资源生命周期。 */
function drawFieldIcon(icon: FieldHudIcon, target: Graphics, centerX: number, centerY: number): void {
  const gold = FIELD_GOLD_BRIGHT;
  const pale = 0xb9d4dc;
  const teal = 0x68b8b4;
  const red = 0xd87568;
  target.clear();
  switch (icon) {
    case "map":
      target.circle(centerX, centerY, 9).fill({ color: FIELD_BLUE, alpha: 0.96 }).stroke({ color: gold, width: 2, pixelLine: true });
      target.poly([centerX - 2, centerY - 7, centerX + 5, centerY + 3, centerX - 6, centerY + 1], true).fill(teal);
      target.rect(centerX - 1, centerY - 11, 2, 22).fill({ color: pale, alpha: 0.8 });
      break;
    case "inventory":
      target.rect(centerX - 9, centerY - 7, 18, 15).fill(FIELD_BLUE).stroke({ color: gold, width: 2, pixelLine: true });
      target.rect(centerX - 5, centerY - 11, 10, 5).fill(FIELD_BLUE).stroke({ color: gold, width: 2, pixelLine: true });
      target.rect(centerX - 3, centerY - 1, 6, 3).fill(teal);
      target.rect(centerX - 7, centerY + 6, 14, 2).fill({ color: pale, alpha: 0.65 });
      break;
    case "party":
      target.circle(centerX - 5, centerY - 5, 4).fill(pale).stroke({ color: gold, width: 1, pixelLine: true });
      target.circle(centerX + 6, centerY - 4, 3).fill(teal).stroke({ color: gold, width: 1, pixelLine: true });
      target.rect(centerX - 11, centerY + 1, 12, 8).fill(FIELD_BLUE).stroke({ color: gold, width: 2, pixelLine: true });
      target.rect(centerX + 2, centerY + 2, 9, 7).fill(0x386d78).stroke({ color: gold, width: 1, pixelLine: true });
      break;
    case "settings":
      target.rect(centerX - 3, centerY - 11, 6, 22).fill(gold);
      target.rect(centerX - 11, centerY - 3, 22, 6).fill(gold);
      target.rect(centerX - 7, centerY - 7, 14, 14).fill(FIELD_NAVY);
      target.circle(centerX, centerY, 5).fill(teal).stroke({ color: pale, width: 1, pixelLine: true });
      break;
    case "interaction":
      target.roundRect(centerX - 11, centerY - 9, 22, 16, 2).fill(FIELD_BLUE).stroke({ color: gold, width: 2, pixelLine: true });
      target.poly([centerX - 6, centerY + 7, centerX - 1, centerY + 7, centerX - 7, centerY + 12], true).fill(gold);
      target.rect(centerX - 6, centerY - 2, 3, 3).fill(pale);
      target.rect(centerX - 1, centerY - 2, 3, 3).fill(pale);
      target.rect(centerX + 4, centerY - 2, 3, 3).fill(pale);
      break;
    case "menu":
      target.rect(centerX - 11, centerY - 9, 22, 3).fill(gold);
      target.rect(centerX - 11, centerY - 2, 22, 3).fill(teal);
      target.rect(centerX - 11, centerY + 5, 22, 3).fill(red);
      target.rect(centerX - 15, centerY - 9, 2, 3).fill(pale);
      target.rect(centerX - 15, centerY - 2, 2, 3).fill(pale);
      target.rect(centerX - 15, centerY + 5, 2, 3).fill(pale);
      break;
  }
}

function controlMap(layout: ExplorationHudLayout): ReadonlyMap<ExplorationHudControlId, ExplorationHudLayout["controls"][number]> {
  return new Map(layout.controls.map((control) => [control.id, control]));
}

function rectKey(layout: ExplorationHudLayout): string {
  return layout.controls
    .map((control) => `${control.id}:${control.x},${control.y},${control.width},${control.height},${control.interactive ? 1 : 0}`)
    .join("|");
}

function drawButtonVisual(state: ButtonVisual): void {
  const fill = state.highlighted
    ? state.pressed ? 0x5d969a : 0x2f6873
    : state.pressed ? 0x345576 : FIELD_NAVY;
  const stroke = state.highlighted ? FIELD_GOLD_BRIGHT : FIELD_GOLD;
  state.background.clear();
  state.background
    .rect(3, 4, state.width - 3, state.height - 3)
    .fill({ color: FIELD_NAVY_DEEP, alpha: 0.86 });
  state.background
    .rect(0, 0, state.width, state.height)
    .fill({ color: fill, alpha: state.highlighted ? 0.98 : 0.96 })
    .stroke({ color: stroke, width: state.pressed ? 3 : 2, alpha: 0.96, pixelLine: true });
  state.background
    .rect(3, 3, state.width - 6, state.height - 6)
    .stroke({ color: state.highlighted ? FIELD_TEAL : 0x526783, width: 1, alpha: 0.9, pixelLine: true });
  // 仅保留两处亮金角，形成正式的古金像素边框而不压缩小按钮内容区。
  state.background.rect(5, 5, 7, 2).fill(FIELD_GOLD_BRIGHT);
  state.background.rect(state.width - 12, state.height - 7, 7, 2).fill(0x8b5d34);
  // 视觉层下沉，命中层 display 的坐标和 hitArea 始终保持不变。
  state.visual.y = state.pressed ? 2 : 0;
}

/**
 * 字段 HUD 只拥有 Pixi 显示对象和输入控件；所有动作统一写入注入的 InputState。
 * 它不读取存档、内容或领域服务，也不创建自己的 ticker。
 */
export interface FieldHudRendererOptions {
  readonly root: Container;
  readonly inputState: InputState;
  readonly viewport: ViewportResult;
}

export class FieldHudRenderer {
  public readonly layer = new Container();
  public readonly joystickDisplay = new Container();
  /** 独立拇指节点，测试和可访问层可读取其实际位置；不参与命中。 */
  public get joystickThumbDisplay(): Graphics | null {
    return this.joystickThumb;
  }
  public readonly buttonDisplays = new Map<Exclude<ExplorationHudControlId, "joystick">, Container>();
  /** 按钮视觉层与命中层分离，按压时只移动视觉层。 */
  public readonly buttonVisualDisplays = new Map<Exclude<ExplorationHudControlId, "joystick">, Container>();
  public readonly buttons = new Map<Exclude<ExplorationHudControlId, "joystick">, TouchButton>();
  public joystick!: VirtualJoystick;

  private readonly root: Container;
  private readonly inputState: InputState;
  private readonly panel: Graphics;
  private readonly mapName: Text;
  private readonly partyRows: readonly PartyRow[];
  private readonly barFractions = [0, 0, 0, 0];
  private readonly barWidths = [0, 0, 0, 0];
  private readonly unbinds: Array<() => void> = [];
  private readonly controlUnbinds: Array<() => void> = [];
  private readonly buttonVisuals = new Map<Exclude<ExplorationHudControlId, "joystick">, ButtonVisual>();
  private joystickThumb: Graphics | null = null;
  private readonly blurUnbinds: Array<() => void> = [];
  private viewportValue: ViewportResult;
  private layoutKey = "";
  private active = false;
  private destroyed = false;

  public constructor(options: FieldHudRendererOptions) {
    this.root = options.root;
    this.inputState = options.inputState;
    this.viewportValue = options.viewport;
    this.layer.eventMode = "passive";

    this.panel = new Graphics();
    this.mapName = new Text({
      text: "",
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: 0xffe2a0,
        stroke: { color: 0x101526, width: 2 },
      },
      roundPixels: true,
    });
    this.partyRows = Object.freeze([0, 1, 2, 3].map((_, index) => {
      const row = new Container();
      const frame = new Graphics();
      const name = new Text({
        text: "空槽",
        style: {
          fontFamily: UI_FONT,
          fontSize: 10,
          fill: FIELD_PARCHMENT,
          stroke: { color: FIELD_NAVY_DEEP, width: 2 },
        },
        roundPixels: true,
      });
      const hp = new Text({
        text: "--/--",
        style: {
          fontFamily: UI_FONT,
          fontSize: 9,
          fill: 0xbdd2d9,
          stroke: { color: FIELD_NAVY_DEEP, width: 2 },
        },
        roundPixels: true,
      });
      const bar = new Graphics();
      name.x = 8;
      name.y = 2;
      hp.x = 105;
      hp.y = 2;
      frame
        .rect(4, 0, 180, 20)
        .fill({ color: index % 2 === 0 ? 0x16243a : 0x132035, alpha: 0.93 })
        .stroke({ color: index === 0 ? 0x4b7d88 : 0x344c68, width: 1, alpha: 0.95, pixelLine: true });
      frame.rect(5, 1, 2, 18).fill(index === 0 ? FIELD_GOLD_BRIGHT : FIELD_TEAL);
      row.addChild(frame, bar, name, hp);
      return { container: row, frame, name, hp, bar };
    }));
    this.layer.addChild(this.panel, this.mapName);
    this.layer.addChild(...this.partyRows.map((partyRow) => partyRow.container));
    this.root.addChild(this.layer);

    // 浏览器失焦时 pointerup 可能永远不到达 canvas，必须主动收回摇杆和按钮所有权。
    if (typeof window !== "undefined") {
      const target = window;
      const resetOnBlur = (): void => this.resetPointerVisuals();
      // 当前 Pixi EventSystem 未注册原生 pointercancel；直接转交所属触点，
      // 避免系统取消触摸后仍移动，也不能因另一根手指取消而中断摇杆。
      const cancelJoystick = (event: PointerEvent): void => { this.joystick?.pointerCancel(event); };
      target.addEventListener("blur", resetOnBlur);
      target.addEventListener("pointercancel", cancelJoystick, true);
      this.blurUnbinds.push(
        () => target.removeEventListener("blur", resetOnBlur),
        () => target.removeEventListener("pointercancel", cancelJoystick, true),
      );
    }

    // 初始布局只用于让控件从构造时就有有效命中区，首帧会以 frame.hud 再次校准。
    this.ensureControls({ safeRect: options.viewport.safeRect, controls: [] });
    this.layoutStatus({
      sceneKind: "town",
      mapId: "",
      mapDisplayName: "",
      partySlots: [
        { slot: 0, member: null },
        { slot: 1, member: null },
        { slot: 2, member: null },
        { slot: 3, member: null },
      ],
    }, options.viewport.safeRect);
    this.layer.visible = false;
  }

  public get viewport(): ViewportResult {
    return this.viewportValue;
  }

  /** 供渲染测试和调试面板读取的纯展示值，不暴露业务状态。 */
  public get partyBarFractions(): readonly number[] {
    return [...this.barFractions];
  }

  /** 供渲染验证读取实际绘制宽度，仍然只暴露展示数据。 */
  public get partyBarWidths(): readonly number[] {
    return [...this.barWidths];
  }

  public get statusPanel(): Graphics {
    return this.panel;
  }

  public get mapNameText(): Text {
    return this.mapName;
  }

  public get partyRowDisplays(): readonly Container[] {
    return this.partyRows.map((partyRow) => partyRow.container);
  }

  public setViewport(viewport: ViewportResult): void {
    if (this.destroyed) return;
    this.viewportValue = viewport;
    // scale 变化会影响 TouchButton 的逻辑命中尺寸，下一帧必须重建控件实例。
    this.layoutKey = "";
  }

  public render(
    layout: ExplorationHudLayout,
    status: Readonly<FieldHudStatus>,
    interactionEnabled: boolean,
    interactionLabel = "交互",
  ): void {
    if (this.destroyed) return;
    this.ensureControls(layout);
    this.layoutStatus(status, layout.safeRect);
    const controls = controlMap(layout);
    for (const id of CONTROL_IDS) {
      const button = this.buttons.get(id);
      const control = controls.get(id);
      const enabled = this.active
        && control?.interactive === true
        && (id !== "interaction" || interactionEnabled);
      button?.setEnabled(enabled);
      const display = this.buttonDisplays.get(id);
      if (display) display.alpha = enabled ? 1 : 0.55;
      const visual = this.buttonVisuals.get(id);
      if (visual) {
        visual.highlighted = id === "interaction" && interactionEnabled;
        if (id === "interaction") visual.label.text = interactionLabel;
        drawButtonVisual(visual);
      }
    }
    this.joystick.setEnabled(this.active && controls.get("joystick")?.interactive === true);
  }

  public enter(
    layout: ExplorationHudLayout,
    status: Readonly<FieldHudStatus>,
    interactionEnabled: boolean,
    interactionLabel = "交互",
  ): void {
    if (this.destroyed) return;
    this.active = true;
    this.layer.visible = true;
    this.render(layout, status, interactionEnabled, interactionLabel);
  }

  public pause(): void {
    if (this.destroyed) return;
    this.active = false;
    this.resetPointerVisuals();
    this.joystick.setEnabled(false);
    for (const button of this.buttons.values()) button.setEnabled(false);
    this.layer.visible = false;
  }

  public resume(
    layout: ExplorationHudLayout,
    status: Readonly<FieldHudStatus>,
    interactionEnabled: boolean,
    interactionLabel = "交互",
  ): void {
    if (this.destroyed) return;
    this.active = true;
    this.layer.visible = true;
    this.render(layout, status, interactionEnabled, interactionLabel);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    this.resetPointerVisuals();
    this.joystick.destroy();
    for (const button of this.buttons.values()) button.destroy();
    while (this.unbinds.length > 0) this.unbinds.pop()?.();
    while (this.controlUnbinds.length > 0) this.controlUnbinds.pop()?.();
    this.buttons.clear();
    this.buttonDisplays.clear();
    this.buttonVisualDisplays.clear();
    this.buttonVisuals.clear();
    while (this.blurUnbinds.length > 0) this.blurUnbinds.pop()?.();
    this.root.removeChild(this.layer);
    this.layer.destroy({ children: true });
  }

  /** 清除所有触点与视觉按压态；用于失焦、暂停、销毁和系统中断。 */
  private resetPointerVisuals(): void {
    this.inputState.resetAll();
    if (this.joystick) this.joystick.reset();
    for (const button of this.buttons.values()) button.reset();
  }

  private ensureControls(layout: ExplorationHudLayout): void {
    const nextKey = rectKey(layout);
    if (nextKey === this.layoutKey && this.joystick !== undefined) return;
    this.layoutKey = nextKey;

    if (this.joystick) {
      this.joystick.destroy();
      this.joystickDisplay.removeFromParent();
    }
    while (this.controlUnbinds.length > 0) this.controlUnbinds.pop()?.();
    for (const button of this.buttons.values()) button.destroy();
    for (const display of this.buttonDisplays.values()) {
      display.removeFromParent();
      display.destroy({ children: true });
    }
    this.buttons.clear();
    this.buttonDisplays.clear();
    this.buttonVisualDisplays.clear();
    this.buttonVisuals.clear();

    const controls = controlMap(layout);
    const joystickControl = controls.get("joystick");
    const joystickWidth = joystickControl?.width ?? EXPLORATION_JOYSTICK_HIT_SIZE;
    const joystickHeight = joystickControl?.height ?? EXPLORATION_JOYSTICK_HIT_SIZE;
    for (const child of this.joystickDisplay.removeChildren()) child.destroy({ children: true });
    this.joystickDisplay.x = joystickControl?.x ?? 0;
    this.joystickDisplay.y = joystickControl?.y ?? 0;
    this.joystickDisplay.hitArea = new Rectangle(0, 0, joystickWidth, joystickHeight);
    this.joystickDisplay.eventMode = "static";
    const ring = new Graphics();
    const centerX = joystickWidth / 2;
    const centerY = joystickHeight / 2;
    const ringRadius = Math.min(joystickWidth, joystickHeight) / 2 - 8;
    const thumbRadius = Math.min(18, Math.floor(ringRadius / 3));
    const travelRadius = Math.max(0, ringRadius - thumbRadius - 4);
    ring.eventMode = "none";
    ring.circle(centerX + 3, centerY + 4, ringRadius).fill({ color: FIELD_NAVY_DEEP, alpha: 0.65 });
    ring
      .circle(centerX, centerY, ringRadius)
      .fill({ color: 0x16263d, alpha: 0.78 })
      .stroke({ color: FIELD_GOLD, width: 2, alpha: 0.96, pixelLine: true });
    ring.circle(centerX, centerY, ringRadius - 10).stroke({ color: FIELD_TEAL, width: 1, alpha: 0.8, pixelLine: true });
    // 四向罗盘刻线让摇杆与地图探索语义更明确，同时不改变实际命中圆盘。
    ring.rect(centerX - 1, centerY - ringRadius + 6, 2, 8).fill({ color: FIELD_GOLD_BRIGHT, alpha: 0.9 });
    ring.rect(centerX - 1, centerY + ringRadius - 14, 2, 8).fill({ color: FIELD_GOLD_BRIGHT, alpha: 0.9 });
    ring.rect(centerX - ringRadius + 6, centerY - 1, 8, 2).fill({ color: FIELD_GOLD_BRIGHT, alpha: 0.9 });
    ring.rect(centerX + ringRadius - 14, centerY - 1, 8, 2).fill({ color: FIELD_GOLD_BRIGHT, alpha: 0.9 });
    ring.circle(centerX, centerY, 12).stroke({ color: 0x476f7a, width: 1, alpha: 0.7, pixelLine: true });
    ring.poly([centerX, centerY - 7, centerX + 3, centerY, centerX, centerY + 7, centerX - 3, centerY], true).fill({ color: 0x5fa5a4, alpha: 0.72 });
    this.joystickDisplay.addChild(ring);
    this.joystickThumb = new Graphics();
    this.joystickThumb.circle(2, 3, thumbRadius + 1).fill({ color: FIELD_NAVY_DEEP, alpha: 0.82 });
    this.joystickThumb.circle(0, 0, thumbRadius).fill({ color: FIELD_GOLD, alpha: 0.98 });
    this.joystickThumb.circle(0, 0, thumbRadius).stroke({ color: 0xfff0c2, width: 2, alpha: 0.98, pixelLine: true });
    for (const y of [-5, 0, 5]) this.joystickThumb.rect(-6, y - 1, 12, 2).fill({ color: 0x6d4b36, alpha: 0.65 });
    this.joystickThumb.eventMode = "none";
    this.joystickThumb.position.set(centerX, centerY);
    this.joystickDisplay.addChild(this.joystickThumb);
    this.layer.addChild(this.joystickDisplay);
    this.joystick = new VirtualJoystick({
      inputState: this.inputState,
      displayObject: this.joystickDisplay as unknown as InputDisplayObjectLike,
      radius: 48,
      deadZone: 0.12,
      onVectorChange: (vector) => {
        if (!this.joystickThumb) return;
        const centerX = joystickWidth / 2;
        const centerY = joystickHeight / 2;
        // 拇指节点只在圆盘内部移动；缩小一点轨道避免图形越出外圈。
        this.joystickThumb.position.set(
          centerX + vector.x * travelRadius,
          centerY + vector.y * travelRadius,
        );
      },
    });
    // 拖出热区后继续接收 globalpointermove；仅松手、取消或暂停时复位。

    for (const id of CONTROL_IDS) {
      const control = controls.get(id);
      const display = new Container();
      display.eventMode = "static";
      display.x = control?.x ?? 0;
      display.y = control?.y ?? 0;
      display.hitArea = new Rectangle(0, 0, control?.width ?? 56, control?.height ?? 56);
      const visual = new Container();
      visual.eventMode = "none";
      const background = new Graphics();
      const width = control?.width ?? 56;
      const height = control?.height ?? 56;
      const icon = new Graphics();
      const label = new Text({
        text: CONTROL_LABELS[id],
        style: {
          fontFamily: UI_FONT,
          fontSize: height >= 54 ? 10 : 9,
          fill: FIELD_PARCHMENT,
          stroke: { color: FIELD_NAVY_DEEP, width: 3 },
          align: "center",
        },
        roundPixels: true,
      });
      label.anchor.set(0.5);
      label.x = width / 2;
      label.y = Math.floor(height * 0.79);
      drawFieldIcon(id, icon, width / 2, Math.max(13, Math.floor(height * 0.32)));
      icon.eventMode = "none";
      visual.addChild(background, icon, label);
      display.addChild(visual);
      const visualState: ButtonVisual = {
        display,
        visual,
        background,
        icon,
        label,
        width,
        height,
        pressed: false,
        highlighted: false,
      };
      drawButtonVisual(visualState);
      this.layer.addChild(display);
      const button = new TouchButton({
        inputState: this.inputState,
        action: FIELD_INPUT_ACTIONS[id],
        displayObject: display as unknown as InputDisplayObjectLike,
        scale: this.viewportValue.scale,
        onPressedChange: (pressed) => {
          visualState.pressed = pressed;
          drawButtonVisual(visualState);
        },
      });
      this.buttonDisplays.set(id, display);
      this.buttonVisualDisplays.set(id, visual);
      this.buttonVisuals.set(id, visualState);
      this.buttons.set(id, button);
      this.bindPointerOut(display, () => button.reset(), this.controlUnbinds);
    }
  }

  private layoutStatus(status: Readonly<FieldHudStatus>, safeRect: Readonly<{ x: number; y: number }>): void {
    const panelX = Math.round(safeRect.x + 8);
    const panelY = Math.round(safeRect.y + 8);
    this.panel.clear();
    this.panel.x = panelX;
    this.panel.y = panelY;
    this.panel.rect(4, 4, 188, 116).fill({ color: FIELD_NAVY_DEEP, alpha: 0.78 });
    this.panel
      .rect(0, 0, 188, 116)
      .fill({ color: 0x111d33, alpha: 0.96 })
      .stroke({ color: FIELD_GOLD, width: 2, alpha: 0.95, pixelLine: true });
    this.panel.rect(3, 3, 182, 110).stroke({ color: 0x3c6074, width: 1, alpha: 0.9, pixelLine: true });
    this.panel.rect(8, 18, 172, 2).fill({ color: FIELD_TEAL, alpha: 0.72 });
    this.panel.rect(8, 18, 48, 2).fill({ color: FIELD_GOLD_BRIGHT, alpha: 0.9 });
    // 右上角的小罗盘是装饰信息，不承载输入，避免与四个功能按钮重复。
    this.panel.circle(171, 10, 5).stroke({ color: FIELD_GOLD_BRIGHT, width: 1, alpha: 0.9, pixelLine: true });
    this.panel.poly([171, 5, 173, 12, 169, 12], true).fill({ color: FIELD_TEAL, alpha: 0.9 });
    this.mapName.text = status.mapDisplayName;
    this.mapName.x = panelX + 8;
    this.mapName.y = panelY + 5;
    for (const [index, row] of this.partyRows.entries()) {
      const slot = status.partySlots[index];
      const member = slot?.member ?? null;
      row.container.x = panelX;
      row.container.y = panelY + 20 + index * 21;
      row.name.text = member?.displayName ?? "空槽";
      row.hp.text = member ? `${member.currentHp}/${member.maxHp}` : "--/--";
      row.bar.clear();
      row.bar.rect(8, 15, 84, 5).fill({ color: 0x26364b });
      row.bar.rect(8, 15, 84, 1).fill({ color: 0x52647a, alpha: 0.8 });
      const maxHp = member?.maxHp ?? 0;
      const fraction = maxHp > 0 ? Math.min(1, Math.max(0, (member?.currentHp ?? 0) / maxHp)) : 0;
      this.barFractions[index] = fraction;
      const width = Math.round(84 * fraction);
      this.barWidths[index] = width;
      row.bar.rect(8, 15, width, 5).fill({ color: fraction <= 0 ? 0x8a3d4f : fraction < 0.35 ? 0xd08c52 : 0x5fb59a });
    }
  }

  private bindPointerOut(display: Container, reset: () => void, bucket = this.unbinds): void {
    const target = display as unknown as InputDisplayObjectLike;
    const unbind = bindInputDisplayEvent(target, "pointerout", () => reset());
    bucket.push(unbind);
  }
}
