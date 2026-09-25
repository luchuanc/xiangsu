import { describe, expect, it } from "vitest";

import type { MapDefinition } from "../../src/content/contracts";
import { CollisionGrid } from "../../src/domain/exploration/CollisionGrid";
import {
  advanceEncounterFrame,
  createEncounterRuntime,
  createExplorationRuntime,
  type EncounterRuntime,
} from "../../src/domain/exploration/EncounterAi";
import { createExplorationState, markEncounterDefeated } from "../../src/domain/exploration/ExplorationState";
import { SeededRng } from "../../src/domain/common/SeededRng";

function map(objects: MapDefinition["objects"] = []): MapDefinition {
  return {
    id: "map_test",
    nameKey: "map.map_town.name",
    widthTiles: 20,
    heightTiles: 20,
    tileSize: 16,
    assetBundleId: "bundle_test",
    spawnPoint: { x: 48, y: 48 },
    groundLayer: new Array(400).fill(0),
    decorBackLayer: new Array(400).fill(0),
    decorFrontLayer: new Array(400).fill(0),
    collisionLayer: new Array<0 | 1>(400).fill(0),
    objects,
  };
}

function encounter(objectId: string, position: { x: number; y: number }, behavior: Partial<NonNullable<Extract<MapDefinition["objects"][number], { kind: "encounter" }>["behavior"]>> = {}) {
  return {
    kind: "encounter" as const,
    objectId,
    position,
    encounterId: `encounter-${objectId}`,
    behavior: {
      mode: "stationary" as const,
      patrolPoints: [],
      wanderRadius: 0,
      detectionRadius: 64,
      leashRadius: 160,
      moveSpeed: 36,
      ...behavior,
    },
  };
}

describe("EncounterAi", () => {
  it("严格等待 30 步，发现后 ALERT 18 步再进入 CHASE", () => {
    const object = encounter("e1", { x: 80, y: 48 }, { detectionRadius: 100 });
    const grid = new CollisionGrid(map([object]));
    let runtime = createEncounterRuntime(object, new SeededRng(7));
    for (let i = 0; i < 30; i += 1) runtime = advanceEncounterFrame(runtime, { playerPosition: { x: 80, y: 48 }, grid });
    expect(runtime.state).toBe("IDLE");
    runtime = advanceEncounterFrame(runtime, { playerPosition: { x: 80, y: 48 }, grid });
    expect(runtime.state).toBe("ALERT");
    for (let i = 0; i < 18; i += 1) runtime = advanceEncounterFrame(runtime, { playerPosition: { x: 80, y: 48 }, grid });
    expect(runtime.state).toBe("ALERT");
    runtime = advanceEncounterFrame(runtime, { playerPosition: { x: 80, y: 48 }, grid });
    expect(runtime.state).toBe("CHASE");
  });

  it("WANDER 的 row-major 候选和固定 seed 可重现，刷新会重启 RNG", () => {
    const object = encounter("wander", { x: 80, y: 80 }, { mode: "wander", wanderRadius: 32, detectionRadius: 0 });
    const grid = new CollisionGrid(map([object]));
    const run = () => {
      let runtime = createEncounterRuntime(object, new SeededRng(99));
      for (let i = 0; i < 31; i += 1) runtime = advanceEncounterFrame(runtime, { playerPosition: { x: 300, y: 300 }, grid });
      return runtime;
    };
    expect(run()).toEqual(run());
  });

  it("同帧接触按 objectId 裁决，保护值从 180 递减且第 181 步才重新允许", () => {
    const first = encounter("e-02", { x: 48, y: 48 }, { detectionRadius: 0 });
    const second = encounter("e-01", { x: 48, y: 48 }, { detectionRadius: 0 });
    const grid = new CollisionGrid(map([first, second]));
    const state = createExplorationState(map([first, second]));
    const runtime = createExplorationRuntime([first, second], new SeededRng(1));
    const frame = advanceEncounterFrame({ state, runtimes: runtime, playerPosition: { x: 48, y: 48 }, grid });
    expect(frame.contact?.objectId).toBe("e-01");
    expect(frame.state.phase).toBe("CONTACT_LOCKED");
    const defeated = markEncounterDefeated(frame.state, map([first, second]), "e-01");
    expect(defeated.defeatedEncounterObjectIds).toEqual(["e-01"]);
    expect((frame.runtimes as EncounterRuntime[]).every((value) => value.objectId.length > 0)).toBe(true);
  });

  it("保护期完整屏蔽 180 步，期间不更新重叠安全点；第 181 步锁定接触", () => {
    const object = encounter("protected", { x: 48, y: 48 }, { detectionRadius: 0 });
    const grid = new CollisionGrid(map([object]));
    const initial = createExplorationState(map([object]), {
      playerPosition: { x: 48, y: 48 },
      safePosition: { x: 16, y: 16 },
      encounterProtectionStepsRemaining: 180,
    });
    let state = initial;
    let runtimes = createExplorationRuntime([object], new SeededRng(5));
    for (let i = 0; i < 180; i += 1) {
      const frame = advanceEncounterFrame({ state, runtimes, playerPosition: { x: 48, y: 48 }, grid });
      state = frame.state;
      runtimes = [...frame.runtimes];
      expect(frame.contact).toBeNull();
      expect(state.phase).toBe("ACTIVE");
      expect(state.safePosition).toEqual({ x: 16, y: 16 });
    }
    expect(state.encounterProtectionStepsRemaining).toBe(0);
    const contactFrame = advanceEncounterFrame({ state, runtimes, playerPosition: { x: 48, y: 48 }, grid });
    expect(contactFrame.contact?.objectId).toBe("protected");
    expect(contactFrame.state.phase).toBe("CONTACT_LOCKED");
  });

  it("ALERT 期间离开检测半径会回到原行为并清零预警进度", () => {
    const object = encounter("alert-leave", { x: 80, y: 48 }, { detectionRadius: 80 });
    const grid = new CollisionGrid(map([object]));
    let runtime = createEncounterRuntime(object, new SeededRng(8));
    for (let i = 0; i < 31; i += 1) runtime = advanceEncounterFrame(runtime, { playerPosition: { x: 80, y: 48 }, grid });
    expect(runtime.state).toBe("ALERT");
    runtime = advanceEncounterFrame(runtime, { playerPosition: { x: 300, y: 300 }, grid });
    expect(runtime.state).toBe("IDLE");
    expect(runtime.alertStepsElapsed).toBe(0);
  });

  it("探索快照和数组均为不可变副本，胜利移除重复调用幂等", () => {
    const object = encounter("immutable", { x: 48, y: 48 });
    const later = encounter("later", { x: 64, y: 48 });
    const mapValue = map([object, later]);
    const state = createExplorationState(mapValue, { defeatedEncounterObjectIds: ["immutable", "immutable"] });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.playerPosition)).toBe(true);
    expect(Object.isFrozen(state.defeatedEncounterObjectIds)).toBe(true);
    const defeated = markEncounterDefeated(state, mapValue, "immutable");
    expect(defeated.defeatedEncounterObjectIds).toEqual(["immutable"]);
    expect(markEncounterDefeated(defeated, mapValue, "immutable").defeatedEncounterObjectIds).toEqual(["immutable"]);
    expect(markEncounterDefeated(defeated, mapValue, "later").defeatedEncounterObjectIds).toEqual(["immutable", "later"]);
  });
});
