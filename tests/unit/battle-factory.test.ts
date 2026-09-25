import { describe, expect, it } from "vitest";

import type {
  BattleSnapshotV1,
  CharacterDefinition,
  CharacterProgressV1,
  EncounterDefinition,
  EnemyDefinition,
  MapDefinition,
  SkillDefinition,
  StatBlock,
} from "../../src/content/contracts";
import { fixtureContentRoot } from "../../src/content/data";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { BattleFactory, createBattleSnapshot } from "../../src/domain/battle/BattleFactory";
import type { BattleContentSource, BattleFactoryInput } from "../../src/domain/battle/BattleTypes";

const skillIds = ["skill_basic", "skill_active_1", "skill_active_2", "skill_active_3", "skill_active_4", "skill_ultimate", "skill_passive"] as const;

function stats(speed = 50, maxHp = 100): StatBlock {
  return { maxHp, attack: 30, defense: 20, speed, critRateBps: 500, critDamageBps: 15000, effectHitBps: 300, effectResistBps: 300 };
}

function skill(id: string): SkillDefinition {
  return { ...fixtureContentRoot.skills[0], id, owner: { kind: "systemEffect" }, effectsByLevel: [[], [], [], [], []] };
}

function character(id: string, speed = 50): CharacterDefinition {
  return {
    id,
    nameKey: `character.${id}`,
    role: "fighter",
    allowedWeaponTypes: ["sword"],
    baseStats: stats(speed),
    growthPerLevel: { maxHp: 0, attack: 0, defense: 0, speed: 0, critRateBps: 0, critDamageBps: 0, effectHitBps: 0, effectResistBps: 0 },
    innateTags: [],
    basicSkillId: skillIds[0],
    activeSkillIds: [skillIds[1], skillIds[2], skillIds[3], skillIds[4]],
    ultimateSkillId: skillIds[5],
    passiveSkillId: skillIds[6],
    fieldSpriteId: `field_${id}`,
    battleSpriteId: `battle_${id}`,
  };
}

function enemy(id: string, speed = 40): EnemyDefinition {
  return {
    id,
    nameKey: `enemy.${id}`,
    level: 1,
    stats: stats(speed, 80),
    elementWeaknesses: [],
    elementResistances: [],
    immunityTags: [],
    basicSkillId: skillIds[0],
    basicTargetStrategy: "frontFirstOpponent",
    skillIds: [],
    aiRules: [],
    spriteId: `enemy_${id}`,
  };
}

function progress(value: CharacterDefinition, currentHp: number): CharacterProgressV1 {
  return {
    characterId: value.id,
    recruited: true,
    level: 1,
    xp: 0,
    currentHp,
    skillPoints: 0,
    skillLevels: { [skillIds[1]]: 1, [skillIds[2]]: 0, [skillIds[3]]: 0, [skillIds[4]]: 0 },
    equippedActiveSkillIds: [skillIds[1], null],
    equipmentBySlot: { weapon: null, helmet: null, armor: null, gloves: null, boots: null, accessory: null },
    skillStoneInstanceId: null,
  };
}

function mapWithEncounter(encounterId: string, objectId = "encounter-object"): MapDefinition {
  return {
    id: "map_field_1",
    nameKey: "map.field",
    widthTiles: 10,
    heightTiles: 10,
    tileSize: 16,
    assetBundleId: "bundle_field",
    spawnPoint: { x: 1, y: 1 },
    groundLayer: [0],
    decorBackLayer: [0],
    decorFrontLayer: [0],
    collisionLayer: [0],
    objects: [{
      kind: "encounter",
      objectId,
      position: { x: 2, y: 2 },
      encounterId,
      behavior: { mode: "stationary", patrolPoints: [], wanderRadius: 0, detectionRadius: 1, leashRadius: 2, moveSpeed: 1 },
    }],
  };
}

function encounter(id: string, enemyIdsBySlot: Array<string | null>): EncounterDefinition {
  return {
    id,
    kind: "normal",
    fieldSpriteId: "encounter_sprite",
    enemyIdsBySlot,
    xpReward: 1,
    goldRewardMin: 0,
    goldRewardMax: 0,
    dropTableId: "drop_none",
    canRetreat: true,
    modifierIds: [],
  };
}

function makeInput(
  characterValues: CharacterDefinition[],
  enemyValues: EnemyDefinition[],
  encounterValue: EncounterDefinition,
  mapValue = mapWithEncounter(encounterValue.id),
): BattleFactoryInput {
  const characters = Object.fromEntries(characterValues.map((value, index) => [value.id, progress(value, 70 - index)]));
  const slots = [null, null, null, null] as BattleFactoryInput["party"]["slots"];
  characterValues.forEach((value, index) => { slots[index] = value.id; });
  return {
    battleId: "battle-1",
    expedition: {
      expeditionId: "expedition-1",
      expeditionSeed: 1,
      mode: "exploration",
      abyssEchoId: null,
      floorId: "floor-1",
      mapId: mapValue.id,
      playerPosition: { x: 2, y: 2 },
      safePosition: { x: 1, y: 1 },
      defeatedEncounterObjectIds: [],
      openedChestObjectIds: [],
      encounterProtectionStepsRemaining: 0,
      focusedEliteStoneConsumed: false,
      startedAt: "2026-01-01T00:00:00.000Z",
    },
    map: mapValue,
    encounter: encounterValue,
    encounterObject: mapValue.objects[0] as Extract<MapDefinition["objects"][number], { kind: "encounter" }>,
    party: { slots },
    characters,
    returnMapId: mapValue.id,
    returnSafePosition: { x: 1, y: 1 },
    comboIds: ["combo_alpha", "combo_beta"],
    rngState: [1, 2, 3, 4],
  };
}

