import { describe, expect, it } from "vitest";

import type { GameSaveV1, StackableItemDefinition } from "../../src/content/contracts";
import { fixtureContentRoot } from "../../src/content/data";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { previewFieldItemUse, useFieldItem, type FieldItemContentSource } from "../../src/domain/inventory/FieldItemService";

const character = fixtureContentRoot.characters[0];
const potion: StackableItemDefinition = {
  id: "item_minor_potion",
  nameKey: "item.item_minor_potion.name",
  category: "consumable",
  maxStack: 99,
  baseGoldValue: 5,
  iconId: "icon_item_minor_potion",
  useContexts: ["field"],
  targetRule: "singleAlly",
  effects: [{ kind: "heal", targetRule: "singleAlly", scalingStat: "maxHp", powerBps: 5000, flatPower: 0, canCrit: false }],
};
const material: StackableItemDefinition = {
  id: "item_forge_shard",
  nameKey: "item.item_forge_shard.name",
  category: "material",
  maxStack: 99,
  baseGoldValue: 5,
  iconId: "icon_item_forge_shard",
};

const content: FieldItemContentSource = {
  getItem: (id) => {
    const item = [potion, material].find((value) => value.id === id);
    return item ? success(item) : failure(createDomainError("INVALID_CONTENT", { path: `items.${id}`, issueKey: "missing_content" }));
  },
  getCharacter: (id: string) => id === character.id
    ? success(character)
    : failure(createDomainError("INVALID_CONTENT", { path: `characters.${id}`, issueKey: "missing_content" })),
};

function save(): GameSaveV1 {
  const value = createNewGameSave(fixtureContentRoot, "2026-08-24T00:00:00.000Z");
  value.expedition = {
    expeditionId: "exp_test",
    expeditionSeed: 1,
    mode: "exploration",
    abyssEchoId: null,
    floorId: "floor_01",
    mapId: "map_field_01",
    playerPosition: { x: 1, y: 1 },
    safePosition: { x: 1, y: 1 },
    defeatedEncounterObjectIds: [],
    openedChestObjectIds: [],
    encounterProtectionStepsRemaining: 0,
    focusedEliteStoneConsumed: false,
    startedAt: "2026-08-24T00:00:00.000Z",
  };
  value.party.slots = [character.id, null, null, null];
  value.inventory.stackables.item_minor_potion = 2;
  value.characters[character.id].currentHp = 50;
  return value;
}

const command = () => ({ expectedRevision: 1, itemId: "item_minor_potion", targetCharacterId: character.id } as const);

describe("FieldItemService", () => {
  it("只允许 expedition 非空且 battle 为空的 field context", () => {
    const town = save();
    town.expedition = null;
    const battle = save();
    battle.battle = {} as GameSaveV1["battle"];
    const wrongItem = save();
    wrongItem.inventory.stackables[material.id] = 1;

    expect(previewFieldItemUse(content, town, command())).toMatchObject({ ok: false, error: { code: "ITEM_USE_FORBIDDEN", details: { reason: "NOT_IN_EXPEDITION" } } });
    expect(previewFieldItemUse(content, battle, command())).toMatchObject({ ok: false, error: { code: "ITEM_USE_FORBIDDEN", details: { reason: "BATTLE_ACTIVE" } } });
    expect(previewFieldItemUse(content, wrongItem, { ...command(), itemId: material.id })).toMatchObject({ ok: false, error: { code: "ITEM_USE_FORBIDDEN", details: { reason: "WRONG_CONTEXT" } } });
  });

  it("成功时同一保存事务扣一件并按 maxHp 比例钳制回血", async () => {
    const before = save();
    const beforeJson = JSON.stringify(before);
    const result = await useFieldItem(content, before, command(), {
      staticMaxHp: () => success(100),
      save: (expectedRevision, nextSave) => {
        expect(expectedRevision).toBe(1);
        expect(nextSave.inventory.stackables.item_minor_potion).toBe(1);
        expect(nextSave.characters[character.id].currentHp).toBe(100);
        return success({ ...nextSave, revision: 2 });
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ healed: 50, maxHp: 100, save: { revision: 2 } });
    expect(JSON.stringify(before)).toBe(beforeJson);
  });

  it("目标必须是当前队伍内已招募且 0<HP<maxHp 的角色", () => {
    const full = save();
    full.characters[character.id].currentHp = 100;
    const dead = save();
    dead.characters[character.id].currentHp = 0;
    const absent = save();
    absent.party.slots = [null, null, null, null];

    expect(previewFieldItemUse(content, full, command(), () => success(100))).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "FULL_HP" } } });
    expect(previewFieldItemUse(content, dead, command(), () => success(100))).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "DEAD" } } });
    expect(previewFieldItemUse(content, absent, command(), () => success(100))).toMatchObject({ ok: false, error: { code: "INVALID_TARGET", details: { reason: "UNKNOWN" } } });
  });

  it("revision 过期或保存失败时不修改原存档", async () => {
    const stale = save();
    const staleResult = await useFieldItem(content, stale, { ...command(), expectedRevision: 2 }, { save: () => success(stale), staticMaxHp: () => success(100) });
    expect(staleResult).toMatchObject({ ok: false, error: { code: "STALE_REVISION" } });

    const failed = save();
    const before = JSON.stringify(failed);
    const failedResult = await useFieldItem(content, failed, command(), {
      save: () => failure(createDomainError("STALE_REVISION", { expectedRevision: 1, actualRevision: 2 })),
      staticMaxHp: () => success(100),
    });
    expect(failedResult).toMatchObject({ ok: false, error: { code: "STALE_REVISION" } });
    expect(JSON.stringify(failed)).toBe(before);
  });
});
