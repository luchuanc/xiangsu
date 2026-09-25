/**
 * 根行动解析器。
 *
 * 解析器只在传入的临时快照上工作，按冻结的成本→效果→能量→终局顺序
 * 产生领域事件；调用方在保存成功前不会把这里的快照写回 GameStore。
 */
import type {
  BattleCommandV1,
  BattleDomainEventV1,
  BattleResolutionV1,
  BattleSnapshotV1,
  BattleUnitStateV1,
  Element,
  EffectSpec,
  EnemyDefinition,
  SkillDefinition,
  StatusDefinition,
  TargetRule,
  PendingBattleEventV1,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainErrorV1, type DomainResult } from "../common/DomainResult";
import { SeededRng } from "../common/SeededRng";
import { resolveDamage, resolveHeal, resolvePeriodicDamage, resolveShield } from "./DamageResolver";
import { resolveEffectiveStats } from "./BattleStatRuntime";
import { applyEnergyGain, applyEnergyCost, getSkillResourceCost, startSkillCooldown } from "./EnergyCooldown";
import { resolveTargets, selectPrimaryTarget } from "./Targeting";
import { applyStatus, clearStatusesOnDefeat, createPeriodicStatusEvents, type StatusEventContext } from "./StatusRuntime";
import type { SkillModifierResolution } from "../skill/SkillModifierResolver";
import type { BattleDynamicModifiers } from "./BattleLoadoutRuntime";
import type { BattleComboRuntimeAdapter } from "./BattleComboRuntime";
import type { TriggerRuntimeEvent } from "./ComboTriggerRuntime";
import { TriggerQueue, type TriggerApplicationResult, type TriggerCandidate } from "./TriggerQueue";

export interface ActionContentSource {
  getStatus?(id: string): DomainResult<Readonly<StatusDefinition>>;
  getEnemy?(id: string): DomainResult<Readonly<EnemyDefinition>>;
  getSkill?(id: string): DomainResult<Readonly<SkillDefinition>>;
}

export interface BattleActionResolverInput {
  readonly snapshot: Readonly<BattleSnapshotV1>;
  readonly command: BattleCommandV1;
  readonly skill?: Readonly<SkillDefinition> | null;
  readonly skillKind?: "basic" | "active" | "ultimate" | null;
  readonly skillLevel?: number;
  readonly item?: Readonly<import("../../content/contracts").ConsumableItemDefinition> | null;
  readonly skillModifierResolution?: Readonly<SkillModifierResolution> | null;
  readonly content?: ActionContentSource;
  /** 每个直接伤害/治疗/护盾效果按当前临时单位调用一次。 */
  readonly dynamicModifierResolver?: (context: {
    readonly actor: Readonly<BattleUnitStateV1>;
    readonly target: Readonly<BattleUnitStateV1>;
    readonly effect: Readonly<EffectSpec>;
    readonly skill: Readonly<SkillDefinition> | null | undefined;
    readonly round: number;
  }) => DomainResult<BattleDynamicModifiers>;
  /** 同一候选存档创建的 Combo 适配器；为空时保持无 Combo 的纯战斗行为。 */
  readonly comboRuntime?: BattleComboRuntimeAdapter;
  readonly rng: SeededRng;
  readonly nextId: (kind: "root" | "event") => string;
}

export interface BattleActionResolverOptions {
  readonly rootActionId?: string;
  readonly targetUnitIds?: readonly string[];
  readonly consumedItem?: { readonly itemId: string; readonly quantity: 1 } | null;
  /** 由 GameFlow 在 RESOLVE_ACTION 阶段显式驱动的控制跳过根行动。 */
  readonly controlledSkip?: boolean;
}

export interface ControlledSkipActionInput extends Omit<BattleActionResolverInput, "command"> {
  readonly actorUnitId?: string;
  readonly command?: BattleCommandV1;
}

type MutableSnapshot = BattleSnapshotV1;

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isAlive(unit: Readonly<BattleUnitStateV1>): boolean {
  return unit.currentHp > 0;
}

function unitOf(snapshot: Readonly<BattleSnapshotV1>, unitId: string): BattleUnitStateV1 | undefined {
  return snapshot.units.find((unit) => unit.unitId === unitId);
}

function unitIndex(snapshot: Readonly<BattleSnapshotV1>, unitId: string): number {
  return snapshot.units.findIndex((unit) => unit.unitId === unitId);
}

function eventBase(
  snapshot: Readonly<BattleSnapshotV1>,
  rootActionId: string | null,
  rootActionDefinitionId: string | null,
  contextSkillKind: BattleDomainEventV1["contextSkillKind"],
  visualSkillId: string | null,
  effect: EffectSpec | null,
  eventId: string,
  sequence: number,
): BattleDomainEventV1 {
  return {
    type: "PHASE_CHANGED",
    eventId,
    sequence,
    battleId: snapshot.battleId,
    round: snapshot.round,
    rootActionId,
    rootActionDefinitionId: rootActionDefinitionId as BattleDomainEventV1["rootActionDefinitionId"],
    chainDepth: 0,
    triggerSource: null,
    visualSkillId,
    contextSkillKind,
    effect,
    from: snapshot.phase,
    to: snapshot.phase,
  };
}

function replaceBase<T extends BattleDomainEventV1>(base: BattleDomainEventV1, event: T): T {
  return { ...base, ...event } as T;
}

function getStatus(
  content: ActionContentSource | undefined,
  statusId: string,
): DomainResult<Readonly<StatusDefinition> | null> {
  if (!content?.getStatus) return success(null);
  try {
    const result = content.getStatus(statusId);
    if (!result.ok) return result;
    if (result.value.id !== statusId) return invalid(`statuses.${statusId}`, "id_mismatch");
    return success(result.value);
  } catch {
    return invalid(`statuses.${statusId}`, "getter_failed");
  }
}

/** 兼容没有注入内容表的历史 DEFEND fixture；正式状态仍必须来自显式 getter。 */
function fallbackStatusDefinition(statusId: string): Readonly<StatusDefinition> | null {
  if (statusId !== "status_guard_30") return null;
  return {
    id: "status_guard_30",
    nameKey: "status.status_guard_30.name",
    polarity: "buff",
    maxStacks: 1,
    refreshRule: "replaceDuration",
    triggerTiming: "none",
    effect: { kind: "guard", directDamageReductionBps: 3_000 },
    canDispel: true,
    immunityTag: null,
    iconId: "icon_status_guard_30",
  };
}

function getEnemyElements(
  content: ActionContentSource | undefined,
  target: Readonly<BattleUnitStateV1>,
): DomainResult<{ readonly weaknesses: readonly Element[]; readonly resistances: readonly Element[]; readonly immunityTags: readonly string[] }> {
  // 只有敌方目标需要查内容表；友方目标明确使用空弱点/抗性，不能从角色字段猜测。
  if (!content?.getEnemy) return invalid("content.getEnemy", "getter_required");
  let result: DomainResult<Readonly<EnemyDefinition>>;
  try {
    result = content.getEnemy(target.definitionId);
  } catch {
    return invalid(`enemies.${target.definitionId}`, "getter_failed");
  }
  if (!result.ok) return result;
  if (result.value.id !== target.definitionId) return invalid(`enemies.${target.definitionId}`, "id_mismatch");
  if (!Array.isArray(result.value.elementWeaknesses) || !Array.isArray(result.value.elementResistances)) {
    return invalid(`enemies.${target.definitionId}`, "element_table_shape");
  }
  return success({ weaknesses: result.value.elementWeaknesses, resistances: result.value.elementResistances, immunityTags: result.value.immunityTags });
}

function directDamageReduction(target: Readonly<BattleUnitStateV1>): number {
  return target.statuses.some((status) => status.statusId === "status_guard_30") ? 3_000 : 0;
}

function stableTargetIds(targets: readonly string[], snapshot: Readonly<BattleSnapshotV1>): string[] {
  return [...targets].sort((left, right) => {
    const l = unitOf(snapshot, left);
    const r = unitOf(snapshot, right);
    return (l?.slot ?? Number.MAX_SAFE_INTEGER) - (r?.slot ?? Number.MAX_SAFE_INTEGER)
      || (left < right ? -1 : left > right ? 1 : 0);
  });
}

function isNoLegalEnemyTarget(result: DomainResult<readonly string[]>): boolean {
  return !result.ok
    && result.error.code === "INVALID_TARGET"
    && result.error.details.reason === "UNKNOWN"
    && result.error.details.targetUnitId === null;
}

function effectTargets(
  snapshot: Readonly<BattleSnapshotV1>,
  actorUnitId: string,
  effect: Extract<EffectSpec, { targetRule: TargetRule }>,
  rootTargets: readonly string[],
  rootTargetRule: TargetRule | null,
  requiresFrontAccess: boolean,
  rng: SeededRng,
): DomainResult<string[]> {
  // 根命令的单体目标已经按解析后的 targetRule 校验过，效果同规则时沿用，
  // 避免一次根行动重复抽取 randomEnemy；效果改写 targetRule 时重新生成。
  const isSingle = effect.targetRule === "singleEnemy" || effect.targetRule === "singleAlly" || effect.targetRule === "deadAlly";
  const reuseRootTargets = isSingle && rootTargetRule === effect.targetRule && rootTargets.length > 0;
  if (isSingle && !reuseRootTargets) {
    const primary = selectPrimaryTarget(snapshot, actorUnitId, effect.targetRule as "singleAlly" | "singleEnemy" | "deadAlly", requiresFrontAccess);
    if (!primary.ok) return primary;
    return success([primary.value.targetUnitId]);
  }
  const requested = effect.targetRule === "singleEnemy" || effect.targetRule === "singleAlly" || effect.targetRule === "deadAlly"
    ? (reuseRootTargets ? rootTargets : [])
    : [];
  if (reuseRootTargets) {
    // 同一根技能的前一个伤害效果可能已经击倒单体目标；后续附加状态等效果
    // 应按战斗语义跳过已死亡目标，而不是把整条合法命令判为 INVALID_TARGET。
    const aliveRootTargets = requested.filter((targetId) => {
      const target = unitOf(snapshot, targetId);
      return target !== undefined && isAlive(target);
    });
    if (aliveRootTargets.length === 0) return success([]);
    const resolved = resolveTargets({
      snapshot,
      actorUnitId,
      targetRule: effect.targetRule,
      targetUnitIds: aliveRootTargets,
      requiresFrontAccess,
      rng,
    });
    if (!resolved.ok) return resolved;
    return success([...resolved.value.targetUnitIds]);
  }
  const resolved = resolveTargets({
    snapshot,
    actorUnitId,
    targetRule: effect.targetRule,
    targetUnitIds: requested,
    requiresFrontAccess,
    rng,
  });
  if (!resolved.ok) return resolved;
  return success([...resolved.value.targetUnitIds]);
}

