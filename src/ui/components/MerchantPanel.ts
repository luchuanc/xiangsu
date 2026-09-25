import type { ShopOfferV1, BuybackEntryV1 } from "../../content/contracts";

export type MerchantPanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly reasonKey: string }
  | { readonly kind: "error"; readonly errorKey: string }
  | { readonly kind: "locked"; readonly reasonKey: string }
  | { readonly kind: "success"; readonly offers: readonly ShopOfferV1[]; readonly buybacks: readonly BuybackEntryV1[] };

export class MerchantPanel {
  private stateValue: MerchantPanelState = Object.freeze({ kind: "empty", reasonKey: "shop.empty" });
  public get state(): MerchantPanelState { return this.stateValue; }
  public showLoading(): void { this.stateValue = Object.freeze({ kind: "loading" }); }
  public showEmpty(reasonKey = "shop.empty"): void { this.stateValue = Object.freeze({ kind: "empty", reasonKey }); }
  public showError(errorKey: string): void { this.stateValue = Object.freeze({ kind: "error", errorKey }); }
  public showLocked(reasonKey: string): void { this.stateValue = Object.freeze({ kind: "locked", reasonKey }); }
  public showSuccess(offers: readonly ShopOfferV1[], buybacks: readonly BuybackEntryV1[] = []): void {
    this.stateValue = Object.freeze({ kind: "success", offers: structuredClone(offers), buybacks: structuredClone(buybacks) });
  }
}
