import { describe, expect, it } from "vitest";

import type { EffectSpec, TriggerSourceV1 } from "../../src/content/contracts";
import { COMBO_DEFINITIONS } from "../../src/content/data/combos";
import { SeededRng } from "../../src/domain/common/SeededRng";
import {
  TriggerQueue,
  orderTriggerCandidates,
  type TriggerCandidate,
} from "../../src/domain/battle/TriggerQueue";
import { ComboRuntimeGuard } from "../../src/domain/combo/ComboRuntimeGuard";

const damage: EffectSpec = {
  kind: "damage",
  targetRule: "singleEnemy",
  element: "physical",
  powerBps: 1000,
  flatPower: 0,
  canCrit: false,
  ignoreDefenseBps: 0,
  flatIgnoreDefense: 0,
  hitCount: 1,
  retargetEachHit: false,
  conditionalMultipliers: [],
};

function candidate(overrides: Partial<TriggerCandidate> = {}): TriggerCandidate {
  const source: TriggerSourceV1 = { kind: "equipmentAffix", affixId: "af_test", ownerUnitId: "party:0", sourceInstanceId: "equip_0", sourceRollIndex: 0 };
  return {
    kind: "equipmentAffix",
    sourceKey: "party:0:equipmentAffix:af_test",
    sourceUnitId: "party:0",
    ownerUnitId: "party:0",
    ownerFaction: "party",
    ownerSlot: 0,
    sourceOrder: { sourceKind: "equipmentAffix", ownerFaction: "party", ownerSlot: 0, equipmentSlot: "weapon", sourceRollIndex: 0, definitionId: "af_test" },
    triggerSource: source,
    effects: [damage],
    rootActionId: "root_queue",
    rootActionDefinitionId: "skill_root",
    chainDepth: 1,
    targetUnitIds: ["enemy:0"],
    visualSkillId: null,
    contextSkillKind: null,
    budget: { maxPerRootAction: 2, maxPerRound: 2, maxPerBattle: 4 },
    ...overrides,
  };
}

function queue(overrides: Partial<ConstructorParameters<typeof TriggerQueue>[0]> = {}): TriggerQueue {
  const base: ConstructorParameters<typeof TriggerQueue>[0] = {
    battleId: "battle_queue",
    round: 1,
    rootActionId: "root_queue",
    rootActionDefinitionId: "skill_root",
    rng: SeededRng.fromState([1, 2, 3, 4]),
    guard: new ComboRuntimeGuard(),
    nextEventId: (() => { let i = 0; return () => `queue_event_${i++}`; })(),
  };
  return new TriggerQueue({ ...base, ...overrides });
}

