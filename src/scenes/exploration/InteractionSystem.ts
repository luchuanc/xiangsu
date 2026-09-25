import type { MapDefinition, Vector2 } from "../../content/contracts";

/** 野外交互按钮只暴露内容契约明确的四种动作。 */
export type InteractionAction = "talk" | "openChest" | "openFloorSelect" | "returnTown";

export type InteractableObject = Extract<MapDefinition["objects"][number], { kind: "npc" | "chest" | "portal" }>;

export interface InteractionTarget {
  readonly object: InteractableObject;
  readonly action: InteractionAction;
  readonly distanceSquared: number;
}

export interface InteractionResult {
  readonly target: InteractionTarget | null;
  readonly enabled: boolean;
}

export interface InteractionInput {
  readonly playerPosition: Vector2;
  readonly objects: readonly MapDefinition["objects"][number][];
  readonly openedChestObjectIds: readonly string[];
  readonly radius?: number;
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} 必须是有限数字`);
}

function distanceSquared(left: Vector2, right: Vector2): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

function utf16Compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function actionFor(object: InteractableObject): InteractionAction {
  if (object.kind === "npc") return "talk";
  if (object.kind === "chest") return "openChest";
  return object.action.kind;
}

/**
 * 计算一个固定交互候选；不读取 encounter，也不根据 kind 猜测资源或动作。
 * 候选排序先比较距离平方，再按 UTF-16 objectId，确保同帧结果稳定。
 */
export function selectInteraction(input: InteractionInput): InteractionResult {
  const radius = input.radius ?? 28;
  finite(input.playerPosition.x, "playerPosition.x");
  finite(input.playerPosition.y, "playerPosition.y");
  finite(radius, "radius");
  if (radius < 0) throw new RangeError("交互半径不能为负数");
  const opened = new Set(input.openedChestObjectIds);
  const candidates: InteractionTarget[] = [];
  for (const object of input.objects) {
    if (object.kind === "encounter") continue;
    if (object.kind === "chest" && opened.has(object.objectId)) continue;
    const nextDistanceSquared = distanceSquared(input.playerPosition, object.position);
    if (nextDistanceSquared > radius * radius) continue;
    candidates.push({ object, action: actionFor(object), distanceSquared: nextDistanceSquared });
  }
  candidates.sort((left, right) => left.distanceSquared - right.distanceSquared || utf16Compare(left.object.objectId, right.object.objectId));
  const target = candidates[0] ?? null;
  return Object.freeze({ target, enabled: target !== null });
}

/** 场景持有的无状态适配器，避免把交互判断散落在 Pixi 事件回调里。 */
export class InteractionSystem {
  public constructor(private readonly radius = 28) {
    finite(radius, "radius");
    if (radius < 0) throw new RangeError("交互半径不能为负数");
  }

  public select(input: Omit<InteractionInput, "radius">): InteractionResult {
    return selectInteraction({ ...input, radius: this.radius });
  }
}
