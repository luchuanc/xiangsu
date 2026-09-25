/**
 * Combo 运行时安全门。
 *
 * check() 只读取当前记账，commit()/accept() 才会写入计数；这样触发器
 * 可以在正式入队前完成全部校验，循环、重复和预算拒绝不会留下副作用。
 */
import type { ComboDefinition } from "../../content/contracts";

export const MAX_COMBO_CHAIN_DEPTH = 3;
export const DEFAULT_MAX_DERIVED_DAMAGE_PER_UNIT_PER_ROOT = 8;
export const DEFAULT_MAX_DERIVED_EVENTS_PER_ROOT = 32;

export type ComboGuardReason =
  | "CHAIN_DEPTH"
  | "DUPLICATE_KEY"
  | "ROOT_BUDGET"
  | "ROUND_BUDGET"
  | "BATTLE_BUDGET"
  | "UNIT_DAMAGE_BUDGET"
  | "GLOBAL_EVENT_BUDGET"
  | "INVALID_INPUT";

export interface ComboGuardInput {
  readonly combo: Readonly<ComboDefinition>;
  readonly rootActionId: string;
  readonly ownerUnitId: string;
  readonly chainDepth: number;
  /** 本次事件所在轮次，仅用于诊断；跨轮由 resetRound() 显式切换。 */
  readonly round?: number;
  /** 本次 Combo 将产生的派生伤害数。 */
  readonly derivedDamageCount?: number;
  /** 本次 Combo 将产生的派生事件数。 */
  readonly derivedEventCount?: number;
}

export interface ComboGuardAcceptance {
  readonly key: string;
  readonly comboId: string;
  readonly scope: "personal" | "party";
  readonly ownerUnitId: string;
  readonly rootActionId: string;
  readonly chainDepth: number;
  readonly derivedDamageCount: number;
  readonly derivedEventCount: number;
}

export interface ComboGuardDiagnostic {
  readonly reason: ComboGuardReason;
  readonly comboId: string;
  readonly key: string;
  readonly observed: number;
  readonly limit: number;
  readonly rootActionId: string;
  readonly ownerUnitId: string;
  readonly round: number | null;
}

export type ComboGuardResult =
  | { readonly ok: true; readonly value: ComboGuardAcceptance }
  | { readonly ok: false; readonly error: ComboGuardDiagnostic };

export interface ComboRuntimeGuardOptions {
  readonly maxChainDepth?: number;
  readonly maxDerivedDamagePerUnitPerRoot?: number;
  readonly maxDerivedEventsPerRoot?: number;
}

export interface ComboRuntimeGuardSnapshot {
  readonly firedKeys: readonly string[];
  readonly rootCounts: Readonly<Record<string, number>>;
  readonly roundCounts: Readonly<Record<string, number>>;
  readonly battleCounts: Readonly<Record<string, number>>;
  readonly unitDamageCounts: Readonly<Record<string, number>>;
  readonly eventCounts: Readonly<Record<string, number>>;
}

function validInteger(value: unknown, min = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min;
}

function asRecord(values: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [key, value] of values) result[key] = value;
  return Object.freeze(result);
}

function mapKey(combo: Readonly<ComboDefinition>, rootActionId: string, ownerUnitId: string): string {
  return combo.scope === "party"
    ? `${rootActionId}:party:${combo.id}`
    : `${rootActionId}:${ownerUnitId}:${combo.id}`;
}

function budgetKey(combo: Readonly<ComboDefinition>, ownerUnitId: string): string {
  return combo.scope === "party" ? `party:${combo.id}` : `${ownerUnitId}:${combo.id}`;
}

export class ComboRuntimeGuard {
  private readonly maxChainDepth: number;
  private readonly maxDerivedDamagePerUnitPerRoot: number;
  private readonly maxDerivedEventsPerRoot: number;
  private readonly firedKeys = new Set<string>();
  private readonly rootCounts = new Map<string, number>();
  private readonly roundCounts = new Map<string, number>();
  private readonly battleCounts = new Map<string, number>();
  private readonly unitDamageCounts = new Map<string, number>();
  private readonly eventCounts = new Map<string, number>();

