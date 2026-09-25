import { UI_FONT } from "./UiTheme";
import { Container, Graphics, Rectangle, Text } from "pixi.js";
import type { ViewportResult } from "../../app/ViewportService";
import { getHitAreaThresholds } from "../../app/ViewportService";
import type { PixiRenderAssetSource } from "./PixiAssetResolver";

/** 城镇模态层的业务命令；Renderer 不根据文案或 testId 推断业务含义。 */
export type TownModalCommand =
  | { readonly kind: "close" }
  | { readonly kind: "rest" }
  | { readonly kind: "openFloorSelect" }
  | { readonly kind: "buyOffer"; readonly offerId: string }
  | { readonly kind: "selectFloor"; readonly floorId: string }
  | { readonly kind: "changePage"; readonly panel: "merchant" | "floorSelect"; readonly pageIndex: number }
  | { readonly kind: "enterFloor"; readonly floorId: string; readonly mode: "exploration" | "shortFarm" | "bossRetry" | "abyssEcho" };

export interface TownModalAction {
  readonly testId: string;
  readonly ariaLabel: string;
  readonly label: string;
  readonly command: TownModalCommand;
  readonly enabled: boolean;
  readonly disabledReasonText: string | null;
}

export interface TownModalOffer {
  readonly offerId: string;
  readonly name: string;
  readonly priceText: string;
  readonly sold: boolean;
  readonly enabled: boolean;
  readonly disabledReasonText: string | null;
}

export interface TownModalFloorMode {
  readonly mode: "exploration" | "shortFarm" | "bossRetry" | "abyssEcho";
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReasonText: string | null;
}

export interface TownModalFloorEntry {
  readonly floorId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly locked: boolean;
  readonly modes: readonly TownModalFloorMode[];
}

interface TownModalStateBase {
  readonly title: string;
  readonly body: string;
  readonly statusText: string | null;
  readonly errorText: string | null;
  readonly busy: boolean;
  readonly actions: readonly TownModalAction[];
}

export type TownModalState =
  | ({ readonly kind: "closed" } & TownModalStateBase)
  | ({ readonly kind: "npc"; readonly npcId?: string } & TownModalStateBase)
  | ({
    readonly kind: "merchant";
    readonly gold: number;
    readonly offers: readonly TownModalOffer[];
    readonly busyOfferId: string | null;
    readonly pageIndex: number;
    readonly pageCount: number;
  } & TownModalStateBase)
  | ({
    readonly kind: "floorSelect";
    readonly entries: readonly TownModalFloorEntry[];
    readonly selectedFloorId: string | null;
    readonly pageIndex: number;
    readonly pageCount: number;
  } & TownModalStateBase);

export interface TownModalSemanticControl {
  readonly testId: string;
  readonly ariaLabel: string;
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly disabled: boolean;
  readonly command: TownModalCommand;
}

export interface TownModalRendererOptions {
  readonly root: Container;
  readonly assets: PixiRenderAssetSource;
  readonly atlasId: "atlas_core_ui";
  readonly viewport: ViewportResult;
  readonly onCommand: (command: TownModalCommand) => void | Promise<void>;
  /** GameFlow 在语义控制状态变化后刷新透明 DOM；回调只做投影，不承载业务。 */
  readonly onSemanticControlsChanged?: () => void;
}

interface ModalButton {
  readonly node: Container;
  control: TownModalSemanticControl;
  readonly baseDisabled: boolean;
}

const LOGICAL_WIDTH = 640;
const LOGICAL_HEIGHT = 360;
const PANEL_MARGIN = 12;
const PANEL_PADDING = 16;
const PANEL_MAX_HEIGHT = 328;
const PANEL_CONTENT_TOP = 58;
const BUSY_REASON_TEXT = "处理中";
// 城镇弹窗沿用战斗 HUD 的深海蓝 / 古金 / 青绿色层级；颜色集中在这里，
// 让 NPC、商店和楼层选择即使没有外部图片资源也能保持同一套正式皮肤。
const COLOR_BACKDROP = 0x050a16;
const COLOR_PANEL = 0x101a2e;
const COLOR_PANEL_RAISED = 0x172741;
const COLOR_PANEL_INSET = 0x0b1425;
const COLOR_PANEL_EDGE = 0x526b8f;
const COLOR_PANEL_EDGE_DARK = 0x253b5a;
const COLOR_GOLD = 0xd5ad5a;
const COLOR_TEAL = 0x43d9c2;
const COLOR_TEAL_DARK = 0x1e6f76;
const COLOR_TEXT = 0xfff0c7;
const COLOR_MUTED = 0xa8bad1;
const COLOR_DISABLED = 0x74839a;
const COLOR_ERROR = 0xff8f8f;
const COLOR_SUCCESS = 0x8ce1b0;
const COLOR_SHADOW = 0x030711;
const COLOR_LOCKED = 0x26344b;

