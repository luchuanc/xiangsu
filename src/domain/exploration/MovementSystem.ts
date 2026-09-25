import type { InputSnapshot, InputVector } from "../../app/input/InputState";
import type { Vector2 } from "../../content/contracts";
import { CollisionGrid, FOOT_AABB_HEIGHT, FOOT_AABB_WIDTH } from "./CollisionGrid";

export const FIXED_LOGIC_HZ = 60;
export const FIXED_STEP_SECONDS = 1 / FIXED_LOGIC_HZ;
export const PLAYER_SPEED_PX_PER_SECOND = 72;
export const PLAYER_SPEED_PER_STEP = PLAYER_SPEED_PX_PER_SECOND * FIXED_STEP_SECONDS;
export const MAX_AXIS_SWEEP_PER_STEP = 4;

export interface MovementResult {
  readonly position: Vector2;
  readonly moved: Vector2;
  readonly blockedX: boolean;
  readonly blockedY: boolean;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalized(direction: InputVector): InputVector {
  const x = finite(direction.x);
  const y = finite(direction.y);
  // InputState 已负责对角线归一化；领域层仍保留每轴的有限值，便于只读测试快照
  // 和已经归一化但长度不等于 1 的方向（例如 {x:1,y:0.2}）按合同计算。
  return { x, y };
}

function sweepAxis(
  position: Vector2,
  axis: "x" | "y",
  distance: number,
  grid: CollisionGrid,
): { position: Vector2; blocked: boolean } {
  if (distance === 0) return { position, blocked: false };
  const target = { ...position, [axis]: position[axis] + distance };
  if (!grid.isBlocked(target, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)) return { position: target, blocked: false };

  // 轴向位移每步不超过 4px，但仍用二分求出贴墙位置，避免固定步与墙边产生穿透。
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const middle = (low + high) / 2;
    const candidate = { ...position, [axis]: position[axis] + distance * middle };
    if (grid.isBlocked(candidate, FOOT_AABB_WIDTH, FOOT_AABB_HEIGHT)) high = middle;
    else low = middle;
  }
  const resolved = { ...position, [axis]: position[axis] + distance * low };
  return { position: resolved, blocked: true };
}

/**
 * 固定步的分轴位移上限是契约的一部分，而不是仅供调用方参考的常量。
 * 自定义速度用于遭遇或测试时也必须经过同一上限，避免一次查询跨过一整块碰撞格。
 */
function cappedAxisDistance(distance: number): number {
  if (distance > MAX_AXIS_SWEEP_PER_STEP) return MAX_AXIS_SWEEP_PER_STEP;
  if (distance < -MAX_AXIS_SWEEP_PER_STEP) return -MAX_AXIS_SWEEP_PER_STEP;
  return distance;
}

/** 执行一个固定逻辑步；不会把真实帧 delta 传入领域移动。 */
export function movePlayer(
  position: Vector2,
  direction: InputVector | InputSnapshot,
  grid: CollisionGrid,
  speedPerSecond = PLAYER_SPEED_PX_PER_SECOND,
): MovementResult {
  const move = "move" in direction ? direction.move : direction;
  const unit = normalized(move);
  const speed = finite(speedPerSecond);
  if (speed < 0) throw new RangeError("移动速度不能为负数");
  const totalX = cappedAxisDistance(unit.x * speed * FIXED_STEP_SECONDS);
  const totalY = cappedAxisDistance(unit.y * speed * FIXED_STEP_SECONDS);
  const axisFirst: "x" | "y" = Math.abs(totalX) >= Math.abs(totalY) ? "x" : "y";
  const axisSecond: "x" | "y" = axisFirst === "x" ? "y" : "x";
  const first = sweepAxis(position, axisFirst, totalX === 0 && axisFirst === "x" ? 0 : axisFirst === "x" ? totalX : totalY, grid);
  const second = sweepAxis(first.position, axisSecond, axisSecond === "x" ? totalX : totalY, grid);
  return {
    position: second.position,
    moved: { x: second.position.x - position.x, y: second.position.y - position.y },
    blockedX: axisFirst === "x" ? first.blocked : second.blocked,
    blockedY: axisFirst === "y" ? first.blocked : second.blocked,
  };
}

export function movePlayerFixedSteps(
  position: Vector2,
  direction: InputVector | InputSnapshot,
  grid: CollisionGrid,
  steps: number,
  speedPerSecond = PLAYER_SPEED_PX_PER_SECOND,
): Vector2 {
  if (!Number.isSafeInteger(steps) || steps < 0) throw new RangeError("fixed steps 必须是非负整数");
  let current = { ...position };
  for (let step = 0; step < steps; step += 1) current = movePlayer(current, direction, grid, speedPerSecond).position;
  return current;
}

/** Scene 后续可持有的无状态适配器；每次调用仍只消费一个输入快照。 */
export class MovementSystem {
  public constructor(
    private readonly grid: CollisionGrid,
    private readonly speedPerSecond = PLAYER_SPEED_PX_PER_SECOND,
  ) {}

  public step(position: Vector2, input: InputVector | InputSnapshot): MovementResult {
    return movePlayer(position, input, this.grid, this.speedPerSecond);
  }
}
