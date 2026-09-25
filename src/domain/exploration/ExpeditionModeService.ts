import type {
  FloorDefinition,
  GameSaveV1,
  MapDefinition,
  MapObjectDefinition,
} from "../../content/contracts";
import type { IdFactory, SeedFactory } from "../common/DomainContext";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import { validatePartyForExpedition, type PartyContentSource } from "../party/PartyService";

export type ExpeditionStartMode = "exploration" | "shortFarm";

export interface ExpeditionModeContent extends PartyContentSource {
  getFloor(id: string): DomainResult<Readonly<FloorDefinition>>;
  getMap(id: string): DomainResult<Readonly<MapDefinition>>;
}

export interface ExpeditionModeServiceOptions {
  readonly content: ExpeditionModeContent;
  readonly idFactory: Pick<IdFactory, "next">;
  readonly seedFactory: Pick<SeedFactory, "nextUint32">;
  readonly now: () => string;
  /** exploration/shortFarm 的商店刷新由调用方注入，确保与存档候选同事务。 */
  readonly refreshShop?: (
    save: GameSaveV1,
    mode: ExpeditionStartMode,
    expeditionId: string,
  ) => DomainResult<GameSaveV1>;
}

export interface ExpeditionModeStartInput {
  readonly save: Readonly<GameSaveV1>;
  readonly floorId: string;
}

export interface ExpeditionModeStartResult {
  readonly save: GameSaveV1;
  readonly materializedObjectIds: readonly string[];
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function objectIdsInMap(map: Readonly<MapDefinition>): readonly string[] {
  return map.objects.map((object) => object.objectId);
}

function isEncounterOrChest(object: MapObjectDefinition): boolean {
  return object.kind === "encounter" || object.kind === "chest";
}

/**
 * 远征模式的纯候选构造器。
 *
 * 该服务只读取 FloorDefinition.shortRouteObjectIds，不从 objectId 后缀推断
 * 类型；保存、商店刷新和资源 prepare 由应用层在同一候选事务中编排。
 */
export class ExpeditionModeService {
  private readonly options: ExpeditionModeServiceOptions;

  public constructor(options: ExpeditionModeServiceOptions) {
    this.options = options;
  }

  public startShortFarm(input: ExpeditionModeStartInput): DomainResult<ExpeditionModeStartResult> {
    return this.start(input, "shortFarm");
  }

  public startExploration(input: ExpeditionModeStartInput): DomainResult<ExpeditionModeStartResult> {
    return this.start(input, "exploration");
  }

  private start(
    input: ExpeditionModeStartInput,
    mode: ExpeditionStartMode,
  ): DomainResult<ExpeditionModeStartResult> {
    const save = input.save;
    if (save.expedition !== null || save.battle !== null) {
      return failure(createDomainError("NOT_IN_TOWN", null));
    }
    if (save.inventory.overflowEquipment.length > 0 || save.inventory.overflowSkillStones.length > 0) {
      return failure(createDomainError("OVERFLOW_NOT_EMPTY", {
        count: save.inventory.overflowEquipment.length + save.inventory.overflowSkillStones.length,
      }));
    }

    const floorResult = this.options.content.getFloor(input.floorId);
    if (!floorResult.ok) return floorResult;
    const floor = floorResult.value;
    if (floor.floorNumber > save.world.highestUnlockedFloor) {
      return failure(createDomainError("FLOOR_LOCKED", { floorNumber: floor.floorNumber }));
    }
    const bossCleared = save.world.clearedBossEncounterIds.includes(floor.bossEncounterId);
    if (mode === "shortFarm" && !bossCleared) {
      return failure(createDomainError("EXPEDITION_MODE_LOCKED", {
        mode,
        floorId: floor.id,
        reason: "FLOOR_NOT_CLEARED",
      }));
    }

    const mapResult = this.options.content.getMap(floor.mapId);
    if (!mapResult.ok) return mapResult;
    const map = mapResult.value;
    const partyResult = validatePartyForExpedition(
      this.options.content,
      save.party,
      {
        protagonistCharacterId: save.skillStoneFocusCharacterId,
        characters: save.characters,
      },
    );
    if (!partyResult.ok) return partyResult;

    const materialized = this.resolveMaterializedObjects(floor, map, mode);
    if (!materialized.ok) return materialized;

    let nextSave = clone(save) as GameSaveV1;
    const expeditionId = this.options.idFactory.next("exp");
    nextSave.expedition = {
      expeditionId,
      expeditionSeed: this.options.seedFactory.nextUint32(),
      mode,
      abyssEchoId: null,
      floorId: floor.id,
      mapId: map.id,
      playerPosition: clone(map.spawnPoint),
      safePosition: clone(map.spawnPoint),
      defeatedEncounterObjectIds: [],
      openedChestObjectIds: [],
      encounterProtectionStepsRemaining: 0,
      focusedEliteStoneConsumed: false,
      startedAt: this.options.now(),
    };
    nextSave.revision = save.revision + 1;
    nextSave.updatedAt = nextSave.expedition.startedAt;

    if (this.options.refreshShop) {
      const refreshed = this.options.refreshShop(nextSave, mode, expeditionId);
      if (!refreshed.ok) return refreshed;
      nextSave = refreshed.value;
    }
    return success({ save: nextSave, materializedObjectIds: materialized.value });
  }

  private resolveMaterializedObjects(
    floor: Readonly<FloorDefinition>,
    map: Readonly<MapDefinition>,
    mode: ExpeditionStartMode,
  ): DomainResult<readonly string[]> {
    if (floor.mapId !== map.id) return invalid("floor.mapId", "map_mismatch");
    const allIds = objectIdsInMap(map);
    if (new Set(allIds).size !== allIds.length) return invalid("map.objects", "duplicate_object_id");
    const returnPortal = map.objects.find((object) => object.kind === "portal" && object.action.kind === "returnTown");
    if (!returnPortal) return invalid("map.objects", "return_portal_missing");

    if (mode === "exploration") {
      return success(Object.freeze([...allIds]));
    }

    const routeIds = floor.shortRouteObjectIds;
    if (new Set(routeIds).size !== routeIds.length) return invalid("floor.shortRouteObjectIds", "duplicate_object_id");
    if (routeIds.length !== 5) return invalid("floor.shortRouteObjectIds", "short_route_count");
    const routeSet = new Set(routeIds);
    const routeObjects: MapObjectDefinition[] = [];
    for (const objectId of routeIds) {
      const object = map.objects.find((candidate) => candidate.objectId === objectId);
      if (!object) return invalid(`floor.shortRouteObjectIds.${objectId}`, "unknown_object");
      if (!isEncounterOrChest(object)) return invalid(`floor.shortRouteObjectIds.${objectId}`, "unsupported_object");
      routeObjects.push(object);
    }
    if (routeObjects.filter((object) => object.kind === "encounter").length !== 4 || routeObjects.filter((object) => object.kind === "chest").length !== 1) {
      return invalid("floor.shortRouteObjectIds", "short_route_shape");
    }
    const bossInRoute = routeObjects.some((object) => object.kind === "encounter" && object.encounterId === floor.bossEncounterId);
    if (bossInRoute) return invalid("floor.shortRouteObjectIds", "boss_forbidden");

    // 按 MapDefinition 原顺序输出，避免短程完成后的存档数组出现不稳定顺序。
    const materialized = map.objects
      .filter((object) => routeSet.has(object.objectId) || object.objectId === returnPortal.objectId)
      .map((object) => object.objectId);
    if (materialized.length !== 6) return invalid("floor.shortRouteObjectIds", "return_portal_shape");
    return success(Object.freeze(materialized));
  }
}
