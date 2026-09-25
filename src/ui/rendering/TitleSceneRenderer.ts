import { UI_FONT, DISPLAY_FONT } from "./UiTheme";
import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { PixiSceneRoot } from "../../app/PixiSceneRoot";
import type { SafeRect, ViewportResult } from "../../app/ViewportService";
import type { TitleSceneView, TitleSceneViewState } from "../../scenes/title/TitleScene";
import { PixelButton } from "./PixelButton";

export interface TitleSceneRendererOptions {
  readonly root: PixiSceneRoot;
  readonly onNewGame: () => void;
  readonly onContinue: () => void;
  /** 已加载的原创标题背景；纹理生命周期由资源层管理，渲染器只销毁 Sprite。 */
  readonly backgroundTexture?: Texture;
}

export interface TitleButtonRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 标题 Pixi 按钮与 DOM 语义按钮共用的逻辑矩形，避免两套坐标漂移。 */
export const TITLE_BUTTON_RECTS = Object.freeze({
  continue: Object.freeze({ x: 56, y: 194, width: 216, height: 56 }),
  newGame: Object.freeze({ x: 56, y: 260, width: 216, height: 56 }),
} satisfies Readonly<Record<"continue" | "newGame", TitleButtonRect>>);

export interface TitleButtonLayout {
  readonly continue: TitleButtonRect;
  readonly newGame: TitleButtonRect;
}

const DEFAULT_TITLE_SAFE_RECT: SafeRect = Object.freeze({
  x: 0,
  y: 0,
  width: 640,
  height: 360,
  right: 640,
  bottom: 360,
});

function translateAxis(min: number, max: number, safeMin: number, safeMax: number): number {
  if (min < safeMin) return Math.round(safeMin - min);
  if (max > safeMax) return Math.round(safeMax - max);
  return 0;
}

function translateRect(rect: TitleButtonRect, dx: number, dy: number): TitleButtonRect {
  return Object.freeze({ x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height });
}

/**
 * 标题按钮组只做整数平移，Pixi 与语义 DOM 都必须使用这个安全区结果。
 * 不缩小按钮、不改变组内间距，避免不同渲染层出现第二套 clamp 规则。
 */
export function layoutTitleButtons(safeRect: SafeRect): TitleButtonLayout {
  const baseRects = [TITLE_BUTTON_RECTS.continue, TITLE_BUTTON_RECTS.newGame];
  const minX = Math.min(...baseRects.map((rect) => rect.x));
  const maxX = Math.max(...baseRects.map((rect) => rect.x + rect.width));
  const minY = Math.min(...baseRects.map((rect) => rect.y));
  const maxY = Math.max(...baseRects.map((rect) => rect.y + rect.height));
  const dx = translateAxis(minX, maxX, safeRect.x, safeRect.right);
  const dy = translateAxis(minY, maxY, safeRect.y, safeRect.bottom);
  return Object.freeze({
    continue: translateRect(TITLE_BUTTON_RECTS.continue, dx, dy),
    newGame: translateRect(TITLE_BUTTON_RECTS.newGame, dx, dy),
  });
}

const DEFAULT_STATE: TitleSceneViewState = {
  canContinue: false,
  busy: false,
  errorText: null,
};

/**
 * 标题页的首张真实画布构图；先用整数 Graphics 验证像素布局，后续可替换为同坐标的原创图集。
 * 渲染器只拥有 screen 下的这一层，不接触存档，也不自行决定场景去向。
 */
export class TitleSceneRenderer implements TitleSceneView {
  public readonly layer: Container;
  public readonly backdrop: Graphics;
  public readonly backgroundSprite: Sprite | null;
  public readonly crest: Graphics;
  public readonly titleRule: Graphics;
  public readonly titleText: Text;
  public readonly subtitleText: Text;
  public readonly versionText: Text;
  public readonly errorText: Text;
  public readonly continueButton: PixelButton;
  public readonly newGameButton: PixelButton;

  private readonly root: PixiSceneRoot;
  private active = false;
  private destroyed = false;

  public constructor(options: TitleSceneRendererOptions) {
    this.root = options.root;
    this.layer = new Container();
    this.backgroundSprite = options.backgroundTexture
      ? new Sprite({ texture: options.backgroundTexture, roundPixels: true })
      : null;
    this.backdrop = new Graphics();
    this.crest = new Graphics();
    this.titleRule = new Graphics();
    this.titleText = new Text({
      text: "像素远征",
      style: {
        fontFamily: DISPLAY_FONT,
        fontSize: 46,
        fontWeight: "bold",
        letterSpacing: 5,
        fill: 0xffe2a0,
        stroke: { color: 0x0b1420, width: 1 },
        align: "center",
      },
      anchor: 0.5,
      roundPixels: true,
    });
    this.subtitleText = new Text({
      text: "构筑你的队伍，踏入十层深渊",
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: 0xd7c8be,
        stroke: { color: 0x0b1420, width: 1 },
        align: "center",
      },
      anchor: 0.5,
      roundPixels: true,
    });
    this.versionText = new Text({
      text: "本地存档 · 自动保存",
      style: {
        fontFamily: UI_FONT,
        fontSize: 11,
        fill: 0xa8bdc7,
        align: "center",
      },
      anchor: 0.5,
      roundPixels: true,
    });
    this.errorText = new Text({
      text: "",
      style: {
        fontFamily: UI_FONT,
        fontSize: 12,
        fill: 0xff8171,
        stroke: { color: 0x27151d, width: 2 },
        align: "center",
      },
      anchor: 0.5,
      roundPixels: true,
    });