function updateUnit(snapshot: MutableSnapshot, updated: BattleUnitStateV1): void {
  const index = unitIndex(snapshot, updated.unitId);
  if (index < 0) throw new Error(`找不到战斗单位 ${updated.unitId}`);
  snapshot.units[index] = updated;
}

function addMetricDamage(
  snapshot: MutableSnapshot,
  source: Readonly<BattleUnitStateV1>,
  sourceKind: "skill" | "item" | "combo" | "equipmentAffix" | "skillAffix" | "status",
  definitionId: string,
  element: BattleDomainEventV1 extends never ? never : import("../../content/contracts").Element,
  resolvedDamage: number,
  weakness: boolean,
): void {
  const existing = snapshot.metrics.damage.find((value) => value.sourceFaction === source.faction && value.sourceKind === sourceKind && value.sourceDefinitionId === definitionId && value.element === element);
  if (existing) {
    existing.resolvedDamage += resolvedDamage;
    if (weakness) existing.weaknessResolvedDamage += resolvedDamage;
  } else {
    snapshot.metrics.damage.push({ sourceFaction: source.faction, sourceKind, sourceDefinitionId: definitionId, element, resolvedDamage, weaknessResolvedDamage: weakness ? resolvedDamage : 0 });
  }
}

function makeEventFactory(
  snapshot: Readonly<BattleSnapshotV1>,
  rootActionId: string,
  rootActionDefinitionId: string,
  contextSkillKind: BattleDomainEventV1["contextSkillKind"],
  visualSkillId: string | null,
  nextId: (kind: "root" | "event") => string,
) {
  let sequence = 0;
  return {
    next(event: Record<string, unknown>, effect: EffectSpec | null = null): BattleDomainEventV1 {
      const eventId = nextId("event");
      const eventSequence = sequence++;
      const base = eventBase(snapshot, rootActionId, rootActionDefinitionId, contextSkillKind, visualSkillId, effect, eventId, eventSequence);
      return replaceBase(base, event as unknown as BattleDomainEventV1);
    },
    get sequence(): number { return sequence; },
    advance(): void { sequence += 1; },
    get rootActionId(): string { return rootActionId; },
    get rootActionDefinitionId(): string { return rootActionDefinitionId; },
    nextEventId(): string { return nextId("event"); },
  };
}

function applyStatusEffect(
  snapshot: MutableSnapshot,
  source: Readonly<BattleUnitStateV1>,
  target: BattleUnitStateV1,
  effect: Extract<EffectSpec, { kind: "applyStatus" }>,
  content: ActionContentSource | undefined,
  rng: SeededRng,
  emit: (event: BattleDomainEventV1) => void,
  eventFactory: ReturnType<typeof makeEventFactory>,
  context: Partial<StatusEventContext> = {},
): DomainResult<true> {
  const statusResult = getStatus(content, effect.statusId);
  if (!statusResult.ok) return statusResult;
  // 旧的纯 DEFEND fixture 不注入内容表；只有明确的 guard 系统状态允许
  // 使用已写死的合同定义，其余状态缺少内容引用必须失败。
  const definition: Readonly<StatusDefinition> | null = statusResult.value ?? fallbackStatusDefinition(effect.statusId);
  if (!definition) return invalid(`statuses.${effect.statusId}`, "missing_reference");
  const sourceStatsResult = resolveEffectiveStats(source, content?.getStatus);
  if (!sourceStatsResult.ok) return sourceStatsResult;
  const targetStatsResult = resolveEffectiveStats(target, content?.getStatus);
  if (!targetStatsResult.ok) return targetStatsResult;
  const sourceStats = sourceStatsResult.value;
  const targetStats = targetStatsResult.value;
  const targetImmunityTags = target.faction === "enemy" && content?.getEnemy
    ? getEnemyElements(content, target)
    : success({ weaknesses: [], resistances: [], immunityTags: [] });
  if (!targetImmunityTags.ok) return targetImmunityTags;
  const eventContext: StatusEventContext = {
    battleId: snapshot.battleId,
    round: snapshot.round,
    rootActionId: context.rootActionId ?? eventFactory.rootActionId,
    rootActionDefinitionId: context.rootActionDefinitionId ?? eventFactory.rootActionDefinitionId as StatusEventContext["rootActionDefinitionId"],
    chainDepth: context.chainDepth ?? 0,
    triggerSource: context.triggerSource ?? null,
    visualSkillId: context.visualSkillId ?? null,
    contextSkillKind: context.contextSkillKind ?? null,
    effect,
    // 根行动在效果阶段已经开始，self buff 需要跳过本次 owner TURN_END，
    // 让 guard/duration=1 状态保留到下一次 TURN_START 再处理。
    phase: context.phase ?? "DRAIN_TRIGGERS",
    currentUnitId: context.currentUnitId ?? source.unitId,
    targetUnitId: context.targetUnitId ?? target.unitId,
    targetTurnStarted: context.targetTurnStarted ?? true,
    targetTurnEndCompleted: context.targetTurnEndCompleted ?? false,
    nextEventId: eventFactory.nextEventId,
  };
  const applied = applyStatus({
    // 命中率需要读取目标当前有效属性，但动态属性不能写回快照的 stats。
    target: { ...target, stats: targetStats },
    source: { ...source, stats: sourceStats },
    status: definition,
    stacks: effect.stacks,
    durationOwnerTurns: effect.durationOwnerTurns,
    baseChanceBps: effect.baseChanceBps,
    targetImmunityTags: targetImmunityTags.value.immunityTags,
    rng,
    nextStatusId: eventFactory.nextEventId,
    eventContext,
  });
  if (!applied.ok) return applied;
  target.statuses = applied.value.unit.statuses;
  for (const event of applied.value.events) emit(event);
  return success(true);
}

function finishOutcome(snapshot: MutableSnapshot): "ongoing" | "victory" | "defeat" {
  const partyAlive = snapshot.units.some((unit) => unit.faction === "party" && isAlive(unit));
  const enemyAlive = snapshot.units.some((unit) => unit.faction === "enemy" && isAlive(unit));
  if (!partyAlive) return "defeat";
  if (!enemyAlive) return "victory";
  return "ongoing";
}

function resolveDynamicModifiers(
  input: BattleActionResolverInput,
  actor: Readonly<BattleUnitStateV1>,
  target: Readonly<BattleUnitStateV1>,
  effect: Readonly<EffectSpec>,
  snapshot: Readonly<BattleSnapshotV1>,
): DomainResult<BattleDynamicModifiers> {
  if (!input.dynamicModifierResolver) return success({ damageBonusBps: 0, finalDamageMultiplierBps: 0, healingBonusBps: 0, shieldBonusBps: 0 });
  try {
    return input.dynamicModifierResolver({ actor, target, effect, skill: input.skill, round: snapshot.round });
  } catch {
    return invalid("dynamicModifierResolver", "resolver_failed");
  }
}

