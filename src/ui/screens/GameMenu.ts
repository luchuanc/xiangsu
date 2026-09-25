import type { DomainErrorV1, DomainResult } from "../../domain/common/DomainResult";

/** 管理页沿用同一套移动端命中和间距门槛，避免每个页面各自缩小按钮。 */
export const MANAGEMENT_UI_METRICS = Object.freeze({
  minHitSizeCssPx: 48,
  minGapCssPx: 8,
});

export type ManagementPage = "inventory" | "party" | "skill" | "combo" | "settings";
export type ScreenStatus = "loading" | "empty" | "error" | "success" | "disabled";

export interface ScreenErrorView {
  readonly code: string;
  readonly details: unknown;
}

export interface ScreenLayoutView {
  readonly minHitSizeCssPx: 48;
  readonly minGapCssPx: 8;
}

export interface ScreenStateBase {
  readonly status: ScreenStatus;
  readonly error: ScreenErrorView | null;
  readonly layout: ScreenLayoutView;
}

export const MANAGEMENT_TABS: readonly ManagementPage[] = Object.freeze([
  "inventory",
  "party",
  "skill",
  "combo",
  "settings",
]);

export function domainErrorView(error: DomainErrorV1): ScreenErrorView {
  return Object.freeze({ code: error.code, details: structuredClone(error.details) });
}

export function resultErrorView<T>(result: DomainResult<T>): ScreenErrorView | null {
  return result.ok ? null : domainErrorView(result.error);
}

function layout(): ScreenLayoutView {
  return MANAGEMENT_UI_METRICS;
}

export interface GameMenuState extends ScreenStateBase {
  readonly open: boolean;
  readonly page: ManagementPage;
  readonly tabs: readonly ManagementPage[];
}

/**
 * 菜单只维护顶层页面和返回层级，不持有任何领域数据；具体页面的 draft
 * 由对应 screen 自己管理，防止关闭菜单时意外提交半成品操作。
 */
export class GameMenu {
  private openValue = false;
  private pageValue: ManagementPage = "inventory";
  private statusValue: ScreenStatus = "success";
  private errorValue: ScreenErrorView | null = null;

  public get state(): GameMenuState {
    return Object.freeze({
      open: this.openValue,
      page: this.pageValue,
      tabs: MANAGEMENT_TABS,
      status: this.statusValue,
      error: this.errorValue,
      layout: layout(),
    });
  }

  public open(page: ManagementPage = this.pageValue): void {
    this.pageValue = page;
    this.openValue = true;
    this.statusValue = "success";
    this.errorValue = null;
  }

  public close(): void {
    this.openValue = false;
  }

  public select(page: ManagementPage): void {
    if (!MANAGEMENT_TABS.includes(page)) throw new RangeError("管理页不存在");
    this.pageValue = page;
    this.errorValue = null;
  }

  public showLoading(): void {
    this.statusValue = "loading";
    this.errorValue = null;
  }

  public showEmpty(): void {
    this.statusValue = "empty";
    this.errorValue = null;
  }

  public showDisabled(error: DomainErrorV1): void {
    this.statusValue = "disabled";
    this.errorValue = domainErrorView(error);
  }

  public showError(error: DomainErrorV1): void {
    this.statusValue = "error";
    this.errorValue = domainErrorView(error);
  }
}