function safeText(value: string): string {
  return value.trim().length > 0 ? value : "";
}

/**
 * 按当前安全区和真实 modal 几何选择每页最大条目数；GameFlow 必须复用此纯函数。
 * 不按设备型号分支，最后一行与 footer 之间至少保留一个逻辑 gap。
 */
export function getTownModalPageSize(viewport: ViewportResult): 1 | 2 | 3 {
  const thresholds = getHitAreaThresholds(viewport.scale);
  const panelHeight = Math.max(0, Math.min(PANEL_MAX_HEIGHT, viewport.safeRect.height));
  const footerTop = panelHeight - thresholds.hitSizeLogical - PANEL_PADDING;
  for (const pageSize of [3, 2, 1] as const) {
    const lastRowBottom = PANEL_CONTENT_TOP + (pageSize - 1) * (thresholds.hitSizeLogical + thresholds.gapLogical) + thresholds.hitSizeLogical;
    if (lastRowBottom + thresholds.gapLogical <= footerTop) return pageSize;
  }
  return 1;
}

/**
 * 城镇模态层只负责 Pixi 显示对象与命令转发；商店价格、楼层门禁和本地化
 * 均由 GameFlowController 投影后传入，避免 Renderer 复制领域规则。
 */
export class TownModalRenderer {
  public readonly root: Container;
  private readonly options: TownModalRendererOptions;
  private readonly modalRoot = new Container();
  private viewportValue: ViewportResult;
  private stateValue: TownModalState = {
    kind: "closed",
    title: "",
    body: "",
    statusText: null,
    errorText: null,
    busy: false,
    actions: [],
  };
  private controlsValue: readonly TownModalSemanticControl[] = Object.freeze([]);
  private buttons: ModalButton[] = [];
  private enabledValue = true;
  private destroyed = false;
  private notifyingControls = false;

  public constructor(options: TownModalRendererOptions) {
    this.options = options;
    this.root = options.root;
    this.viewportValue = options.viewport;
    this.modalRoot.eventMode = "none";
    this.root.addChild(this.modalRoot);
  }

  public get semanticControls(): readonly TownModalSemanticControl[] { return this.controlsValue; }
  public get state(): TownModalState { return this.stateValue; }

  public render(state: TownModalState): void {
    if (this.destroyed) return;
    this.stateValue = state;
    this.clearNodes();
    if (state.kind === "closed") {
      this.modalRoot.visible = false;
      this.controlsValue = Object.freeze([]);
      this.notifySemanticControlsChanged();
      return;
    }

    this.modalRoot.visible = true;
    this.modalRoot.eventMode = "static";
    const safe = this.viewportValue.safeRect;
    const thresholds = getHitAreaThresholds(this.viewportValue.scale);
    // 面板直接使用 safeRect 高度，给窄屏三行列表与底部操作栏留出确定空间；
    // 控件布局由列宽/行距计算完成，不再靠 clamp 把超出的按钮挤到同一位置。
    const panelWidth = Math.max(0, Math.min(560, safe.width - PANEL_MARGIN * 2));
    const panelHeight = Math.max(0, Math.min(PANEL_MAX_HEIGHT, safe.height));
    const panelX = safe.x + Math.max(0, Math.floor((safe.width - panelWidth) / 2));
    const panelY = safe.y + Math.max(0, Math.floor((safe.height - panelHeight) / 2));

    const backdrop = new Graphics();
    backdrop.rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT).fill({ color: COLOR_BACKDROP, alpha: 0.78 });
    backdrop.eventMode = this.enabledValue ? "static" : "none";
    backdrop.hitArea = new Rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    this.modalRoot.addChild(backdrop);

