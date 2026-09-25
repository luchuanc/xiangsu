import { describe, expect, it } from "vitest";

import { fixtureContentRoot } from "../../src/content/data";
import { createBattleSnapshot } from "../../src/domain/battle/BattleFactory";
import { validateBattleCommand } from "../../src/domain/battle/BattleCommandValidator";
import type { BattleContentSource, BattleFactoryInput } from "../../src/domain/battle/BattleTypes";
import type { AbyssEchoDefinition, BattleSnapshotV1, CharacterDefinition, CharacterProgressV1, ConsumableItemDefinition, EncounterDefinition, EnemyDefinition, EquipmentAffixDefinition, EquipmentInstance, ExpeditionSnapshotV1, InventoryStateV1, MapDefinition, SkillDefinition, StatBlock } from "../../src/content/contracts";
import { failure, createDomainError, success } from "../../src/domain/common/DomainResult";

function stats(speed: number, maxHp = 100): StatBlock { return { maxHp, attack: 50, defense: 20, speed, critRateBps: 0, critDamageBps: 15_000, effectHitBps: 0, effectResistBps: 0 }; }
function make(): { snapshot: BattleSnapshotV1; content: BattleContentSource } {
  const character: CharacterDefinition = { id: "char_cmd", nameKey: "char", role: "fighter", allowedWeaponTypes: ["sword"], baseStats: stats(60), growthPerLevel: stats(0, 0), innateTags: [], basicSkillId: "skill_cmd_basic", activeSkillIds: ["skill_cmd_active", "skill_cmd_active_2", "skill_cmd_active_3", "skill_cmd_active_4"], ultimateSkillId: "skill_cmd_ultimate", passiveSkillId: "skill_cmd_passive", fieldSpriteId: "field", battleSpriteId: "battle" };
  const enemy: EnemyDefinition = { id: "enemy_cmd", nameKey: "enemy", level: 1, stats: stats(40, 100), elementWeaknesses: [], elementResistances: [], immunityTags: [], basicSkillId: "skill_cmd_basic", basicTargetStrategy: "frontFirstOpponent", skillIds: [], aiRules: [], spriteId: "enemy" };
  const encounter: EncounterDefinition = { id: "enc_cmd", kind: "normal", fieldSpriteId: "enc", enemyIdsBySlot: ["enemy_cmd"], xpReward: 0, goldRewardMin: 0, goldRewardMax: 0, dropTableId: "drop_none", canRetreat: true, modifierIds: [] };
  const map: MapDefinition = { id: "map_cmd", nameKey: "map", widthTiles: 2, heightTiles: 2, tileSize: 16, assetBundleId: "bundle_cmd", spawnPoint: { x: 0, y: 0 }, groundLayer: [0], decorBackLayer: [], decorFrontLayer: [], collisionLayer: [0], objects: [{ kind: "encounter", objectId: "object_cmd", position: { x: 1, y: 1 }, encounterId: encounter.id, behavior: { mode: "stationary", patrolPoints: [], wanderRadius: 0, detectionRadius: 1, leashRadius: 2, moveSpeed: 1 } }] };
  const skill = (id: string, kind: SkillDefinition["kind"], targetRule: SkillDefinition["targetRule"] = "singleEnemy", energyCost = 0): SkillDefinition => ({ ...fixtureContentRoot.skills[0], id, kind, owner: { kind: "character", characterId: character.id }, targetRule, energyCostByLevel: [energyCost, energyCost, energyCost, energyCost, energyCost], effectsByLevel: [[{ kind: "damage", targetRule, element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []] });
  const skills = [skill("skill_cmd_basic", "basic"), skill("skill_cmd_active", "active", "singleEnemy", 0), skill("skill_cmd_active_2", "active"), skill("skill_cmd_active_3", "active"), skill("skill_cmd_active_4", "active"), skill("skill_cmd_ultimate", "ultimate", "allEnemies", 100), skill("skill_cmd_passive", "passive")];
  const progress: CharacterProgressV1 = { characterId: character.id, recruited: true, level: 1, xp: 0, currentHp: 100, skillPoints: 0, skillLevels: Object.fromEntries(character.activeSkillIds.map((id) => [id, 1])), equippedActiveSkillIds: [skills[1].id, null], equipmentBySlot: { weapon: null, helmet: null, armor: null, gloves: null, boots: null, accessory: null }, skillStoneInstanceId: null };
  const input: BattleFactoryInput = { battleId: "battle_cmd", expedition: { expeditionId: "exp_cmd", expeditionSeed: 1, mode: "exploration", abyssEchoId: null, floorId: "floor_cmd", mapId: map.id, playerPosition: { x: 1, y: 1 }, safePosition: { x: 0, y: 0 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: "2026-01-01T00:00:00.000Z" }, map, encounter, encounterObject: map.objects[0] as Extract<MapDefinition["objects"][number], { kind: "encounter" }>, party: { slots: [character.id, null, null, null] }, characters: { [character.id]: progress }, returnMapId: map.id, returnSafePosition: { x: 0, y: 0 }, comboIds: [], rngState: [1, 2, 3, 4] };
  const bySkill = new Map(skills.map((value) => [value.id, value]));
  const byChar = new Map([[character.id, character]]);
  const byEnemy = new Map([[enemy.id, enemy]]);
  const byEncounter = new Map([[encounter.id, encounter]]);
  const byMap = new Map([[map.id, map]]);
  const fail = (path: string) => failure(createDomainError("INVALID_CONTENT", { path, issueKey: "missing" }));
  const content: BattleContentSource = { getCharacter: (id) => byChar.get(id) ? success(byChar.get(id)!) : fail(`characters.${id}`), getSkill: (id) => bySkill.get(id) ? success(bySkill.get(id)!) : fail(`skills.${id}`), getEnemy: (id) => byEnemy.get(id) ? success(byEnemy.get(id)!) : fail(`enemies.${id}`), getEncounter: (id) => byEncounter.get(id) ? success(byEncounter.get(id)!) : fail(`encounters.${id}`), getMap: (id) => byMap.get(id) ? success(byMap.get(id)!) : fail(`maps.${id}`) };
  const made = createBattleSnapshot(content, input);
  if (!made.ok) throw new Error(JSON.stringify(made.error));
  const started: BattleSnapshotV1 = { ...made.value, phase: "AWAIT_COMMAND" as const, round: 1 };
  started.currentUnitId = "party:0";
  return { snapshot: started, content };
}

describe("BattleCommandValidator", () => {
  it("拒绝过期 revision、passive/effect 和非法阶段", () => {
    const { snapshot, content } = make();
    expect(validateBattleCommand({ snapshot, content, command: { type: "USE_BASIC", expectedBattleRevision: 1, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] } })).toMatchObject({ ok: false, error: { code: "STALE_BATTLE_REVISION" } });
    expect(validateBattleCommand({ snapshot, content, command: { type: "USE_SKILL", expectedBattleRevision: 0, actorUnitId: "party:0", skillId: "skill_cmd_passive", targetUnitIds: ["enemy:0"] } })).toMatchObject({ ok: false, error: { code: "SKILL_LOCKED" } });
    expect(validateBattleCommand({ snapshot: { ...snapshot, phase: "INIT" }, content, command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] } })).toMatchObject({ ok: false, error: { code: "INVALID_BATTLE_PHASE" } });
  });

  it("允许敌方使用已声明的共享 systemEffect 技能，但玩家仍拒绝", () => {
    const { snapshot, content } = make();
    const enemySkill: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_cmd_enemy_shared",
      kind: "active",
      owner: { kind: "systemEffect" },
      targetRule: "singleEnemy",
      requiresFrontAccess: false,
      energyCostByLevel: [0, 0, 0, 0, 0],
      cooldownTurnsByLevel: [0, 0, 0, 0, 0],
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const enemy = content.getEnemy("enemy_cmd");
    if (!enemy.ok) throw new Error("missing command enemy");
    enemy.value.skillIds.push(enemySkill.id);
    const enemyContent = {
      ...content,
      getSkill: (id: string) => id === enemySkill.id ? success(enemySkill) : content.getSkill(id),
    };
    const enemySnapshot = structuredClone(snapshot);
    enemySnapshot.currentUnitId = "enemy:0";
    const enemyUnit = enemySnapshot.units.find((unit) => unit.unitId === "enemy:0");
    if (!enemyUnit) throw new Error("missing command enemy unit");
    enemyUnit.cooldowns[enemySkill.id] = 0;
    const enemyCommand = { type: "USE_SKILL" as const, expectedBattleRevision: enemySnapshot.battleRevision, actorUnitId: "enemy:0", skillId: enemySkill.id, targetUnitIds: ["party:0"] };
    expect(validateBattleCommand({ snapshot: enemySnapshot, content: enemyContent, command: enemyCommand })).toMatchObject({ ok: true, value: { skill: { id: enemySkill.id } } });
    expect(validateBattleCommand({ snapshot, content: enemyContent, command: { ...enemyCommand, actorUnitId: "party:0", targetUnitIds: ["enemy:0"] } })).toMatchObject({ ok: false, error: { code: "SKILL_LOCKED", details: { skillId: enemySkill.id } } });
  });

  it("USE_BASIC 先应用装备 replaceBasicSkill，但仍保留 basic 上下文", () => {
    const { snapshot, content } = make();
    const replacement: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_cmd_replaced_basic",
      kind: "effect",
      owner: { kind: "systemEffect" },
      targetRule: "allEnemies",
      requiresFrontAccess: false,
      effectsByLevel: [[{ kind: "damage", targetRule: "allEnemies", element: "fire", powerBps: 12_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const replacementAffix: EquipmentAffixDefinition = {
      ...fixtureContentRoot.equipmentAffixes[0],
      id: "af_cmd_replace_basic",
      modifiers: [{ kind: "replaceBasicSkill", skillId: replacement.id }],
    };
    const equipment: EquipmentInstance = {
      instanceId: "eq_cmd_replace",
      baseId: "eq_hammer_t1_stonemaul",
      itemLevel: 1,
      quality: "rare",
      craftGrade: "ordinary",
      affixes: [{ affixId: replacementAffix.id, tier: 1, roll: 1, craftEmpowered: false, reforged: false }],
      abyssAffix: null,
      locked: false,
      acquiredAt: "2026-01-01T00:00:00.000Z",
      sourceTransactionId: "tx_cmd_replace",
      reforgeLockedIndex: null,
      reforgeCount: 0,
    };
    const progress: CharacterProgressV1 = {
      characterId: "char_cmd",
      recruited: true,
      level: 1,
      xp: 0,
      currentHp: 100,
      skillPoints: 0,
      skillLevels: { skill_cmd_active: 1, skill_cmd_active_2: 1, skill_cmd_active_3: 1, skill_cmd_active_4: 1 },
      equippedActiveSkillIds: ["skill_cmd_active", null],
      equipmentBySlot: { weapon: equipment.instanceId, helmet: null, armor: null, gloves: null, boots: null, accessory: null },
      skillStoneInstanceId: null,
    };
    const inventory: InventoryStateV1 = { equipment: [equipment], skillStones: [], stackables: {}, overflowEquipment: [], overflowSkillStones: [] };
    const replacementContent = {
      ...content,
      getSkill: (id: string) => id === replacement.id ? success(replacement) : content.getSkill(id),
      getEquipmentAffix: (id: string) => id === replacementAffix.id ? success(replacementAffix) : failure(createDomainError("INVALID_CONTENT", { path: `equipmentAffixes.${id}`, issueKey: "missing" })),
    };
    const result = validateBattleCommand({
      snapshot,
      content: replacementContent,
      inventory,
      characters: { [progress.characterId]: progress },
      command: { type: "USE_BASIC", expectedBattleRevision: 0, actorUnitId: "party:0", targetUnitIds: [] },
    });
    expect(result).toMatchObject({ ok: true, value: { skill: { id: replacement.id }, skillKind: "basic", rootActionDefinitionId: replacement.id, targetUnitIds: [] } });
  });

  it("严格校验战斗物品库存、使用场景与合法 battle item", () => {
    const { snapshot, content } = make();
    const item: ConsumableItemDefinition = {
      id: "item_cmd_battle_energy",
      nameKey: "item.cmd.battle_energy",
      category: "consumable",
      maxStack: 99,
      baseGoldValue: 1,
      iconId: "item_cmd_battle_energy",
      useContexts: ["battle"],
      targetRule: "self",
      effects: [{ kind: "changeEnergy", targetRule: "self", amount: 5 }],
    };
    const fieldItem: ConsumableItemDefinition = { ...item, id: "item_cmd_field_only", useContexts: ["field"] };
    const withItems = {
      ...content,
      getItem: (id: string) => id === item.id
        ? success(item)
        : id === fieldItem.id
          ? success(fieldItem)
          : failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: id })),
    };
    const itemCommand = { type: "USE_ITEM" as const, expectedBattleRevision: 0, actorUnitId: "party:0", itemId: item.id, targetUnitIds: [] };
    expect(validateBattleCommand({ snapshot, content: withItems, command: itemCommand })).toMatchObject({ ok: false, error: { code: "ITEM_NOT_OWNED", details: { itemId: item.id } } });
    expect(validateBattleCommand({
      snapshot,
      content: withItems,
      inventory: { equipment: [], skillStones: [], stackables: { [item.id]: 1 }, overflowEquipment: [], overflowSkillStones: [] },
      command: { ...itemCommand, itemId: fieldItem.id },
    })).toMatchObject({ ok: false, error: { code: "ITEM_USE_FORBIDDEN", details: { itemId: fieldItem.id, reason: "WRONG_CONTEXT" } } });
    const legal = validateBattleCommand({
      snapshot,
      content: withItems,
      inventory: { equipment: [], skillStones: [], stackables: { [item.id]: 1 }, overflowEquipment: [], overflowSkillStones: [] },
      command: itemCommand,
    });
    expect(legal).toMatchObject({ ok: true, value: { actionKind: "item", item: { id: item.id }, targetUnitIds: [], candidateTargetUnitIds: ["party:0"] } });
  });

  it.each([
    { limit: 0 as const, uses: 0, allowed: false },
    { limit: 1 as const, uses: 0, allowed: true },
    { limit: 1 as const, uses: 1, allowed: false },
    { limit: 2 as const, uses: 1, allowed: true },
    { limit: 2 as const, uses: 2, allowed: false },
  ])("abyssEcho itemUseLimit=$limit 在成功使用次数达到上限时拒绝，普通战斗不受影响 ($uses)", ({ limit, uses, allowed }) => {
    const { snapshot, content } = make();
    const item: ConsumableItemDefinition = {
      id: "item_cmd_echo_potion",
      nameKey: "item.cmd.echo_potion",
      category: "consumable",
      maxStack: 99,
      baseGoldValue: 1,
      iconId: "item_cmd_echo_potion",
      useContexts: ["battle"],
      targetRule: "self",
      effects: [{ kind: "changeEnergy", targetRule: "self", amount: 5 }],
    };
    const echo: AbyssEchoDefinition = {
      id: "echo_cmd_limit",
      nameKey: "echo.cmd_limit.name",
      descriptionKey: "echo.cmd_limit.description",
      floorId: "floor_cmd",
      bossEncounterId: "enc_cmd",
      enemyHpBps: 10_000,
      enemyAttackBps: 10_000,
      enemyDefenseBps: 10_000,
      enemySpeedBps: 10_000,
      enrageRoundDelta: -1,
      itemUseLimit: limit,
      objective: { maxRounds: 5, maxKnockouts: 0, requiredAnyComboTriggers: 0 },
      bonusAbyssUpgradeChanceBps: 0,
      firstClearForgeShards: 0,
      firstClearInscriptionDust: 0,
    };
    const withItems = {
      ...content,
      getItem: (id: string) => id === item.id ? success(item) : failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: id })),
      getAbyssEcho: (id: string) => id === echo.id ? success(echo) : failure(createDomainError("INVALID_CONTENT", { path: `abyssEchoes.${id}`, issueKey: "missing" })),
    };
    const echoSnapshot = { ...snapshot, successfulItemUses: uses };
    const expedition: Partial<ExpeditionSnapshotV1> = { mode: "abyssEcho", abyssEchoId: echo.id };
    const input = {
      snapshot: echoSnapshot,
      content: withItems,
      inventory: { equipment: [], skillStones: [], stackables: { [item.id]: 1 }, overflowEquipment: [], overflowSkillStones: [] },
      expedition,
      command: { type: "USE_ITEM" as const, expectedBattleRevision: 0, actorUnitId: "party:0", itemId: item.id, targetUnitIds: [] },
    } as unknown as Parameters<typeof validateBattleCommand>[0];
    const result = validateBattleCommand(input);
    expect(result.ok).toBe(allowed);
    if (!allowed) expect(result).toMatchObject({ ok: false, error: { code: "ITEM_USE_FORBIDDEN", details: { itemId: item.id, reason: "ECHO_LIMIT" } } });

    const ordinary = validateBattleCommand({
      ...input,
      expedition: { mode: "exploration", abyssEchoId: null },
    } as unknown as Parameters<typeof validateBattleCommand>[0]);
    expect(ordinary.ok).toBe(true);
  });

  it("拒绝 Boss 撤退以及主动技能冷却/能量不足", () => {
    const { snapshot, content } = make();
    const bossContent = { ...content, getEncounter: () => success({
      id: "enc_cmd",
      kind: "boss" as const,
      fieldSpriteId: "enc",
      enemyIdsBySlot: ["enemy_cmd"],
      xpReward: 0,
      goldRewardMin: 0,
      goldRewardMax: 0,
      dropTableId: "drop_none",
      canRetreat: true,
      modifierIds: [],
    }) };
    expect(validateBattleCommand({ snapshot, content: bossContent, command: { type: "RETREAT", expectedBattleRevision: 0, actorUnitId: "party:0" } })).toMatchObject({ ok: false, error: { code: "RETREAT_FORBIDDEN" } });

    const cooldownSnapshot = structuredClone(snapshot);
    const cooldownActor = cooldownSnapshot.units.find((unit) => unit.unitId === "party:0");
    if (!cooldownActor) throw new Error("missing command actor");
    cooldownActor.cooldowns.skill_cmd_active = 2;
    expect(validateBattleCommand({
      snapshot: cooldownSnapshot,
      content,
      command: { type: "USE_SKILL", expectedBattleRevision: 0, actorUnitId: "party:0", skillId: "skill_cmd_active", targetUnitIds: ["enemy:0"] },
    })).toMatchObject({ ok: false, error: { code: "SKILL_ON_COOLDOWN", details: { skillId: "skill_cmd_active", remainingTurns: 2 } } });

    const energySkill: SkillDefinition = {
      ...fixtureContentRoot.skills[0],
      id: "skill_cmd_active",
      kind: "active",
      owner: { kind: "character", characterId: "char_cmd" },
      targetRule: "singleEnemy",
      energyCostByLevel: [20, 20, 20, 20, 20],
      cooldownTurnsByLevel: [0, 0, 0, 0, 0],
      effectsByLevel: [[{ kind: "damage", targetRule: "singleEnemy", element: "physical", powerBps: 10_000, flatPower: 0, canCrit: false, ignoreDefenseBps: 0, flatIgnoreDefense: 0, hitCount: 1, retargetEachHit: false, conditionalMultipliers: [] }], [], [], [], []],
    };
    const energyContent = { ...content, getSkill: (id: string) => id === energySkill.id ? success(energySkill) : content.getSkill(id) };
    const energySnapshot = structuredClone(snapshot);
    const energyActor = energySnapshot.units.find((unit) => unit.unitId === "party:0");
    if (!energyActor) throw new Error("missing command actor");
    energyActor.energy = 0;
    expect(validateBattleCommand({
      snapshot: energySnapshot,
      content: energyContent,
      command: { type: "USE_SKILL", expectedBattleRevision: 0, actorUnitId: "party:0", skillId: energySkill.id, targetUnitIds: ["enemy:0"] },
    })).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_ENERGY", details: { required: 20, owned: 0 } } });
  });
});
