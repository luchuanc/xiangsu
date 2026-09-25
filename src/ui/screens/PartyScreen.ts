import type { CharacterId, GameSaveV1, PartyStateV1 } from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../../domain/common/DomainResult";
import type { PartyContentSource, PartyService, PartyValidationContext } from "../../domain/party/PartyService";
import type { RecruitmentEvaluation, RecruitmentService } from "../../domain/party/RecruitmentService";
import { domainErrorView, MANAGEMENT_UI_METRICS, type ScreenErrorView, type ScreenLayoutView, type ScreenStatus } from "./GameMenu";

type PartyServiceLike = Pick<PartyService, "validateParty"> & Partial<Pick<PartyService, "commit">>;
type RecruitmentServiceLike = Pick<RecruitmentService, "evaluate"> & Partial<Pick<RecruitmentService, "commit">>;

export interface PartyScreenOptions {
  readonly currentSave: () => Readonly<GameSaveV1>;
  readonly partyService: PartyServiceLike;
  readonly partyContent?: PartyContentSource;
  readonly protagonistCharacterId: CharacterId;
  readonly persist?: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
  readonly recruitmentService?: RecruitmentServiceLike;
  readonly onStoreReplaced?: (save: Readonly<GameSaveV1>) => void;
}

export interface PartyScreenState {
  readonly status: ScreenStatus;
  readonly error: ScreenErrorView | null;
  readonly layout: ScreenLayoutView;
  readonly draft: Readonly<PartyStateV1>;
  readonly saved: Readonly<PartyStateV1>;
  readonly selectedCharacterId: CharacterId | null;
  readonly recruitment: RecruitmentEvaluation | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function invalidParty(reason: "PROTAGONIST_REQUIRED" | "DUPLICATE_CHARACTER" | "UNKNOWN_CHARACTER" | "NOT_RECRUITED", characterId: CharacterId | null): DomainResult<never> {
  return failure(createDomainError("INVALID_PARTY", { reason, characterId }));
}

/** 队伍页使用四个固定槽位，draft 未经确认不会写入 GameStore。 */
export class PartyScreen {
  private readonly options: PartyScreenOptions;
  private draftValue: PartyStateV1;
  private savedValue: PartyStateV1;
  private selectedCharacterValue: CharacterId | null = null;
  private recruitmentValue: RecruitmentEvaluation | null = null;
  private statusValue: ScreenStatus = "success";
  private errorValue: ScreenErrorView | null = null;
  private commitInFlight: Promise<DomainResult<GameSaveV1>> | null = null;

  public constructor(options: PartyScreenOptions) {
    this.options = options;
    this.draftValue = clone(options.currentSave().party);
    this.savedValue = clone(this.draftValue);
  }

  public get state(): PartyScreenState {
    return Object.freeze({
      status: this.statusValue,
      error: this.errorValue,
      layout: MANAGEMENT_UI_METRICS,
      draft: Object.freeze(clone(this.draftValue)),
      saved: Object.freeze(clone(this.savedValue)),
      selectedCharacterId: this.selectedCharacterValue,
      recruitment: this.recruitmentValue,
    });
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

  public selectCharacter(characterId: CharacterId): DomainResult<true> {
    const progress = this.options.currentSave().characters[characterId];
    if (!progress) return this.fail(invalidParty("UNKNOWN_CHARACTER", characterId));
    this.selectedCharacterValue = characterId;
    this.clearError();
    return success(true);
  }

  public placeCharacter(characterId: CharacterId, slot: number): DomainResult<true> {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot > 3) return this.fail(invalid("party.slots", "slot_range"));
    const current = this.options.currentSave().characters[characterId];
    if (!current) return this.fail(invalidParty("UNKNOWN_CHARACTER", characterId));
    if (current.recruited !== true) return this.fail(invalidParty("NOT_RECRUITED", characterId));
    const existing = this.draftValue.slots.findIndex((value) => value === characterId);
    if (existing < 0 && this.draftValue.slots[slot] === this.options.protagonistCharacterId) {
      // 候补角色不能直接覆盖主角槽位，避免主角被草稿队伍移除。
      return this.fail(invalidParty("PROTAGONIST_REQUIRED", null));
    }
    const next = clone(this.draftValue);
    if (existing >= 0 && existing !== slot) {
      // 指定槽已有角色时与移动角色交换，既不产生重复，也不会把主角从队伍中移除。
      next.slots[existing] = next.slots[slot];
    }
    next.slots[slot] = characterId;
    this.draftValue = next;
    this.selectedCharacterValue = characterId;
    this.clearError();
    return success(true);
  }

