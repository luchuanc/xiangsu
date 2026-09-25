/**
 * 状态运行时。
 *
 * 本文件只处理状态栈自身的确定性变更和周期事件生成；周期伤害进入统一
 * TriggerQueue 后才会被应用，不能在这里递归调用根行动解析器。
 */
import type {
  BattleActionDefinitionIdV1,
  BattleDomainEventV1,
  BattleEventBaseV1,
  BattleUnitStateV1,
  EffectSpec,
  PendingBattleEventV1,
  RuntimeStatusStack,
  StatBlock,
  StatusDefinition,
  TriggerSkillKindV1,
  TriggerSourceV1,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import type { SeededRng } from "../common/SeededRng";

export const STATUS_SHIELD_ID = "status_shield";
export const STATUS_SHIELD_MAX_STACKS = 99;
export const STATUS_SHIELD_DURATION_OWNER_TURNS = 2;

export interface StatusEventContext {
  readonly battleId: string;
  readonly round: number;
  readonly rootActionId?: string | null;
  readonly rootActionDefinitionId?: BattleActionDefinitionIdV1 | null;
  readonly chainDepth?: number;
  readonly triggerSource?: TriggerSourceV1 | null;
  readonly visualSkillId?: string | null;
  readonly contextSkillKind?: TriggerSkillKindV1 | null;
  readonly effect?: EffectSpec | null;
  readonly phase?: "DRAIN_PRE_ACTION" | "DRAIN_TRIGGERS" | "TURN_END" | "TURN_START";
  /** 用于严格判断“当前行动者已经开始但尚未结束”的持续时间边界。 */
  readonly currentUnitId?: string | null;
  readonly targetUnitId?: string | null;
  readonly targetTurnStarted?: boolean;
  readonly targetTurnEndCompleted?: boolean;
  readonly nextEventId?: () => string;
}

export interface StatusApplyInput {
  readonly target: Readonly<BattleUnitStateV1>;
  readonly source: Readonly<BattleUnitStateV1> | null;
  readonly status: Readonly<StatusDefinition>;
  readonly stacks: number;
  readonly durationOwnerTurns: number;
  readonly baseChanceBps: number;
  readonly targetImmunityTags?: readonly string[];
  readonly rng: SeededRng;
  readonly nextStatusId?: () => string;
  readonly eventContext: StatusEventContext;
}

export interface StatusMutationResult {
  readonly unit: BattleUnitStateV1;
  readonly events: readonly BattleDomainEventV1[];
}

export interface PeriodicStatusInput {
  readonly unit: Readonly<BattleUnitStateV1>;
  readonly timing: "turnStart" | "afterAction" | "turnEnd";
  readonly directDamageDealt?: boolean;
  readonly directDamageAmount?: number;
  readonly getStatus: (statusId: string) => Readonly<StatusDefinition> | undefined;
  readonly eventContext: StatusEventContext;
  readonly nextEventId?: () => string;
}

export interface PeriodicStatusResult {
  readonly unit: BattleUnitStateV1;
  readonly pendingEvents: readonly PendingBattleEventV1[];
  readonly events: readonly BattleDomainEventV1[];
}

export interface ShieldGrantInput {
  readonly target: Readonly<BattleUnitStateV1>;
  readonly sourceUnitId: string;
  readonly desired: number;
  readonly durationOwnerTurns?: number;
  readonly sourceAttackSnapshot?: number;
  readonly nextStatusId?: () => string;
  readonly eventContext: StatusEventContext;
}

export interface ShieldGrantResult extends StatusMutationResult {
  readonly statusStackId: string | null;
  readonly granted: number;
  readonly discardedByCap: number;
  readonly shieldAfter: number;
}

export interface ShieldAbsorptionInput {
  readonly target: Readonly<BattleUnitStateV1>;
  readonly damage: number;
  readonly sourceUnitId: string;
  readonly eventContext: StatusEventContext;
}

export interface ShieldAbsorptionResult extends StatusMutationResult {
  readonly shieldDamage: number;
  readonly hpDamage: number;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly shieldAfter: number;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function cloneStats(stats: StatBlock): StatBlock {
  return { ...stats };
}

function cloneUnit(unit: Readonly<BattleUnitStateV1>): BattleUnitStateV1 {
  return {
    ...unit,
    prePercentStats: cloneStats(unit.prePercentStats),
    staticPercentByStatBps: cloneStats(unit.staticPercentByStatBps),
    stats: cloneStats(unit.stats),
    cooldowns: { ...unit.cooldowns },
    statuses: unit.statuses.map((value) => ({ ...value })),
    directHitEnergyRootActionIds: [...unit.directHitEnergyRootActionIds],
  };
}

function validInteger(value: number, min = 0): boolean {
  return Number.isSafeInteger(value) && value >= min;
}

function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, value));
}