function source(
  characters: CharacterDefinition[],
  enemies: EnemyDefinition[],
  encounterValue: EncounterDefinition,
  mapValue: MapDefinition,
): BattleContentSource {
  const characterById = new Map(characters.map((value) => [value.id, value]));
  const enemyById = new Map(enemies.map((value) => [value.id, value]));
  const skillById = new Map<string, SkillDefinition>(skillIds.map((id) => [id, skill(id)]));
  const fail = (path: string) => failure(createDomainError("INVALID_CONTENT", { path, issueKey: "missing_reference" }));
  return {
    getCharacter: (id) => characterById.get(id) ? success(characterById.get(id)!) : fail(`characters.${id}`),
    getSkill: (id) => skillById.get(id) ? success(skillById.get(id)!) : fail(`skills.${id}`),
    getEnemy: (id) => enemyById.get(id) ? success(enemyById.get(id)!) : fail(`enemies.${id}`),
    getEncounter: (id) => id === encounterValue.id ? success(encounterValue) : fail(`encounters.${id}`),
    getMap: (id) => id === mapValue.id ? success(mapValue) : fail(`maps.${id}`),
  };
}

function createOne(): { snapshot: BattleSnapshotV1; input: BattleFactoryInput; content: BattleContentSource } {
  const characters = [character("char_one", 60)];
  const enemies = [enemy("enemy_one", 60)];
  const encounterValue = encounter("encounter-1", ["enemy_one"]);
  const mapValue = mapWithEncounter(encounterValue.id);
  const input = makeInput(characters, enemies, encounterValue, mapValue);
  const result = createBattleSnapshot(source(characters, enemies, encounterValue, mapValue), input);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return { snapshot: result.value, input, content: source(characters, enemies, encounterValue, mapValue) };
}

describe("BattleFactory", () => {
  it("创建 1v1 严格初始快照，角色 HP 精确复制且敌人满血", () => {
    const { snapshot, input } = createOne();
    expect(snapshot.battleRevision).toBe(0);
    expect(snapshot.phase).toBe("INIT");
    expect(snapshot.outcome).toBe("ongoing");
    expect(snapshot.round).toBe(0);
    expect(snapshot.initiativeQueueUnitIds).toEqual([]);
    expect(snapshot.pendingEvents).toEqual([]);
    expect(snapshot.pendingBossIntents).toEqual([]);
    expect(snapshot.successfulItemUses).toBe(0);
    expect(snapshot.abyssEchoOutcome).toBe("notApplicable");
    expect(snapshot.reward).toBeNull();
    expect(snapshot.rngState).toEqual([1, 2, 3, 4]);
    expect(snapshot.metrics.comboTriggerCounts).toEqual({ combo_alpha: 0, combo_beta: 0 });
    expect(snapshot.units.map((unit) => [unit.unitId, unit.currentHp])).toEqual([["party:0", 70], ["enemy:0", 80]]);
    expect(snapshot.units[0].cooldowns).toEqual({ skill_basic: 0, skill_active_1: 0, skill_ultimate: 0 });
    expect(snapshot.units[1].cooldowns).toEqual({ skill_basic: 0 });
    expect(input.characters.char_one.currentHp).toBe(70);
  });

  it("支持 4v6，并拒绝重复遭遇对象、已击败对象和非法阵容", () => {
    const characters = [0, 1, 2, 3].map((index) => character(`char_${index}`, 50 + index));
    const enemies = [0, 1, 2, 3, 4, 5].map((index) => enemy(`enemy_${index}`, 40 + index));
    const encounterValue = encounter("encounter-4v6", enemies.map((value) => value.id));
    const mapValue = mapWithEncounter(encounterValue.id);
    const content = source(characters, enemies, encounterValue, mapValue);
    const input = makeInput(characters, enemies, encounterValue, mapValue);
    const result = new BattleFactory(content).create(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.units).toHaveLength(10);

    const duplicateMap = { ...mapValue, objects: [...mapValue.objects, mapValue.objects[0]] };
    const duplicate = createBattleSnapshot(content, { ...input, map: duplicateMap, expedition: { ...input.expedition, mapId: duplicateMap.id } });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });

    const defeated = createBattleSnapshot(content, { ...input, expedition: { ...input.expedition, defeatedEncounterObjectIds: ["encounter-object"] } });
    expect(defeated).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });

    const invalidParty = { ...input, party: { slots: [characters[0].id, characters[0].id, null, null] as BattleFactoryInput["party"]["slots"] } };
    expect(createBattleSnapshot(content, invalidParty)).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
  });
});
