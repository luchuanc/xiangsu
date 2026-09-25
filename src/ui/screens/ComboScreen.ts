import type { ComboDefinition, ComboId, GameSaveV1 } from "../../content/contracts";
import { createDomainError, failure, type DomainResult } from "../../domain/common/DomainResult";
import { createComboPreview, type ComboMatchResult, type ComboPreviewResult } from "../../domain/combo/ComboPreview";
import { domainErrorView, MANAGEMENT_UI_METRICS, type ScreenErrorView, type ScreenLayoutView, type ScreenStatus } from "./GameMenu";

export type ComboSection = "active" | "reachable" | "codex";

export interface ComboEntryView {
  readonly comboId: ComboId;
  readonly definition: Readonly<ComboDefinition>;
  readonly active: boolean;
  readonly reachable: boolean;
  readonly missing: readonly { readonly tagId: string; readonly count: number; readonly source: string }[];
}

export interface ComboUnlockCard {
  readonly comboId: ComboId;
  readonly durationMs: 900;
  readonly firstAcquire: true;
}

export interface ComboScreenOptions {
  readonly currentSave: () => Readonly<GameSaveV1>;
  readonly comboDefinitions?: readonly ComboDefinition[];
  readonly match?: (save: Readonly<GameSaveV1>) => DomainResult<ComboMatchResult>;
  readonly persist?: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
  readonly audio?: { playSfx?(id: "sfx_combo_unlock"): void };
  readonly onStoreReplaced?: (save: Readonly<GameSaveV1>) => void;
}

export interface ComboScreenState {
  readonly status: ScreenStatus;
  readonly error: ScreenErrorView | null;
  readonly layout: ScreenLayoutView;
  readonly section: ComboSection;
  readonly entries: readonly ComboEntryView[];
  readonly preview: ComboPreviewResult | null;
  readonly unlockCard: ComboUnlockCard | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function missingFor(match: ComboMatchResult | null, comboId: string): readonly { readonly tagId: string; readonly count: number; readonly source: string }[] {
  const diagnostic = match?.diagnostics.find((value) => value.comboId === comboId);
  return Object.freeze((diagnostic?.missing ?? []).map((value) => ({ tagId: value.requirement.tagId, count: value.requirement.count - value.available, source: value.requirement.source })));
}

/** Combo 页只在成功保存后写入 discoveredComboIds，并对首获音效做 comboId 幂等。 */
export class ComboScreen {
  private readonly options: ComboScreenOptions;
  private sectionValue: ComboSection = "active";
  private statusValue: ScreenStatus = "success";
  private errorValue: ScreenErrorView | null = null;
  private matchValue: ComboMatchResult | null = null;
  private previewValue: ComboPreviewResult | null = null;
  private unlockCardValue: ComboUnlockCard | null = null;
  private unlockQueueValue: ComboId[] = [];
  private playedUnlocks = new Set<ComboId>();
  private commitInFlight: Promise<DomainResult<GameSaveV1>> | null = null;

  public constructor(options: ComboScreenOptions) {
    this.options = options;
  }

  public get state(): ComboScreenState {
    const activeIds = new Set(this.matchValue?.matchedComboIds ?? []);
    const definitions = this.options.comboDefinitions ?? [];
    const entries = definitions.map((definition) => Object.freeze({
      comboId: definition.id,
      definition,
      active: activeIds.has(definition.id),
      reachable: (this.matchValue?.diagnostics.find((value) => value.comboId === definition.id)?.missing.length ?? 0) > 0,
      missing: missingFor(this.matchValue, definition.id),
    }));
    const filtered = this.sectionValue === "active" ? entries.filter((entry) => entry.active)
      : this.sectionValue === "reachable" ? entries.filter((entry) => entry.reachable)
        : entries;
    const status = this.statusValue === "success" && filtered.length === 0 ? "empty" : this.statusValue;
    return Object.freeze({ status, error: this.errorValue, layout: MANAGEMENT_UI_METRICS, section: this.sectionValue, entries: Object.freeze(filtered), preview: this.previewValue, unlockCard: this.unlockCardValue });
  }

