/**
 * 词条/Combo 触发候选收集器。
 *
 * 这里仅读取事件发生前的 loadout/Combo 快照并生成 TriggerCandidate；候选
 * 的 chance、预算提交和派生效果入队统一交给 TriggerQueue。
 */
import type {
  AffixTriggerDefinition,
  BattleActionDefinitionIdV1,
  BattleUnitStateV1,
  ComboDefinition,
  EffectSpec,
  SkillId,
  TriggerSkillKindV1,
  TriggerSpec,
} from "../../content/contracts";
import { SeededRng } from "../common/SeededRng";
import { ComboRuntimeGuard } from "../combo/ComboRuntimeGuard";
import { TriggerQueue, orderTriggerCandidates, type TriggerCandidate, type TriggerCandidateOrder } from "./TriggerQueue";

export interface TriggerRuntimeEvent {
  readonly event: TriggerSpec["event"];
  readonly eventOwnerUnitId: string | null;
  readonly sourceUnitId: string | null;
  readonly targetUnitId: string | null;
  readonly rootActionId: string;
  readonly rootActionDefinitionId: BattleActionDefinitionIdV1;
  readonly chainDepth: number;
  readonly round: number;
  readonly contextSkillKind: TriggerSkillKindV1 | null;
  readonly visualSkillId?: SkillId | null;
  readonly hitResult?: "critical" | "nonCritical" | "notApplicable";
  readonly sourceHp?: number;
  readonly sourceEffectiveMaxHp?: number;
  readonly targetHp?: number;
  readonly targetEffectiveMaxHp?: number;
  readonly units: readonly BattleUnitStateV1[];
}

export interface EquipmentTriggerCandidateInput {
  readonly affixId: string;
  readonly ownerUnitId: string;
  readonly ownerFaction: "party" | "enemy";
  readonly ownerSlot: number;
  readonly equipmentSlot: "weapon" | "helmet" | "armor" | "gloves" | "boots" | "accessory";
  readonly sourceInstanceId: string;
  readonly sourceRollIndex: number | "abyss";
  readonly affixRoll?: number;
  readonly definition?: Readonly<AffixTriggerDefinition>;
  readonly trigger: Readonly<TriggerSpec>;
  readonly effects: readonly EffectSpec[];
  readonly chanceBps?: number;
  readonly budget: Readonly<{ maxPerRootAction: number; maxPerRound: number; maxPerBattle: number }>;
  readonly sourceAlive?: () => boolean;
  readonly targetLegal?: (effect: EffectSpec) => boolean;
}

export interface SkillTriggerCandidateInput {
  readonly skillAffixId: string;
  readonly ownerUnitId: string;
  readonly ownerFaction: "party" | "enemy";
  readonly ownerSlot: number;
  readonly sourceInstanceId: string;
  readonly sourceRollIndex: number | "abyss";
  readonly affixRoll?: number;
  readonly definition?: Readonly<AffixTriggerDefinition>;
  readonly trigger: Readonly<TriggerSpec>;
  readonly effects: readonly EffectSpec[];
  readonly chanceBps?: number;
  readonly budget: Readonly<{ maxPerRootAction: number; maxPerRound: number; maxPerBattle: number }>;
  readonly effectSkillId?: SkillId | null;
  readonly sourceAlive?: () => boolean;
  readonly targetLegal?: (effect: EffectSpec) => boolean;
}

export interface ComboCandidateInput {
  readonly combo: Readonly<ComboDefinition>;
  readonly ownerUnitId: string;
  readonly ownerFaction: "party" | "enemy";
  readonly ownerSlot: number;
  readonly sourceAlive?: () => boolean;
  readonly targetLegal?: (effect: EffectSpec) => boolean;
  readonly consumeTargetStatus?: () => readonly import("../../content/contracts").BattleDomainEventV1[];
}

export interface CollectCandidatesInput {
  readonly event: TriggerRuntimeEvent;
  readonly equipment?: readonly EquipmentTriggerCandidateInput[];
  readonly skillAffixes?: readonly SkillTriggerCandidateInput[];
  readonly personalCombos?: readonly ComboCandidateInput[];
  readonly partyCombos?: readonly ComboCandidateInput[];
}

export interface ComboTriggerRuntimeOptions {
  readonly guard?: ComboRuntimeGuard;
  readonly rng: SeededRng;
}

function validInteger(value: number, min = 0): boolean {
  return Number.isSafeInteger(value) && value >= min;
}

function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, value));
}

function integerHpAtMost(hp: number | undefined, maxHp: number | undefined, thresholdBps: number | null): boolean {
  if (thresholdBps === null) return true;
  if (!validInteger(hp ?? -1) || !validInteger(maxHp ?? -1, 1) || !validInteger(thresholdBps) || thresholdBps > 10_000) return false;
  return (hp as number) * 10_000 <= (maxHp as number) * thresholdBps;
}

function hasStatus(unit: BattleUnitStateV1 | undefined, statusIds: readonly string[]): boolean {
  if (statusIds.length === 0) return true;
  return Boolean(unit && statusIds.every((statusId) => unit.statuses.some((status) => status.statusId === statusId)));
}

