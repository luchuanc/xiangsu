export type DialoguePanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly reasonKey: string }
  | { readonly kind: "error"; readonly errorKey: string }
  | { readonly kind: "success"; readonly dialogueId: string; readonly pageIndex: number };

/** 对话面板只保存显式状态；打开期间由 TownScene 冻结输入。 */
export class DialoguePanel {
  private stateValue: DialoguePanelState = Object.freeze({ kind: "empty", reasonKey: "dialogue.empty" });
  private openValue = false;

  public get state(): DialoguePanelState { return this.stateValue; }
  public get isOpen(): boolean { return this.openValue; }
  public open(dialogueId: string): void {
    if (dialogueId.length === 0) throw new RangeError("dialogueId 不能为空");
    this.openValue = true;
    this.stateValue = Object.freeze({ kind: "loading" });
  }
  public show(dialogueId: string, pageIndex = 0): void {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new RangeError("dialogue pageIndex 非法");
    this.openValue = true;
    this.stateValue = Object.freeze({ kind: "success", dialogueId, pageIndex });
  }
  public showEmpty(reasonKey: string): void { this.openValue = true; this.stateValue = Object.freeze({ kind: "empty", reasonKey }); }
  public showError(errorKey: string): void { this.openValue = true; this.stateValue = Object.freeze({ kind: "error", errorKey }); }
  public close(): void { this.openValue = false; }
}
