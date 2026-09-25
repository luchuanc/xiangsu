/**
 * 战斗派生触发队列。
 *
 * 候选在入队前完成一次性快照和整组校验；队列只负责 FIFO、预算门禁与
 * PendingBattleEvent 固化，实际数值应用由调用方传入的 apply 回调完成。
 */
import type {
  BattleActionDefinitionIdV1,
  BattleDomainEventV1,
  BattleEventBaseV1,
  ComboDefinition,
  EffectSpec,
  PendingBattleEventV1,
  TriggerSkillKindV1,
  TriggerSourceV1,
  TriggerBudget,
} from "../../content/contracts";
import { SeededRng } from "../common/SeededRng";
import { ComboRuntimeGuard, DEFAULT_MAX_DERIVED_DAMAGE_PER_UNIT_PER_ROOT, DEFAULT_MAX_DERIVED_EVENTS_PER_ROOT } from "../combo/ComboRuntimeGuard";

export const MAX_DERIVED_DAMAGE_PER_UNIT_PER_ROOT = DEFAULT_MAX_DERIVED_DAMAGE_PER_UNIT_PER_ROOT;
export const MAX_DERIVED_EVENTS_PER_ROOT = DEFAULT_MAX_DERIVED_EVENTS_PER_ROOT;

export type TriggerCandidateKind = "equipmentAffix" | "skillAffix" | "personalCombo" | "partyCombo" | "status";
export type TriggerRejectReason = "CHAIN_DEPTH" | "ROOT_BUDGET" | "ROUND_BUDGET" | "BATTLE_BUDGET" | "UNIT_DAMAGE_BUDGET" | "GLOBAL_EVENT_BUDGET" | "SOURCE_INVALID" | "TARGET_INVALID" | "CHANCE_FAILED";

export interface TriggerCandidateOrder {
  readonly sourceKind: TriggerCandidateKind;
  readonly ownerFaction: "party" | "enemy";
  readonly ownerSlot: number;
  readonly equipmentSlot?: "weapon" | "helmet" | "armor" | "gloves" | "boots" | "accessory";
  readonly sourceRollIndex?: number | "abyss";
  readonly definitionId: string;
}

export interface TriggerValidation {
  readonly ok: boolean;
  readonly reason?: "SOURCE_INVALID" | "TARGET_INVALID";
}

export interface TriggerCandidate {
  readonly kind: TriggerCandidateKind;
  readonly sourceKey: string;
  readonly sourceUnitId: string;
  readonly ownerUnitId: string;
  readonly ownerFaction: "party" | "enemy";
  readonly ownerSlot: number;
  readonly sourceOrder: TriggerCandidateOrder;
  readonly triggerSource: TriggerSourceV1;
  readonly effects: readonly EffectSpec[];
  readonly rootActionId: string;
  readonly rootActionDefinitionId: BattleActionDefinitionIdV1;
  readonly chainDepth: number;
  readonly targetUnitIds?: readonly string[];
  readonly visualSkillId: string | null;
  readonly contextSkillKind: TriggerSkillKindV1 | null;
  readonly chanceBps?: number;
  readonly budget?: Readonly<TriggerBudget>;
  readonly combo?: Readonly<ComboDefinition>;
  readonly sourcePeriodic?: boolean;
  readonly validate?: () => TriggerValidation;
  readonly consume?: () => readonly BattleDomainEventV1[];
  readonly hasLegalTarget?: (effect: EffectSpec) => boolean;
  readonly isSourceAlive?: () => boolean;
}

export interface TriggerQueueOptions {
  readonly battleId: string;
  readonly round: number;
  readonly rootActionId: string;
  readonly rootActionDefinitionId: BattleActionDefinitionIdV1;
  readonly rng: SeededRng;
  readonly nextEventId: () => string;
  readonly guard?: ComboRuntimeGuard;
  readonly roundTriggerCounts?: Readonly<Record<string, number>>;
  readonly battleTriggerCounts?: Readonly<Record<string, number>>;
  readonly maxDerivedDamagePerUnitPerRoot?: number;
  readonly maxDerivedEventsPerRoot?: number;
}

