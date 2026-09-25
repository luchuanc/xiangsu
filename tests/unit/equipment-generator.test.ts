import { describe, expect, it } from "vitest";

import type { EquipmentAffixDefinition } from "../../src/content/contracts";
import { ECONOMY_DEFINITION } from "../../src/content/data/economy";
import {
  EQUIPMENT_AFFIX_DEFINITIONS,
  EQUIPMENT_BASE_DEFINITIONS,
  EQUIPMENT_BASE_POOLS,
} from "../../src/content/data/equipment";
import {
  EQUIPMENT_QUALITY_AFFIX_COUNT,
  EquipmentGenerator,
  generateEquipment,
  generateRandomEquipment,
  type EquipmentContentSource,
} from "../../src/domain/inventory/EquipmentGenerator";
import { SeededRng } from "../../src/domain/common/SeededRng";

const content: EquipmentContentSource = {
  equipmentBases: EQUIPMENT_BASE_DEFINITIONS,
  equipmentAffixes: EQUIPMENT_AFFIX_DEFINITIONS,
  economy: ECONOMY_DEFINITION,
};

function identity() {
  return {
    instanceId: "eq_test_001",
    acquiredAt: "2026-08-24T00:00:00.000Z",
    sourceTransactionId: "reward_test",
  } as const;
}

function generate(quality: "common" | "magic" | "rare" | "epic", craftGrade: "ordinary" | "tempered" | "exalted" | "weighted" = "ordinary") {
  return generateEquipment(content, {
    ...identity(),
    rng: SeededRng.fromSeed(42),
    baseId: "eq_accessory_t1_charm",
    itemLevel: 1,
    quality,
    craftGrade,
  });
}

describe("EquipmentGenerator", () => {
  it("严格生成 common/magic/rare/epic 的 0/2/3/4 条普通词条", () => {
    for (const quality of ["common", "magic", "rare", "epic"] as const) {
      const result = generate(quality);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.affixes).toHaveLength(EQUIPMENT_QUALITY_AFFIX_COUNT[quality]);
        expect(new Set(result.value.affixes.map((roll) => roll.affixId)).size).toBe(result.value.affixes.length);
        expect(result.value.abyssAffix).toBeNull();
        expect(result.value.reforgeCount).toBe(0);
      }
    }
  });

  it("同一 seed、同一身份生成字节级相同实例，闭区间值也走 RNG", () => {
    const left = generate("epic");
    const right = generate("epic");
    expect(left).toEqual(right);
    if (left.ok) expect(left.value.affixes.every((roll) => Number.isSafeInteger(roll.roll))).toBe(true);
  });

  it("指定 tempered/exalted 只强化合法普通词条，且固定王冠可带两条强化", () => {
    const tempered = generate("epic", "tempered");
    const exalted = generate("epic", "exalted");
    expect(tempered.ok && tempered.value.affixes.filter((roll) => roll.craftEmpowered)).toHaveLength(1);
    expect(exalted.ok && exalted.value.affixes.filter((roll) => roll.craftEmpowered)).toHaveLength(2);
    if (exalted.ok) expect(exalted.value.affixes.every((roll) => roll.craftEmpowered || roll.reforged === false)).toBe(true);
  });

  it("按部位→部位内底材两级抽取，并在空池时返回配置错误", () => {
    const result = generateRandomEquipment(content, {
      ...identity(),
      rng: SeededRng.fromSeed(7),
      itemLevelMin: 1,
      itemLevelMax: 5,
      equipmentBasePools: EQUIPMENT_BASE_POOLS,
      qualityWeights: [{ quality: "magic", weight: 100 }],
      guaranteedMinQuality: null,
      abyssUpgradeChanceBps: 0,
      craftGrade: "ordinary",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect((EQUIPMENT_BASE_DEFINITIONS.find((base) => base.id === result.value.baseId))?.slot).toBeDefined();

    const empty = generateRandomEquipment(content, {
      ...identity(),
      rng: SeededRng.fromSeed(7),
      itemLevelMin: 1,
      itemLevelMax: 1,
      equipmentBasePools: [],
      qualityWeights: [{ quality: "magic", weight: 100 }],
      guaranteedMinQuality: null,
      abyssUpgradeChanceBps: 0,
      craftGrade: "ordinary",
    });
    expect(empty).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
  });

  it("深渊品质需要合法深渊池，不会少生成一条或降级", () => {
    const abyss: EquipmentAffixDefinition = {
      id: "af_abyss_test",
      nameKey: "equipment.affix.af_abyss_test.name",
      descriptionKey: "equipment.affix.af_abyss_test.description",
      category: "damageType",
      pool: "abyss",
      allowedSlots: ["accessory"],
      allowedWeaponTypes: [],
      minItemLevel: 1,
      allowedQualities: ["abyss"],
      exclusiveGroup: null,
      stackRule: "add",
      weight: 1,
      goldValue: 1,
      canBeCraftEmpowered: false,
      tiers: [{ tier: 1, minItemLevel: 1, rollMin: 1, rollMax: 1 }],
      modifiers: [{ kind: "damageBonus", element: "dark", rollScaleBps: 10_000 }],
      tags: [{ tagId: "dark", count: 1 }],
    };
    const abyssContent = { ...content, equipmentAffixes: [...content.equipmentAffixes, abyss] };
    const result = generateEquipment(abyssContent, {
      ...identity(),
      rng: SeededRng.fromSeed(9),
      baseId: "eq_accessory_t1_charm",
      itemLevel: 1,
      quality: "abyss",
      craftGrade: "ordinary",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.abyssAffix?.affixId).toBe("af_abyss_test");
  });
});

describe("EquipmentGenerator adapter", () => {
  it("从注入的 ID 和时钟生成身份，不让身份污染 RNG", () => {
    const service = new EquipmentGenerator(content, {
      idFactory: () => "eq_injected",
      clock: () => "2026-08-24T01:02:03.000Z",
    });
    const result = service.generateRandom({
      rng: SeededRng.fromSeed(1),
      itemLevelMin: 1,
      itemLevelMax: 1,
      equipmentBasePools: EQUIPMENT_BASE_POOLS,
      qualityWeights: [{ quality: "common", weight: 100 }],
      guaranteedMinQuality: null,
      abyssUpgradeChanceBps: 0,
      craftGrade: "ordinary",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ instanceId: "eq_injected", acquiredAt: "2026-08-24T01:02:03.000Z" });
  });
});