function stackIdFactory(nextStatusId?: () => string): () => string {
  let fallbackIndex = 0;
  return nextStatusId ?? (() => `status_stack_${fallbackIndex++}`);
}

function eventIdFactory(context: StatusEventContext, nextEventId?: () => string): () => string {
  let fallbackIndex = 0;
  return context.nextEventId ?? nextEventId ?? (() => `status_event_${fallbackIndex++}`);
}

function eventBase(
  context: StatusEventContext,
  nextEventId: () => string,
  sequence: number,
  triggerSource: TriggerSourceV1 | null = context.triggerSource ?? null,
  effect: EffectSpec | null = context.effect ?? null,
): BattleEventBaseV1 {
  return {
    eventId: nextEventId(),
    sequence,
    battleId: context.battleId,
    round: context.round,
    rootActionId: context.rootActionId ?? null,
    rootActionDefinitionId: context.rootActionDefinitionId ?? null,
    chainDepth: context.chainDepth ?? 0,
    triggerSource,
    visualSkillId: context.visualSkillId ?? null,
    contextSkillKind: context.contextSkillKind ?? null,
    effect,
  };
}

function makeStatusEvent(
  context: StatusEventContext,
  nextEventId: () => string,
  sequence: number,
  value: Omit<Extract<BattleDomainEventV1, { type: "STATUS_CHANGED" }>, keyof BattleEventBaseV1>,
  triggerSource: TriggerSourceV1 | null = context.triggerSource ?? null,
): BattleDomainEventV1 {
  return {
    ...eventBase(context, nextEventId, sequence, triggerSource, context.effect ?? null),
    ...value,
  } as BattleDomainEventV1;
}

function makeShieldEvent(
  context: StatusEventContext,
  nextEventId: () => string,
  sequence: number,
  value: Omit<Extract<BattleDomainEventV1, { type: "SHIELD_GRANTED" }>, keyof BattleEventBaseV1>,
): BattleDomainEventV1 {
  return {
    ...eventBase(context, nextEventId, sequence, context.triggerSource ?? null, context.effect ?? null),
    ...value,
  } as BattleDomainEventV1;
}

function sourceAttackSnapshot(input: StatusApplyInput): number {
  const value = input.source?.stats.attack ?? 0;
  return validInteger(value) ? value : 0;
}

function skipNextTurnEndDecrement(context: StatusEventContext, target: Readonly<BattleUnitStateV1>): boolean {
  // DRAIN_PRE_ACTION 的 buff 已经作用于当前根行动，固定不跳过本次 TURN_END。
  if (context.phase === "DRAIN_PRE_ACTION") return false;
  const hasExactTurnOwner = context.currentUnitId !== undefined || context.targetUnitId !== undefined;
  const exactTurnOwner = context.currentUnitId === target.unitId
    && context.targetUnitId === target.unitId;
  return context.rootActionId !== null
    && context.rootActionId !== undefined
    && context.targetTurnStarted === true
    && context.targetTurnEndCompleted !== true
    && context.rootActionId.length > 0
    && context.phase !== "TURN_START"
    && target.currentHp > 0
    // 旧适配器只提供两个时点布尔值时，它们就是已完成的 owner 断言；
    // 一旦提供任一 ID，则必须完成精确的 current/target 双匹配。
    && (!hasExactTurnOwner || exactTurnOwner);
}

function statusStackCount(unit: Readonly<BattleUnitStateV1>, statusId: string): number {
  return unit.statuses.filter((value) => value.statusId === statusId).length;
}

function statusDefinitionFor(
  getStatus: (statusId: string) => Readonly<StatusDefinition> | undefined,
  statusId: string,
): DomainResult<Readonly<StatusDefinition>> {
  let value: Readonly<StatusDefinition> | undefined;
  try {
    value = getStatus(statusId);
  } catch {
    return invalid(`statuses.${statusId}`, "getter_failed");
  }
  if (!value || value.id !== statusId) return invalid(`statuses.${statusId}`, "missing_reference");
  return success(value);
}

