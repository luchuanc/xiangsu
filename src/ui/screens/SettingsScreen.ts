import type { GameSaveV1, GameSettingsV1 } from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../../domain/common/DomainResult";
import { domainErrorView, MANAGEMENT_UI_METRICS, type ScreenErrorView, type ScreenLayoutView, type ScreenStatus } from "./GameMenu";

export type SettingsKey = keyof GameSettingsV1;

export interface SettingsScreenOptions {
  readonly currentSave: () => Readonly<GameSaveV1>;
  readonly persist?: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
  readonly onStoreReplaced?: (save: Readonly<GameSaveV1>) => void;
}

export interface SettingsScreenState {
  readonly status: ScreenStatus;
  readonly error: ScreenErrorView | null;
  readonly layout: ScreenLayoutView;
  readonly draft: Readonly<GameSettingsV1>;
  readonly saved: Readonly<GameSettingsV1>;
  readonly dirty: boolean;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function settingsFrom(save: Readonly<GameSaveV1>): GameSettingsV1 {
  return clone(save.settings);
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function settingValueValid(key: SettingsKey, value: unknown): boolean {
  if (key === "qualityPreset") return value === "battery" || value === "standard" || value === "high";
  if (key === "battleAnimationSpeed") return value === 1 || value === 2;
  if (key === "musicVolume" || key === "sfxVolume") return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100;
  return typeof value === "boolean";
}

/** 设置页只保存显式 GameSettingsV1 字段，两个 reduced 开关不会互相覆盖。 */
export class SettingsScreen {
  private readonly options: SettingsScreenOptions;
  private draftValue: GameSettingsV1;
  private savedValue: GameSettingsV1;
  private statusValue: ScreenStatus = "success";
  private errorValue: ScreenErrorView | null = null;
  private commitInFlight: Promise<DomainResult<GameSaveV1>> | null = null;

  public constructor(options: SettingsScreenOptions) {
    this.options = options;
    this.draftValue = settingsFrom(options.currentSave());
    this.savedValue = clone(this.draftValue);
  }

  public get state(): SettingsScreenState {
    return Object.freeze({
      status: this.statusValue,
      error: this.errorValue,
      layout: MANAGEMENT_UI_METRICS,
      draft: Object.freeze(clone(this.draftValue)),
      saved: Object.freeze(clone(this.savedValue)),
      dirty: JSON.stringify(this.draftValue) !== JSON.stringify(this.savedValue),
    });
  }

  public showLoading(): void {
    this.statusValue = "loading";
    this.errorValue = null;
  }

  public showDisabled(reasonKey: string): void {
    this.statusValue = "disabled";
    this.errorValue = Object.freeze({ code: reasonKey, details: null });
  }

  public set<K extends SettingsKey>(key: K, value: GameSettingsV1[K]): DomainResult<true> {
    if (!settingValueValid(key, value)) return invalid(`settings.${key}`, "value_range");
    this.draftValue[key] = value;
    this.statusValue = "success";
    this.errorValue = null;
    return success(true);
  }

  public cancel(): void {
    this.draftValue = clone(this.savedValue);
    this.statusValue = "success";
    this.errorValue = null;
  }

  public async confirm(): Promise<DomainResult<GameSaveV1>> {
    if (this.commitInFlight !== null) return this.commitInFlight;
    if (JSON.stringify(this.draftValue) === JSON.stringify(this.savedValue)) return success(clone(this.options.currentSave()));
    if (!this.options.persist) {
      const result = failure(createDomainError("SAVE_FAILED", { operation: "save" }));
      this.statusValue = "error";
      this.errorValue = domainErrorView(result.error);
      return result;
    }
    const save = clone(this.options.currentSave()) as GameSaveV1;
    save.settings = clone(this.draftValue);
    this.statusValue = "loading";
    this.errorValue = null;
    const operation = this.commit(save);
    this.commitInFlight = operation;
    void operation.then(() => {
      if (this.commitInFlight === operation) this.commitInFlight = null;
    });
    return operation;
  }

  private async commit(save: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    try {
      const result = await this.options.persist!(save.revision, save);
      if (!result.ok) {
        this.statusValue = "error";
        this.errorValue = domainErrorView(result.error);
        return result;
      }
      this.savedValue = clone(result.value.settings);
      this.draftValue = clone(result.value.settings);
      this.statusValue = "success";
      this.errorValue = null;
      this.options.onStoreReplaced?.(result.value);
      return result;
    } catch {
      const result = failure(createDomainError("SAVE_FAILED", { operation: "save" }));
      this.statusValue = "error";
      this.errorValue = domainErrorView(result.error);
      return result;
    }
  }
}
