import { describe, expect, it, vi } from "vitest";
import { verticalSliceContentRoot } from "../../src/content/data/verticalSlice";
import type { FloorDefinition, GameSaveV1, MapDefinition } from "../../src/content/contracts";
import { SequentialIdFactory } from "../../src/domain/common/DomainContext";
import { success } from "../../src/domain/common/DomainResult";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { ExpeditionModeService, type ExpeditionModeContent } from "../../src/domain/exploration/ExpeditionModeService";

const timestamp = "2026-08-25T00:00:00.000Z";

function contentWith(
  floor: FloorDefinition = verticalSliceContentRoot.floors[0]!,
  map: MapDefinition = verticalSliceContentRoot.maps.find((value) => value.id === floor.mapId)!,
): ExpeditionModeContent {
  return {
    getCharacter: (id) => {
      const value = verticalSliceContentRoot.characters.find((candidate) => candidate.id === id);
      return value ? success(value) : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: "characters", issueKey: "missing" } } };
    },
    getFloor: (id) => id === floor.id ? success(floor) : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: "floors", issueKey: "missing" } } },
    getMap: (id) => id === map.id ? success(map) : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: "maps", issueKey: "missing" } } },
  };
}

function createService(
  overrides: Partial<ConstructorParameters<typeof ExpeditionModeService>[0]> = {},
): { service: ExpeditionModeService; save: GameSaveV1; refreshShop: ReturnType<typeof vi.fn> } {
  const save = createNewGameSave(verticalSliceContentRoot, timestamp, { newGameSeed: 7, idFactory: new SequentialIdFactory() });
  const refreshShop = vi.fn((next: GameSaveV1) => success(next));
  const service = new ExpeditionModeService({
    content: contentWith(),
    idFactory: new SequentialIdFactory(),
    seedFactory: { nextUint32: () => 1234 },
    now: () => timestamp,
    refreshShop,
    ...overrides,
  });
  return { service, save, refreshShop };
}

describe("ExpeditionModeService", () => {
  it("shortFarm 只物化冻结的 3 normal+1 elite+1 chest 与 return portal，不包含 Boss", () => {
    const harness = createService();
    harness.save.world.clearedBossEncounterIds.push("encounter_floor_01_boss");

    const result = harness.service.startShortFarm({ save: harness.save, floorId: "floor_01" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.materializedObjectIds).toEqual([
      "obj_f01_n01", "obj_f01_n02", "obj_f01_n03", "obj_f01_e01", "obj_f01_chest01", "obj_f01_return",
    ]);
    expect(result.value.materializedObjectIds).not.toContain("obj_f01_boss");
    expect(result.value.save.expedition?.mode).toBe("shortFarm");
    expect(result.value.save.expedition?.defeatedEncounterObjectIds).toEqual([]);
    expect(result.value.save.world.echoCharges).toBe(harness.save.world.echoCharges);
    expect(harness.refreshShop).toHaveBeenCalledWith(result.value.save, "shortFarm", "exp_test_000001");
  });

  it("未首通层拒绝 shortFarm，且不生成 ID/seed 或刷新商店", () => {
    const nextId = vi.fn(() => "exp_should_not_exist");
    const nextSeed = vi.fn(() => 1);
    const refreshShop = vi.fn((next: GameSaveV1) => success(next));
    const harness = createService({ idFactory: { next: nextId }, seedFactory: { nextUint32: nextSeed }, refreshShop });

    const result = harness.service.startShortFarm({ save: harness.save, floorId: "floor_01" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "EXPEDITION_MODE_LOCKED", details: { mode: "shortFarm", floorId: "floor_01", reason: "FLOOR_NOT_CLEARED" } });
    expect(nextId).not.toHaveBeenCalled();
    expect(nextSeed).not.toHaveBeenCalled();
    expect(refreshShop).not.toHaveBeenCalled();
  });

  it("exploration 保留完整地图对象，且不把 shortRoute 限制错误套用到完整远征", () => {
    const harness = createService();
    const result = harness.service.startExploration({ save: harness.save, floorId: "floor_01" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.materializedObjectIds).toEqual(verticalSliceContentRoot.maps.find((map) => map.id === "map_floor_01")!.objects.map((object) => object.objectId));
    expect(result.value.materializedObjectIds).toContain("obj_f01_boss");
    expect(result.value.save.expedition?.mode).toBe("exploration");
  });

  it("严格拒绝短程列表中的未知对象、Boss 或错误对象形状", () => {
    const baseFloor = verticalSliceContentRoot.floors[0]!;
    const baseMap = verticalSliceContentRoot.maps.find((value) => value.id === baseFloor.mapId)!;
    const invalidFloor = { ...baseFloor, shortRouteObjectIds: ["obj_f01_n01", "obj_f01_n02", "obj_f01_n03", "obj_f01_boss", "missing_object"] };
    const harness = createService({ content: contentWith(invalidFloor, baseMap) });
    harness.save.world.clearedBossEncounterIds.push("encounter_floor_01_boss");

    const result = harness.service.startShortFarm({ save: harness.save, floorId: invalidFloor.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_CONTENT");
  });

  it("全员倒地或溢出仓非空时不创建远征", () => {
    const defeated = createService();
    for (const character of Object.values(defeated.save.characters)) character.currentHp = 0;
    const defeatedResult = defeated.service.startExploration({ save: defeated.save, floorId: "floor_01" });
    expect(defeatedResult.ok).toBe(false);
    if (!defeatedResult.ok) expect(defeatedResult.error).toEqual({ code: "INVALID_PARTY", details: { reason: "ALL_DEFEATED", characterId: null } });

    const overflow = createService();
    overflow.save.inventory.overflowEquipment.push(structuredClone(overflow.save.inventory.equipment[0] ?? {
      instanceId: "eq_overflow", baseId: "eq_sword_t1_windblade", itemLevel: 1, quality: "common", craftGrade: "ordinary", affixes: [], abyssAffix: null, locked: false, acquiredAt: timestamp, sourceTransactionId: "tx", reforgeLockedIndex: null, reforgeCount: 0,
    }));
    const overflowResult = overflow.service.startExploration({ save: overflow.save, floorId: "floor_01" });
    expect(overflowResult.ok).toBe(false);
    if (!overflowResult.ok) expect(overflowResult.error.code).toBe("OVERFLOW_NOT_EMPTY");
  });
});
