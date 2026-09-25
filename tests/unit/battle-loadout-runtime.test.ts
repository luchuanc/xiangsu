import { describe, expect, it } from "vitest";

import { abyssEchoContentRoot } from "../../src/content/data/abyssEchoes";
import type { BattleUnitStateV1, CharacterDefinition, EquipmentAffixDefinition, EquipmentInstance, EffectSpec, GameSaveV1, SkillDefinition, StatusDefinition } from "../../src/content/contracts";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { SequentialIdFactory } from "../../src/domain/common/DomainContext";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { resolveBattleDynamicModifiers } from "../../src/domain/battle/BattleLoadoutRuntime";

function unit(unitId: string, definitionId: string, faction: "party" | "enemy", currentHp = 100): BattleUnitStateV1 {
  const stats = { maxHp: 100, attack: 100, defense: 10, speed: 10, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 };
  return {
    unitId,
    definitionId,
    faction,
    slot: 0,
    level: 1,
    prePercentStats: { ...stats },
    staticPercentByStatBps: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
    stats: { ...stats },
    currentHp,
    energy: 0,
    cooldowns: {},
    statuses: [],
    eligibleRound: 1,
    usedExtraTurnThisRound: false,
    directHitEnergyRootActionIds: [],
  };
}

function fixture(): {
  save: GameSaveV1;
  actor: BattleUnitStateV1;
  target: BattleUnitStateV1;
  character: CharacterDefinition;
  passive: SkillDefinition;
  affix: EquipmentAffixDefinition;
  equipment: EquipmentInstance;
  content: {
    getCharacter(id: string): ReturnType<typeof success<CharacterDefinition>> | ReturnType<typeof failure>;
    getSkill(id: string): ReturnType<typeof success<SkillDefinition>> | ReturnType<typeof failure>;
    getEquipmentAffix(id: string): ReturnType<typeof success<EquipmentAffixDefinition>> | ReturnType<typeof failure>;
  };
} {
  const save = createNewGameSave(abyssEchoContentRoot, "2026-08-26T00:00:00.000Z", { newGameSeed: 1, idFactory: new SequentialIdFactory() });
  const baseCharacter = abyssEchoContentRoot.characters.find((value) => value.id === abyssEchoContentRoot.protagonistCharacterId);
  const basePassive = abyssEchoContentRoot.skills.find((value) => value.id === baseCharacter?.passiveSkillId);
  const base = abyssEchoContentRoot.equipmentBases.find((value) => value.slot === "weapon");
  if (!baseCharacter || !basePassive || !base) throw new Error("fixture content incomplete");
  const passive: SkillDefinition = { ...basePassive, id: "skill_dynamic_passive", owner: { kind: "character", characterId: baseCharacter.id }, passiveModifiers: [{ kind: "damageBonus", element: "all", valueBps: 1_000 }, { kind: "healingBonus", valueBps: 500 }, { kind: "shieldBonus", valueBps: 700 }] };
  const character: CharacterDefinition = { ...baseCharacter, passiveSkillId: passive.id };
  const affix: EquipmentAffixDefinition = { ...abyssEchoContentRoot.equipmentAffixes[0], id: "affix_dynamic_runtime", modifiers: [{ kind: "damageBonus", element: "all", rollScaleBps: 2_000 }, { kind: "finalDamageMultiplier", rollScaleBps: 3_000 }, { kind: "healingBonus", rollScaleBps: 1_500 }, { kind: "shieldBonus", rollScaleBps: 1_200 }, { kind: "conditionalDamageBonus", condition: { kind: "formationRow", row: "front" }, element: "physical", rollScaleBps: 1_000 }] };
  const equipment: EquipmentInstance = {
    instanceId: "eq_dynamic_runtime",
    baseId: base.id,
    itemLevel: base.minItemLevel,
    quality: "common",
    craftGrade: "ordinary",
    affixes: [{ affixId: affix.id, tier: 1, roll: 10_000, craftEmpowered: false, reforged: false }],
    abyssAffix: null,
    locked: false,
    acquiredAt: "2026-08-26T00:00:00.000Z",
    sourceTransactionId: "tx_dynamic_runtime",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
  save.characters[character.id] = { ...save.characters[character.id], characterId: character.id, equipmentBySlot: { ...save.characters[character.id].equipmentBySlot, weapon: equipment.instanceId } };
  save.inventory.equipment.push(equipment);
  const enemyId = "enemy_dynamic_runtime";
  const actor = unit(`party:${character.id}`, character.id, "party");
  const target = unit(`enemy:${enemyId}`, enemyId, "enemy");
  const content = {
    getCharacter: (id: string) => id === character.id ? success(character) : failure(createDomainError("INVALID_CONTENT", { path: `characters.${id}`, issueKey: "missing" })),
    getSkill: (id: string) => id === passive.id ? success(passive) : failure(createDomainError("INVALID_CONTENT", { path: `skills.${id}`, issueKey: "missing" })),
    getEquipmentAffix: (id: string) => id === affix.id ? success(affix) : failure(createDomainError("INVALID_CONTENT", { path: `equipmentAffixes.${id}`, issueKey: "missing" })),
  };
  return { save, actor, target, character, passive, affix, equipment, content };
}

describe("BattleLoadoutRuntime", () => {
  it("按装备/固定被动解析伤害、最终倍率、治疗和护盾动态加成", () => {
    const value = fixture();
    const damage: Extract<EffectSpec, { kind: "damage" }> = { kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] };
    const result = resolveBattleDynamicModifiers({ save: value.save, actor: value.actor, target: value.target, effect: damage, content: value.content, round: 1 });
    expect(result).toMatchObject({ ok: true, value: { damageBonusBps: 4_000, finalDamageMultiplierBps: 3_000, healingBonusBps: 0, shieldBonusBps: 0 } });
    if (!result.ok) return;
    const heal: Extract<EffectSpec, { kind: "heal" }> = { kind: "heal", targetRule: "singleAlly", scalingStat: "attack", powerBps: 10_000, flatPower: 0, canCrit: false };
    const shield: Extract<EffectSpec, { kind: "shield" }> = { kind: "shield", targetRule: "self", scalingStat: "attack", powerBps: 10_000, flatPower: 0, statusId: "status_shield", durationOwnerTurns: 2 };
    expect(resolveBattleDynamicModifiers({ save: value.save, actor: value.actor, target: value.actor, effect: heal, content: value.content, round: 1 })).toMatchObject({ ok: true, value: { healingBonusBps: 2_000 } });
    expect(resolveBattleDynamicModifiers({ save: value.save, actor: value.actor, target: value.actor, effect: shield, content: value.content, round: 1 })).toMatchObject({ ok: true, value: { shieldBonusBps: 1_900 } });
  });

  it("敌方行动不读取玩家 loadout，缺失装备词条严格失败", () => {
    const value = fixture();
    const damage: Extract<EffectSpec, { kind: "damage" }> = { kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] };
    expect(resolveBattleDynamicModifiers({ save: value.save, actor: unit("enemy:source", "enemy_source", "enemy"), target: value.actor, effect: damage, content: value.content, round: 1 })).toMatchObject({ ok: true, value: { damageBonusBps: 0, finalDamageMultiplierBps: 0, healingBonusBps: 0, shieldBonusBps: 0 } });
    const broken = structuredClone(value.save);
    broken.inventory.equipment[0].affixes[0].affixId = "affix_missing";
    expect(resolveBattleDynamicModifiers({ save: broken, actor: value.actor, target: value.target, effect: damage, content: value.content, round: 1 })).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
  });

  it("装备条件使用动态 maxHp，而不是直接读取静态 stats", () => {
    const value = fixture();
    value.actor.currentHp = 55;
    value.actor.statuses.push({ stackId: "vitality:1", statusId: "status_vitality", sourceUnitId: value.actor.unitId, remainingOwnerTurns: 2, skipNextOwnerTurnEndDecrement: false, sourceAttackSnapshot: 100, shieldRemaining: 0 });
    value.affix.modifiers = [{ kind: "conditionalDamageBonus", condition: { kind: "selfHpAtLeastBps", valueBps: 5_000 }, element: "physical", rollScaleBps: 10_000 }];
    const vitality: StatusDefinition = { id: "status_vitality", nameKey: "vitality", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "maxHp", flat: 50, percentBps: 0 }, canDispel: true, immunityTag: null, iconId: "vitality" };
    const damage: Extract<EffectSpec, { kind: "damage" }> = { kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] };
    const result = resolveBattleDynamicModifiers({
      save: value.save,
      actor: value.actor,
      target: value.target,
      effect: damage,
      content: { ...value.content, getStatus: (id: string) => id === vitality.id ? success(vitality) : failure(createDomainError("INVALID_CONTENT", { path: `statuses.${id}`, issueKey: "missing" })) },
      round: 1,
    });
    // 只有固定被动的 1000，装备条件因有效 maxHp=150 而不满足，不应追加 10000。
    expect(result).toMatchObject({ ok: true, value: { damageBonusBps: 1_000 } });
  });
});
