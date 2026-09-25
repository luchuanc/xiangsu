import { UI_FONT, UI_COLORS } from "./UiTheme";
import {
  Container,
  Graphics,
  Rectangle,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";

export const PIXEL_BUTTON_MIN_HIT_AREA = 44;
export const PIXEL_BUTTON_HIT_AREA_TOO_SMALL = "PIXEL_BUTTON_HIT_AREA_TOO_SMALL";

export interface PixelButtonOptions {
  label: string;
  width: number;
  height: number;
  onPress: () => void;
}

/**
 * 可复用的 16-bit 像素按钮。
 * 视觉层只创建显示对象，业务层通过 onPress 接收点击，不在这里修改存档或场景状态。
 */
export class PixelButton extends Container {
  public readonly shadow: Graphics;
  public readonly face: Graphics;
  private readonly primaryFace: Graphics;
  public readonly labelText: Text;

  private readonly onPress: () => void;
  private pressed = false;
  private disabled = false;
  private focused = false;
  private primary = false;
  private readonly labelBasePosition = { x: 0, y: 0 };

  public constructor(options: PixelButtonOptions) {
    super();

    if (
      !Number.isFinite(options.width) ||
      !Number.isFinite(options.height) ||
      options.width < PIXEL_BUTTON_MIN_HIT_AREA ||
      options.height < PIXEL_BUTTON_MIN_HIT_AREA
    ) {
      throw new RangeError(PIXEL_BUTTON_HIT_AREA_TOO_SMALL);
    }

    this.onPress = options.onPress;
    this.shadow = new Graphics();
    this.face = new Graphics();
    this.primaryFace = new Graphics();
    this.primaryFace.rect(0, 0, options.width, options.height).fill(UI_COLORS.gold)
      .stroke({ width: 1, color: 0xf3d8a6 });
    this.primaryFace.rect(3, 3, options.width - 6, options.height - 6)
      .stroke({ width: 1, color: 0x8d6d40 });
    this.primaryFace.visible = false;
    this.primaryFace.eventMode = "none";
    this.labelText = new Text({
      text: options.label,
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fill: 0xffedc2,
        fontWeight: "600",
        align: "center",
      },
      anchor: 0.5,
      roundPixels: true,
    });

    // 视觉子节点不抢父按钮的命中事件，所有触控统一落到按钮本身。
    this.shadow.eventMode = "none";
    this.face.eventMode = "none";
    this.labelText.eventMode = "none";

    this.drawPixelChrome(options.width, options.height);
    this.labelText.anchor.set(0.5);
    this.labelText.x = Math.floor(options.width / 2);
    this.labelText.y = Math.floor(options.height / 2);
    this.labelBasePosition.x = this.labelText.x;
    this.labelBasePosition.y = this.labelText.y;

    this.addChild(this.shadow, this.face, this.primaryFace, this.labelText);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = new Rectangle(0, 0, options.width, options.height);

    this.on("pointerdown", this.handlePointerDown);
    this.on("pointerover", this.handlePointerOver);
    this.on("pointerup", this.handlePointerUp);
    this.on("pointerupoutside", this.handlePointerUp);
    this.on("pointerout", this.handlePointerOut);
    this.on("pointercancel", this.handlePointerUp);
    this.on("pointertap", this.handlePointerTap);
  }

  public setDisabled(value: boolean): void {
    if (this.disabled === value) return;

    this.disabled = value;
    this.setPressed(false);
    this.eventMode = value ? "none" : "static";
    this.cursor = value ? "default" : "pointer";
    this.applyVisualState();
  }

  /**
   * 给 DOM 镜像或键盘导航使用的稳定焦点态；不改变命中矩形和按钮位置。
   * Pixi 画布在移动端通常没有键盘焦点，因此默认关闭，由上层按需显式开启。
   */
  public setFocused(value: boolean): void {
    if (this.focused === value) return;
    this.focused = value;
    this.applyVisualState();
  }

  public setLabel(value: string): void {
    this.labelText.text = value;
  }

  public setPrimary(value: boolean): void {
    if (this.primary === value) return;
    this.primary = value;
    this.applyVisualState();
  }

  public override destroy(): void {
    // 先解除按钮自身监听，再显式销毁自有子节点；不触碰外部传入的纹理资源。
    this.off("pointerdown", this.handlePointerDown);
    this.off("pointerover", this.handlePointerOver);
    this.off("pointerup", this.handlePointerUp);
    this.off("pointerupoutside", this.handlePointerUp);
    this.off("pointerout", this.handlePointerOut);
    this.off("pointercancel", this.handlePointerUp);
    this.off("pointertap", this.handlePointerTap);
    super.destroy({ children: true });
  }

  private drawPixelChrome(width: number, height: number): void {
    // 以整数绘制尺寸，避免生成的半像素边缘破坏像素风；命中区仍保留调用方传入的完整尺寸。
    const drawWidth = Math.floor(width);
    const drawHeight = Math.floor(height);
    this.shadow.x = 0;
    this.shadow.y = 3;
    this.shadow
      .rect(0, 0, drawWidth, drawHeight)
      .fill({ color: 0x0b0d17, alpha: 0.92 });
    // 深色外壳、金属边、内凹面和顶部高光共同形成可复用的正式按钮铠甲。
    this.face
      .rect(0, 0, drawWidth, drawHeight)
      .fill({ color: UI_COLORS.panel })
      .stroke({ width: 2, color: UI_COLORS.gold, alignment: 1, pixelLine: true });
    this.face
      .rect(3, 3, drawWidth - 6, drawHeight - 6)
      .fill({ color: UI_COLORS.raised })
      .stroke({ width: 1, color: 0x80643f, alignment: 1, pixelLine: true });
    this.face
      .rect(5, 5, Math.max(1, drawWidth - 10), 3)
      .fill({ color: 0xffd783, alpha: 0.28 });
    this.face
      .rect(5, Math.max(6, drawHeight - 8), Math.max(1, drawWidth - 10), 3)
      .fill({ color: 0x0c1020, alpha: 0.72 });
    // 四角的短金属铆钉比完整圆角更适合像素画，同时保留按钮边界层次。
    const cornerColor = 0xf2c46e;
    this.face.rect(4, 4, 3, 3).fill({ color: cornerColor });
    this.face.rect(drawWidth - 7, 4, 3, 3).fill({ color: cornerColor });
    this.face.rect(4, drawHeight - 7, 3, 3).fill({ color: 0x765431 });
    this.face.rect(drawWidth - 7, drawHeight - 7, 3, 3).fill({ color: 0x765431 });
  }

  private setPressed(value: boolean): void {
    if (this.pressed === value) return;

    this.pressed = value;
    this.face.x = value ? 1 : 0;
    this.face.y = value ? 1 : 0;
    this.primaryFace.x = this.face.x;
    this.primaryFace.y = this.face.y;
    this.labelText.x = this.labelBasePosition.x + (value ? 1 : 0);
    this.labelText.y = this.labelBasePosition.y + (value ? 1 : 0);
  }

  private applyVisualState(): void {
    this.primaryFace.visible = this.primary && !this.disabled;
    if (this.disabled) {
      this.face.tint = 0x777b88;
      this.labelText.style.fill = 0xa0a4ad;
      return;
    }
    this.face.tint = this.focused ? 0xffefb8 : 0xffffff;
    this.primaryFace.tint = this.focused ? 0xffefcf : 0xffffff;
    this.labelText.style.fill = this.primary ? UI_COLORS.ink : this.focused ? 0xffffff : UI_COLORS.paper;
  }

  private readonly handlePointerOver = (): void => { this.setFocused(true); };

  private readonly handlePointerOut = (): void => {
    this.setFocused(false);
    this.setPressed(false);
  };

  private readonly handlePointerDown = (): void => {
    if (this.disabled) return;
    this.setPressed(true);
  };

  private readonly handlePointerUp = (): void => {
    this.setPressed(false);
  };

  private readonly handlePointerTap = (event: FederatedPointerEvent): void => {
    event.stopPropagation?.();
    this.setPressed(false);
    if (!this.disabled) this.onPress();
  };
}