  public setSection(section: ComboSection): void {
    this.sectionValue = section;
    this.clearError();
  }

  public showLoading(): void {
    this.statusValue = "loading";
    this.errorValue = null;
  }

  public showEmpty(): void {
    this.statusValue = "empty";
    this.errorValue = null;
  }

  public showDisabled(reasonKey: string): void {
    this.statusValue = "disabled";
    this.errorValue = Object.freeze({ code: reasonKey, details: null });
  }

  public refresh(): DomainResult<ComboMatchResult> {
    if (!this.options.match) return this.fail(failure(createDomainError("INVALID_CONTENT", { path: "combo.match", issueKey: "getter_required" })));
    const result = this.options.match(this.options.currentSave());
    if (!result.ok) return this.fail(result);
    this.matchValue = result.value;
    this.clearError();
    return result;
  }

  public setPreview(before: ComboMatchResult, after: ComboMatchResult): DomainResult<ComboPreviewResult> {
    const result = createComboPreview(before, after);
    if (!result.ok) return this.fail(result);
    this.previewValue = result.value;
    this.clearError();
    return result;
  }

  public previewFromSave(before: ComboMatchResult, nextSave: Readonly<GameSaveV1>): DomainResult<ComboPreviewResult> {
    if (!this.options.match) return this.fail(failure(createDomainError("INVALID_CONTENT", { path: "combo.match", issueKey: "getter_required" })));
    const after = this.options.match(nextSave);
    if (!after.ok) return this.fail(after);
    return this.setPreview(before, after.value);
  }

  /** 提交方传入完整领域候选；页面不自行变更装备/队伍，只追加真正的新 Combo。 */
  public async commitDiscovery(nextSave: Readonly<GameSaveV1>, preview: ComboPreviewResult = this.previewValue ?? { scope: "party", addedIds: [], removedIds: [], unchangedIds: [] }): Promise<DomainResult<GameSaveV1>> {
    if (!this.options.persist) return this.fail(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
    if (this.commitInFlight !== null) return this.commitInFlight;
    const candidate = clone(nextSave);
    const discovered = new Set(candidate.world.discoveredComboIds);
    const newIds = preview.addedIds.filter((id) => !discovered.has(id));
    for (const id of newIds) discovered.add(id);
    candidate.world.discoveredComboIds = [...discovered];
    this.statusValue = "loading";
    this.errorValue = null;
    const operation = this.commit(candidate, newIds);
    this.commitInFlight = operation;
    void operation.then(() => { if (this.commitInFlight === operation) this.commitInFlight = null; });
    return operation;
  }

  private async commit(candidate: GameSaveV1, newIds: readonly ComboId[]): Promise<DomainResult<GameSaveV1>> {
    try {
      const result = await this.options.persist!(candidate.revision, candidate);
      if (!result.ok) return this.fail(result);
      this.options.onStoreReplaced?.(result.value);
      this.statusValue = "success";
      this.errorValue = null;
      for (const id of newIds) {
        if (this.playedUnlocks.has(id)) continue;
        this.playedUnlocks.add(id);
        this.unlockQueueValue.push(id);
        this.options.audio?.playSfx?.("sfx_combo_unlock");
      }
      this.startNextUnlockCard();
      return result;
    } catch {
      return this.fail(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
    }
  }

  public closeUnlockCard(): void {
    this.unlockCardValue = null;
    this.unlockQueueValue = [];
  }

  private startNextUnlockCard(): void {
    if (this.unlockCardValue !== null) return;
    const next = this.unlockQueueValue.shift();
    if (!next) return;
    this.unlockCardValue = Object.freeze({ comboId: next, durationMs: 900, firstAcquire: true });
    globalThis.setTimeout(() => {
      if (this.unlockCardValue?.comboId !== next) return;
      this.unlockCardValue = null;
      this.startNextUnlockCard();
    }, 900);
  }

  private clearError(): void {
    this.statusValue = "success";
    this.errorValue = null;
  }

  private fail<T>(result: DomainResult<T>): DomainResult<T> {
    if (!result.ok) { this.statusValue = "error"; this.errorValue = domainErrorView(result.error); }
    return result;
  }
}