    const panel = new Graphics();
    // 外框用两层描边和底部阴影拉开弹窗与地图的层级，不依赖滤镜，移动端更稳定。
    panel.roundRect(panelX + 4, panelY + 5, panelWidth, panelHeight, 9).fill({ color: COLOR_SHADOW, alpha: 0.92 });
    panel.roundRect(panelX, panelY, panelWidth, panelHeight, 9).fill({ color: COLOR_PANEL, alpha: 0.99 });
    panel.roundRect(panelX, panelY, panelWidth, panelHeight, 9).stroke({ color: COLOR_PANEL_EDGE, width: 2, alpha: 1 });
    panel.roundRect(panelX + 4, panelY + 4, Math.max(0, panelWidth - 8), Math.max(0, panelHeight - 8), 6).stroke({ color: COLOR_PANEL_EDGE_DARK, width: 1, alpha: 1, pixelLine: true });
    panel.rect(panelX + 12, panelY + 51, Math.max(0, panelWidth - 24), 1).fill({ color: COLOR_PANEL_EDGE_DARK, alpha: 0.9 });
    panel.rect(panelX + 16, panelY + 51, 42, 2).fill({ color: COLOR_GOLD, alpha: 0.9 });
    panel.rect(panelX + panelWidth - 58, panelY + 51, 42, 2).fill({ color: COLOR_TEAL, alpha: 0.7 });
    this.drawCornerOrnaments(panel, panelX, panelY, panelWidth, panelHeight);
    panel.eventMode = "none";
    this.modalRoot.addChild(panel);

    const title = new Text({ text: safeText(state.title), style: { fontFamily: UI_FONT, fontSize: 20, fill: COLOR_TEXT, fontWeight: "bold", wordWrap: true, wordWrapWidth: Math.max(90, panelWidth - PANEL_PADDING * 2 - 112) } });
    title.x = panelX + PANEL_PADDING;
    title.y = panelY + 10;
    title.eventMode = "none";
    this.modalRoot.addChild(title);

    if (state.kind === "npc") {
      this.addNpcDialogueCard(state, panelX, panelY, panelWidth, panelHeight, thresholds);
    } else {
      const body = new Text({ text: safeText(state.body), style: { fontFamily: UI_FONT, fontSize: 13, fill: COLOR_MUTED, wordWrap: true, wordWrapWidth: Math.max(40, panelWidth - PANEL_PADDING * 2) } });
      body.x = panelX + PANEL_PADDING;
      body.y = panelY + 34;
      body.eventMode = "none";
      this.modalRoot.addChild(body);
    }

    const kindLabel = state.kind === "merchant" ? "边境商会" : state.kind === "floorSelect" ? "远征部署" : "城镇事务";
    this.addBadge(kindLabel, panelX + panelWidth - PANEL_PADDING - 92, panelY + 10, 92, COLOR_TEAL, COLOR_PANEL_RAISED);