  public clearSlot(slot: number): DomainResult<true> {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot > 3) return this.fail(invalid("party.slots", "slot_range"));
    if (this.draftValue.slots[slot] === this.options.protagonistCharacterId) return this.fail(invalidParty("PROTAGONIST_REQUIRED", null));
    const next = clone(this.draftValue);
    next.slots[slot] = null;
    this.draftValue = next;
    this.clearError();
    return success(true);
  }

  public validateDraft(): DomainResult<PartyStateV1> {
    const save = this.options.currentSave();
    const context: PartyValidationContext = {
      protagonistCharacterId: this.options.protagonistCharacterId,
      characters: save.characters,
    };
    const result = this.options.partyService.validateParty(this.draftValue, context);
    if (!result.ok) this.setError(result.error);
    else this.clearError();
    return result;
  }

  public cancel(): void {
    this.draftValue = clone(this.options.currentSave().party);
    this.savedValue = clone(this.draftValue);
    this.selectedCharacterValue = null;
    this.clearError();
  }

  public async confirm(): Promise<DomainResult<GameSaveV1>> {
    if (this.commitInFlight !== null) return this.commitInFlight;
    const valid = this.validateDraft();
    if (!valid.ok) return valid as DomainResult<GameSaveV1>;
    const save = clone(this.options.currentSave());
    if (!this.options.persist) return this.fail(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
    this.statusValue = "loading";
    this.errorValue = null;
    const operation = this.commit(save, valid.value);
    this.commitInFlight = operation;
    void operation.then(() => { if (this.commitInFlight === operation) this.commitInFlight = null; });
    return operation;
  }

  private async commit(save: GameSaveV1, party: PartyStateV1): Promise<DomainResult<GameSaveV1>> {
    try {
      let result: DomainResult<GameSaveV1>;
      if (this.options.partyService.commit) {
        result = await this.options.partyService.commit(save, party, {
          expectedRevision: save.revision,
          protagonistCharacterId: this.options.protagonistCharacterId,
          save: this.options.persist!,
        });
      } else {
        const next = clone(save);
        next.party = clone(party);
        result = await this.options.persist!(save.revision, next);
      }
      if (!result.ok) {
        this.statusValue = "error";
        this.errorValue = domainErrorView(result.error);
        return result;
      }
      this.savedValue = clone(result.value.party);
      this.draftValue = clone(result.value.party);
      this.statusValue = "success";
      this.errorValue = null;
      this.options.onStoreReplaced?.(result.value);
      return result;
    } catch {
      return this.fail(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
    }
  }

  public evaluateRecruitment(recruitmentId: string): DomainResult<RecruitmentEvaluation> {
    if (!this.options.recruitmentService) return this.fail(invalid("recruitmentService", "required"));
    const result = this.options.recruitmentService.evaluate(recruitmentId, this.options.currentSave());
    if (!result.ok) this.setError(result.error);
    else { this.recruitmentValue = result.value; this.clearError(); }
    return result;
  }

  public async confirmRecruitment(recruitmentId: string): Promise<DomainResult<GameSaveV1>> {
    // 确认只能消费当前页面刚完成的评估；未评估或切换候选后不得复用旧结果扣款。
    if (this.recruitmentValue?.recruitmentId !== recruitmentId) {
      return this.fail(failure(createDomainError("RECRUITMENT_LOCKED", { recruitmentId })));
    }
    if (!this.options.recruitmentService?.commit || !this.options.persist) return this.fail(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
    if (this.commitInFlight !== null) return this.commitInFlight;
    const save = clone(this.options.currentSave());
    const operation = this.commitRecruitment(recruitmentId, save);
    this.commitInFlight = operation;
    void operation.then(() => { if (this.commitInFlight === operation) this.commitInFlight = null; });
    return operation;
  }

  private async commitRecruitment(recruitmentId: string, save: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    try {
      const result = await this.options.recruitmentService!.commit!(recruitmentId, save, { expectedRevision: save.revision, save: this.options.persist! });
      if (!result.ok) { this.statusValue = "error"; this.errorValue = domainErrorView(result.error); return result; }
      this.statusValue = "success";
      this.errorValue = null;
      this.recruitmentValue = null;
      this.options.onStoreReplaced?.(result.value);
      return result;
    } catch {
      return this.fail(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
    }
  }

  private clearError(): void {
    this.statusValue = "success";
    this.errorValue = null;
  }

  private setError(error: { code: string; details: unknown }): void {
    this.statusValue = "error";
    this.errorValue = Object.freeze({ code: error.code, details: structuredClone(error.details) });
  }

  private fail<T>(result: DomainResult<T>): DomainResult<T> {
    if (!result.ok) this.setError(result.error);
    return result;
  }
}
