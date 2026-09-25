import { describe, expect, it } from "vitest";

import { ContentCatalog, FROZEN_BATCH_IDS, FROZEN_BATCH_MANIFESTS, validateBatchManifest } from "../../src/content/Catalog";
import { fixtureContentRoot } from "../../src/content/data";

const baseFields = { nameKey: "equipment.fixture.name", weaponType: null, minItemLevel: 1, maxItemLevel: 10, baseStat: "defense" as const, baseValueAtMinLevel: 1, growthPerItemLevel: 1, baseGoldValue: 1, goldValuePerItemLevel: 1, spriteId: "sprite_fixture" };

describe("ContentCatalog", () => {
  it("returns INVALID_CONTENT for an unknown lookup", () => {
    const catalog = ContentCatalog.create(fixtureContentRoot, "fixture");
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;

    const missing = catalog.value.getSkill("skill_missing");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("INVALID_CONTENT");
  });

  it("rejects duplicate content IDs", () => {
    const duplicate = {
      ...fixtureContentRoot,
      skills: [fixtureContentRoot.skills[0], fixtureContentRoot.skills[0]],
    };
    const result = ContentCatalog.create(duplicate, "fixture");
    expect(result.ok).toBe(false);
  });

  it("rejects malformed map layers and derived encounter sprite IDs", () => {
    const mapRoot = {
      ...fixtureContentRoot,
      maps: [{
        id: "map_fixture",
        nameKey: "map.map_town.name",
        widthTiles: 2,
        heightTiles: 2,
        tileSize: 16 as const,
        assetBundleId: "fixture",
        spawnPoint: { x: 0, y: 0 },
        groundLayer: [0, 0, 0],
        decorBackLayer: [0, 0, 0, 0],
        decorFrontLayer: [0, 0, 0, 0],
        collisionLayer: [0, 0, 0, 0] as Array<0 | 1>,
        objects: [],
      }],
    };
    expect(ContentCatalog.create(mapRoot, "fixture").ok).toBe(false);

    const encounterRoot = {
      ...fixtureContentRoot,
      dropTables: [{ id: "drop_fixture", rolls: [] }],
      encounters: [{
        id: "encounter_fixture",
        kind: "normal" as const,
        fieldSpriteId: "sprite_wrong",
        enemyIdsBySlot: [null, null, null, null, null, null],
        xpReward: 1,
        goldRewardMin: 1,
        goldRewardMax: 1,
        dropTableId: "drop_fixture",
        canRetreat: true,
        modifierIds: [],
      }],
    };
    expect(ContentCatalog.create(encounterRoot, "fixture").ok).toBe(false);
  });

  it("rejects a reference that exists in another collection", () => {
    const wrongCollection = {
      ...fixtureContentRoot,
      characters: [{
        ...fixtureContentRoot.characters[0],
        basicSkillId: "item_forge_shard",
        activeSkillIds: ["item_forge_shard", "item_forge_shard", "item_forge_shard", "item_forge_shard"],
        ultimateSkillId: "item_forge_shard",
        passiveSkillId: "item_forge_shard",
      }],
    };
    expect(ContentCatalog.create(wrongCollection, "fixture").ok).toBe(false);
  });

  it("requires every batch collection to match its own cumulative manifest exactly", () => {
    const manifest = FROZEN_BATCH_MANIFESTS.verticalSlice;
    const root = Object.fromEntries(Object.entries(manifest).map(([collection, ids]) => [collection, ids.map((id) => ({ id }))])) as never;
    expect(validateBatchManifest(root, "verticalSlice")).toBeNull();

    const missing = structuredClone(root) as Record<string, Array<{ id: string }>>;
    const firstCollection = Object.keys(manifest).find((collection) => manifest[collection as keyof typeof manifest].length > 0);
    if (!firstCollection) throw new Error("verticalSlice manifest must not be empty");
    const removed = missing[firstCollection].pop();
    expect(validateBatchManifest(missing, "verticalSlice")).toEqual({
      path: `batch.verticalSlice.${firstCollection}`,
      issueKey: `missing_id:${removed?.id}`,
    });

    const extra = structuredClone(root) as Record<string, Array<{ id: string }>>;
    extra[firstCollection].push({ id: "table_extra_id" });
    expect(validateBatchManifest(extra, "verticalSlice")).toEqual({
      path: `batch.verticalSlice.${firstCollection}`,
      issueKey: "unexpected_id:table_extra_id",
    });
  });

  it("keeps abyss echo content out of floors06_10 until the terminal batch", () => {
    expect(FROZEN_BATCH_MANIFESTS.floors06_10.abyssEchoes).toHaveLength(0);
    expect(FROZEN_BATCH_MANIFESTS.abyssEchoes.abyssEchoes).toHaveLength(10);
    expect([...FROZEN_BATCH_MANIFESTS.abyssEchoes.abyssEchoes].sort()).toEqual(
      [...FROZEN_BATCH_IDS.abyssEchoes].sort(),
    );
  });

  it("freezes the vertical-slice character and skill-affix IDs as a closed recruitment set", () => {
    const manifest = FROZEN_BATCH_MANIFESTS.verticalSlice;
    expect(manifest.characters).toEqual(["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"]);
    expect(manifest.skillAffixes).toEqual(["sa_ember_focus", "sa_ember_echo", "sa_guard_ripple", "sa_bleed_doublecut", "sa_heal_overflow", "sa_execution_focus", "sa_fortress_focus", "sa_priest_mend_focus"]);
    expect(manifest.skills).toContain("skill_priest_mend");
    expect(manifest.skills).not.toContain("skill_ranger_arrow");
    expect(manifest.recruitments).toEqual(["recruit_iron_guard_tavern", "recruit_ember_mage_tavern", "recruit_priest_first_elite"]);
  });

  it("rejects wrong-slot equipment base pools and empty quality weights", () => {
    const slots = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"] as const;
    const equipmentBases = slots.map((slot) => ({ ...baseFields, id: `eq_${slot}`, slot }));
    const equipmentBasePools = slots.map((slot, index) => ({ slot, weight: 100, bases: [{ baseId: equipmentBases[index].id, weight: 100 }] }));
    const wrongSlot = structuredClone(equipmentBasePools);
    wrongSlot[0].bases[0].baseId = "eq_helmet";
    const dropTables = [{ id: "drop_fixture", rolls: [{ kind: "equipment" as const, chanceBps: 10_000, itemLevelMin: 1, itemLevelMax: 10, equipmentBasePools: wrongSlot, qualityWeights: [{ quality: "common" as const, weight: 100 }], guaranteedMinQuality: null, abyssUpgradeChanceBps: 0 }] }];
    const wrongSlotResult = ContentCatalog.create({ ...fixtureContentRoot, equipmentBases, dropTables }, "fixture");
    expect(wrongSlotResult.ok).toBe(false);
    if (!wrongSlotResult.ok) expect(wrongSlotResult.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "base_pool_slot_or_weight" } });

    const emptyWeights = [{ id: "drop_fixture", rolls: [{ kind: "skillStone" as const, chanceBps: 10_000, itemLevelMin: 1, itemLevelMax: 1, qualityWeights: [{ quality: "magic" as const, weight: 0 }], guaranteedMinQuality: null }] }];
    const emptyWeightResult = ContentCatalog.create({ ...fixtureContentRoot, dropTables: emptyWeights }, "fixture");
    expect(emptyWeightResult.ok).toBe(false);
    if (!emptyWeightResult.ok) expect(emptyWeightResult.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "empty_weight_group" } });

    const filteredWeights = [{ id: "drop_fixture", rolls: [{ kind: "equipment" as const, chanceBps: 10_000, itemLevelMin: 1, itemLevelMax: 1, equipmentBasePools, qualityWeights: [{ quality: "rare" as const, weight: 100 }], guaranteedMinQuality: "epic" as const, abyssUpgradeChanceBps: 0 }] }];
    const filteredResult = ContentCatalog.create({ ...fixtureContentRoot, equipmentBases, dropTables: filteredWeights }, "fixture");
    expect(filteredResult.ok).toBe(false);
    if (!filteredResult.ok) expect(filteredResult.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "guaranteed_quality_pool_empty" } });
  });

  it("rejects illegal affix qualities and missing per-character recruitment", () => {
    const illegalAffix = {
      id: "af_fixture", nameKey: "affix.af_fixture.name", descriptionKey: "affix.af_fixture.description", category: "baseStat" as const, pool: "normal" as const,
      allowedSlots: ["weapon" as const], allowedWeaponTypes: ["sword" as const], minItemLevel: 1, allowedQualities: ["common" as const], exclusiveGroup: null,
      stackRule: "add" as const, weight: 1, goldValue: 1, canBeCraftEmpowered: true, tiers: [{ tier: 1 as const, minItemLevel: 1, rollMin: 1, rollMax: 1 }],
      modifiers: [{ kind: "flatStat" as const, stat: "attack" as const, rollScaleBps: 10_000 }], tags: [],
    };
    const poolResult = ContentCatalog.create({ ...fixtureContentRoot, equipmentAffixes: [illegalAffix] }, "fixture");
    expect(poolResult.ok).toBe(false);
    if (!poolResult.ok) expect(poolResult.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "illegal_affix_pool" } });

    const craftResult = ContentCatalog.create({ ...fixtureContentRoot, equipmentAffixes: [{ ...illegalAffix, category: "trigger" as const, allowedQualities: ["magic" as const] }] }, "fixture");
    expect(craftResult.ok).toBe(false);
    if (!craftResult.ok) expect(craftResult.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "illegal_craft_empowerment" } });

    const extraCharacter = { ...fixtureContentRoot.characters[0], id: "char_extra", fieldSpriteId: "sprite_field_char_extra", battleSpriteId: "sprite_battle_char_extra" };
    const recruitmentResult = ContentCatalog.create({ ...fixtureContentRoot, characters: [...fixtureContentRoot.characters, extraCharacter] }, "fixture");
    expect(recruitmentResult.ok).toBe(false);
    if (!recruitmentResult.ok) expect(recruitmentResult.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "recruitment_character_set" } });

    const protagonistRecruitment = { id: "recruit_wanderer", characterId: "char_wanderer", condition: { kind: "gold" as const, goldCost: 0, minimumClearedFloor: 0 } };
    const protagonistResult = ContentCatalog.create({ ...fixtureContentRoot, recruitments: [protagonistRecruitment] }, "fixture");
    expect(protagonistResult.ok).toBe(false);
    if (!protagonistResult.ok) expect(protagonistResult.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "recruitment_character_set" } });
  });

  it("evaluates fixed equipment pools against the actual base weapon type", () => {
    const swordBase = { ...baseFields, id: "eq_sword_fixture", slot: "weapon" as const, weaponType: "sword" as const, baseStat: "attack" as const };
    const bowOnlyAffix = {
      id: "af_bow_only", nameKey: "affix.af_bow_only.name", descriptionKey: "affix.af_bow_only.description", category: "baseStat" as const, pool: "normal" as const,
      allowedSlots: ["weapon" as const], allowedWeaponTypes: ["bow" as const], minItemLevel: 1, allowedQualities: ["magic" as const], exclusiveGroup: null,
      stackRule: "add" as const, weight: 1, goldValue: 1, canBeCraftEmpowered: true, tiers: [{ tier: 1 as const, minItemLevel: 1, rollMin: 1, rollMax: 1 }],
      modifiers: [{ kind: "flatStat" as const, stat: "attack" as const, rollScaleBps: 10_000 }], tags: [],
    };
    const fixedDrop = { id: "drop_fixed", rolls: [{ kind: "fixedEquipment" as const, chanceBps: 10_000, baseId: swordBase.id, itemLevel: 1, quality: "magic" as const, craftGrade: "ordinary" as const, fixedAbyssAffixId: null }] };
    const result = ContentCatalog.create({ ...fixtureContentRoot, equipmentBases: [swordBase], equipmentAffixes: [bowOnlyAffix], dropTables: [fixedDrop] }, "fixture");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "fixed_normal_affix_pool_insufficient" } });
  });

  it("requires a skill-stone pool that can target the tuned character", () => {
    const unusedSkill = { ...fixtureContentRoot.skills[0], id: "skill_unused" };
    const unreachableAffix = {
      id: "sa_unreachable", nameKey: "skill_affix.sa_unreachable.name", descriptionKey: "skill_affix.sa_unreachable.description", kind: "amplify" as const, pool: "normal" as const,
      target: { kind: "skill" as const, skillId: unusedSkill.id }, minItemLevel: 1, allowedQualities: ["magic" as const], exclusiveGroup: null, stackRule: "add" as const,
      weight: 1, goldValue: 1, rollMin: 1, rollMax: 1, operation: { kind: "addPowerBps" as const }, tags: [],
    };
    const stoneDrop = { id: "drop_stone", rolls: [{ kind: "skillStone" as const, chanceBps: 10_000, itemLevelMin: 1, itemLevelMax: 1, qualityWeights: [{ quality: "magic" as const, weight: 100 }], guaranteedMinQuality: null }] };
    const result = ContentCatalog.create({ ...fixtureContentRoot, skills: [...fixtureContentRoot.skills, unusedSkill], skillAffixes: [unreachableAffix], dropTables: [stoneDrop] }, "fixture");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "normal_skill_affix_pool_insufficient:char_wanderer:magic:1" } });
  });

  it("treats an empty weapon filter as universal and enforces conflict-free pool capacity", () => {
    const swordBase = { ...baseFields, id: "eq_sword_fixture", slot: "weapon" as const, weaponType: "sword" as const, baseStat: "attack" as const };
    const makeAffix = (id: string, overrides: Record<string, unknown> = {}) => ({
      id, nameKey: `affix.${id}.name`, descriptionKey: `affix.${id}.description`, category: "baseStat" as const, pool: "normal" as const,
      allowedSlots: ["weapon" as const], allowedWeaponTypes: [], minItemLevel: 1, allowedQualities: ["magic" as const, "rare" as const], exclusiveGroup: null,
      stackRule: "add" as const, weight: 1, goldValue: 1, canBeCraftEmpowered: true, tiers: [{ tier: 1 as const, minItemLevel: 1, rollMin: 1, rollMax: 1 }],
      modifiers: [{ kind: "flatStat" as const, stat: "attack" as const, rollScaleBps: 10_000 }], tags: [], ...overrides,
    });
    const fixed = (quality: "magic" | "rare", craftGrade: "ordinary" | "exalted") => ({ id: "drop_fixed", rolls: [{ kind: "fixedEquipment" as const, chanceBps: 10_000, baseId: swordBase.id, itemLevel: 1, quality, craftGrade, fixedAbyssAffixId: null }] });

    const universal = ContentCatalog.create({ ...fixtureContentRoot, equipmentBases: [swordBase], equipmentAffixes: [makeAffix("af_one"), makeAffix("af_two")], dropTables: [fixed("magic", "ordinary")] }, "fixture");
    expect(universal.ok).toBe(true);

    const conflicted = ContentCatalog.create({ ...fixtureContentRoot, equipmentBases: [swordBase], equipmentAffixes: [makeAffix("af_one", { exclusiveGroup: "same" }), makeAffix("af_two", { exclusiveGroup: "same" }), makeAffix("af_three", { exclusiveGroup: "same" })], dropTables: [fixed("rare", "ordinary")] }, "fixture");
    expect(conflicted.ok).toBe(false);
    if (!conflicted.ok) expect(conflicted.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "fixed_normal_affix_pool_insufficient" } });

    const craftShortage = ContentCatalog.create({ ...fixtureContentRoot, equipmentBases: [swordBase], equipmentAffixes: [makeAffix("af_one"), makeAffix("af_two", { canBeCraftEmpowered: false }), makeAffix("af_three", { canBeCraftEmpowered: false })], dropTables: [fixed("rare", "exalted")] }, "fixture");
    expect(craftShortage.ok).toBe(false);
    if (!craftShortage.ok) expect(craftShortage.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "fixed_craft_pool_insufficient" } });

    const nonWeaponFilter = makeAffix("af_bad_filter", { allowedSlots: ["helmet"], allowedWeaponTypes: ["sword"] });
    const filterResult = ContentCatalog.create({ ...fixtureContentRoot, equipmentAffixes: [nonWeaponFilter] }, "fixture");
    expect(filterResult.ok).toBe(false);
    if (!filterResult.ok) expect(filterResult.error).toMatchObject({ code: "INVALID_CONTENT", details: { issueKey: "weapon_filter_without_weapon_slot" } });
  });

  it("freezes every cumulative batch count from the four content task cards", () => {
    const collectionOrder = ["characters", "skills", "statuses", "equipmentBases", "equipmentAffixes", "affixTriggers", "skillAffixes", "combos", "enemies", "encounters", "encounterModifiers", "bossIntents", "abyssEchoes", "floors", "maps", "npcs", "dialogues", "quests", "recruitments", "shops", "items", "dropTables"] as const;
    const expected = {
      verticalSlice: [4, 63, 18, 11, 12, 3, 8, 4, 6, 5, 4, 1, 0, 1, 2, 5, 5, 1, 3, 1, 5, 5],
      floors02_05: [6, 85, 18, 38, 26, 8, 16, 11, 20, 25, 8, 5, 0, 5, 6, 7, 7, 1, 5, 1, 5, 25],
      floors06_10: [6, 97, 18, 60, 48, 15, 24, 18, 35, 50, 8, 10, 0, 10, 11, 7, 7, 1, 5, 1, 5, 50],
      abyssEchoes: [6, 97, 18, 60, 48, 15, 24, 18, 35, 50, 8, 10, 10, 10, 11, 7, 7, 1, 5, 1, 5, 50],
    } as const;
    for (const [batchId, counts] of Object.entries(expected) as Array<[keyof typeof expected, readonly number[]]>) {
      expect(collectionOrder.map((collection) => FROZEN_BATCH_MANIFESTS[batchId][collection].length)).toEqual(counts);
    }
  });
});
