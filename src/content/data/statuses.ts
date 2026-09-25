import type { StatusDefinition } from "../contracts";

const statusDefinitions: StatusDefinition[] = [
  { id: "status_bleed", nameKey: "status.status_bleed.name", polarity: "debuff", maxStacks: 5, refreshRule: "independentStacks", triggerTiming: "afterAction", effect: { kind: "periodicDamage", element: "physical", snapshotPowerBps: 2500 }, canDispel: true, immunityTag: "bleed", iconId: "icon_status_bleed" },
  { id: "status_burn", nameKey: "status.status_burn.name", polarity: "debuff", maxStacks: 5, refreshRule: "independentStacks", triggerTiming: "turnEnd", effect: { kind: "periodicDamage", element: "fire", snapshotPowerBps: 3000 }, canDispel: true, immunityTag: "burn", iconId: "icon_status_burn" },
  { id: "status_poison", nameKey: "status.status_poison.name", polarity: "debuff", maxStacks: 5, refreshRule: "independentStacks", triggerTiming: "turnEnd", effect: { kind: "periodicDamage", element: "poison", snapshotPowerBps: 2500 }, canDispel: true, immunityTag: "poison", iconId: "icon_status_poison" },
  { id: "status_slow", nameKey: "status.status_slow.name", polarity: "debuff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "speed", flat: 0, percentBps: -2000 }, canDispel: true, immunityTag: "slow", iconId: "icon_status_slow" },
  { id: "status_freeze", nameKey: "status.status_freeze.name", polarity: "debuff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "turnStart", effect: { kind: "skipTurn" }, canDispel: true, immunityTag: "freeze", iconId: "icon_status_freeze" },
  { id: "status_stun", nameKey: "status.status_stun.name", polarity: "debuff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "turnStart", effect: { kind: "skipTurn" }, canDispel: true, immunityTag: "stun", iconId: "icon_status_stun" },
  { id: "status_taunt", nameKey: "status.status_taunt.name", polarity: "debuff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "taunt" }, canDispel: true, immunityTag: "taunt", iconId: "icon_status_taunt" },
  { id: "status_guard_30", nameKey: "status.status_guard_30.name", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "guard", directDamageReductionBps: 3000 }, canDispel: true, immunityTag: null, iconId: "icon_status_guard_30" },
  { id: "status_shield", nameKey: "status.status_shield.name", polarity: "buff", maxStacks: 99, refreshRule: "independentStacks", triggerTiming: "none", effect: { kind: "shield" }, canDispel: true, immunityTag: null, iconId: "icon_status_shield" },
  { id: "status_marked", nameKey: "status.status_marked.name", polarity: "debuff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "defense", flat: 0, percentBps: -1500 }, canDispel: true, immunityTag: "marked", iconId: "icon_status_marked" },
  { id: "status_haste", nameKey: "status.status_haste.name", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "speed", flat: 0, percentBps: 2000 }, canDispel: true, immunityTag: null, iconId: "icon_status_haste" },
  { id: "status_attack_up", nameKey: "status.status_attack_up.name", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "attack", flat: 0, percentBps: 2500 }, canDispel: true, immunityTag: null, iconId: "icon_status_attack_up" },
  { id: "status_defense_up", nameKey: "status.status_defense_up.name", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "defense", flat: 0, percentBps: 2000 }, canDispel: true, immunityTag: null, iconId: "icon_status_defense_up" },
  { id: "status_fear", nameKey: "status.status_fear.name", polarity: "debuff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "attack", flat: 0, percentBps: -1500 }, canDispel: true, immunityTag: "fear", iconId: "icon_status_fear" },
  { id: "status_shock", nameKey: "status.status_shock.name", polarity: "debuff", maxStacks: 3, refreshRule: "independentStacks", triggerTiming: "none", effect: { kind: "statModifier", stat: "speed", flat: 0, percentBps: -500 }, canDispel: true, immunityTag: "shock", iconId: "icon_status_shock" },
  { id: "status_boss_phase_2", nameKey: "status.status_boss_phase_2.name", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "attack", flat: 0, percentBps: 1500 }, canDispel: false, immunityTag: "bossPhase", iconId: "icon_status_boss_phase_2" },
  { id: "status_boss_phase_3", nameKey: "status.status_boss_phase_3.name", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "speed", flat: 0, percentBps: 2000 }, canDispel: false, immunityTag: "bossPhase", iconId: "icon_status_boss_phase_3" },
  { id: "status_boss_enrage", nameKey: "status.status_boss_enrage.name", polarity: "buff", maxStacks: 1, refreshRule: "replaceDuration", triggerTiming: "none", effect: { kind: "statModifier", stat: "attack", flat: 0, percentBps: 5000 }, canDispel: false, immunityTag: "bossEnrage", iconId: "icon_status_boss_enrage" },
];

/** BAL-1.2 固定 18 条状态。 */
export const STATUS_DEFINITIONS: readonly StatusDefinition[] = Object.freeze(statusDefinitions);
export const statusDefinitionsReadonly = STATUS_DEFINITIONS;
export const statuses = STATUS_DEFINITIONS;

