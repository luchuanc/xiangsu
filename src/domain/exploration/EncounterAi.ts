import type { MapDefinition, Vector2 } from "../../content/contracts";
import { SeededRng } from "../common/SeededRng";
import {
  aabbIntersects,
  CollisionGrid,
  FOOT_AABB_HEIGHT,
  FOOT_AABB_WIDTH,
  TILE_SIZE,
} from "./CollisionGrid";
import {
  beginEncounterContact,
  decrementEncounterProtection,
  type ExplorationState,
  setPlayerPosition,
  setSafePosition,
} from "./ExplorationState";
import { movePlayer } from "./MovementSystem";

export const ENCOUNTER_IDLE_STEPS = 30;
export const ENCOUNTER_ALERT_STEPS = 18;
export const ENCOUNTER_WANDER_WAIT_STEPS = 60;
export const ENCOUNTER_LEASH_SNAP_DISTANCE = 1;

export type EncounterAiState = "IDLE" | "PATROL" | "WANDER" | "ALERT" | "CHASE" | "LEASH" | "CONTACT_LOCKED";

type EncounterObject = Extract<MapDefinition["objects"][number], { kind: "encounter" }>;

export interface EncounterRuntime {
  readonly objectId: string;
  readonly encounterId: string;
  readonly anchorPosition: Vector2;
  readonly position: Vector2;
  readonly behavior: EncounterObject["behavior"];
  readonly state: EncounterAiState;
  readonly idleStepsRemaining: number;
  readonly alertStepsElapsed: number;
  readonly patrolIndex: number;
  readonly patrolDirection: 1 | -1;
  readonly wanderTarget: Vector2 | null;
  readonly wanderWaitStepsRemaining: number;
  readonly rng: SeededRng;
}

export interface EncounterStepInput {
  readonly playerPosition: Vector2;
  readonly grid: CollisionGrid;
}

export interface EncounterContact {
  readonly objectId: string;
  readonly encounterId: string;
  readonly position: Vector2;
}

export interface ExplorationFrameInput extends EncounterStepInput {
  readonly state: ExplorationState;
  readonly runtimes: readonly EncounterRuntime[];
  /** 有此字段时严格按 MapDefinition.objects 的 encounter 顺序更新；缺省时沿用 runtimes 已建立的顺序。 */
  readonly mapObjects?: readonly MapDefinition["objects"][number][];
}

export interface ExplorationFrameResult {
  readonly state: ExplorationState;
  readonly runtimes: readonly EncounterRuntime[];
  readonly contact: EncounterContact | null;
  readonly protectedAtStepStart: boolean;
  readonly playerOverlapsEncounter: boolean;
}

function copyVector(value: Vector2): Vector2 {
  return Object.freeze({ x: value.x, y: value.y });
}

function distanceSquared(left: Vector2, right: Vector2): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

function distance(left: Vector2, right: Vector2): number {
  return Math.sqrt(distanceSquared(left, right));
}

function freezeBehavior(behavior: EncounterObject["behavior"]): EncounterObject["behavior"] {
  return Object.freeze({
    ...behavior,
    patrolPoints: Object.freeze(behavior.patrolPoints.map(copyVector)),
  }) as unknown as EncounterObject["behavior"];
}

function cloneRng(rng: SeededRng): SeededRng {
  return SeededRng.fromState(rng.stateSnapshot);
}

function freezeRuntime(value: {
  objectId: string;
  encounterId: string;
  anchorPosition: Vector2;
  position: Vector2;
  behavior: EncounterObject["behavior"];
  state: EncounterAiState;
  idleStepsRemaining: number;
  alertStepsElapsed: number;
  patrolIndex: number;
  patrolDirection: 1 | -1;
  wanderTarget: Vector2 | null;
  wanderWaitStepsRemaining: number;
  rng: SeededRng;
}): EncounterRuntime {
  return Object.freeze({
    objectId: value.objectId,
    encounterId: value.encounterId,
    anchorPosition: copyVector(value.anchorPosition),
    position: copyVector(value.position),
    behavior: freezeBehavior(value.behavior),
    state: value.state,
    idleStepsRemaining: value.idleStepsRemaining,
    alertStepsElapsed: value.alertStepsElapsed,
    patrolIndex: value.patrolIndex,
    patrolDirection: value.patrolDirection,
    wanderTarget: value.wanderTarget === null ? null : copyVector(value.wanderTarget),
    wanderWaitStepsRemaining: value.wanderWaitStepsRemaining,
    rng: cloneRng(value.rng),
  });
}

