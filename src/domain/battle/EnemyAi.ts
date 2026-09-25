/**
 * 配置驱动的敌方 AI。
 *
 * AI 只生成普通 BattleCommandV1，不直接修改 BattleSnapshot。技能归属、
 * 资源/冷却、TargetResolver 合法候选和固定 RNG 顺序均在这里严格收口，
 * 因此同一快照与 RNG 状态必然产生同一条命令。
 */
import type {
  AiCondition,
  BattleCommandV1,
  BattleSnapshotV1,
  BattleUnitStateV1,
  EnemyDefinition,
  EnemyTargetStrategy,
  RuntimeStatusStack,
  SkillDefinition,
  TargetRule,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import { SeededRng } from "../common/SeededRng";
import { getLegalTargetUnitIds } from "./Targeting";

export interface EnemyAiContentSource {
  getSkill(id: string): DomainResult<Readonly<SkillDefinition>>;
  readonly getStatus?: (id: string) => DomainResult<Readonly<{ id: string }>>;
}

export interface EnemyAiInput {
  readonly snapshot: Readonly<BattleSnapshotV1>;
  readonly actorUnitId: string;
  readonly enemy: Readonly<EnemyDefinition>;
  readonly content: EnemyAiContentSource;
  readonly rng: SeededRng;
}

export interface EnemyAiDecision {
  readonly command: BattleCommandV1;
  readonly skill: Readonly<SkillDefinition>;
  readonly skillKind: "basic" | "active" | "ultimate";
  readonly targetUnitIds: readonly string[];
  readonly candidateTargetUnitIds: readonly string[];
  readonly selectedRuleIndex: number | null;
  readonly usedFallback: boolean;
}

interface CandidateRule {
  readonly index: number;
  readonly rule: EnemyDefinition["aiRules"][number];
  readonly skill: Readonly<SkillDefinition>;
  readonly candidates: readonly string[];
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function unitOf(snapshot: Readonly<BattleSnapshotV1>, id: string): Readonly<BattleUnitStateV1> | undefined {
  return snapshot.units.find((unit) => unit.unitId === id);
}

function isAlive(unit: Readonly<BattleUnitStateV1>): boolean {
  return unit.currentHp > 0;
}

function statusesOf(unit: Readonly<BattleUnitStateV1>, statusId: string): readonly RuntimeStatusStack[] {
  return unit.statuses.filter((status) => status.statusId === statusId);
}

function hasStatus(unit: Readonly<BattleUnitStateV1>, statusId: string): boolean {
  return statusesOf(unit, statusId).length > 0;
}

function opponentFaction(actor: Readonly<BattleUnitStateV1>): "party" | "enemy" {
  return actor.faction === "party" ? "enemy" : "party";
}

function isTargetCondition(condition: AiCondition): boolean {
  return condition.kind === "targetHasStatus" || condition.kind === "targetMissingStatus" || condition.kind === "targetStatusStacksAtMost";
}

function targetRuleAllowsTargetCondition(targetRule: TargetRule): boolean {
  return targetRule === "singleEnemy" || targetRule === "singleAlly";
}

function readSkill(content: EnemyAiContentSource, id: string, path: string): DomainResult<Readonly<SkillDefinition>> {
  try {
    const result = content.getSkill(id);
    if (!result.ok) return result;
    if (!result.value || result.value.id !== id) return invalid(path, "id_mismatch");
    return success(result.value);
  } catch {
    return invalid(path, "getter_failed");
  }
}

function checkSkill(
  enemy: Readonly<EnemyDefinition>,
  actor: Readonly<BattleUnitStateV1>,
  skill: Readonly<SkillDefinition>,
  isFallback: boolean,
): DomainResult<true> {
  if (skill.kind === "passive" || skill.kind === "effect") return invalid(`skills.${skill.id}`, "enemy_action_skill_kind");
  if (skill.owner.kind !== "enemy" && skill.owner.kind !== "systemEffect") return invalid(`skills.${skill.id}.owner`, "enemy_owner");
  if (skill.owner.kind === "enemy" && skill.owner.enemyId !== enemy.id) return invalid(`skills.${skill.id}.owner.enemyId`, "owner_mismatch");
  if (!isFallback && skill.id === enemy.basicSkillId) return invalid(`enemies.${enemy.id}.aiRules`, "basic_skill_in_rule");
  if (!isFallback && !enemy.skillIds.includes(skill.id)) return invalid(`enemies.${enemy.id}.skillIds`, "skill_not_declared");
  const cooldown = actor.cooldowns[skill.id] ?? 0;
  if (!isFallback && cooldown > 0) return failure(createDomainError("SKILL_ON_COOLDOWN", { skillId: skill.id, remainingTurns: cooldown }));
  const energyCost = skill.energyCostByLevel[0];
  if (!Number.isSafeInteger(energyCost) || energyCost < 0) return invalid(`skills.${skill.id}.energyCostByLevel[0]`, "energy_cost");
  if (!isFallback && actor.energy < energyCost) return failure(createDomainError("INSUFFICIENT_ENERGY", { required: energyCost, owned: actor.energy }));
  return success(true);
}

function checkCondition(
  condition: AiCondition,
  snapshot: Readonly<BattleSnapshotV1>,
  actor: Readonly<BattleUnitStateV1>,
  candidates: readonly string[],
): DomainResult<boolean> {
  const opposing = opponentFaction(actor);
  const allies = snapshot.units.filter((unit) => unit.faction === actor.faction && isAlive(unit));
  const opponents = snapshot.units.filter((unit) => unit.faction === opposing && isAlive(unit));
  const hpAtMost = (unit: Readonly<BattleUnitStateV1>, valueBps: number): boolean => unit.currentHp * 10_000 <= unit.stats.maxHp * valueBps;
  switch (condition.kind) {
    case "always": return success(true);
    case "selfHpAtMostBps": return success(hpAtMost(actor, condition.valueBps));
    case "selfHasStatus": return success(hasStatus(actor, condition.statusId));
    case "selfMissingStatus": return success(!hasStatus(actor, condition.statusId));
    case "anyAllyHpAtMostBps": return success(allies.some((unit) => hpAtMost(unit, condition.valueBps)));
    case "anyOpponentHpAtMostBps": return success(opponents.some((unit) => hpAtMost(unit, condition.valueBps)));
    case "allyCountAtMost": return success(allies.length <= condition.count);
    case "opponentCountAtLeast": return success(opponents.length >= condition.count);
    case "targetHasStatus": return success(candidates.some((id) => {
      const target = unitOf(snapshot, id);
      return target !== undefined && hasStatus(target, condition.statusId);
    }));
    case "targetMissingStatus": return success(candidates.some((id) => {
      const target = unitOf(snapshot, id);
      return target !== undefined && !hasStatus(target, condition.statusId);
    }));
    case "targetStatusStacksAtMost": return success(candidates.some((id) => {
      const target = unitOf(snapshot, id);
      return target !== undefined && statusesOf(target, condition.statusId).length <= condition.stacks;
    }));
    case "opponentsMissingStatusCountAtLeast": return success(opponents.filter((unit) => !hasStatus(unit, condition.statusId)).length >= condition.count);
    case "roundEquals": return success(snapshot.round === condition.round);
    case "roundAtLeast": return success(snapshot.round >= condition.round);
    default: return invalid("enemy.aiRules.conditions", "unknown_condition");
  }
}

function validateTargetStrategy(skill: Readonly<SkillDefinition>, strategy: EnemyTargetStrategy, path: string): DomainResult<true> {
  const rule = skill.targetRule;
  if ((rule === "allAllies" || rule === "allEnemies" || rule === "self") && strategy !== "self") return invalid(path, "group_strategy");
  if (rule === "randomEnemy" && strategy !== "randomValid") return invalid(path, "random_strategy");
  if (rule === "singleEnemy" && !["lowestHpOpponent", "highestAttackOpponent", "frontFirstOpponent", "randomValid"].includes(strategy)) return invalid(path, "enemy_strategy");
  if (rule === "singleAlly" && !["lowestHpAlly", "self", "randomValid"].includes(strategy)) return invalid(path, "ally_strategy");
  if (rule === "deadAlly" && strategy !== "lowestHpAlly" && strategy !== "self") return invalid(path, "dead_ally_strategy");
  return success(true);
}

function stableUnitCompare(left: Readonly<BattleUnitStateV1>, right: Readonly<BattleUnitStateV1>): number {
  return left.slot - right.slot || (left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0);
}

/** 冻结阵型的前排判定：party 为槽位 0/1，enemy 为槽位 0/1/2。 */
export function isFrontUnit(unit: Readonly<BattleUnitStateV1>): boolean {
  return unit.faction === "party" ? unit.slot < 2 : unit.slot < 3;
}

function hpRatioCompare(left: Readonly<BattleUnitStateV1>, right: Readonly<BattleUnitStateV1>): number {
  return left.currentHp * right.stats.maxHp - right.currentHp * left.stats.maxHp || stableUnitCompare(left, right);
}

function chooseTarget(
  input: EnemyAiInput,
  skill: Readonly<SkillDefinition>,
  strategy: EnemyTargetStrategy,
  candidates: readonly string[],
): DomainResult<{ readonly targetUnitIds: readonly string[] }> {
  if (skill.targetRule === "self" || skill.targetRule === "allAllies" || skill.targetRule === "allEnemies" || skill.targetRule === "randomEnemy") return success({ targetUnitIds: [] });
  const units = candidates.map((id) => unitOf(input.snapshot, id)).filter((unit): unit is Readonly<BattleUnitStateV1> => unit !== undefined);
  if (units.length === 0) return invalid(`skills.${skill.id}.targetRule`, "no_legal_target");
  let chosen: Readonly<BattleUnitStateV1>;
  switch (strategy) {
    case "lowestHpOpponent":
    case "lowestHpAlly": chosen = [...units].sort(hpRatioCompare)[0]; break;
    case "highestAttackOpponent": chosen = [...units].sort((left, right) => right.stats.attack - left.stats.attack || stableUnitCompare(left, right))[0]; break;
    case "frontFirstOpponent": chosen = [...units].sort((left, right) => Number(!isFrontUnit(left)) - Number(!isFrontUnit(right)) || stableUnitCompare(left, right))[0]; break;
    case "self": {
      const self = unitOf(input.snapshot, input.actorUnitId);
      if (!self || !units.some((unit) => unit.unitId === self.unitId)) return invalid(`skills.${skill.id}.targetStrategy`, "self_not_legal");
      chosen = self;
      break;
    }
    case "randomValid": {
      try {
        // 即使候选仅一项也调用一次加权抽取，保证 AI RNG 消费顺序固定。
        chosen = input.rng.pickWeighted(units.map((unit) => ({ value: unit, weight: 1 })));
      } catch {
        return invalid(`skills.${skill.id}.targetStrategy`, "rng_failed");
      }
      break;
    }
    default: return invalid(`skills.${skill.id}.targetStrategy`, "unknown_strategy");
  }
  return success({ targetUnitIds: [chosen.unitId] });
}

function resolveRuleCandidates(input: EnemyAiInput, actor: Readonly<BattleUnitStateV1>, skill: Readonly<SkillDefinition>, conditions: readonly AiCondition[]): DomainResult<string[]> {
  const targetConditions = conditions.filter(isTargetCondition);
  if (targetConditions.length > 0 && !targetRuleAllowsTargetCondition(skill.targetRule)) return invalid(`skills.${skill.id}.targetRule`, "target_condition_rule");
  const legal = getLegalTargetUnitIds(input.snapshot, actor.unitId, skill.targetRule, skill.requiresFrontAccess);
  if (!legal.ok) return legal;
  let candidates = [...legal.value];
  for (const condition of targetConditions) {
    const filtered: string[] = [];
    for (const id of candidates) {
      const result = checkCondition(condition, input.snapshot, actor, [id]);
      if (!result.ok) return result;
      if (result.value) filtered.push(id);
    }
    candidates = filtered;
  }
  return success(candidates);
}

function buildDecision(input: EnemyAiInput, actor: Readonly<BattleUnitStateV1>, candidate: CandidateRule, usedFallback: boolean): DomainResult<EnemyAiDecision> {
  const target = chooseTarget(input, candidate.skill, candidate.rule.targetStrategy, candidate.candidates);
  if (!target.ok) return target;
  const isBasic = usedFallback;
  const actionKind = isBasic ? "USE_BASIC" : candidate.skill.kind === "ultimate" ? "USE_ULTIMATE" : "USE_SKILL";
  const command: BattleCommandV1 = actionKind === "USE_BASIC"
    ? { type: "USE_BASIC", expectedBattleRevision: input.snapshot.battleRevision, actorUnitId: actor.unitId, targetUnitIds: [...target.value.targetUnitIds] }
    : actionKind === "USE_ULTIMATE"
      ? { type: "USE_ULTIMATE", expectedBattleRevision: input.snapshot.battleRevision, actorUnitId: actor.unitId, skillId: candidate.skill.id, targetUnitIds: [...target.value.targetUnitIds] }
      : { type: "USE_SKILL", expectedBattleRevision: input.snapshot.battleRevision, actorUnitId: actor.unitId, skillId: candidate.skill.id, targetUnitIds: [...target.value.targetUnitIds] };
  return success({
    command,
    skill: candidate.skill,
    skillKind: isBasic ? "basic" : candidate.skill.kind === "ultimate" ? "ultimate" : "active",
    targetUnitIds: target.value.targetUnitIds,
    candidateTargetUnitIds: candidate.candidates,
    selectedRuleIndex: usedFallback ? null : candidate.index,
    usedFallback,
  });
}

/** 产生一个严格合法的敌方命令；失败不会修改快照或 RNG 以外的状态。 */
export function decideEnemyAction(input: EnemyAiInput): DomainResult<EnemyAiDecision> {
  if (!(input.rng instanceof SeededRng)) return invalid("enemy.ai.rng", "rng_required");
  const actor = unitOf(input.snapshot, input.actorUnitId);
  if (!actor) return invalid("snapshot.currentUnitId", "missing_actor");
  if (actor.faction !== "enemy" || actor.definitionId !== input.enemy.id) return invalid("enemy.ai.actor", "enemy_mismatch");
  if (!isAlive(actor)) return invalid("enemy.ai.actor", "dead_actor");
  if (!Array.isArray(input.enemy.aiRules) || input.enemy.aiRules.length === 0) {
    return resolveFallback(input, actor);
  }

  const candidates: CandidateRule[] = [];
  for (const [index, rule] of input.enemy.aiRules.entries()) {
    if (!Number.isSafeInteger(rule.priority) || !Number.isSafeInteger(rule.weight) || rule.weight <= 0 || !Array.isArray(rule.conditions) || rule.conditions.length === 0) return invalid(`enemies.${input.enemy.id}.aiRules[${index}]`, "rule_shape");
    if (rule.conditions.length !== 1 && rule.conditions.some((condition) => condition.kind === "always")) return invalid(`enemies.${input.enemy.id}.aiRules[${index}].conditions`, "always_must_be_alone");
    const skillResult = readSkill(input.content, rule.skillId, `enemies.${input.enemy.id}.aiRules[${index}].skillId`);
    if (!skillResult.ok) return skillResult;
    const skillAvailable = checkSkill(input.enemy, actor, skillResult.value, false);
    if (!skillAvailable.ok) {
      if (skillAvailable.error.code === "SKILL_ON_COOLDOWN" || skillAvailable.error.code === "INSUFFICIENT_ENERGY") continue;
      return skillAvailable;
    }
    let conditionsPass = true;
    for (const condition of rule.conditions.filter((value) => !isTargetCondition(value))) {
      const conditionResult = checkCondition(condition, input.snapshot, actor, []);
      if (!conditionResult.ok) return conditionResult;
      if (!conditionResult.value) { conditionsPass = false; break; }
    }
    if (!conditionsPass) continue;
    const targetValidation = validateTargetStrategy(skillResult.value, rule.targetStrategy, `enemies.${input.enemy.id}.aiRules[${index}].targetStrategy`);
    if (!targetValidation.ok) return targetValidation;
    const legal = resolveRuleCandidates(input, actor, skillResult.value, rule.conditions);
    if (!legal.ok) return legal;
    if (legal.value.length > 0) candidates.push({ index, rule, skill: skillResult.value, candidates: legal.value });
  }
  if (candidates.length === 0) return resolveFallback(input, actor);
  const maxPriority = Math.max(...candidates.map((candidate) => candidate.rule.priority));
  const highest = candidates.filter((candidate) => candidate.rule.priority === maxPriority);
  let winner: CandidateRule;
  try {
    winner = input.rng.pickWeighted(highest.map((candidate) => ({ value: candidate, weight: candidate.rule.weight })));
  } catch {
    return invalid(`enemies.${input.enemy.id}.aiRules`, "weight");
  }
  return buildDecision(input, actor, winner, false);
}

function resolveFallback(input: EnemyAiInput, actor: Readonly<BattleUnitStateV1>): DomainResult<EnemyAiDecision> {
  const skillResult = readSkill(input.content, input.enemy.basicSkillId, `enemies.${input.enemy.id}.basicSkillId`);
  if (!skillResult.ok) return skillResult;
  const available = checkSkill(input.enemy, actor, skillResult.value, true);
  if (!available.ok) return available;
  const strategy = input.enemy.basicTargetStrategy;
  const validation = validateTargetStrategy(skillResult.value, strategy, `enemies.${input.enemy.id}.basicTargetStrategy`);
  if (!validation.ok) return validation;
  const candidates = resolveRuleCandidates(input, actor, skillResult.value, []);
  if (!candidates.ok) return candidates;
  if (candidates.value.length === 0) return invalid(`enemies.${input.enemy.id}.basicTargetStrategy`, "no_legal_target");
  // fallback 不抽 rule weight，但 randomValid 仍按正式 targetStrategy 消费一次目标 RNG。
  return buildDecision(input, actor, { index: -1, rule: { priority: 0, conditions: [{ kind: "always" }], skillId: skillResult.value.id, targetStrategy: strategy, weight: 1 }, skill: skillResult.value, candidates: candidates.value }, true);
}

export const resolveEnemyAi = decideEnemyAction;
