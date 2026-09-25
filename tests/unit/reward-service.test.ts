import { describe, expect, it } from "vitest";

import type { RewardTransactionV1 } from "../../src/content/contracts";
import { claimReward, dryRunReward, type RewardContentSource } from "../../src/domain/reward/RewardService";
import { makeEmptyInventory, makeEquipment, makeSkillStone } from "../fixtures/content/battle-reward-fixture";

function reward(overrides: Partial<RewardTransactionV1> = {}): RewardTransactionV1 {
  return {
    transactionId: "tx_reward",
    source: { kind: "encounter", encounterId: "encounter_fixture", mapId: "map_fixture", objectId: "object_fixture" },
    gold: 10,
    xp: 20,
    stackables: { item_forge_shard: 1 },
    stackableCapConversions: [],
    equipment: [],
    skillStones: [],
    instanceOrder: [],
    claimed: false,
    ...overrides,
  };
}

const items: RewardContentSource = {
  getItem: (id: string) => id === "item_forge_shard"
    ? { ok: true as const, value: { id, nameKey: id, category: "material" as const, maxStack: 99, baseGoldValue: 5, iconId: id } }
    : { ok: false as const, error: { code: "INVALID_CONTENT" as const, details: { path: `items.${id}`, issueKey: "missing" } } },
};

describe("RewardService", () => {
  it("拒绝 malformed reward/source，而不是通过宽松字段兜底", () => {
    const malformed = reward({ source: { kind: "encounter", encounterId: "encounter_fixture", mapId: "map_fixture", objectId: "object_fixture", dropTableId: "unexpected" } as never });
    expect(dryRunReward({ inventory: makeEmptyInventory(), reward: malformed, content: items })).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT", details: { path: "reward.source" } } });
    const malformedConversion = reward({ stackables: { item_forge_shard: 1 }, stackableCapConversions: [{ itemId: "item_forge_shard", quantity: 1, gold: 999 }] });
    expect(dryRunReward({ inventory: makeEmptyInventory(), reward: malformedConversion, content: items })).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT", details: { path: "reward.stackableCapConversions.item_forge_shard" } } });
  });

  it("严格按 source 并把 9998/9999/10000 堆叠溢出转金币", () => {
    const base = makeEmptyInventory();
    const at9998 = dryRunReward({ inventory: { ...base, stackables: { item_forge_shard: 9998 } }, reward: reward({ stackables: { item_forge_shard: 2 } }), content: items });
    expect(at9998).toMatchObject({ ok: true, value: { reward: { stackables: { item_forge_shard: 1 }, stackableCapConversions: [{ itemId: "item_forge_shard", quantity: 1, gold: 5 }], gold: 15 } } });
    const at9999 = dryRunReward({ inventory: { ...base, stackables: { item_forge_shard: 9999 } }, reward: reward({ stackables: { item_forge_shard: 1 } }), content: items });
    expect(at9999).toMatchObject({ ok: true, value: { reward: { stackables: {}, stackableCapConversions: [{ quantity: 1, gold: 5 }] } } });
    const at10000 = dryRunReward({ inventory: base, reward: reward({ stackables: { item_forge_shard: 10_000 } }), content: items });
    expect(at10000).toMatchObject({ ok: true, value: { reward: { stackables: { item_forge_shard: 9999 }, stackableCapConversions: [{ quantity: 1, gold: 5 }] } } });
    const chest = dryRunReward({ inventory: base, reward: reward({ source: { kind: "chest", mapId: "map_fixture", objectId: "object_fixture", dropTableId: "drop_fixture" }, gold: 0, xp: 0 }), content: items });
    const echo = dryRunReward({ inventory: base, reward: reward({ source: { kind: "abyssEcho", echoId: "echo_fixture", encounterId: "encounter_fixture" } }), content: items });
    expect(chest).toMatchObject({ ok: true });
    expect(echo).toMatchObject({ ok: true });
  });

  it("实例按 instanceOrder 做全量 dry-run，容量不足整笔失败且不部分落库", () => {
    const equipment = Array.from({ length: 31 }, (_, index) => makeEquipment(`eq_${index}`));
    const tx = reward({ equipment, instanceOrder: equipment.map((value) => value.instanceId) });
    const result = claimReward({ inventory: { ...makeEmptyInventory(), equipment: Array.from({ length: 120 }, (_, index) => makeEquipment(`owned_${index}`)), overflowEquipment: Array.from({ length: 30 }, (_, index) => makeEquipment(`overflow_${index}`)) }, reward: tx, claimedRewardTransactionIds: [], content: items });
    expect(result).toMatchObject({ ok: false, error: { code: "INVENTORY_FULL" } });
  });

  it("成功领取只追加一次 claimed ID，重复提交不重复修改库存", () => {
    const tx = reward({ equipment: [makeEquipment("eq_once"),], skillStones: [makeSkillStone("stone_once")], instanceOrder: ["eq_once", "stone_once"] });
    const first = claimReward({ inventory: makeEmptyInventory(), reward: tx, claimedRewardTransactionIds: [], content: items });
    expect(first).toMatchObject({ ok: true, value: { claimedRewardTransactionIds: ["tx_reward"], inventory: { equipment: [{ instanceId: "eq_once" }], skillStones: [{ instanceId: "stone_once" }] } } });
    const repeated = claimReward({ inventory: first.ok ? first.value.inventory : makeEmptyInventory(), reward: tx, claimedRewardTransactionIds: ["tx_reward"], content: items });
    expect(repeated).toMatchObject({ ok: false, error: { code: "REWARD_ALREADY_CLAIMED" } });
  });
});
