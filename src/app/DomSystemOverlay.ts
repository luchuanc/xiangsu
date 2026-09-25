export type SystemOverlayState = "rotate" | "tooSmall" | "contextLost" | "fatal";

export interface SystemOverlayUpdate {
  state: SystemOverlayState | null;
  reason?: string;
}

const OVERLAY_COPY: Record<SystemOverlayState, string> = {
  rotate: "请旋转设备至横屏",
  tooSmall: "当前窗口过小，请横向放大窗口",
  contextLost: "图形资源恢复中，请稍候",
  fatal: "游戏暂时无法继续，请刷新重试",
};

/**
 * DOM 系统遮罩只负责稳定的系统状态展示，不承载业务错误或本地化兼容逻辑。
 */
export class DomSystemOverlay {
  public readonly element: HTMLDivElement;

  private destroyed = false;

  public constructor(private readonly root: HTMLElement) {
    this.element = root.ownerDocument.createElement("div");
    this.element.id = "system-overlay";
    this.element.className = "system-overlay";
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
    this.element.hidden = true;
    root.appendChild(this.element);
  }

  public update(update: SystemOverlayUpdate): void {
    if (this.destroyed) {
      return;
    }

    if (update.state === null) {
      this.element.hidden = true;
      this.element.removeAttribute("data-state");
      this.element.removeAttribute("data-reason");
      this.element.textContent = "";
      return;
    }

    this.element.hidden = false;
    this.element.dataset.state = update.state;
    if (update.reason) {
      this.element.dataset.reason = update.reason;
    } else {
      this.element.removeAttribute("data-reason");
    }
    this.element.textContent = OVERLAY_COPY[update.state];
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.element.remove();
  }
}
