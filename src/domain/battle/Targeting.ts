/**
 * 战斗目标解析只读取 BattleSnapshot 和显式 targetRule。
 * View 层传入的目标 ID 只能用于单体命令校验，群体/随机目标由此处生成。
 */
import type { BattleSnapshotV1, BattleUnitStateV1, TargetRule } from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import { SeededRng } from "../common/SeededRng";

export interface TargetingInput {
  readonly snapshot: Readonly<BattleSnapshotV1>;
  readonly actorUnitId: string;
  readonly targetRule: TargetRule;
  readonly targetUnitIds?: readonly string[];
  readonly requiresFrontAccess?: boolean;
  readonly rng?: SeededRng;
}

export interface TargetingResult {
  readonly targetUnitIds: readonly string[];
  readonly candidates: readonly string[];
}

export interface PrimaryTargetResult {
  readonly targetUnitId: string;
  readonly candidates: readonly string[];
}

function invalidTarget(
  reason: "COUNT" | "DEAD" | "FULL_HP" | "WRONG_FACTION" | "UNKNOWN" | "TAUNTED",
  targetUnitId: string | null,
): DomainResult<never> {
  return failure(createDomainError("INVALID_TARGET", { reason, targetUnitId }));
}

function formationBlocked(targetUnitId: string): DomainResult<never> {
  return failure(createDomainError("FORMATION_BLOCKED", { targetUnitId }));
}

function actorOf(snapshot: Readonly<BattleSnapshotV1>, actorUnitId: string): BattleUnitStateV1 | undefined {
  return snapshot.units.find((unit) => unit.unitId === actorUnitId);
}

function isAlive(unit: BattleUnitStateV1): boolean {
  return unit.currentHp > 0;
}

function isFront(unit: BattleUnitStateV1): boolean {
  // 角色槽位 0/1 是前排，敌人槽位 0/1/2 是前排；这是冻结阵型表的明确差异。
  return unit.faction === "party" ? unit.slot < 2 : unit.slot < 3;
}

function stableSort(units: readonly BattleUnitStateV1[]): BattleUnitStateV1[] {
  return [...units].sort((left, right) => left.slot - right.slot || (left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0));
}

function compareHpRatio(left: BattleUnitStateV1, right: BattleUnitStateV1): number {
  // 不计算浮点比例，使用 currentHp/effectiveMaxHp 的整数交叉相乘。
  const cross = left.currentHp * right.stats.maxHp - right.currentHp * left.stats.maxHp;
  return cross || left.slot - right.slot || (left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0);
}

function opposingFaction(actor: BattleUnitStateV1): "party" | "enemy" {
  return actor.faction === "party" ? "enemy" : "party";
}

function tauntSourceIds(
  snapshot: Readonly<BattleSnapshotV1>,
  actor: Readonly<BattleUnitStateV1>,
  selectable: readonly BattleUnitStateV1[],
): Set<string> {
  const sourceIds = new Set<string>();
  const faction = opposingFaction(actor);
  for (const target of snapshot.units) {
    if (target.faction !== faction) continue;
    for (const status of target.statuses) {
      if (status.statusId !== "status_taunt") continue;
      const source = snapshot.units.find((unit) => unit.unitId === status.sourceUnitId);
      // 嘲讽来源是 status 的施加者；来源必须存活且在其它规则过滤后的候选中。
      if (source && isAlive(source) && selectable.some((candidate) => candidate.unitId === source.unitId)) sourceIds.add(source.unitId);
    }
  }
  return sourceIds;
}

function legalCandidates(
  snapshot: Readonly<BattleSnapshotV1>,
  actor: BattleUnitStateV1,
  rule: TargetRule,
  requiresFrontAccess: boolean,
): DomainResult<BattleUnitStateV1[]> {
  if (rule === "self") return isAlive(actor) ? success([actor]) : invalidTarget("DEAD", actor.unitId);

  const sameFaction = rule === "singleAlly" || rule === "allAllies" || rule === "deadAlly";
  const faction = sameFaction ? actor.faction : opposingFaction(actor);
  let candidates = snapshot.units.filter((unit) => unit.faction === faction);
  if (rule === "deadAlly") {
    candidates = candidates.filter((unit) => !isAlive(unit));
  } else {
    candidates = candidates.filter(isAlive);
  }

  candidates = stableSort(candidates);
  if (requiresFrontAccess && candidates.some(isFront)) candidates = candidates.filter(isFront);

  if (rule === "singleEnemy" && candidates.length > 0) {
    const taunts = tauntSourceIds(snapshot, actor, candidates);
    if (taunts.size > 0) candidates = candidates.filter((unit) => taunts.has(unit.unitId));
  }

  return success(candidates);
}

function validateCommandShape(rule: TargetRule, targetUnitIds: readonly string[]): DomainResult<true> {
  const emptyRequired = rule === "self" || rule === "allAllies" || rule === "allEnemies" || rule === "randomEnemy";
  const singleRequired = rule === "singleAlly" || rule === "singleEnemy" || rule === "deadAlly";
  if ((emptyRequired && targetUnitIds.length !== 0) || (singleRequired && targetUnitIds.length !== 1)) return invalidTarget("COUNT", null);
  return success(true);
}

