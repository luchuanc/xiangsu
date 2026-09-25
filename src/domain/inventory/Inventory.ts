/**
 * 背包容量和奖励接收领域逻辑。
 *
 * 装备、铭石使用实例槽；堆叠物使用单物品总量上限，同时保留 99
 * 的视觉堆上限。奖励接收先做完整 dry-run，再一次性返回新快照，
 * 因此不会出现只收进一半奖励的中间状态。
 */
import type {
  EquipmentInstance,
  InstanceId,
  InventoryStateV1,
  ItemId,
  RewardTransactionV1,
  SkillStoneInstance,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";

export const EQUIPMENT_CAPACITY = 120;
export const SKILL_STONE_CAPACITY = 80;
export const OVERFLOW_CAPACITY = 30;
export const VISUAL_STACK_CAPACITY = 99;
export const STACKABLE_TOTAL_CAPACITY = 9_999;

export interface InventoryReceiveInput {
  readonly equipment: readonly EquipmentInstance[];
  readonly skillStones: readonly SkillStoneInstance[];
  readonly stackables: Readonly<Record<ItemId, number>>;
  /** 所有实例必须按该序列接收，不能按分类重新排序。 */
  readonly instanceOrder: readonly InstanceId[];
}

export interface InventoryPlacement {
  readonly instanceId: InstanceId;
  readonly kind: "equipment" | "skillStone";
  readonly destination: "equipment" | "skillStone" | "overflowEquipment" | "overflowSkillStone";
}

export interface InventoryDryRun {
  readonly inventory: InventoryStateV1;
  readonly placements: readonly InventoryPlacement[];
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function inventoryFull(
  kind: "equipment" | "skillStone" | "overflow",
  requiredSlots: number,
  availableSlots: number,
): DomainResult<never> {
  return failure(createDomainError("INVENTORY_FULL", { kind, requiredSlots, availableSlots }));
}

function stackableCapExceeded(
  itemId: ItemId,
  owned: number,
  requested: number,
): DomainResult<never> {
  return failure(createDomainError("STACKABLE_CAP_EXCEEDED", {
    itemId,
    cap: STACKABLE_TOTAL_CAPACITY,
    owned,
    requested,
  }));
}

function validateInventoryShape(inventory: InventoryStateV1): DomainResult<true> {
  if (!isRecord(inventory)) return invalid("inventory", "not_object");
  for (const key of ["equipment", "skillStones", "overflowEquipment", "overflowSkillStones"] as const) {
    if (!Array.isArray(inventory[key])) return invalid(`inventory.${key}`, "array_required");
  }
  if (!isRecord(inventory.stackables)) return invalid("inventory.stackables", "object_required");
  if (inventory.equipment.length > EQUIPMENT_CAPACITY) return inventoryFull("equipment", inventory.equipment.length, EQUIPMENT_CAPACITY);
  if (inventory.skillStones.length > SKILL_STONE_CAPACITY) return inventoryFull("skillStone", inventory.skillStones.length, SKILL_STONE_CAPACITY);
  const overflowCount = inventory.overflowEquipment.length + inventory.overflowSkillStones.length;
  if (overflowCount > OVERFLOW_CAPACITY) return inventoryFull("overflow", overflowCount, OVERFLOW_CAPACITY);

  const ids = new Set<string>();
  for (const [kind, values] of [
    ["equipment", inventory.equipment],
    ["skillStone", inventory.skillStones],
    ["overflowEquipment", inventory.overflowEquipment],
    ["overflowSkillStone", inventory.overflowSkillStones],
  ] as const) {
    for (const value of values) {
      if (!isRecord(value) || typeof value.instanceId !== "string" || value.instanceId.length === 0) {
        return invalid(`inventory.${kind}`, "instance_shape");
      }
      if (ids.has(value.instanceId)) return invalid(`inventory.${kind}`, "duplicate_instance_id");
      ids.add(value.instanceId);
    }
  }
  for (const [itemId, quantity] of Object.entries(inventory.stackables)) {
    if (!Number.isSafeInteger(quantity) || quantity < 0) return invalid(`inventory.stackables.${itemId}`, "quantity_range");
    if (quantity > STACKABLE_TOTAL_CAPACITY) return stackableCapExceeded(itemId, quantity, 0);
  }
  return success(true);
}

function normalizeInput(input: InventoryReceiveInput): DomainResult<InventoryReceiveInput> {
  if (!isRecord(input)) return invalid("receive", "not_object");
  for (const key of ["equipment", "skillStones", "instanceOrder"] as const) {
    if (!Array.isArray(input[key])) return invalid(`receive.${key}`, "array_required");
  }
  if (!isRecord(input.stackables)) return invalid("receive.stackables", "object_required");
  const incoming = [...input.equipment, ...input.skillStones];
  const incomingIds = new Set<string>();
  for (const instance of incoming) {
    if (!isRecord(instance) || typeof instance.instanceId !== "string" || instance.instanceId.length === 0) {
      return invalid("receive.instances", "instance_shape");
    }
    if (incomingIds.has(instance.instanceId)) return invalid("receive.instances", "duplicate_instance_id");
    incomingIds.add(instance.instanceId);
  }
  if (input.instanceOrder.length !== incoming.length) return invalid("receive.instanceOrder", "instance_order_set");
  const orderIds = new Set<string>();
  for (const instanceId of input.instanceOrder) {
    if (typeof instanceId !== "string" || instanceId.length === 0 || orderIds.has(instanceId) || !incomingIds.has(instanceId)) {
      return invalid("receive.instanceOrder", "instance_order_set");
    }
    orderIds.add(instanceId);
  }
  for (const [itemId, quantity] of Object.entries(input.stackables)) {
    if (!Number.isSafeInteger(quantity) || quantity < 0) return invalid(`receive.stackables.${itemId}`, "quantity_range");
  }
  return success(input);
}

function receiveInputFromReward(reward: RewardTransactionV1): DomainResult<InventoryReceiveInput> {
  if (!isRecord(reward)) return invalid("reward", "not_object");
  return normalizeInput({
    equipment: reward.equipment,
    skillStones: reward.skillStones,
    stackables: reward.stackables,
    instanceOrder: reward.instanceOrder,
  });
}

/** 计算一个堆叠总量对应的视觉堆数量，单堆不会超过 99。 */
export function visualStackCount(quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError("堆叠数量必须是非负整数");
  return Math.ceil(quantity / VISUAL_STACK_CAPACITY);
}

export function getStackableTotal(inventory: InventoryStateV1, itemId: ItemId): number {
  return inventory.stackables[itemId] ?? 0;
}

/**
 * 只做容量和总量 dry-run。返回值及其中的 placements 都是新对象，
 * 调用方可以在保存前继续组合经验、金币等其它奖励字段。
 */
export function dryRunReceive(
  inventory: InventoryStateV1,
  input: InventoryReceiveInput,
): DomainResult<InventoryDryRun> {
  const shape = validateInventoryShape(inventory);
  if (!shape.ok) return shape;
  const normalized = normalizeInput(input);
  if (!normalized.ok) return normalized;

  const currentIds = new Set<string>([
    ...inventory.equipment,
    ...inventory.skillStones,
    ...inventory.overflowEquipment,
    ...inventory.overflowSkillStones,
  ].map((instance) => instance.instanceId));
  for (const instance of [...input.equipment, ...input.skillStones]) {
    if (currentIds.has(instance.instanceId)) return invalid(`receive.${instance.instanceId}`, "duplicate_existing_instance_id");
  }

  const next = clone(inventory);
  const placements: InventoryPlacement[] = [];
  const equipmentById = new Map(input.equipment.map((instance) => [instance.instanceId, instance]));
  const skillStoneById = new Map(input.skillStones.map((instance) => [instance.instanceId, instance]));
  let equipmentAvailable = EQUIPMENT_CAPACITY - next.equipment.length;
  let skillStoneAvailable = SKILL_STONE_CAPACITY - next.skillStones.length;
  let overflowAvailable = OVERFLOW_CAPACITY - next.overflowEquipment.length - next.overflowSkillStones.length;

  // 严格按 instanceOrder 分配；同一份奖励不能因分类顺序不同而改变结果。
  for (const instanceId of input.instanceOrder) {
    const equipment = equipmentById.get(instanceId);
    const skillStone = skillStoneById.get(instanceId);
    if (equipment) {
      if (equipmentAvailable > 0) {
        next.equipment.push(clone(equipment));
        equipmentAvailable -= 1;
        placements.push({ instanceId, kind: "equipment", destination: "equipment" });
      } else if (overflowAvailable > 0) {
        next.overflowEquipment.push(clone(equipment));
        overflowAvailable -= 1;
        placements.push({ instanceId, kind: "equipment", destination: "overflowEquipment" });
      } else {
        return inventoryFull("overflow", 1, overflowAvailable);
      }
    } else if (skillStone) {
      if (skillStoneAvailable > 0) {
        next.skillStones.push(clone(skillStone));
        skillStoneAvailable -= 1;
        placements.push({ instanceId, kind: "skillStone", destination: "skillStone" });
      } else if (overflowAvailable > 0) {
        next.overflowSkillStones.push(clone(skillStone));
        overflowAvailable -= 1;
        placements.push({ instanceId, kind: "skillStone", destination: "overflowSkillStone" });
      } else {
        return inventoryFull("overflow", 1, overflowAvailable);
      }
    } else {
      return invalid(`receive.instanceOrder.${instanceId}`, "unknown_instance");
    }
  }

  for (const [itemId, requested] of Object.entries(input.stackables)) {
    const owned = next.stackables[itemId] ?? 0;
    if (owned > STACKABLE_TOTAL_CAPACITY - requested) return stackableCapExceeded(itemId, owned, requested);
    next.stackables[itemId] = owned + requested;
  }

  return success({ inventory: next, placements });
}

/** 以相同 dry-run 规则接收一整笔奖励。 */
export function receiveReward(
  inventory: InventoryStateV1,
  reward: RewardTransactionV1,
): DomainResult<InventoryDryRun> {
  const input = receiveInputFromReward(reward);
  if (!input.ok) return input;
  return dryRunReceive(inventory, input.value);
}

/** 便于其它领域服务传入不含完整 RewardTransaction 的实例集合。 */
export function receiveInventory(
  inventory: InventoryStateV1,
  input: InventoryReceiveInput,
): DomainResult<InventoryStateV1> {
  const result = dryRunReceive(inventory, input);
  return result.ok ? success(result.value.inventory) : result;
}

export class Inventory {
  public static readonly equipmentCapacity = EQUIPMENT_CAPACITY;
  public static readonly skillStoneCapacity = SKILL_STONE_CAPACITY;
  public static readonly overflowCapacity = OVERFLOW_CAPACITY;
  public static readonly stackableTotalCapacity = STACKABLE_TOTAL_CAPACITY;
  public static readonly visualStackCapacity = VISUAL_STACK_CAPACITY;

  public dryRun(inventory: InventoryStateV1, input: InventoryReceiveInput): DomainResult<InventoryDryRun> {
    return dryRunReceive(inventory, input);
  }

  public receive(inventory: InventoryStateV1, input: InventoryReceiveInput): DomainResult<InventoryStateV1> {
    return receiveInventory(inventory, input);
  }

  public receiveReward(inventory: InventoryStateV1, reward: RewardTransactionV1): DomainResult<InventoryDryRun> {
    return receiveReward(inventory, reward);
  }
}
