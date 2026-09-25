/**
 * 固定任务的领域服务。
 *
 * 任务完成只读取 QuestDefinition.completionCondition；本服务不根据
 * 文案、对象名或其它未声明字段猜测完成状态，也不改写 world 的其它字段。
 */
import type {
  GameSaveV1,
  QuestDefinition,
  QuestId,
  UnlockCondition,
  WorldProgressV1,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";

export interface QuestContentSource {
  getQuest(id: QuestId): DomainResult<Readonly<QuestDefinition>>;
}

export interface QuestEvaluation {
  readonly questId: QuestId;
  readonly condition: UnlockCondition;
  readonly conditionMet: boolean;
  readonly alreadyCompleted: boolean;
}

/** 任务完成证据由奖励/战斗结算事务显式传入，不从地图对象或文案推断。 */
export type QuestCompletionEvidence =
  | { readonly kind: "floorCleared"; readonly floorNumber: number }
  | { readonly kind: "encounterCleared"; readonly encounterId: string };

export interface QuestCommitOptions {
  readonly expectedRevision: number;
  readonly save: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateWorldProjection(world: WorldProgressV1): DomainResult<true> {
  if (!isRecord(world)) return invalid("world", "not_object");
  if (!Number.isSafeInteger(world.highestUnlockedFloor) || world.highestUnlockedFloor < 1 || world.highestUnlockedFloor > 10) {
    return invalid("world.highestUnlockedFloor", "floor_range");
  }
  for (const field of ["completedQuestIds", "clearedBossEncounterIds"] as const) {
    const values = world[field];
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) {
      return invalid(`world.${field}`, "id_array");
    }
  }
  return success(true);
}

function cloneWorld(world: WorldProgressV1): WorldProgressV1 {
  return structuredClone(world);
}

function conditionMet(
  condition: UnlockCondition,
  world: WorldProgressV1,
  evidence?: QuestCompletionEvidence,
): DomainResult<boolean> {
  if (evidence !== undefined && (!isRecord(evidence) || (evidence.kind !== "floorCleared" && evidence.kind !== "encounterCleared"))) {
    return invalid("quest.completionEvidence", "unknown_condition");
  }
  if (evidence?.kind === "floorCleared" && (!Number.isSafeInteger(evidence.floorNumber) || evidence.floorNumber < 1 || evidence.floorNumber > 10)) {
    return invalid("quest.completionEvidence.floorNumber", "floor_range");
  }
  if (evidence?.kind === "encounterCleared" && (typeof evidence.encounterId !== "string" || evidence.encounterId.length === 0)) {
    return invalid("quest.completionEvidence.encounterId", "empty_id");
  }
  if (!condition || typeof condition !== "object") return invalid("quest.completionCondition", "not_object");
  if (condition.kind === "always") return success(true);
  if (condition.kind === "floorCleared") {
    if (!Number.isSafeInteger(condition.floorNumber) || condition.floorNumber < 1 || condition.floorNumber > 10) {
      return invalid("quest.completionCondition.floorNumber", "floor_range");
    }
    if (evidence !== undefined) {
      if (evidence.kind !== "floorCleared" || evidence.floorNumber !== condition.floorNumber) return success(false);
      return success(true);
    }
    // 没有结算事件时，floorCleared 可以由已持久化的楼层解锁前缀唯一反映。
    if (condition.floorNumber < 10) return success(world.highestUnlockedFloor > condition.floorNumber);
    return success(world.highestUnlockedFloor === 10 && world.clearedBossEncounterIds.length >= 10);
  }
  if (condition.kind === "encounterCleared") {
    if (typeof condition.encounterId !== "string" || condition.encounterId.length === 0) {
      return invalid("quest.completionCondition.encounterId", "empty_id");
    }
    // clearedBossEncounterIds 只保存 Boss 首通前缀，不能拿它猜测普通/精英遭遇。
    return success(evidence?.kind === "encounterCleared" && evidence.encounterId === condition.encounterId);
  }
  return invalid("quest.completionCondition.kind", "unknown_condition");
}

function resolveQuest(
  content: QuestContentSource,
  questId: QuestId,
): DomainResult<Readonly<QuestDefinition>> {
  if (!content || typeof content.getQuest !== "function") return invalid("content.getQuest", "getter_required");
  if (typeof questId !== "string" || questId.length === 0) return invalid("questId", "empty_id");
  try {
    const result = content.getQuest(questId);
    if (!result.ok) return result;
    if (result.value.id !== questId) return invalid(`quests.${questId}`, "id_mismatch");
    return result;
  } catch {
    return invalid(`quests.${questId}`, "getter_failed");
  }
}

/** 只评估明确的 completionCondition，不产生副作用。 */
export function evaluateQuest(
  content: QuestContentSource,
  questId: QuestId,
  world: WorldProgressV1,
  evidence?: QuestCompletionEvidence,
): DomainResult<QuestEvaluation> {
  const worldResult = validateWorldProjection(world);
  if (!worldResult.ok) return worldResult;
  const questResult = resolveQuest(content, questId);
  if (!questResult.ok) return questResult;
  const completed = world.completedQuestIds.includes(questId);
  const conditionResult = conditionMet(questResult.value.completionCondition, world, evidence);
  if (!conditionResult.ok) return conditionResult;
  return success({
    questId,
    condition: structuredClone(questResult.value.completionCondition),
    conditionMet: completed || conditionResult.value,
    alreadyCompleted: completed,
  });
}

/**
 * 生成任务完成后的 world 值。条件未满足时返回深拷贝但不追加任务，
 * 已完成时保持数组顺序和内容不变，保证重复结算幂等。
 */
export function completeQuest(
  content: QuestContentSource,
  questId: QuestId,
  world: WorldProgressV1,
  evidence?: QuestCompletionEvidence,
): DomainResult<WorldProgressV1> {
  const evaluation = evaluateQuest(content, questId, world, evidence);
  if (!evaluation.ok) return evaluation;
  const next = cloneWorld(world);
  if (evaluation.value.conditionMet && !evaluation.value.alreadyCompleted) next.completedQuestIds.push(questId);
  return success(next);
}

/** 只在新任务确实满足条件时调用一次原子保存回调。 */
export async function commitQuest(
  content: QuestContentSource,
  save: GameSaveV1,
  questId: QuestId,
  options: QuestCommitOptions,
  evidence?: QuestCompletionEvidence,
): Promise<DomainResult<GameSaveV1>> {
  if (!options || typeof options !== "object") return invalid("options", "not_object");
  if (!isRecord(save)) return invalid("save", "not_object");
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) {
    return invalid("options.expectedRevision", "revision");
  }
  if (typeof options.save !== "function") return invalid("options.save", "transaction_required");
  const evaluation = evaluateQuest(content, questId, save.world, evidence);
  if (!evaluation.ok) return evaluation;
  if (!evaluation.value.conditionMet || evaluation.value.alreadyCompleted) return success(structuredClone(save));
  const worldResult = completeQuest(content, questId, save.world, evidence);
  if (!worldResult.ok) return worldResult;
  const nextSave = structuredClone(save);
  nextSave.world = worldResult.value;
  try {
    return await options.save(options.expectedRevision, nextSave);
  } catch {
    return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
  }
}

export class QuestService {
  private readonly content: QuestContentSource;

  public constructor(content: QuestContentSource) {
    this.content = content;
  }

  public evaluate(questId: QuestId, world: WorldProgressV1, evidence?: QuestCompletionEvidence): DomainResult<QuestEvaluation> {
    return evaluateQuest(this.content, questId, world, evidence);
  }

  public complete(questId: QuestId, world: WorldProgressV1, evidence?: QuestCompletionEvidence): DomainResult<WorldProgressV1> {
    return completeQuest(this.content, questId, world, evidence);
  }

  public commit(questId: QuestId, save: GameSaveV1, options: QuestCommitOptions, evidence?: QuestCompletionEvidence): Promise<DomainResult<GameSaveV1>> {
    return commitQuest(this.content, save, questId, options, evidence);
  }
}