/** 返回按 faction 内 slot、unitId UTF-16 升序生成的合法候选。 */
export function getLegalTargetUnitIds(
  snapshot: Readonly<BattleSnapshotV1>,
  actorUnitId: string,
  targetRule: TargetRule,
  requiresFrontAccess = false,
): DomainResult<string[]> {
  const actor = actorOf(snapshot, actorUnitId);
  if (!actor) return invalidTarget("UNKNOWN", actorUnitId);
  const candidates = legalCandidates(snapshot, actor, targetRule, requiresFrontAccess);
  return candidates.ok ? success(candidates.value.map((unit) => unit.unitId)) : candidates;
}

/** 为 UI 自动辅助和效果覆盖 targetRule 选择主要目标；不消费 RNG。 */
export function selectPrimaryTarget(
  snapshot: Readonly<BattleSnapshotV1>,
  actorUnitId: string,
  targetRule: "singleAlly" | "singleEnemy" | "deadAlly",
  requiresFrontAccess = false,
): DomainResult<PrimaryTargetResult> {
  const actor = actorOf(snapshot, actorUnitId);
  if (!actor) return invalidTarget("UNKNOWN", actorUnitId);
  const candidates = legalCandidates(snapshot, actor, targetRule, requiresFrontAccess);
  if (!candidates.ok) return candidates;
  if (candidates.value.length === 0) return invalidTarget("UNKNOWN", null);
  const ordered = [...candidates.value].sort(compareHpRatio);
  return success({ targetUnitId: ordered[0].unitId, candidates: candidates.value.map((unit) => unit.unitId) });
}

/** 只校验命令目标数量和 ID，随机/群体目标的具体选择仍由 resolveTargets 负责。 */
export function validateTargetSelection(input: TargetingInput): DomainResult<true> {
  const targetUnitIds = input.targetUnitIds ?? [];
  const shape = validateCommandShape(input.targetRule, targetUnitIds);
  if (!shape.ok) return shape;
  const actor = actorOf(input.snapshot, input.actorUnitId);
  if (!actor) return invalidTarget("UNKNOWN", input.actorUnitId);
  if (!isAlive(actor)) return invalidTarget("DEAD", input.actorUnitId);
  if (input.targetRule === "self" || input.targetRule === "allAllies" || input.targetRule === "allEnemies" || input.targetRule === "randomEnemy") {
    const candidates = legalCandidates(input.snapshot, actor, input.targetRule, input.requiresFrontAccess ?? false);
    if (!candidates.ok) return candidates;
    if (candidates.value.length === 0) return invalidTarget("UNKNOWN", null);
    return success(true);
  }
  const candidates = legalCandidates(input.snapshot, actor, input.targetRule, input.requiresFrontAccess ?? false);
  if (!candidates.ok) return candidates;
  const requested = targetUnitIds[0];
  if (!input.snapshot.units.some((unit) => unit.unitId === requested)) return invalidTarget("UNKNOWN", requested ?? null);
  const target = input.snapshot.units.find((unit) => unit.unitId === requested)!;
  if (input.targetRule === "deadAlly" && isAlive(target)) return invalidTarget("DEAD", requested);
  if (input.targetRule !== "deadAlly" && !isAlive(target)) return invalidTarget("DEAD", requested);
  if (!candidates.value.some((unit) => unit.unitId === requested)) {
    // 嘲讽属于目标合法性；来源在其它规则下可选时，优先于后排阻挡返回 TAUNTED。
    if (input.targetRule === "singleEnemy" && snapshotHasTauntSource(input.snapshot, actor, candidates.value)) return invalidTarget("TAUNTED", requested);
    if (input.targetRule === "singleEnemy" && input.requiresFrontAccess && isFront(target) === false && candidates.value.some((unit) => isFront(unit))) return formationBlocked(requested);
    return invalidTarget(target.faction === actor.faction ? "WRONG_FACTION" : "UNKNOWN", requested);
  }
  return success(true);
}

function snapshotHasTauntSource(
  snapshot: Readonly<BattleSnapshotV1>,
  actor: Readonly<BattleUnitStateV1>,
  candidates: readonly BattleUnitStateV1[],
): boolean {
  return tauntSourceIds(snapshot, actor, candidates).size > 0;
}

/** 生成根 effect 的真实目标；randomEnemy 恰好消费一次注入 RNG。 */
export function resolveTargets(input: TargetingInput): DomainResult<TargetingResult> {
  const shape = validateTargetSelection(input);
  if (!shape.ok) return shape;
  const actor = actorOf(input.snapshot, input.actorUnitId);
  if (!actor) return invalidTarget("UNKNOWN", input.actorUnitId);
  const candidatesResult = legalCandidates(input.snapshot, actor, input.targetRule, input.requiresFrontAccess ?? false);
  if (!candidatesResult.ok) return candidatesResult;
  const candidates = candidatesResult.value.map((unit) => unit.unitId);
  if (input.targetRule === "self") return success({ targetUnitIds: [actor.unitId], candidates });
  if (input.targetRule === "singleAlly" || input.targetRule === "singleEnemy" || input.targetRule === "deadAlly") return success({ targetUnitIds: [input.targetUnitIds![0]], candidates });
  if (input.targetRule === "randomEnemy") {
    if (candidates.length === 0) return invalidTarget("UNKNOWN", null);
    const rng = input.rng;
    const index = rng ? rng.nextIntInclusive(0, candidates.length - 1) : 0;
    return success({ targetUnitIds: [candidates[index]], candidates });
  }
  return success({ targetUnitIds: candidates, candidates });
}

/** 中文调用方更直观的别名，保持同一严格实现。 */
export const resolveTargetRule = resolveTargets;
export const validateTargets = validateTargetSelection;
