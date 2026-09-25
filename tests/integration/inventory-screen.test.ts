import { describe, expect, it, vi } from "vitest";

import { createNewGameSave } from "../../src/domain/save/GameSave";
import { fixtureContentRoot } from "../../src/content/data";
import { failure, success, type DomainResult } from "../../src/domain/common/DomainResult";
import type { EquipmentInstance, GameSaveV1, SkillStoneInstance } from "../../src/content/contracts";
import { InventoryScreen } from "../../src/ui/screens/InventoryScreen";

const timestamp = "2026-08-24T00:00:00.000Z";

function equipment(instanceId: string, locked = false): EquipmentInstance {
  return {
    instanceId,
    baseId: "base_test_sword",
    itemLevel: 1,
    quality: "common",
    craftGrade: "ordinary",
    affixes: [],
    abyssAffix: null,
    locked,
    acquiredAt: timestamp,
    sourceTransactionId: "tx_test",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
}

function saveWithEquipment(count: number): GameSaveV1 {
  const save = createNewGameSave(fixtureContentRoot, timestamp);
  save.inventory.equipment = Array.from({ length: count }, (_, index) => equipment(`eq_${index}`));
  return save;
}

function skillStone(instanceId: string): SkillStoneInstance {
  return {
    instanceId,
    attunedCharacterId: "char_wanderer",
    itemLevel: 10,
    quality: "rare",
    affixes: [{ skillAffixId: "affix_power", roll: 100, reforged: false }],
    abyssAffix: null,
    locked: false,
    acquiredAt: timestamp,
    sourceTransactionId: "tx_stone",
    reforgeLockedIndex: null,
    reforgeCount: 0,
  };
}

describe("RPG-021 InventoryScreen", () => {
  it("容量 119/120/121 的投影和溢出仓只允许移动或分解", () => {
    const save = saveWithEquipment(119);
    save.inventory.overflowEquipment = [equipment("overflow_1"), equipment("overflow_2")];
    const screen = new InventoryScreen({ currentSave: () => save });
    expect(screen.state.capacity).toMatchObject({ equipment: 119, equipmentMax: 120, overflow: 2, overflowMax: 30 });
    expect(screen.selectItem("overflow_1").ok).toBe(true);
    expect(screen.state.selected?.canEquip).toBe(false);
    expect(screen.state.selected?.actions).toContain("move");
    expect(screen.state.selected?.actions).toContain("disassemble");
    save.inventory.equipment.push(equipment("eq_119"));
    expect(new InventoryScreen({ currentSave: () => save }).state.capacity.equipment).toBe(120);
    save.inventory.overflowEquipment.push(equipment("eq_120"));
    const full = new InventoryScreen({ currentSave: () => save });
    expect(full.state.capacity.equipment).toBe(120);
    expect(full.state.items.filter((item) => item.kind === "equipment")).toHaveLength(123);
  });

  it("技能铭石不暴露未接线的装备重铸 action", () => {
    const save = saveWithEquipment(0);
    save.inventory.skillStones.push(skillStone("stone_inventory"));
    const screen = new InventoryScreen({ currentSave: () => save });
    screen.setTab("skillStone");
    expect(screen.state.items[0]?.actions).not.toContain("reforge");
  });

  it("装备、锁定、分解通过确认提交，保存失败保留 draft 和错误", async () => {
    const save = saveWithEquipment(1);
    const persist = vi.fn<(...args: [number, GameSaveV1]) => Promise<DomainResult<GameSaveV1>>>()
      .mockResolvedValueOnce(failure({ code: "SAVE_FAILED", details: { operation: "save" } }))
      .mockResolvedValueOnce(success({ ...structuredClone(save), revision: 1 }));
    const equip = vi.fn(async (_save: GameSaveV1, _command: unknown, options: { save: (revision: number, next: GameSaveV1) => Promise<DomainResult<GameSaveV1>> }) => options.save(0, save));
    const screen = new InventoryScreen({ currentSave: () => save, persist, equipmentService: { equip } as never });
    expect(screen.selectItem("eq_0").ok).toBe(true);
    expect(screen.previewEquip("char_wanderer", "weapon").ok).toBe(true);
    expect((await screen.confirmEquip()).ok).toBe(false);
    expect(screen.state.status).toBe("error");
    expect(screen.state.draft).not.toBeNull();
    expect((await screen.confirmEquip()).ok).toBe(true);
    expect(screen.state.draft).toBeNull();
  });

  it("野外药水严格走 field preview/use，战斗物品显示旁路禁用原因", async () => {
    const save = saveWithEquipment(0);
    save.expedition = {
      expeditionId: "exp_1", expeditionSeed: 1, mode: "exploration", abyssEchoId: null, floorId: "floor_01", mapId: "map_floor_01",
      playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0,
      focusedEliteStoneConsumed: false, startedAt: timestamp,
    };
    save.inventory.stackables.item_potion = 1;
    const field = {
      preview: vi.fn(() => success({ powerBps: 5000, maxHp: 100, healed: 50 })),
      use: vi.fn(async () => success({ save: { ...structuredClone(save), revision: 1 }, healed: 50, maxHp: 100 })),
    };
    const screen = new InventoryScreen({ currentSave: () => save, scene: "expedition", fieldItemService: field, persist: async (_revision, next) => success({ ...structuredClone(next), revision: next.revision + 1 }) });
    expect(screen.previewFieldItem("item_potion", "char_wanderer").ok).toBe(true);
    expect(field.preview).toHaveBeenCalledTimes(1);
    expect((await screen.useFieldItem()).ok).toBe(true);
    expect(field.use).toHaveBeenCalledTimes(1);
    expect(screen.battleItemState("item_bomb")).toMatchObject({ enabled: false, reasonKey: "inventory.battle_item_command_only" });

    const battleSave = saveWithEquipment(0);
    battleSave.inventory.stackables.item_bomb = 1;
    const battleScreen = new InventoryScreen({
      currentSave: () => battleSave,
      scene: "battle",
      itemDefinitions: { item_bomb: { category: "consumable", useContexts: ["battle"] } },
    });
    battleScreen.setTab("consumable");
    expect(battleScreen.state.items).toMatchObject([
      { id: "item_bomb", actions: [], disabledReasonKey: "inventory.battle_item_command_only" },
    ]);
  });

  it("重铸打开和非溢出分解在领域提交未完成时复用同一 promise", async () => {
    const save = saveWithEquipment(1);
    const preview = {
      contentVersion: "content-1.2.0" as const,
      itemKind: "equipment" as const,
      instanceId: "eq_0",
      lockedIndex: 0,
      reforgeCount: 0,
      costItemId: "item_forge_shard" as const,
      costQuantity: 5,
      candidates: [{ candidateIndex: 0 as const, kind: "equipment" as const, roll: { affixId: "affix", tier: 1 as const, roll: 1, craftEmpowered: false, reforged: false } }],
    };
    let releaseOpen!: (value: DomainResult<{ save: GameSaveV1; preview: typeof preview }>) => void;
    const openPending = new Promise<DomainResult<{ save: GameSaveV1; preview: typeof preview }>>((resolve) => { releaseOpen = resolve; });
    const reforge = {
      open: vi.fn(() => openPending),
      preview: vi.fn(() => success(preview)),
      confirm: vi.fn(async () => success(save)),
    };
    const screen = new InventoryScreen({ currentSave: () => save, reforgeService: reforge as never, persist: async (_revision, next) => success(next) });
    screen.selectItem("eq_0");
    const firstOpen = screen.openReforge(0);
    const secondOpen = screen.openReforge(0);
    expect(reforge.open).toHaveBeenCalledTimes(1);
    releaseOpen(success({ save, preview }));
    expect((await firstOpen).ok).toBe(true);
    expect((await secondOpen).ok).toBe(true);

    let releaseDisassemble!: (value: DomainResult<{ save: GameSaveV1; materialItemId: string; quantity: number }>) => void;
    const disassemblePending = new Promise<DomainResult<{ save: GameSaveV1; materialItemId: string; quantity: number }>>((resolve) => { releaseDisassemble = resolve; });
    const equipmentService = { disassemble: vi.fn(() => disassemblePending) };
    const disassembleScreen = new InventoryScreen({ currentSave: () => save, equipmentService: equipmentService as never, persist: async (_revision, next) => success(next) });
    disassembleScreen.selectItem("eq_0");
    const firstDisassemble = disassembleScreen.disassemble();
    const secondDisassemble = disassembleScreen.disassemble();
    expect(equipmentService.disassemble).toHaveBeenCalledTimes(1);
    releaseDisassemble(success({ save, materialItemId: "item_scrap", quantity: 1 }));
    expect((await firstDisassemble).ok).toBe(true);
    expect((await secondDisassemble).ok).toBe(true);
  });

  it("连续点击只提交一次，重铸候选稳定且需要二次确认", async () => {
    const save = saveWithEquipment(1);
    let release!: (value: DomainResult<GameSaveV1>) => void;
    const pending = new Promise<DomainResult<GameSaveV1>>((resolve) => { release = resolve; });
    const persist = vi.fn(() => pending);
    const reforge = {
      open: vi.fn(async () => success({ save, preview: { contentVersion: "content-1.2.0" as const, itemKind: "equipment" as const, instanceId: "eq_0", lockedIndex: 0, reforgeCount: 0, costItemId: "item_forge_shard" as const, costQuantity: 5, candidates: [{ candidateIndex: 0 as const, kind: "equipment" as const, roll: { affixId: "affix", tier: 1 as const, roll: 1, craftEmpowered: false, reforged: false } }] } })),
      preview: vi.fn(() => success({ contentVersion: "content-1.2.0" as const, itemKind: "equipment" as const, instanceId: "eq_0", lockedIndex: 0, reforgeCount: 0, costItemId: "item_forge_shard" as const, costQuantity: 5, candidates: [{ candidateIndex: 0 as const, kind: "equipment" as const, roll: { affixId: "affix", tier: 1 as const, roll: 1, craftEmpowered: false, reforged: false } }] })),
      confirm: vi.fn(async () => persist()),
    };
    const screen = new InventoryScreen({ currentSave: () => save, reforgeService: reforge as never, persist });
    screen.selectItem("eq_0");
    expect((await screen.openReforge(0)).ok).toBe(true);
    const first = screen.requestReforge(0);
    const second = screen.requestReforge(0);
    expect(first).toBe(second);
    expect(reforge.confirm).toHaveBeenCalledTimes(0);
    expect(screen.state.reforgeConfirming).toBe(0);
    const commit = screen.confirmReforge();
    expect(reforge.confirm).toHaveBeenCalledTimes(1);
    release(success({ ...structuredClone(save), revision: 1 }));
    await commit;
  });
});
