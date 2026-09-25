import { describe, expect, it } from "vitest";
import { ContentCatalog, FROZEN_BATCH_MANIFESTS } from "../../src/content/Catalog";
import { abyssEchoContentRoot, ABYSS_ECHO_DEFINITIONS } from "../../src/content/data/abyssEchoes";

const expected = [
  ["echo_f06_iron", "floor_06", "encounter_floor_06_boss", 11500, 11000, 10000, 10000, -1, 2, 11, 2, 0, 800, 10, 10],
  ["echo_f06_hunger", "floor_06", "encounter_floor_06_boss", 12000, 11500, 10500, 10000, -1, 1, 12, 0, 1, 1200, 12, 12],
  ["echo_f07_red_tide", "floor_07", "encounter_floor_07_boss", 11500, 11500, 10000, 10500, -1, 2, 12, 2, 0, 1000, 12, 12],
  ["echo_f07_blood_oath", "floor_07", "encounter_floor_07_boss", 12500, 12000, 10500, 10500, -2, 1, 13, 0, 1, 1400, 14, 14],
  ["echo_f08_white_wall", "floor_08", "encounter_floor_08_boss", 12000, 11000, 11500, 10000, -1, 2, 13, 2, 0, 1200, 14, 14],
  ["echo_f08_silent_prison", "floor_08", "encounter_floor_08_boss", 12500, 11500, 12000, 10500, -2, 0, 14, 1, 1, 1600, 16, 16],
  ["echo_f09_storm_eye", "floor_09", "encounter_floor_09_boss", 11500, 11500, 10000, 11500, -1, 2, 10, 2, 0, 1400, 16, 16],
  ["echo_f09_rewrite", "floor_09", "encounter_floor_09_boss", 12500, 12000, 10500, 12000, -2, 1, 11, 0, 1, 1800, 18, 18],
  ["echo_f10_dark_throne", "floor_10", "encounter_floor_10_boss", 12000, 11500, 11000, 10500, -1, 2, 13, 2, 1, 1800, 20, 20],
  ["echo_f10_endless_king", "floor_10", "encounter_floor_10_boss", 13000, 12000, 11500, 11000, -2, 0, 14, 0, 1, 2200, 25, 25],
] as const;

describe("RPG-028 深渊回响内容", () => {
  it("逐行冻结 10 个定义、倍率、目标和首通材料", () => {
    expect(ABYSS_ECHO_DEFINITIONS).toHaveLength(10);
    expect(ABYSS_ECHO_DEFINITIONS.map((echo) => [
      echo.id, echo.floorId, echo.bossEncounterId,
      echo.enemyHpBps, echo.enemyAttackBps, echo.enemyDefenseBps, echo.enemySpeedBps,
      echo.enrageRoundDelta, echo.itemUseLimit, echo.objective.maxRounds,
      echo.objective.maxKnockouts, echo.objective.requiredAnyComboTriggers,
      echo.bonusAbyssUpgradeChanceBps, echo.firstClearForgeShards, echo.firstClearInscriptionDust,
    ])).toEqual(expected);
  });

  it("name/description key 严格按回响 ID 生成且累计批次可建目录", () => {
    expect(ABYSS_ECHO_DEFINITIONS.every((echo) =>
      echo.nameKey === `abyss_echo.${echo.id}.name`
      && echo.descriptionKey === `abyss_echo.${echo.id}.description`)).toBe(true);
    expect(FROZEN_BATCH_MANIFESTS.abyssEchoes.abyssEchoes).toEqual(ABYSS_ECHO_DEFINITIONS.map((echo) => echo.id));
    expect(ContentCatalog.create(abyssEchoContentRoot, { kind: "batch", batchId: "abyssEchoes" })).toMatchObject({ ok: true });
  });

  it("所有回响只引用第 6～10 层对应层主且不重复", () => {
    expect(new Set(ABYSS_ECHO_DEFINITIONS.map((echo) => echo.id)).size).toBe(10);
    for (const echo of ABYSS_ECHO_DEFINITIONS) {
      const floorNumber = Number(echo.floorId.slice(-2));
      expect(floorNumber).toBeGreaterThanOrEqual(6);
      expect(floorNumber).toBeLessThanOrEqual(10);
      expect(echo.bossEncounterId).toBe(`encounter_floor_${String(floorNumber).padStart(2, "0")}_boss`);
    }
  });
});
