export type BestiaryEntry = { readonly enemyId: string; readonly discovered: boolean };
export type BestiaryPanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly reasonKey: string }
  | { readonly kind: "error"; readonly errorKey: string }
  | { readonly kind: "success"; readonly entries: readonly BestiaryEntry[] };

export class BestiaryPanel {
  private stateValue: BestiaryPanelState = Object.freeze({ kind: "empty", reasonKey: "bestiary.empty" });
  public get state(): BestiaryPanelState { return this.stateValue; }
  public showLoading(): void { this.stateValue = Object.freeze({ kind: "loading" }); }
  public showError(errorKey: string): void { this.stateValue = Object.freeze({ kind: "error", errorKey }); }
  public show(entries: readonly BestiaryEntry[]): void { this.stateValue = Object.freeze({ kind: "success", entries: Object.freeze(structuredClone(entries)) }); }
}
