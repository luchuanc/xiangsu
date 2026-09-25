import type { DomainErrorV1 } from "../../domain/common/DomainResult";
import { frozenErrorTemplateKeys, localeTokenSpec, zhCN } from "../../content/locales/zh-CN";

export interface ErrorOverlayView {
  readonly visible: boolean;
  readonly message: string;
  readonly templateKey: string | null;
  readonly canRetry: boolean;
}

export interface ErrorOverlayOptions {
  readonly onRetry?: () => void | Promise<void>;
  readonly onViewReason?: () => void;
}

const retryableCodes = new Set<DomainErrorV1["code"]>([
  "ASSET_LOAD_FAILED", "SAVE_FAILED", "STALE_REVISION", "STALE_BATTLE_REVISION",
]);

function reasonKey(error: DomainErrorV1): string {
  const details = error.details;
  if (details !== null && typeof details === "object" && "reason" in details && typeof details.reason === "string") {
    const candidate = `error.${error.code}.${details.reason}`;
    if (frozenErrorTemplateKeys.includes(candidate as (typeof frozenErrorTemplateKeys)[number])) return candidate;
  }
  const plain = `error.${error.code}`;
  return frozenErrorTemplateKeys.includes(plain as (typeof frozenErrorTemplateKeys)[number]) ? plain : "error.INVALID_CONTENT";
}

function renderTemplate(template: string, error: DomainErrorV1, key: string): string {
  const details = error.details;
  const allowed = new Set(localeTokenSpec[key] ?? []);
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_match, token: string) => {
    if (!allowed.has(token) || details === null || typeof details !== "object") return "";
    const value = (details as Record<string, unknown>)[token];
    return typeof value === "number" || typeof value === "string" ? String(value) : "";
  });
}

export function domainErrorMessage(error: DomainErrorV1): ErrorOverlayView {
  const templateKey = reasonKey(error);
  const template = zhCN[templateKey] ?? zhCN["error.INVALID_CONTENT"] ?? "当前操作无法继续。";
  return Object.freeze({
    visible: true,
    message: renderTemplate(template, error, templateKey),
    templateKey,
    canRetry: retryableCodes.has(error.code),
  });
}

/** 业务错误遮罩只展示本地化模板，不把 raw code、内部 ID 或 details JSON 直接展示给玩家。 */
export class ErrorOverlay {
  public readonly element: HTMLDivElement;
  private viewValue: ErrorOverlayView = Object.freeze({ visible: false, message: "", templateKey: null, canRetry: false });
  private options: ErrorOverlayOptions = {};
  private destroyed = false;

  public constructor(private readonly root: HTMLElement) {
    this.element = root.ownerDocument.createElement("div");
    this.element.className = "error-overlay";
    this.element.setAttribute("role", "alert");
    this.element.hidden = true;
    root.appendChild(this.element);
  }

  public get view(): ErrorOverlayView {
    return this.viewValue;
  }

  public show(error: DomainErrorV1, options: ErrorOverlayOptions = {}): void {
    if (this.destroyed) return;
    this.options = options;
    this.viewValue = domainErrorMessage(error);
    this.element.hidden = false;
    this.element.textContent = this.viewValue.message;
    this.element.dataset.template = this.viewValue.templateKey ?? "";
  }

  public async retry(): Promise<void> {
    if (!this.viewValue.canRetry) return;
    await this.options.onRetry?.();
  }

  public viewReason(): void {
    this.options.onViewReason?.();
  }

  public hide(): void {
    if (this.destroyed) return;
    this.viewValue = Object.freeze({ visible: false, message: "", templateKey: null, canRetry: false });
    this.element.hidden = true;
    this.element.textContent = "";
    this.element.removeAttribute("data-template");
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.element.remove();
  }
}

