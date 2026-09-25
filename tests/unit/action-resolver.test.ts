import { describe, expect, it } from "vitest";

import { fixtureContentRoot } from "../../src/content/data";
import { SeededRng } from "../../src/domain/common/SeededRng";
import { resolveBattleAction, resolveControlledSkipAction } from "../../src/domain/battle/ActionResolver";
import type { BattleComboRuntimeAdapter } from "../../src/domain/battle/BattleComboRuntime";
import type { TriggerRuntimeEvent } from "../../src/domain/battle/ComboTriggerRuntime";
import { ComboTriggerRuntime } from "../../src/domain/battle/ComboTriggerRuntime";
import type { TriggerCandidate } from "../../src/domain/battle/TriggerQueue";
import type { BattleCommandV1, BattleDomainEventV1, BattleSnapshotV1, BattleUnitStateV1, EffectSpec, EnemyDefinition, SkillDefinition, StatusDefinition } from "../../src/content/contracts";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";

function unit(unitId: string, faction: "party" | "enemy", currentHp = 100): BattleUnitStateV1 {
  return { unitId, definitionId: unitId, faction, slot: 0, level: 1, prePercentStats: { maxHp: 100, attack: 50, defense: 0, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 }, staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 }, stats: { maxHp: 100, attack: 50, defense: 0, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 }, currentHp, energy: 0, cooldowns: { skill_action_basic: 0 }, statuses: [], eligibleRound: 1, usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [] };
}

function snapshot(): BattleSnapshotV1 {
  return { battleId: "battle_action", expeditionId: "exp_action", battleRevision: 0, encounterId: "enc_action", encounterObjectId: "object_action", phase: "AWAIT_COMMAND", outcome: "ongoing", round: 1, units: [unit("party:0", "party"), unit("enemy:0", "enemy")], initiativeQueueUnitIds: [], currentUnitId: "party:0", pendingEvents: [], pendingBossIntents: [], successfulItemUses: 0, abyssEchoOutcome: "notApplicable", rngState: [1, 2, 3, 4], firedComboKeys: [], roundTriggerCounts: {}, battleTriggerCounts: {}, metrics: { damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {}, bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0 }, reward: null, returnMapId: "map_action", returnSafePosition: { x: 0, y: 0 } };
}

function enemyDefinition(id: string, stats: BattleUnitStateV1["stats"] = snapshot().units[1].stats): EnemyDefinition {
  return {
    id,
    nameKey: "enemy",
    level: 1,
    stats,
    elementWeaknesses: [],
    elementResistances: [],
    immunityTags: [],
    basicSkillId: "skill_action_basic",
    basicTargetStrategy: "frontFirstOpponent",
    skillIds: [],
    aiRules: [],
    spriteId: "enemy",
  };
}

function periodicStatus(
  id: string,
  timing: "afterAction" | "turnEnd",
  element: "fire" | "physical" | "poison" = "fire",
): StatusDefinition {
  return {
    id,
    nameKey: id,
    polarity: "debuff",
    maxStacks: 1,
    refreshRule: "replaceDuration",
    triggerTiming: timing,
    effect: { kind: "periodicDamage", element, snapshotPowerBps: 10_000 },
    canDispel: true,
    immunityTag: null,
    iconId: id,
  };
}

function buffStatus(id: string, effect: StatusDefinition["effect"] = { kind: "statModifier", stat: "attack", flat: 1, percentBps: 0 }): StatusDefinition {
  return {
    id,
    nameKey: id,
    polarity: "buff",
    maxStacks: 1,
    refreshRule: "replaceDuration",
    triggerTiming: "none",
    effect,
    canDispel: true,
    immunityTag: null,
    iconId: id,
  };
}

function comboCandidate(
  id: string,
  basic: SkillDefinition,
  effect: Extract<EffectSpec, { kind: "applyStatus" | "changeEnergy" }>,
): TriggerCandidate {
  const combo = {
    ...fixtureContentRoot.combos[0],
    id,
    scope: "personal" as const,
    effects: [effect],
    budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 },
  };
  return {
    kind: "personalCombo",
    sourceKey: `party:0:combo:${id}`,
    sourceUnitId: "party:0",
    ownerUnitId: "party:0",
    ownerFaction: "party",
    ownerSlot: 0,
    sourceOrder: { sourceKind: "personalCombo", ownerFaction: "party", ownerSlot: 0, definitionId: id },
    triggerSource: { kind: "combo", comboId: id, ownerKey: "party:0" },
    effects: combo.effects,
    combo,
    rootActionId: "root_action_runtime",
    rootActionDefinitionId: basic.id,
    chainDepth: 1,
    targetUnitIds: [],
    visualSkillId: null,
    contextSkillKind: null,
    budget: combo.budget,
  };
}

