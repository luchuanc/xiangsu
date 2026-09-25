import { describe, expect, it } from "vitest";

import type { BattleSnapshotV1, BattleUnitStateV1, ComboDefinition, ContentRootV1, EffectSpec } from "../../src/content/contracts";
import { COMBO_DEFINITIONS } from "../../src/content/data/combos";
import { abyssEchoContentRoot } from "../../src/content/data/abyssEchoes";
import { SeededRng } from "../../src/domain/common/SeededRng";
import { SequentialIdFactory } from "../../src/domain/common/DomainContext";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { ComboRuntimeGuard } from "../../src/domain/combo/ComboRuntimeGuard";
import {
  ComboTriggerRuntime,
  type TriggerRuntimeEvent,
} from "../../src/domain/battle/ComboTriggerRuntime";
import { createBattleComboRuntime } from "../../src/domain/battle/BattleComboRuntime";
import { failure, success } from "../../src/domain/common/DomainResult";

const baseStats = { maxHp: 100, attack: 100, defense: 300, speed: 10, critRateBps: 0, critDamageBps: 15000, effectHitBps: 0, effectResistBps: 0 };

function unit(unitId: string, faction: "party" | "enemy", slot: number, hp = 100): BattleUnitStateV1 {
  return { unitId, definitionId: unitId, faction, slot, level: 1, prePercentStats: { ...baseStats }, staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 }, stats: { ...baseStats }, currentHp: hp, energy: 0, cooldowns: {}, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [] };
}

const effect: EffectSpec = { kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 3000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] };
const trigger = { event: "afterDirectHit" as const, requiredSkillKinds: [], requiredHitResult: "any" as const, requiredSourceHpAtMostBps: null, requiredTargetHpAtMostBps: null, requiredSourceStatusIds: [], requiredTargetStatusIds: [], consumeTargetStatus: null };

function event(overrides: Partial<TriggerRuntimeEvent> = {}): TriggerRuntimeEvent {
  return {
    event: "afterDirectHit",
    eventOwnerUnitId: "party:0",
    sourceUnitId: "party:0",
    targetUnitId: "enemy:0",
    rootActionId: "root_combo",
    rootActionDefinitionId: "skill_root",
    chainDepth: 0,
    round: 1,
    contextSkillKind: "active",
    hitResult: "nonCritical",
    units: [unit("party:0", "party", 0), unit("enemy:0", "enemy", 0, 50)],
    ...overrides,
  };
}

function runtime() {
  return new ComboTriggerRuntime({ guard: new ComboRuntimeGuard(), rng: SeededRng.fromState([1, 2, 3, 4]) });
}

function combo(overrides: Partial<ComboDefinition> = {}): ComboDefinition {
  return { ...COMBO_DEFINITIONS[0], id: "combo_test", trigger, effects: [effect], ...overrides };
}