    const contentY = panelY + PANEL_CONTENT_TOP;
    const pageSize = getTownModalPageSize(this.viewportValue);
    if (state.kind === "merchant") {
      const goldWidth = Math.min(126, Math.max(96, panelWidth / 3));
      this.addBadge(`金币 ${state.gold}`, panelX + panelWidth - PANEL_PADDING - goldWidth, panelY + 33, goldWidth, COLOR_GOLD, COLOR_PANEL_INSET);
      const pageStart = Math.max(0, state.pageIndex) * pageSize;
      const offers = state.offers.slice(pageStart, pageStart + pageSize);
      for (const [index, offer] of offers.entries()) {
        const action: TownModalAction = {
          testId: `town-modal-buy-${offer.offerId}`,
          ariaLabel: `购买${offer.name}`,
          label: `${offer.name} · ${offer.priceText}`,
          command: { kind: "buyOffer", offerId: offer.offerId },
          enabled: offer.enabled && !offer.sold && state.busyOfferId !== offer.offerId && !state.busy,
          disabledReasonText: state.busy || state.busyOfferId === offer.offerId ? BUSY_REASON_TEXT : offer.sold ? "已售出" : offer.disabledReasonText,
        };
        this.addButton(
          action,
          panelX + PANEL_PADDING,
          contentY + index * (thresholds.hitSizeLogical + thresholds.gapLogical),
          panelWidth - PANEL_PADDING * 2,
          thresholds.hitSizeLogical,
        );
      }
    } else if (state.kind === "floorSelect") {
      const pageStart = Math.max(0, state.pageIndex) * pageSize;
      const entries = state.entries.slice(pageStart, pageStart + pageSize);
      const columnGap = thresholds.gapLogical;
      const columnWidth = Math.max(thresholds.hitSizeLogical, Math.floor((panelWidth - PANEL_PADDING * 2 - columnGap) / 2));
      const leftX = panelX + PANEL_PADDING;
      const rightX = leftX + columnWidth + columnGap;
      const selectedEntry = entries.find((entry) => entry.floorId === state.selectedFloorId) ?? null;
      for (const [index, entry] of entries.entries()) {
        const selected = state.selectedFloorId === entry.floorId;
        const selectAction: TownModalAction = {
          testId: `town-modal-select-floor-${entry.floorId}`,
          ariaLabel: `选择${entry.title}`,
          label: `${selected ? "▸ " : ""}${entry.title}${entry.locked ? " · 未解锁" : ""}`,
          command: { kind: "selectFloor", floorId: entry.floorId },
          enabled: !entry.locked && !state.busy,
          disabledReasonText: entry.locked ? "尚未解锁" : state.busy ? BUSY_REASON_TEXT : null,
        };
        this.addButton(
          selectAction,
          leftX,
          contentY + index * (thresholds.hitSizeLogical + thresholds.gapLogical),
          columnWidth,
          thresholds.hitSizeLogical,
        );
      }
      if (selectedEntry) {
        const detailCard = new Graphics();
        detailCard.roundRect(rightX - 4, contentY - 4, columnWidth + 4, Math.max(0, panelHeight - (contentY - panelY) - thresholds.hitSizeLogical - PANEL_PADDING + 4), 6)
          .fill({ color: COLOR_PANEL_INSET, alpha: 0.94 })
          .stroke({ color: selectedEntry.locked ? COLOR_PANEL_EDGE_DARK : COLOR_TEAL_DARK, width: 1, alpha: 1 });
        detailCard.eventMode = "none";
        this.modalRoot.addChildAt(detailCard, Math.max(0, this.modalRoot.children.length - 1));
        this.addText(selectedEntry.title, rightX, contentY, COLOR_TEXT, 13);
        this.addText(selectedEntry.subtitle, rightX, contentY + 18, COLOR_MUTED, 11);
        this.addText("选择进入方式", rightX, contentY + 31, COLOR_TEAL, 10);
        for (const [index, mode] of selectedEntry.modes.slice(0, 2).entries()) {
          const modeAction: TownModalAction = {
            testId: `town-modal-enter-floor-${selectedEntry.floorId}-${mode.mode}`,
            ariaLabel: mode.label,
            label: mode.label,
            command: { kind: "enterFloor", floorId: selectedEntry.floorId, mode: mode.mode },
            enabled: mode.enabled && !state.busy,
            disabledReasonText: state.busy ? BUSY_REASON_TEXT : mode.disabledReasonText,
          };
          this.addButton(
            modeAction,
            rightX,
            contentY + 36 + index * (thresholds.hitSizeLogical + thresholds.gapLogical),
            columnWidth,
            thresholds.hitSizeLogical,
          );
        }
      } else {
        this.addText("请选择楼层", rightX, contentY, COLOR_MUTED);
      }
    }

    const actionStartX = panelX + PANEL_PADDING;
    const actionStartY = panelY + panelHeight - thresholds.hitSizeLogical - PANEL_PADDING;
    const footerRule = new Graphics();
    footerRule.rect(actionStartX, actionStartY - 9, Math.max(0, panelWidth - PANEL_PADDING * 2), 1).fill({ color: COLOR_PANEL_EDGE_DARK, alpha: 0.95 });
    footerRule.rect(actionStartX, actionStartY - 9, 28, 2).fill({ color: COLOR_GOLD, alpha: 0.8 });
    footerRule.eventMode = "none";
    this.modalRoot.addChild(footerRule);
    const actions = [...state.actions];
    const seen = new Set<string>();
    let actionIndex = 0;
    const visibleActions = actions.map((action) => ({
      ...action,
      disabledReasonText: !action.enabled && state.busy ? BUSY_REASON_TEXT : action.disabledReasonText,
    })).filter((action) => {
      if (seen.has(action.testId)) return false;
      seen.add(action.testId);
      return true;
    }).slice(0, 3);
    const actionGap = thresholds.gapLogical;
    const actionWidth = visibleActions.length > 0
      ? Math.floor((panelWidth - PANEL_PADDING * 2 - actionGap * (visibleActions.length - 1)) / visibleActions.length)
      : 0;
    for (const action of visibleActions) {
      this.addButton(action, actionStartX + actionIndex * (actionWidth + actionGap), actionStartY, actionWidth, thresholds.hitSizeLogical);
      actionIndex += 1;
    }