    this.continueButton = new PixelButton({
      label: "继续远征",
      width: TITLE_BUTTON_RECTS.continue.width,
      height: TITLE_BUTTON_RECTS.continue.height,
      onPress: options.onContinue,
    });
    this.newGameButton = new PixelButton({
      label: "开始新游戏",
      width: TITLE_BUTTON_RECTS.newGame.width,
      height: TITLE_BUTTON_RECTS.newGame.height,
      onPress: options.onNewGame,
    });

    if (this.backgroundSprite !== null) {
      // 标题逻辑坐标固定为 640×360，背景铺满此画布，避免安全区平移造成纹理漂移。
      this.backgroundSprite.x = 0;
      this.backgroundSprite.y = 0;
      this.backgroundSprite.width = 640;
      this.backgroundSprite.height = 360;
      this.backgroundSprite.eventMode = "none";
    }
    this.drawBackdrop(this.backgroundSprite !== null);
    this.drawCrest();
    const eyebrow = new Text({ text: "P I X E L   E X P E D I T I O N", style: { fontFamily: UI_FONT, fontSize: 10, fill: 0xc6a36b }, roundPixels: true });
    eyebrow.x = 58;
    eyebrow.y = 54;
    const chapter = new Text({ text: "灰炉镇  /  远征的起点", style: { fontFamily: UI_FONT, fontSize: 10, fill: 0xd1d8d5 }, roundPixels: true });
    chapter.x = 453;
    chapter.y = 328;
    this.drawTitleRule();
    this.titleText.anchor.set(0, 0.5);
    this.titleText.x = 54;
    this.titleText.y = 100;
    this.subtitleText.anchor.set(0, 0.5);
    this.subtitleText.x = 58;
    this.subtitleText.y = 143;
    this.applyButtonLayout(layoutTitleButtons(DEFAULT_TITLE_SAFE_RECT));
    this.errorText.x = 164;
    this.errorText.y = 327;
    this.versionText.x = 164;
    this.versionText.y = 344;