export interface TriggerRejection {
  readonly sourceKey: string;
  readonly reason: TriggerRejectReason;
  readonly consumedRng: boolean;
  readonly event: BattleDomainEventV1;
}

export interface EnqueueCandidatesResult {
  readonly accepted: number;
  readonly rejected: readonly TriggerRejection[];
}

export interface TriggerApplicationSuccess {
  readonly ok: true;
  readonly events: readonly BattleDomainEventV1[];
}

export interface TriggerApplicationFailure {
  readonly ok: false;
  readonly reason: "SOURCE_INVALID" | "TARGET_INVALID";
}

export type TriggerApplicationResult = TriggerApplicationSuccess | TriggerApplicationFailure;

export interface TriggerDrainResult {
  readonly applied: number;
  readonly rejected: readonly TriggerRejection[];
  readonly events: readonly BattleDomainEventV1[];
}

export interface TriggerBudgetSnapshot {
  readonly rootCounts: Readonly<Record<string, number>>;
  readonly roundTriggerCounts: Readonly<Record<string, number>>;
  readonly battleTriggerCounts: Readonly<Record<string, number>>;
  readonly unitDamageCounts: Readonly<Record<string, number>>;
  readonly eventCounts: Readonly<Record<string, number>>;
}

function validInteger(value: number, min = 0): boolean {
  return Number.isSafeInteger(value) && value >= min;
}

function asRecord(values: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [key, value] of values) result[key] = value;
  return Object.freeze(result);
}

function sourceKindOrder(kind: TriggerCandidateKind): number {
  return kind === "equipmentAffix" ? 0 : kind === "skillAffix" ? 1 : kind === "personalCombo" ? 2 : kind === "partyCombo" ? 3 : 4;
}

function factionOrder(faction: "party" | "enemy"): number {
  return faction === "party" ? 0 : 1;
}

function rollOrder(value: number | "abyss" | undefined): number {
  return value === "abyss" ? Number.MAX_SAFE_INTEGER : value ?? Number.MAX_SAFE_INTEGER - 1;
}

/** 按 game-design 9.4 固定顺序排序候选；不使用 localeCompare。 */
export function orderTriggerCandidates(candidates: readonly TriggerCandidate[]): TriggerCandidate[] {
  return [...candidates].sort((left, right) => {
    const l = left.sourceOrder;
    const r = right.sourceOrder;
    return sourceKindOrder(l.sourceKind) - sourceKindOrder(r.sourceKind)
      || factionOrder(l.ownerFaction) - factionOrder(r.ownerFaction)
      || l.ownerSlot - r.ownerSlot
      || (l.equipmentSlot ? ["weapon", "helmet", "armor", "gloves", "boots", "accessory"].indexOf(l.equipmentSlot) : Number.MAX_SAFE_INTEGER)
        - (r.equipmentSlot ? ["weapon", "helmet", "armor", "gloves", "boots", "accessory"].indexOf(r.equipmentSlot) : Number.MAX_SAFE_INTEGER)
      || rollOrder(l.sourceRollIndex) - rollOrder(r.sourceRollIndex)
      || (l.definitionId < r.definitionId ? -1 : l.definitionId > r.definitionId ? 1 : 0)
      || (left.sourceKey < right.sourceKey ? -1 : left.sourceKey > right.sourceKey ? 1 : 0);
  });
}

function isTargetedSingle(effect: EffectSpec): boolean {
  return "targetRule" in effect && (effect.targetRule === "singleEnemy" || effect.targetRule === "singleAlly" || effect.targetRule === "deadAlly");
}

