import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import mapArtGolden from "../../art/visual/v1/map-art.golden.json";
import { ContentCatalog, FROZEN_BATCH_MANIFESTS, validateBatchManifest } from "../../src/content/Catalog";
import { buildMapBlueprint, collisionHash } from "../../src/content/builders/mapBlueprint";
import { buildMapVisualLayers } from "../../src/content/builders/mapVisualLayers";
import { verticalSliceAssetManifest } from "../../src/content/data/assets.manifest";
import { verticalSliceContentRoot } from "../../src/content/data/verticalSlice";
import { floor01Map } from "../../src/content/data/maps/floor01";
import { townMap } from "../../src/content/data/maps/town";

const expectedIds = FROZEN_BATCH_MANIFESTS.verticalSlice;

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function ids(values: readonly { id: string }[]): string[] {
  return values.map((value) => value.id);
}

function reachableMapObjectIds(map: typeof townMap): Set<string> {
  const width = map.widthTiles;
  const height = map.heightTiles;
  const startX = Math.floor(map.spawnPoint.x / map.tileSize);
  const startY = Math.floor(map.spawnPoint.y / map.tileSize);
  const queue = [[startX, startY] as const];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const key = `${x},${y}`;
    if (visited.has(key) || x < 0 || y < 0 || x >= width || y >= height || map.collisionLayer[y * width + x] !== 0) continue;
    visited.add(key);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return new Set(map.objects.filter((object) => visited.has(`${Math.floor(object.position.x / map.tileSize)},${Math.floor(object.position.y / map.tileSize)}`)).map((object) => object.objectId));
}

