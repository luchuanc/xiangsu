import type { ExpeditionSnapshotV1, MapDefinition, Vector2 } from "../../content/contracts";

/** 探索领域固定步的两个可持久化运行阶段。 */
export type ExplorationPhase = "ACTIVE" | "CONTACT_LOCKED";

export const MAX_ENCOUNTER_PROTECTION_STEPS = 180;

export interface ExplorationState {
  readonly mapId: string;
  readonly phase: ExplorationPhase;
  readonly playerPosition: Vector2;
  readonly safePosition: Vector2;
  readonly defeatedEncounterObjectIds: readonly string[];
  readonly encounterProtectionStepsRemaining: number;
  /** 同一固定步只允许这一只遭遇进入转场；未锁定时为 null。 */
  readonly contactObjectId: string | null;
}

export interface ExplorationStatePatch {
  readonly phase?: ExplorationPhase;
  readonly playerPosition?: Vector2;
  readonly safePosition?: Vector2;
  readonly defeatedEncounterObjectIds?: readonly string[];
  readonly encounterProtectionStepsRemaining?: number;
  readonly contactObjectId?: string | null;
}

type ExplorationInitial = Partial<Pick<
  ExplorationState,
  "phase" | "playerPosition" | "safePosition" | "defeatedEncounterObjectIds" | "encounterProtectionStepsRemaining" | "contactObjectId"
>> & Partial<Pick<ExpeditionSnapshotV1, "playerPosition" | "safePosition" | "defeatedEncounterObjectIds" | "encounterProtectionStepsRemaining">>;

function assertFiniteVector(value: Vector2, name: string): void {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new RangeError(`${name} 必须是有限坐标`);
  }
}

function copyVector(value: Vector2, name: string): Vector2 {
  assertFiniteVector(value, name);
  return Object.freeze({ x: value.x, y: value.y });
}

function encounterIdsInMapOrder(map: Readonly<Pick<MapDefinition, "objects">>, requested: readonly string[]): string[] {
  const wanted = new Set(requested);
  return map.objects
    .filter((object): object is Extract<MapDefinition["objects"][number], { kind: "encounter" }> => object.kind === "encounter")
    .filter((object) => wanted.has(object.objectId))
    .map((object) => object.objectId);
}

function normalizeProtection(value: number | undefined): number {
  const next = value ?? 0;
  if (!Number.isSafeInteger(next) || next < 0 || next > MAX_ENCOUNTER_PROTECTION_STEPS) {
    throw new RangeError(`encounterProtectionStepsRemaining 必须位于 0～${MAX_ENCOUNTER_PROTECTION_STEPS}`);
  }
  return next;
}

function freezeState(value: {
  mapId: string;
  phase: ExplorationPhase;
  playerPosition: Vector2;
  safePosition: Vector2;
  defeatedEncounterObjectIds: readonly string[];
  encounterProtectionStepsRemaining: number;
  contactObjectId: string | null;
}): ExplorationState {
  return Object.freeze({
    mapId: value.mapId,
    phase: value.phase,
    playerPosition: copyVector(value.playerPosition, "playerPosition"),
    safePosition: copyVector(value.safePosition, "safePosition"),
    defeatedEncounterObjectIds: Object.freeze([...value.defeatedEncounterObjectIds]),
    encounterProtectionStepsRemaining: normalizeProtection(value.encounterProtectionStepsRemaining),
    contactObjectId: value.contactObjectId,
  });
}

/**
 * 建立探索快照的不可变领域副本。
 * 存档数组可能来自外部对象，创建时按地图对象顺序去重，避免把不属于本图的 ID 带入运行态。
 */
export function createExplorationState(
  map: Readonly<Pick<MapDefinition, "id" | "spawnPoint" | "objects">>,
  initial: ExplorationInitial = {},
): ExplorationState {
  const initialPlayer = initial.playerPosition ?? map.spawnPoint;
  const initialSafe = initial.safePosition ?? initialPlayer;
  const defeated = encounterIdsInMapOrder(map, initial.defeatedEncounterObjectIds ?? []);
  const phase = initial.phase ?? "ACTIVE";
  const contactObjectId = initial.contactObjectId ?? null;
  if (phase === "ACTIVE" && contactObjectId !== null) throw new RangeError("ACTIVE 探索态不能带 contactObjectId");
  if (phase === "CONTACT_LOCKED" && contactObjectId === null) throw new RangeError("CONTACT_LOCKED 必须带 contactObjectId");
  return freezeState({
    mapId: map.id,
    phase,
    playerPosition: initialPlayer,
    safePosition: initialSafe,
    defeatedEncounterObjectIds: defeated,
    encounterProtectionStepsRemaining: initial.encounterProtectionStepsRemaining ?? 0,
    contactObjectId,
  });
}

