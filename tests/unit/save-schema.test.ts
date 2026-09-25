import { describe, expect, it } from "vitest";

import { fixtureContentRoot } from "../../src/content/data";
import { verticalSliceContentRoot } from "../../src/content/data/verticalSlice";
import { SequentialIdFactory } from "../../src/domain/common/DomainContext";
import {
  createNewGameSave,
  gameSaveV1Schema,
  validateGameSave,
} from "../../src/domain/save/GameSave";
import type {
  BattleSnapshotV1,
  ContentRootV1,
  EquipmentAffixDefinition,
  GameSaveV1,
  SkillAffixDefinition,
} from "../../src/content/contracts";

const timestamp = "2026-08-21T00:00:00.000Z";

const statBlock = {
  maxHp: 100,
  attack: 10,
  defense: 10,
  speed: 10,
  critRateBps: 0,
  critDamageBps: 15_000,
  effectHitBps: 0,
  effectResistBps: 0,
};

function contentWithFiveItems() {
  return {
    ...fixtureContentRoot,
    items: [
      ...fixtureContentRoot.items,
      { id: "item_minor_potion", nameKey: "item.item_minor_potion.name", category: "material" as const, maxStack: 99 as const, baseGoldValue: 3, iconId: "icon_item_minor_potion" },
      { id: "item_major_potion", nameKey: "item.item_major_potion.name", category: "material" as const, maxStack: 99 as const, baseGoldValue: 6, iconId: "icon_item_major_potion" },
      { id: "item_cleansing_tonic", nameKey: "item.item_cleansing_tonic.name", category: "material" as const, maxStack: 99 as const, baseGoldValue: 5, iconId: "icon_item_cleansing_tonic" },
    ],
  };
}

function equipmentAffix(id: string, rollMin: number, allowedQualities: EquipmentAffixDefinition["allowedQualities"] = ["magic"]): EquipmentAffixDefinition {
  return {
    id,
    nameKey: `equipment_affix.${id}.name`,
    descriptionKey: `equipment_affix.${id}.description`,
    category: "baseStat",
    pool: "normal",
    allowedSlots: ["weapon"],
    // 空数组是“全部武器”，不是“没有武器”。
    allowedWeaponTypes: [],
    minItemLevel: 1,
    allowedQualities,
    exclusiveGroup: null,
    stackRule: "add",
    weight: 100,
    goldValue: 1,
    canBeCraftEmpowered: false,
    tiers: [{ tier: 1, minItemLevel: 1, rollMin, rollMax: rollMin + 9 }],
    modifiers: [],
    tags: [],
  };
}

function skillAffix(id: string, rollMin: number, allowedQualities: SkillAffixDefinition["allowedQualities"]): SkillAffixDefinition {
  return {
    id,
    nameKey: `skill_affix.${id}.name`,
    descriptionKey: `skill_affix.${id}.description`,
    kind: "amplify",
    pool: "normal",
    target: { kind: "allSkills" },
    minItemLevel: 1,
    allowedQualities,
    exclusiveGroup: null,
    stackRule: "add",
    weight: 100,
    goldValue: 1,
    rollMin,
    rollMax: rollMin + 9,
    operation: { kind: "addPowerBps" },
    tags: [],
  };
}

function skillAbyssAffix(): SkillAffixDefinition {
  return {
    ...skillAffix("sa_abyss", 91, ["abyss"]),
    pool: "abyss",
  };
}

function shopContent(base: ContentRootV1, tier: ContentRootV1["shops"][number]["tiers"][number]): ContentRootV1 {
  return {
    ...base,
    shops: [{ id: "shop_town", npcId: "npc_merchant", tiers: [tier] }],
  };
}

function battleSnapshot(overrides: Partial<BattleSnapshotV1> = {}): BattleSnapshotV1 {
  return {
    battleId: "battle_test",
    expeditionId: "exp_test",
    battleRevision: 0,
    encounterId: "encounter_test",
    encounterObjectId: "",
    phase: "COMPLETE",
    outcome: "defeat",
    round: 1,
    units: [],
    initiativeQueueUnitIds: [],
    currentUnitId: null,
    pendingEvents: [],
    pendingBossIntents: [],
    successfulItemUses: 0,
    abyssEchoOutcome: "notApplicable",
    rngState: [1, 2, 3, 4],
    firedComboKeys: [],
    roundTriggerCounts: {},
    battleTriggerCounts: {},
    metrics: {
      damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {},
      bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0,
    },
    reward: null,
    returnMapId: "map_town",
    returnSafePosition: { x: 8, y: 8 },
    ...overrides,
  };
}

