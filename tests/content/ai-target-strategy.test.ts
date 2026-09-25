import { describe, expect, it } from "vitest";

import { abyssEchoContentRoot } from "../../src/content/data/abyssEchoes";

describe("正式内容的群体 AI 目标策略", () => {
  it("群体 targetRule 必须使用 self 策略，避免 EnemyAi 在正式内容上拒绝", () => {
    const skillById = new Map(abyssEchoContentRoot.skills.map((skill) => [skill.id, skill]));
    const expected = [
      ["boss_brood_spider", "skill_boss_brood_venom_web"],
      ["boss_iron_devourer", "skill_boss_iron_quake"],
      ["boss_bog_witch", "skill_boss_witch_miasma"],
      ["boss_ember_guardian", "skill_boss_ember_sweep"],
      ["enemy_bomb_goblin", "skill_enemy_burn_all"],
      ["enemy_ash_cultist", "skill_enemy_fear_all"],
      ["boss_abyss_king", "skill_boss_king_dark_wave"],
    ] as const;

    for (const [enemyId, skillId] of expected) {
      const skill = skillById.get(skillId);
      expect(skill?.targetRule, `${enemyId}.${skillId}`).toBe("allEnemies");
      const enemy = abyssEchoContentRoot.enemies.find((value) => value.id === enemyId);
      const rule = enemy?.aiRules.find((value) => value.skillId === skillId);
      expect(rule, `${enemyId}.${skillId} rule`).toBeDefined();
      expect(rule?.targetStrategy, `${enemyId}.${skillId} strategy`).toBe("self");
    }
  });
});