  public constructor(options: ComboRuntimeGuardOptions = {}) {
    this.maxChainDepth = options.maxChainDepth ?? MAX_COMBO_CHAIN_DEPTH;
    this.maxDerivedDamagePerUnitPerRoot = options.maxDerivedDamagePerUnitPerRoot ?? DEFAULT_MAX_DERIVED_DAMAGE_PER_UNIT_PER_ROOT;
    this.maxDerivedEventsPerRoot = options.maxDerivedEventsPerRoot ?? DEFAULT_MAX_DERIVED_EVENTS_PER_ROOT;
    if (!validInteger(this.maxChainDepth) || !validInteger(this.maxDerivedDamagePerUnitPerRoot) || !validInteger(this.maxDerivedEventsPerRoot)) {
      throw new RangeError("Combo 运行时预算必须是非负整数");
    }
  }

  private diagnostic(
    input: ComboGuardInput,
    key: string,
    reason: ComboGuardReason,
    observed: number,
    limit: number,
  ): ComboGuardResult {
    return {
      ok: false,
      error: {
        reason,
        comboId: input.combo?.id ?? "",
        key,
        observed,
        limit,
        rootActionId: input.rootActionId,
        ownerUnitId: input.ownerUnitId,
        round: input.round ?? null,
      },
    };
  }

  private validateInput(input: ComboGuardInput): ComboGuardResult | null {
    if (!input || typeof input !== "object" || !input.combo || typeof input.combo !== "object") {
      return { ok: false, error: { reason: "INVALID_INPUT", comboId: "", key: "", observed: 0, limit: 0, rootActionId: "", ownerUnitId: "", round: null } };
    }
    const key = mapKey(input.combo, input.rootActionId, input.ownerUnitId);
    if (typeof input.rootActionId !== "string" || input.rootActionId.length === 0 || typeof input.ownerUnitId !== "string" || input.ownerUnitId.length === 0) {
      return this.diagnostic(input, key, "INVALID_INPUT", 0, 1);
    }
    if (!validInteger(input.chainDepth)) return this.diagnostic(input, key, "INVALID_INPUT", 0, 1);
    const damage = input.derivedDamageCount ?? 0;
    const events = input.derivedEventCount ?? 0;
    if (!validInteger(damage) || !validInteger(events)) return this.diagnostic(input, key, "INVALID_INPUT", 0, 1);
    if (!validInteger(input.combo.budget.maxPerRootAction) || !validInteger(input.combo.budget.maxPerRound) || !validInteger(input.combo.budget.maxPerBattle)) {
      return this.diagnostic(input, key, "INVALID_INPUT", 0, 1);
    }
    if (input.round !== undefined && !validInteger(input.round, 1)) return this.diagnostic(input, key, "INVALID_INPUT", 0, 1);
    return null;
  }