function encounterReward(source: { encounterId: string; mapId: string; objectId: string }): NonNullable<GameSaveV1["battle"]>["reward"] {
  return {
    transactionId: "reward_test",
    source: { kind: "encounter", ...source },
    gold: 0,
    xp: 0,
    stackables: {},
    stackableCapConversions: [],
    equipment: [],
    skillStones: [],
    instanceOrder: [],
    claimed: false,
  };
}

describe("GameSaveV1 schema and factory", () => {
  it("creates a strict revision-1 new game with explicit defaults", () => {
    const content = contentWithFiveItems();
    const save = createNewGameSave(content, timestamp);

    expect(save.revision).toBe(1);
    expect(save.createdAt).toBe(timestamp);
    expect(save.updatedAt).toBe(timestamp);
    expect(save.gold).toBe(200);
    expect(save.skillStoneFocusCharacterId).toBe(content.protagonistCharacterId);
    expect(save.party.slots).toEqual([content.protagonistCharacterId, null, null, null]);
    expect(save.inventory.stackables).toEqual({
      item_forge_shard: 0,
      item_inscription_dust: 0,
      item_minor_potion: 3,
      item_major_potion: 0,
      item_cleansing_tonic: 0,
    });
    expect(save.world).toMatchObject({
      highestUnlockedFloor: 1,
      bossRetryUnlockedFloorIds: [],
      clearedEchoIds: [],
      echoCharges: 0,
      echoAttemptSequence: 0,
    });
    expect(save.battleAssist.lastActionByCharacter).toEqual({ char_wanderer: null });
    expect(gameSaveV1Schema.safeParse(save).success).toBe(true);
    expect(validateGameSave(save, content).ok).toBe(true);
  });

  it("rejects missing and unknown fields instead of accepting aliases", () => {
    const save = createNewGameSave(contentWithFiveItems(), timestamp);
    const missing = structuredClone(save) as unknown as Record<string, unknown>;
    delete missing.battleAssist;
    const extra = { ...save, unknownField: true };

    expect(gameSaveV1Schema.safeParse(missing).success).toBe(false);
    expect(gameSaveV1Schema.safeParse(extra).success).toBe(false);
  });

  it("enforces the 9999 stackable cap and exact item key set", () => {
    const content = contentWithFiveItems();
    const save = createNewGameSave(content, timestamp);
    save.inventory.stackables.item_minor_potion = 9_999;
    expect(validateGameSave(save, content).ok).toBe(true);

    save.inventory.stackables.item_minor_potion = 10_000;
    expect(validateGameSave(save, content).ok).toBe(false);

    const missing = structuredClone(save);
    delete missing.inventory.stackables.item_major_potion;
    expect(validateGameSave(missing, content).ok).toBe(false);
  });

  it("checks expedition mode and battle/echo cross-field invariants", () => {
    const content = {
      ...contentWithFiveItems(),
      floors: [{
        id: "floor_01", nameKey: "floor.floor_01.name", floorNumber: 1, mapId: "map_floor_01", bossEncounterId: "encounter_floor_01_boss", assetBundleId: "bundle_floor_01",
        minItemLevel: 1, maxItemLevel: 5, recommendedBossLevel: 1, recommendedItemLevel: 1, bossEnrageRound: 10,
        bossGateType: "tutorial" as const, bossPhaseThresholdBps: [7_000], shortRouteObjectIds: [], isAbyss: false, firstClearRewardTableId: "drop_floor_01_first_clear",
      }],
      maps: [{
        id: "map_floor_01", nameKey: "map.map_floor_01.name", widthTiles: 2, heightTiles: 2, tileSize: 16 as const, assetBundleId: "bundle_floor_01", spawnPoint: { x: 0, y: 0 },
        groundLayer: [0, 0, 0, 0], decorBackLayer: [0, 0, 0, 0], decorFrontLayer: [0, 0, 0, 0], collisionLayer: [0, 0, 0, 0] as Array<0 | 1>, objects: [],
      }],
    };
    const save = createNewGameSave(content, timestamp);
    save.expedition = {
      expeditionId: "exp_test", expeditionSeed: 1, mode: "exploration", abyssEchoId: null, floorId: "floor_01", mapId: "map_floor_01",
      playerPosition: { x: 8, y: 8 }, safePosition: { x: 8, y: 8 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0,
      focusedEliteStoneConsumed: false, startedAt: timestamp,
    };
    expect(validateGameSave(save, content).ok).toBe(true);
    const crossTile = structuredClone(save);
    crossTile.expedition!.playerPosition = { x: 15, y: 8 };
    crossTile.expedition!.safePosition = { x: 15, y: 8 };
    const blockedContent = { ...content, maps: [{ ...content.maps[0], collisionLayer: [0, 1, 0, 0] as Array<0 | 1> }] };
    expect(validateGameSave(crossTile, blockedContent).ok).toBe(false);
    const edge = structuredClone(save);
    edge.expedition!.playerPosition = { x: 6, y: 8 };
    edge.expedition!.safePosition = { x: 6, y: 8 };
    expect(validateGameSave(edge, content).ok).toBe(true);
    const exactRightEdge = structuredClone(save);
    exactRightEdge.expedition!.playerPosition = { x: 10, y: 8 };
    exactRightEdge.expedition!.safePosition = { x: 10, y: 8 };
    const rightEdgeBlocked = { ...content, maps: [{ ...content.maps[0], collisionLayer: [0, 1, 0, 0] as Array<0 | 1> }] };
    expect(validateGameSave(exactRightEdge, rightEdgeBlocked).ok).toBe(true);
    const crossedRightEdge = structuredClone(exactRightEdge);
    crossedRightEdge.expedition!.playerPosition = { x: 11, y: 8 };
    expect(validateGameSave(crossedRightEdge, rightEdgeBlocked).ok).toBe(false);
    const exactBottomEdge = structuredClone(save);
    exactBottomEdge.expedition!.playerPosition = { x: 8, y: 16 };
    exactBottomEdge.expedition!.safePosition = { x: 8, y: 16 };
    const bottomEdgeBlocked = { ...content, maps: [{ ...content.maps[0], collisionLayer: [0, 0, 1, 0] as Array<0 | 1> }] };
    expect(validateGameSave(exactBottomEdge, bottomEdgeBlocked).ok).toBe(true);
    const crossedBottomEdge = structuredClone(exactBottomEdge);
    crossedBottomEdge.expedition!.playerPosition = { x: 8, y: 17 };
    expect(validateGameSave(crossedBottomEdge, bottomEdgeBlocked).ok).toBe(false);
    const outside = structuredClone(save);
    outside.expedition!.playerPosition = { x: 5, y: 8 };
    expect(validateGameSave(outside, content).ok).toBe(false);
    save.expedition.mode = "abyssEcho";
    expect(validateGameSave(save, content).ok).toBe(false);
  });

  it("rejects skill level zero loadout, negative echo charges, capacity overflow and unequipped HP bypass", () => {
    const content = contentWithFiveItems();
    const save = createNewGameSave(content, timestamp);
    const skillLoadout = structuredClone(save);
    const protagonist = skillLoadout.characters[content.protagonistCharacterId];
    protagonist.equippedActiveSkillIds = [content.characters[0].activeSkillIds[0], null];
    expect(validateGameSave(skillLoadout, content).ok).toBe(false);

    const charges = structuredClone(save);
    charges.world.echoCharges = -1;
    expect(validateGameSave(charges, content).ok).toBe(false);

    const equipmentOverflow = structuredClone(save);
    equipmentOverflow.inventory.equipment = Array.from({ length: 121 }, (_, index) => ({
      instanceId: `eq_${index}`,
      baseId: "eq_missing",
      itemLevel: 1,
      quality: "common" as const,
      craftGrade: "ordinary" as const,
      affixes: [],
      abyssAffix: null,
      locked: false,
      acquiredAt: timestamp,
      sourceTransactionId: `tx_${index}`,
      reforgeLockedIndex: null,
      reforgeCount: 0,
    }));
    expect(validateGameSave(equipmentOverflow, content).ok).toBe(false);

    const hpBypass = structuredClone(save);
    hpBypass.characters[content.protagonistCharacterId].currentHp = 101;
    expect(validateGameSave(hpBypass, content).ok).toBe(false);
  });

  it("uses level growth when validating current HP against the static maximum", () => {
    const save = createNewGameSave(verticalSliceContentRoot, timestamp, {
      newGameSeed: 0x20_26_08_26,
      idFactory: new SequentialIdFactory(),
    });
    const protagonist = save.characters[verticalSliceContentRoot.protagonistCharacterId];

    expect(validateGameSave(save, verticalSliceContentRoot).ok).toBe(true);

    protagonist.level = 2;
    protagonist.xp = 100;
    protagonist.currentHp = 458;
    expect(validateGameSave(save, verticalSliceContentRoot).ok).toBe(true);

    const overMax = structuredClone(save);
    overMax.characters[verticalSliceContentRoot.protagonistCharacterId].currentHp = 459;
    expect(validateGameSave(overMax, verticalSliceContentRoot).ok).toBe(false);

    const levelOne = createNewGameSave(verticalSliceContentRoot, timestamp, {
      newGameSeed: 0x20_26_08_26,
      idFactory: new SequentialIdFactory(),
    });
    levelOne.characters[verticalSliceContentRoot.protagonistCharacterId].currentHp = 421;
    expect(validateGameSave(levelOne, verticalSliceContentRoot).ok).toBe(false);
  });

  it("applies level growth before the guard passive percentage", () => {
    const save = createNewGameSave(verticalSliceContentRoot, timestamp, {
      newGameSeed: 0x20_26_08_26,
      idFactory: new SequentialIdFactory(),
    });
    const guard = save.characters.char_iron_guard;

    // 铁卫的 520 基础生命、46 等级成长和 12% 被动应按
    // floor((520 + 46) * 1.12) = 633 计算，而不是先取 520 的百分比。
    guard.level = 2;
    guard.xp = 100;
    guard.currentHp = 633;
    expect(validateGameSave(save, verticalSliceContentRoot).ok).toBe(true);

    const overMax = structuredClone(save);
    overMax.characters.char_iron_guard.currentHp = 634;
    expect(validateGameSave(overMax, verticalSliceContentRoot).ok).toBe(false);

    const levelOne = createNewGameSave(verticalSliceContentRoot, timestamp, {
      newGameSeed: 0x20_26_08_26,
      idFactory: new SequentialIdFactory(),
    });
    levelOne.characters.char_iron_guard.currentHp = 583;
    expect(validateGameSave(levelOne, verticalSliceContentRoot).ok).toBe(false);
  });

  it("uses injected new-game seed and frozen shop tier to create stable non-empty offers", () => {
    const content = {
      ...contentWithFiveItems(),
      shops: [{
        id: "shop_town",
        npcId: "npc_merchant",
        tiers: [{
          minHighestUnlockedFloor: 1,
          offerCount: 2,
          itemLevelMin: 1,
          itemLevelMax: 1,
          offerKindWeights: { stackableItem: 100, equipment: 0, skillStone: 0 },
          stackableItems: [{ itemId: "item_minor_potion", weight: 1, quantityMin: 1, quantityMax: 2 }],
          equipmentBasePools: [],
          equipmentQualityWeights: [],
          skillStoneQualityWeights: [],
        }],
      }],
    };
    const first = createNewGameSave(content, timestamp, { newGameSeed: 0x1234_5678 });
    const second = createNewGameSave(content, timestamp, { newGameSeed: 0x1234_5678 });
    expect(first.shop.offers).toHaveLength(2);
    expect(first.shop).toEqual(second.shop);
    expect(validateGameSave(first, content).ok).toBe(true);
  });

  it("generates equipment shop instances with an explicit zero reforge count", () => {
    const content = {
      ...contentWithFiveItems(),
      equipmentBases: [{
        id: "eq_test_blade", nameKey: "equipment.eq_test_blade.name", slot: "weapon" as const, weaponType: "sword" as const,
        minItemLevel: 1, maxItemLevel: 1, baseStat: "attack" as const, baseValueAtMinLevel: 10, growthPerItemLevel: 0,
        baseGoldValue: 10, goldValuePerItemLevel: 0, spriteId: "sprite_eq_test_blade",
      }],
      shops: [{
        id: "shop_town", npcId: "npc_merchant", tiers: [{
          minHighestUnlockedFloor: 1, offerCount: 1, itemLevelMin: 1, itemLevelMax: 1,
          offerKindWeights: { stackableItem: 0, equipment: 100, skillStone: 0 },
          stackableItems: [],
          equipmentBasePools: [{ slot: "weapon" as const, weight: 100, bases: [{ baseId: "eq_test_blade", weight: 100 }] }],
          equipmentQualityWeights: [{ quality: "common" as const, weight: 100 }], skillStoneQualityWeights: [],
        }],
      }],
    };
    const save = createNewGameSave(content, timestamp, { newGameSeed: 7, idFactory: new SequentialIdFactory() });
    const equipment = save.shop.offers[0];
    expect(equipment.kind).toBe("equipment");
    if (equipment.kind !== "equipment") throw new Error("expected equipment offer");
    expect(equipment.equipment.reforgeCount).toBe(0);
    expect(validateGameSave(save, content).ok).toBe(true);
  });

  it("treats an empty allowedWeaponTypes list as all weapons", () => {
    const base = {
      id: "eq_universal_blade", nameKey: "equipment.eq_universal_blade.name", slot: "weapon" as const, weaponType: "hammer" as const,
      minItemLevel: 1, maxItemLevel: 1, baseStat: "attack" as const, baseValueAtMinLevel: 10, growthPerItemLevel: 0,
      baseGoldValue: 10, goldValuePerItemLevel: 0, spriteId: "sprite_eq_universal_blade",
    };
    const content = shopContent({
      ...contentWithFiveItems(),
      equipmentBases: [base],
      equipmentAffixes: [equipmentAffix("af_universal_1", 10), equipmentAffix("af_universal_2", 20)],
    }, {
      minHighestUnlockedFloor: 1, offerCount: 1, itemLevelMin: 1, itemLevelMax: 1,
      offerKindWeights: { stackableItem: 0, equipment: 100, skillStone: 0 },
      stackableItems: [],
      equipmentBasePools: [{ slot: "weapon", weight: 100, bases: [{ baseId: base.id, weight: 100 }] }],
      equipmentQualityWeights: [{ quality: "magic", weight: 100 }],
      skillStoneQualityWeights: [],
    });
    const save = createNewGameSave(content, timestamp, { newGameSeed: 11, idFactory: new SequentialIdFactory() });
    const offer = save.shop.offers[0];
    expect(offer.kind).toBe("equipment");
    if (offer.kind !== "equipment") throw new Error("expected equipment offer");
    expect(offer.equipment.affixes).toHaveLength(2);
    expect(offer.equipment.affixes).toEqual([
      { affixId: "af_universal_1", tier: 1, roll: 15, craftEmpowered: false, reforged: false },
      { affixId: "af_universal_2", tier: 1, roll: 27, craftEmpowered: false, reforged: false },
    ]);
    expect(validateGameSave(save, content).ok).toBe(true);
  });

  it("uses the frozen magic/rare/epic/abyss skill-stone affix counts", () => {
    const contentBase = {
      ...contentWithFiveItems(),
      skillAffixes: [
        skillAffix("sa_test_1", 10, ["magic", "rare", "epic", "abyss"]),
        skillAffix("sa_test_2", 20, ["magic", "rare", "epic", "abyss"]),
        skillAffix("sa_test_3", 30, ["magic", "rare", "epic", "abyss"]),
        skillAbyssAffix(),
      ],
    };
    for (const quality of ["magic", "rare", "epic", "abyss"] as const) {
      const content = shopContent(contentBase, {
        minHighestUnlockedFloor: 1, offerCount: 1, itemLevelMin: 1, itemLevelMax: 1,
        offerKindWeights: { stackableItem: 0, equipment: 0, skillStone: 100 },
        stackableItems: [], equipmentBasePools: [], equipmentQualityWeights: [],
        skillStoneQualityWeights: [{ quality, weight: 100 }],
      });
      const save = createNewGameSave(content, timestamp, { newGameSeed: 17, idFactory: new SequentialIdFactory() });
      const offer = save.shop.offers[0];
      expect(offer.kind).toBe("skillStone");
      if (offer.kind !== "skillStone") throw new Error("expected skill-stone offer");
      expect(offer.skillStone.affixes).toHaveLength(quality === "magic" ? 1 : quality === "rare" ? 2 : 3);
      expect(validateGameSave(save, content).ok).toBe(true);
    }
  });

  it("persists the deterministic skill-stone RNG order", () => {
    const content = shopContent({
      ...contentWithFiveItems(),
      skillAffixes: [
        skillAffix("sa_order_1", 10, ["epic"]),
        skillAffix("sa_order_2", 20, ["epic"]),
        skillAffix("sa_order_3", 30, ["epic"]),
      ],
    }, {
      minHighestUnlockedFloor: 1, offerCount: 1, itemLevelMin: 1, itemLevelMax: 1,
      offerKindWeights: { stackableItem: 0, equipment: 0, skillStone: 100 },
      stackableItems: [], equipmentBasePools: [], equipmentQualityWeights: [],
      skillStoneQualityWeights: [{ quality: "epic", weight: 100 }],
    });
    const save = createNewGameSave(content, timestamp, { newGameSeed: 0x4a11_ce, idFactory: new SequentialIdFactory() });
    const offer = save.shop.offers[0];
    expect(offer.kind).toBe("skillStone");
    if (offer.kind !== "skillStone") throw new Error("expected skill-stone offer");
    // 固定 seed 下的字节结果同时锁住 itemLevel→attuned→quality→ID/roll 交错顺序。
    expect(offer.skillStone.affixes).toEqual([
      { skillAffixId: "sa_order_2", roll: 25, reforged: false },
      { skillAffixId: "sa_order_3", roll: 37, reforged: false },
      { skillAffixId: "sa_order_1", roll: 11, reforged: false },
    ]);
  });

  it("requires battle unit level in the strict runtime schema", () => {
    const content = contentWithFiveItems();
    const save = createNewGameSave(content, timestamp);
    const unit = {
      unitId: "unit_1", definitionId: "enemy_1", faction: "enemy" as const, slot: 0, level: 1,
      prePercentStats: statBlock, staticPercentByStatBps: statBlock, stats: statBlock,
      currentHp: 100, energy: 0, cooldowns: {}, statuses: [], eligibleRound: 1,
      usedExtraTurnThisRound: false, directHitEnergyRootActionIds: [],
    };
    save.battle = {
      battleId: "battle_1", expeditionId: "exp_1", battleRevision: 0, encounterId: "encounter_1", encounterObjectId: "",
      phase: "COMPLETE", outcome: "defeat", round: 1, units: [unit], initiativeQueueUnitIds: ["unit_1"], currentUnitId: null,
      pendingEvents: [], pendingBossIntents: [], successfulItemUses: 0, abyssEchoOutcome: "notApplicable", rngState: [1, 2, 3, 4],
      firedComboKeys: [], roundTriggerCounts: {}, battleTriggerCounts: {}, metrics: {
        damage: [], partyDamageTaken: 0, partyHealingDone: 0, partyShieldGranted: 0, knockouts: [], comboTriggerCounts: {},
        bossEnrageCast: false, maxChainDepth: 0, triggerBudgetExhaustedCount: 0,
      }, reward: null, returnMapId: "map_town", returnSafePosition: { x: 8, y: 8 },
    };
    expect(validateGameSave(save, content).ok).toBe(true);
    const missingLevel = structuredClone(save);
    delete (missingLevel.battle?.units[0] as unknown as Record<string, unknown>).level;
    expect(validateGameSave(missingLevel, content).ok).toBe(false);
  });

  it("closes echo terminal rewards and rejects detached or phase-inconsistent rewards", () => {
    const content: ContentRootV1 = {
      ...contentWithFiveItems(),
      encounters: [{
        id: "enc_echo_boss", kind: "boss", fieldSpriteId: "sprite_enc_echo_boss", enemyIdsBySlot: [null, null, null, null, null, null],
        xpReward: 0, goldRewardMin: 0, goldRewardMax: 0, dropTableId: "drop_echo", canRetreat: false, modifierIds: [],
      }],
      abyssEchoes: [{
        id: "echo_test", nameKey: "abyss_echo.echo_test.name", descriptionKey: "abyss_echo.echo_test.description", floorId: "floor_abyss_01", bossEncounterId: "enc_echo_boss",
        enemyHpBps: 10_000, enemyAttackBps: 10_000, enemyDefenseBps: 10_000, enemySpeedBps: 10_000, enrageRoundDelta: -1,
        itemUseLimit: 1, objective: { maxRounds: 10, maxKnockouts: 0, requiredAnyComboTriggers: 0 }, bonusAbyssUpgradeChanceBps: 0,
        firstClearForgeShards: 1, firstClearInscriptionDust: 1,
      }],
    };
    const baseSave = createNewGameSave(content, timestamp);
    const echoReward = {
      transactionId: "reward_echo",
      source: { kind: "abyssEcho" as const, echoId: "echo_test", encounterId: "enc_echo_boss" },
      gold: 0, xp: 0, stackables: {}, stackableCapConversions: [], equipment: [], skillStones: [], instanceOrder: [], claimed: false,
    };
    const successTerminal = structuredClone(baseSave);
    successTerminal.battle = battleSnapshot({ encounterId: "enc_echo_boss", abyssEchoOutcome: "success", outcome: "victory", phase: "COMPLETE", reward: echoReward });
    expect(validateGameSave(successTerminal, content).ok).toBe(true);
    const failedTerminal = structuredClone(baseSave);
    failedTerminal.battle = battleSnapshot({ encounterId: "enc_echo_boss", abyssEchoOutcome: "failed", outcome: "defeat", phase: "COMPLETE", reward: null });
    expect(validateGameSave(failedTerminal, content).ok).toBe(true);

    const successWithoutReward = structuredClone(successTerminal);
    successWithoutReward.battle!.reward = null;
    expect(validateGameSave(successWithoutReward, content).ok).toBe(false);
    const failedWithReward = structuredClone(failedTerminal);
    failedWithReward.battle!.reward = echoReward;
    expect(validateGameSave(failedWithReward, content).ok).toBe(false);
    const pendingDetached = structuredClone(baseSave);
    pendingDetached.battle = battleSnapshot({ encounterId: "enc_echo_boss", phase: "AWAIT_COMMAND", outcome: "ongoing", abyssEchoOutcome: "pending" });
    expect(validateGameSave(pendingDetached, content).ok).toBe(false);

    const regularContent: ContentRootV1 = {
      ...content,
      encounters: [{
        id: "encounter_test", kind: "normal", fieldSpriteId: "sprite_encounter_test", enemyIdsBySlot: [null, null, null, null, null, null],
        xpReward: 0, goldRewardMin: 0, goldRewardMax: 0, dropTableId: "drop_test", canRetreat: true, modifierIds: [],
      }],
      floors: [{
        id: "floor_test", nameKey: "floor.floor_test.name", floorNumber: 1, mapId: "map_test", bossEncounterId: "encounter_test", assetBundleId: "bundle_test",
        minItemLevel: 1, maxItemLevel: 5, recommendedBossLevel: 1, recommendedItemLevel: 1, bossEnrageRound: 10, bossGateType: "tutorial", bossPhaseThresholdBps: [7_000], shortRouteObjectIds: [], isAbyss: false, firstClearRewardTableId: "drop_test",
      }],
      maps: [{
        id: "map_test", nameKey: "map.map_test.name", widthTiles: 2, heightTiles: 2, tileSize: 16, assetBundleId: "bundle_test", spawnPoint: { x: 8, y: 8 },
        groundLayer: [0, 0, 0, 0], decorBackLayer: [0, 0, 0, 0], decorFrontLayer: [0, 0, 0, 0], collisionLayer: [0, 0, 0, 0],
        objects: [{ kind: "encounter", objectId: "obj_encounter", position: { x: 8, y: 8 }, encounterId: "encounter_test", behavior: { mode: "stationary", patrolPoints: [], wanderRadius: 0, detectionRadius: 1, leashRadius: 1, moveSpeed: 1 } }],
      }],
    };
    const regularSave = createNewGameSave(regularContent, timestamp);
    regularSave.expedition = {
      expeditionId: "exp_regular", expeditionSeed: 1, mode: "exploration", abyssEchoId: null, floorId: "floor_test", mapId: "map_test",
      playerPosition: { x: 8, y: 8 }, safePosition: { x: 8, y: 8 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0,
      focusedEliteStoneConsumed: false, startedAt: timestamp,
    };
    for (const [phase, outcome] of [["AWAIT_COMMAND", "ongoing"], ["DEFEAT", "defeat"]] as const) {
      const invalidRewardPhase = structuredClone(regularSave);
      invalidRewardPhase.battle = battleSnapshot({
        expeditionId: "exp_regular", encounterId: "encounter_test", encounterObjectId: "obj_encounter", returnMapId: "map_test",
        phase, outcome, reward: encounterReward({ encounterId: "encounter_test", mapId: "map_test", objectId: "obj_encounter" }),
      });
      expect(validateGameSave(invalidRewardPhase, regularContent).ok).toBe(false);
    }
    const rewardPendingDefeated = structuredClone(regularSave);
    rewardPendingDefeated.expedition!.defeatedEncounterObjectIds = ["obj_encounter"];
    rewardPendingDefeated.battle = battleSnapshot({
      expeditionId: "exp_regular", encounterId: "encounter_test", encounterObjectId: "obj_encounter", returnMapId: "map_test",
      phase: "REWARD_PENDING", outcome: "victory", reward: encounterReward({ encounterId: "encounter_test", mapId: "map_test", objectId: "obj_encounter" }),
    });
    expect(validateGameSave(rewardPendingDefeated, regularContent).ok).toBe(false);
  });

  it("rejects unknown and cross-referenced dynamic inventory instances", () => {
    const base = {
      id: "eq_dynamic_blade", nameKey: "equipment.eq_dynamic_blade.name", slot: "weapon" as const, weaponType: "sword" as const,
      minItemLevel: 1, maxItemLevel: 1, baseStat: "attack" as const, baseValueAtMinLevel: 10, growthPerItemLevel: 0,
      baseGoldValue: 10, goldValuePerItemLevel: 0, spriteId: "sprite_eq_dynamic_blade",
    };
    const content: ContentRootV1 = {
      ...contentWithFiveItems(),
      equipmentBases: [base],
      equipmentAffixes: [equipmentAffix("af_dynamic_1", 10), equipmentAffix("af_dynamic_2", 20)],
      skillAffixes: [skillAffix("sa_dynamic", 10, ["magic"])],
    };
    const save = createNewGameSave(content, timestamp);
    const equipment = {
      instanceId: "eq_dynamic_1", baseId: base.id, itemLevel: 1, quality: "magic" as const, craftGrade: "ordinary" as const,
      affixes: [
        { affixId: "af_dynamic_1", tier: 1 as const, roll: 10, craftEmpowered: false, reforged: false },
        { affixId: "af_dynamic_2", tier: 1 as const, roll: 20, craftEmpowered: false, reforged: false },
      ],
      abyssAffix: null, locked: false, acquiredAt: timestamp, sourceTransactionId: "tx_dynamic_1", reforgeLockedIndex: null, reforgeCount: 0,
    };
    const skillStone = {
      instanceId: "stone_dynamic_1", attunedCharacterId: content.protagonistCharacterId, itemLevel: 1, quality: "magic" as const,
      affixes: [{ skillAffixId: "sa_dynamic", roll: 10, reforged: false }], abyssAffix: null, locked: false,
      acquiredAt: timestamp, sourceTransactionId: "tx_dynamic_2", reforgeLockedIndex: null, reforgeCount: 0,
    };
    save.inventory.equipment.push(equipment);
    save.inventory.skillStones.push(skillStone);
    save.characters[content.protagonistCharacterId].equipmentBySlot.weapon = equipment.instanceId;
    save.characters[content.protagonistCharacterId].skillStoneInstanceId = skillStone.instanceId;
    expect(validateGameSave(save, content).ok).toBe(true);

    const unknownBase = structuredClone(save);
    unknownBase.inventory.equipment[0].baseId = "eq_missing";
    expect(validateGameSave(unknownBase, content).ok).toBe(false);
    const unknownAffix = structuredClone(save);
    unknownAffix.inventory.equipment[0].affixes[0].affixId = "af_missing";
    expect(validateGameSave(unknownAffix, content).ok).toBe(false);
    const slotMismatch = structuredClone(save);
    slotMismatch.characters[content.protagonistCharacterId].equipmentBySlot.weapon = null;
    slotMismatch.characters[content.protagonistCharacterId].equipmentBySlot.helmet = equipment.instanceId;
    expect(validateGameSave(slotMismatch, content).ok).toBe(false);
    const attunedMismatch = structuredClone(save);
    attunedMismatch.inventory.skillStones[0].attunedCharacterId = "char_missing";
    expect(validateGameSave(attunedMismatch, content).ok).toBe(false);
    const duplicateReference = structuredClone(save);
    duplicateReference.characters[content.protagonistCharacterId].equipmentBySlot.helmet = equipment.instanceId;
    expect(validateGameSave(duplicateReference, content).ok).toBe(false);
    const badReforgeIndex = structuredClone(save);
    badReforgeIndex.inventory.equipment[0].reforgeLockedIndex = 2;
    expect(validateGameSave(badReforgeIndex, content).ok).toBe(false);
    const badSkillAffix = structuredClone(save);
    badSkillAffix.inventory.skillStones[0].affixes[0].skillAffixId = "sa_missing";
    expect(validateGameSave(badSkillAffix, content).ok).toBe(false);
  });
});