function resolveBattleActionInternal(input: BattleActionResolverInput, options: BattleActionResolverOptions = {}): DomainResult<BattleResolutionV1> {
  if (!input || !input.snapshot || !input.command || !input.rng || typeof input.nextId !== "function") return invalid("input", "shape");
  const snapshot = clone(input.snapshot) as MutableSnapshot;
  const actor = unitOf(snapshot, input.command.actorUnitId);
  if (!actor) return invalid("command.actorUnitId", "missing_unit");
  const rootActionId = options.rootActionId ?? input.nextId("root");
  const rootDefinitionId = options.controlledSkip ? "action_skip_control"
    : input.command.type === "USE_BASIC"
    ? (input.skill?.id ?? "basic")
    : input.command.type === "USE_SKILL" || input.command.type === "USE_ULTIMATE"
      ? input.command.skillId
      : input.command.type === "USE_ITEM" ? input.command.itemId : input.command.type === "DEFEND" ? "action_defend" : "action_retreat";
  const kind = options.controlledSkip ? "skip"
    : input.command.type === "USE_BASIC" ? "basic"
    : input.command.type === "USE_SKILL" ? "active"
      : input.command.type === "USE_ULTIMATE" ? "ultimate"
        : input.command.type === "USE_ITEM" ? "item"
          : input.command.type === "DEFEND" ? "defend" : "retreat";
  const contextSkillKind = input.skillKind ?? (kind === "basic" || kind === "active" || kind === "ultimate" ? kind : null);
  const visualSkillId = input.skill && (contextSkillKind === "basic" || contextSkillKind === "active" || contextSkillKind === "ultimate") ? input.skill.id : null;
  const eventFactory = makeEventFactory(snapshot, rootActionId, rootDefinitionId, contextSkillKind, visualSkillId, input.nextId);
  const events: BattleDomainEventV1[] = [];
  let globalSequence = 0;
  const emit = (event: BattleDomainEventV1): void => {
    // 根工厂序号还服务于派生状态 ID；对外 trace 使用独立全局序号，严格按
    // 实际 push 顺序连续分配，不把队列内部 sequence 带回领域事件。
    events.push({ ...event, sequence: globalSequence++ });
  };
  // 即使本根没有 Combo，也必须保留同一个 TriggerQueue，周期状态才能在
  // 保存前按 FIFO 应用；有 Combo 时则复用已注入的队列适配器和预算。
  const comboQueue = input.comboRuntime?.createQueue({
    battleId: snapshot.battleId,
    round: snapshot.round,
    rootActionId,
    rootActionDefinitionId: rootDefinitionId as BattleDomainEventV1["rootActionDefinitionId"] & import("../../content/contracts").BattleActionDefinitionIdV1,
    rng: input.rng,
    nextEventId: () => input.nextId("event"),
    roundTriggerCounts: snapshot.roundTriggerCounts,
    battleTriggerCounts: snapshot.battleTriggerCounts,
  }) ?? new TriggerQueue({
    battleId: snapshot.battleId,
    round: snapshot.round,
    rootActionId,
    rootActionDefinitionId: rootDefinitionId as import("../../content/contracts").BattleActionDefinitionIdV1,
    rng: input.rng,
    nextEventId: () => input.nextId("event"),
    roundTriggerCounts: snapshot.roundTriggerCounts,
    battleTriggerCounts: snapshot.battleTriggerCounts,
  });
  let comboQueueCursor = 0;
  // 只记录 Combo 派生效果通过根工厂分配过的事件；队列自身事件不能
  // 依赖内部 sequence 判断是否已接入全局 trace，避免序号巧合造成重复。
  const comboGeneratedEventIds = new Map<string, number>();
  const markComboEvent = (event: BattleDomainEventV1): BattleDomainEventV1 => {
    comboGeneratedEventIds.set(event.eventId, (comboGeneratedEventIds.get(event.eventId) ?? 0) + 1);
    return event;
  };

  // 队列内部有自己的序号；接回根行动时统一重排到同一条全局 trace，避免
  // COMBO_TRIGGERED/派生事件与直接事件出现重复或倒退序号。
  const syncComboQueueEvents = (): void => {
    if (!comboQueue) return;
    const queued = comboQueue.events;
    for (; comboQueueCursor < queued.length; comboQueueCursor += 1) {
      const eventId = queued[comboQueueCursor].eventId;
      const allocatedCount = comboGeneratedEventIds.get(eventId) ?? 0;
      const alreadyAllocated = allocatedCount > 0;
      if (alreadyAllocated) {
        if (allocatedCount === 1) comboGeneratedEventIds.delete(eventId);
        else comboGeneratedEventIds.set(eventId, allocatedCount - 1);
      }
      const queuedEvent = { ...queued[comboQueueCursor], sequence: globalSequence++ };
      events.push(queuedEvent);
      if (!alreadyAllocated) eventFactory.advance();
      snapshot.metrics.maxChainDepth = Math.max(snapshot.metrics.maxChainDepth, queuedEvent.chainDepth);
      if (queuedEvent.type === "COMBO_TRIGGERED") {
        snapshot.metrics.comboTriggerCounts[queuedEvent.comboId] = (snapshot.metrics.comboTriggerCounts[queuedEvent.comboId] ?? 0) + 1;
        const key = `${queuedEvent.rootActionId}:${queuedEvent.ownerKey}:${queuedEvent.comboId}`;
        if (!snapshot.firedComboKeys.includes(key)) snapshot.firedComboKeys.push(key);
      }
    }
    const budget = comboQueue.budgetSnapshot;
    snapshot.roundTriggerCounts = { ...budget.roundTriggerCounts };
    snapshot.battleTriggerCounts = { ...budget.battleTriggerCounts };
  };

  type ComboEventContext = {
    readonly rootActionId?: string;
    readonly rootActionDefinitionId?: Exclude<BattleDomainEventV1["rootActionDefinitionId"], null>;
    readonly chainDepth?: number;
    readonly visualSkillId?: BattleDomainEventV1["visualSkillId"];
    readonly contextSkillKind?: BattleDomainEventV1["contextSkillKind"];
  };
  let comboStatError: DomainErrorV1 | null = null;
  const triggerStats = (unit: Readonly<BattleUnitStateV1> | undefined): Readonly<BattleUnitStateV1["stats"]> | undefined => {
    if (!unit) return undefined;
    const result = resolveEffectiveStats(unit, input.content?.getStatus);
    if (!result.ok) {
      comboStatError = result.error;
      return unit.stats;
    }
    return result.value;
  };
  const comboEvent = (event: TriggerRuntimeEvent["event"], eventOwnerUnitId: string | null, sourceUnitId: string | null, targetUnitId: string | null, hitResult: TriggerRuntimeEvent["hitResult"] = "notApplicable", context: ComboEventContext = {}): TriggerRuntimeEvent => {
    const source = sourceUnitId === null ? undefined : unitOf(snapshot, sourceUnitId);
    const target = targetUnitId === null ? undefined : unitOf(snapshot, targetUnitId);
    const sourceStats = triggerStats(source);
    const targetStats = triggerStats(target);
    return {
      event,
      eventOwnerUnitId,
      sourceUnitId,
      targetUnitId,
      rootActionId: context.rootActionId ?? rootActionId,
      rootActionDefinitionId: context.rootActionDefinitionId ?? rootDefinitionId as import("../../content/contracts").BattleActionDefinitionIdV1,
      chainDepth: context.chainDepth ?? 0,
      round: snapshot.round,
      contextSkillKind: context.contextSkillKind === undefined ? contextSkillKind : context.contextSkillKind,
      visualSkillId: context.visualSkillId === undefined ? visualSkillId : context.visualSkillId,
      hitResult,
      sourceHp: source?.currentHp,
      sourceEffectiveMaxHp: sourceStats?.maxHp,
      targetHp: target?.currentHp,
      targetEffectiveMaxHp: targetStats?.maxHp,
      units: snapshot.units,
    };
  };

  const recursiveTriggerEvents = (event: BattleDomainEventV1): TriggerRuntimeEvent[] => {
    // 递归候选必须继承原派生事件的根标识；缺失时不能用当前根行动猜测。
    if (event.rootActionId === null || event.rootActionDefinitionId === null) return [];
    const context: ComboEventContext = {
      rootActionId: event.rootActionId,
      rootActionDefinitionId: event.rootActionDefinitionId,
      chainDepth: event.chainDepth,
      visualSkillId: event.visualSkillId,
      contextSkillKind: event.contextSkillKind,
    };
    switch (event.type) {
      case "DAMAGE_RESOLVED": {
        const target = unitOf(snapshot, event.targetUnitId);
        if (!target) return [];
        // 周期伤害只能产生“受伤/击倒”后续候选，不能冒充直接命中的
        // afterDirectHit；否则 bleed/追击类 Combo 会被每回合周期重复触发。
        if (event.damageKind === "periodic") return [];
        const source = unitOf(snapshot, event.sourceUnitId);
        if (!source) return [];
        const triggerEvents = [comboEvent("afterDirectHit", source.unitId, source.unitId, target.unitId, event.hitResult, context)];
        if (target.faction === "party" && event.shieldDamage + event.hpDamage > 0) {
          triggerEvents.push(comboEvent("onDirectDamageTaken", target.unitId, target.unitId, source.unitId, event.hitResult, context));
        }
        return triggerEvents;
      }
      case "HEAL_RESOLVED": {
        const source = unitOf(snapshot, event.sourceUnitId);
        const target = unitOf(snapshot, event.targetUnitId);
        if (!source || !target) return [];
        const triggerEvents = [comboEvent("onHeal", source.unitId, source.unitId, target.unitId, event.hitResult, context)];
        if (event.overheal > 0) triggerEvents.push(comboEvent("onOverheal", source.unitId, source.unitId, target.unitId, event.hitResult, context));
        return triggerEvents;
      }
      case "SHIELD_GRANTED": {
        const source = unitOf(snapshot, event.sourceUnitId);
        const target = unitOf(snapshot, event.targetUnitId);
        if (!source || !target || event.granted <= 0) return [];
        return [comboEvent("onGainShield", source.unitId, source.unitId, target.unitId, "notApplicable", context)];
      }
      case "UNIT_DEFEATED": {
        if (event.sourceUnitId === null) return [];
        const target = unitOf(snapshot, event.unitId);
        if (!target) return [];
        // 周期来源可以已经离场；仍保留 sourceUnitId 作为冻结事件来源，
        // 由正式 Combo 适配器决定该缺失来源是否有可用候选。
        return [comboEvent("onDefeatUnit", event.sourceUnitId, event.sourceUnitId, target.unitId, "notApplicable", context)];
      }
      default:
        return [];
    }
  };

  let comboResolverError: DomainErrorV1 | null = null;
  const isPeriodicPending = (pending: PendingBattleEventV1): boolean => pending.triggerSource?.kind === "status";

  const applyPeriodicPending = (pending: PendingBattleEventV1): TriggerApplicationResult => {
    if (!isPeriodicPending(pending) || pending.effect.kind !== "damage") return { ok: false, reason: "TARGET_INVALID" };
    const statusSource = pending.triggerSource;
    if (!statusSource || statusSource.kind !== "status") return { ok: false, reason: "TARGET_INVALID" };
    const source = unitOf(snapshot, pending.sourceUnitId);
    // 周期事件携带的是状态创建时冻结的目标；来源可以已经死亡，但目标
    // 在事件真正应用时必须仍存活且属于敌对阵营，不能重新选目标。
    const targetId = pending.targetUnitIds.length === 1 ? pending.targetUnitIds[0] : null;
    const target = targetId === null ? undefined : unitOf(snapshot, targetId);
    if (!target || !isAlive(target)) return { ok: false, reason: "TARGET_INVALID" };
    // 来源单位可能已死亡甚至已从快照离场；此时由持有者阵营反推敌对
    // 阵营，仅用于合法性/指标归属，伤害数值始终读取 Pending 的快照。
    const sourceFaction = source?.faction ?? (target.faction === "party" ? "enemy" : "party");
    if (target.faction === sourceFaction) return { ok: false, reason: "TARGET_INVALID" };
    const elements = target.faction === "enemy" ? getEnemyElements(input.content, target) : success({ weaknesses: [], resistances: [], immunityTags: [] });
    if (!elements.ok) {
      comboResolverError = elements.error;
      return { ok: false, reason: "TARGET_INVALID" };
    }
    const resolved = resolvePeriodicDamage({
      target,
      effect: pending.effect,
      getStatus: input.content?.getStatus,
      targetElementWeaknesses: elements.value.weaknesses,
      targetElementResistances: elements.value.resistances,
    });
    if (!resolved.ok) {
      comboResolverError = resolved.error;
      return { ok: false, reason: "TARGET_INVALID" };
    }
    updateUnit(snapshot, resolved.value.nextTarget);
    const meta = {
      rootActionId: pending.rootActionId,
      rootActionDefinitionId: pending.rootActionDefinitionId,
      chainDepth: pending.chainDepth,
      triggerSource: pending.triggerSource,
      visualSkillId: pending.visualSkillId,
      contextSkillKind: pending.contextSkillKind,
    } as const;
    const appliedEvents: BattleDomainEventV1[] = [];
    const result = resolved.value;
    const damageEvent = eventFactory.next({
      ...meta,
      type: "DAMAGE_RESOLVED",
      sourceUnitId: pending.sourceUnitId,
      targetUnitId: target.unitId,
      effectIndex: pending.effectIndex,
      hitIndex: 0,
      damageKind: "periodic",
      element: pending.effect.element,
      hitResult: result.hitResult,
      varianceBps: result.varianceBps,
      effectiveDefense: result.effectiveDefense,
      elementMultiplierBps: result.elementMultiplierBps,
      shieldDamage: result.shieldDamage,
      hpDamage: result.hpDamage,
      overkill: result.overkill,
      hpBefore: result.hpBefore,
      hpAfter: result.hpAfter,
      effect: pending.effect,
    }, pending.effect);
    appliedEvents.push(damageEvent);
    const sourceForMetrics = source ?? { ...target, unitId: pending.sourceUnitId, faction: sourceFaction };
    const sourceKind = "status" as const;
    const sourceDefinitionId = statusSource.statusId;
    addMetricDamage(snapshot, sourceForMetrics, sourceKind, sourceDefinitionId, pending.effect.element, result.shieldDamage + result.hpDamage, result.elementMultiplierBps === 12_500);
    if (sourceFaction === "enemy" && target.faction === "party") snapshot.metrics.partyDamageTaken += result.shieldDamage + result.hpDamage;
    if (result.hpAfter === 0 && result.hpBefore > 0) {
      appliedEvents.push(eventFactory.next({
        ...meta,
        type: "UNIT_DEFEATED",
        sourceUnitId: pending.sourceUnitId,
        unitId: target.unitId,
        effect: pending.effect,
      }, pending.effect));
      const cleared = clearStatusesOnDefeat({
        target: unitOf(snapshot, target.unitId)!,
        eventContext: {
          battleId: snapshot.battleId,
          round: snapshot.round,
          rootActionId: pending.rootActionId,
          rootActionDefinitionId: pending.rootActionDefinitionId,
          chainDepth: pending.chainDepth,
          triggerSource: pending.triggerSource,
          visualSkillId: pending.visualSkillId,
          contextSkillKind: pending.contextSkillKind,
          phase: "DRAIN_TRIGGERS",
          nextEventId: eventFactory.nextEventId,
        },
      });
      if (!cleared.ok) {
        comboResolverError = cleared.error;
        return { ok: false, reason: "TARGET_INVALID" };
      }
      updateUnit(snapshot, cleared.value.unit);
      appliedEvents.push(...cleared.value.events);
    }
    return { ok: true, events: appliedEvents };
  };

  const applyComboPending = (pending: PendingBattleEventV1, phase: "DRAIN_PRE_ACTION" | "DRAIN_TRIGGERS" = "DRAIN_TRIGGERS"): TriggerApplicationResult => {
    if (comboResolverError) return { ok: false, reason: "TARGET_INVALID" };
    if (isPeriodicPending(pending)) return applyPeriodicPending(pending);
    const source = unitOf(snapshot, pending.sourceUnitId);
    if (!source || !isAlive(source)) return { ok: false, reason: "SOURCE_INVALID" };
    const effect = pending.effect;
    const targetsResult = "targetRule" in effect
      ? effectTargets(snapshot, source.unitId, effect as Extract<EffectSpec, { targetRule: TargetRule }>, pending.targetUnitIds, effect.targetRule, false, input.rng)
      : success([]);
    if (!targetsResult.ok) return { ok: false, reason: "TARGET_INVALID" };
    const targetIds = targetsResult.value;
    if (targetIds.length === 0 && effect.kind !== "changeCooldown" && effect.kind !== "changeEnergy" && effect.kind !== "grantExtraTurn" && effect.kind !== "summon") {
      return { ok: false, reason: "TARGET_INVALID" };
    }
    const appliedEvents: BattleDomainEventV1[] = [];
    const comboMeta = {
      triggerSource: pending.triggerSource,
      chainDepth: pending.chainDepth,
      visualSkillId: pending.visualSkillId,
      contextSkillKind: pending.contextSkillKind,
    } as const;
    const sourceKind = pending.triggerSource?.kind === "combo" ? "combo"
      : pending.triggerSource?.kind === "equipmentAffix" ? "equipmentAffix"
        : pending.triggerSource?.kind === "skillAffix" ? "skillAffix" : "status";
    const sourceDefinitionId = pending.triggerSource?.kind === "combo" ? pending.triggerSource.comboId
      : pending.triggerSource?.kind === "equipmentAffix" ? pending.triggerSource.affixId
        : pending.triggerSource?.kind === "skillAffix" ? pending.triggerSource.skillAffixId
          : pending.triggerSource?.statusId ?? rootDefinitionId;

    if (effect.kind === "damage") {
      let resolvedAny = false;
      const hitCount = Math.max(1, effect.hitCount);
      for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
        for (const targetId of stableTargetIds(targetIds, snapshot)) {
          const target = unitOf(snapshot, targetId);
          const sourceNow = unitOf(snapshot, source.unitId);
          if (!target || !sourceNow || !isAlive(target) || !isAlive(sourceNow)) continue;
          const elements = target.faction === "enemy" ? getEnemyElements(input.content, target) : success({ weaknesses: [], resistances: [], immunityTags: [] });
          if (!elements.ok) return { ok: false, reason: "TARGET_INVALID" };
          const dynamic = resolveDynamicModifiers(input, sourceNow, target, effect, snapshot);
          if (!dynamic.ok) return { ok: false, reason: "TARGET_INVALID" };
          const resolved = resolveDamage({ attacker: sourceNow, target, effect, rng: input.rng, getStatus: input.content?.getStatus, damageReductionBps: directDamageReduction(target), damageBonusBps: dynamic.value.damageBonusBps, finalDamageMultiplierBps: dynamic.value.finalDamageMultiplierBps, targetElementWeaknesses: elements.value.weaknesses, targetElementResistances: elements.value.resistances });
          if (!resolved.ok) {
            comboResolverError = resolved.error;
            return { ok: false, reason: "TARGET_INVALID" };
          }
          updateUnit(snapshot, resolved.value.nextTarget);
          const result = resolved.value;
          appliedEvents.push(markComboEvent(eventFactory.next({
            ...comboMeta,
            type: "DAMAGE_RESOLVED", sourceUnitId: sourceNow.unitId, targetUnitId: targetId, effectIndex: pending.effectIndex, hitIndex,
            damageKind: "direct", element: effect.element, hitResult: result.hitResult, varianceBps: result.varianceBps,
            effectiveDefense: result.effectiveDefense, elementMultiplierBps: result.elementMultiplierBps,
            shieldDamage: result.shieldDamage, hpDamage: result.hpDamage, overkill: result.overkill,
            hpBefore: result.hpBefore, hpAfter: result.hpAfter, effect,
          }, effect)));
          addMetricDamage(snapshot, sourceNow, sourceKind, sourceDefinitionId, effect.element, result.shieldDamage + result.hpDamage, result.elementMultiplierBps === 12_500);
          if (sourceNow.faction === "enemy" && target.faction === "party") snapshot.metrics.partyDamageTaken += result.shieldDamage + result.hpDamage;
          if (result.hpAfter === 0 && result.hpBefore > 0) {
            appliedEvents.push(markComboEvent(eventFactory.next({ ...comboMeta, type: "UNIT_DEFEATED", sourceUnitId: sourceNow.unitId, unitId: target.unitId, effect }, effect)));
            const cleared = clearStatusesOnDefeat({
              target: unitOf(snapshot, target.unitId)!,
              eventContext: {
                battleId: snapshot.battleId,
                round: snapshot.round,
                rootActionId: pending.rootActionId,
                rootActionDefinitionId: pending.rootActionDefinitionId,
                chainDepth: pending.chainDepth,
                triggerSource: pending.triggerSource,
                visualSkillId: pending.visualSkillId,
                contextSkillKind: pending.contextSkillKind,
                phase: "DRAIN_TRIGGERS",
                nextEventId: eventFactory.nextEventId,
              },
            });
            if (!cleared.ok) {
              comboResolverError = cleared.error;
              return { ok: false, reason: "TARGET_INVALID" };
            }
            updateUnit(snapshot, cleared.value.unit);
            appliedEvents.push(...cleared.value.events.map(markComboEvent));
          }
          resolvedAny = true;
        }
      }
      return resolvedAny ? { ok: true, events: appliedEvents } : { ok: false, reason: "TARGET_INVALID" };
    }
    if (effect.kind === "heal") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        const sourceNow = unitOf(snapshot, source.unitId);
        if (!target || !sourceNow || !isAlive(sourceNow)) continue;
        const dynamic = resolveDynamicModifiers(input, sourceNow, target, effect, snapshot);
        if (!dynamic.ok) return { ok: false, reason: "TARGET_INVALID" };
        const resolved = resolveHeal({ source: sourceNow, target, effect, rng: input.rng, getStatus: input.content?.getStatus, healingBonusBps: dynamic.value.healingBonusBps });
        if (!resolved.ok) {
          comboResolverError = resolved.error;
          return { ok: false, reason: "TARGET_INVALID" };
        }
        updateUnit(snapshot, resolved.value.nextTarget);
        appliedEvents.push(markComboEvent(eventFactory.next({ ...comboMeta, type: "HEAL_RESOLVED", sourceUnitId: sourceNow.unitId, targetUnitId: targetId, effectIndex: pending.effectIndex, hitResult: resolved.value.hitResult, healed: resolved.value.healed, overheal: resolved.value.overheal, hpBefore: resolved.value.hpBefore, hpAfter: resolved.value.hpAfter, effect }, effect)));
        if (sourceNow.faction === "party") snapshot.metrics.partyHealingDone += resolved.value.healed;
      }
      return appliedEvents.length > 0 ? { ok: true, events: appliedEvents } : { ok: false, reason: "TARGET_INVALID" };
    }
    if (effect.kind === "shield") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        const sourceNow = unitOf(snapshot, source.unitId);
        if (!target || !sourceNow || !isAlive(sourceNow)) continue;
        const dynamic = resolveDynamicModifiers(input, sourceNow, target, effect, snapshot);
        if (!dynamic.ok) return { ok: false, reason: "TARGET_INVALID" };
        const resolved = resolveShield({ source: sourceNow, target, effect, statusStackId: input.nextId("event"), getStatus: input.content?.getStatus, shieldBonusBps: dynamic.value.shieldBonusBps });
        if (!resolved.ok) {
          comboResolverError = resolved.error;
          return { ok: false, reason: "TARGET_INVALID" };
        }
        updateUnit(snapshot, resolved.value.nextTarget);
        appliedEvents.push(markComboEvent(eventFactory.next({ ...comboMeta, type: "SHIELD_GRANTED", sourceUnitId: sourceNow.unitId, targetUnitId: targetId, effectIndex: pending.effectIndex, statusStackId: resolved.value.statusStackId, granted: resolved.value.granted, discardedByCap: resolved.value.discardedByCap, shieldAfter: resolved.value.shieldAfter, effect }, effect)));
        if (sourceNow.faction === "party") snapshot.metrics.partyShieldGranted += resolved.value.granted;
      }
      return appliedEvents.length > 0 ? { ok: true, events: appliedEvents } : { ok: false, reason: "TARGET_INVALID" };
    }
    if (effect.kind === "applyStatus") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target) continue;
        const applied = applyStatusEffect(snapshot, source, target, effect, input.content, input.rng, (event) => appliedEvents.push(markComboEvent({ ...event, ...comboMeta })), eventFactory, {
          rootActionId: pending.rootActionId,
          rootActionDefinitionId: pending.rootActionDefinitionId,
          chainDepth: pending.chainDepth,
          triggerSource: pending.triggerSource,
          visualSkillId: pending.visualSkillId,
          contextSkillKind: pending.contextSkillKind,
          phase,
          currentUnitId: source.unitId,
          targetUnitId: target.unitId,
          targetTurnStarted: phase === "DRAIN_PRE_ACTION",
          targetTurnEndCompleted: false,
        });
        if (!applied.ok) return { ok: false, reason: "TARGET_INVALID" };
        updateUnit(snapshot, target);
      }
      return appliedEvents.length > 0 ? { ok: true, events: appliedEvents } : { ok: false, reason: "TARGET_INVALID" };
    }
    if (effect.kind === "changeEnergy") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target) continue;
        const before = target.energy;
        target.energy = applyEnergyGain(target.energy, effect.amount);
        if (before !== target.energy) appliedEvents.push(markComboEvent(eventFactory.next({ ...comboMeta, type: "RESOURCE_CHANGED", targetUnitId: targetId, resource: "energy", skillId: null, before, after: target.energy, reason: "effect", effect }, effect)));
      }
      return { ok: true, events: appliedEvents };
    }
    if (effect.kind === "changeCooldown") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target) continue;
        const before = target.cooldowns[effect.skillId] ?? 0;
        target.cooldowns[effect.skillId] = Math.max(0, before + effect.amountTurns);
        if (before !== target.cooldowns[effect.skillId]) appliedEvents.push(markComboEvent(eventFactory.next({ ...comboMeta, type: "RESOURCE_CHANGED", targetUnitId: targetId, resource: "cooldown", skillId: effect.skillId, before, after: target.cooldowns[effect.skillId], reason: "effect", effect }, effect)));
      }
      return { ok: true, events: appliedEvents };
    }
    if (effect.kind === "consumeStatus") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target) continue;
        const before = target.statuses.filter((value) => value.statusId === effect.statusId).length;
        let remaining = Math.max(0, effect.stacks);
        target.statuses = target.statuses.filter((value) => {
          if (remaining > 0 && value.statusId === effect.statusId) { remaining -= 1; return false; }
          return true;
        });
        const after = target.statuses.filter((value) => value.statusId === effect.statusId).length;
        if (before !== after) appliedEvents.push(markComboEvent(eventFactory.next({ ...comboMeta, type: "STATUS_CHANGED", sourceUnitId: source.unitId, targetUnitId: targetId, statusId: effect.statusId, statusStackId: null, change: "consumed", stacksBefore: before, stacksAfter: after, remainingOwnerTurnsAfter: target.statuses.find((value) => value.statusId === effect.statusId)?.remainingOwnerTurns ?? 0, effect }, effect)));
      }
      return { ok: true, events: appliedEvents };
    }
    if (effect.kind === "dispel") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target) continue;
        const statusIds: string[] = [];
        for (const status of target.statuses) {
          const statusResult = getStatus(input.content, status.statusId);
          if (statusResult.ok && statusResult.value && statusResult.value.polarity === effect.polarity && statusResult.value.canDispel && !statusIds.includes(status.statusId)) statusIds.push(status.statusId);
        }
        for (const statusId of statusIds.slice(0, Math.max(0, effect.count))) {
          const before = target.statuses.filter((value) => value.statusId === statusId).length;
          target.statuses = target.statuses.filter((value) => value.statusId !== statusId);
          appliedEvents.push(markComboEvent(eventFactory.next({ ...comboMeta, type: "STATUS_CHANGED", sourceUnitId: source.unitId, targetUnitId: targetId, statusId, statusStackId: null, change: "dispelled", stacksBefore: before, stacksAfter: 0, remainingOwnerTurnsAfter: 0, effect }, effect)));
        }
      }
      return { ok: true, events: appliedEvents };
    }
    if (effect.kind === "revive") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target || isAlive(target)) continue;
        const targetStats = resolveEffectiveStats(target, input.content?.getStatus);
        if (!targetStats.ok) {
          comboResolverError = targetStats.error;
          return { ok: false, reason: "TARGET_INVALID" };
        }
        const restoredHp = Math.max(1, Math.floor((targetStats.value.maxHp * effect.restoreMaxHpBps) / 10_000));
        target.currentHp = Math.min(targetStats.value.maxHp, restoredHp);
        appliedEvents.push(markComboEvent(eventFactory.next({ ...comboMeta, type: "UNIT_REVIVED", sourceUnitId: source.unitId, unitId: targetId, restoredHp, effect }, effect)));
      }
      return { ok: true, events: appliedEvents };
    }
    // 召唤/额外行动仍由既有 reducer 接管；这里只消费队列，不能伪造领域事件。
    return { ok: true, events: [] };
  };

  const drainTriggerQueue = (collectComboCandidates: boolean, phase: "DRAIN_PRE_ACTION" | "DRAIN_TRIGGERS" = "DRAIN_TRIGGERS"): DomainResult<true> => {
    let recursiveCollectorError: DomainErrorV1 | null = null;
    comboQueue.drain(
      (pending) => {
        // 上一批候选在 drain 回调返回后才入队；下一项真正应用前先接回
        // COMBO_TRIGGERED，避免派生效果的根工厂序号越过队列头。
        syncComboQueueEvents();
        return applyComboPending(pending, phase);
      },
      collectComboCandidates && input.comboRuntime ? (_pending, result) => {
        // drain 每处理一个 Pending 都可能追加新的 COMBO_TRIGGERED；先接回
        // 本批结果再收集下一层候选，确保 FIFO trace 不被后续派生事件越过。
        syncComboQueueEvents();
        if (recursiveCollectorError) return [];
        const nextCandidates: TriggerCandidate[] = [];
        for (const event of result.events) {
          for (const recursiveEvent of recursiveTriggerEvents(event)) {
            const collected = input.comboRuntime!.collectCandidates({ event: recursiveEvent, snapshot, nextEventId: () => input.nextId("event") });
            if (!collected.ok) {
              // 周期击倒保留冻结的 sourceUnitId；来源已经离场时没有可供
              // Combo 归属的实时单位，但这不应撤销已结算的周期伤害。
              // 仅对该受控缺失来源放弃候选，其他收集错误仍严格上抛。
              const sourceMissing = recursiveEvent.eventOwnerUnitId !== null
                && !unitOf(snapshot, recursiveEvent.eventOwnerUnitId);
              if (recursiveEvent.event === "onDefeatUnit" && sourceMissing) continue;
              recursiveCollectorError = collected.error;
              return nextCandidates;
            }
            nextCandidates.push(...collected.value);
          }
        }
        return nextCandidates;
      } : undefined,
    );
    if (comboStatError) return failure(comboStatError);
    if (comboResolverError) return failure(comboResolverError);
    if (recursiveCollectorError) return failure(recursiveCollectorError);
    syncComboQueueEvents();
    snapshot.pendingEvents = [];
    return success(true);
  };

  const runComboTrigger = (triggerEvent: TriggerRuntimeEvent): DomainResult<true> => {
    const comboRuntime = input.comboRuntime;
    if (!comboRuntime) return success(true);
    if (comboStatError) return failure(comboStatError);
    const candidates = comboRuntime.collectCandidates({ event: triggerEvent, snapshot, nextEventId: () => input.nextId("event") });
    if (!candidates.ok) return candidates;
    if (comboStatError) return failure(comboStatError);
    comboQueue.enqueueCandidates(candidates.value);
    syncComboQueueEvents();
    return drainTriggerQueue(true, triggerEvent.event === "beforeAction" ? "DRAIN_PRE_ACTION" : "DRAIN_TRIGGERS");
  };

  type PeriodicTimingResult = {
    readonly unit: BattleUnitStateV1;
    readonly pendingEvents: readonly PendingBattleEventV1[];
    readonly lifecycleEvents: readonly BattleDomainEventV1[];
  };

  const runPeriodicTiming = (
    unitId: string,
    timing: "afterAction" | "turnEnd",
    directDamageDealt = false,
    directDamage = 0,
  ): DomainResult<PeriodicTimingResult> => {
    const unit = unitOf(snapshot, unitId);
    if (!unit) return invalid(`units.${unitId}`, "missing_unit");
    const statusResult = createPeriodicStatusEvents({
      unit,
      timing,
      directDamageDealt,
      directDamageAmount: directDamage,
      getStatus: (statusId) => {
        const result = getStatus(input.content, statusId);
        if (!result.ok) return undefined;
        // 仅无内容 getter 的旧 DEFEND fixture 使用明确的系统 guard 定义；
        // 其它状态不做猜测，正式内容 getter 失败仍由状态运行时拒绝。
        return result.value ?? (!input.content?.getStatus ? fallbackStatusDefinition(statusId) ?? undefined : undefined);
      },
      eventContext: {
        battleId: snapshot.battleId,
        round: snapshot.round,
        rootActionId,
        rootActionDefinitionId: rootDefinitionId as StatusEventContext["rootActionDefinitionId"],
        chainDepth: 0,
        phase: timing === "turnEnd" ? "TURN_END" : "DRAIN_TRIGGERS",
        currentUnitId: unitId,
        targetUnitId: unitId,
        targetTurnStarted: true,
        targetTurnEndCompleted: false,
        nextEventId: eventFactory.nextEventId,
      },
      nextEventId: eventFactory.nextEventId,
    });
    if (!statusResult.ok) return statusResult;
    // 状态运行时先返回“待应用的周期”和“待发出的生命周期事件”；
    // 生命周期必须在本时点周期 FIFO 清空后才进入正式 trace。
    return success({
      unit: statusResult.value.unit,
      pendingEvents: statusResult.value.pendingEvents,
      lifecycleEvents: statusResult.value.events,
    });
  };

  const applyPeriodicTiming = (
    timing: PeriodicTimingResult,
    collectComboCandidates: boolean,
  ): DomainResult<true> => {
    comboQueue.enqueuePendingEvents(timing.pendingEvents);
    // enqueue 的预算拒绝事件也要按队列实际顺序接入 trace。
    syncComboQueueEvents();
    const drained = drainTriggerQueue(collectComboCandidates);
    if (!drained.ok) return drained;

    const current = unitOf(snapshot, timing.unit.unitId);
    if (!current) return invalid(`units.${timing.unit.unitId}`, "missing_unit");
    const statusesBeforeLifecycle = new Set(current.statuses.map((status) => status.stackId));
    const expiredStackIds = new Set(
      timing.lifecycleEvents
        .filter((event): event is Extract<BattleDomainEventV1, { type: "STATUS_CHANGED" }> => event.type === "STATUS_CHANGED" && event.change === "expired" && event.statusStackId !== null)
        .map((event) => event.statusStackId as string),
    );
    const scheduledStacks = new Map(timing.unit.statuses.map((status) => [status.stackId, status]));
    // 周期应用可能已经修改 HP/护盾，生命周期只合并持续时间字段，不能用
    // timing 的旧整单位覆盖刚刚产生的战斗结果。
    current.statuses = current.statuses
      .filter((status) => !expiredStackIds.has(status.stackId))
      .map((status) => {
        const scheduled = scheduledStacks.get(status.stackId);
        return scheduled
          ? { ...status, remainingOwnerTurns: scheduled.remainingOwnerTurns, skipNextOwnerTurnEndDecrement: scheduled.skipNextOwnerTurnEndDecrement }
          : status;
      });
    // 仅发出仍存在的生命周期变化；周期击倒时 clearStatusesOnDefeat 已经发出
    // 同一栈的清理事件，避免重复 STATUS_CHANGED。
    for (const event of timing.lifecycleEvents) {
      if (event.type === "STATUS_CHANGED" && event.change === "expired" && event.statusStackId !== null && !statusesBeforeLifecycle.has(event.statusStackId)) continue;
      emit(event);
    }
    return success(true);
  };

  if (options.controlledSkip) {
    let skipStatusId: string | null = null;
    for (const status of actor.statuses) {
      const statusResult = getStatus(input.content, status.statusId);
      if (!statusResult.ok) return statusResult;
      if (statusResult.value?.effect.kind === "skipTurn"
        || (statusResult.value === null && (status.statusId === "status_freeze" || status.statusId === "status_stun"))) {
        skipStatusId = status.statusId;
        break;
      }
    }
    if (snapshot.phase !== "RESOLVE_ACTION"
      || snapshot.outcome !== "ongoing"
      || snapshot.currentUnitId !== actor.unitId
      || !isAlive(actor)
      || skipStatusId === null) {
      return failure(createDomainError("INVALID_BATTLE_PHASE", { expected: ["RESOLVE_ACTION"], actual: snapshot.phase }));
    }
    emit(eventFactory.next({ type: "ACTION_STARTED", actorUnitId: actor.unitId, actionKind: "skip", targetUnitIds: [], effect: null }));
    emit(eventFactory.next({ type: "TURN_SKIPPED", unitId: actor.unitId, reason: "control", statusId: skipStatusId, effect: null }));
    const pending = runPeriodicTiming(actor.unitId, "turnEnd");
    if (!pending.ok) return pending;
    const drained = applyPeriodicTiming(pending.value, true);
    if (!drained.ok) return drained;
    snapshot.metrics.triggerBudgetExhaustedCount += comboQueue.triggerBudgetExhaustedCount;
    const outcome = finishOutcome(snapshot);
    snapshot.outcome = outcome;
    snapshot.phase = outcome === "victory" ? "VICTORY" : outcome === "defeat" ? "DEFEAT" : "TURN_END";
    emit(eventFactory.next({ type: "ACTION_FINISHED", actorUnitId: actor.unitId, outcomeAfter: outcome, effect: null }));
    if (outcome !== "ongoing") emit(eventFactory.next({ type: "BATTLE_FINISHED", outcome, effect: null }));
    snapshot.battleRevision += 1;
    snapshot.rngState = [...input.rng.getState()];
    snapshot.pendingEvents = [];
    return success({ snapshot, events, consumedItem: null });
  }

  const rootTargets = options.targetUnitIds ?? ("targetUnitIds" in input.command ? input.command.targetUnitIds : []);
  const rootTargetRule = input.skill?.targetRule ?? input.item?.targetRule ?? null;
  const requiresFrontAccess = input.skill?.requiresFrontAccess ?? false;
  let directDamageAmount = 0;

  emit(eventFactory.next({ type: "ACTION_STARTED", actorUnitId: actor.unitId, actionKind: kind as Exclude<import("../../content/contracts").BattleActionKindV1, "effect">, targetUnitIds: [...rootTargets], effect: null }));

  if (kind !== "retreat") {
    const beforeAction = runComboTrigger(comboEvent("beforeAction", actor.unitId, actor.unitId, rootTargets[0] ?? actor.unitId));
    if (!beforeAction.ok) return beforeAction;
  }

  if (kind === "retreat") {
    snapshot.outcome = "retreat";
    snapshot.phase = "RETREAT";
    emit(eventFactory.next({ type: "ACTION_FINISHED", actorUnitId: actor.unitId, outcomeAfter: "retreat", effect: null }));
    emit(eventFactory.next({ type: "BATTLE_FINISHED", outcome: "retreat", effect: null }));
    snapshot.battleRevision += 1;
    snapshot.rngState = [...input.rng.getState()];
    return success({ snapshot, events, consumedItem: null });
  }

  // 成本先发生：终极归零，主动/终极写 N+1，物品只返回 consumedItem 声明。
  if (input.skill && (kind === "active" || kind === "ultimate")) {
    const level = input.skillLevel ?? 1;
    const cost = kind === "ultimate" ? 100 : getSkillResourceCost(input.skill, level).energyCost;
    const beforeEnergy = actor.energy;
    actor.energy = kind === "ultimate" ? 0 : applyEnergyCost(actor.energy, cost);
    if (beforeEnergy !== actor.energy || cost > 0) emit(eventFactory.next({ type: "RESOURCE_CHANGED", targetUnitId: actor.unitId, resource: "energy", skillId: null, before: beforeEnergy, after: actor.energy, reason: "actionCost", effect: null }));
    const baseCooldown = getSkillResourceCost(input.skill, level).cooldownTurns;
    const cooldownDelta = input.skillModifierResolution?.cooldownDelta ?? 0;
    const beforeCooldown = actor.cooldowns[input.skill.id] ?? 0;
    const nextCooldowns = startSkillCooldown(actor.cooldowns, input.skill.id, baseCooldown, cooldownDelta);
    actor.cooldowns = nextCooldowns;
    const afterCooldown = actor.cooldowns[input.skill.id];
    if (afterCooldown !== beforeCooldown) emit(eventFactory.next({ type: "RESOURCE_CHANGED", targetUnitId: actor.unitId, resource: "cooldown", skillId: input.skill.id, before: beforeCooldown, after: afterCooldown, reason: "actionCost", effect: null }));
  }

  const rootEffects: readonly EffectSpec[] = kind === "defend"
    ? [{ kind: "applyStatus", targetRule: "self", statusId: "status_guard_30", baseChanceBps: 10_000, stacks: 1, durationOwnerTurns: 1 }]
    : input.item ? input.item.effects
      : input.skill ? input.skill.effectsByLevel[Math.max(0, Math.min(4, (input.skillLevel ?? 1) - 1))] : [];

  for (const [effectIndex, effect] of rootEffects.entries()) {
    if (effect.kind === "summon" || effect.kind === "grantExtraTurn") {
      // 召唤/额外行动由 RPG-013 reducer 的独立领域事件接管；此卡不提前
      // 猜测内容 resolver，保留根动作顺序而不产生伪造的单位事件。
      continue;
    }
    if (!("targetRule" in effect)) continue;
    const targetsResult = effectTargets(snapshot, actor.unitId, effect as Extract<EffectSpec, { targetRule: TargetRule }>, rootTargets, rootTargetRule, requiresFrontAccess, input.rng);
    if (!targetsResult.ok) {
      // 前置效果可能已经击倒最后一个敌人；后续群体/重选效果按当前合法
      // 候选为空正常跳过。首个效果仍原样返回，避免放宽根目标门禁。
      if (effectIndex > 0
        && (effect.targetRule === "allEnemies" || effect.targetRule === "randomEnemy")
        && isNoLegalEnemyTarget(targetsResult)) continue;
      return targetsResult;
    }
    let targetIds = targetsResult.value;
    if (targetIds.length === 0 && effect.kind !== "changeCooldown" && effect.kind !== "changeEnergy") continue;
    if (effect.kind === "damage") {
      let fixedRandomTarget: string | null = null;
      const hitCount = Math.max(1, effect.hitCount);
      for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
        if (effect.targetRule === "allEnemies") {
          const refreshed = effectTargets(snapshot, actor.unitId, effect, rootTargets, rootTargetRule, requiresFrontAccess, input.rng);
          // 多段群体伤害每段都重新取存活目标；前段若击倒最后一个敌人，
          // 后续段自然结束当前 Effect，而不是把“没有目标”误报成根命令错误。
            if (!refreshed.ok) {
              if (isNoLegalEnemyTarget(refreshed)) break;
              return refreshed;
          }
          targetIds = stableTargetIds(refreshed.value, snapshot);
          if (targetIds.length === 0) break;
        } else if (effect.targetRule === "randomEnemy") {
          if (!fixedRandomTarget || effect.retargetEachHit) {
            const refreshed = effectTargets(snapshot, actor.unitId, effect, rootTargets, rootTargetRule, requiresFrontAccess, input.rng);
            // randomEnemy 的 retargetEachHit 与 allEnemies 一样按当前存活目标重选；
            // 前段击倒最后目标时，后续段结束当前 Effect，不放宽首次目标校验。
            if (!refreshed.ok) {
              if (effect.retargetEachHit && isNoLegalEnemyTarget(refreshed)) break;
              return refreshed;
            }
            fixedRandomTarget = refreshed.value[0] ?? null;
          }
          targetIds = fixedRandomTarget ? [fixedRandomTarget] : [];
        }
        for (const targetId of targetIds) {
          const target = unitOf(snapshot, targetId);
          const sourceNow = unitOf(snapshot, actor.unitId);
          if (!target || !sourceNow || !isAlive(target) || !isAlive(sourceNow)) continue;
          const elements = target.faction === "enemy"
            ? getEnemyElements(input.content, target)
            : success({ weaknesses: [], resistances: [], immunityTags: [] });
          if (!elements.ok) return elements;
          const dynamic = resolveDynamicModifiers(input, sourceNow, target, effect, snapshot);
          if (!dynamic.ok) return dynamic;
          const resolved = resolveDamage({
            attacker: sourceNow,
            target,
            effect,
            rng: input.rng,
            getStatus: input.content?.getStatus,
            damageReductionBps: directDamageReduction(target),
            damageBonusBps: dynamic.value.damageBonusBps,
            finalDamageMultiplierBps: dynamic.value.finalDamageMultiplierBps,
            targetElementWeaknesses: elements.value.weaknesses,
            targetElementResistances: elements.value.resistances,
          });
          if (!resolved.ok) return resolved;
          updateUnit(snapshot, resolved.value.nextTarget);
          const result = resolved.value;
          directDamageAmount += result.shieldDamage + result.hpDamage;
          const event = eventFactory.next({
            type: "DAMAGE_RESOLVED", sourceUnitId: sourceNow.unitId, targetUnitId: targetId, effectIndex, hitIndex,
            damageKind: "direct", element: effect.element, hitResult: result.hitResult, varianceBps: result.varianceBps,
            effectiveDefense: result.effectiveDefense, elementMultiplierBps: result.elementMultiplierBps,
            shieldDamage: result.shieldDamage, hpDamage: result.hpDamage, overkill: result.overkill,
            hpBefore: result.hpBefore, hpAfter: result.hpAfter, effect,
          });
          emit(event);
          const afterDirectHit = runComboTrigger(comboEvent("afterDirectHit", sourceNow.unitId, sourceNow.unitId, target.unitId, result.hitResult));
          if (!afterDirectHit.ok) return afterDirectHit;
          if (target.faction === "party" && result.shieldDamage + result.hpDamage > 0) {
            const damageTaken = runComboTrigger(comboEvent("onDirectDamageTaken", target.unitId, target.unitId, sourceNow.unitId, result.hitResult));
            if (!damageTaken.ok) return damageTaken;
          }
          const sourceDefinitionId = rootDefinitionId;
          addMetricDamage(snapshot, sourceNow, kind === "item" ? "item" : "skill", sourceDefinitionId, effect.element, result.shieldDamage + result.hpDamage, result.elementMultiplierBps === 12_500);
          if (sourceNow.faction === "enemy" && target.faction === "party") snapshot.metrics.partyDamageTaken += result.shieldDamage + result.hpDamage;
          if (result.hpAfter === 0 && result.hpBefore > 0) {
            emit(eventFactory.next({ type: "UNIT_DEFEATED", sourceUnitId: sourceNow.unitId, unitId: target.unitId, effect }));
            const defeated = runComboTrigger(comboEvent("onDefeatUnit", sourceNow.unitId, sourceNow.unitId, target.unitId));
            if (!defeated.ok) return defeated;
            const cleared = clearStatusesOnDefeat({
              target: unitOf(snapshot, target.unitId)!,
              eventContext: {
                battleId: snapshot.battleId,
                round: snapshot.round,
                rootActionId,
                rootActionDefinitionId: rootDefinitionId as StatusEventContext["rootActionDefinitionId"],
                chainDepth: 0,
                phase: "DRAIN_TRIGGERS",
                nextEventId: eventFactory.nextEventId,
              },
            });
            if (!cleared.ok) return cleared;
            updateUnit(snapshot, cleared.value.unit);
            for (const statusEvent of cleared.value.events) emit(statusEvent);
          }
        }
      }
    } else if (effect.kind === "heal") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        const sourceNow = unitOf(snapshot, actor.unitId);
        if (!target || !sourceNow || !isAlive(sourceNow)) continue;
        const dynamic = resolveDynamicModifiers(input, sourceNow, target, effect, snapshot);
        if (!dynamic.ok) return dynamic;
        const resolved = resolveHeal({ source: sourceNow, target, effect, rng: input.rng, getStatus: input.content?.getStatus, healingBonusBps: dynamic.value.healingBonusBps });
        if (!resolved.ok) return resolved;
        updateUnit(snapshot, resolved.value.nextTarget);
        emit(eventFactory.next({ type: "HEAL_RESOLVED", sourceUnitId: sourceNow.unitId, targetUnitId: targetId, effectIndex, hitResult: resolved.value.hitResult, healed: resolved.value.healed, overheal: resolved.value.overheal, hpBefore: resolved.value.hpBefore, hpAfter: resolved.value.hpAfter, effect }));
        const onHeal = runComboTrigger(comboEvent("onHeal", sourceNow.unitId, sourceNow.unitId, target.unitId, resolved.value.hitResult));
        if (!onHeal.ok) return onHeal;
        if (resolved.value.overheal > 0) {
          const onOverheal = runComboTrigger(comboEvent("onOverheal", sourceNow.unitId, sourceNow.unitId, target.unitId, resolved.value.hitResult));
          if (!onOverheal.ok) return onOverheal;
        }
        if (sourceNow.faction === "party") snapshot.metrics.partyHealingDone += resolved.value.healed;
      }
    } else if (effect.kind === "shield") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        const sourceNow = unitOf(snapshot, actor.unitId);
        if (!target || !sourceNow || !isAlive(sourceNow)) continue;
        const dynamic = resolveDynamicModifiers(input, sourceNow, target, effect, snapshot);
        if (!dynamic.ok) return dynamic;
        const resolved = resolveShield({ source: sourceNow, target, effect, statusStackId: input.nextId("event"), getStatus: input.content?.getStatus, shieldBonusBps: dynamic.value.shieldBonusBps });
        if (!resolved.ok) return resolved;
        updateUnit(snapshot, resolved.value.nextTarget);
        emit(eventFactory.next({ type: "SHIELD_GRANTED", sourceUnitId: sourceNow.unitId, targetUnitId: targetId, effectIndex, statusStackId: resolved.value.statusStackId, granted: resolved.value.granted, discardedByCap: resolved.value.discardedByCap, shieldAfter: resolved.value.shieldAfter, effect }));
        if (resolved.value.granted > 0) {
          const onGainShield = runComboTrigger(comboEvent("onGainShield", sourceNow.unitId, sourceNow.unitId, target.unitId));
          if (!onGainShield.ok) return onGainShield;
        }
        if (sourceNow.faction === "party") snapshot.metrics.partyShieldGranted += resolved.value.granted;
      }
    } else if (effect.kind === "applyStatus") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        const sourceNow = unitOf(snapshot, actor.unitId);
        if (!target || !sourceNow || !isAlive(sourceNow)) continue;
        const applied = applyStatusEffect(snapshot, sourceNow, target, effect, input.content, input.rng, emit, eventFactory);
        if (!applied.ok) return applied;
        updateUnit(snapshot, target);
      }
    } else if (effect.kind === "changeEnergy") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target) continue;
        const before = target.energy;
        target.energy = applyEnergyGain(target.energy, effect.amount);
        if (before !== target.energy) emit(eventFactory.next({ type: "RESOURCE_CHANGED", targetUnitId: targetId, resource: "energy", skillId: null, before, after: target.energy, reason: "effect", effect }));
      }
    } else if (effect.kind === "changeCooldown") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target) continue;
        const before = target.cooldowns[effect.skillId] ?? 0;
        target.cooldowns[effect.skillId] = Math.max(0, before + effect.amountTurns);
        if (before !== target.cooldowns[effect.skillId]) emit(eventFactory.next({ type: "RESOURCE_CHANGED", targetUnitId: targetId, resource: "cooldown", skillId: effect.skillId, before, after: target.cooldowns[effect.skillId], reason: "effect", effect }));
      }
    } else if (effect.kind === "consumeStatus") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target) continue;
        const before = target.statuses.filter((value) => value.statusId === effect.statusId).length;
        let remaining = Math.max(0, effect.stacks);
        target.statuses = target.statuses.filter((value) => {
          if (remaining > 0 && value.statusId === effect.statusId) { remaining -= 1; return false; }
          return true;
        });
        const after = target.statuses.filter((value) => value.statusId === effect.statusId).length;
        if (before !== after) emit(eventFactory.next({ type: "STATUS_CHANGED", sourceUnitId: actor.unitId, targetUnitId: targetId, statusId: effect.statusId, statusStackId: null, change: "consumed", stacksBefore: before, stacksAfter: after, remainingOwnerTurnsAfter: target.statuses.find((value) => value.statusId === effect.statusId)?.remainingOwnerTurns ?? 0, effect }));
      }
    } else if (effect.kind === "dispel") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target) continue;
        const statusIds: string[] = [];
        for (const status of target.statuses) {
          const statusResult = getStatus(input.content, status.statusId);
          if (statusResult.ok && statusResult.value && statusResult.value.polarity === effect.polarity && statusResult.value.canDispel && !statusIds.includes(status.statusId)) statusIds.push(status.statusId);
        }
        for (const statusId of statusIds.slice(0, Math.max(0, effect.count))) {
          const before = target.statuses.filter((value) => value.statusId === statusId).length;
          target.statuses = target.statuses.filter((value) => value.statusId !== statusId);
          emit(eventFactory.next({ type: "STATUS_CHANGED", sourceUnitId: actor.unitId, targetUnitId: targetId, statusId, statusStackId: null, change: "dispelled", stacksBefore: before, stacksAfter: 0, remainingOwnerTurnsAfter: 0, effect }));
        }
      }
    } else if (effect.kind === "revive") {
      for (const targetId of stableTargetIds(targetIds, snapshot)) {
        const target = unitOf(snapshot, targetId);
        if (!target || isAlive(target)) continue;
        const targetStats = resolveEffectiveStats(target, input.content?.getStatus);
        if (!targetStats.ok) return targetStats;
        const restoredHp = Math.max(1, Math.floor((targetStats.value.maxHp * effect.restoreMaxHpBps) / 10_000));
        target.currentHp = Math.min(targetStats.value.maxHp, restoredHp);
        emit(eventFactory.next({ type: "UNIT_REVIVED", sourceUnitId: actor.unitId, unitId: targetId, restoredHp, effect }));
      }
    }
  }

  // 根效果完成后先结算本根行动者的 actionGain；若根效果已经击倒行动者，
  // 不得事后给死亡单位补能量。afterRootAction/周期时点必须排在其后。
  const actorAfterEffects = unitOf(snapshot, actor.unitId);
  if (kind === "basic" || kind === "active" || kind === "defend") {
    const baseGain = kind === "basic" ? 25 : kind === "active" ? 10 : 15;
    const modifierGain = input.skillModifierResolution?.energyGainDelta ?? 0;
    if (actorAfterEffects && isAlive(actorAfterEffects)) {
      const before = actorAfterEffects.energy;
      actorAfterEffects.energy = applyEnergyGain(actorAfterEffects.energy, baseGain + modifierGain);
      if (before !== actorAfterEffects.energy) emit(eventFactory.next({ type: "RESOURCE_CHANGED", targetUnitId: actorAfterEffects.unitId, resource: "energy", skillId: null, before, after: actorAfterEffects.energy, reason: "actionGain", effect: null }));
    }
  } else if (kind === "ultimate") {
    const modifierGain = input.skillModifierResolution?.energyGainDelta ?? 0;
    if (actorAfterEffects && isAlive(actorAfterEffects)) {
      const before = actorAfterEffects.energy;
      actorAfterEffects.energy = applyEnergyGain(actorAfterEffects.energy, modifierGain);
      if (before !== actorAfterEffects.energy) emit(eventFactory.next({ type: "RESOURCE_CHANGED", targetUnitId: actorAfterEffects.unitId, resource: "energy", skillId: null, before, after: actorAfterEffects.energy, reason: "actionGain", effect: null }));
    }
  }

  const afterRootAction = runComboTrigger(comboEvent("afterRootAction", actor.unitId, actor.unitId, rootTargets[0] ?? null));
  if (!afterRootAction.ok) return afterRootAction;

  // 两个时点严格分段：afterAction 的周期 FIFO 完成并发出到期事件后，
  // 才读取最新快照生成 turnEnd 的 burn/poison 周期。
  const afterActionTiming = runPeriodicTiming(actor.unitId, "afterAction", directDamageAmount > 0, directDamageAmount);
  if (!afterActionTiming.ok) return afterActionTiming;
  const afterActionDrain = applyPeriodicTiming(afterActionTiming.value, true);
  if (!afterActionDrain.ok) return afterActionDrain;

  const turnEndTiming = runPeriodicTiming(actor.unitId, "turnEnd");
  if (!turnEndTiming.ok) return turnEndTiming;
  const turnEndDrain = applyPeriodicTiming(turnEndTiming.value, true);
  if (!turnEndDrain.ok) return turnEndDrain;

  const outcome = finishOutcome(snapshot);
  snapshot.outcome = outcome;
  snapshot.phase = outcome === "victory" ? "VICTORY" : outcome === "defeat" ? "DEFEAT" : "TURN_END";
  emit(eventFactory.next({ type: "ACTION_FINISHED", actorUnitId: actor.unitId, outcomeAfter: outcome, effect: null }));
  if (outcome !== "ongoing") emit(eventFactory.next({ type: "BATTLE_FINISHED", outcome, effect: null }));
  snapshot.battleRevision += 1;
  snapshot.rngState = [...input.rng.getState()];
  if (comboQueue) {
    snapshot.metrics.triggerBudgetExhaustedCount += comboQueue.triggerBudgetExhaustedCount;
    snapshot.pendingEvents = [];
  }
  return success({ snapshot, events, consumedItem: input.item && input.command.type === "USE_ITEM" ? { itemId: input.command.itemId, quantity: 1 } : (options.consumedItem ?? null) });
}