  /** 纯检查：不会增加 firedKeys 或任何预算计数。 */
  public check(input: ComboGuardInput): ComboGuardResult {
    const invalidResult = this.validateInput(input);
    if (invalidResult) return invalidResult;
    const key = mapKey(input.combo, input.rootActionId, input.ownerUnitId);
    const identity = budgetKey(input.combo, input.ownerUnitId);
    const damage = input.derivedDamageCount ?? 0;
    const events = input.derivedEventCount ?? 0;
    if (input.chainDepth > this.maxChainDepth) return this.diagnostic(input, key, "CHAIN_DEPTH", input.chainDepth, this.maxChainDepth);
    if (this.firedKeys.has(key)) return this.diagnostic(input, key, "DUPLICATE_KEY", 1, 1);
    const usedRoot = this.rootCounts.get(key) ?? 0;
    if (usedRoot + 1 > input.combo.budget.maxPerRootAction) return this.diagnostic(input, key, "ROOT_BUDGET", usedRoot, input.combo.budget.maxPerRootAction);
    const usedRound = this.roundCounts.get(identity) ?? 0;
    if (usedRound + 1 > input.combo.budget.maxPerRound) return this.diagnostic(input, key, "ROUND_BUDGET", usedRound, input.combo.budget.maxPerRound);
    const usedBattle = this.battleCounts.get(identity) ?? 0;
    if (usedBattle + 1 > input.combo.budget.maxPerBattle) return this.diagnostic(input, key, "BATTLE_BUDGET", usedBattle, input.combo.budget.maxPerBattle);
    const unitKey = `${input.rootActionId}:${input.ownerUnitId}`;
    const usedDamage = this.unitDamageCounts.get(unitKey) ?? 0;
    if (usedDamage + damage > this.maxDerivedDamagePerUnitPerRoot) {
      return this.diagnostic(input, key, "UNIT_DAMAGE_BUDGET", usedDamage + damage, this.maxDerivedDamagePerUnitPerRoot);
    }
    const usedEvents = this.eventCounts.get(input.rootActionId) ?? 0;
    if (usedEvents + events > this.maxDerivedEventsPerRoot) {
      return this.diagnostic(input, key, "GLOBAL_EVENT_BUDGET", usedEvents + events, this.maxDerivedEventsPerRoot);
    }
    return {
      ok: true,
      value: Object.freeze({
        key,
        comboId: input.combo.id,
        scope: input.combo.scope,
        ownerUnitId: input.ownerUnitId,
        rootActionId: input.rootActionId,
        chainDepth: input.chainDepth,
        derivedDamageCount: damage,
        derivedEventCount: events,
      }),
    };
  }

  /** 只有显式 commit 才写入本根、轮次、战斗和通用派生预算。 */
  public commit(input: ComboGuardInput): ComboGuardResult {
    const checked = this.check(input);
    if (!checked.ok) return checked;
    const { value } = checked;
    const identity = budgetKey(input.combo, input.ownerUnitId);
    this.firedKeys.add(value.key);
    this.rootCounts.set(value.key, (this.rootCounts.get(value.key) ?? 0) + 1);
    this.roundCounts.set(identity, (this.roundCounts.get(identity) ?? 0) + 1);
    this.battleCounts.set(identity, (this.battleCounts.get(identity) ?? 0) + 1);
    if (value.derivedDamageCount > 0) {
      const unitKey = `${value.rootActionId}:${value.ownerUnitId}`;
      this.unitDamageCounts.set(unitKey, (this.unitDamageCounts.get(unitKey) ?? 0) + value.derivedDamageCount);
    }
    if (value.derivedEventCount > 0) this.eventCounts.set(value.rootActionId, (this.eventCounts.get(value.rootActionId) ?? 0) + value.derivedEventCount);
    return checked;
  }

  /** accept 是 commit 的显式语义入口，仍然只在成功时记账。 */
  public accept(input: ComboGuardInput): ComboGuardResult {
    return this.commit(input);
  }

  public resetRound(): void {
    this.roundCounts.clear();
  }

  public resetBattle(): void {
    this.firedKeys.clear();
    this.rootCounts.clear();
    this.roundCounts.clear();
    this.battleCounts.clear();
    this.unitDamageCounts.clear();
    this.eventCounts.clear();
  }

  public snapshot(): ComboRuntimeGuardSnapshot {
    return Object.freeze({
      firedKeys: Object.freeze([...this.firedKeys].sort()),
      rootCounts: asRecord(this.rootCounts),
      roundCounts: asRecord(this.roundCounts),
      battleCounts: asRecord(this.battleCounts),
      unitDamageCounts: asRecord(this.unitDamageCounts),
      eventCounts: asRecord(this.eventCounts),
    });
  }
}