function periodicEffect(
  status: Readonly<StatusDefinition>,
  stack: Readonly<RuntimeStatusStack>,
): Extract<EffectSpec, { kind: "damage" }> | null {
  if (status.effect.kind !== "periodicDamage") return null;
  const raw = Math.floor(stack.sourceAttackSnapshot * status.effect.snapshotPowerBps / 10_000);
  return {
    kind: "damage",
    targetRule: "singleEnemy",
    element: status.effect.element,
    powerBps: 0,
    flatPower: Math.max(0, raw),
    canCrit: false,
    ignoreDefenseBps: 0,
    flatIgnoreDefense: 0,
    hitCount: 1,
    retargetEachHit: false,
    conditionalMultipliers: [],
  };
}

function makePeriodicPending(
  input: PeriodicStatusInput,
  status: Readonly<StatusDefinition>,
  stack: Readonly<RuntimeStatusStack>,
  nextEventId: () => string,
): PendingBattleEventV1 | null {
  const effect = periodicEffect(status, stack);
  if (!effect) return null;
  const triggerSource: TriggerSourceV1 = {
    kind: "status",
    statusId: stack.statusId,
    statusStackId: stack.stackId,
    ownerUnitId: input.unit.unitId,
  };
  return {
    eventId: nextEventId(),
    rootActionId: input.eventContext.rootActionId ?? "status_root",
    rootActionDefinitionId: input.eventContext.rootActionDefinitionId ?? "action_skip_control",
    // 周期事件本身是当前根/派生事件的下一层，不能复用来源层级。
    chainDepth: (input.eventContext.chainDepth ?? 0) + 1,
    sourceUnitId: stack.sourceUnitId,
    targetUnitIds: [input.unit.unitId],
    effectIndex: 0,
    effect,
    triggerSource,
    visualSkillId: null,
    contextSkillKind: null,
  };
}