describe("RPG-022 第一层垂直切片内容", () => {
  it("先锁定 verticalSlice 的每个集合必须严格匹配冻结 ID", () => {
    const issue = validateBatchManifest(verticalSliceContentRoot, "verticalSlice");
    expect(issue).toBeNull();
    for (const [collection, expected] of Object.entries(expectedIds)) {
      expect(ids(verticalSliceContentRoot[collection as keyof typeof expectedIds] as readonly { id: string }[])).toEqual(expected);
    }
  });

  it("Catalog batch 校验、引用和两张地图碰撞快照必须通过", () => {
    const result = ContentCatalog.create(verticalSliceContentRoot, { kind: "batch", batchId: "verticalSlice" });
    expect(result.ok).toBe(true);
    expect(townMap.collisionLayer.filter((tile) => tile === 0)).toHaveLength(3266);
    expect(floor01Map.collisionLayer.filter((tile) => tile === 0)).toHaveLength(1073);
    expect(collisionHash(townMap.collisionLayer)).toBe("bf421d7a56f0afb60dfb2a5c72f3ccf5233d2d540a11bde32fe1ea748a7754de");
    expect(collisionHash(floor01Map.collisionLayer)).toBe("dbb7994555dda3ef12fa669075d86a62630ca7d9b85cbf43b3eccf259ebd81c0");
    const townVisual = buildMapVisualLayers(buildMapBlueprint("map_town"));
    const floorVisual = buildMapVisualLayers(buildMapBlueprint("map_floor_01"));
    expect(townVisual.groundLayer.some((tile) => tile >= 16)).toBe(true);
    expect(floorVisual.groundLayer.some((tile) => tile >= 16)).toBe(true);
    expect(townMap.collisionLayer.filter((tile) => tile === 0)).toHaveLength(3266);
    expect(floor01Map.collisionLayer.filter((tile) => tile === 0)).toHaveLength(1073);
  });

  it("冻结两张地图的出生点、对象 canonical JSON 与三层视觉 hash", () => {
    expect(townMap.spawnPoint).toEqual({ x: 640, y: 800 });
    expect(floor01Map.spawnPoint).toEqual({ x: 96, y: 896 });
    expect(sha256(JSON.stringify(townMap.objects))).toBe("d54bd0dd340d49482f82aaa782bbbb2e266cc325c9cbd3285925729b4f6f75ed");
    expect(sha256(JSON.stringify(floor01Map.objects))).toBe("0fa6b8690eee6745a2783d105efe960f1796a2ffb6c3e872e761ae91bdd9a8de");
    expect(sha256(JSON.stringify({ groundLayer: townMap.groundLayer, decorBackLayer: townMap.decorBackLayer, decorFrontLayer: townMap.decorFrontLayer }))).toBe(mapArtGolden.visualLayers.map_town.sha256);
    expect(sha256(JSON.stringify({ groundLayer: floor01Map.groundLayer, decorBackLayer: floor01Map.decorBackLayer, decorFrontLayer: floor01Map.decorFrontLayer }))).toBe(mapArtGolden.visualLayers.map_floor_01.sha256);
  });

  it("城镇功能入口、第一层遭遇和 Boss 接触位均可达", () => {
    const townReachable = reachableMapObjectIds(townMap);
    expect(townReachable).toEqual(new Set(townMap.objects.map((object) => object.objectId)));
    const floorReachable = reachableMapObjectIds(floor01Map);
    expect(floorReachable).toEqual(new Set(floor01Map.objects.map((object) => object.objectId)));
    expect(floor01Map.objects.find((object) => object.objectId === "obj_f01_boss")?.kind).toBe("encounter");
    expect(verticalSliceContentRoot.floors[0]).toMatchObject({
      id: "floor_01",
      mapId: "map_floor_01",
      bossEncounterId: "encounter_floor_01_boss",
      recommendedBossLevel: 4,
      recommendedItemLevel: 3,
      bossEnrageRound: 12,
      bossPhaseThresholdBps: [5000],
      shortRouteObjectIds: ["obj_f01_n01", "obj_f01_n02", "obj_f01_n03", "obj_f01_e01", "obj_f01_chest01"],
    });
  });

  it("第一层固定词条、技能词条、Combo 和 encounter modifier 不得漂移", () => {
    expect(ids(verticalSliceContentRoot.equipmentAffixes)).toEqual([
      "af_vitality", "af_might", "af_guard", "af_haste", "af_precision", "af_flame", "af_frost", "af_bleed_edge", "af_bulwark", "af_counterweight", "af_pursuit", "af_searing_edge",
    ]);
    expect(ids(verticalSliceContentRoot.skillAffixes)).toEqual([
      "sa_ember_focus", "sa_ember_echo", "sa_guard_ripple", "sa_bleed_doublecut", "sa_heal_overflow", "sa_execution_focus", "sa_fortress_focus", "sa_priest_mend_focus",
    ]);
    expect(ids(verticalSliceContentRoot.combos)).toEqual(["combo_ember_chain", "combo_iron_reprise", "combo_blood_hunt", "combo_holy_bulwark"]);
    expect(verticalSliceContentRoot.encounterModifiers.map((modifier) => modifier.id)).toEqual(["modifier_assault", "modifier_swift", "modifier_bulwark", "modifier_mire"]);
    expect(verticalSliceContentRoot.bossIntents.map((intent) => intent.id)).toEqual(["intent_horned_charge"]);
  });

  it("第一层合法池必须闭合，不能只满足集合数量", () => {
    const skillIds = new Set(verticalSliceContentRoot.skills.map((skill) => skill.id));
    const characterIds = new Set(verticalSliceContentRoot.characters.map((character) => character.id));
    const enemyIds = new Set(verticalSliceContentRoot.enemies.map((enemy) => enemy.id));
    const statusIds = new Set(verticalSliceContentRoot.statuses.map((status) => status.id));
    const modifierIds = new Set(verticalSliceContentRoot.encounterModifiers.map((modifier) => modifier.id));
    const dropTableIds = new Set(verticalSliceContentRoot.dropTables.map((table) => table.id));

    for (const character of verticalSliceContentRoot.characters) {
      expect(skillIds.has(character.basicSkillId)).toBe(true);
      expect(character.activeSkillIds.every((skillId) => skillIds.has(skillId))).toBe(true);
      expect(skillIds.has(character.ultimateSkillId)).toBe(true);
      expect(skillIds.has(character.passiveSkillId)).toBe(true);
    }
    for (const skill of verticalSliceContentRoot.skills) {
      if (skill.owner.kind === "character") expect(characterIds.has(skill.owner.characterId)).toBe(true);
      if (skill.owner.kind === "enemy") expect(enemyIds.has(skill.owner.enemyId)).toBe(true);
      for (const effectLevels of skill.effectsByLevel) {
        for (const effect of effectLevels) {
          if (effect.kind === "applyStatus" || effect.kind === "shield" || effect.kind === "consumeStatus") expect(statusIds.has(effect.statusId)).toBe(true);
        }
      }
    }
    for (const encounter of verticalSliceContentRoot.encounters) {
      expect(encounter.enemyIdsBySlot).toHaveLength(6);
      expect(encounter.enemyIdsBySlot.filter((enemyId): enemyId is string => enemyId !== null).every((enemyId) => enemyIds.has(enemyId))).toBe(true);
      expect(encounter.modifierIds.every((modifierId) => modifierIds.has(modifierId))).toBe(true);
      expect(dropTableIds.has(encounter.dropTableId)).toBe(true);
    }
    const elite = verticalSliceContentRoot.dropTables.find((table) => table.id === "drop_floor_01_elite");
    expect(elite?.rolls.some((roll) => roll.kind === "skillStone" && roll.guaranteedMinQuality === "rare" && roll.itemLevelMin === 3 && roll.itemLevelMax === 3)).toBe(true);
    const boss = verticalSliceContentRoot.encounters.find((encounter) => encounter.id === "encounter_floor_01_boss");
    expect(boss).toMatchObject({ kind: "boss", canRetreat: false, modifierIds: [] });
  });

  it("垂直切片资源 manifest 必须覆盖地图、角色、遭遇和战斗系统资源", () => {
    const idsInManifest = new Set(verticalSliceAssetManifest.assets.map((asset) => asset.id));
    expect(verticalSliceAssetManifest.contentVersion).toBe("content-1.2.0");
    expect(verticalSliceAssetManifest.assets).toHaveLength(90);
    for (const character of verticalSliceContentRoot.characters) {
      expect(idsInManifest.has(`sprite_field_${character.id}`)).toBe(true);
      expect(idsInManifest.has(`sprite_battle_${character.id}`)).toBe(true);
    }
    for (const encounter of verticalSliceContentRoot.encounters) expect(idsInManifest.has(encounter.fieldSpriteId)).toBe(true);
    for (const npc of verticalSliceContentRoot.npcs) expect(idsInManifest.has(npc.spriteId)).toBe(true);
    for (const base of verticalSliceContentRoot.equipmentBases) expect(idsInManifest.has(base.spriteId)).toBe(true);
    for (const enemy of verticalSliceContentRoot.enemies) expect(idsInManifest.has(`sprite_battle_${enemy.id}`)).toBe(true);
    expect(idsInManifest.has("tileset_map_town")).toBe(true);
    expect(idsInManifest.has("tileset_map_floor_01")).toBe(true);
    expect(idsInManifest.has("atlas_core_ui")).toBe(true);
    expect(idsInManifest.has("atlas_battle_fx")).toBe(true);
    expect(idsInManifest.has("font_pixel_zh_cn")).toBe(true);
  });
});
