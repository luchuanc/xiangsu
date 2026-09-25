import { createDomainError, failure, success, type DomainResult } from "../../domain/common/DomainResult";
import { domainErrorView, MANAGEMENT_UI_METRICS, type ScreenErrorView, type ScreenLayoutView, type ScreenStatus } from "./GameMenu";

export type GateDiagnosisKind = "enrage_output" | "pre_enrage_knockout" | "weakness_underused" | "insufficient_data";

export interface GateDiagnosisInput {
  readonly outcome: "defeat" | "victory";
  readonly bossEnragedBeforeDefeat: boolean;
  readonly knockoutsBeforeEnrage: number;
  readonly directDamage: number;
  readonly weaknessDamage: number;
}

export interface GateDiagnosisAction {
  readonly id: "replay_floor" | "blacksmith" | "skill_mentor_combo";
  readonly labelKey: "gate.replay_floor" | "gate.goto_blacksmith" | "gate.goto_skill_mentor_combo";
}

export interface GateDiagnosis {
  readonly kind: GateDiagnosisKind;
  readonly titleKey: "gate.enrage_output" | "gate.pre_enrage_knockout" | "gate.weakness_underused" | "gate.insufficient_data";
  readonly directDamage: number | null;
  readonly weaknessDamage: number | null;
  readonly weaknessRatioBps: number | null;
  readonly actions: readonly GateDiagnosisAction[];
}

export type GateDiagnosisState = {
  readonly status: ScreenStatus;
  readonly error: ScreenErrorView | null;
  readonly layout: ScreenLayoutView;
  readonly diagnosis: GateDiagnosis | null;
};

const ACTIONS: readonly GateDiagnosisAction[] = Object.freeze([
  Object.freeze({ id: "replay_floor", labelKey: "gate.replay_floor" }),
  Object.freeze({ id: "blacksmith", labelKey: "gate.goto_blacksmith" }),
  Object.freeze({ id: "skill_mentor_combo", labelKey: "gate.goto_skill_mentor_combo" }),
]);

function validNonNegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * 诊断只读取本场统计并按冻结优先级给解释，不从装备 ID 或技能名猜测构筑。
 */
export function diagnoseGate(input: GateDiagnosisInput): DomainResult<GateDiagnosis> {
  if (!input || typeof input !== "object") return failure(createDomainError("INVALID_CONTENT", { path: "gateDiagnosis", issueKey: "not_object" }));
  if (input.outcome !== "defeat" && input.outcome !== "victory") return failure(createDomainError("INVALID_CONTENT", { path: "gateDiagnosis.outcome", issueKey: "enum" }));
  if (![input.knockoutsBeforeEnrage, input.directDamage, input.weaknessDamage].every(validNonNegative)) {
    return failure(createDomainError("INVALID_CONTENT", { path: "gateDiagnosis.metrics", issueKey: "non_negative_integer" }));
  }
  const weaknessRatioBps = input.directDamage > 0
    ? Math.floor((input.weaknessDamage * 10_000) / input.directDamage)
    : null;
  let kind: GateDiagnosisKind = "insufficient_data";
  let titleKey: GateDiagnosis["titleKey"] = "gate.insufficient_data";
  // 优先级固定为：狂暴后败 -> 狂暴前倒地 -> 弱点直接伤害不足 20%。
  if (input.outcome === "defeat" && input.bossEnragedBeforeDefeat) {
    kind = "enrage_output";
    titleKey = "gate.enrage_output";
  } else if (input.outcome === "defeat" && input.knockoutsBeforeEnrage > 0) {
    kind = "pre_enrage_knockout";
    titleKey = "gate.pre_enrage_knockout";
  } else if (input.outcome === "defeat" && weaknessRatioBps !== null && weaknessRatioBps < 2_000) {
    kind = "weakness_underused";
    titleKey = "gate.weakness_underused";
  }
  return success(Object.freeze({
    kind,
    titleKey,
    directDamage: input.directDamage,
    weaknessDamage: input.weaknessDamage,
    weaknessRatioBps,
    actions: ACTIONS,
  }));
}

export class GateDiagnosisPanel {
  private statusValue: ScreenStatus = "empty";
  private errorValue: ScreenErrorView | null = null;
  private diagnosisValue: GateDiagnosis | null = null;

  public get state(): GateDiagnosisState {
    return Object.freeze({ status: this.statusValue, error: this.errorValue, layout: MANAGEMENT_UI_METRICS, diagnosis: this.diagnosisValue });
  }

  public showLoading(): void {
    this.statusValue = "loading";
    this.errorValue = null;
    this.diagnosisValue = null;
  }

  public show(input: GateDiagnosisInput): DomainResult<GateDiagnosis> {
    const result = diagnoseGate(input);
    if (!result.ok) {
      this.statusValue = "error";
      this.errorValue = domainErrorView(result.error);
      this.diagnosisValue = null;
      return result;
    }
    this.statusValue = "success";
    this.errorValue = null;
    this.diagnosisValue = result.value;
    return result;
  }

  public showError(errorKey = "gate.diagnosis.error"): void {
    this.statusValue = "error";
    this.errorValue = Object.freeze({ code: errorKey, details: null });
    this.diagnosisValue = null;
  }

  public clear(): void {
    this.statusValue = "empty";
    this.errorValue = null;
    this.diagnosisValue = null;
  }
}