function unitById(event: TriggerRuntimeEvent, unitId: string | null): BattleUnitStateV1 | undefined {
  return unitId === null ? undefined : event.units.find((unit) => unit.unitId === unitId);
}

function matchesTrigger(trigger: Readonly<TriggerSpec>, event: TriggerRuntimeEvent): boolean {
  if (trigger.event !== event.event) return false;
  if (trigger.requiredSkillKinds.length > 0 && !trigger.requiredSkillKinds.includes(event.contextSkillKind as TriggerSkillKindV1)) return false;
  if (trigger.requiredHitResult !== "any" && trigger.requiredHitResult !== (event.hitResult ?? "notApplicable")) return false;
  if (!integerHpAtMost(event.sourceHp, event.sourceEffectiveMaxHp, trigger.requiredSourceHpAtMostBps)) return false;
  if (!integerHpAtMost(event.targetHp, event.targetEffectiveMaxHp, trigger.requiredTargetHpAtMostBps)) return false;
  if (!hasStatus(unitById(event, event.sourceUnitId), trigger.requiredSourceStatusIds)) return false;
  if (!hasStatus(unitById(event, event.targetUnitId), trigger.requiredTargetStatusIds)) return false;
  return true;
}

function sourceOrder(
  sourceKind: TriggerCandidateOrder["sourceKind"],
  ownerFaction: "party" | "enemy",
  ownerSlot: number,
  definitionId: string,
  equipmentSlot?: EquipmentTriggerCandidateInput["equipmentSlot"],
  sourceRollIndex?: number | "abyss",
): TriggerCandidateOrder {
  return { sourceKind, ownerFaction, ownerSlot, definitionId, equipmentSlot, sourceRollIndex };
}

function effectTargetIds(event: TriggerRuntimeEvent, effects: readonly EffectSpec[]): readonly string[] {
  const hasSingle = effects.some((effect) => "targetRule" in effect && (effect.targetRule === "singleEnemy" || effect.targetRule === "singleAlly" || effect.targetRule === "deadAlly"));
  return hasSingle && event.targetUnitId !== null ? [event.targetUnitId] : [];
}

function calculateChance(input: { readonly chanceBps?: number; readonly affixRoll?: number; readonly definition?: Readonly<AffixTriggerDefinition> }): number {
  if (input.chanceBps !== undefined) return clampBps(input.chanceBps);
  if (!input.definition) return 10_000;
  if (input.definition.chance.kind === "fixed") return clampBps(input.definition.chance.valueBps);
  return clampBps(Math.floor((input.affixRoll ?? 0) * input.definition.chance.scaleBps / 10_000));
}

function ownerFactionForEvent(event: TriggerRuntimeEvent): "party" | "enemy" | null {
  return event.eventOwnerUnitId === null ? null : unitById(event, event.eventOwnerUnitId)?.faction ?? null;
}

function baseCandidate(
  event: TriggerRuntimeEvent,
  common: Omit<TriggerCandidate, "rootActionId" | "rootActionDefinitionId" | "chainDepth" | "targetUnitIds">,
): TriggerCandidate {
  return {
    ...common,
    // 收集完成即冻结本次事件的 effects，后续状态变化不能反向修改候选。
    effects: common.effects.map((effect) => structuredClone(effect)),
    rootActionId: event.rootActionId,
    rootActionDefinitionId: event.rootActionDefinitionId,
    chainDepth: event.chainDepth + 1,
    targetUnitIds: effectTargetIds(event, common.effects),
  };
}

export class ComboTriggerRuntime {
  public readonly guard: ComboRuntimeGuard;
  public readonly rng: SeededRng;

  public constructor(options: ComboTriggerRuntimeOptions) {
    this.guard = options.guard ?? new ComboRuntimeGuard();
    this.rng = options.rng;
  }

