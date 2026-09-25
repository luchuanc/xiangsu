import { UI_FONT } from "./UiTheme";
import {
  Container,
  Graphics,
  Rectangle,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";

export type BattleCommandIcon =
  | "sword"
  | "spell"
  | "shield"
  | "potion"
  | "more"
  | "active"
  | "ultimate"
  | "retreat"
  | "log"
  | "back";

export interface BattleCommandButtonOptions {
  readonly label: string;
  readonly icon: BattleCommandIcon;
  readonly width: number;
  readonly height: number;
  readonly onPress: () => void;
}

/**
 * 战斗专用的像素指令按钮。
 * 图标和按钮边框都在逻辑画布内绘制，命中区由外层按 CSS 触控门槛换算。
 */
export class BattleCommandButton extends Container {
  public readonly shadow: Graphics;
  public readonly face: Graphics;
  public readonly icon: Graphics;
  public readonly labelText: Text;

  private readonly onPress: () => void;
  private pressed = false;
  private disabled = false;

  public constructor(options: BattleCommandButtonOptions) {
    super({ label: `battle-command-${options.icon}` });
    if (!Number.isFinite(options.width) || !Number.isFinite(options.height) || options.width < 44 || options.height < 44) {
      throw new RangeError("BATTLE_COMMAND_BUTTON_TOO_SMALL");
    }
    this.onPress = options.onPress;
    this.shadow = new Graphics({ label: "button-shadow" });
    this.face = new Graphics({ label: "button-face" });
    this.icon = new Graphics({ label: `button-icon-${options.icon}` });
    this.labelText = new Text({
      text: options.label,
      style: {
        fontFamily: UI_FONT,
        fontSize: options.height >= 54 ? 11 : 10,
        fill: 0xffe9bd,
        stroke: { color: 0x080d1b, width: 3 },
        align: "center",
      },
      roundPixels: true,
    });

    this.drawChrome(options.width, options.height);
    this.drawIcon(options.icon, options.width / 2, Math.max(14, options.height * 0.32));
    this.labelText.anchor.set(0.5, 0.5);
    this.labelText.x = Math.floor(options.width / 2);
    this.labelText.y = Math.floor(options.height * 0.78);
    this.shadow.eventMode = "none";
    this.face.eventMode = "none";
    this.icon.eventMode = "none";
    this.labelText.eventMode = "none";
    this.addChild(this.shadow, this.face, this.icon, this.labelText);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = new Rectangle(0, 0, options.width, options.height);
    this.on("pointerdown", this.handlePointerDown);
    this.on("pointerup", this.handlePointerUp);
    this.on("pointerupoutside", this.handlePointerUp);
    this.on("pointerout", this.handlePointerUp);
    this.on("pointercancel", this.handlePointerUp);
    this.on("pointertap", this.handlePointerTap);
  }

  public setDisabled(value: boolean): void {
    if (this.disabled === value) return;
    this.disabled = value;
    this.setPressed(false);
    this.eventMode = value ? "none" : "static";
    this.cursor = value ? "default" : "pointer";
    this.alpha = value ? 0.56 : 1;
    this.face.tint = value ? 0x66718a : 0xffffff;
    this.icon.tint = value ? 0x7e8aa4 : 0xffffff;
    this.labelText.style.fill = value ? 0x929bb0 : 0xffe9bd;
  }

  public setLabel(value: string): void {
    this.labelText.text = value;
  }

  public override destroy(): void {
    this.off("pointerdown", this.handlePointerDown);
    this.off("pointerup", this.handlePointerUp);
    this.off("pointerupoutside", this.handlePointerUp);
    this.off("pointerout", this.handlePointerUp);
    this.off("pointercancel", this.handlePointerUp);
    this.off("pointertap", this.handlePointerTap);
    super.destroy({ children: true });
  }

  private drawChrome(width: number, height: number): void {
    const w = Math.floor(width);
    const h = Math.floor(height);
    this.shadow.x = 3;
    this.shadow.y = 4;
    this.shadow.rect(0, 0, w, h).fill({ color: 0x050914, alpha: 0.92 });
    this.face
      .rect(0, 0, w, h)
      .fill({ color: 0x1b2a43, alpha: 0.98 })
      .stroke({ width: 2, color: 0xc18c4c, pixelLine: true });
    this.face
      .rect(3, 3, w - 6, h - 6)
      .stroke({ width: 1, color: 0x526783, pixelLine: true });
    // 四角只保留两个金色像素角，形成古铜金的精致边缘，又不会让小按钮显得厚重。
    this.face.rect(5, 5, 7, 2).fill(0xe7bd70);
    this.face.rect(w - 12, h - 7, 7, 2).fill(0x8b5d34);
  }

  private drawIcon(icon: BattleCommandIcon, centerX: number, centerY: number): void {
    const g = this.icon;
    const gold = 0xf5ca70;
    const pale = 0xbcd6ee;
    const blue = 0x6e96bd;
    const red = 0xd46e5e;
    switch (icon) {
      case "sword":
        g.rect(centerX - 2, centerY - 12, 4, 21).fill(pale);
        g.rect(centerX - 8, centerY - 3, 16, 3).fill(gold);
        g.rect(centerX - 3, centerY + 9, 6, 4).fill(0x9c633f);
        g.rect(centerX - 1, centerY - 15, 2, 3).fill(gold);
        break;
      case "spell":
        g.star(centerX, centerY, 4, 11, 4, -Math.PI / 2).fill(0x9fd8ff);
        g.rect(centerX - 13, centerY - 1, 4, 2).fill(gold);
        g.rect(centerX + 9, centerY - 1, 4, 2).fill(gold);
        g.rect(centerX - 1, centerY - 15, 2, 4).fill(gold);
        break;
      case "shield":
        g.poly([centerX - 10, centerY - 12, centerX + 10, centerY - 12, centerX + 8, centerY + 7, centerX, centerY + 13, centerX - 8, centerY + 7], true).fill(blue).stroke({ width: 2, color: gold, pixelLine: true });
        g.rect(centerX - 1, centerY - 7, 2, 13).fill(pale);
        g.rect(centerX - 6, centerY - 2, 12, 2).fill(pale);
        break;
      case "potion":
        g.rect(centerX - 5, centerY - 14, 10, 5).fill(gold);
        g.rect(centerX - 8, centerY - 9, 16, 17).fill(red).stroke({ width: 2, color: gold, pixelLine: true });
        g.rect(centerX - 5, centerY - 5, 10, 4).fill(0xf28d6b);
        g.rect(centerX - 3, centerY + 2, 6, 2).fill(0x9a3f49);
        break;
      case "more":
        g.rect(centerX - 13, centerY - 3, 6, 6).fill(gold);
        g.rect(centerX - 3, centerY - 3, 6, 6).fill(gold);
        g.rect(centerX + 7, centerY - 3, 6, 6).fill(gold);
        break;
      case "active":
        g.circle(centerX, centerY, 9).fill({ color: 0x4e8fc4, alpha: 0.8 }).stroke({ width: 2, color: gold, pixelLine: true });
        g.rect(centerX - 2, centerY - 6, 4, 12).fill(pale);
        g.rect(centerX - 6, centerY - 2, 12, 4).fill(pale);
        break;
      case "ultimate":
        g.star(centerX, centerY, 5, 12, 5, -Math.PI / 2).fill(0x9f82e8).stroke({ width: 2, color: gold, pixelLine: true });
        break;
      case "retreat":
        g.rect(centerX - 10, centerY - 2, 18, 4).fill(gold);
        g.poly([centerX - 12, centerY, centerX - 3, centerY - 8, centerX - 3, centerY + 8], true).fill(gold);
        g.rect(centerX + 8, centerY - 8, 3, 16).fill(red);
        break;
      case "log":
        g.rect(centerX - 10, centerY - 12, 20, 24).fill(blue).stroke({ width: 2, color: gold, pixelLine: true });
        g.rect(centerX - 6, centerY - 6, 12, 2).fill(pale);
        g.rect(centerX - 6, centerY, 12, 2).fill(pale);
        g.rect(centerX - 6, centerY + 6, 8, 2).fill(pale);
        break;
      case "back":
        g.rect(centerX - 5, centerY - 2, 17, 4).fill(gold);
        g.poly([centerX - 12, centerY, centerX - 2, centerY - 9, centerX - 2, centerY + 9], true).fill(gold);
        break;
    }
  }

  private setPressed(value: boolean): void {
    if (this.pressed === value) return;
    this.pressed = value;
    this.face.x = value ? 1 : 0;
    this.face.y = value ? 1 : 0;
    this.icon.x = value ? 1 : 0;
    this.icon.y = value ? 1 : 0;
    this.labelText.x += value ? 1 : -1;
    this.labelText.y += value ? 1 : -1;
  }

  private readonly handlePointerDown = (): void => {
    if (!this.disabled) this.setPressed(true);
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
