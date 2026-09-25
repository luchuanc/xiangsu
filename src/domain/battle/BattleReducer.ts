/**
 * 战斗快照的最小纯 reducer。
 *
 * 本文件只推进 RPG-013 冻结的阶段和队列边界，不结算伤害、技能或奖励。
 * 所有输入先复制，失败不会修改调用方持有的 BattleSnapshot。
 */
import type {
  AbyssEchoDefinition,
  BattlePhase,
  BattleSnapshotV1,
  BattleUnitStateV1,
  EnemyDefinition,
  StatBlock,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import { buildInitiativeSnapshot } from "./Initiative";
import {
  cloneBattleSnapshot,
  type BattleReducerEvent,
  type BattleReducerOptions,
} from "./BattleTypes";

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function invalidPhase(expected: BattlePhase[], actual: BattlePhase): DomainResult<never> {
  return failure(createDomainError("INVALID_BATTLE_PHASE", { expected, actual }));
}

function isAlive(unit: BattleUnitStateV1): boolean {
  return unit.currentHp > 0;
}

function cloneStats(stats: StatBlock): StatBlock {
  return { ...stats };
}

function cloneUnit(unit: BattleUnitStateV1): BattleUnitStateV1 {
  return {
    ...unit,
    prePercentStats: cloneStats(unit.prePercentStats),
    staticPercentByStatBps: cloneStats(unit.staticPercentByStatBps),
    stats: cloneStats(unit.stats),
    cooldowns: { ...unit.cooldowns },
    statuses: unit.statuses.map((status) => ({ ...status })),
    directHitEnergyRootActionIds: [...unit.directHitEnergyRootActionIds],
  };
}

function findUnit(snapshot: BattleSnapshotV1, unitId: string): BattleUnitStateV1 | undefined {
  return snapshot.units.find((unit) => unit.unitId === unitId);
}

/** 只在该单位自己的 TURN_END 递减冷却；非法快照值不能被静默修复。 */
function decrementCurrentUnitCooldowns(snapshot: BattleSnapshotV1): DomainResult<true> {
  if (!snapshot.currentUnitId) return invalid("currentUnitId", "required");
  const unit = findUnit(snapshot, snapshot.currentUnitId);
  if (!unit) return invalid("currentUnitId", "missing_unit");
  for (const [skillId, cooldown] of Object.entries(unit.cooldowns)) {
    if (skillId.length === 0) return invalid(`units.${unit.unitId}.cooldowns`, "skill_id");
    if (!Number.isSafeInteger(cooldown) || cooldown < 0) {
      return invalid(`units.${unit.unitId}.cooldowns.${skillId}`, "cooldown");
    }
    unit.cooldowns[skillId] = Math.max(0, cooldown - 1);
  }
  return success(true);
}

function aliveFaction(snapshot: BattleSnapshotV1, faction: "party" | "enemy"): boolean {
  return snapshot.units.some((unit) => unit.faction === faction && isAlive(unit));
}

function expectedForCommand(): BattlePhase[] {
  return ["AWAIT_COMMAND", "AI_DECIDE", "VALIDATE"];
}

function expectedForOngoing(): BattlePhase[] {
  return [
    "INIT",
    "ROUND_START",
    "TURN_START",
    "AWAIT_COMMAND",
    "AI_DECIDE",
    "VALIDATE",
    "DRAIN_PRE_ACTION",
    "RESOLVE_ACTION",
    "DRAIN_TRIGGERS",
    "TURN_END",
    "ROUND_END",
  ];
}

function skipTurnStatus(
  unit: BattleUnitStateV1,
  options: BattleReducerOptions,
): DomainResult<boolean> {
  for (const [index, status] of unit.statuses.entries()) {
    if (!status || typeof status.statusId !== "string" || status.statusId.length === 0) {
      return invalid(`units.${unit.unitId}.statuses[${index}]`, "status_id");
    }
    if (options.isSkipTurnStatus) {
      if (options.isSkipTurnStatus(status)) return success(true);
      continue;
    }
    if (options.getStatus) {
      let result: ReturnType<NonNullable<BattleReducerOptions["getStatus"]>>;
      try {
        result = options.getStatus(status.statusId);
      } catch {
        return invalid(`units.${unit.unitId}.statuses[${index}]`, "status_getter_failed");
      }
      if (!result.ok || result.value.id !== status.statusId) {
        return invalid(`units.${unit.unitId}.statuses[${index}]`, "missing_status");
      }
      if (result.value.effect.kind === "skipTurn") return success(true);
      continue;
    }
    // 没有状态表时只识别冻结表中明确的两种控制状态，不猜测其他 ID。
    if (status.statusId === "status_freeze" || status.statusId === "status_stun") return success(true);
  }
  return success(false);
}

/** TURN_START 的控制判定前精确移除 guard；其它状态和输入结构保持不变。 */
function removeGuardBeforeControl(
  unit: Readonly<BattleUnitStateV1>,
  options: BattleReducerOptions,
): DomainResult<BattleUnitStateV1> {
  const next = cloneUnit(unit);
  const retained: BattleUnitStateV1["statuses"] = [];
  for (const [index, status] of next.statuses.entries()) {
    if (options.getStatus) {
      let result: ReturnType<NonNullable<BattleReducerOptions["getStatus"]>>;
      try {
        result = options.getStatus(status.statusId);
      } catch {
        return invalid(`units.${unit.unitId}.statuses[${index}]`, "status_getter_failed");
      }
      if (!result.ok || result.value.id !== status.statusId) {
        return invalid(`units.${unit.unitId}.statuses[${index}]`, "missing_status");
      }
    }
    if (status.statusId !== "status_guard_30") retained.push(status);
  }
  next.statuses = retained;
  return success(next);
}

function makeDefaultSummonedUnit(
  enemy: Readonly<EnemyDefinition>,
  slot: number,
  eligibleRound: number,
  unitId: string,
): BattleUnitStateV1 {
  const zeroPercent: Record<keyof StatBlock, number> = {
    maxHp: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    critRateBps: 0,
    critDamageBps: 0,
    effectHitBps: 0,
    effectResistBps: 0,
  };
  return {
    unitId,
    definitionId: enemy.id,
    faction: "enemy",
    slot,
    level: enemy.level,
    prePercentStats: cloneStats(enemy.stats),
    staticPercentByStatBps: zeroPercent,
    stats: cloneStats(enemy.stats),
    currentHp: enemy.stats.maxHp,
    energy: 0,
    cooldowns: Object.fromEntries([enemy.basicSkillId, ...enemy.skillIds].map((id) => [id, 0])),
    statuses: [],
    eligibleRound,
    usedExtraTurnThisRound: false,
    directHitEnergyRootActionIds: [],
  };
}

function nextSummonUnitId(snapshot: BattleSnapshotV1, enemyId: string, slot: number): string {
  const base = `enemy:${slot}`;
  if (!snapshot.units.some((unit) => unit.unitId === base)) return base;
  let index = 1;
  while (snapshot.units.some((unit) => unit.unitId === `${base}:${index}`)) index += 1;
  return `${base}:${index}`;
}

function validateSummonedUnit(unit: BattleUnitStateV1, path: string): DomainResult<true> {
  if (!unit || typeof unit !== "object") return invalid(path, "not_object");
  if (typeof unit.unitId !== "string" || unit.unitId.length === 0) return invalid(`${path}.unitId`, "empty_id");
  if (typeof unit.definitionId !== "string" || unit.definitionId.length === 0) return invalid(`${path}.definitionId`, "empty_id");
  if (unit.faction !== "enemy") return invalid(`${path}.faction`, "summon_must_be_enemy");
  if (!Number.isSafeInteger(unit.slot) || unit.slot < 0) return invalid(`${path}.slot`, "slot");
  if (!Number.isSafeInteger(unit.currentHp) || unit.currentHp < 0) return invalid(`${path}.currentHp`, "current_hp");
  if (!Number.isSafeInteger(unit.stats?.maxHp) || unit.stats.maxHp < 1) return invalid(`${path}.stats.maxHp`, "max_hp");
  return success(true);
}

function applySummon(
  snapshot: BattleSnapshotV1,
  event: Extract<BattleReducerEvent, { type: "UNIT_SUMMONED" }>,
  options: BattleReducerOptions,
): DomainResult<BattleSnapshotV1> {
  const next = cloneBattleSnapshot(snapshot);
  const currentRound = Math.max(0, next.round);
  const eligibleRound = currentRound + 1;

  // 直接注入完整单位主要用于测试和未来内容层的已解析召唤 preset。
  if ("unit" in event) {
    const unitResult = validateSummonedUnit(event.unit, "event.unit");
    if (!unitResult.ok) return unitResult;
    if (findUnit(next, event.unit.unitId)) return invalid("event.unit.unitId", "duplicate_id");
    const occupied = next.units.some((value) => value.faction === "enemy" && value.slot === event.unit.slot && isAlive(value));
    if (occupied) return success(next);
    const unit = cloneUnit(event.unit);
    unit.eligibleRound = eligibleRound;
    next.units.push(unit);
    return success(next);
  }

  let enemy: Readonly<EnemyDefinition> | undefined;
  if ("enemy" in event) {
    enemy = event.enemy;
    if (!enemy || enemy.id !== event.enemy.id) return invalid("event.enemy", "id_mismatch");
  } else {
    if (!options.getEnemy) return invalid("event.enemyId", "getter_required");
    let enemyResult: ReturnType<NonNullable<BattleReducerOptions["getEnemy"]>>;
    try {
      enemyResult = options.getEnemy(event.enemyId);
    } catch {
      return invalid("event.enemyId", "getter_failed");
    }
    if (!enemyResult.ok || enemyResult.value.id !== event.enemyId) return invalid("event.enemyId", "missing_reference");
    enemy = enemyResult.value;
  }
  if (!enemy || typeof enemy.id !== "string" || enemy.id.length === 0) return invalid("event.enemyId", "empty_id");
  if (!Array.isArray(event.preferredSlots)) return invalid("event.preferredSlots", "array_required");
  if (!Number.isSafeInteger(event.maxAliveCopies) || event.maxAliveCopies < 0) return invalid("event.maxAliveCopies", "max_alive_copies");

  const preferredSlots: number[] = [];
  for (const [index, slot] of event.preferredSlots.entries()) {
    if (!Number.isSafeInteger(slot) || slot < 0) return invalid(`event.preferredSlots[${index}]`, "slot");
    if (!preferredSlots.includes(slot)) preferredSlots.push(slot);
  }
  let aliveCopies = next.units.filter((unit) => unit.faction === "enemy" && unit.definitionId === enemy.id && isAlive(unit)).length;
  for (const slot of preferredSlots) {
    if (aliveCopies >= event.maxAliveCopies) break;
    if (next.units.some((unit) => unit.faction === "enemy" && unit.slot === slot && isAlive(unit))) continue;

    const unitId = nextSummonUnitId(next, enemy.id, slot);
    let resolved: DomainResult<BattleUnitStateV1>;
    if (options.resolveSummonedUnit) {
      try {
        resolved = options.resolveSummonedUnit(enemy, slot, eligibleRound);
      } catch {
        return invalid(`event.preferredSlots[${slot}]`, "resolver_failed");
      }
      if (!resolved.ok) return resolved;
      const valid = validateSummonedUnit(resolved.value, `event.preferredSlots[${slot}]`);
      if (!valid.ok) return valid;
      if (resolved.value.definitionId !== enemy.id) return invalid(`event.preferredSlots[${slot}]`, "definition_mismatch");
    } else {
      resolved = success(makeDefaultSummonedUnit(enemy, slot, eligibleRound, unitId));
    }
    const unit = cloneUnit(resolved.value);
    // 槽位和可行动回合由本次召唤规则决定，不能让内容 preset 偷渡进当前队列。
    unit.slot = slot;
    unit.eligibleRound = eligibleRound;
    if (findUnit(next, unit.unitId)) return invalid(`event.preferredSlots[${slot}]`, "duplicate_id");
    next.units.push(unit);
    aliveCopies += 1;
  }
  return success(next);
}

function selectNextTurnUnit(next: BattleSnapshotV1, options: BattleReducerOptions): DomainResult<BattleSnapshotV1> {
  const queue = next.initiativeQueueUnitIds.filter((unitId, index, values) => values.indexOf(unitId) === index);
  while (queue.length > 0) {
    const unitId = queue.shift()!;
    const unit = findUnit(next, unitId);
    if (!unit || !isAlive(unit) || unit.eligibleRound > next.round) continue;
    next.initiativeQueueUnitIds = queue;
    next.currentUnitId = unit.unitId;
    const guardRemoved = removeGuardBeforeControl(unit, options);
    if (!guardRemoved.ok) return guardRemoved;
    const selected = guardRemoved.value;
    const selectedIndex = next.units.findIndex((value) => value.unitId === selected.unitId);
    if (selectedIndex < 0) return invalid(`units.${selected.unitId}`, "missing_unit");
    next.units[selectedIndex] = selected;
    const control = skipTurnStatus(selected, options);
    if (!control.ok) return control;
    next.phase = control.value ? "RESOLVE_ACTION" : selected.faction === "party" ? "AWAIT_COMMAND" : "AI_DECIDE";
    return success(next);
  }
  next.initiativeQueueUnitIds = [];
  next.currentUnitId = null;
  next.phase = "ROUND_END";
  return success(next);
}

function reduceBattleInternal(
  snapshot: BattleSnapshotV1,
  event: BattleReducerEvent,
  options: BattleReducerOptions,
): DomainResult<BattleSnapshotV1> {
  if (!snapshot || typeof snapshot !== "object") return invalid("snapshot", "not_object");
  if (!event || typeof event !== "object" || typeof event.type !== "string") return invalid("event", "not_object");
  const next = cloneBattleSnapshot(snapshot);

  switch (event.type) {
    case "ROUND_START": {
      if (next.phase !== "INIT" && next.phase !== "ROUND_END") return invalidPhase(["INIT", "ROUND_END"], next.phase);
      if (!aliveFaction(next, "party") || !aliveFaction(next, "enemy")) {
        return invalid("snapshot.units", "round_requires_both_factions_alive");
      }
      next.round = next.round === 0 ? 1 : next.round + 1;
      const initiative = buildInitiativeSnapshot(next.units, next.round, { getStatus: options.getStatus });
      if (!initiative.ok) return initiative;
      next.initiativeQueueUnitIds = [...initiative.value.queueUnitIds];
      next.currentUnitId = null;
      next.roundTriggerCounts = {};
      next.phase = "ROUND_START";
      return success(next);
    }
    case "TURN_START": {
      // TURN_END 已经完成当前单位的冷却递减；TURN_START 只消费队列并执行控制判定，
      // 不能再次递减冷却或重复建立速度快照。
      if (next.phase !== "ROUND_START" && next.phase !== "TURN_END" && next.phase !== "TURN_START") {
        return invalidPhase(["ROUND_START", "TURN_END", "TURN_START"], next.phase);
      }
      return selectNextTurnUnit(next, options);
    }
    case "COMMAND_VALID": {
      if (!expectedForCommand().includes(next.phase)) return invalidPhase(expectedForCommand(), next.phase);
      if (!next.currentUnitId) return invalid("currentUnitId", "required");
      const current = findUnit(next, next.currentUnitId);
      if (!current || !isAlive(current)) return invalid("currentUnitId", "not_alive");
      next.phase = "DRAIN_PRE_ACTION";
      return success(next);
    }
    case "COMMAND_INVALID": {
      if (!expectedForCommand().includes(next.phase)) return invalidPhase(expectedForCommand(), next.phase);
      // 非法指令不消费队列、RNG 或快照版本；只把我方重新留在等待输入阶段。
      next.phase = findUnit(next, next.currentUnitId ?? "")?.faction === "enemy" ? "AI_DECIDE" : "AWAIT_COMMAND";
      return success(next);
    }
    case "DRAIN_PRE_ACTION_COMPLETE": {
      if (next.phase !== "DRAIN_PRE_ACTION") return invalidPhase(["DRAIN_PRE_ACTION"], next.phase);
      next.phase = "RESOLVE_ACTION";
      return success(next);
    }
    case "RESOLVE_ACTION_COMPLETE": {
      if (next.phase !== "RESOLVE_ACTION") return invalidPhase(["RESOLVE_ACTION"], next.phase);
      next.phase = "DRAIN_TRIGGERS";
      return success(next);
    }
    case "DRAIN_TRIGGERS_COMPLETE": {
      if (next.phase !== "DRAIN_TRIGGERS") return invalidPhase(["DRAIN_TRIGGERS"], next.phase);
      // 失败优先：我方全灭时不能因为敌方也恰好归零而判胜。
      if (!aliveFaction(next, "party")) {
        next.outcome = "defeat";
        next.phase = "DEFEAT";
      } else if (!aliveFaction(next, "enemy")) {
        next.outcome = "victory";
        next.phase = "VICTORY";
      } else {
        next.phase = "TURN_END";
      }
      return success(next);
    }
    case "TURN_END": {
      if (next.phase !== "TURN_END" && next.phase !== "VICTORY" && next.phase !== "DEFEAT") {
        return invalidPhase(["TURN_END", "VICTORY", "DEFEAT"], next.phase);
      }
      if (next.phase === "VICTORY") {
        next.phase = "REWARD_PENDING";
        return success(next);
      }
      if (next.phase === "DEFEAT") {
        next.phase = "COMPLETE";
        return success(next);
      }
      const cooldownResult = decrementCurrentUnitCooldowns(next);
      if (!cooldownResult.ok) return cooldownResult;
      next.currentUnitId = null;
      next.phase = next.initiativeQueueUnitIds.length > 0 ? "TURN_START" : "ROUND_END";
      return success(next);
    }
    case "ROUND_END": {
      if (next.phase !== "ROUND_END" && next.phase !== "REWARD_PENDING") {
        return invalidPhase(["ROUND_END", "REWARD_PENDING"], next.phase);
      }
      if (next.phase === "REWARD_PENDING") {
        next.phase = "COMPLETE";
        return success(next);
      }
      if (!aliveFaction(next, "party") || !aliveFaction(next, "enemy")) {
        return invalid("snapshot.units", "round_requires_both_factions_alive");
      }
      next.round += 1;
      const initiative = buildInitiativeSnapshot(next.units, next.round, { getStatus: options.getStatus });
      if (!initiative.ok) return initiative;
      next.initiativeQueueUnitIds = [...initiative.value.queueUnitIds];
      next.currentUnitId = null;
      next.roundTriggerCounts = {};
      next.phase = "ROUND_START";
      return success(next);
    }
    case "UNIT_DEFEATED": {
      if (!expectedForOngoing().includes(next.phase) || next.outcome !== "ongoing") return invalidPhase(expectedForOngoing(), next.phase);
      if (typeof event.unitId !== "string" || event.unitId.length === 0) return invalid("event.unitId", "empty_id");
      const index = next.units.findIndex((unit) => unit.unitId === event.unitId);
      if (index < 0) return invalid("event.unitId", "missing_unit");
      next.units[index].currentHp = 0;
      next.initiativeQueueUnitIds = next.initiativeQueueUnitIds.filter((unitId) => unitId !== event.unitId);
      return success(next);
    }
    case "UNIT_SUMMONED": {
      if (!expectedForOngoing().includes(next.phase) || next.outcome !== "ongoing") return invalidPhase(expectedForOngoing(), next.phase);
      return applySummon(next, event, options);
    }
    case "SPEED_CHANGED": {
      if (!expectedForOngoing().includes(next.phase) || next.outcome !== "ongoing") return invalidPhase(expectedForOngoing(), next.phase);
      if (typeof event.unitId !== "string" || event.unitId.length === 0) return invalid("event.unitId", "empty_id");
      if (!Number.isSafeInteger(event.speed) || event.speed < 1) return invalid("event.speed", "speed");
      const unit = findUnit(next, event.unitId);
      if (!unit) return invalid("event.unitId", "missing_unit");
      unit.stats.speed = event.speed;
      return success(next);
    }
    case "RETREAT": {
      if (next.phase === "RETREAT") {
        next.phase = "COMPLETE";
        return success(next);
      }
      if (next.phase !== "AWAIT_COMMAND" && next.phase !== "AI_DECIDE" && next.phase !== "VALIDATE") {
        return invalidPhase(["AWAIT_COMMAND", "AI_DECIDE", "VALIDATE"], next.phase);
      }
      next.outcome = "retreat";
      next.phase = "RETREAT";
      return success(next);
    }
    default:
      return invalid("event.type", "unsupported");
  }
}

/** 纯函数入口：成功返回全新快照，失败和输入快照均不发生副作用。 */
export function reduceBattle(
  snapshot: BattleSnapshotV1,
  event: BattleReducerEvent,
  options: BattleReducerOptions = {},
): DomainResult<BattleSnapshotV1> {
  try {
    return reduceBattleInternal(snapshot, event, options);
  } catch {
    return invalid("battle", "reducer_exception");
  }
}

/** 便于应用层注入状态表和召唤解析器的无状态 facade。 */
export class BattleReducer {
  private readonly options: BattleReducerOptions;

  public constructor(options: BattleReducerOptions = {}) {
    this.options = options;
  }

  public reduce(snapshot: BattleSnapshotV1, event: BattleReducerEvent): DomainResult<BattleSnapshotV1> {
    return reduceBattle(snapshot, event, this.options);
  }
}

export const applyBattleEvent = reduceBattle;

export interface AbyssEchoObjectiveEvaluation {
  readonly success: boolean;
  readonly failedReasons: Array<"MAX_ROUNDS" | "MAX_KNOCKOUTS" | "COMBO_REQUIRED">;
}

export interface AbyssEchoObjectiveMetrics {
  readonly round?: number;
  readonly knockouts?: number;
  readonly comboTriggers?: number;
}

/** 回响终局目标按合同固定顺序评估，不改写战斗快照。 */
export function evaluateAbyssEchoOutcome(
  snapshot: Readonly<BattleSnapshotV1>,
  echo: Readonly<AbyssEchoDefinition>,
  metrics: AbyssEchoObjectiveMetrics = {},
): DomainResult<AbyssEchoObjectiveEvaluation> {
  if (!snapshot || !echo) return invalid("abyssEcho", "required");
  const round = metrics.round ?? snapshot.round;
  const knockouts = metrics.knockouts ?? snapshot.metrics.knockouts.length;
  const comboTriggers = metrics.comboTriggers ?? Object.values(snapshot.metrics.comboTriggerCounts).reduce((total, count) => total + count, 0);
  if (![round, knockouts, comboTriggers].every((value) => Number.isSafeInteger(value) && value >= 0)) return invalid("abyssEcho.objective", "metric_range");
  const failedReasons: AbyssEchoObjectiveEvaluation["failedReasons"] = [];
  if (round > echo.objective.maxRounds) failedReasons.push("MAX_ROUNDS");
  if (knockouts > echo.objective.maxKnockouts) failedReasons.push("MAX_KNOCKOUTS");
  if (echo.objective.requiredAnyComboTriggers === 1 && comboTriggers < 1) failedReasons.push("COMBO_REQUIRED");
  return success({ success: failedReasons.length === 0, failedReasons });
}

/** 只把已评估的回响结果写入复制快照，终局协调器随后负责回城/奖励事务。 */
export function applyAbyssEchoOutcome(
  snapshot: Readonly<BattleSnapshotV1>,
  echo: Readonly<AbyssEchoDefinition>,
  metrics: AbyssEchoObjectiveMetrics = {},
): DomainResult<BattleSnapshotV1> {
  const evaluation = evaluateAbyssEchoOutcome(snapshot, echo, metrics);
  if (!evaluation.ok) return evaluation;
  const next = cloneBattleSnapshot(snapshot);
  next.abyssEchoOutcome = evaluation.value.success ? "success" : "failed";
  next.outcome = snapshot.outcome === "ongoing" ? "victory" : snapshot.outcome;
  next.phase = "COMPLETE";
  return success(next);
}

/** 深渊回响的狂暴阈值只读取显式 delta，不从 echo ID 或楼层号推导。 */
export function resolveAbyssEchoEnrageRound(baseRound: number, echo: Readonly<AbyssEchoDefinition>): number {
  if (!Number.isSafeInteger(baseRound) || baseRound < 1) throw new RangeError("baseRound 必须是正整数");
  return Math.max(1, baseRound + echo.enrageRoundDelta);
}
