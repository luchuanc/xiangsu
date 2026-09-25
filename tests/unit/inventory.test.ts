import { describe, expect, it } from "vitest";

import type {
  CharacterDefinition,
  EquipmentInstance,
  GameSaveV1,
  InventoryStateV1,
  SkillStoneInstance,
} from "../../src/content/contracts";
import { fixtureContentRoot } from "../../src/content/data";
import { ECONOMY_DEFINITION } from "../../src/content/data/economy";
import { EQUIPMENT_AFFIX_DEFINITIONS, EQUIPMENT_BASE_DEFINITIONS } from "../../src/content/data/equipment";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import {
  EQUIPMENT_CAPACITY,
  OVERFLOW_CAPACITY,
  SKILL_STONE_CAPACITY,
  STACKABLE_TOTAL_CAPACITY,
  VISUAL_STACK_CAPACITY,
  Inventory,
  dryRunReceive,
  visualStackCount,
} from "../../src/domain/inventory/Inventory";
import { EquipmentService, type EquipmentServiceContent } from "../../src/domain/inventory/EquipmentService";

function equipment(instanceId: string): EquipmentInstance {
  return {
    instanceId,
    baseId: "base_training_sword",
    itemLevel: 1,
    quality: "common",
    craftGrade: "ordinary",
    affixes: [],
    abyssAffix: null,
    locked: false,
    acquiredAt: "2026-08-24T00:00:00.000Z",
    sourceTransactionId: "reward_test",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
}

function skillStone(instanceId: string): SkillStoneInstance {
  return {
    instanceId,
    attunedCharacterId: "char_protagonist",
    itemLevel: 1,
    quality: "magic",
    affixes: [],
    abyssAffix: null,
    locked: false,
    acquiredAt: "2026-08-24T00:00:00.000Z",
    sourceTransactionId: "reward_test",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
}

function inventory(overrides: Partial<InventoryStateV1> = {}): InventoryStateV1 {
  return {
    equipment: [],
    skillStones: [],
    stackables: {},
    overflowEquipment: [],
    overflowSkillStones: [],
    ...overrides,
  };
}

const serviceCharacter: CharacterDefinition = fixtureContentRoot.characters[0];
const equipmentContent: EquipmentServiceContent = {
  equipmentBases: EQUIPMENT_BASE_DEFINITIONS,
  equipmentAffixes: EQUIPMENT_AFFIX_DEFINITIONS,
  economy: ECONOMY_DEFINITION,
  characters: [serviceCharacter],
};

function serviceEquipment(instanceId: string, baseId: string, locked = false): EquipmentInstance {
  return {
    instanceId,
    baseId,
    itemLevel: 1,
    quality: "rare",
    craftGrade: "ordinary",
    affixes: [],
    abyssAffix: null,
    locked,
    acquiredAt: "2026-08-24T00:00:00.000Z",
    sourceTransactionId: "reward_equipment_test",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
}

function serviceSave(...instances: EquipmentInstance[]): GameSaveV1 {
  const value = createNewGameSave(fixtureContentRoot, "2026-08-24T00:00:00.000Z");
  value.inventory.equipment.push(...instances);
  value.inventory.stackables.item_forge_shard = 0;
  return value;
}

function commitSave(expectedRevision: number, nextSave: GameSaveV1) {
  return success({ ...nextSave, revision: expectedRevision + 1 });
}

describe("Inventory", () => {
  it("固定容量、共享溢出仓和视觉堆上限", () => {
    expect(EQUIPMENT_CAPACITY).toBe(120);
    expect(SKILL_STONE_CAPACITY).toBe(80);
    expect(OVERFLOW_CAPACITY).toBe(30);
    expect(VISUAL_STACK_CAPACITY).toBe(99);
    expect(STACKABLE_TOTAL_CAPACITY).toBe(9999);
    expect(visualStackCount(0)).toBe(0);
    expect(visualStackCount(99)).toBe(1);
    expect(visualStackCount(100)).toBe(2);
    expect(visualStackCount(9999)).toBe(101);
  });

  it("按 instanceOrder 原子分配，主背包满后使用共享溢出仓", () => {
    const current = inventory({
      equipment: Array.from({ length: EQUIPMENT_CAPACITY }, (_, index) => equipment(`old_eq_${index}`)),
      skillStones: Array.from({ length: SKILL_STONE_CAPACITY }, (_, index) => skillStone(`old_stone_${index}`)),
    });
    const incomingEquipment = [equipment("new_eq_1"), equipment("new_eq_2")];
    const incomingStones = [skillStone("new_stone_1")];
    const result = dryRunReceive(current, {
      equipment: incomingEquipment,
      skillStones: incomingStones,
      stackables: { item_minor_potion: 2 },
      instanceOrder: ["new_stone_1", "new_eq_1", "new_eq_2"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.placements).toEqual([
      { instanceId: "new_stone_1", kind: "skillStone", destination: "overflowSkillStone" },
      { instanceId: "new_eq_1", kind: "equipment", destination: "overflowEquipment" },
      { instanceId: "new_eq_2", kind: "equipment", destination: "overflowEquipment" },
    ]);
    expect(result.value.inventory.overflowEquipment.map((item) => item.instanceId)).toEqual(["new_eq_1", "new_eq_2"]);
    expect(result.value.inventory.overflowSkillStones.map((item) => item.instanceId)).toEqual(["new_stone_1"]);
    expect(result.value.inventory.stackables.item_minor_potion).toBe(2);
    expect(current.overflowEquipment).toHaveLength(0);
    expect(incomingEquipment[0].instanceId).toBe("new_eq_1");
  });

  it("主背包和共享溢出仓都满时整笔奖励拒绝且不修改输入", () => {
    const current = inventory({
      equipment: Array.from({ length: EQUIPMENT_CAPACITY }, (_, index) => equipment(`old_eq_${index}`)),
      skillStones: Array.from({ length: SKILL_STONE_CAPACITY }, (_, index) => skillStone(`old_stone_${index}`)),
      overflowEquipment: Array.from({ length: OVERFLOW_CAPACITY }, (_, index) => equipment(`old_overflow_${index}`)),
      stackables: { item_minor_potion: 10 },
    });
    const before = structuredClone(current);
    const incoming = { equipment: [equipment("new_eq")], skillStones: [], stackables: { item_minor_potion: 5 }, instanceOrder: ["new_eq"] as const };
    const result = new Inventory().receive(current, incoming);

    expect(result).toMatchObject({ ok: false, error: { code: "INVENTORY_FULL" } });
    expect(current).toEqual(before);
  });

  it("拒绝堆叠总量超过 9999，边界值 9999 可接收", () => {
    const accepted = dryRunReceive(inventory({ stackables: { item_minor_potion: 9998 } }), {
      equipment: [],
      skillStones: [],
      stackables: { item_minor_potion: 1 },
      instanceOrder: [],
    });
    const rejected = dryRunReceive(inventory({ stackables: { item_minor_potion: 9999 } }), {
      equipment: [],
      skillStones: [],
      stackables: { item_minor_potion: 1 },
      instanceOrder: [],
    });

    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.value.inventory.stackables.item_minor_potion).toBe(9999);
    expect(rejected).toMatchObject({ ok: false, error: { code: "STACKABLE_CAP_EXCEEDED" } });
  });

  it("拒绝重复实例和不完整的 instanceOrder", () => {
    const duplicate = dryRunReceive(inventory(), {
      equipment: [equipment("same")],
      skillStones: [skillStone("same")],
      stackables: {},
      instanceOrder: ["same", "same"],
    });
    const missing = dryRunReceive(inventory(), {
      equipment: [equipment("eq")],
      skillStones: [],
      stackables: {},
      instanceOrder: [],
    });

    expect(duplicate).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
    expect(missing).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
  });
});

describe("EquipmentService", () => {
  it("城镇可换装/卸装，只向保存回调提交深拷贝且不治疗", async () => {
    const service = new EquipmentService(equipmentContent);
    const sword = serviceEquipment("eq_service_sword", "eq_sword_t1_windblade");
    const before = serviceSave(sword);
    before.characters[serviceCharacter.id].currentHp = 70;
    const beforeJson = JSON.stringify(before);
    const equipped = await service.equip(before, { characterId: serviceCharacter.id, instanceId: sword.instanceId }, {
      expectedRevision: 1,
      staticMaxHp: () => success(100),
      save: commitSave,
    });

    expect(equipped.ok).toBe(true);
    if (!equipped.ok) return;
    expect(equipped.value.characters[serviceCharacter.id].equipmentBySlot.weapon).toBe(sword.instanceId);
    expect(equipped.value.characters[serviceCharacter.id].currentHp).toBe(70);
    expect(JSON.stringify(before)).toBe(beforeJson);

    const unequipped = await service.unequip(equipped.value, serviceCharacter.id, "weapon", {
      expectedRevision: 2,
      staticMaxHp: () => success(60),
      save: commitSave,
    });
    expect(unequipped.ok).toBe(true);
    if (unequipped.ok) {
      expect(unequipped.value.characters[serviceCharacter.id].equipmentBySlot.weapon).toBeNull();
      expect(unequipped.value.characters[serviceCharacter.id].currentHp).toBe(60);
    }
  });

  it("拒绝非允许武器和远征中换装，失败不调用保存", async () => {
    const service = new EquipmentService(equipmentContent);
    const hammer = serviceEquipment("eq_service_hammer", "eq_hammer_t1_stonemaul");
    const save = serviceSave(hammer);
    let writes = 0;
    const weapon = await service.equip(save, { characterId: serviceCharacter.id, instanceId: hammer.instanceId }, {
      expectedRevision: 1,
      save: (expectedRevision, nextSave) => {
        writes += 1;
        return commitSave(expectedRevision, nextSave);
      },
    });
    expect(weapon).toMatchObject({ ok: false, error: { code: "WEAPON_NOT_ALLOWED", details: { weaponType: "hammer" } } });

    const expedition = serviceSave(hammer);
    expedition.expedition = {} as GameSaveV1["expedition"];
    const blocked = await service.equip(expedition, { characterId: serviceCharacter.id, instanceId: hammer.instanceId }, {
      expectedRevision: 1,
      save: () => {
        writes += 1;
        return success(expedition);
      },
    });
    expect(blocked).toMatchObject({ ok: false, error: { code: "NOT_IN_TOWN" } });
    expect(writes).toBe(0);
  });

  it("分解未装备物按品质获得材料，锁定物和已装备物被保护", async () => {
    const service = new EquipmentService(equipmentContent);
    const rare = serviceEquipment("eq_service_rare", "eq_sword_t1_windblade");
    const before = serviceSave(rare);
    const beforeJson = JSON.stringify(before);
    const disassembled = await service.disassemble(before, rare.instanceId, { expectedRevision: 1, save: commitSave });
    expect(disassembled.ok).toBe(true);
    if (disassembled.ok) {
      expect(disassembled.value.quantity).toBe(4);
      expect(disassembled.value.materialItemId).toBe("item_forge_shard");
      expect(disassembled.value.save.inventory.equipment).toHaveLength(0);
      expect(disassembled.value.save.inventory.stackables.item_forge_shard).toBe(4);
    }
    expect(JSON.stringify(before)).toBe(beforeJson);

    const locked = serviceSave(serviceEquipment("eq_service_locked", "eq_sword_t1_windblade", true));
    expect(await service.disassemble(locked, "eq_service_locked", { expectedRevision: 1, save: commitSave })).toMatchObject({ ok: false, error: { code: "ITEM_LOCKED" } });

    const equipped = serviceSave(serviceEquipment("eq_service_equipped", "eq_sword_t1_windblade"));
    equipped.characters[serviceCharacter.id].equipmentBySlot.weapon = "eq_service_equipped";
    expect(await service.disassemble(equipped, "eq_service_equipped", { expectedRevision: 1, save: commitSave })).toMatchObject({ ok: false, error: { code: "ITEM_EQUIPPED" } });
  });

  it("CAS 保存失败时保持原快照不变", async () => {
    const service = new EquipmentService(equipmentContent);
    const sword = serviceEquipment("eq_service_cas", "eq_sword_t1_windblade");
    const before = serviceSave(sword);
    const beforeJson = JSON.stringify(before);
    const result = await service.equip(before, { characterId: serviceCharacter.id, instanceId: sword.instanceId }, {
      expectedRevision: 1,
      save: () => failure(createDomainError("STALE_REVISION", { expectedRevision: 1, actualRevision: 2 })),
    });
    expect(result).toMatchObject({ ok: false, error: { code: "STALE_REVISION" } });
    expect(JSON.stringify(before)).toBe(beforeJson);
  });
});