    const statusY = actionStartY - (state.errorText ? 30 : 16);
    if (state.statusText) this.addStatusLine(state.statusText, panelX + PANEL_PADDING, statusY, COLOR_SUCCESS);
    if (state.errorText) this.addStatusLine(state.errorText, panelX + PANEL_PADDING, actionStartY - 16, COLOR_ERROR);
    this.applyEnabledState();
  }

  public setViewport(viewport: ViewportResult): void {
    if (this.destroyed) return;
    this.viewportValue = viewport;
    this.render(this.stateValue);
  }

  public setEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.enabledValue = enabled;
    this.applyEnabledState();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearNodes();
    this.modalRoot.removeFromParent();
    this.modalRoot.destroy({ children: true });
    this.controlsValue = Object.freeze([]);
  }

  private addNpcDialogueCard(
    state: Extract<TownModalState, { readonly kind: "npc" }>,
    panelX: number,
    panelY: number,
    panelWidth: number,
    panelHeight: number,
    thresholds: ReturnType<typeof getHitAreaThresholds>,
  ): void {
    const actionStartY = panelY + panelHeight - thresholds.hitSizeLogical - PANEL_PADDING;
    const cardX = panelX + PANEL_PADDING + 2;
    const cardY = panelY + 67;
    const cardWidth = Math.max(80, panelWidth - PANEL_PADDING * 2 - 4);
    const cardHeight = Math.max(72, actionStartY - cardY - 22);
    const card = new Graphics();
    card.roundRect(cardX + 2, cardY + 3, cardWidth, cardHeight, 7).fill({ color: COLOR_SHADOW, alpha: 0.8 });
    card.roundRect(cardX, cardY, cardWidth, cardHeight, 7).fill({ color: COLOR_PANEL_RAISED, alpha: 0.98 }).stroke({ color: COLOR_PANEL_EDGE, width: 1.5, alpha: 0.9, pixelLine: true });
    card.roundRect(cardX + 5, cardY + 5, Math.max(0, cardWidth - 10), Math.max(0, cardHeight - 10), 4).fill({ color: COLOR_PANEL_INSET, alpha: 0.58 }).stroke({ color: COLOR_PANEL_EDGE_DARK, width: 1, alpha: 0.9, pixelLine: true });
    card.rect(cardX + 15, cardY + 2, 48, 2).fill({ color: COLOR_TEAL, alpha: 0.9 });
    card.rect(cardX + cardWidth - 63, cardY + cardHeight - 3, 48, 2).fill({ color: COLOR_GOLD, alpha: 0.75 });
    card.eventMode = "none";
    this.modalRoot.addChild(card);

    const iconFrame = new Graphics();
    const iconX = cardX + 16;
    const iconY = cardY + Math.floor(cardHeight / 2) - 24;
    iconFrame.roundRect(iconX, iconY, 48, 48, 5).fill({ color: 0x0a1729, alpha: 0.95 }).stroke({ color: COLOR_TEAL_DARK, width: 1, pixelLine: true });
    iconFrame.rect(iconX + 5, iconY + 5, 38, 2).fill({ color: COLOR_GOLD, alpha: 0.75 });
    iconFrame.rect(iconX + 5, iconY + 41, 38, 2).fill({ color: COLOR_TEAL, alpha: 0.6 });
    const hasFloorCommand = state.actions.some((action) => action.command.kind === "openFloorSelect");
    const hasRestCommand = state.actions.some((action) => action.command.kind === "rest");
    if (hasFloorCommand) {
      // 由 openFloorSelect 命令明确决定使用地图卷轴图标，不根据 NPC 文案猜测功能。
      iconFrame.roundRect(iconX + 13, iconY + 13, 22, 22, 2).fill({ color: 0x15354a }).stroke({ color: COLOR_TEAL, width: 1.5, pixelLine: true });
      iconFrame.moveTo(iconX + 18, iconY + 18).lineTo(iconX + 30, iconY + 18).stroke({ color: COLOR_GOLD, width: 1, pixelLine: true });
      iconFrame.moveTo(iconX + 18, iconY + 23).lineTo(iconX + 30, iconY + 23).stroke({ color: COLOR_GOLD, width: 1, pixelLine: true });
      iconFrame.moveTo(iconX + 18, iconY + 28).lineTo(iconX + 26, iconY + 28).stroke({ color: COLOR_GOLD, width: 1, pixelLine: true });
      iconFrame.moveTo(iconX + 29, iconY + 12).lineTo(iconX + 34, iconY + 17).stroke({ color: COLOR_TEAL, width: 1.5, pixelLine: true });
    } else if (hasRestCommand) {
      // 由 rest 命令明确决定使用休整图标；没有该命令时不暗示旅店功能。
      iconFrame.circle(iconX + 24, iconY + 24, 10).fill({ color: 0x253f53 }).stroke({ color: COLOR_GOLD, width: 1.5, pixelLine: true });
      iconFrame.circle(iconX + 28, iconY + 20, 7).fill({ color: 0x0a1729 });
      iconFrame.circle(iconX + 34, iconY + 14, 1.5).fill({ color: COLOR_TEAL });
      iconFrame.circle(iconX + 38, iconY + 19, 1).fill({ color: COLOR_TEAL });
    } else {
      // 普通 NPC 对话使用卷轴，不额外声明商店、旅店等业务身份。
      iconFrame.roundRect(iconX + 13, iconY + 12, 22, 24, 2).fill({ color: 0x3a2e26 }).stroke({ color: COLOR_GOLD, width: 1.5, pixelLine: true });
      iconFrame.moveTo(iconX + 18, iconY + 19).lineTo(iconX + 30, iconY + 19).stroke({ color: COLOR_TEXT, width: 1, pixelLine: true });
      iconFrame.moveTo(iconX + 18, iconY + 24).lineTo(iconX + 30, iconY + 24).stroke({ color: COLOR_TEXT, width: 1, pixelLine: true });
      iconFrame.moveTo(iconX + 18, iconY + 29).lineTo(iconX + 26, iconY + 29).stroke({ color: COLOR_TEXT, width: 1, pixelLine: true });
    }
    iconFrame.eventMode = "none";
    this.modalRoot.addChild(iconFrame);

    const dialogue = new Text({
      text: safeText(state.body),
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: COLOR_TEXT,
        lineHeight: 19,
        wordWrap: true,
        wordWrapWidth: Math.max(96, cardWidth - 86),
      },
    });
    dialogue.anchor.set(0, 0.5);
    dialogue.x = cardX + 78;
    dialogue.y = cardY + cardHeight / 2;
    dialogue.eventMode = "none";
    this.modalRoot.addChild(dialogue);
  }

  private addText(text: string, x: number, y: number, fill: number, fontSize = 10): void {
    const node = new Text({ text: safeText(text), style: { fontFamily: UI_FONT, fontSize, fill, letterSpacing: 0.2 } });
    node.x = x;
    node.y = y;
    node.eventMode = "none";
    this.modalRoot.addChild(node);
  }

  private addBadge(text: string, x: number, y: number, width: number, accent: number, fill: number): void {
    const badge = new Graphics();
    badge.roundRect(x, y, width, 20, 4).fill({ color: fill, alpha: 0.98 }).stroke({ color: accent, width: 1, alpha: 0.85, pixelLine: true });
    badge.circle(x + 8, y + 10, 2).fill({ color: accent, alpha: 0.95 });
    badge.eventMode = "none";
    this.modalRoot.addChild(badge);
    const label = new Text({ text: safeText(text), style: { fontFamily: UI_FONT, fontSize: 9, fill: accent, align: "center", wordWrap: true, wordWrapWidth: Math.max(24, width - 18) } });
    label.anchor.set(0.5);
    label.x = x + width / 2 + 4;
    label.y = y + 10;
    label.eventMode = "none";
    this.modalRoot.addChild(label);
  }

  private addStatusLine(text: string, x: number, y: number, color: number): void {
    const marker = new Graphics();
    marker.circle(x + 3, y + 6, 2).fill({ color, alpha: 0.95 });
    marker.eventMode = "none";
    this.modalRoot.addChild(marker);
    const node = new Text({ text: safeText(text), style: { fontFamily: UI_FONT, fontSize: 11, fill: color, wordWrap: true, wordWrapWidth: 360 } });
    node.x = x + 9;
    node.y = y;
    node.eventMode = "none";
    this.modalRoot.addChild(node);
  }

  private drawCornerOrnaments(graphics: Graphics, x: number, y: number, width: number, height: number): void {
    const accent = COLOR_GOLD;
    const size = 7;
    graphics.rect(x + 10, y + 1, size, 2).fill({ color: accent, alpha: 0.9 });
    graphics.rect(x + 1, y + 10, 2, size).fill({ color: accent, alpha: 0.9 });
    graphics.rect(x + width - 17, y + 1, size, 2).fill({ color: COLOR_TEAL, alpha: 0.8 });
    graphics.rect(x + width - 3, y + 10, 2, size).fill({ color: COLOR_TEAL, alpha: 0.8 });
    graphics.rect(x + 10, y + height - 3, size, 2).fill({ color: accent, alpha: 0.55 });
    graphics.rect(x + 1, y + height - 17, 2, size).fill({ color: accent, alpha: 0.55 });
    graphics.rect(x + width - 17, y + height - 3, size, 2).fill({ color: COLOR_TEAL, alpha: 0.5 });
    graphics.rect(x + width - 3, y + height - 17, 2, size).fill({ color: COLOR_TEAL, alpha: 0.5 });
  }

  private buttonColors(action: TownModalAction): Readonly<{ accent: number; fill: number; inner: number }> {
    if (!action.enabled) return { accent: COLOR_DISABLED, fill: COLOR_LOCKED, inner: 0x1a263b };
    if (action.testId.includes("enter-floor") || action.testId.includes("open-floor")) {
      return { accent: COLOR_TEAL, fill: 0x123a46, inner: 0x102b3b };
    }
    if (action.testId.includes("select-floor") && action.label.trimStart().startsWith("▸")) {
      return { accent: COLOR_TEAL, fill: 0x17414b, inner: 0x12323e };
    }
    if (action.testId.includes("close")) return { accent: COLOR_PANEL_EDGE, fill: COLOR_PANEL_RAISED, inner: COLOR_PANEL_INSET };
    return { accent: COLOR_GOLD, fill: 0x3a2e26, inner: 0x292333 };
  }

  private drawButtonIcon(graphics: Graphics, action: TownModalAction, x: number, y: number, color: number): void {
    const iconX = x + 11;
    const iconY = y;
    graphics.eventMode = "none";
    if (action.testId.includes("buy-")) {
      graphics.circle(iconX + 6, iconY + 6, 5).stroke({ color, width: 1.5, pixelLine: true });
      graphics.moveTo(iconX + 6, iconY + 2).lineTo(iconX + 6, iconY + 10).stroke({ color, width: 1, pixelLine: true });
      graphics.moveTo(iconX + 3, iconY + 5).lineTo(iconX + 9, iconY + 5).stroke({ color, width: 1, pixelLine: true });
      return;
    }
    if (action.testId.includes("select-floor")) {
      graphics.circle(iconX + 6, iconY + 6, 5).stroke({ color, width: 1.3, pixelLine: true });
      graphics.circle(iconX + 6, iconY + 6, 1.5).fill({ color });
      graphics.moveTo(iconX + 6, iconY).lineTo(iconX + 6, iconY + 12).stroke({ color, width: 1, pixelLine: true });
      graphics.moveTo(iconX, iconY + 6).lineTo(iconX + 12, iconY + 6).stroke({ color, width: 1, pixelLine: true });
      return;
    }
    if (action.testId.includes("enter-floor") || action.testId.includes("open-floor")) {
      graphics.moveTo(iconX + 1, iconY + 6).lineTo(iconX + 10, iconY + 6).stroke({ color, width: 1.5, pixelLine: true });
      graphics.moveTo(iconX + 7, iconY + 3).lineTo(iconX + 10, iconY + 6).lineTo(iconX + 7, iconY + 9).stroke({ color, width: 1.5, pixelLine: true });
      return;
    }
    if (action.testId.includes("rest")) {
      graphics.arc(iconX + 6, iconY + 6, 5, 0.4, Math.PI * 1.65).stroke({ color, width: 1.5, pixelLine: true });
      graphics.circle(iconX + 9, iconY + 3, 1).fill({ color });
      return;
    }
    if (action.testId.includes("close")) {
      graphics.moveTo(iconX + 2, iconY + 2).lineTo(iconX + 10, iconY + 10).stroke({ color, width: 1.5, pixelLine: true });
      graphics.moveTo(iconX + 10, iconY + 2).lineTo(iconX + 2, iconY + 10).stroke({ color, width: 1.5, pixelLine: true });
      return;
    }
    if (action.testId.includes("prev") || action.testId.includes("next")) {
      const direction = action.testId.includes("prev") ? -1 : 1;
      graphics.moveTo(iconX + 6 + direction * 3, iconY + 2).lineTo(iconX + 2 + direction * 3, iconY + 6).lineTo(iconX + 6 + direction * 3, iconY + 10).stroke({ color, width: 1.5, pixelLine: true });
      return;
    }
    graphics.circle(iconX + 6, iconY + 6, 4).fill({ color, alpha: 0.8 });
  }

  private addButton(action: TownModalAction, x: number, y: number, width: number, height: number): void {
    // 位置由各布局列显式计算；这里不再 clamp，避免多个越界按钮被挤到同一位置。
    const safe = this.viewportValue.safeRect;
    const buttonWidth = width;
    const buttonHeight = height;
    const buttonX = x;
    const buttonY = y;
    if (buttonWidth <= 0 || buttonHeight <= 0 || buttonX < safe.x || buttonY < safe.y || buttonX + buttonWidth > safe.right || buttonY + buttonHeight > safe.bottom) {
      throw new Error(`TOWN_MODAL_LAYOUT_OUT_OF_SAFE_RECT:${action.testId}`);
    }
    const reason = !action.enabled && action.disabledReasonText ? ` · ${action.disabledReasonText}` : "";
    const displayLabel = `${safeText(action.label)}${reason}`;
    const ariaLabel = reason.length > 0 ? `${safeText(action.ariaLabel)}（${action.disabledReasonText}）` : safeText(action.ariaLabel);
    const button = new Container();
    const colors = this.buttonColors(action);
    const background = new Graphics();
    background.roundRect(buttonX + 2, buttonY + 3, buttonWidth, buttonHeight, 5).fill({ color: COLOR_SHADOW, alpha: 0.9 });
    background.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 5).fill({ color: colors.fill, alpha: 0.99 }).stroke({ color: colors.accent, width: 1.5, alpha: action.enabled ? 0.95 : 0.65, pixelLine: true });
    background.roundRect(buttonX + 3, buttonY + 3, Math.max(0, buttonWidth - 6), Math.max(0, buttonHeight - 6), 3).fill({ color: colors.inner, alpha: 0.62 }).stroke({ color: action.enabled ? COLOR_PANEL_EDGE_DARK : COLOR_LOCKED, width: 1, alpha: 0.9, pixelLine: true });
    background.rect(buttonX + 8, buttonY + 2, Math.min(22, Math.max(8, buttonWidth - 16)), 2).fill({ color: colors.accent, alpha: action.enabled ? 0.95 : 0.55 });
    background.eventMode = "none";
    button.addChild(background);
    const icon = new Graphics();
    this.drawButtonIcon(icon, action, buttonX, buttonY + Math.floor(buttonHeight / 2) - 6, colors.accent);
    button.addChild(icon);
    const label = new Text({ text: displayLabel, style: { fontFamily: UI_FONT, fontSize: buttonWidth < 160 ? 11 : 12, fill: action.enabled ? COLOR_TEXT : COLOR_MUTED, align: "center", wordWrap: true, wordWrapWidth: Math.max(20, buttonWidth - 30), letterSpacing: 0.1, lineHeight: buttonWidth < 160 ? 14 : 15 } });
    label.anchor.set(0.5);
    label.x = buttonX + 24 + Math.max(20, buttonWidth - 30) / 2;
    label.y = buttonY + buttonHeight / 2;
    label.eventMode = "none";
    button.addChild(label);
    button.eventMode = action.enabled && this.enabledValue ? "static" : "none";
    button.hitArea = new Rectangle(buttonX, buttonY, buttonWidth, buttonHeight);
    if (action.enabled) button.on("pointertap", () => { void this.options.onCommand(action.command); });
    this.modalRoot.addChild(button);
    const control: TownModalSemanticControl = Object.freeze({
      testId: action.testId,
      ariaLabel,
      rect: Object.freeze({ x: buttonX, y: buttonY, width: buttonWidth, height: buttonHeight }),
      disabled: !action.enabled,
      command: action.command,
    });
    this.buttons.push({ node: button, control, baseDisabled: !action.enabled });
  }

  private applyEnabledState(): void {
    for (const button of this.buttons) {
      button.control = Object.freeze({ ...button.control, disabled: button.baseDisabled || !this.enabledValue });
      button.node.eventMode = !button.control.disabled ? "static" : "none";
    }
    this.controlsValue = Object.freeze(this.buttons.map((button) => button.control));
    this.modalRoot.eventMode = this.enabledValue && this.stateValue.kind !== "closed" ? "static" : "none";
    this.notifySemanticControlsChanged();
  }

  private notifySemanticControlsChanged(): void {
    if (!this.options.onSemanticControlsChanged || this.notifyingControls) return;
    this.notifyingControls = true;
    try {
      this.options.onSemanticControlsChanged();
    } finally {
      this.notifyingControls = false;
    }
  }

  private clearNodes(): void {
    this.buttons = [];
    this.modalRoot.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.controlsValue = Object.freeze([]);
  }
}
