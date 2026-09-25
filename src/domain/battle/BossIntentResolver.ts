/**
 * Boss 意图的声明、释放和清除。
 *
 * 意图只保存技能与 targetStrategy，不锁定具体 unitId。声明是一个不产生
 * 伤害/资源的根行动；释放时再由调用方按当前快照解析目标，来源死亡或终局
 * 只清除 pending，不伪造一次技能伤害。
 */
import type {
  BattleDomainEventV1,
  BattleSnapshotV1,
  BossIntentDefinition,
  PendingBossIntentV1,
  SkillDefinition,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";

export interface BossIntentEventResult {
  readonly snapshot: BattleSnapshotV1;
  readonly events: readonly BattleDomainEventV1[];
}

export interface DeclareBossIntentInput {
  readonly snapshot: Readonly<BattleSnapshotV1>;
  readonly sourceUnitId: string;
  readonly definition: Readonly<BossIntentDefinition>;
  readonly intentId?: string;
  readonly rootActionId?: string;
}

export interface BossIntentContentSource {
  getSkill(id: string): DomainResult<Readonly<SkillDefinition>>;
}

export interface ReleaseBossIntentInput {
  readonly snapshot: Readonly<BattleSnapshotV1>;
  readonly sourceUnitId: string;
  readonly content: BossIntentContentSource;
  readonly rng?: unknown;
  readonly rootActionId?: string;
}

export interface ClearBossIntentInput {
  readonly snapshot: Readonly<BattleSnapshotV1>;
  readonly sourceUnitId?: string;
  readonly reason: "sourceDefeated" | "battleFinished";
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function base(
  snapshot: Readonly<BattleSnapshotV1>,
  eventId: string,
  sequence: number,
  rootActionId: string | null,
  rootActionDefinitionId: BattleDomainEventV1["rootActionDefinitionId"],
): Omit<Extract<BattleDomainEventV1, { type: "ACTION_STARTED" }>, "type" | "actorUnitId" | "actionKind" | "targetUnitIds"> {
  return {
    eventId,
    sequence,
    battleId: snapshot.battleId,
    round: snapshot.round,
    rootActionId,
    rootActionDefinitionId,
    chainDepth: 0,
    triggerSource: null,
    visualSkillId: null,
    contextSkillKind: null,
    effect: null,
  };
}

function cloneSnapshot(snapshot: Readonly<BattleSnapshotV1>): BattleSnapshotV1 {
  return structuredClone(snapshot);
}

function sortIntents(intents: readonly PendingBossIntentV1[]): PendingBossIntentV1[] {
  return [...intents].sort((left, right) => left.sourceUnitId < right.sourceUnitId ? -1 : left.sourceUnitId > right.sourceUnitId ? 1 : 0);
}

function validateDefinition(snapshot: Readonly<BattleSnapshotV1>, sourceUnitId: string, definition: Readonly<BossIntentDefinition>): DomainResult<true> {
  const source = snapshot.units.find((unit) => unit.unitId === sourceUnitId);
  if (!source) return invalid("bossIntent.sourceUnitId", "missing_source");
  if (!source || source.faction !== "enemy" || source.definitionId !== definition.bossId) return invalid("bossIntent.bossId", "source_mismatch");
  if (!Number.isSafeInteger(definition.delayLegalActions) || definition.delayLegalActions !== 1) return invalid(`bossIntents.${definition.id}.delayLegalActions`, "must_be_one");
  if (!definition.id || !definition.skillId) return invalid("bossIntent", "id_required");
  if (snapshot.pendingBossIntents.some((intent) => intent.sourceUnitId === sourceUnitId)) return invalid(`battle.pendingBossIntents.${sourceUnitId}`, "already_pending");
  return success(true);
}

/** 建立固定三事件的声明根行动。 */
export function declareBossIntent(input: DeclareBossIntentInput): DomainResult<BossIntentEventResult> {
  const valid = validateDefinition(input.snapshot, input.sourceUnitId, input.definition);
  if (!valid.ok) return valid;
  const source = input.snapshot.units.find((unit) => unit.unitId === input.sourceUnitId)!;
  if (source.currentHp <= 0) return invalid("bossIntent.sourceUnitId", "dead_source");
  const next = cloneSnapshot(input.snapshot);
  const intentId = input.intentId ?? `${next.battleId}:intent:${next.battleRevision}`;
  const rootActionId = input.rootActionId ?? `${next.battleId}:root:intent:${next.battleRevision}`;
  if (next.pendingBossIntents.some((intent) => intent.intentId === intentId)) return invalid("bossIntent.intentId", "duplicate_id");
  next.pendingBossIntents = sortIntents([...next.pendingBossIntents, {
    intentId,
    sourceUnitId: input.sourceUnitId,
    skillId: input.definition.skillId,
    targetStrategy: input.definition.targetStrategy,
    declaredRound: next.round,
  }]);
  next.battleRevision += 1;
  const common = base(next, `${rootActionId}:event:0`, 0, rootActionId, "action_declare_intent");
  const events: BattleDomainEventV1[] = [
    { ...common, type: "ACTION_STARTED", actorUnitId: input.sourceUnitId, actionKind: "intent", targetUnitIds: [] },
    { ...common, eventId: `${rootActionId}:event:1`, sequence: 1, type: "INTENT_DECLARED", intentId, sourceUnitId: input.sourceUnitId, skillId: input.definition.skillId, targetStrategy: input.definition.targetStrategy },
    { ...common, eventId: `${rootActionId}:event:2`, sequence: 2, type: "ACTION_FINISHED", actorUnitId: input.sourceUnitId, outcomeAfter: "ongoing" },
  ];
  return success({ snapshot: next, events });
}

function getSkill(content: BossIntentContentSource, id: string): DomainResult<Readonly<SkillDefinition>> {
  try {
    const result = content.getSkill(id);
    if (!result.ok) return result;
    if (result.value.id !== id) return invalid(`skills.${id}`, "id_mismatch");
    if (result.value.kind === "passive" || result.value.kind === "effect") return invalid(`skills.${id}`, "intent_skill_kind");
    return result;
  } catch {
    return invalid(`skills.${id}`, "getter_failed");
  }
}

/** 释放 pending 意图；具体 effect/目标由 ActionResolver 在同一根行动继续完成。 */
export function releaseBossIntent(input: ReleaseBossIntentInput): DomainResult<BossIntentEventResult> {
  const pending = input.snapshot.pendingBossIntents.find((intent) => intent.sourceUnitId === input.sourceUnitId);
  if (!pending) return invalid(`battle.pendingBossIntents.${input.sourceUnitId}`, "missing_intent");
  const source = input.snapshot.units.find((unit) => unit.unitId === input.sourceUnitId);
  if (!source || source.currentHp <= 0) return clearBossIntent({ snapshot: input.snapshot, sourceUnitId: input.sourceUnitId, reason: "sourceDefeated" });
  const skill = getSkill(input.content, pending.skillId);
  if (!skill.ok) return skill;
  const next = cloneSnapshot(input.snapshot);
  next.pendingBossIntents = next.pendingBossIntents.filter((intent) => intent.sourceUnitId !== input.sourceUnitId);
  next.battleRevision += 1;
  const rootActionId = input.rootActionId ?? `${next.battleId}:root:intent-release:${next.battleRevision}`;
  const common = base(next, `${rootActionId}:event:0`, 0, rootActionId, skill.value.id);
  const events: BattleDomainEventV1[] = [
    { ...common, type: "ACTION_STARTED", actorUnitId: input.sourceUnitId, actionKind: skill.value.kind === "ultimate" ? "ultimate" : "active", targetUnitIds: [] , visualSkillId: skill.value.id, contextSkillKind: skill.value.kind === "ultimate" ? "ultimate" : "active" },
    { ...common, eventId: `${rootActionId}:event:1`, sequence: 1, type: "INTENT_RELEASED", intentId: pending.intentId, sourceUnitId: input.sourceUnitId, skillId: pending.skillId },
  ];
  return success({ snapshot: next, events });
}

/** 来源死亡或终局时幂等清除 pending 意图。 */
export function clearBossIntent(input: ClearBossIntentInput): DomainResult<BossIntentEventResult> {
  const pending = input.snapshot.pendingBossIntents.filter((intent) => input.sourceUnitId === undefined || intent.sourceUnitId === input.sourceUnitId);
  if (pending.length === 0) return success({ snapshot: cloneSnapshot(input.snapshot), events: [] });
  const next = cloneSnapshot(input.snapshot);
  next.pendingBossIntents = next.pendingBossIntents.filter((intent) => !pending.some((value) => value.intentId === intent.intentId));
  const events: BattleDomainEventV1[] = pending.map((intent, index) => {
    const rootActionId = `${next.battleId}:intent-clear:${next.battleRevision}:${index}`;
    return {
      ...base(next, `${rootActionId}:event:0`, index, null, null),
      type: "INTENT_CLEARED",
      intentId: intent.intentId,
      sourceUnitId: intent.sourceUnitId,
      reason: input.reason,
    };
  });
  return success({ snapshot: next, events });
}

/** 狂暴已达到条件时固定抢占 pending 意图和常规 AI。 */
export function selectBossPriority(input: { readonly enrageReady: boolean; readonly pendingIntent: boolean }): "enrage" | "intent" | "normal" {
  if (input.enrageReady) return "enrage";
  if (input.pendingIntent) return "intent";
  return "normal";
}

export const resolveBossIntent = declareBossIntent;
