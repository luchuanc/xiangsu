import { describe, expect, it } from "vitest";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { fixtureContentRoot } from "../../src/content/data";
import { npcs } from "../../src/content/data/npcs";
import { NpcService, resolveNpcRoute } from "../../src/domain/town/NpcService";

const content = { getNpc: (id: string) => { const npc = npcs.find((value) => value.id === id); return npc ? { ok: true as const, value: npc } : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: `npcs.${id}`, issueKey: "missing" } } }; } };
const state = (floor: number) => ({ world: { highestUnlockedFloor: floor, clearedBossEncounterIds: [], storyCompleted: floor >= 5 } });

describe("NpcService", () => {
  it("七类 function 按显式内容路由，名称不参与判断", () => {
    const service = new NpcService(content);
    for (const npc of npcs) {
      const result = service.resolve(npc.id, state(5));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.route.function).toBe(npc.function);
    }
  });

  it("守望者未到第五层返回固定锁定原因，达到后解锁", () => {
    const service = new NpcService(content);
    const locked = service.resolve("npc_abyss_watcher", state(4));
    expect(locked.ok).toBe(false);
    expect(locked.ok ? null : locked.error.code).toBe("NPC_LOCKED");
    if (!locked.ok && locked.error.code === "NPC_LOCKED") expect(locked.error.details.lockReasonKey).toBe("lock.abyss_watcher.floor_05");
    expect(service.resolve("npc_abyss_watcher", state(5)).ok).toBe(true);
  });

  it("未知 NPC、getter ID 不匹配和未知 function 均失败，不落默认页", () => {
    const service = new NpcService(content);
    expect(service.resolve("npc_missing", state(5)).ok).toBe(false);
    const mismatch = new NpcService({ getNpc: () => ({ ok: true as const, value: { ...npcs[0], id: "other" } }) });
    expect(mismatch.resolve(npcs[0].id, state(5)).ok).toBe(false);
    expect(resolveNpcRoute({ ...npcs[0], function: "notAFunction" as never }, state(5)).ok).toBe(false);
    expect(createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z").world.highestUnlockedFloor).toBe(1);
  });
});