function eventBaseFor(
  options: TriggerQueueOptions,
  sequence: number,
  triggerSource: TriggerSourceV1 | null,
  effect: EffectSpec | null,
  rootActionId = options.rootActionId,
  rootActionDefinitionId = options.rootActionDefinitionId,
  chainDepth = 0,
  visualSkillId: string | null = null,
  contextSkillKind: TriggerSkillKindV1 | null = null,
): BattleEventBaseV1 {
  return {
    eventId: options.nextEventId(),
    sequence,
    battleId: options.battleId,
    round: options.round,
    rootActionId,
    rootActionDefinitionId,
    chainDepth,
    triggerSource,
    visualSkillId,
    contextSkillKind,
    effect,
  };
}

function sourceKeyFromTriggerSource(source: TriggerSourceV1): string {
  if (source.kind === "combo") return `${source.ownerKey}:combo:${source.comboId}`;
  if (source.kind === "equipmentAffix") return `${source.ownerUnitId}:equipmentAffix:${source.affixId}`;
  if (source.kind === "skillAffix") return `${source.ownerUnitId}:skillAffix:${source.skillAffixId}`;
  return `${source.ownerUnitId}:status:${source.statusStackId}`;
}

function rejectReasonFromGuard(reason: string): TriggerRejectReason | null {
  if (reason === "CHAIN_DEPTH" || reason === "ROOT_BUDGET" || reason === "ROUND_BUDGET" || reason === "BATTLE_BUDGET" || reason === "UNIT_DAMAGE_BUDGET" || reason === "GLOBAL_EVENT_BUDGET") return reason;
  // 数据契约的 TRIGGER_REJECTED 没有 DUPLICATE_KEY；同根同 owner 的重复
  // Combo 等价于该来源的根预算已用尽，外部诊断仍由 Guard 保留。
  if (reason === "DUPLICATE_KEY") return "ROOT_BUDGET";
  return null;
}