/** 只复制显式 patch；输入与输出均不共享可变数组/坐标引用。 */
export function updateExplorationState(state: ExplorationState, patch: ExplorationStatePatch): ExplorationState {
  const phase = patch.phase ?? state.phase;
  const contactObjectId = patch.contactObjectId === undefined ? state.contactObjectId : patch.contactObjectId;
  if (phase === "ACTIVE" && contactObjectId !== null) throw new RangeError("ACTIVE 探索态不能带 contactObjectId");
  if (phase === "CONTACT_LOCKED" && contactObjectId === null) throw new RangeError("CONTACT_LOCKED 必须带 contactObjectId");
  return freezeState({
    mapId: state.mapId,
    phase,
    playerPosition: patch.playerPosition ?? state.playerPosition,
    safePosition: patch.safePosition ?? state.safePosition,
    defeatedEncounterObjectIds: patch.defeatedEncounterObjectIds ?? state.defeatedEncounterObjectIds,
    encounterProtectionStepsRemaining: patch.encounterProtectionStepsRemaining ?? state.encounterProtectionStepsRemaining,
    contactObjectId,
  });
}

export function setPlayerPosition(state: ExplorationState, playerPosition: Vector2): ExplorationState {
  return updateExplorationState(state, { playerPosition });
}

export function setSafePosition(state: ExplorationState, safePosition: Vector2): ExplorationState {
  if (state.phase === "CONTACT_LOCKED") return state;
  return updateExplorationState(state, { safePosition });
}

export function setEncounterProtection(state: ExplorationState, steps: number): ExplorationState {
  return updateExplorationState(state, { encounterProtectionStepsRemaining: steps });
}

/** 在一个固定步末尾递减保护；调用方传入本步开始值，确保第 181 步才可接触。 */
export function decrementEncounterProtection(state: ExplorationState, wasProtectedAtStepStart: boolean): ExplorationState {
  if (!wasProtectedAtStepStart || state.encounterProtectionStepsRemaining <= 0) return state;
  return setEncounterProtection(state, state.encounterProtectionStepsRemaining - 1);
}

export function beginEncounterContact(state: ExplorationState, objectId: string): ExplorationState {
  if (state.phase === "CONTACT_LOCKED") return state;
  return updateExplorationState(state, { phase: "CONTACT_LOCKED", contactObjectId: objectId });
}

export function clearEncounterContact(state: ExplorationState): ExplorationState {
  if (state.phase === "ACTIVE" && state.contactObjectId === null) return state;
  return updateExplorationState(state, { phase: "ACTIVE", contactObjectId: null });
}

export function isEncounterDefeated(state: ExplorationState, objectId: string): boolean {
  return state.defeatedEncounterObjectIds.includes(objectId);
}

/** 战斗胜利移除遭遇并解除本图 CONTACT_LOCKED；重复结算保持幂等。 */
export function markEncounterDefeated(
  state: ExplorationState,
  map: Readonly<Pick<MapDefinition, "objects">>,
  objectId: string,
): ExplorationState {
  const encounter = map.objects.find((object): object is Extract<MapDefinition["objects"][number], { kind: "encounter" }> => object.kind === "encounter" && object.objectId === objectId);
  if (!encounter) throw new RangeError(`未知遭遇对象: ${objectId}`);
  const defeated = encounterIdsInMapOrder(map, [...state.defeatedEncounterObjectIds, objectId]);
  return updateExplorationState(state, {
    phase: "ACTIVE",
    contactObjectId: null,
    defeatedEncounterObjectIds: defeated,
  });
}

/** 仅用于转场/读档的稳定序列化视图。 */
export interface ExplorationSnapshotView {
  readonly playerPosition: Vector2;
  readonly safePosition: Vector2;
  readonly defeatedEncounterObjectIds: readonly string[];
  readonly encounterProtectionStepsRemaining: number;
}

export function toExplorationSnapshot(state: ExplorationState): ExplorationSnapshotView {
  return Object.freeze({
    playerPosition: copyVector(state.playerPosition, "playerPosition"),
    safePosition: copyVector(state.safePosition, "safePosition"),
    defeatedEncounterObjectIds: Object.freeze([...state.defeatedEncounterObjectIds]),
    encounterProtectionStepsRemaining: state.encounterProtectionStepsRemaining,
  });
}
