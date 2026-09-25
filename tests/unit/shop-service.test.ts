import { describe, expect, it } from "vitest";
import type { EquipmentInstance, ShopOfferV1 } from "../../src/content/contracts";
import { createNewGameSave } from "../../src/domain/save/GameSave";
import { fixtureContentRoot } from "../../src/content/data";
import { ECONOMY_DEFINITION } from "../../src/content/data/economy";
import { ShopService } from "../../src/domain/town/ShopService";

function save() {
  const next = createNewGameSave(fixtureContentRoot, "2026-01-01T00:00:00.000Z");
  next.expedition = { expeditionId: "exp", expeditionSeed: 1, mode: "exploration", abyssEchoId: null, floorId: "floor_01", mapId: "map_floor_01", playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: "2026-01-01T00:00:00.000Z" };
  return next;
}

const offer: ShopOfferV1 = { offerId: "offer_potion", kind: "stackableItem", itemId: "item_minor_potion", quantity: 2, goldPrice: 10, sold: false };
const equipment = (): EquipmentInstance => ({ instanceId: "eq_1", baseId: "eq_fixture", itemLevel: 1, quality: "common", craftGrade: "ordinary", affixes: [], abyssAffix: null, locked: false, acquiredAt: "2026-01-01T00:00:00.000Z", sourceTransactionId: "test", reforgeLockedIndex: null, reforgeCount: 0 });

describe("ShopService", () => {
  it("只允许 exploration/shortFarm 刷新，购买成功标 sold 且库存/金币同候选变化", () => {
    const service = new ShopService({ economy: ECONOMY_DEFINITION });
    const current = save();
    const refreshed = service.refresh(current, "exploration", "exp", [offer]);
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    const bought = service.buy(refreshed.value, offer.offerId);
    expect(bought.ok).toBe(true);
    if (bought.ok) {
      expect(bought.value.gold).toBe(190);
      expect(bought.value.inventory.stackables.item_minor_potion).toBe(2);
      expect(bought.value.shop.offers[0].sold).toBe(true);
      expect(service.buy(bought.value, offer.offerId).ok).toBe(false);
    }
    expect(service.refresh(current, "bossRetry", "exp", [offer]).ok).toBe(false);
    expect(service.refresh(current, "abyssEcho", "exp", [offer]).ok).toBe(false);
  });

  it("购买容量失败保持输入不变；售出后仅保存成功才登记并保留最近 10 条回购", () => {
    const service = new ShopService({ economy: ECONOMY_DEFINITION });
    const current = save();
    current.inventory.equipment.push(equipment());
    current.inventory.stackables.item_minor_potion = 9_999;
    const refreshed = service.refresh(current, "exploration", "exp", [offer]);
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    const before = structuredClone(refreshed.value);
    expect(service.buy(refreshed.value, offer.offerId).ok).toBe(false);
    expect(refreshed.value).toEqual(before);

    for (let index = 0; index < 11; index += 1) {
      const result = service.sell(current, { kind: "equipment", instanceId: "eq_1", goldPrice: index + 1 });
      expect(result.ok).toBe(true);
      if (result.ok) service.recordBuyback(result.value.buyback);
    }
    expect(service.getBuybacks()).toHaveLength(10);
    expect(service.getBuybacks()[0]?.sequence).toBe(2);
    const boughtBack = service.buyback(current, 1);
    expect(boughtBack.ok).toBe(false); // 最旧 sequence 已淘汰，服务不伪造回购记录
  });

  it("装备锁定或已装备时禁止出售", () => {
    const service = new ShopService({ economy: ECONOMY_DEFINITION });
    const current = save();
    current.inventory.equipment.push(equipment());
    current.characters.char_wanderer.equipmentBySlot.weapon = "eq_1";
    expect(service.sell(current, { kind: "equipment", instanceId: "eq_1", goldPrice: 1 }).ok).toBe(false);
    current.characters.char_wanderer.equipmentBySlot.weapon = null;
    current.inventory.equipment[0].locked = true;
    expect(service.sell(current, { kind: "equipment", instanceId: "eq_1", goldPrice: 1 }).ok).toBe(false);
  });
});
