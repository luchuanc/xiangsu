import type { ShopDefinition } from "../contracts";
import { EQUIPMENT_BASE_POOLS } from "./equipment";

/** 垂直切片只开放第一档商店，后续楼层档位由累计内容批次追加。 */
export const shops: ShopDefinition[] = [
  {
    id: "shop_town_merchant",
    npcId: "npc_merchant",
    tiers: [{
      minHighestUnlockedFloor: 1,
      offerCount: 8,
      itemLevelMin: 1,
      itemLevelMax: 5,
      offerKindWeights: { stackableItem: 45, equipment: 45, skillStone: 10 },
      stackableItems: [
        { itemId: "item_minor_potion", weight: 60, quantityMin: 1, quantityMax: 3 },
        { itemId: "item_forge_shard", weight: 20, quantityMin: 1, quantityMax: 2 },
        { itemId: "item_inscription_dust", weight: 20, quantityMin: 1, quantityMax: 2 },
      ],
      equipmentBasePools: EQUIPMENT_BASE_POOLS.map((group) => ({ slot: group.slot, weight: group.weight, bases: group.bases.map((entry) => ({ ...entry })) })),
      equipmentQualityWeights: [
        { quality: "common", weight: 40 },
        { quality: "magic", weight: 50 },
        { quality: "rare", weight: 10 },
        { quality: "epic", weight: 0 },
        { quality: "abyss", weight: 0 },
      ],
      skillStoneQualityWeights: [
        { quality: "magic", weight: 80 },
        { quality: "rare", weight: 20 },
        { quality: "epic", weight: 0 },
        { quality: "abyss", weight: 0 },
      ],
    }],
  },
];

export default shops;