describe("ComboTriggerRuntime", () => {
  it("按四类来源建立稳定候选，并生成契约要求的 sourceKey/triggerSource", () => {
    const value = runtime();
    const candidates = value.collectCandidates({
      event: event(),
      equipment: [{ affixId: "af_test", ownerUnitId: "party:0", ownerFaction: "party", ownerSlot: 0, equipmentSlot: "weapon", sourceInstanceId: "equip_0", sourceRollIndex: 0, effects: [effect], trigger, chanceBps: 10000, budget: { maxPerRootAction: 2, maxPerRound: 2, maxPerBattle: 2 } }],
      skillAffixes: [{ skillAffixId: "sa_test", ownerUnitId: "party:0", ownerFaction: "party", ownerSlot: 0, sourceInstanceId: "stone_0", sourceRollIndex: 0, effects: [effect], trigger, chanceBps: 10000, budget: { maxPerRootAction: 2, maxPerRound: 2, maxPerBattle: 2 } }],
      personalCombos: [{ combo: combo({ id: "combo_personal", scope: "personal" }), ownerUnitId: "party:0", ownerFaction: "party", ownerSlot: 0 }],
      partyCombos: [{ combo: combo({ id: "combo_party", scope: "party" }), ownerUnitId: "party:0", ownerFaction: "party", ownerSlot: 0 }],
    });
    expect(candidates.map((candidate) => candidate.kind)).toEqual(["equipmentAffix", "skillAffix", "personalCombo", "partyCombo"]);
    expect(candidates.map((candidate) => candidate.sourceKey)).toEqual([
      "party:0:equipmentAffix:af_test",
      "party:0:skillAffix:sa_test",
      "party:0:combo:combo_personal",
      "party:combo:combo_party",
    ]);
    expect(candidates[0].triggerSource).toMatchObject({ kind: "equipmentAffix", sourceInstanceId: "equip_0", sourceRollIndex: 0 });
    expect(candidates[2].triggerSource).toMatchObject({ kind: "combo", comboId: "combo_personal", ownerKey: "party:0" });
    expect(candidates[3].triggerSource).toMatchObject({ kind: "combo", comboId: "combo_party", ownerKey: "party" });
  });

  it("按整数交叉乘法检查 HP/状态/技能类型，并支持反击→追击→反击的深度截断", () => {
    const value = runtime();
    const trigger = { ...triggerBase(), requiredSkillKinds: ["active" as const], requiredTargetHpAtMostBps: 5000 };
    const source = unit("party:0", "party", 0, 40);
    source.statuses = [{ stackId: "shield_0", statusId: "status_shield", sourceUnitId: "party:0", remainingOwnerTurns: 2, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 100, shieldRemaining: 10 }];
    const candidates = value.collectCandidates({
      event: event({ units: [source, unit("enemy:0", "enemy", 0, 50)], sourceHp: 40, sourceEffectiveMaxHp: 100, targetHp: 50, targetEffectiveMaxHp: 100 }),
      personalCombos: [{ combo: combo({ trigger }), ownerUnitId: "party:0", ownerFaction: "party", ownerSlot: 0 }],
    });
    expect(candidates).toHaveLength(1);

    const queue = value.createQueue({ battleId: "battle_combo", nextEventId: (() => { let i = 0; return () => `combo_event_${i++}`; })() });
    expect(queue.enqueueCandidates(candidates).accepted).toBe(1);
    const second = value.collectCandidates({ event: event({ chainDepth: 3, sourceUnitId: "party:0", sourceHp: 40, sourceEffectiveMaxHp: 100, targetHp: 50, targetEffectiveMaxHp: 100 }), personalCombos: [{ combo: combo({ trigger }), ownerUnitId: "party:0", ownerFaction: "party", ownerSlot: 0 }] });
    expect(second).toHaveLength(1);
    const rejected = queue.enqueueCandidates(second);
    expect(rejected.rejected[0]).toMatchObject({ reason: "CHAIN_DEPTH", consumedRng: false });
  });

  it("重复 personal Combo 按 owner 各一次，party Combo 按整队一次，且预算拒绝记录 sourceKey", () => {
    const guard = new ComboRuntimeGuard();
    const value = new ComboTriggerRuntime({ guard, rng: SeededRng.fromState([1, 2, 3, 4]) });
    const personal = combo({ id: "combo_personal_once", scope: "personal", budget: { maxPerRootAction: 1, maxPerRound: 2, maxPerBattle: 2 } });
    const candidates = value.collectCandidates({ event: event(), personalCombos: [{ combo: personal, ownerUnitId: "party:0", ownerFaction: "party", ownerSlot: 0 }] });
    const queue = value.createQueue({ battleId: "battle_combo", nextEventId: (() => { let i = 0; return () => `combo_event_${i++}`; })() });
    expect(queue.enqueueCandidates(candidates).accepted).toBe(1);
    const duplicate = queue.enqueueCandidates(candidates);
    expect(duplicate.rejected[0]).toMatchObject({ reason: "ROOT_BUDGET", sourceKey: "party:0:combo:combo_personal_once" });
  });

  it("从同一存档严格匹配 personal Combo，并只为 party 事件建立装备来源", () => {
    const root = structuredClone(abyssEchoContentRoot) as ContentRootV1;
    const characterId = root.protagonistCharacterId;
    const innateTag = root.characters.find((value) => value.id === characterId)?.innateTags[0]?.tagId;
    if (!innateTag) throw new Error("expected protagonist innate tag");
    const comboDefinition: ComboDefinition = {
      ...root.combos[0],
      id: "combo_runtime_adapter",
      scope: "personal",
      requirements: [{ source: "innate", tagId: innateTag, count: 1 }],
      trigger: { ...trigger, event: "afterDirectHit" },
      effects: [effect],
      budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 },
    };
    root.combos = [...root.combos, comboDefinition];
    const save = createNewGameSave(root, "2026-08-26T00:00:00.000Z", { newGameSeed: 1, idFactory: new SequentialIdFactory() });
    const enemy = unit("enemy:0", "enemy", 100);
    const party = { ...unit("party:0", "party", 100), definitionId: characterId };
    const snapshot: BattleSnapshotV1 = {
      battleId: "battle_combo_adapter",
      expeditionId: "exp_combo_adapter",
      battleRevision: 0,
      encounterId: "enc_combo_adapter",
      encounterObjectId: "object_combo_adapter",
      phase: "AWAIT_COMMAND",
      outcome: "ongoing",
      round: 1,
      units: [party, enemy],
      initiativeQueueUnitIds: [],
      currentUnitId: party.unitId,
      pendingEvents: [],
      pendingBossIntents: [],
      successfulItemUses: 0,
      abyssEchoOutcome: "notApplicable",
      rngState: [1, 2, 3, 4],
      firedComboKeys: [],
      roundTriggerCounts: {},
      battleTriggerCounts: {},
      metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 },
      reward: null,
      returnMapId: "map_combo_adapter",
      returnSafePosition: { x: 0, y: 0 },
    };
    const byId = <T extends { id: string }>(values: readonly T[], id: string) => {
      const value = values.find((entry) => entry.id === id);
      return value ? success(value) : failure({ code: "INVALID_CONTENT", details: { path: id, issueKey: "missing" } } as never);
    };
    const adapter = createBattleComboRuntime({
      save,
      content: {
        getRoot: () => root,
        getCharacter: (id) => byId(root.characters, id),
        getSkill: (id) => byId(root.skills, id),
        getEquipmentBase: (id) => byId(root.equipmentBases, id),
        getEquipmentAffix: (id) => byId(root.equipmentAffixes, id),
        getSkillAffix: (id) => byId(root.skillAffixes, id),
        getCombo: (id) => byId(root.combos, id),
      },
    });
    expect(adapter.ok).toBe(true);
    if (!adapter.ok) return;
    const candidates = adapter.value.collectCandidates({
      event: event({ eventOwnerUnitId: party.unitId, sourceUnitId: party.unitId, targetUnitId: enemy.unitId, units: [party, enemy] }),
      snapshot,
      nextEventId: () => "consume_event",
    });
    expect(candidates.ok).toBe(true);
    if (!candidates.ok) return;
    expect(candidates.value.filter((candidate) => candidate.kind === "personalCombo").map((candidate) => candidate.sourceKey)).toEqual(["party:0:combo:combo_runtime_adapter"]);
    const enemyEvent = adapter.value.collectCandidates({ event: event({ eventOwnerUnitId: enemy.unitId, sourceUnitId: enemy.unitId, targetUnitId: party.unitId, units: [party, enemy] }), snapshot, nextEventId: () => "enemy_event" });
    expect(enemyEvent).toMatchObject({ ok: true, value: [] });
  });
});

function triggerBase() {
  return trigger;
}
