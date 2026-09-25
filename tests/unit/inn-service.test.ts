import { describe, expect, it } from "vitest";
import { fixtureContentRoot } from "../../src/content/data";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { InnService } from "../../src/domain/town/InnService";

const service = new InnService({ getCharacter: (id) => { const value = fixtureContentRoot.characters.find((character) => character.id === id); return value ? { ok: true as const, value } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: id, issueKey: "missing" } } }; } });

describe("InnService", () => {
  it("免费恢复队伍全员，已满生命重复点击为幂等 no-op", () => {
    const save = createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z");
    save.characters.char_wanderer.currentHp = 1;
    const healed = service.rest(save);
    expect(healed.ok).toBe(true);
    if (!healed.ok) return;
    expect(healed.value.changed).toBe(true);
    expect(healed.value.save.characters.char_wanderer.currentHp).toBeGreaterThan(1);
    const repeated = service.rest(healed.value.save);
    expect(repeated.ok).toBe(true);
    if (repeated.ok) expect(repeated.value.changed).toBe(false);
    expect(save.characters.char_wanderer.currentHp).toBe(1);
  });

  it("野外或战斗中不允许调用旅店", () => {
    const save = createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z");
    save.expedition = { expeditionId: "exp", expeditionSeed: 1, mode: "exploration", abyssEchoId: null, floorId: "floor_01", mapId: "map_floor_01", playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: "2026-01-01T00:00:00.000Z" };
    const result = service.rest(save);
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("NOT_IN_TOWN");
  });
});
