import type {
  AbyssEchoDefinition,
  ContentRootV1,
  EncounterDefinition,
  ExpeditionSnapshotV1,
  FloorDefinition,
  GameSaveV1,
  MapDefinition,
} from "../../content/contracts";
import type { IdFactory, SeedFactory } from "../common/DomainContext";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import { SeededRng } from "../common/SeededRng";
import { validatePartyForExpedition, type PartyContentSource } from "../party/PartyService";
import type { BattleFactoryInput } from "../battle/BattleTypes";

/** 守望者入口所需的显式内容 getter；不根据 ID 推断其它字段。 */
export interface AbyssEchoContent extends PartyContentSource {
  getAbyssEcho(id: string): DomainResult<Readonly<AbyssEchoDefinition>>;
  getFloor(id: string): DomainResult<Readonly<FloorDefinition>>;
  getMap(id: string): DomainResult<Readonly<MapDefinition>>;
  getEncounter(id: string): DomainResult<Readonly<EncounterDefinition>>;
  getRoot?(): Readonly<Pick<ContentRootV1, "combos">>;
}

export interface AbyssEchoServiceOptions {
  readonly content: AbyssEchoContent;
  readonly idFactory: Pick<IdFactory, "next">;
  readonly seedFactory: Pick<SeedFactory, "nextUint32">;
  readonly now: () => string;
}

export interface AbyssEchoStartInput {
  readonly save: Readonly<GameSaveV1>;
  readonly echoId: string;
}

export interface AbyssEchoBattleInput extends BattleFactoryInput {
  readonly echo: Readonly<AbyssEchoDefinition>;
}

export interface AbyssEchoStartResult {
  readonly save: GameSaveV1;
  readonly echo: Readonly<AbyssEchoDefinition>;
  readonly floor: Readonly<FloorDefinition>;
  readonly map: Readonly<MapDefinition>;
  readonly encounter: Readonly<EncounterDefinition>;
  readonly expedition: Readonly<ExpeditionSnapshotV1>;
  readonly battleInput: AbyssEchoBattleInput;
  readonly attemptNumber: number;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function getStrict<T extends { id: string }>(
  getter: (id: string) => DomainResult<Readonly<T>>,
  id: string,
  path: string,
): DomainResult<Readonly<T>> {
  try {
    const result = getter(id);
    if (!result.ok) return result;
    if (result.value.id !== id) return invalid(path, "id_mismatch");
    return result;
  } catch {
    return invalid(path, "getter_failed");
  }
}

function getTownMap(content: AbyssEchoContent): DomainResult<Readonly<MapDefinition>> {
  return getStrict(content.getMap.bind(content), "map_town", "maps.map_town");
}

/**
 * 只构造一次回响开始候选；保存提交与失败重试由应用层协调器负责。
 * 这里提前物化 battle 输入，保证保存失败不会重新分配 attempt、ID 或 seed。
 */
export class AbyssEchoService {
  private readonly options: AbyssEchoServiceOptions;

  public constructor(options: AbyssEchoServiceOptions) {
    this.options = options;
  }