    // 画布只挂载一个业务层，便于路由切换时整体隐藏和销毁，避免残留标题对象。
    this.layer.addChild(
      ...(this.backgroundSprite === null ? [] : [this.backgroundSprite]),
      this.backdrop,
      this.crest,
      this.titleRule,
      this.titleText,
      this.subtitleText,
      this.continueButton,
      this.newGameButton,
      this.errorText,
      this.versionText,
      eyebrow,
      chapter,
    );
    this.root.screen.addChild(this.layer);
    this.layer.visible = false;
    this.update(DEFAULT_STATE);
  }

  public prepare(): void {
    if (this.destroyed) throw new Error("TITLE_RENDERER_DESTROYED");
  }

  public setViewport(viewport: ViewportResult): void {
    if (this.destroyed) return;
    this.applyButtonLayout(layoutTitleButtons(viewport.safeRect));
  }

  public enter(state: TitleSceneViewState): void {
    if (this.destroyed) return;
    this.active = true;
    this.layer.visible = true;
    this.update(state);
  }

  public update(state: TitleSceneViewState): void {
    if (this.destroyed) return;
    this.errorText.text = state.errorText ?? "";
    this.errorText.visible = state.errorText !== null;
    this.continueButton.setLabel(state.canContinue ? "继续远征" : "暂无远征存档");
    this.continueButton.setPrimary(state.canContinue);
    this.newGameButton.setPrimary(!state.canContinue);
    this.continueButton.setDisabled(!this.active || !state.canContinue || state.busy);
    this.newGameButton.setDisabled(!this.active || state.busy);
  }

  public pause(): void {
    if (this.destroyed) return;
    this.active = false;
    this.layer.visible = false;
    this.continueButton.setDisabled(true);
    this.newGameButton.setDisabled(true);
  }

  public resume(state: TitleSceneViewState): void {
    if (this.destroyed) return;
    this.active = true;
    this.layer.visible = true;
    this.update(state);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.screen.removeChild(this.layer);
    // 不传 texture/textureSource，背景纹理可能被资源缓存和其他场景共享。
    this.layer.destroy({ children: true, texture: false, textureSource: false });
  }

  private drawBackdrop(hasBackground: boolean): void {
    // 有原创背景时只叠加半透明可读性层；没有背景时保留纯 Graphics 的可运行降级构图。
    if (hasBackground) {
      this.backdrop.rect(0, 0, 640, 360).fill({ color: 0x08121e, alpha: 0.12 });
      // A stepped scrim keeps the reading area calm and leaves the town artwork visible.
      for (let x = 0; x < 480; x += 8) {
        const alpha = 0.91 * Math.pow(1 - x / 480, 0.65);
        this.backdrop.rect(x, 0, 8, 360).fill({ color: 0x08121e, alpha });
      }
      this.backdrop.rect(24, 24, 592, 312).stroke({ width: 1, color: 0xc6a36b, alpha: 0.22 });
      this.backdrop.rect(448, 322, 159, 22).fill({ color: 0x08121e, alpha: 0.65 });
      return;
    }

    // 所有色块和坐标均为逻辑整数，形成夜空、山体、城镇灯火、前景石阶和深渊红线。
    this.fillRect(0, 0, 640, 360, 0x0d1429);

    const stars = [
      [42, 34, 2, 2], [96, 72, 2, 2], [151, 28, 2, 2], [213, 84, 2, 2],
      [282, 39, 2, 2], [358, 77, 2, 2], [431, 30, 2, 2], [504, 68, 2, 2],
      [578, 42, 2, 2], [612, 96, 2, 2], [36, 126, 2, 2], [544, 123, 2, 2],
    ];
    for (const [x, y, width, height] of stars) this.fillRect(x, y, width, height, 0x9eb4ce);

    // 远山和中景山脊使用阶梯块，避免平滑矢量轮廓破坏像素感。
    this.fillRect(0, 155, 640, 95, 0x18223c);
    this.fillRect(42, 139, 112, 16, 0x202a47);
    this.fillRect(64, 126, 72, 13, 0x202a47);
    this.fillRect(84, 112, 34, 14, 0x202a47);
    this.fillRect(198, 145, 150, 18, 0x222b47);
    this.fillRect(232, 128, 82, 17, 0x222b47);
    this.fillRect(258, 108, 30, 20, 0x222b47);
    this.fillRect(401, 137, 151, 20, 0x1d2743);
    this.fillRect(436, 119, 83, 18, 0x1d2743);
    this.fillRect(465, 99, 26, 20, 0x1d2743);

    // 深渊红地平线是危险提示，城镇灯火把标题视觉中心拉回安全区。
    this.fillRect(0, 184, 640, 3, 0x8e3047);
    this.fillRect(0, 187, 640, 61, 0x242139);
    this.fillRect(110, 167, 424, 12, 0x34304a);
    this.fillRect(129, 179, 384, 69, 0x29253b);
    const windows = [
      [151, 185], [179, 185], [226, 191], [253, 191], [391, 184], [420, 184],
      [466, 191], [492, 191], [286, 201], [341, 201],
    ];
    for (const [x, y] of windows) {
      this.fillRect(x, y, 8, 6, 0xf0ad55);
      this.fillRect(x + 2, y + 1, 4, 4, 0xffd87a);
    }
    this.fillRect(306, 177, 28, 71, 0x161a2b);
    this.fillRect(299, 174, 42, 6, 0x4b3b48);
    this.fillRect(316, 160, 8, 14, 0xf4b45a);

    // 前景石阶压住画面底部，给按钮留出“远征入口”而不是工程占位的舞台。
    this.fillRect(0, 248, 640, 112, 0x12182a);
    this.fillRect(44, 251, 552, 16, 0x3b3544);
    this.fillRect(68, 267, 504, 15, 0x302c3e);
    this.fillRect(96, 282, 448, 16, 0x27263a);
    this.fillRect(126, 298, 388, 17, 0x1f2134);
    this.fillRect(160, 315, 320, 18, 0x191c2e);
    this.fillRect(192, 333, 256, 27, 0x14182a);
    this.fillRect(44, 251, 552, 2, 0x6a5260);
    this.fillRect(68, 267, 504, 2, 0x5a4755);
    this.fillRect(96, 282, 448, 2, 0x4c3e4e);
    this.fillRect(126, 298, 388, 2, 0x403648);
    this.fillRect(160, 315, 320, 2, 0x342e42);
  }

  private drawCrest(): void {
    this.crest.rect(56, 31, 20, 2).fill(0xc6a36b);
    this.crest.rect(56, 31, 2, 10).fill(0xc6a36b);
    this.crest.rect(578, 309, 20, 2).fill(0xc6a36b);
    this.crest.rect(596, 301, 2, 10).fill(0xc6a36b);
  }

  private drawTitleRule(): void {
    this.titleRule.rect(58, 168, 35, 2).fill(0xc6a36b);
    this.titleRule.rect(98, 168, 172, 1).fill({ color: 0xc6a36b, alpha: 0.25 });
  }

  private fillRect(x: number, y: number, width: number, height: number, color: number): void {
    this.backdrop.rect(x, y, width, height).fill({ color });
  }

  private applyButtonLayout(layout: TitleButtonLayout): void {
    this.continueButton.x = layout.continue.x;
    this.continueButton.y = layout.continue.y;
    this.newGameButton.x = layout.newGame.x;
    this.newGameButton.y = layout.newGame.y;
  }
}
