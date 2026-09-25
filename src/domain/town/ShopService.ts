import type {
  BuybackEntryV1,
  EconomyDefinition,
  EquipmentInstance,
  GameSaveV1,
  ShopOfferV1,
  SkillStoneInstance,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import { receiveInventory } from "../inventory/Inventory";

export type ShopMode = "exploration" | "shortFarm" | "bossRetry" | "abyssEcho";

export interface ShopServiceOptions {
  readonly economy: Readonly<EconomyDefinition>;
}

export type SellInput =
  | { readonly kind: "equipment"; readonly instanceId: string; readonly goldPrice: number }
  | { readonly kind: "skillStone"; readonly instanceId: string; readonly goldPrice: number }
  | { readonly kind: "stackableItem"; readonly itemId: string; readonly quantity: number; readonly goldPrice: number };

export interface SellResult {
  readonly save: GameSaveV1;
  readonly buyback: BuybackEntryV1;
}

export interface BuybackResult {
  readonly save: GameSaveV1;
  readonly buyback: BuybackEntryV1;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function clone<T>(value: T): T { return structuredClone(value); }

function assertPrice(value: number, path: string): DomainResult<true> {
  if (!Number.isSafeInteger(value) || value < 0) return invalid(path, "non_negative_integer");
  return success(true);
}

function findOffer(save: GameSaveV1, offerId: string): DomainResult<{ index: number; offer: ShopOfferV1 }> {
  if (typeof offerId !== "string" || offerId.length === 0) return invalid("offerId", "empty_id");
  const index = save.shop.offers.findIndex((offer) => offer.offerId === offerId);
  if (index < 0) return failure(createDomainError("SHOP_OFFER_UNAVAILABLE", { offerId }));
  const offer = save.shop.offers[index];
  if (offer.sold) return failure(createDomainError("SHOP_OFFER_UNAVAILABLE", { offerId }));
  return success({ index, offer });
}

function withInventory(save: GameSaveV1, offer: ShopOfferV1): DomainResult<GameSaveV1> {
  const next = clone(save);
  const received = offer.kind === "equipment"
    ? receiveInventory(next.inventory, { equipment: [offer.equipment], skillStones: [], stackables: {}, instanceOrder: [offer.equipment.instanceId] })
    : offer.kind === "skillStone"
      ? receiveInventory(next.inventory, { equipment: [], skillStones: [offer.skillStone], stackables: {}, instanceOrder: [offer.skillStone.instanceId] })
      : receiveInventory(next.inventory, { equipment: [], skillStones: [], stackables: { [offer.itemId]: offer.quantity }, instanceOrder: [] });
  if (!received.ok) return received;
  next.inventory = received.value;
  return success(next);
}

function isEquipped(save: GameSaveV1, instanceId: string): boolean {
  return Object.values(save.characters).some((character) => Object.values(character.equipmentBySlot).includes(instanceId));
}

/** 商店只处理持久化候选和本运行会话回购，不自行写 Store。 */
export class ShopService {
  private readonly economy: Readonly<EconomyDefinition>;
  private readonly buybacks = new Map<number, BuybackEntryV1>();
  private nextSequence = 1;

  public constructor(options: ShopServiceOptions) {
    this.economy = options.economy;
  }

  public getBuybacks(): readonly BuybackEntryV1[] {
    return [...this.buybacks.values()].sort((left, right) => left.sequence - right.sequence).map(clone);
  }

  /** 只有 exploration/shortFarm 允许随新远征刷新库存，其他模式固定拒绝。 */
  public refresh(save: GameSaveV1, mode: ShopMode, expeditionId: string, offers: readonly ShopOfferV1[]): DomainResult<GameSaveV1> {
    if (mode === "bossRetry") return failure(createDomainError("EXPEDITION_MODE_LOCKED", { mode, floorId: save.expedition?.floorId ?? "unknown", reason: "BOSS_NOT_CONTACTED" }));
    if (mode === "abyssEcho") return invalid("shop", "protected_mode_shop_refresh");
    if (!save.expedition || save.expedition.mode !== mode) return invalid("expedition.mode", "mode_mismatch");
    if (typeof expeditionId !== "string" || expeditionId.length === 0) return invalid("expeditionId", "empty_id");
    if (!Array.isArray(offers)) return invalid("offers", "array_required");
    const next = clone(save);
    next.shop.stockRevision += 1;
    next.shop.generatedFromExpeditionId = expeditionId;
    next.shop.offers = clone(offers);
    return success(next);
  }

  public buy(save: GameSaveV1, offerId: string): DomainResult<GameSaveV1> {
    const found = findOffer(save, offerId);
    if (!found.ok) return found;
    if (save.gold < found.value.offer.goldPrice) return failure(createDomainError("INSUFFICIENT_GOLD", { required: found.value.offer.goldPrice, owned: save.gold }));
    const received = withInventory(save, found.value.offer);
    if (!received.ok) return received;
    received.value.gold -= found.value.offer.goldPrice;
    received.value.shop.offers[found.value.index] = { ...found.value.offer, sold: true } as ShopOfferV1;
    return success(received.value);
  }

  public sell(save: GameSaveV1, input: SellInput): DomainResult<SellResult> {
    if (!input || typeof input !== "object") return invalid("sell", "not_object");
    const price = assertPrice(input.goldPrice, "sell.goldPrice");
    if (!price.ok) return price;
    const next = clone(save);
    if (input.kind === "equipment" || input.kind === "skillStone") {
      const list = input.kind === "equipment" ? next.inventory.equipment : next.inventory.skillStones;
      const index = list.findIndex((value) => value.instanceId === input.instanceId);
      if (index < 0) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: input.instanceId, itemId: null }));
      const item = list[index] as EquipmentInstance | SkillStoneInstance;
      if (item.locked) return failure(createDomainError("ITEM_LOCKED", { instanceId: item.instanceId }));
      if (isEquipped(save, item.instanceId)) return failure(createDomainError("ITEM_EQUIPPED", { instanceId: item.instanceId }));
      list.splice(index, 1);
      next.gold += input.goldPrice;
      const entry = input.kind === "equipment"
        ? { sequence: this.nextSequence, kind: "equipment" as const, equipment: clone(item as EquipmentInstance), goldPrice: input.goldPrice }
        : { sequence: this.nextSequence, kind: "skillStone" as const, skillStone: clone(item as SkillStoneInstance), goldPrice: input.goldPrice };
      return success({ save: next, buyback: entry });
    }
    if (typeof input.itemId !== "string" || input.itemId.length === 0 || !Number.isSafeInteger(input.quantity) || input.quantity <= 0) return invalid("sell.stackableItem", "quantity_range");
    const owned = next.inventory.stackables[input.itemId] ?? 0;
    if (owned < input.quantity) return failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: input.itemId }));
    next.inventory.stackables[input.itemId] = owned - input.quantity;
    next.gold += input.goldPrice;
    return success({ save: next, buyback: { sequence: this.nextSequence, kind: "stackableItem", itemId: input.itemId, quantity: input.quantity, goldPrice: input.goldPrice } });
  }

  /** 保存成功后调用；失败路径不登记回购，避免内存状态与 Store 分叉。 */
  public recordBuyback(entry: BuybackEntryV1): void {
    if (entry.sequence !== this.nextSequence) throw new Error("BUYBACK_SEQUENCE_STALE");
    this.buybacks.set(entry.sequence, clone(entry));
    this.nextSequence += 1;
    while (this.buybacks.size > this.economy.buybackLimit) {
      const oldest = [...this.buybacks.keys()].sort((left, right) => left - right)[0];
      if (oldest === undefined) break;
      this.buybacks.delete(oldest);
    }
  }

  public buyback(save: GameSaveV1, sequence: number): DomainResult<BuybackResult> {
    const entry = this.buybacks.get(sequence);
    if (!entry) return failure(createDomainError("BUYBACK_UNAVAILABLE", { sequence }));
    if (save.gold < entry.goldPrice) return failure(createDomainError("INSUFFICIENT_GOLD", { required: entry.goldPrice, owned: save.gold }));
    const offer: ShopOfferV1 = entry.kind === "equipment"
      ? { offerId: `buyback_${entry.sequence}`, kind: "equipment", equipment: clone(entry.equipment), goldPrice: entry.goldPrice, sold: false }
      : entry.kind === "skillStone"
        ? { offerId: `buyback_${entry.sequence}`, kind: "skillStone", skillStone: clone(entry.skillStone), goldPrice: entry.goldPrice, sold: false }
        : { offerId: `buyback_${entry.sequence}`, kind: "stackableItem", itemId: entry.itemId, quantity: entry.quantity, goldPrice: entry.goldPrice, sold: false };
    const received = withInventory(save, offer);
    if (!received.ok) return received;
    received.value.gold -= entry.goldPrice;
    return success({ save: received.value, buyback: clone(entry) });
  }

  /** 回购候选保存成功后调用；失败不移除记录。 */
  public confirmBuyback(sequence: number): boolean { return this.buybacks.delete(sequence); }
  public clearSession(): void { this.buybacks.clear(); }
}