  public prepareStart(input: AbyssEchoStartInput): DomainResult<AbyssEchoStartResult> {
    const save = input.save;
    if (save.expedition !== null || save.battle !== null) return failure(createDomainError("NOT_IN_TOWN", null));
    if (save.inventory.overflowEquipment.length > 0 || save.inventory.overflowSkillStones.length > 0) {
      return failure(createDomainError("OVERFLOW_NOT_EMPTY", {
        count: save.inventory.overflowEquipment.length + save.inventory.overflowSkillStones.length,
      }));
    }
    if (!save.world.storyCompleted) {
      return failure(createDomainError("ABYSS_ECHO_LOCKED", { echoId: input.echoId, reason: "STORY_NOT_COMPLETED" }));
    }
    if (!Number.isSafeInteger(save.world.echoCharges) || save.world.echoCharges < 1) {
      return failure(createDomainError("ABYSS_ECHO_LOCKED", { echoId: input.echoId, reason: "NO_CHARGE" }));
    }
    if (!Number.isSafeInteger(save.world.echoAttemptSequence) || save.world.echoAttemptSequence >= Number.MAX_SAFE_INTEGER) {
      return invalid("world.echoAttemptSequence", "range");
    }

    const echoResult = getStrict(this.options.content.getAbyssEcho.bind(this.options.content), input.echoId, `abyssEchoes.${input.echoId}`);
    if (!echoResult.ok) return echoResult;
    const echo = echoResult.value;
    const floorResult = getStrict(this.options.content.getFloor.bind(this.options.content), echo.floorId, `floors.${echo.floorId}`);
    if (!floorResult.ok) return floorResult;
    const floor = floorResult.value;
    if (!floor.isAbyss || floor.floorNumber < 6 || floor.floorNumber > 10 || floor.bossEncounterId !== echo.bossEncounterId) {
      return invalid(`abyssEchoes.${echo.id}`, "floor_boss_mismatch");
    }
    if (floor.floorNumber > save.world.highestUnlockedFloor) {
      return failure(createDomainError("FLOOR_LOCKED", { floorNumber: floor.floorNumber }));
    }
    const mapResult = getStrict(this.options.content.getMap.bind(this.options.content), floor.mapId, `maps.${floor.mapId}`);
    if (!mapResult.ok) return mapResult;
    const map = mapResult.value;
    const townResult = getTownMap(this.options.content);
    if (!townResult.ok) return townResult;
    const encounterResult = getStrict(this.options.content.getEncounter.bind(this.options.content), echo.bossEncounterId, `encounters.${echo.bossEncounterId}`);
    if (!encounterResult.ok) return encounterResult;
    const encounter = encounterResult.value;
    if (encounter.kind !== "boss" || encounter.id !== floor.bossEncounterId) return invalid(`encounters.${encounter.id}`, "boss_required");

    const partyResult = validatePartyForExpedition(this.options.content, save.party, {
      protagonistCharacterId: save.skillStoneFocusCharacterId,
      characters: save.characters,
    });
    if (!partyResult.ok) return partyResult;

    const startedAt = this.options.now();
    const attemptNumber = save.world.echoAttemptSequence + 1;
    const expedition: ExpeditionSnapshotV1 = {
      expeditionId: this.options.idFactory.next("exp"),
      expeditionSeed: this.options.seedFactory.nextUint32(),
      mode: "abyssEcho",
      abyssEchoId: echo.id,
      floorId: floor.id,
      mapId: map.id,
      playerPosition: clone(map.spawnPoint),
      safePosition: clone(map.spawnPoint),
      defeatedEncounterObjectIds: [],
      openedChestObjectIds: [],
      encounterProtectionStepsRemaining: 0,
      focusedEliteStoneConsumed: false,
      startedAt,
    };
    // 回响没有地图上的 encounter object；空 objectId 是 GameSave 的严格契约。
    const encounterObject = {
      kind: "encounter" as const,
      objectId: "",
      position: clone(map.spawnPoint),
      encounterId: encounter.id,
      behavior: { mode: "stationary" as const, patrolPoints: [], wanderRadius: 0, detectionRadius: 0, leashRadius: 0, moveSpeed: 0 },
    };
    let comboIds: string[] = [];
    if (this.options.content.getRoot) {
      try {
        comboIds = this.options.content.getRoot().combos.map((combo) => combo.id);
      } catch {
        return invalid("combos", "getter_failed");
      }
    }
    const battleInput: AbyssEchoBattleInput = {
      battleId: this.options.idFactory.next("battle"),
      expedition,
      map,
      encounter,
      encounterObject,
      party: partyResult.value,
      characters: clone(save.characters),
      returnMapId: "map_town",
      returnSafePosition: clone(townResult.value.spawnPoint),
      comboIds,
      // 随机流命名空间固定到回响与尝试号；战斗流只从该根流派生，重试不会重抽。
      rngState: SeededRng.fromSeed(expedition.expeditionSeed)
        .derive(`echo:${echo.id}:attempt:${attemptNumber}`)
        .derive("battle")
        .getState(),
      echo,
    };
    const nextSave = clone(save) as GameSaveV1;
    nextSave.world.echoCharges -= 1;
    nextSave.world.echoAttemptSequence = attemptNumber;
    nextSave.expedition = clone(expedition);
    nextSave.revision = save.revision + 1;
    nextSave.updatedAt = startedAt;
    return success({ save: nextSave, echo, floor, map, encounter, expedition, battleInput, attemptNumber });
  }
}
