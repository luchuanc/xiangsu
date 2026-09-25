import { describe, expect, it } from "vitest";
import { generateLoot } from "../../src/domain/reward/LootGenerator";
import { claimReward } from "../../src/domain/reward/RewardService";
import { SeededRng } from "../../src/domain/common/SeededRng";
import { ABYSS_ECHO_DEFINITIONS } from "../../src/content/data/abyssEchoes";
import { makeEmptyInventory, makeDropTable, fixtureEquipmentContent, fixtureSkillStoneContent } from "../fixtures/content/battle-reward-fixture";

describe("AbyssEcho reward", () => {
  it("bonus 只进入 equipment roll，且首通固定材料一次", () => {
    const echo = ABYSS_ECHO_DEFINITIONS[0]!;
    const getItem = (id: string) => ({ ok: true as const, value: { id, nameKey: id, category: "material" as const, maxStack: 99 as const, baseGoldValue: 5, iconId: id } });
    const content = {
      ...fixtureEquipmentContent,
      getItem,
      equipment: fixtureEquipmentContent,
      skillStone: fixtureSkillStoneContent(),
      recruitedCharacterIds: ["char_fixture"],
    };
    const result = generateLoot({
      transactionId: "tx_echo",
      source: { kind: "abyssEcho", echoId: echo.id, encounterId: echo.bossEncounterId },
      table: makeDropTable("drop_echo", [{ kind: "stackableItem", itemId: "item_forge_shard", chanceBps: 10_000, quantityMin: 1, quantityMax: 1 }]),
      inventory: makeEmptyInventory(),
      content,
      rng: SeededRng.fromSeed(2),
      abyssEcho: { bonusAbyssUpgradeChanceBps: echo.bonusAbyssUpgradeChanceBps, firstClearForgeShards: echo.firstClearForgeShards, firstClearInscriptionDust: echo.firstClearInscriptionDust, isFirstClear: true },
    });
    expect(result).toMatchObject({ ok: true, value: { source: { kind: "abyssEcho", echoId: echo.id }, stackables: { item_forge_shard: 11, item_inscription_dust: 10 } } });
  });

  it("首通奖励通过 claimedRewardTransactionIds 幂等，重复领取不重复入库", () => {
    const reward = { transactionId: "tx_echo_once", source: { kind: "abyssEcho" as const, echoId: "echo_f06_iron", encounterId: "encounter_floor_06_boss" }, gold: 0, xp: 0, stackables: { item_forge_shard: 1 }, stackableCapConversions: [], equipment: [], skillStones: [], instanceOrder: [], claimed: false };
    const content = { getItem: (id: string) => ({ ok: true as const, value: { id, nameKey: id, category: "material" as const, maxStack: 99 as const, baseGoldValue: 5, iconId: id } }) };
    const first = claimReward({ inventory: makeEmptyInventory(), reward, claimedRewardTransactionIds: [], content });
    expect(first.ok).toBe(true);
    const repeated = claimReward({ inventory: first.ok ? first.value.inventory : makeEmptyInventory(), reward, claimedRewardTransactionIds: ["tx_echo_once"], content });
    expect(repeated).toMatchObject({ ok: false, error: { code: "REWARD_ALREADY_CLAIMED" } });
  });
});