/** 应用 ApplyStatusEffectSpec：每个目标只判定一次，成功后逐层写入。 */
export function applyStatus(input: StatusApplyInput): DomainResult<StatusMutationResult> {
  if (!input || !input.target || !input.status || !input.rng) return invalid("input", "shape");
  if (!validInteger(input.stacks) || input.stacks < 1) return invalid("stacks", "positive_integer");
  if (!validInteger(input.durationOwnerTurns) || input.durationOwnerTurns < 1) return invalid("durationOwnerTurns", "positive_integer");
  if (!validInteger(input.baseChanceBps) || input.baseChanceBps > 10_000) return invalid("baseChanceBps", "bps");
  if (input.status.refreshRule === "replaceDuration" && input.stacks !== 1) return invalid(`statuses.${input.status.id}.stacks`, "replace_duration_requires_one");
  if (!validInteger(input.status.maxStacks) || input.status.maxStacks < 1) return invalid(`statuses.${input.status.id}.maxStacks`, "max_stacks");

  const chance = input.status.polarity === "buff"
    ? 10_000
    : clampBps(input.baseChanceBps + (input.source?.stats.effectHitBps ?? 0) - input.target.stats.effectResistBps);
  if (input.status.polarity === "debuff" && input.status.immunityTag !== null && input.targetImmunityTags?.includes(input.status.immunityTag)) {
    const nextEventId = eventIdFactory(input.eventContext);
    const event = makeStatusEvent(input.eventContext, nextEventId, 0, {
      type: "STATUS_CHANGED",
      sourceUnitId: input.source?.unitId ?? null,
      targetUnitId: input.target.unitId,
      statusId: input.status.id,
      statusStackId: null,
      change: "immune",
      stacksBefore: statusStackCount(input.target, input.status.id),
      stacksAfter: statusStackCount(input.target, input.status.id),
      remainingOwnerTurnsAfter: 0,
    });
    return success({ unit: cloneUnit(input.target), events: [event] });
  }
  if (chance < 10_000 && !input.rng.rollBps(chance)) {
    const nextEventId = eventIdFactory(input.eventContext);
    const event = makeStatusEvent(input.eventContext, nextEventId, 0, {
      type: "STATUS_CHANGED",
      sourceUnitId: input.source?.unitId ?? null,
      targetUnitId: input.target.unitId,
      statusId: input.status.id,
      statusStackId: null,
      change: "resisted",
      stacksBefore: statusStackCount(input.target, input.status.id),
      stacksAfter: statusStackCount(input.target, input.status.id),
      remainingOwnerTurnsAfter: 0,
    });
    return success({ unit: cloneUnit(input.target), events: [event] });
  }

  const next = cloneUnit(input.target);
  const nextStatusId = stackIdFactory(input.nextStatusId);
  const nextEventId = eventIdFactory(input.eventContext);
  const events: BattleDomainEventV1[] = [];
  const snapshotAttack = sourceAttackSnapshot(input);
  const skipDecrement = skipNextTurnEndDecrement(input.eventContext, input.target);
  const existing = next.statuses.filter((value) => value.statusId === input.status.id);

  if (input.status.refreshRule === "replaceDuration") {
    next.statuses = next.statuses.filter((value) => value.statusId !== input.status.id);
    const stackId = nextStatusId();
    next.statuses.push({ stackId, statusId: input.status.id, sourceUnitId: input.source?.unitId ?? "system", remainingOwnerTurns: input.durationOwnerTurns, skipNextOwnerTurnEndDecrement: skipDecrement, sourceAttackSnapshot: snapshotAttack, shieldRemaining: 0 });
    events.push(makeStatusEvent(input.eventContext, nextEventId, events.length, {
      type: "STATUS_CHANGED",
      sourceUnitId: input.source?.unitId ?? null,
      targetUnitId: input.target.unitId,
      statusId: input.status.id,
      statusStackId: stackId,
      change: existing.length > 0 ? "refreshed" : "applied",
      stacksBefore: existing.length,
      stacksAfter: 1,
      remainingOwnerTurnsAfter: input.durationOwnerTurns,
    }));
    return success({ unit: next, events });
  }

  for (let index = 0; index < input.stacks; index += 1) {
    const before = statusStackCount(next, input.status.id);
    if (before >= input.status.maxStacks) {
      events.push(makeStatusEvent(input.eventContext, nextEventId, events.length, {
        type: "STATUS_CHANGED",
        sourceUnitId: input.source?.unitId ?? null,
        targetUnitId: input.target.unitId,
        statusId: input.status.id,
        statusStackId: null,
        change: "capped",
        stacksBefore: before,
        stacksAfter: before,
        remainingOwnerTurnsAfter: 0,
      }));
      continue;
    }
    const stackId = nextStatusId();
    next.statuses.push({ stackId, statusId: input.status.id, sourceUnitId: input.source?.unitId ?? "system", remainingOwnerTurns: input.durationOwnerTurns, skipNextOwnerTurnEndDecrement: skipDecrement, sourceAttackSnapshot: snapshotAttack, shieldRemaining: 0 });
    events.push(makeStatusEvent(input.eventContext, nextEventId, events.length, {
      type: "STATUS_CHANGED",
      sourceUnitId: input.source?.unitId ?? null,
      targetUnitId: input.target.unitId,
      statusId: input.status.id,
      statusStackId: stackId,
      change: before === 0 ? "applied" : "stacked",
      stacksBefore: before,
      stacksAfter: before + 1,
      remainingOwnerTurnsAfter: input.durationOwnerTurns,
    }));
  }
  return success({ unit: next, events });
}