describe("ActionResolver", () => {
  it("生成连续 golden root trace，且不把 passive 放进 ACTION_STARTED", () => {
    const basic: SkillDefinition = { ...fixtureContentRoot.skills[0], id: "skill_action_basic", kind: "basic", owner: { kind: "systemEffect" }, targetRule: "singleEnemy", effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []] };
    const command: BattleCommandV1 = { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] };
    const enemy: EnemyDefinition = {
      id: "enemy:0",
      nameKey: "enemy",
      level: 1,
      stats: { maxHp: 100, attack: 50, defense: 0, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 },
      elementWeaknesses: [],
      elementResistances: [],
      immunityTags: [],
      basicSkillId: basic.id,
      basicTargetStrategy: "frontFirstOpponent",
      skillIds: [],
      aiRules: [],
      spriteId: "enemy",
    };
    const result = resolveBattleAction({ snapshot: snapshot(), command, skill: basic, skillKind: "basic", skillLevel: 1, content: { getEnemy: (id: string) => success({ ...enemy, id }) }, rng: SeededRng.fromState([1, 2, 3, 4]), nextId: (kind) => `${kind}_action` });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events.map((event) => event.sequence)).toEqual(result.value.events.map((_, index) => index));
      expect(result.value.events.find((event) => event.type === "ACTION_STARTED")?.visualSkillId).toBe("skill_action_basic");
      expect(result.value.consumedItem).toBeNull();
    }
  });

  it("效果继承技能前排门禁，并严格读取敌人元素弱点/抗性", () => {
    const fireSkill: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_fire",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      requiresFrontAccess: true,
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "fire", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const enemy: EnemyDefinition = {
      id: "enemy:0",
      nameKey: "enemy",
      level: 1,
      stats: { maxHp: 100, attack: 50, defense: 0, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 },
      elementWeaknesses: ["fire"],
      elementResistances: [],
      immunityTags: [],
      basicSkillId: fireSkill.id,
      basicTargetStrategy: "frontFirstOpponent",
      skillIds: [],
      aiRules: [],
      spriteId: "enemy",
    };
    const content = {
      getEnemy: (id: string) => id === enemy.id ? success(enemy) : success({ ...enemy, id }),
    };
    const command: BattleCommandV1 = { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] };
    const weak = resolveBattleAction({ snapshot: snapshot(), command, skill: fireSkill, skillKind: "basic", skillLevel: 1, content, rng: SeededRng.fromState([1, 2, 3, 4]), nextId: (kind) => `${kind}_weak` });
    expect(weak.ok).toBe(true);
    if (weak.ok) expect(weak.value.events.find((event) => event.type === "DAMAGE_RESOLVED")?.elementMultiplierBps).toBe(12_500);

    const resistant = resolveBattleAction({
      snapshot: snapshot(),
      command,
      skill: fireSkill,
      skillKind: "basic",
      skillLevel: 1,
      content: { getEnemy: () => success({ ...enemy, elementWeaknesses: [], elementResistances: ["fire"] }) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_resist`,
    });
    expect(resistant.ok).toBe(true);
    if (resistant.ok) expect(resistant.value.events.find((event) => event.type === "DAMAGE_RESOLVED")?.elementMultiplierBps).toBe(7_500);

    const blockedSnapshot = snapshot();
    blockedSnapshot.units = [unit("party:0", "party"), { ...unit("enemy:0", "enemy"), slot: 0 }, { ...unit("enemy:3", "enemy"), slot: 3 }];
    const blocked = resolveBattleAction({
      snapshot: blockedSnapshot,
      command: { ...command, targetUnitIds: ["enemy:3"] },
      skill: fireSkill,
      skillKind: "basic",
      skillLevel: 1,
      content,
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_blocked`,
    });
    expect(blocked).toMatchObject({ ok: false, error: { code: "FORMATION_BLOCKED" } });

    const mismatchedRuleSkill: SkillDefinition = {
      ...fireSkill,
      id: "skill_action_mismatched_rule",
      targetRule: "singleEnemy",
      requiresFrontAccess: false,
      effectsByLevel: [[{ kind: "heal", targetRule: "singleAlly", scalingStat: "maxHp", powerBps: 1_000, flatPower: 0, canCrit: false }], [], [], [], []],
    };
    const mismatched = resolveBattleAction({
      snapshot: snapshot(),
      command,
      skill: mismatchedRuleSkill,
      skillKind: "basic",
      skillLevel: 1,
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_mismatched`,
    });
    expect(mismatched.ok).toBe(true);
    if (mismatched.ok) expect(mismatched.value.events.find((event) => event.type === "HEAL_RESOLVED")?.targetUnitId).toBe("party:0");

    const missingGetter = resolveBattleAction({ snapshot: snapshot(), command, skill: fireSkill, skillKind: "basic", skillLevel: 1, rng: SeededRng.fromState([1, 2, 3, 4]), nextId: (kind) => `${kind}_missing` });
    expect(missingGetter).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT", details: { path: "content.getEnemy", issueKey: "getter_required" } } });

    const mismatchedEnemy = resolveBattleAction({
      snapshot: snapshot(),
      command,
      skill: fireSkill,
      skillKind: "basic",
      skillLevel: 1,
      content: { getEnemy: () => success({ ...enemy, id: "enemy:other" }) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_mismatch`,
    });
    expect(mismatchedEnemy).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT", details: { path: "enemies.enemy:0", issueKey: "id_mismatch" } } });

    const failedGetter = resolveBattleAction({
      snapshot: snapshot(),
      command,
      skill: fireSkill,
      skillKind: "basic",
      skillLevel: 1,
      content: { getEnemy: () => failure(createDomainError("INVALID_CONTENT", { path: "enemies.enemy:0", issueKey: "getter_failed" })) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_failed`,
    });
    expect(failedGetter).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT", details: { path: "enemies.enemy:0", issueKey: "getter_failed" } } });
  });

  it("DEFEND 写入 guard、获得 15 能量，并保持根事件 trace 连续", () => {
    const value = snapshot();
    const result = resolveBattleAction({
      snapshot: value,
      command: { type: "DEFEND", expectedBattleRevision: 0, actorUnitId: "party:0" },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_defend`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actor = result.value.snapshot.units.find((unit) => unit.unitId === "party:0");
    expect(actor?.energy).toBe(15);
    expect(actor?.statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ statusId: "status_guard_30", remainingOwnerTurns: 1 }),
    ]));
    expect(result.value.events.map((event) => event.type)).toEqual([
      "ACTION_STARTED", "STATUS_CHANGED", "RESOURCE_CHANGED", "ACTION_FINISHED",
    ]);
    expect(result.value.events.every((event, index) => event.sequence === index)).toBe(true);
    expect(result.value.events.every((event) => event.rootActionDefinitionId === "action_defend")).toBe(true);
  });

  it("主动技能按成本后获得 10 能量并写入 N+1 冷却，终极技能消耗 100 能量", () => {
    const active: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_active_resource",
      kind: "active",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      energyCostByLevel: [30, 30, 30, 30, 30],
      cooldownTurnsByLevel: [2, 2, 2, 2, 2],
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const activeSnapshot = snapshot();
    const activeActor = activeSnapshot.units.find((unit) => unit.unitId === "party:0");
    if (!activeActor) throw new Error("missing active actor");
    activeActor.energy = 50;
    const content = {
      getEnemy: (id: string) => success({
        id,
        nameKey: "enemy",
        level: 1,
        stats: activeSnapshot.units[1].stats,
        elementWeaknesses: [],
        elementResistances: [],
        immunityTags: [],
        basicSkillId: active.id,
        basicTargetStrategy: "frontFirstOpponent" as const,
        skillIds: [],
        aiRules: [],
        spriteId: "enemy",
      }),
    };
    const command: BattleCommandV1 = { type: "USE_SKILL", expectedBattleRevision: 0, actorUnitId: "party:0", skillId: active.id, targetUnitIds: ["enemy:0"] };
    const activeResult = resolveBattleAction({
      snapshot: activeSnapshot,
      command,
      skill: active,
      skillKind: "active",
      skillLevel: 1,
      content,
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_active_resource`,
    });
    expect(activeResult.ok).toBe(true);
    if (!activeResult.ok) return;
    const activeResolved = activeResult.value.snapshot.units.find((unit) => unit.unitId === "party:0");
    expect(activeResolved?.energy).toBe(30);
    expect(activeResolved?.cooldowns[active.id]).toBe(3);
    expect(activeResult.value.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "RESOURCE_CHANGED", resource: "energy", reason: "actionCost", before: 50, after: 20 }),
      expect.objectContaining({ type: "RESOURCE_CHANGED", resource: "cooldown", skillId: active.id, before: 0, after: 3 }),
      expect.objectContaining({ type: "RESOURCE_CHANGED", resource: "energy", reason: "actionGain", before: 20, after: 30 }),
    ]));

    const ultimate: SkillDefinition = {
      ...active,
      id: "skill_action_ultimate_resource",
      kind: "ultimate",
      cooldownTurnsByLevel: [3, 3, 3, 3, 3],
      energyCostByLevel: [0, 0, 0, 0, 0],
    };
    const ultimateSnapshot = snapshot();
    const ultimateActor = ultimateSnapshot.units.find((unit) => unit.unitId === "party:0");
    if (!ultimateActor) throw new Error("missing ultimate actor");
    ultimateActor.energy = 100;
    const ultimateResult = resolveBattleAction({
      snapshot: ultimateSnapshot,
      command: { type: "USE_ULTIMATE", expectedBattleRevision: 0, actorUnitId: "party:0", skillId: ultimate.id, targetUnitIds: ["enemy:0"] },
      skill: ultimate,
      skillKind: "ultimate",
      skillLevel: 1,
      content,
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_ultimate_resource`,
    });
    expect(ultimateResult.ok).toBe(true);
    if (!ultimateResult.ok) return;
    const ultimateResolved = ultimateResult.value.snapshot.units.find((unit) => unit.unitId === "party:0");
    expect(ultimateResolved?.energy).toBe(0);
    expect(ultimateResolved?.cooldowns[ultimate.id]).toBe(4);
    expect(ultimateResult.value.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "RESOURCE_CHANGED", resource: "energy", reason: "actionCost", before: 100, after: 0 }),
      expect.objectContaining({ type: "RESOURCE_CHANGED", resource: "cooldown", skillId: ultimate.id, before: 0, after: 4 }),
    ]));
  });

  it("状态命中率与 sourceAttackSnapshot 读取有效属性", () => {
    const attackSkill: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_dynamic_status",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "applyStatus", targetRule: "singleEnemy", statusId: "status_slow", baseChanceBps: 10_000, stacks: 1, durationOwnerTurns: 2 }], [], [], [], []],
    };
    const attackUp: StatusDefinition = { id: "status_attack_up", nameKey: "attack", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "attack", flat: 0, percentBps: 2_500 }, canDispel: true, immunityTag: null, iconId: "attack" };
    const slow: StatusDefinition = { id: "status_slow", nameKey: "slow", polarity: "debuff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "speed", flat: 0, percentBps: -2_000 }, canDispel: true, immunityTag: "slow", iconId: "slow" };
    const source = snapshot();
    source.units[0].statuses.push({ stackId: "attack-up:1", statusId: attackUp.id, sourceUnitId: "party:0", remainingOwnerTurns: 2, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 50, shieldRemaining: 0 });
    const result = resolveBattleAction({
      snapshot: source,
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] },
      skill: attackSkill,
      skillKind: "basic",
      skillLevel: 1,
      content: { getStatus: (id: string) => id === attackUp.id ? success(attackUp) : success(slow) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_dynamic_status`,
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.snapshot.units[1].statuses).toEqual(expect.arrayContaining([
        expect.objectContaining({ statusId: slow.id, sourceAttackSnapshot: 62 }),
      ]));
    }

    const resisted = snapshot();
    resisted.units[1].statuses.push({ stackId: "resist:1", statusId: "status_resist", sourceUnitId: "enemy:0", remainingOwnerTurns: 2, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 50, shieldRemaining: 0 });
    const resist: StatusDefinition = { id: "status_resist", nameKey: "resist", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "effectResistBps", flat: 10_000, percentBps: 0 }, canDispel: true, immunityTag: null, iconId: "resist" };
    const resistedResult = resolveBattleAction({
      snapshot: resisted,
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] },
      skill: attackSkill,
      skillKind: "basic",
      skillLevel: 1,
      content: { getStatus: (id: string) => id === resist.id ? success(resist) : success(slow) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_dynamic_resist`,
    });
    expect(resistedResult).toMatchObject({ ok: true });
    if (resistedResult.ok) expect(resistedResult.value.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "STATUS_CHANGED", change: "resisted" })]));
  });

  it("普通和精英撤退只产生三事件且不推进 RNG", () => {
    for (const encounterKind of ["normal", "elite"] as const) {
      const rng = SeededRng.fromState([1, 2, 3, 4]);
      const result = resolveBattleAction({
        snapshot: snapshot(),
        command: { type: "RETREAT", expectedBattleRevision: 0, actorUnitId: "party:0" },
        rng,
        nextId: (kind) => `${kind}_retreat_${encounterKind}`,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.events.map((event) => event.type)).toEqual(["ACTION_STARTED", "ACTION_FINISHED", "BATTLE_FINISHED"]);
      expect(result.value.events.every((event, index) => event.sequence === index)).toBe(true);
      expect(result.value.snapshot.outcome).toBe("retreat");
      expect(result.value.snapshot.phase).toBe("RETREAT");
      expect(result.value.snapshot.rngState).toEqual([1, 2, 3, 4]);
      expect(rng.getState()).toEqual([1, 2, 3, 4]);
    }
  });

  it("每个直接伤害效果读取动态 loadout 倍率并传入伤害解析器", () => {
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_dynamic",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const command: BattleCommandV1 = { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] };
    const content = { getEnemy: (id: string) => success({
      id, nameKey: "enemy", level: 1, stats: snapshot().units[1].stats, elementWeaknesses: [], elementResistances: [], immunityTags: [], basicSkillId: basic.id, basicTargetStrategy: "frontFirstOpponent" as const, skillIds: [], aiRules: [], spriteId: "enemy",
    }) };
    const baseline = resolveBattleAction({ snapshot: snapshot(), command, skill: basic, skillKind: "basic", skillLevel: 1, content, rng: SeededRng.fromState([1, 2, 3, 4]), nextId: (kind) => `${kind}_dynamic_base` });
    const boosted = resolveBattleAction({
      snapshot: snapshot(), command, skill: basic, skillKind: "basic", skillLevel: 1, content,
      dynamicModifierResolver: () => success({ damageBonusBps: 5_000, finalDamageMultiplierBps: 5_000, healingBonusBps: 0, shieldBonusBps: 0 }),
      rng: SeededRng.fromState([1, 2, 3, 4]), nextId: (kind) => `${kind}_dynamic_boosted`,
    });
    expect(baseline.ok).toBe(true);
    expect(boosted.ok).toBe(true);
    if (!baseline.ok || !boosted.ok) return;
    const baseEvent = baseline.value.events.find((event) => event.type === "DAMAGE_RESOLVED");
    const boostedEvent = boosted.value.events.find((event) => event.type === "DAMAGE_RESOLVED");
    expect(boostedEvent && baseEvent && boostedEvent.type === "DAMAGE_RESOLVED" && baseEvent.type === "DAMAGE_RESOLVED" ? boostedEvent.hpDamage : 0).toBeGreaterThan(baseEvent && baseEvent.type === "DAMAGE_RESOLVED" ? baseEvent.hpDamage : 0);
  });

  it("根行动在直接命中后接入 ComboTriggerRuntime，并执行派生伤害", () => {
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_combo",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const combo = { ...fixtureContentRoot.combos[0], id: "combo_action_runtime", scope: "personal" as const, effects: [{ kind: "damage" as const, targetRule: "singleEnemy" as const, element: "physical" as const, powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 } };
    const candidate: TriggerCandidate = {
      kind: "personalCombo",
      sourceKey: "party:0:combo:combo_action_runtime",
      sourceUnitId: "party:0",
      ownerUnitId: "party:0",
      ownerFaction: "party",
      ownerSlot: 0,
      sourceOrder: { sourceKind: "personalCombo", ownerFaction: "party", ownerSlot: 0, definitionId: combo.id },
      triggerSource: { kind: "combo", comboId: combo.id, ownerKey: "party:0" },
      effects: combo.effects,
      combo,
      rootActionId: "root_action_combo",
      rootActionDefinitionId: basic.id,
      chainDepth: 1,
      targetUnitIds: ["enemy:0"],
      visualSkillId: null,
      contextSkillKind: null,
      budget: combo.budget,
    };
    const comboRuntime: BattleComboRuntimeAdapter = {
      createQueue: (options) => new ComboTriggerRuntime({ rng: options.rng }).createQueue(options),
      collectCandidates: ({ event }: { readonly event: TriggerRuntimeEvent }) => success(event.event === "afterDirectHit" ? [candidate] : []),
    };
    const result = resolveBattleAction({
      snapshot: snapshot(),
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] },
      skill: basic,
      skillKind: "basic",
      skillLevel: 1,
      comboRuntime,
      content: { getEnemy: (id: string) => success({ id, nameKey: "enemy", level: 1, stats: snapshot().units[1].stats, elementWeaknesses: [], elementResistances: [], immunityTags: [], basicSkillId: basic.id, basicTargetStrategy: "frontFirstOpponent" as const, skillIds: [], aiRules: [], spriteId: "enemy" }) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_combo_action`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events.map((event) => event.type)).toContain("COMBO_TRIGGERED");
    expect(result.value.events.filter((event) => event.type === "DAMAGE_RESOLVED")).toHaveLength(2);
    expect(result.value.events.every((event, index) => event.sequence === index)).toBe(true);
  });

  it("beforeAction 与 afterDirectHit 的 Combo 事件使用显式分配标记保持全局序号连续", () => {
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_combo_sequence",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const damageEffect = { kind: "damage" as const, targetRule: "singleEnemy" as const, element: "physical" as const, powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] };
    const makeCandidate = (comboId: string): TriggerCandidate => {
      const combo = {
        ...fixtureContentRoot.combos[0],
        id: comboId,
        scope: "personal" as const,
        effects: [damageEffect],
        budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 },
      };
      return {
        kind: "personalCombo",
        sourceKey: `party:0:combo:${comboId}`,
        sourceUnitId: "party:0",
        ownerUnitId: "party:0",
        ownerFaction: "party",
        ownerSlot: 0,
        sourceOrder: { sourceKind: "personalCombo", ownerFaction: "party", ownerSlot: 0, definitionId: comboId },
        triggerSource: { kind: "combo", comboId, ownerKey: "party:0" },
        effects: combo.effects,
        combo,
        rootActionId: "root_combo_sequence",
        rootActionDefinitionId: basic.id,
        chainDepth: 1,
        targetUnitIds: ["enemy:0"],
        visualSkillId: null,
        contextSkillKind: null,
        budget: combo.budget,
      };
    };
    const beforeCandidate = makeCandidate("combo_before_sequence");
    const afterCandidate = makeCandidate("combo_after_sequence");
    const comboRuntime: BattleComboRuntimeAdapter = {
      createQueue: (options) => new ComboTriggerRuntime({ rng: options.rng }).createQueue(options),
      collectCandidates: ({ event }: { readonly event: TriggerRuntimeEvent }) => {
        if (event.event === "beforeAction") return success([beforeCandidate]);
        if (event.event === "afterDirectHit") return success([afterCandidate]);
        return success([]);
      },
    };
    const result = resolveBattleAction({
      snapshot: snapshot(),
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] },
      skill: basic,
      skillKind: "basic",
      skillLevel: 1,
      comboRuntime,
      content: { getEnemy: (id: string) => success({ id, nameKey: "enemy", level: 1, stats: snapshot().units[1].stats, elementWeaknesses: [], elementResistances: [], immunityTags: [], basicSkillId: basic.id, basicTargetStrategy: "frontFirstOpponent" as const, skillIds: [], aiRules: [], spriteId: "enemy" }) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      // 测试桩刻意复用 event ID，确保不能用序号巧合判断事件是否已分配。
      nextId: (kind) => kind === "root" ? "root_combo_sequence" : "event_combo_sequence",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events = result.value.events;
    expect(events.filter((event) => event.type === "COMBO_TRIGGERED")).toHaveLength(2);
    expect(events.filter((event) => event.type === "DAMAGE_RESOLVED")).toHaveLength(3);
    expect(new Set(events.map((event) => event.sequence)).size).toBe(events.length);
    expect(events.every((event, index) => event.sequence === index)).toBe(true);
  });

  it("队列派生伤害继续收集下一层 Combo 候选并递增链深度", () => {
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_combo_recursive",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const damageEffect = { kind: "damage" as const, targetRule: "singleEnemy" as const, element: "physical" as const, powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] };
    const makeCandidate = (comboId: string, chainDepth: number): TriggerCandidate => {
      const combo = {
        ...fixtureContentRoot.combos[0],
        id: comboId,
        scope: "personal" as const,
        effects: [damageEffect],
        budget: { maxPerRootAction: 1, maxPerRound: 1, maxPerBattle: 1 },
      };
      return {
        kind: "personalCombo",
        sourceKey: `party:0:combo:${comboId}`,
        sourceUnitId: "party:0",
        ownerUnitId: "party:0",
        ownerFaction: "party",
        ownerSlot: 0,
        sourceOrder: { sourceKind: "personalCombo", ownerFaction: "party", ownerSlot: 0, definitionId: comboId },
        triggerSource: { kind: "combo", comboId, ownerKey: "party:0" },
        effects: combo.effects,
        combo,
        rootActionId: "root_combo_recursive",
        rootActionDefinitionId: basic.id,
        chainDepth,
        targetUnitIds: ["enemy:0"],
        visualSkillId: null,
        contextSkillKind: null,
        budget: combo.budget,
      };
    };
    const first = makeCandidate("combo_recursive_first", 1);
    let nextEventSequence = 0;
    const comboRuntime: BattleComboRuntimeAdapter = {
      createQueue: (options) => new ComboTriggerRuntime({ rng: options.rng }).createQueue(options),
      collectCandidates: ({ event }: { readonly event: TriggerRuntimeEvent }) => {
        if (event.event === "beforeAction") return success([first]);
        if (event.event === "afterDirectHit" && event.chainDepth >= 1) return success([makeCandidate(`combo_recursive_${event.chainDepth + 1}`, event.chainDepth + 1)]);
        return success([]);
      },
    };
    const result = resolveBattleAction({
      snapshot: snapshot(),
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] },
      skill: basic,
      skillKind: "basic",
      skillLevel: 1,
      comboRuntime,
      content: { getEnemy: (id: string) => success({ id, nameKey: "enemy", level: 1, stats: snapshot().units[1].stats, elementWeaknesses: [], elementResistances: [], immunityTags: [], basicSkillId: basic.id, basicTargetStrategy: "frontFirstOpponent" as const, skillIds: [], aiRules: [], spriteId: "enemy" }) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => kind === "root" ? "root_combo_recursive" : `event_combo_recursive_${nextEventSequence++}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events = result.value.events;
    const comboEvents = events.filter((event) => event.type === "COMBO_TRIGGERED");
    expect(comboEvents.length).toBe(3);
    expect(comboEvents.map((event) => event.chainDepth)).toEqual([1, 2, 3]);
    expect(events.filter((event) => event.type === "DAMAGE_RESOLVED").length).toBe(4);
    expect(events.some((event) => event.type === "TRIGGER_REJECTED" && event.reason === "CHAIN_DEPTH")).toBe(true);
    expect(new Set(events.map((event) => event.sequence)).size).toBe(events.length);
    expect(events.every((event, index) => event.sequence === index)).toBe(true);
  });

  it("allEnemies 多段伤害在首段击倒最后目标后正常结束效果", () => {
    const skill: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_all_enemies_multi_hit",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "allEnemies",
      requiresFrontAccess: false,
      effectsByLevel: [[{
        kind: "damage",
        targetRule: "allEnemies",
        element: "physical",
        powerBps: 0,
        flatPower: 1_000,
        canCrit: false,
        ignoreDefenseBps: 0,
        flatIgnoreDefense: 0,
        hitCount: 2,
        retargetEachHit: false,
        conditionalMultipliers: [],
      }], [], [], [], []],
    };
    const value = snapshot();
    const command: BattleCommandV1 = { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: [] };
    const result = resolveBattleAction({
      snapshot: value,
      command,
      skill,
      skillKind: "basic",
      skillLevel: 1,
      content: {
        getEnemy: (id: string) => success({
          id,
          nameKey: "enemy",
          level: 1,
          stats: value.units[1].stats,
          elementWeaknesses: [],
          elementResistances: [],
          immunityTags: [],
          basicSkillId: skill.id,
          basicTargetStrategy: "frontFirstOpponent" as const,
          skillIds: [],
          aiRules: [],
          spriteId: "enemy",
        }),
      },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_all_enemies_multi_hit`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot.outcome).toBe("victory");
    expect(result.value.events.filter((event) => event.type === "DAMAGE_RESOLVED")).toHaveLength(1);
    expect(result.value.events.every((event, index) => event.sequence === index)).toBe(true);
  });

  it("randomEnemy 可重选多段伤害在首段击倒最后目标后正常结束效果", () => {
    const skill: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_random_enemy_multi_hit",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "randomEnemy",
      requiresFrontAccess: false,
      effectsByLevel: [[{
        kind: "damage",
        targetRule: "randomEnemy",
        element: "physical",
        powerBps: 0,
        flatPower: 1_000,
        canCrit: false,
        ignoreDefenseBps: 0,
        flatIgnoreDefense: 0,
        hitCount: 2,
        retargetEachHit: true,
        conditionalMultipliers: [],
      }], [], [], [], []],
    };
    const value = snapshot();
    const command: BattleCommandV1 = { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: [] };
    const result = resolveBattleAction({
      snapshot: value,
      command,
      skill,
      skillKind: "basic",
      skillLevel: 1,
      content: {
        getEnemy: (id: string) => success({
          id,
          nameKey: "enemy",
          level: 1,
          stats: value.units[1].stats,
          elementWeaknesses: [],
          elementResistances: [],
          immunityTags: [],
          basicSkillId: skill.id,
          basicTargetStrategy: "frontFirstOpponent" as const,
          skillIds: [],
          aiRules: [],
          spriteId: "enemy",
        }),
      },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_random_enemy_multi_hit`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot.outcome).toBe("victory");
    expect(result.value.events.filter((event) => event.type === "DAMAGE_RESOLVED")).toHaveLength(1);
    expect(result.value.events.every((event, index) => event.sequence === index)).toBe(true);
  });

  it("allEnemies 后续效果在前段击倒最后目标后跳过而不误报目标错误", () => {
    const skill: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_all_enemies_follow_up",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "allEnemies",
      requiresFrontAccess: false,
      effectsByLevel: [[
        {
          kind: "damage",
          targetRule: "allEnemies",
          element: "physical",
          powerBps: 0,
          flatPower: 1_000,
          canCrit: false,
          ignoreDefenseBps: 0,
          flatIgnoreDefense: 0,
          hitCount: 1,
          retargetEachHit: false,
          conditionalMultipliers: [],
        },
        { kind: "applyStatus", targetRule: "allEnemies", statusId: "status_burn", baseChanceBps: 10_000, stacks: 1, durationOwnerTurns: 1 },
      ], [], [], [], []],
    };
    const value = snapshot();
    const command: BattleCommandV1 = { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: [] };
    const result = resolveBattleAction({
      snapshot: value,
      command,
      skill,
      skillKind: "basic",
      skillLevel: 1,
      content: {
        getEnemy: (id: string) => success({
          id,
          nameKey: "enemy",
          level: 1,
          stats: value.units[1].stats,
          elementWeaknesses: [],
          elementResistances: [],
          immunityTags: [],
          basicSkillId: skill.id,
          basicTargetStrategy: "frontFirstOpponent" as const,
          skillIds: [],
          aiRules: [],
          spriteId: "enemy",
        }),
      },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_all_enemies_follow_up`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot.outcome).toBe("victory");
    expect(result.value.events.filter((event) => event.type === "DAMAGE_RESOLVED")).toHaveLength(1);
    expect(result.value.events.some((event) => event.type === "STATUS_CHANGED")).toBe(false);
    expect(result.value.events.every((event, index) => event.sequence === index)).toBe(true);
  });

  it("直接解析周期伤害时按 FIFO 先伤害后到期，且不触发直接受伤订阅", () => {
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_periodic_order",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const value = snapshot();
    value.units[0].statuses.push({ stackId: "burn:order", statusId: "status_burn_order", sourceUnitId: "enemy:0", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 50, shieldRemaining: 0 });
    const burn = periodicStatus("status_burn_order", "turnEnd");
    const observed: string[] = [];
    const comboRuntime: BattleComboRuntimeAdapter = {
      createQueue: (options) => new ComboTriggerRuntime({ rng: options.rng }).createQueue(options),
      collectCandidates: ({ event }: { readonly event: TriggerRuntimeEvent }) => {
        observed.push(event.event);
        return success([]);
      },
    };
    const result = resolveBattleAction({
      snapshot: value,
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] },
      skill: basic,
      skillKind: "basic",
      skillLevel: 1,
      comboRuntime,
      content: {
        getStatus: (id: string) => success(burn.id === id ? burn : burn),
        getEnemy: (id: string) => success(enemyDefinition(id)),
      },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (() => { let index = 0; return (kind: "root" | "event") => `${kind}_periodic_order_${index++}`; })(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const periodicEvents = result.value.events.filter((event) => event.type === "DAMAGE_RESOLVED" && event.damageKind === "periodic");
    expect(periodicEvents).toHaveLength(1);
    expect(result.value.events.findIndex((event) => event.type === "DAMAGE_RESOLVED" && event.damageKind === "periodic")).toBeLessThan(result.value.events.findIndex((event) => event.type === "STATUS_CHANGED" && event.change === "expired"));
    expect(observed.filter((event) => event === "afterDirectHit" || event === "onDirectDamageTaken")).toHaveLength(1);
    expect(observed).not.toContain("onDirectDamageTaken");
    expect(result.value.snapshot.pendingEvents).toEqual([]);
    expect(result.value.events.every((event, index) => event.sequence === index)).toBe(true);
  });

  it("直接暴露 controlled skip 根行动：只跳过一次并在 TURN_END 到期，不消耗能量", () => {
    const value = snapshot();
    value.phase = "RESOLVE_ACTION";
    value.currentUnitId = "party:0";
    value.units[0].statuses.push({ stackId: "stun:control", statusId: "status_stun_control", sourceUnitId: "enemy:0", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 50, shieldRemaining: 0 });
    const stun = { ...periodicStatus("status_stun_control", "turnEnd"), effect: { kind: "skipTurn" as const } };
    const result = resolveControlledSkipAction({
      snapshot: value,
      actorUnitId: "party:0",
      content: { getStatus: (id: string) => success(id === stun.id ? stun : stun) },
      rng: SeededRng.fromState(value.rngState),
      nextId: (() => { let index = 0; return (kind: "root" | "event") => `${kind}_controlled_skip_${index++}`; })(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot.battleRevision).toBe(1);
    expect(result.value.snapshot.phase).toBe("TURN_END");
    expect(result.value.snapshot.units[0].statuses).toEqual([]);
    expect(result.value.events.map((event) => event.type)).toEqual(["ACTION_STARTED", "TURN_SKIPPED", "STATUS_CHANGED", "ACTION_FINISHED"]);
    expect(result.value.events[0]?.rootActionDefinitionId).toBe("action_skip_control");
    expect(result.value.events.some((event) => event.type === "RESOURCE_CHANGED")).toBe(false);
    expect(result.value.events.every((event, index) => event.sequence === index)).toBe(true);
  });

  it("beforeAction 自身 duration=1 不延长到下一次 owner 回合，普通 root self buff 跳过当次递减", () => {
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_duration_boundary",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const beforeStatus = buffStatus("status_before_action_duration");
    const beforeCandidate = comboCandidate("combo_before_action_duration", basic, { kind: "applyStatus", targetRule: "self", statusId: beforeStatus.id, baseChanceBps: 10_000, stacks: 1, durationOwnerTurns: 1 });
    const comboRuntime: BattleComboRuntimeAdapter = {
      createQueue: (options) => new ComboTriggerRuntime({ rng: options.rng }).createQueue(options),
      collectCandidates: ({ event }: { readonly event: TriggerRuntimeEvent }) => event.event === "beforeAction" ? success([beforeCandidate]) : success([]),
    };
    const first = resolveBattleAction({
      snapshot: snapshot(),
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] },
      skill: basic,
      skillKind: "basic",
      skillLevel: 1,
      comboRuntime,
      content: { getStatus: (id: string) => success(id === beforeStatus.id ? beforeStatus : beforeStatus), getEnemy: (id: string) => success(enemyDefinition(id)) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (() => { let index = 0; return (kind: "root" | "event") => `${kind}_duration_boundary_${index++}`; })(),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.snapshot.units[0].statuses).toEqual([]);

    const rootSelfStatus = buffStatus("status_root_self_duration");
    const selfSkill: SkillDefinition = {
      ...basic,
      id: "skill_action_root_self_duration",
      targetRule: "self",
      effectsByLevel: [[{ kind: "applyStatus", targetRule: "self", statusId: rootSelfStatus.id, baseChanceBps: 10_000, stacks: 1, durationOwnerTurns: 1 }], [], [], [], []],
    };
    const second = resolveBattleAction({
      snapshot: snapshot(),
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: [] },
      skill: selfSkill,
      skillKind: "basic",
      skillLevel: 1,
      content: { getStatus: (id: string) => success(id === rootSelfStatus.id ? rootSelfStatus : rootSelfStatus) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_root_self_duration`,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.snapshot.units[0].statuses).toEqual([expect.objectContaining({ statusId: rootSelfStatus.id, remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false })]);
    const third = resolveBattleAction({
      snapshot: second.value.snapshot,
      command: { type: "USE_BASIC", expectedBattleRevision: 1, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] },
      skill: basic,
      skillKind: "basic",
      skillLevel: 1,
      content: { getStatus: (id: string) => success(id === rootSelfStatus.id ? rootSelfStatus : rootSelfStatus), getEnemy: (id: string) => success(enemyDefinition(id)) },
      rng: SeededRng.fromState(second.value.snapshot.rngState),
      nextId: (kind) => `${kind}_root_self_duration_next`,
    });
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.value.snapshot.units[0].statuses).toEqual([]);
  });

  it("根行动先写 actionGain，再执行 afterRootAction Combo；周期来源缺失仍按冻结快照结算", () => {
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_gain_order",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const gainCombo = comboCandidate("combo_after_root_gain", basic, { kind: "changeEnergy", targetRule: "self", amount: 1 });
    const comboRuntime: BattleComboRuntimeAdapter = {
      createQueue: (options) => new ComboTriggerRuntime({ rng: options.rng }).createQueue(options),
      collectCandidates: ({ event }: { readonly event: TriggerRuntimeEvent }) => event.event === "afterRootAction" ? success([gainCombo]) : success([]),
    };
    const value = snapshot();
    value.units[0].statuses.push({ stackId: "burn:missing-source", statusId: "status_burn_missing_source", sourceUnitId: "enemy:missing", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 50, shieldRemaining: 0 });
    const burn = periodicStatus("status_burn_missing_source", "turnEnd");
    const result = resolveBattleAction({
      snapshot: value,
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] },
      skill: basic,
      skillKind: "basic",
      skillLevel: 1,
      comboRuntime,
      content: { getStatus: (id: string) => success(id === burn.id ? burn : burn), getEnemy: (id: string) => success(enemyDefinition(id)) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (() => { let index = 0; return (kind: "root" | "event") => `${kind}_gain_order_${index++}`; })(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actionGainIndex = result.value.events.findIndex((event) => event.type === "RESOURCE_CHANGED" && event.reason === "actionGain");
    const comboIndex = result.value.events.findIndex((event) => event.type === "COMBO_TRIGGERED" && event.comboId === gainCombo.combo?.id);
    const periodicIndex = result.value.events.findIndex((event) => event.type === "DAMAGE_RESOLVED" && event.damageKind === "periodic");
    expect(actionGainIndex).toBeGreaterThanOrEqual(0);
    expect(comboIndex).toBeGreaterThan(actionGainIndex);
    expect(periodicIndex).toBeGreaterThan(comboIndex);
    expect(result.value.events.some((event) => event.type === "TRIGGER_REJECTED" && event.reason === "SOURCE_INVALID")).toBe(false);
    const periodicEvent = result.value.events.find((event): event is Extract<BattleDomainEventV1, { type: "DAMAGE_RESOLVED" }> => event.type === "DAMAGE_RESOLVED" && event.damageKind === "periodic");
    expect(periodicEvent?.sourceUnitId).toBe("enemy:missing");
  });

  it("周期来源死亡或离场不取消冻结快照，bleed 多段根行动只生成一次周期", () => {
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_periodic_sources",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 1_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 2, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const bleed = periodicStatus("status_bleed_sources", "afterAction", "physical");
    const burn = periodicStatus("status_burn_sources", "turnEnd", "fire");
    const poison = periodicStatus("status_poison_sources", "turnEnd", "poison");
    const value = snapshot();
    const deadSource = { ...unit("enemy:dead", "enemy", 0), slot: 1 };
    const target = { ...unit("enemy:target", "enemy", 1_000), slot: 2 };
    value.units = [value.units[0], deadSource, target];
    value.units[0].statuses.push(
      { stackId: "bleed:sources", statusId: bleed.id, sourceUnitId: deadSource.unitId, remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 40, shieldRemaining: 0 },
      { stackId: "burn:sources", statusId: burn.id, sourceUnitId: "enemy:missing", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 30, shieldRemaining: 0 },
      { stackId: "poison:sources", statusId: poison.id, sourceUnitId: "enemy:missing-poison", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 20, shieldRemaining: 0 },
    );
    const observed: string[] = [];
    const comboRuntime: BattleComboRuntimeAdapter = {
      createQueue: (options) => new ComboTriggerRuntime({ rng: options.rng }).createQueue(options),
      collectCandidates: ({ event }: { readonly event: TriggerRuntimeEvent }) => {
        observed.push(event.event);
        return success([]);
      },
    };
    const statusById = new Map([[bleed.id, bleed], [burn.id, burn], [poison.id, poison]]);
    const result = resolveBattleAction({
      snapshot: value,
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: [target.unitId] },
      skill: basic,
      skillKind: "basic",
      skillLevel: 1,
      comboRuntime,
      content: {
        getStatus: (id: string) => success(statusById.get(id) ?? bleed),
        getEnemy: (id: string) => success(enemyDefinition(id)),
      },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (() => { let index = 0; return (kind: "root" | "event") => `${kind}_periodic_sources_${index++}`; })(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const periodic = result.value.events.filter((event): event is Extract<BattleDomainEventV1, { type: "DAMAGE_RESOLVED" }> => event.type === "DAMAGE_RESOLVED" && event.damageKind === "periodic");
    expect(periodic).toHaveLength(3);
    expect(periodic.map((event) => event.sourceUnitId)).toEqual([deadSource.unitId, "enemy:missing", "enemy:missing-poison"]);
    expect(result.value.events.filter((event) => event.type === "TRIGGER_REJECTED" && event.reason === "SOURCE_INVALID")).toHaveLength(0);
    expect(result.value.events.filter((event) => event.type === "STATUS_CHANGED" && event.change === "expired").length).toBeGreaterThanOrEqual(3);
    const firstPeriodicIndex = result.value.events.findIndex((event) => event.type === "DAMAGE_RESOLVED" && event.damageKind === "periodic");
    const firstExpiredIndex = result.value.events.findIndex((event) => event.type === "STATUS_CHANGED" && event.change === "expired");
    expect(firstPeriodicIndex).toBeLessThan(firstExpiredIndex);
    // 两段根伤害各自产生一次直接命中；周期伤害不得追加任何直接订阅。
    expect(observed.filter((event) => event === "afterDirectHit")).toHaveLength(2);
    expect(observed.filter((event) => event === "onDirectDamageTaken")).toHaveLength(0);

    const zeroSkill: SkillDefinition = {
      ...basic,
      id: "skill_action_periodic_zero",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 0, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 2, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const zero = resolveBattleAction({
      snapshot: value,
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: [target.unitId] },
      skill: zeroSkill,
      skillKind: "basic",
      skillLevel: 1,
      content: { getStatus: (id: string) => success(statusById.get(id) ?? bleed), getEnemy: (id: string) => success(enemyDefinition(id)) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (kind) => `${kind}_periodic_zero`,
    });
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.value.events.filter((event) => event.type === "DAMAGE_RESOLVED" && event.damageKind === "periodic")).toHaveLength(2);
  });

  it("周期击倒来源离场时仍完成终局，并保留 onDefeatUnit 触发尝试", () => {
    const basic: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_action_periodic_defeat_missing_source",
      kind: "basic",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 0, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const burn = periodicStatus("status_burn_periodic_defeat_missing_source", "turnEnd");
    const value = snapshot();
    value.units[0].currentHp = 10;
    value.units[0].statuses.push({ stackId: "burn:defeat-missing", statusId: burn.id, sourceUnitId: "enemy:missing", remainingOwnerTurns: 1, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 50, shieldRemaining: 0 });
    const observed: string[] = [];
    const comboRuntime: BattleComboRuntimeAdapter = {
      createQueue: (options) => new ComboTriggerRuntime({ rng: options.rng }).createQueue(options),
      collectCandidates: ({ event }: { readonly event: TriggerRuntimeEvent }) => {
        observed.push(event.event);
        return event.event === "onDefeatUnit"
          ? failure(createDomainError("INVALID_CONTENT", { path: "battle.units.enemy:missing", issueKey: "missing_unit" }))
          : success([]);
      },
    };
    const result = resolveBattleAction({
      snapshot: value,
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] },
      skill: basic,
      skillKind: "basic",
      skillLevel: 1,
      comboRuntime,
      content: { getStatus: (id: string) => success(id === burn.id ? burn : burn), getEnemy: (id: string) => success(enemyDefinition(id)) },
      rng: SeededRng.fromState([1, 2, 3, 4]),
      nextId: (() => { let index = 0; return (kind: "root" | "event") => `${kind}_periodic_defeat_missing_${index++}`; })(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot.phase).toBe("DEFEAT");
    expect(result.value.events.some((event) => event.type === "DAMAGE_RESOLVED" && event.damageKind === "periodic" && event.sourceUnitId === "enemy:missing")).toBe(true);
    expect(result.value.events.some((event) => event.type === "UNIT_DEFEATED" && event.sourceUnitId === "enemy:missing")).toBe(true);
    expect(observed).toContain("onDefeatUnit");
    expect(result.value.events.every((event, index) => event.sequence === index)).toBe(true);
  });
});
