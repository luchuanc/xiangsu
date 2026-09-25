import type { FloorDefinition, WorldProgressV1 } from "../../content/contracts";

export type FloorEntryMode = "exploration" | "shortFarm" | "bossRetry";
export interface FloorEntry {
  readonly floor: Readonly<FloorDefinition>;
  readonly modes: readonly FloorEntryMode[];
  readonly locked: boolean;
}

/** 楼层卡只展示/传递 FloorDefinition 字段，不从 ID suffix 推断规则。 */
export function buildFloorEntries(floors: readonly FloorDefinition[], world: Readonly<WorldProgressV1>): readonly FloorEntry[] {
  return floors.map((floor) => {
    const bossCleared = world.clearedBossEncounterIds.includes(floor.bossEncounterId);
    const contacted = world.bossRetryUnlockedFloorIds.includes(floor.id);
    const modes: FloorEntryMode[] = [];
    if (floor.floorNumber <= world.highestUnlockedFloor) {
      modes.push("exploration");
      if (bossCleared) modes.push("shortFarm");
      else if (contacted) modes.push("bossRetry");
    }
    return Object.freeze({ floor, modes: Object.freeze(modes), locked: modes.length === 0 });
  });
}

export class FloorSelectPanel {
  private entriesValue: readonly FloorEntry[] = [];
  public setEntries(entries: readonly FloorEntry[]): void { this.entriesValue = Object.freeze([...entries]); }
  public get entries(): readonly FloorEntry[] { return this.entriesValue; }
}