  public collectCandidates(input: CollectCandidatesInput): TriggerCandidate[] {
    const event = input.event;
    const eventFaction = ownerFactionForEvent(event);
    const candidates: TriggerCandidate[] = [];
    for (const source of input.equipment ?? []) {
      // 装备词条只属于事件 owner；owner 为空时不能凭 sourceUnitId 猜测来源。
      if (event.eventOwnerUnitId === null || source.ownerUnitId !== event.eventOwnerUnitId || !matchesTrigger(source.trigger, event)) continue;
      if (source.definition && source.definition.id !== source.affixId) continue;
      const triggerSource = { kind: "equipmentAffix", affixId: source.affixId, ownerUnitId: source.ownerUnitId, sourceInstanceId: source.sourceInstanceId, sourceRollIndex: source.sourceRollIndex } as const;
      candidates.push(baseCandidate(event, {
        kind: "equipmentAffix",
        sourceKey: `${source.ownerUnitId}:equipmentAffix:${source.affixId}`,
        sourceUnitId: source.ownerUnitId,
        ownerUnitId: source.ownerUnitId,
        ownerFaction: source.ownerFaction,
        ownerSlot: source.ownerSlot,
        sourceOrder: sourceOrder("equipmentAffix", source.ownerFaction, source.ownerSlot, source.affixId, source.equipmentSlot, source.sourceRollIndex),
        triggerSource,
        effects: [...source.effects],
        visualSkillId: null,
        contextSkillKind: null,
        chanceBps: calculateChance(source),
        budget: source.budget,
        isSourceAlive: source.sourceAlive,
        hasLegalTarget: source.targetLegal,
      }));
    }
    for (const source of input.skillAffixes ?? []) {
      // 技能词条和装备词条一样，只从 eventOwner 的已装备铭石快照收集。
      if (event.eventOwnerUnitId === null || source.ownerUnitId !== event.eventOwnerUnitId || !matchesTrigger(source.trigger, event)) continue;
      if (source.definition && source.definition.id !== source.skillAffixId) continue;
      const triggerSource = { kind: "skillAffix", skillAffixId: source.skillAffixId, ownerUnitId: source.ownerUnitId, sourceInstanceId: source.sourceInstanceId, sourceRollIndex: source.sourceRollIndex } as const;
      candidates.push(baseCandidate(event, {
        kind: "skillAffix",
        sourceKey: `${source.ownerUnitId}:skillAffix:${source.skillAffixId}`,
        sourceUnitId: source.ownerUnitId,
        ownerUnitId: source.ownerUnitId,
        ownerFaction: source.ownerFaction,
        ownerSlot: source.ownerSlot,
        sourceOrder: sourceOrder("skillAffix", source.ownerFaction, source.ownerSlot, source.skillAffixId, undefined, source.sourceRollIndex),
        triggerSource,
        effects: [...source.effects],
        visualSkillId: source.effectSkillId ?? null,
        contextSkillKind: source.effectSkillId !== null && source.effectSkillId !== undefined ? "effect" : null,
        chanceBps: calculateChance(source),
        budget: source.budget,
        isSourceAlive: source.sourceAlive,
        hasLegalTarget: source.targetLegal,
      }));
    }
    for (const source of input.personalCombos ?? []) {
      if (source.combo.scope !== "personal" || source.ownerUnitId !== event.eventOwnerUnitId || !matchesTrigger(source.combo.trigger, event)) continue;
      const triggerSource = { kind: "combo", comboId: source.combo.id, ownerKey: source.ownerUnitId } as const;
      candidates.push(baseCandidate(event, {
        kind: "personalCombo",
        sourceKey: `${source.ownerUnitId}:combo:${source.combo.id}`,
        sourceUnitId: source.ownerUnitId,
        ownerUnitId: source.ownerUnitId,
        ownerFaction: source.ownerFaction,
        ownerSlot: source.ownerSlot,
        sourceOrder: sourceOrder("personalCombo", source.ownerFaction, source.ownerSlot, source.combo.id),
        triggerSource,
        effects: [...source.combo.effects],
        combo: source.combo,
        visualSkillId: null,
        contextSkillKind: null,
        budget: source.combo.budget,
        isSourceAlive: source.sourceAlive,
        hasLegalTarget: source.targetLegal,
        consume: source.consumeTargetStatus,
      }));
    }
    for (const source of input.partyCombos ?? []) {
      if (source.combo.scope !== "party" || eventFaction === null || source.ownerFaction !== eventFaction || !matchesTrigger(source.combo.trigger, event)) continue;
      const triggerSource = { kind: "combo", comboId: source.combo.id, ownerKey: "party" } as const;
      candidates.push(baseCandidate(event, {
        kind: "partyCombo",
        sourceKey: `party:combo:${source.combo.id}`,
        sourceUnitId: source.ownerUnitId,
        ownerUnitId: source.ownerUnitId,
        ownerFaction: source.ownerFaction,
        ownerSlot: source.ownerSlot,
        sourceOrder: sourceOrder("partyCombo", source.ownerFaction, source.ownerSlot, source.combo.id),
        triggerSource,
        effects: [...source.combo.effects],
        combo: source.combo,
        visualSkillId: null,
        contextSkillKind: null,
        budget: source.combo.budget,
        isSourceAlive: source.sourceAlive,
        hasLegalTarget: source.targetLegal,
        consume: source.consumeTargetStatus,
      }));
    }
    return orderTriggerCandidates(candidates);
  }

  public createQueue(options: Omit<import("./TriggerQueue").TriggerQueueOptions, "rng" | "guard" | "rootActionId" | "rootActionDefinitionId" | "round"> & { readonly round?: number; readonly rootActionId?: string; readonly rootActionDefinitionId?: BattleActionDefinitionIdV1 }): TriggerQueue {
    return new TriggerQueue({
      ...options,
      round: options.round ?? 1,
      rootActionId: options.rootActionId ?? "root_combo",
      rootActionDefinitionId: options.rootActionDefinitionId ?? "skill_combo",
      rng: this.rng,
      guard: this.guard,
    });
  }

  public resetRound(): void {
    this.guard.resetRound();
  }

  public resetBattle(): void {
    this.guard.resetBattle();
  }
}
