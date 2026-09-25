import type { StackableItemDefinition } from "../contracts";

const definitions: StackableItemDefinition[] = [
  { id: "item_forge_shard", nameKey: "item.item_forge_shard.name", category: "material", maxStack: 99, baseGoldValue: 5, iconId: "icon_item_forge_shard" },
  { id: "item_inscription_dust", nameKey: "item.item_inscription_dust.name", category: "material", maxStack: 99, baseGoldValue: 5, iconId: "icon_item_inscription_dust" },
  { id: "item_minor_potion", nameKey: "item.item_minor_potion.name", category: "consumable", maxStack: 99, baseGoldValue: 20, iconId: "icon_item_minor_potion", useContexts: ["field", "battle"], targetRule: "singleAlly", effects: [{ kind: "heal", targetRule: "singleAlly", scalingStat: "maxHp", powerBps: 2500, flatPower: 0, canCrit: false }] },
  { id: "item_major_potion", nameKey: "item.item_major_potion.name", category: "consumable", maxStack: 99, baseGoldValue: 60, iconId: "icon_item_major_potion", useContexts: ["field", "battle"], targetRule: "singleAlly", effects: [{ kind: "heal", targetRule: "singleAlly", scalingStat: "maxHp", powerBps: 5000, flatPower: 0, canCrit: false }] },
  { id: "item_cleansing_tonic", nameKey: "item.item_cleansing_tonic.name", category: "consumable", maxStack: 99, baseGoldValue: 45, iconId: "icon_item_cleansing_tonic", useContexts: ["battle"], targetRule: "singleAlly", effects: [{ kind: "dispel", targetRule: "singleAlly", polarity: "debuff", count: 1 }] },
];

/** RPG-022 第一层可用堆叠物；药水效果按契约固定为 maxHp 治疗。 */
export const ITEM_DEFINITIONS: readonly StackableItemDefinition[] = Object.freeze(definitions);
export const itemDefinitionsReadonly = ITEM_DEFINITIONS;
export const items = ITEM_DEFINITIONS;