function modifyRuntime(runtime: EncounterRuntime, patch: Partial<{
  position: Vector2;
  state: EncounterAiState;
  idleStepsRemaining: number;
  alertStepsElapsed: number;
  patrolIndex: number;
  patrolDirection: 1 | -1;
  wanderTarget: Vector2 | null;
  wanderWaitStepsRemaining: number;
  rng: SeededRng;
}>): EncounterRuntime {
  return freezeRuntime({
    objectId: runtime.objectId,
    encounterId: runtime.encounterId,
    anchorPosition: runtime.anchorPosition,
    position: patch.position ?? runtime.position,
    behavior: runtime.behavior,
    state: patch.state ?? runtime.state,
    idleStepsRemaining: patch.idleStepsRemaining ?? runtime.idleStepsRemaining,
    alertStepsElapsed: patch.alertStepsElapsed ?? runtime.alertStepsElapsed,
    patrolIndex: patch.patrolIndex ?? runtime.patrolIndex,
    patrolDirection: patch.patrolDirection ?? runtime.patrolDirection,
    wanderTarget: patch.wanderTarget === undefined ? runtime.wanderTarget : patch.wanderTarget,
    wanderWaitStepsRemaining: patch.wanderWaitStepsRemaining ?? runtime.wanderWaitStepsRemaining,
    rng: patch.rng ?? runtime.rng,
  });
}

function assertBehavior(behavior: EncounterObject["behavior"]): void {
  if (!Number.isFinite(behavior.wanderRadius) || behavior.wanderRadius < 0) throw new RangeError("wanderRadius 必须为非负有限数");
  if (!Number.isFinite(behavior.detectionRadius) || behavior.detectionRadius < 0) throw new RangeError("detectionRadius 必须为非负有限数");
  if (!Number.isFinite(behavior.leashRadius) || behavior.leashRadius < 0) throw new RangeError("leashRadius 必须为非负有限数");
  if (!Number.isFinite(behavior.moveSpeed) || behavior.moveSpeed < 0) throw new RangeError("moveSpeed 必须为非负有限数");
  for (const point of behavior.patrolPoints) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new RangeError("patrolPoints 必须为有限坐标");
  }
}

/** 建立一个遭遇运行态；实际地图坐标和游荡 RNG 都不写入 ExpeditionSnapshot。 */
export function createEncounterRuntime(object: EncounterObject, rng: SeededRng): EncounterRuntime {
  assertBehavior(object.behavior);
  if (!(rng instanceof SeededRng)) throw new TypeError("encounter RNG 必须是 SeededRng");
  return freezeRuntime({
    objectId: object.objectId,
    encounterId: object.encounterId,
    anchorPosition: object.position,
    position: object.position,
    behavior: object.behavior,
    state: "IDLE",
    idleStepsRemaining: ENCOUNTER_IDLE_STEPS,
    alertStepsElapsed: 0,
    patrolIndex: 0,
    patrolDirection: 1,
    wanderTarget: null,
    wanderWaitStepsRemaining: 0,
    rng: rng.derive(`encounter:${object.objectId}`),
  });
}

export function createExplorationRuntime(
  objects: readonly MapDefinition["objects"][number][],
  rng: SeededRng,
): EncounterRuntime[] {
  if (!(rng instanceof SeededRng)) throw new TypeError("探索 RNG 必须是 SeededRng");
  return objects
    .filter((object): object is EncounterObject => object.kind === "encounter")
    .map((object) => createEncounterRuntime(object, rng));
}

function normalState(behavior: EncounterObject["behavior"]): EncounterAiState {
  if (behavior.mode === "patrol" && behavior.patrolPoints.length > 0) return "PATROL";
  if (behavior.mode === "wander") return "WANDER";
  return "IDLE";
}

function isInsideDetection(runtime: EncounterRuntime, playerPosition: Vector2): boolean {
  return distanceSquared(runtime.position, playerPosition) <= runtime.behavior.detectionRadius ** 2;
}

function hasLeashed(runtime: EncounterRuntime): boolean {
  // 0 是 Boss/定点对象的禁用值，不把其从出生点推出的瞬间误判为脱缰。
  return runtime.behavior.leashRadius > 0 && distanceSquared(runtime.position, runtime.anchorPosition) > runtime.behavior.leashRadius ** 2;
}

function moveTowards(runtime: EncounterRuntime, target: Vector2, grid: CollisionGrid): EncounterRuntime {
  const dx = target.x - runtime.position.x;
  const dy = target.y - runtime.position.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return runtime;
  const step = runtime.behavior.moveSpeed / 60;
  if (length <= step && !grid.isBlocked(target, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)) {
    return modifyRuntime(runtime, { position: target });
  }
  const moved = movePlayer(runtime.position, { x: dx / length, y: dy / length }, grid, runtime.behavior.moveSpeed);
  // movePlayer 使用固定步速度；当目标不足一个步长时，直接把目标作为无碰撞终点，避免在目标旁留下浮点残差。
  const candidate = moved.position;
  const next = distance(candidate, target) <= 1e-7 && !grid.isBlocked(target, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)
    ? target
    : candidate;
  return modifyRuntime(runtime, { position: next });
}