/** 创建 status_shield 栈；ShieldEffect 不经过 ApplyStatus 命中流程。 */
export function grantShieldStatus(input: ShieldGrantInput): DomainResult<ShieldGrantResult> {
  if (!input || !input.target || !validInteger(input.desired) || !validInteger(input.durationOwnerTurns ?? STATUS_SHIELD_DURATION_OWNER_TURNS, 1)) return invalid("input", "shape");
  if (typeof input.sourceUnitId !== "string" || input.sourceUnitId.length === 0) return invalid("sourceUnitId", "required");
  const next = cloneUnit(input.target);
  const nextEventId = eventIdFactory(input.eventContext);
  const shieldStatuses = next.statuses.filter((value) => value.statusId === STATUS_SHIELD_ID && value.shieldRemaining > 0);
  const available = Math.max(0, STATUS_SHIELD_MAX_STACKS - shieldStatuses.length);
  const desired = input.desired;
  const granted = available > 0 && desired > 0 ? desired : 0;
  const discardedByCap = desired - granted;
  const statusStackId = granted > 0 ? stackIdFactory(input.nextStatusId)() : null;
  if (statusStackId !== null) {
    next.statuses.push({
      stackId: statusStackId,
      statusId: STATUS_SHIELD_ID,
      sourceUnitId: input.sourceUnitId,
      remainingOwnerTurns: input.durationOwnerTurns ?? STATUS_SHIELD_DURATION_OWNER_TURNS,
      skipNextOwnerTurnEndDecrement: false,
      sourceAttackSnapshot: input.sourceAttackSnapshot ?? 0,
      shieldRemaining: granted,
    });
  }
  const shieldAfter = next.statuses.filter((value) => value.statusId === STATUS_SHIELD_ID).reduce((sum, value) => sum + value.shieldRemaining, 0);
  const events: BattleDomainEventV1[] = [];
  if (granted > 0) {
    events.push(makeShieldEvent(input.eventContext, nextEventId, 0, {
      type: "SHIELD_GRANTED",
      sourceUnitId: input.sourceUnitId,
      targetUnitId: input.target.unitId,
      effectIndex: 0,
      statusStackId,
      granted,
      discardedByCap,
      shieldAfter,
    }));
  }
  return success({ unit: next, events, statusStackId, granted, discardedByCap, shieldAfter });
}

/** 由旧到新吸收护盾；护盾耗尽逐栈输出 STATUS_CHANGED.depleted。 */
export function absorbDamageWithStatuses(input: ShieldAbsorptionInput): DomainResult<ShieldAbsorptionResult> {
  if (!input || !input.target || !validInteger(input.damage) || input.damage < 0) return invalid("input", "shape");
  const next = cloneUnit(input.target);
  const nextEventId = eventIdFactory(input.eventContext);
  const events: BattleDomainEventV1[] = [];
  const hpBefore = next.currentHp;
  let remaining = input.damage;
  let shieldDamage = 0;
  const statuses: RuntimeStatusStack[] = [];
  for (const stack of next.statuses) {
    if (stack.statusId !== STATUS_SHIELD_ID || stack.shieldRemaining <= 0 || remaining <= 0) {
      statuses.push(stack);
      continue;
    }
    const absorbed = Math.min(remaining, stack.shieldRemaining);
    stack.shieldRemaining -= absorbed;
    remaining -= absorbed;
    shieldDamage += absorbed;
    if (stack.shieldRemaining <= 0) {
      events.push(makeStatusEvent(input.eventContext, nextEventId, events.length, {
        type: "STATUS_CHANGED",
        sourceUnitId: input.sourceUnitId,
        targetUnitId: next.unitId,
        statusId: stack.statusId,
        statusStackId: stack.stackId,
        change: "depleted",
        stacksBefore: 1,
        stacksAfter: 0,
        remainingOwnerTurnsAfter: 0,
      }, null));
      continue;
    }
    statuses.push(stack);
  }
  next.statuses = statuses;
  const hpDamage = Math.min(next.currentHp, remaining);
  next.currentHp -= hpDamage;
  const shieldAfter = next.statuses.filter((value) => value.statusId === STATUS_SHIELD_ID).reduce((sum, value) => sum + value.shieldRemaining, 0);
  return success({ unit: next, events, shieldDamage, hpDamage, hpBefore, hpAfter: next.currentHp, shieldAfter });
}

