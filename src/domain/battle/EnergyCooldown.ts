/** 战斗资源规则的纯函数：能量上限、N+1 冷却和本人 TURN_END 递减。 */
import type { BattleUnitStateV1, SkillDefinition } from "../../content/contracts";

export const MAX_BATTLE_ENERGY = 100;
export const BASIC_ENERGY_GAIN = 25;
export const ACTIVE_ENERGY_GAIN = 10;
export const DEFEND_ENERGY_GAIN = 15;
export const ULTIMATE_ENERGY_COST = 100;

export interface SkillResourceCost {
  readonly energyCost: number;
  readonly cooldownTurns: number;
  readonly cooldownDelta?: number;
}

export type ResourceCheck = {
  readonly ok: true;
} | {
  readonly ok: false;
  readonly reason: "cooldown" | "energy";
  readonly remaining?: number;
  readonly required?: number;
  readonly owned?: number;
};

export function clampEnergy(value: number): number {
  return Math.max(0, Math.min(MAX_BATTLE_ENERGY, Math.floor(value)));
}

export function getSkillResourceCost(skill: Readonly<SkillDefinition>, level: number): SkillResourceCost {
  const index = Math.max(0, Math.min(4, Math.floor(level) - 1));
  return { energyCost: skill.energyCostByLevel[index], cooldownTurns: skill.cooldownTurnsByLevel[index] };
}

export function checkSkillResource(
  unit: Readonly<BattleUnitStateV1>,
  skill: Readonly<SkillDefinition>,
  level: number,
  isUltimate = false,
): ResourceCheck {
  const cost = getSkillResourceCost(skill, level);
  const remaining = unit.cooldowns[skill.id] ?? 0;
  if (remaining > 0) return { ok: false, reason: "cooldown", remaining };
  const required = isUltimate ? ULTIMATE_ENERGY_COST : cost.energyCost;
  if (unit.energy < required) return { ok: false, reason: "energy", required, owned: unit.energy };
  return { ok: true };
}

/** 成功使用冷却技能时写入 N+1；basic/fallback 没有模板 CD 写入。 */
export function startSkillCooldown(
  cooldowns: Readonly<Record<string, number>>,
  skillId: string,
  baseCooldown: number,
  cooldownDelta = 0,
): Record<string, number> {
  return { ...cooldowns, [skillId]: Math.max(0, Math.floor(baseCooldown + cooldownDelta)) + 1 };
}

export function decrementCooldowns(cooldowns: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(cooldowns).map(([skillId, value]) => [skillId, Math.max(0, Math.floor(value) - 1)]));
}

export function applyEnergyGain(current: number, amount: number): number {
  return clampEnergy(current + amount);
}

export function applyEnergyCost(current: number, amount: number): number {
  return clampEnergy(current - Math.max(0, amount));
}

export function actionEnergyGain(kind: "basic" | "active" | "ultimate" | "defend" | "item"): number {
  switch (kind) {
    case "basic": return BASIC_ENERGY_GAIN;
    case "active": return ACTIVE_ENERGY_GAIN;
    case "defend": return DEFEND_ENERGY_GAIN;
    case "ultimate":
    case "item": return 0;
  }
}

export function isCooldownAvailable(unit: Readonly<BattleUnitStateV1>, skillId: string): boolean {
  return (unit.cooldowns[skillId] ?? 0) === 0;
}
