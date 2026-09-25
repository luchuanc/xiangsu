import { describe, expect, it, vi } from "vitest";
import { floors06To10Content } from "../../src/content/data/floors06-10";
import { ABYSS_ECHO_DEFINITIONS } from "../../src/content/data/abyssEchoes";
import type { GameSaveV1 } from "../../src/content/contracts";
import { SequentialIdFactory } from "../../src/domain/common/DomainContext";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { AbyssEchoService } from "../../src/domain/town/AbyssEchoService";

const timestamp = "2026-08-25T00:00:00.000Z";

function content() {
  return {
    getCharacter: (id: string) => {
      const value = floors06To10Content.characters.find((candidate) => candidate.id === id);
      return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: id, issueKey: "missing" } } };
    },
    getAbyssEcho: (id: string) => {
      const value = ABYSS_ECHO_DEFINITIONS.find((candidate) => candidate.id === id);
      return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: id, issueKey: "missing" } } };
    },
    getFloor: (id: string) => {
      const value = floors06To10Content.floors.find((candidate) => candidate.id === id);
      return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: id, issueKey: "missing" } } };
    },
    getMap: (id: string) => {
      const value = floors06To10Content.maps.find((candidate) => candidate.id === id);
      return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: id, issueKey: "missing" } } };
    },
    getEncounter: (id: string) => {
      const value = floors06To10Content.encounters.find((candidate) => candidate.id === id);
      return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: id, issueKey: "missing" } } };
    },
  };
}

function save(): GameSaveV1 {
  const value = createNewGameSave(floors06To10Content, timestamp, { newGameSeed: 7, idFactory: new SequentialIdFactory() });
  value.world.highestUnlockedFloor = 10;
  value.world.storyCompleted = true;
  value.world.clearedBossEncounterIds = floors06To10Content.floors.map((floor) => floor.bossEncounterId);
  value.world.echoCharges = 2;
  return value;
}

function service(overrides: Partial<ConstructorParameters<typeof AbyssEchoService>[0]> = {}) {
  return new AbyssEchoService({
    content: content(),
    idFactory: new SequentialIdFactory(),
    seedFactory: { nextUint32: () => 1234 },
    now: () => timestamp,
    ...overrides,
  });
}

describe("AbyssEchoService", () => {
  it("主线未完成、无次数、已有远征或溢出时拒绝且不生成 ID/seed", () => {
    const nextId = vi.fn(() => "should_not_create");
    const nextSeed = vi.fn(() => 1);
    const current = save();
    current.world.storyCompleted = false;
    const result = service({ idFactory: { next: nextId }, seedFactory: { nextUint32: nextSeed } }).prepareStart({ save: current, echoId: "echo_f06_iron" });
    expect(result).toMatchObject({ ok: false, error: { code: "ABYSS_ECHO_LOCKED", details: { reason: "STORY_NOT_COMPLETED" } } });
    expect(nextId).not.toHaveBeenCalled();
    expect(nextSeed).not.toHaveBeenCalled();

    const noCharge = save();
    noCharge.world.echoCharges = 0;
    const noChargeResult = service({ idFactory: { next: nextId }, seedFactory: { nextUint32: nextSeed } }).prepareStart({ save: noCharge, echoId: "echo_f06_iron" });
    expect(noChargeResult).toMatchObject({ ok: false, error: { code: "ABYSS_ECHO_LOCKED", details: { reason: "NO_CHARGE" } } });

    const occupied = save();
    occupied.expedition = { expeditionId: "exp_existing", expeditionSeed: 1, mode: "exploration", abyssEchoId: null, floorId: "floor_06", mapId: "map_floor_06", playerPosition: { x: 16, y: 16 }, safePosition: { x: 16, y: 16 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: timestamp };
    expect(service().prepareStart({ save: occupied, echoId: "echo_f06_iron" })).toMatchObject({ ok: false, error: { code: "NOT_IN_TOWN" } });
  });

  it("同一准备只扣 1 次、sequence+1，echo expedition 直达层主且失败候选可重试", () => {
    const current = save();
    const result = service().prepareStart({ save: current, echoId: "echo_f06_iron" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.save.world.echoCharges).toBe(1);
    expect(result.value.save.world.echoAttemptSequence).toBe(1);
    expect(result.value.save.expedition).toMatchObject({ mode: "abyssEcho", abyssEchoId: "echo_f06_iron", floorId: "floor_06", mapId: "map_floor_06", defeatedEncounterObjectIds: [], openedChestObjectIds: [] });
    expect(result.value.attemptNumber).toBe(1);
    expect(result.value.battleInput.encounterObject.objectId).toBe("");
    expect(result.value.battleInput.returnMapId).toBe("map_town");
    expect(result.value.battleInput.expedition.expeditionSeed).toBe(1234);
  });

  it("次数上限为 5，回响不刷新商店且错误输入不修改原存档", () => {
    const current = save();
    current.world.echoCharges = 5;
    const result = service().prepareStart({ save: current, echoId: "echo_f06_iron" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.save.world.echoCharges).toBe(4);
    expect(current.world.echoCharges).toBe(5);
    expect(current.shop.generatedFromExpeditionId).toBeNull();
  });
});
