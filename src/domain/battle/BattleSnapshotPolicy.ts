/**
 * 稳定战斗快照和终局判定策略。
 *
 * 存档层只能接收稳定阶段、空 pendingEvents 的快照；终局检查明确放在
 * 根行动领域事件与派生队列全部清空之后，双方同灭固定优先判定 defeat。
 */
import type {
  BattleActionDefinitionIdV1,
  BattleDomainEventV1,
  BattleSnapshotV1,
  BattleUnitStateV1,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";

export const STABLE_BATTLE_PHASES = ["AWAIT_COMMAND", "TURN_START", "REWARD_PENDING", "COMPLETE"] as const;
export type StableBattlePhase = typeof STABLE_BATTLE_PHASES[number];

export interface SnapshotEventContext {
  readonly battleId: string;
  readonly round: number;
  readonly rootActionId: string;
  readonly rootActionDefinitionId: BattleActionDefinitionIdV1;
  readonly chainDepth?: number;
  readonly rewardTransactionId?: string;
  readonly nextEventId?: () => string;
}

export interface BattleOutcomeEvaluationInput {
  readonly pendingEvents: readonly unknown[];
  readonly unappliedDomainEventCount: number;
  readonly eventContext: SnapshotEventContext;
  readonly battleFinishedAlreadyEmitted?: boolean;
  readonly rewardPreparedAlreadyEmitted?: boolean;
}

export interface BattleOutcomeEvaluation {
  readonly snapshot: BattleSnapshotV1;
  readonly outcome: "ongoing" | "victory" | "defeat";
  readonly events: readonly BattleDomainEventV1[];
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isAlive(unit: Readonly<BattleUnitStateV1>): boolean {
  return unit.currentHp > 0;
}

function isStablePhase(phase: BattleSnapshotV1["phase"]): phase is StableBattlePhase {
  return (STABLE_BATTLE_PHASES as readonly string[]).includes(phase);
}

function cloneSnapshot(snapshot: BattleSnapshotV1): BattleSnapshotV1 {
  return structuredClone(snapshot);
}

function eventBase(context: SnapshotEventContext, sequence: number): {
  eventId: string;
  sequence: number;
  battleId: string;
  round: number;
  rootActionId: string;
  rootActionDefinitionId: BattleActionDefinitionIdV1;
  chainDepth: number;
  triggerSource: null;
  visualSkillId: null;
  contextSkillKind: null;
  effect: null;
} {
  return {
    eventId: context.nextEventId?.() ?? `snapshot_event_${sequence}`,
    sequence,
    battleId: context.battleId,
    round: context.round,
    rootActionId: context.rootActionId,
    rootActionDefinitionId: context.rootActionDefinitionId,
    chainDepth: context.chainDepth ?? 0,
    triggerSource: null,
    visualSkillId: null,
    contextSkillKind: null,
    effect: null,
  };
}

function outcomeFor(snapshot: Readonly<BattleSnapshotV1>): "ongoing" | "victory" | "defeat" {
  const partyAlive = snapshot.units.some((unit) => unit.faction === "party" && isAlive(unit));
  const enemyAlive = snapshot.units.some((unit) => unit.faction === "enemy" && isAlive(unit));
  if (!partyAlive) return "defeat";
  if (!enemyAlive) return "victory";
  return "ongoing";
}

/** 校验并复制可持久化的稳定快照。 */
export class BattleSnapshotPolicy {
  public prepare(snapshot: BattleSnapshotV1): DomainResult<BattleSnapshotV1> {
    if (!snapshot || typeof snapshot !== "object") return invalid("snapshot", "shape");
    if (!isStablePhase(snapshot.phase)) return failure(createDomainError("INVALID_BATTLE_PHASE", { expected: [...STABLE_BATTLE_PHASES], actual: snapshot.phase }));
    if (!Array.isArray(snapshot.pendingEvents) || snapshot.pendingEvents.length !== 0) return invalid("pendingEvents", "must_be_empty_at_stable_point");
    if (snapshot.phase === "AWAIT_COMMAND" || snapshot.phase === "TURN_START") {
      if (snapshot.outcome !== "ongoing") return invalid("outcome", "ongoing_required");
    }
    if (snapshot.phase === "REWARD_PENDING" && snapshot.outcome !== "victory") return invalid("outcome", "victory_required");
    if (snapshot.phase === "COMPLETE" && !["victory", "defeat", "retreat"].includes(snapshot.outcome)) return invalid("outcome", "terminal_required");
    return success(cloneSnapshot(snapshot));
  }

  public restore(snapshot: BattleSnapshotV1): DomainResult<BattleSnapshotV1> {
    return this.prepare(snapshot);
  }

  public canPersist(snapshot: BattleSnapshotV1): boolean {
    return this.prepare(snapshot).ok;
  }
}

/** 在所有领域事件/派生队列清空后输出唯一终局事件。 */
export function evaluateBattleOutcome(
  snapshot: BattleSnapshotV1,
  input: BattleOutcomeEvaluationInput,
): DomainResult<BattleOutcomeEvaluation> {
  if (!snapshot || !input || !Array.isArray(input.pendingEvents)) return invalid("input", "shape");
  if (!Number.isSafeInteger(input.unappliedDomainEventCount) || input.unappliedDomainEventCount < 0) return invalid("unappliedDomainEventCount", "non_negative_integer");
  if (input.pendingEvents.length > 0 || input.unappliedDomainEventCount !== 0) return invalid("battle", "events_not_drained");
  const next = cloneSnapshot(snapshot);
  const outcome = outcomeFor(next);
  next.outcome = outcome;
  if (outcome === "ongoing") return success({ snapshot: next, outcome, events: [] });
  next.phase = outcome === "victory" ? "VICTORY" : "DEFEAT";
  const events: BattleDomainEventV1[] = [];
  if (!input.battleFinishedAlreadyEmitted) {
    events.push({ ...eventBase(input.eventContext, 0), type: "BATTLE_FINISHED", outcome });
  }
  if (outcome === "victory" && !input.rewardPreparedAlreadyEmitted) {
    events.push({ ...eventBase(input.eventContext, events.length), type: "REWARD_PREPARED", transactionId: input.eventContext.rewardTransactionId ?? `reward:${next.battleId}` });
    next.phase = "REWARD_PENDING";
  }
  return success({ snapshot: next, outcome, events });
}