function patrolStep(runtime: EncounterRuntime, grid: CollisionGrid): EncounterRuntime {
  const points = runtime.behavior.patrolPoints;
  if (points.length === 0) return modifyRuntime(runtime, { state: "IDLE" });
  const index = Math.min(runtime.patrolIndex, points.length - 1);
  const target = points[index];
  const before = distance(runtime.position, target);
  const moved = moveTowards(runtime, target, grid);
  if (before <= runtime.behavior.moveSpeed / 60 || distance(moved.position, target) <= 1e-7) {
    const snapped = modifyRuntime(moved, { position: target });
    if (points.length === 1) return snapped;
    if (snapped.patrolDirection > 0) {
      return snapped.patrolIndex >= points.length - 1
        ? modifyRuntime(snapped, { patrolDirection: -1, patrolIndex: points.length - 2 })
        : modifyRuntime(snapped, { patrolIndex: snapped.patrolIndex + 1 });
    }
    return snapped.patrolIndex <= 0
      ? modifyRuntime(snapped, { patrolDirection: 1, patrolIndex: 1 })
      : modifyRuntime(snapped, { patrolIndex: snapped.patrolIndex - 1 });
  }
  return moved;
}

function wanderCandidates(runtime: EncounterRuntime, grid: CollisionGrid): Vector2[] {
  const radius = runtime.behavior.wanderRadius;
  const radiusSquared = radius * radius;
  const minTileX = Math.max(0, Math.floor((runtime.anchorPosition.x - radius) / TILE_SIZE));
  const maxTileX = Math.min(grid.widthTiles - 1, Math.floor((runtime.anchorPosition.x + radius) / TILE_SIZE));
  const minTileY = Math.max(0, Math.floor((runtime.anchorPosition.y - radius) / TILE_SIZE));
  const maxTileY = Math.min(grid.heightTiles - 1, Math.floor((runtime.anchorPosition.y + radius) / TILE_SIZE));
  const result: Vector2[] = [];
  // y 再 x 即 row-major；候选只取中心点在出生半径内且完整脚底盒可站立的 tile。
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const point = { x: (tileX + 0.5) * TILE_SIZE, y: (tileY + 0.5) * TILE_SIZE };
      if (distanceSquared(point, runtime.anchorPosition) > radiusSquared) continue;
      if (!grid.isWalkable(point, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)) continue;
      result.push(point);
    }
  }
  return result;
}

function chooseWanderTarget(runtime: EncounterRuntime, grid: CollisionGrid): EncounterRuntime {
  const candidates = wanderCandidates(runtime, grid);
  if (candidates.length === 0) return modifyRuntime(runtime, { wanderWaitStepsRemaining: ENCOUNTER_WANDER_WAIT_STEPS });
  const rng = cloneRng(runtime.rng);
  const target = rng.pickWeighted(candidates.map((value) => ({ value, weight: 1 })));
  return modifyRuntime(runtime, { wanderTarget: target, wanderWaitStepsRemaining: 0, rng });
}

function wanderStep(runtime: EncounterRuntime, grid: CollisionGrid): EncounterRuntime {
  if (runtime.wanderWaitStepsRemaining > 0) {
    return modifyRuntime(runtime, { wanderWaitStepsRemaining: runtime.wanderWaitStepsRemaining - 1 });
  }
  const withTarget = runtime.wanderTarget === null ? chooseWanderTarget(runtime, grid) : runtime;
  if (withTarget.wanderTarget === null) return withTarget;
  const target = withTarget.wanderTarget;
  const moved = moveTowards(withTarget, target, grid);
  if (distance(moved.position, target) <= 1e-7) {
    return modifyRuntime(moved, { position: target, wanderTarget: null, wanderWaitStepsRemaining: ENCOUNTER_WANDER_WAIT_STEPS });
  }
  return moved;
}

function enterAlert(runtime: EncounterRuntime): EncounterRuntime {
  return modifyRuntime(runtime, { state: "ALERT", alertStepsElapsed: 0 });
}

function returnToNormal(runtime: EncounterRuntime): EncounterRuntime {
  return modifyRuntime(runtime, {
    state: normalState(runtime.behavior),
    alertStepsElapsed: 0,
  });
}