/** 纯函数根行动入口；异常也转为严格 INVALID_CONTENT，不污染调用方快照。 */
export function resolveBattleAction(input: BattleActionResolverInput, options: BattleActionResolverOptions = {}): DomainResult<BattleResolutionV1> {
  try {
    return resolveBattleActionInternal(input, options);
  } catch {
    return invalid("battleAction", "resolver_exception");
  }
}

export const resolveAction = resolveBattleAction;

/**
 * 解析由 BattleReducer 控制状态产生的跳过根行动。
 *
 * 控制跳过不扩展公开 BattleCommandV1；应用层只需传入当前快照、RNG 和
 * 内容读取器，解析器会严格要求快照已处于 RESOLVE_ACTION 且存在 skipTurn 状态。
 */
export function resolveControlledSkipAction(input: ControlledSkipActionInput): DomainResult<BattleResolutionV1> {
  try {
    const actorUnitId = input.actorUnitId ?? input.snapshot.currentUnitId ?? "";
    const command: BattleCommandV1 = input.command ?? {
      type: "DEFEND",
      expectedBattleRevision: input.snapshot.battleRevision,
      actorUnitId,
    };
    return resolveBattleActionInternal({ ...input, command }, { controlledSkip: true });
  } catch {
    return invalid("controlledSkip", "resolver_exception");
  }
}

export const resolveControlSkipAction = resolveControlledSkipAction;