function rejectEvent(
  options: TriggerQueueOptions,
  sourceKey: string,
  reason: TriggerRejectReason,
  consumedRng: boolean,
  metadata: Partial<Pick<PendingBattleEventV1, "rootActionId" | "rootActionDefinitionId" | "chainDepth" | "visualSkillId" | "contextSkillKind" | "triggerSource">> = {},
  sequence = 0,
): TriggerRejection {
  const event = {
    ...eventBaseFor(
      options,
      sequence,
      metadata.triggerSource ?? null,
      null,
      metadata.rootActionId ?? options.rootActionId,
      metadata.rootActionDefinitionId ?? options.rootActionDefinitionId,
      metadata.chainDepth ?? 0,
      metadata.visualSkillId ?? null,
      metadata.contextSkillKind ?? null,
    ),
    type: "TRIGGER_REJECTED",
    sourceKey,
    reason,
    consumedRng,
  } as BattleDomainEventV1;
  return { sourceKey, reason, consumedRng, event };
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function checkBudget(
  candidate: TriggerCandidate,
  rootCounts: ReadonlyMap<string, number>,
  roundCounts: ReadonlyMap<string, number>,
  battleCounts: ReadonlyMap<string, number>,
  unitDamageCounts: ReadonlyMap<string, number>,
  eventCounts: ReadonlyMap<string, number>,
  maxDamage: number,
  maxEvents: number,
): TriggerRejectReason | null {
  const effectCount = candidate.effects.length;
  const damageCount = candidate.effects.filter((effect) => effect.kind === "damage").length;
  const rootUsed = rootCounts.get(candidate.sourceKey) ?? 0;
  const roundUsed = roundCounts.get(candidate.sourceKey) ?? 0;
  const battleUsed = battleCounts.get(candidate.sourceKey) ?? 0;
  const unitKey = `${candidate.rootActionId}:${candidate.sourceUnitId}`;
  const eventUsed = eventCounts.get(candidate.rootActionId) ?? 0;
  if (candidate.budget && rootUsed + 1 > candidate.budget.maxPerRootAction) return "ROOT_BUDGET";
  if (candidate.budget && roundUsed + 1 > candidate.budget.maxPerRound) return "ROUND_BUDGET";
  if (candidate.budget && battleUsed + 1 > candidate.budget.maxPerBattle) return "BATTLE_BUDGET";
  if ((unitDamageCounts.get(unitKey) ?? 0) + damageCount > maxDamage) return "UNIT_DAMAGE_BUDGET";
  if (eventUsed + effectCount > maxEvents) return "GLOBAL_EVENT_BUDGET";
  return null;
}

function applyCounts(
  candidate: TriggerCandidate,
  rootCounts: Map<string, number>,
  roundCounts: Map<string, number>,
  battleCounts: Map<string, number>,
  unitDamageCounts: Map<string, number>,
  eventCounts: Map<string, number>,
): void {
  increment(rootCounts, candidate.sourceKey);
  if (candidate.budget) {
    increment(roundCounts, candidate.sourceKey);
    increment(battleCounts, candidate.sourceKey);
  }
  const damageCount = candidate.effects.filter((effect) => effect.kind === "damage").length;
  if (damageCount > 0) increment(unitDamageCounts, `${candidate.rootActionId}:${candidate.sourceUnitId}`, damageCount);
  if (candidate.effects.length > 0) increment(eventCounts, candidate.rootActionId, candidate.effects.length);
}

function cloneCandidate(candidate: TriggerCandidate): TriggerCandidate {
  return {
    ...candidate,
    // 事件候选是一次性快照；不能只复制 EffectSpec 第一层，否则条件数组仍可被外部修改。
    effects: candidate.effects.map((effect) => structuredClone(effect)),
    targetUnitIds: candidate.targetUnitIds ? [...candidate.targetUnitIds] : undefined,
  };
}

function clonePendingEvent(event: PendingBattleEventV1): PendingBattleEventV1 {
  return {
    ...event,
    targetUnitIds: [...event.targetUnitIds],
    effect: structuredClone(event.effect),
    triggerSource: event.triggerSource ? structuredClone(event.triggerSource) : null,
  };
}

export class TriggerQueue {
  public readonly rng: SeededRng;
  private readonly options: TriggerQueueOptions;
  private readonly guard: ComboRuntimeGuard;
  private readonly pending: PendingBattleEventV1[] = [];
  private readonly emitted: BattleDomainEventV1[] = [];
  private readonly rootCounts = new Map<string, number>();
  private readonly roundCounts = new Map<string, number>();
  private readonly battleCounts = new Map<string, number>();
  private readonly unitDamageCounts = new Map<string, number>();
  private readonly eventCounts = new Map<string, number>();
  private readonly maxDamage: number;
  private readonly maxEvents: number;
  private eventSequence = 0;
  private budgetExhaustedCount = 0;

  public constructor(options: TriggerQueueOptions) {
    this.options = options;
    this.rng = options.rng;
    this.guard = options.guard ?? new ComboRuntimeGuard();
    this.maxDamage = options.maxDerivedDamagePerUnitPerRoot ?? MAX_DERIVED_DAMAGE_PER_UNIT_PER_ROOT;
    this.maxEvents = options.maxDerivedEventsPerRoot ?? MAX_DERIVED_EVENTS_PER_ROOT;
    for (const [key, value] of Object.entries(options.roundTriggerCounts ?? {})) if (validInteger(value)) this.roundCounts.set(key, value);
    for (const [key, value] of Object.entries(options.battleTriggerCounts ?? {})) if (validInteger(value)) this.battleCounts.set(key, value);
    if (!validInteger(this.maxDamage) || !validInteger(this.maxEvents)) throw new RangeError("触发队列预算必须是非负整数");
  }

  public get pendingEvents(): readonly PendingBattleEventV1[] {
    return this.pending.map(clonePendingEvent);
  }

  public get events(): readonly BattleDomainEventV1[] {
    return this.emitted.map((event) => structuredClone(event));
  }

  public get rngState(): readonly [number, number, number, number] {
    return this.rng.getState();
  }

  public get budgetSnapshot(): TriggerBudgetSnapshot {
    return Object.freeze({
      rootCounts: asRecord(this.rootCounts),
      roundTriggerCounts: asRecord(this.roundCounts),
      battleTriggerCounts: asRecord(this.battleCounts),
      unitDamageCounts: asRecord(this.unitDamageCounts),
      eventCounts: asRecord(this.eventCounts),
    });
  }

  /** 已发生的预算拒绝数，供 BattleMetrics.triggerBudgetExhaustedCount 汇总。 */
  public get triggerBudgetExhaustedCount(): number {
    return this.budgetExhaustedCount;
  }

  private nextEventSequence(): number {
    const value = this.eventSequence;
    this.eventSequence += 1;
    return value;
  }

  private appendEvents(events: readonly BattleDomainEventV1[]): void {
    for (const event of events) {
      this.emitted.push(structuredClone(event));
      if (Number.isSafeInteger(event.sequence) && event.sequence >= this.eventSequence) this.eventSequence = event.sequence + 1;
    }
  }

  /** 将一个已经由 StatusRuntime 固化的周期事件追加到队尾。 */
  public enqueuePendingEvents(events: readonly PendingBattleEventV1[]): EnqueueCandidatesResult {
    const rejected: TriggerRejection[] = [];
    let accepted = 0;
    // 状态周期没有三层来源预算，但仍占用每来源 8 / 全场 32 的派生容量。
    for (const value of events) {
      const event = clonePendingEvent(value);
      const sourceKey = sourceKeyFromTriggerSource(event.triggerSource ?? {
        kind: "status",
        statusId: "unknown",
        statusStackId: event.eventId,
        ownerUnitId: event.sourceUnitId,
      });
      const unitKey = `${event.rootActionId}:${event.sourceUnitId}`;
      const isDamage = event.effect.kind === "damage";
      let reason: TriggerRejectReason | null = null;
      if (event.chainDepth > 3) reason = "CHAIN_DEPTH";
      else if (isDamage && (this.unitDamageCounts.get(unitKey) ?? 0) + 1 > this.maxDamage) reason = "UNIT_DAMAGE_BUDGET";
      else if ((this.eventCounts.get(event.rootActionId) ?? 0) + 1 > this.maxEvents) reason = "GLOBAL_EVENT_BUDGET";
      if (reason) {
        if (reason === "UNIT_DAMAGE_BUDGET" || reason === "GLOBAL_EVENT_BUDGET") this.budgetExhaustedCount += 1;
        const rejection = this.recordRejection(rejectEvent(this.options, sourceKey, reason, false, event, this.nextEventSequence()));
        rejected.push(rejection);
        continue;
      }
      if (isDamage) increment(this.unitDamageCounts, unitKey);
      increment(this.eventCounts, event.rootActionId);
      this.pending.push(event);
      accepted += 1;
    }
    return { accepted, rejected };
  }

  /** 候选快照：后续入队过程不得改变本轮候选集合。 */
  public snapshotCandidates(candidates: readonly TriggerCandidate[]): readonly TriggerCandidate[] {
    return Object.freeze(candidates.map(cloneCandidate));
  }

  public enqueueCandidates(candidates: readonly TriggerCandidate[]): EnqueueCandidatesResult {
    const rejected: TriggerRejection[] = [];
    let accepted = 0;
    const snapshot = this.snapshotCandidates(orderTriggerCandidates(candidates));
    for (const candidate of snapshot) {
      const metadata = {
        rootActionId: candidate.rootActionId,
        rootActionDefinitionId: candidate.rootActionDefinitionId,
        chainDepth: candidate.chainDepth,
        visualSkillId: candidate.visualSkillId,
        contextSkillKind: candidate.contextSkillKind,
        triggerSource: candidate.triggerSource,
      } as const;
      if (candidate.effects.length === 0) {
        rejected.push(this.recordRejection(rejectEvent(this.options, candidate.sourceKey, "TARGET_INVALID", false, metadata, this.nextEventSequence())));
        continue;
      }
      const validation = candidate.validate?.() ?? { ok: true };
      if (!validation.ok) {
        rejected.push(this.recordRejection(rejectEvent(this.options, candidate.sourceKey, validation.reason ?? "TARGET_INVALID", false, metadata, this.nextEventSequence())));
        continue;
      }
      if (candidate.sourcePeriodic !== true && candidate.isSourceAlive && !candidate.isSourceAlive()) {
        rejected.push(this.recordRejection(rejectEvent(this.options, candidate.sourceKey, "SOURCE_INVALID", false, metadata, this.nextEventSequence())));
        continue;
      }
      let invalidEffect = false;
      for (const effect of candidate.effects) {
        if (effect.kind === "summon") continue;
        if (candidate.hasLegalTarget && !candidate.hasLegalTarget(effect)) {
          invalidEffect = true;
          break;
        }
      }
      if (invalidEffect) {
        rejected.push(this.recordRejection(rejectEvent(this.options, candidate.sourceKey, "TARGET_INVALID", false, metadata, this.nextEventSequence())));
        continue;
      }

      const damageCount = candidate.effects.filter((effect) => effect.kind === "damage").length;
      const eventCount = candidate.effects.length;
      let budgetReason: TriggerRejectReason | null = null;
      if (candidate.combo) {
        const guardResult = this.guard.check({
          combo: candidate.combo,
          rootActionId: candidate.rootActionId,
          ownerUnitId: candidate.ownerUnitId,
          chainDepth: candidate.chainDepth,
          round: this.options.round,
          derivedDamageCount: damageCount,
          derivedEventCount: eventCount,
        });
        if (!guardResult.ok) budgetReason = rejectReasonFromGuard(guardResult.error.reason);
      }
      if (!budgetReason) budgetReason = checkBudget(candidate, this.rootCounts, this.roundCounts, this.battleCounts, this.unitDamageCounts, this.eventCounts, this.maxDamage, this.maxEvents);
      if (budgetReason) {
        this.budgetExhaustedCount += 1;
        rejected.push(this.recordRejection(rejectEvent(this.options, candidate.sourceKey, budgetReason, false, metadata, this.nextEventSequence())));
        continue;
      }

      const chance = candidate.chanceBps ?? 10_000;
      if (!validInteger(chance) || chance > 10_000) {
        rejected.push(this.recordRejection(rejectEvent(this.options, candidate.sourceKey, "TARGET_INVALID", false, metadata, this.nextEventSequence())));
        continue;
      }
      if (chance < 10_000 && !this.rng.rollBps(chance)) {
        rejected.push(this.recordRejection(rejectEvent(this.options, candidate.sourceKey, "CHANCE_FAILED", true, metadata, this.nextEventSequence())));
        continue;
      }

      if (candidate.combo) {
        const committed = this.guard.commit({
          combo: candidate.combo,
          rootActionId: candidate.rootActionId,
          ownerUnitId: candidate.ownerUnitId,
          chainDepth: candidate.chainDepth,
          round: this.options.round,
          derivedDamageCount: damageCount,
          derivedEventCount: eventCount,
        });
        if (!committed.ok) {
          const reason = rejectReasonFromGuard(committed.error.reason) ?? "ROOT_BUDGET";
          this.budgetExhaustedCount += 1;
          rejected.push(this.recordRejection(rejectEvent(this.options, candidate.sourceKey, reason, false, metadata, this.nextEventSequence())));
          continue;
        }
      }
      const firstInBattle = (this.battleCounts.get(candidate.sourceKey) ?? 0) === 0;
      applyCounts(candidate, this.rootCounts, this.roundCounts, this.battleCounts, this.unitDamageCounts, this.eventCounts);
      if (candidate.kind === "personalCombo" || candidate.kind === "partyCombo") {
        const comboEvent = {
          ...eventBaseFor(
            this.options,
            this.nextEventSequence(),
            candidate.triggerSource,
            null,
            candidate.rootActionId,
            candidate.rootActionDefinitionId,
            candidate.chainDepth,
            candidate.visualSkillId,
            candidate.contextSkillKind,
          ),
          type: "COMBO_TRIGGERED",
          comboId: candidate.combo?.id ?? "",
          ownerKey: candidate.triggerSource.kind === "combo" ? candidate.triggerSource.ownerKey : candidate.ownerUnitId,
          targetUnitIds: candidate.targetUnitIds ? [...candidate.targetUnitIds] : [],
          firstInBattle,
        } as BattleDomainEventV1;
        this.appendEvents([comboEvent]);
      }
      // Combo 的领域事件顺序固定为 COMBO_TRIGGERED → 消耗状态 → Pending effects。
      const consumed = candidate.consume?.() ?? [];
      this.appendEvents(consumed);
      for (const [effectIndex, effect] of candidate.effects.entries()) {
        const targets = isTargetedSingle(effect) ? (candidate.targetUnitIds?.length === 1 ? [...candidate.targetUnitIds] : []) : [];
        this.pending.push({
          eventId: this.options.nextEventId(),
          rootActionId: candidate.rootActionId,
          rootActionDefinitionId: candidate.rootActionDefinitionId,
          chainDepth: candidate.chainDepth,
          sourceUnitId: candidate.sourceUnitId,
          targetUnitIds: targets,
          effectIndex,
          effect,
          triggerSource: candidate.triggerSource,
          visualSkillId: candidate.visualSkillId,
          contextSkillKind: candidate.contextSkillKind,
        });
      }
      accepted += 1;
    }
    return { accepted, rejected };
  }

  private recordRejection(rejection: TriggerRejection): TriggerRejection {
    this.appendEvents([rejection.event]);
    return rejection;
  }

  /** ROUND_START 时清空轮次预算；root/battle 预算保持不变。 */
  public resetRound(): void {
    this.roundCounts.clear();
    this.guard.resetRound();
  }

  /** 战斗重置时清空所有候选、事件和预算。 */
  public resetBattle(): void {
    this.pending.length = 0;
    this.emitted.length = 0;
    this.rootCounts.clear();
    this.roundCounts.clear();
    this.battleCounts.clear();
    this.unitDamageCounts.clear();
    this.eventCounts.clear();
    this.eventSequence = 0;
    this.budgetExhaustedCount = 0;
    this.guard.resetBattle();
  }

  /** 严格 FIFO；应用成功后才收集下一批候选并追加到队尾。 */
  public drain(
    apply: (event: PendingBattleEventV1) => TriggerApplicationResult,
    collectCandidates?: (event: PendingBattleEventV1, result: TriggerApplicationSuccess) => readonly TriggerCandidate[],
  ): TriggerDrainResult {
    const rejected: TriggerRejection[] = [];
    let applied = 0;
    const start = this.emitted.length;
    while (this.pending.length > 0) {
      const event = this.pending.shift()!;
      const result = apply(event);
      if (!result.ok) {
        const sourceKey = sourceKeyFromTriggerSource(event.triggerSource ?? { kind: "status", statusId: "unknown", statusStackId: event.eventId, ownerUnitId: event.sourceUnitId });
        const rejection = this.recordRejection(rejectEvent(this.options, sourceKey, result.reason, false, event, this.nextEventSequence()));
        rejected.push(rejection);
        continue;
      }
      this.appendEvents(result.events);
      applied += 1;
      if (collectCandidates) {
        const nextCandidates = this.snapshotCandidates(collectCandidates(event, result));
        const enqueueResult = this.enqueueCandidates(nextCandidates);
        rejected.push(...enqueueResult.rejected);
      }
    }
    return { applied, rejected, events: this.emitted.slice(start) };
  }

  /** 与 DRAIN_PRE_ACTION 同一 FIFO 语义的显式命名入口。 */
  public drainPreAction(
    apply: (event: PendingBattleEventV1) => TriggerApplicationResult,
    collectCandidates?: (event: PendingBattleEventV1, result: TriggerApplicationSuccess) => readonly TriggerCandidate[],
  ): TriggerDrainResult {
    return this.drain(apply, collectCandidates);
  }
}
