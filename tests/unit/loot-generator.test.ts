import { describe, expect, it } from "vitest";

import type { DropRollDefinition } from "../../src/content/contracts";
import { generateLoot, type LootContentSource } from "../../src/domain/reward/LootGenerator";
import { SeededRng } from "../../src/domain/common/SeededRng";
import { fixtureEquipmentContent, fixtureSkillStoneContent, makeDropTable, makeEmptyInventory } from "../fixtures/content/battle-reward-fixture";

function content(): LootContentSource {
  return {
    getItem: (id: string) => id === "item_forge_shard" || id === "item_inscription_dust"
      ? { ok: true as const, value: { id, nameKey: id, category: "material" as const, maxStack: 99, baseGoldValue: 5, iconId: id } }
      : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: `items.${id}`, issueKey: "missing" } } },
    equipment: fixtureEquipmentContent,
    skillStone: fixtureSkillStoneContent(),
    recruitedCharacterIds: ["char_fixture"],
  };
}

describe("LootGenerator", () => {
  it("abyssEcho 缺少冻结的 echo 配置时严格拒绝，不猜 bonus 或首杀材料", () => {
    const result = generateLoot({
      transactionId: "tx_echo_missing_options",
      source: { kind: "abyssEcho", echoId: "echo_fixture", encounterId: "encounter_fixture" },
      table: makeDropTable("drop_echo_missing_options", []),
      inventory: makeEmptyInventory(),
      rng: new SeededRng(8),
      content: content(),
    });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT", details: { path: "loot.abyssEcho", issueKey: "required" } } });
  });

  it("按 chance/原数组顺序生成堆叠物、保底装备与首杀追加", () => {
    const rolls: DropRollDefinition[] = [
      { kind: "stackableItem", itemId: "item_forge_shard", chanceBps: 10_000, quantityMin: 2, quantityMax: 2 },
      {
        kind: "equipment",
        chanceBps: 10_000,
        itemLevelMin: 1,
        itemLevelMax: 1,
        equipmentBasePools: [{ slot: "weapon", weight: 1, bases: [{ baseId: "base_fixture", weight: 1 }] }],
        qualityWeights: [{ quality: "magic", weight: 1 }],
        guaranteedMinQuality: "magic",
        abyssUpgradeChanceBps: 0,
      },
    ];
    const firstClear: DropRollDefinition[] = [{ kind: "stackableItem", itemId: "item_forge_shard", chanceBps: 10_000, quantityMin: 3, quantityMax: 3 }];
    const result = generateLoot({
      transactionId: "tx_loot",
      source: { kind: "encounter", encounterId: "encounter_fixture", mapId: "map_fixture", objectId: "object_fixture" },
      table: makeDropTable("drop_regular", rolls),
      firstClearTable: makeDropTable("drop_first_clear", firstClear),
      isFirstClear: true,
      inventory: makeEmptyInventory(),
      rng: new SeededRng(4),
      content: content(),
    });
    expect(result).toMatchObject({ ok: true, value: { stackables: { item_forge_shard: 5 }, equipment: [{ quality: "magic" }], instanceOrder: ["tx_loot:instance:0"] } });
  });

  it("深渊先判断升级概率并追加固定首杀材料，不读取楼层首通表", () => {
    const result = generateLoot({
      transactionId: "tx_echo",
      source: { kind: "abyssEcho", echoId: "echo_fixture", encounterId: "encounter_fixture" },
      table: makeDropTable("drop_echo", [{
        kind: "equipment",
        chanceBps: 10_000,
        itemLevelMin: 1,
        itemLevelMax: 1,
        equipmentBasePools: [{ slot: "weapon", weight: 1, bases: [{ baseId: "base_fixture", weight: 1 }] }],
        qualityWeights: [{ quality: "common", weight: 1 }],
        guaranteedMinQuality: null,
        abyssUpgradeChanceBps: 5_000,
      }]),
      firstClearTable: makeDropTable("must_not_read", [{ kind: "stackableItem", itemId: "item_forge_shard", chanceBps: 10_000, quantityMin: 99, quantityMax: 99 }]),
      isFirstClear: true,
      abyssEcho: { bonusAbyssUpgradeChanceBps: 5_000, firstClearForgeShards: 2, firstClearInscriptionDust: 1, isFirstClear: true },
      inventory: makeEmptyInventory(),
      rng: new SeededRng(5),
      content: content(),
    });
    expect(result).toMatchObject({ ok: true, value: { equipment: [{ quality: "abyss" }], stackables: { item_forge_shard: 2, item_inscription_dust: 1 } } });
  });
});
