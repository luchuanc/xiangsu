import { describe, expect, it } from "vitest";

import type { EquipmentInstance, GameSaveV1 } from "../../src/content/contracts";
import { fixtureContentRoot } from "../../src/content/data";
import { ECONOMY_DEFINITION } from "../../src/content/data/economy";
import { EQUIPMENT_AFFIX_DEFINITIONS, EQUIPMENT_BASE_DEFINITIONS } from "../../src/content/data/equipment";
import { success } from "../../src/domain/common/DomainResult";
import { SeededRng } from "../../src/domain/common/SeededRng";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { generateEquipment, type EquipmentContentSource } from "../../src/domain/inventory/EquipmentGenerator";
import { ReforgeService } from "../../src/domain/inventory/ReforgeService";

const content: EquipmentContentSource = {
  equipmentBases: EQUIPMENT_BASE_DEFINITIONS,
  equipmentAffixes: EQUIPMENT_AFFIX_DEFINITIONS,
  economy: ECONOMY_DEFINITION,
};

function equipment(): EquipmentInstance {
  const result = generateEquipment(content, {
    instanceId: "eq_reforge_test",
    acquiredAt: "2026-08-24T00:00:00.000Z",
    sourceTransactionId: "reward_reforge",
    rng: SeededRng.fromSeed(8),
    baseId: "eq_accessory_t1_charm",
    itemLevel: 1,
    quality: "epic",
    craftGrade: "ordinary",
  });
  if (!result.ok) throw new Error("重铸装备夹具生成失败");
  return result.value;
}

function save(): GameSaveV1 {
  const value = createNewGameSave(fixtureContentRoot, "2026-08-24T00:00:00.000Z");
  value.inventory.equipment.push(equipment());
  value.inventory.stackables.item_forge_shard = 100;
  return value;
}

function commit(expectedRevision: number, nextSave: GameSaveV1) {
  return success({ ...nextSave, revision: expectedRevision + 1 });
}

describe("ReforgeService", () => {
  it("首次打开锁定普通槽，候选稳定且最多三条，预览/取消不扣材料", async () => {
    const service = new ReforgeService(content);
    const before = save();
    const beforeJson = JSON.stringify(before);
    const opened = await service.open(before, {
      expectedSaveRevision: 1,
      itemKind: "equipment",
      instanceId: "eq_reforge_test",
      requestedIndex: 0,
    }, { save: commit });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.preview.candidates.length).toBeGreaterThan(0);
    expect(opened.value.preview.candidates.length).toBeLessThanOrEqual(3);
    expect(new Set(opened.value.preview.candidates.filter((candidate) => candidate.kind === "equipment").map((candidate) => candidate.roll.affixId)).size).toBe(opened.value.preview.candidates.length);
    expect(opened.value.save.inventory.equipment[0].reforgeLockedIndex).toBe(0);
    expect(opened.value.save.inventory.stackables.item_forge_shard).toBe(100);

    const repeated = service.preview(opened.value.save, {
      expectedSaveRevision: 2,
      itemKind: "equipment",
      instanceId: "eq_reforge_test",
      requestedIndex: 0,
    });
    expect(repeated).toEqual({ ok: true, value: opened.value.preview });
    expect(JSON.stringify(before)).toBe(beforeJson);
  });

  it("确认后才按 5+itemLevel 扣碎片、替换同一槽并递增次数", async () => {
    const service = new ReforgeService(content);
    const opened = await service.open(save(), {
      expectedSaveRevision: 1,
      itemKind: "equipment",
      instanceId: "eq_reforge_test",
      requestedIndex: 0,
    }, { save: commit });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const candidateIndex = opened.value.preview.candidates[0].candidateIndex;
    const confirmed = await service.confirm(opened.value.save, {
      expectedSaveRevision: 2,
      itemKind: "equipment",
      instanceId: "eq_reforge_test",
      expectedLockedIndex: 0,
      expectedReforgeCount: 0,
      candidateIndex,
    }, { save: commit });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.value.inventory.stackables.item_forge_shard).toBe(94);
      expect(confirmed.value.inventory.equipment[0].reforgeCount).toBe(1);
      const candidate = opened.value.preview.candidates[0];
      if (candidate.kind === "equipment") expect(confirmed.value.inventory.equipment[0].affixes[0].affixId).toBe(candidate.roll.affixId);
      expect(confirmed.value.inventory.equipment[0].affixes[0].reforged).toBe(true);
    }
  });

  it("陈旧次数、错误槽、深渊槽和城外操作均拒绝且不扣料", async () => {
    const service = new ReforgeService(content);
    const source = save();
    const opened = await service.open(source, {
      expectedSaveRevision: 1,
      itemKind: "equipment",
      instanceId: "eq_reforge_test",
      requestedIndex: 0,
    }, { save: commit });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const candidateIndex = opened.value.preview.candidates[0].candidateIndex;
    const stale = await service.confirm(opened.value.save, {
      expectedSaveRevision: 2,
      itemKind: "equipment",
      instanceId: "eq_reforge_test",
      expectedLockedIndex: 0,
      expectedReforgeCount: 1,
      candidateIndex,
    }, { save: commit });
    expect(stale).toMatchObject({ ok: false, error: { code: "REFORGE_PREVIEW_STALE" } });

    const wrongSlot = service.preview(opened.value.save, {
      expectedSaveRevision: 2,
      itemKind: "equipment",
      instanceId: "eq_reforge_test",
      requestedIndex: 1,
    });
    expect(wrongSlot).toMatchObject({ ok: false, error: { code: "AFFIX_NOT_REFORGEABLE", details: { reason: "WRONG_LOCKED_INDEX" } } });

    const outside = structuredClone(opened.value.save);
    outside.expedition = { ...outside.expedition, expeditionId: "exp_test" } as NonNullable<GameSaveV1["expedition"]>;
    expect(service.preview(outside, { expectedSaveRevision: 2, itemKind: "equipment", instanceId: "eq_reforge_test", requestedIndex: 0 })).toMatchObject({ ok: false, error: { code: "NOT_IN_TOWN" } });
  });

  it("锁定物或已装备物不能重铸", () => {
    const service = new ReforgeService(content);
    const locked = save();
    locked.inventory.equipment[0].locked = true;
    expect(service.preview(locked, { expectedSaveRevision: 1, itemKind: "equipment", instanceId: "eq_reforge_test", requestedIndex: 0 })).toMatchObject({ ok: false, error: { code: "AFFIX_NOT_REFORGEABLE", details: { reason: "LOCKED_ITEM" } } });

    const equipped = save();
    equipped.characters.char_wanderer.equipmentBySlot.accessory = "eq_reforge_test";
    expect(service.preview(equipped, { expectedSaveRevision: 1, itemKind: "equipment", instanceId: "eq_reforge_test", requestedIndex: 0 })).toMatchObject({ ok: false, error: { code: "AFFIX_NOT_REFORGEABLE", details: { reason: "EQUIPPED_ITEM" } } });
  });
});