/** 生成 turnEnd/afterAction/turnStart 周期 PendingBattleEvent，不在此处应用伤害。 */
export function createPeriodicStatusEvents(input: PeriodicStatusInput): DomainResult<PeriodicStatusResult> {
  if (!input || !input.unit || typeof input.getStatus !== "function") return invalid("input", "shape");
  if (input.timing === "afterAction" && (input.directDamageDealt !== true || (input.directDamageAmount !== undefined && (!validInteger(input.directDamageAmount) || input.directDamageAmount < 1)))) return success({ unit: cloneUnit(input.unit), pendingEvents: [], events: [] });
  const next = cloneUnit(input.unit);
  const nextEventId = eventIdFactory(input.eventContext, input.nextEventId);
  const pendingEvents: PendingBattleEventV1[] = [];
  const events: BattleDomainEventV1[] = [];
  const retained: RuntimeStatusStack[] = [];

  const remainingCounts = new Map<string, number>();
  for (const stack of next.statuses) remainingCounts.set(stack.statusId, (remainingCounts.get(stack.statusId) ?? 0) + 1);

  for (const stack of next.statuses) {
    if (!stack.stackId || !validInteger(stack.remainingOwnerTurns, 1) || !validInteger(stack.sourceAttackSnapshot) || !validInteger(stack.shieldRemaining)) {
      return invalid(`statuses.${stack.statusId}`, "runtime_stack_shape");
    }
    const definitionResult = statusDefinitionFor(input.getStatus, stack.statusId);
    if (!definitionResult.ok) return definitionResult;
    const definition = definitionResult.value;

    // 防御状态只保护到下一次 TURN_START，控制判定之前直接移除。
    if (input.timing === "turnStart" && stack.statusId === "status_guard_30") {
      const before = remainingCounts.get(stack.statusId) ?? 1;
      remainingCounts.set(stack.statusId, Math.max(0, before - 1));
      events.push(makeStatusEvent(input.eventContext, nextEventId, events.length, {
        type: "STATUS_CHANGED",
        sourceUnitId: null,
        targetUnitId: next.unitId,
        statusId: stack.statusId,
        statusStackId: stack.stackId,
        change: "expired",
        stacksBefore: before,
        stacksAfter: Math.max(0, before - 1),
        remainingOwnerTurnsAfter: 0,
      }, null));
      continue;
    }

    const timingMatches = definition.triggerTiming === input.timing;
    if (timingMatches && definition.effect.kind === "periodicDamage") {
      const pending = makePeriodicPending(input, definition, stack, nextEventId);
      if (pending) pendingEvents.push(pending);
    }
    if (input.timing !== "turnEnd") {
      retained.push(stack);
      continue;
    }
    if (stack.skipNextOwnerTurnEndDecrement) {
      retained.push({ ...stack, skipNextOwnerTurnEndDecrement: false });
      continue;
    }
    const remainingTurns = stack.remainingOwnerTurns - 1;
    if (remainingTurns > 0) {
      retained.push({ ...stack, remainingOwnerTurns: remainingTurns });
    } else {
      const before = remainingCounts.get(stack.statusId) ?? 1;
      remainingCounts.set(stack.statusId, Math.max(0, before - 1));
      events.push(makeStatusEvent(input.eventContext, nextEventId, events.length, {
        type: "STATUS_CHANGED",
        sourceUnitId: null,
        targetUnitId: next.unitId,
        statusId: stack.statusId,
        statusStackId: stack.stackId,
        change: "expired",
        stacksBefore: before,
        stacksAfter: Math.max(0, before - 1),
        remainingOwnerTurnsAfter: 0,
      }, null));
    }
  }
  next.statuses = retained;
  return success({ unit: next, pendingEvents, events });
}

/** 单位死亡后清理全部状态栈；自然清理不伪造触发来源。 */
export function clearStatusesOnDefeat(input: { readonly target: Readonly<BattleUnitStateV1>; readonly eventContext: StatusEventContext }): DomainResult<StatusMutationResult> {
  if (!input || !input.target) return invalid("input", "shape");
  const next = cloneUnit(input.target);
  const nextEventId = eventIdFactory(input.eventContext);
  const events: BattleDomainEventV1[] = [];
  const counts = new Map<string, number>();
  for (const stack of next.statuses) counts.set(stack.statusId, (counts.get(stack.statusId) ?? 0) + 1);
  for (const stack of next.statuses) {
    const before = counts.get(stack.statusId) ?? 1;
    counts.set(stack.statusId, Math.max(0, before - 1));
    events.push(makeStatusEvent(input.eventContext, nextEventId, events.length, {
      type: "STATUS_CHANGED",
      sourceUnitId: null,
      targetUnitId: next.unitId,
      statusId: stack.statusId,
      statusStackId: stack.stackId,
      change: stack.statusId === STATUS_SHIELD_ID ? "depleted" : "expired",
      stacksBefore: before,
      stacksAfter: Math.max(0, before - 1),
      remainingOwnerTurnsAfter: 0,
    }, null));
  }
  next.statuses = [];
  return success({ unit: next, events });
}