describe("TriggerQueue", () => {
  it("按装备→技能→个人 Combo→队伍 Combo排序，并保持严格 FIFO", () => {
    const values = [
      candidate({ kind: "partyCombo", sourceKey: "party:combo:party", sourceOrder: { sourceKind: "partyCombo", ownerFaction: "party", ownerSlot: 0, definitionId: "combo_z" }, combo: { ...COMBO_DEFINITIONS[3], id: "combo_z" } }),
      candidate({ kind: "personalCombo", sourceKey: "party:0:combo:personal", sourceOrder: { sourceKind: "personalCombo", ownerFaction: "party", ownerSlot: 0, definitionId: "combo_personal" }, combo: { ...COMBO_DEFINITIONS[0], id: "combo_personal", scope: "personal" } }),
      candidate({ kind: "skillAffix", sourceKey: "party:0:skillAffix:sa_test", sourceOrder: { sourceKind: "skillAffix", ownerFaction: "party", ownerSlot: 0, sourceRollIndex: 0, definitionId: "sa_test" } }),
    ];
    expect(orderTriggerCandidates(values).map((value) => value.kind)).toEqual(["skillAffix", "personalCombo", "partyCombo"]);

    const value = queue();
    expect(value.enqueueCandidates([candidate({ effects: [damage, { ...damage, flatPower: 1 }] })]).accepted).toBe(1);
    expect(value.pendingEvents.map((event) => event.effectIndex)).toEqual([0, 1]);
    const drained: string[] = [];
    const result = value.drain((event) => {
      drained.push(event.eventId);
      return { ok: true as const, events: [] };
    }, () => []);
    expect(result.applied).toBe(2);
    expect(drained).toEqual(["queue_event_0", "queue_event_1"]);
  });

  it("条件/目标/预算失败不消费 RNG；chance 失败只消费一次 RNG 且不占状态预算", () => {
    const value = queue();
    const before = value.rngState;
    const rejected = value.enqueueCandidates([
      candidate({ validate: () => ({ ok: false, reason: "TARGET_INVALID" }) }),
    ]);
    expect(rejected.rejected[0]).toMatchObject({ reason: "TARGET_INVALID", consumedRng: false });
    expect(value.rngState).toEqual(before);

    const chance = queue({ rng: SeededRng.fromState([1, 2, 3, 4]) });
    const chanceBefore = chance.rngState;
    const chanceResult = chance.enqueueCandidates([candidate({ chanceBps: 1, consume: () => { throw new Error("不应消费状态"); } })]);
    expect(chanceResult.rejected[0]).toMatchObject({ reason: "CHANCE_FAILED", consumedRng: true });
    expect(chance.rngState).not.toEqual(chanceBefore);
    expect(chance.pendingEvents).toHaveLength(0);
  });

  it("多 effect 先整体校验 8/32 容量，超限整组拒绝且成功组按定义数组连续入队", () => {
    const value = queue();
    const tooMany = Array.from({ length: 9 }, () => damage);
    const result = value.enqueueCandidates([candidate({ effects: tooMany })]);
    expect(result.rejected[0]).toMatchObject({ reason: "UNIT_DAMAGE_BUDGET" });
    expect(value.pendingEvents).toHaveLength(0);

    const open = queue();
    const accepted = open.enqueueCandidates([candidate({ effects: [damage, { ...damage, flatPower: 2 }] })]);
    expect(accepted.accepted).toBe(1);
    expect(open.pendingEvents.map((event) => event.effect.kind === "damage" ? event.effect.flatPower : null)).toEqual([0, 2]);
  });

  it("来源/单目标在应用点失效只跳过单 event，不回滚同候选预算", () => {
    const value = queue();
    value.enqueueCandidates([candidate({ effects: [damage, { ...damage, flatPower: 2 }] })]);
    const result = value.drain(() => ({ ok: false as const, reason: "SOURCE_INVALID" as const }), () => []);
    expect(result.applied).toBe(0);
    expect(result.rejected.filter((event) => event.reason === "SOURCE_INVALID")).toHaveLength(2);
    expect(value.budgetSnapshot.unitDamageCounts["root_queue:party:0"]).toBe(2);
  });

  it("Combo 成功事件先于状态消耗事件，随后才入队 effects", () => {
    const value = queue();
    const combo = { ...COMBO_DEFINITIONS[0], id: "combo_consume_order", scope: "personal" as const, effects: [damage] };
    const result = value.enqueueCandidates([candidate({
      kind: "personalCombo",
      sourceKey: "party:0:combo:combo_consume_order",
      sourceOrder: { sourceKind: "personalCombo", ownerFaction: "party", ownerSlot: 0, definitionId: "combo_consume_order" },
      triggerSource: { kind: "combo", comboId: "combo_consume_order", ownerKey: "party:0" },
      combo,
      consume: () => [{
        type: "STATUS_CHANGED",
        eventId: "consume_order_event",
        sequence: 0,
        battleId: "battle_queue",
        round: 1,
        rootActionId: "root_queue",
        rootActionDefinitionId: "skill_root",
        chainDepth: 1,
        triggerSource: { kind: "combo", comboId: "combo_consume_order", ownerKey: "party:0" },
        visualSkillId: null,
        contextSkillKind: null,
        effect: null,
        sourceUnitId: "party:0",
        targetUnitId: "enemy:0",
        statusId: "status_burn",
        statusStackId: "burn_0",
        change: "consumed",
        stacksBefore: 1,
        stacksAfter: 0,
        remainingOwnerTurnsAfter: 0,
      } as const],
    })]);
    expect(result.accepted).toBe(1);
    expect(value.events.map((event) => event.type)).toEqual(["COMBO_TRIGGERED", "STATUS_CHANGED"]);
    expect(value.pendingEvents).toHaveLength(1);
  });
});