function advanceSingleEncounter(runtime: EncounterRuntime, input: EncounterStepInput): EncounterRuntime {
  if (runtime.state === "CONTACT_LOCKED") return runtime;
  let current = runtime;

  if (current.state === "LEASH") {
    if (distance(current.position, current.anchorPosition) <= ENCOUNTER_LEASH_SNAP_DISTANCE) {
      return modifyRuntime(current, { position: current.anchorPosition, state: "IDLE", idleStepsRemaining: ENCOUNTER_IDLE_STEPS });
    }
    const moved = moveTowards(current, current.anchorPosition, input.grid);
    if (distance(moved.position, moved.anchorPosition) <= ENCOUNTER_LEASH_SNAP_DISTANCE) {
      return modifyRuntime(moved, { position: moved.anchorPosition, state: "IDLE", idleStepsRemaining: ENCOUNTER_IDLE_STEPS });
    }
    return moved;
  }

  if (current.state === "ALERT") {
    if (!isInsideDetection(current, input.playerPosition)) return returnToNormal(current);
    if (current.alertStepsElapsed >= ENCOUNTER_ALERT_STEPS) return modifyRuntime(current, { state: "CHASE", alertStepsElapsed: 0 });
    return modifyRuntime(current, { alertStepsElapsed: current.alertStepsElapsed + 1 });
  }

  if (current.state === "IDLE" && current.idleStepsRemaining > 0) {
    return modifyRuntime(current, { idleStepsRemaining: current.idleStepsRemaining - 1 });
  }

  if (isInsideDetection(current, input.playerPosition)) return enterAlert(current);

  if (current.state === "IDLE") {
    const behaviorState = normalState(current.behavior);
    if (behaviorState === "IDLE") return current;
    current = modifyRuntime(current, { state: behaviorState });
  }

  if (current.state === "PATROL") current = patrolStep(current, input.grid);
  else if (current.state === "WANDER") current = wanderStep(current, input.grid);
  else if (current.state === "CHASE") current = moveTowards(current, input.playerPosition, input.grid);

  if (current.state !== "LEASH" && hasLeashed(current)) return modifyRuntime(current, { state: "LEASH", alertStepsElapsed: 0 });
  return current;
}

function encounterBox(position: Vector2): { x: number; y: number; width: number; height: number } {
  return { x: position.x - FOOT_AABB_WIDTH / 2, y: position.y, width: FOOT_AABB_WIDTH, height: FOOT_AABB_HEIGHT };
}

function utf16Compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 单遭遇重载只推进 AI；带 state/runtimes 的重载按固定步顺序完成接触、安全点和保护计数。
 */
export function advanceEncounterFrame(runtime: EncounterRuntime, input: EncounterStepInput): EncounterRuntime;
export function advanceEncounterFrame(input: ExplorationFrameInput): ExplorationFrameResult;
export function advanceEncounterFrame(
  runtimeOrInput: EncounterRuntime | ExplorationFrameInput,
  maybeInput?: EncounterStepInput,
): EncounterRuntime | ExplorationFrameResult {
  if (maybeInput !== undefined) return advanceSingleEncounter(runtimeOrInput as EncounterRuntime, maybeInput);

  const input = runtimeOrInput as ExplorationFrameInput;
  const protectedAtStepStart = input.state.encounterProtectionStepsRemaining > 0;
  const defeated = new Set(input.state.defeatedEncounterObjectIds);
  const order = input.mapObjects
    ? new Map(input.mapObjects.map((object, index) => [object.objectId, index]))
    : null;
  const orderedRuntimes = order
    ? [...input.runtimes].sort((left, right) => (order.get(left.objectId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.objectId) ?? Number.MAX_SAFE_INTEGER))
    : [...input.runtimes];
  const runtimes = orderedRuntimes.map((runtime) => defeated.has(runtime.objectId) ? runtime : advanceSingleEncounter(runtime, input));
  const overlapCandidates = runtimes
    .filter((runtime) => !defeated.has(runtime.objectId) && aabbIntersects(encounterBox(input.playerPosition), encounterBox(runtime.position)))
    .sort((left, right) => utf16Compare(left.objectId, right.objectId));
  const playerOverlapsEncounter = overlapCandidates.length > 0;
  let state = setPlayerPosition(input.state, input.playerPosition);
  let contact: EncounterContact | null = null;
  if (!protectedAtStepStart && state.phase === "ACTIVE" && overlapCandidates.length > 0) {
    const selected = overlapCandidates[0];
    state = beginEncounterContact(state, selected.objectId);
    contact = Object.freeze({ objectId: selected.objectId, encounterId: selected.encounterId, position: copyVector(selected.position) });
  } else if (state.phase === "ACTIVE" && !playerOverlapsEncounter) {
    state = setSafePosition(state, input.playerPosition);
  }
  state = decrementEncounterProtection(state, protectedAtStepStart);
  return Object.freeze({
    state,
    runtimes: Object.freeze(runtimes),
    contact,
    protectedAtStepStart,
    playerOverlapsEncounter,
  });
}

export const advanceExplorationFrame = advanceEncounterFrame;
