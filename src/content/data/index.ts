/**
 * 仅用于 RPG-002 单测的最小内容夹具。
 * 正式十层内容由后续内容卡写入；这里不伪装成 final 数据。
 */
import type { ContentRootV1, EffectSpec, SkillDefinition, StatBlock } from "../contracts";
import { abyssEchoContentRoot } from "./abyssEchoes";

const fixtureStats: StatBlock = {
  maxHp: 100,
  attack: 10,
  defense: 10,
  speed: 10,
  critRateBps: 0,
  critDamageBps: 15_000,
  effectHitBps: 0,
  effectResistBps: 0,
};
const emptyEffects: [EffectSpec[], EffectSpec[], EffectSpec[], EffectSpec[], EffectSpec[]] = [[], [], [], [], []];

function fixtureSkill(id: string, kind: SkillDefinition["kind"]): SkillDefinition {
  return {
    id,
    nameKey: `skill.${id}.name`,
    descriptionKey: `skill.${id}.description`,
    owner: { kind: "character", characterId: "char_wanderer" },
    familyIds: [],
    kind,
    unlockLevel: 1,
    maxLevel: kind === "active" ? 5 : 1,
    targetRule: "self",
    requiresFrontAccess: false,
    cooldownTurnsByLevel: [0, 0, 0, 0, 0],
    energyCostByLevel: [0, 0, 0, 0, 0],
    baseEnergyGainByLevel: [0, 0, 0, 0, 0],
    effectsByLevel: emptyEffects,
    passiveModifiers: [],
    tags: [],
    animationId: `anim_${id}`,
  };
}

const fixtureSkillIds = [
  "skill_fixture_basic",
  "skill_fixture_active_1",
  "skill_fixture_active_2",
  "skill_fixture_active_3",
  "skill_fixture_active_4",
  "skill_fixture_ultimate",
  "skill_fixture_passive",
] as const;

const skills: SkillDefinition[] = [
  fixtureSkill(fixtureSkillIds[0], "basic"),
  fixtureSkill(fixtureSkillIds[1], "active"),
  fixtureSkill(fixtureSkillIds[2], "active"),
  fixtureSkill(fixtureSkillIds[3], "active"),
  fixtureSkill(fixtureSkillIds[4], "active"),
  fixtureSkill(fixtureSkillIds[5], "ultimate"),
  fixtureSkill(fixtureSkillIds[6], "passive"),
];

export const fixtureContentRoot: ContentRootV1 = {
  schemaVersion: 1,
  contentVersion: "content-1.2.0",
  protagonistCharacterId: "char_wanderer",
  characters: [{
    id: "char_wanderer",
    nameKey: "character.char_wanderer.name",
    role: "fighter",
    allowedWeaponTypes: ["sword"],
    baseStats: fixtureStats,
    growthPerLevel: { ...fixtureStats, maxHp: 0, attack: 0, defense: 0, speed: 0 },
    innateTags: [],
    basicSkillId: fixtureSkillIds[0],
    activeSkillIds: [fixtureSkillIds[1], fixtureSkillIds[2], fixtureSkillIds[3], fixtureSkillIds[4]],
    ultimateSkillId: fixtureSkillIds[5],
    passiveSkillId: fixtureSkillIds[6],
    fieldSpriteId: "sprite_field_char_wanderer",
    battleSpriteId: "sprite_battle_char_wanderer",
  }],
  skills,
  statuses: [],
  equipmentBases: [],
  equipmentAffixes: [],
  affixTriggers: [],
  skillAffixes: [],
  combos: [],
  enemies: [],
  encounters: [],
  encounterModifiers: [],
  bossIntents: [],
  abyssEchoes: [],
  floors: [],
  maps: [],
  npcs: [],
  dialogues: [],
  quests: [],
  recruitments: [],
  shops: [],
  items: [
    { id: "item_forge_shard", nameKey: "item.item_forge_shard.name", category: "material", maxStack: 99, baseGoldValue: 5, iconId: "icon_item_forge_shard" },
    { id: "item_inscription_dust", nameKey: "item.item_inscription_dust.name", category: "material", maxStack: 99, baseGoldValue: 5, iconId: "icon_item_inscription_dust" },
  ],
  dropTables: [],
  economy: {
    equipmentSellRateBps: 2500,
    shopBuyMarkupBps: 20_000,
    buybackLimit: 10,
    innCostGold: 0,
    craftGradeWeights: { ordinary: 70, tempered: 25, exalted: 5 },
    equipmentDisassembleYieldByQuality: { common: 1, magic: 2, rare: 4, epic: 8, abyss: 16 },
    skillStoneDisassembleYieldByQuality: { magic: 2, rare: 4, epic: 8, abyss: 16 },
    equipmentDisassembleMaterialItemId: "item_forge_shard",
    skillStoneDisassembleMaterialItemId: "item_inscription_dust",
    stackableTotalCap: 9999,
    equipmentReforgeBaseCost: 5,
    equipmentReforgePerItemLevelCost: 1,
    skillStoneReforgeBaseCost: 5,
    skillStoneReforgePerTwoItemLevelsCost: 1,
  },
};

/** 生产候选继续指向夹具；fixture/candidate 不得伪装成正式累计内容。 */
export const candidateContentRoot = fixtureContentRoot;
/** final 读取十层累计根并附加十条回响，避免脚本继续误用 fixture。 */
export const finalContentRoot = abyssEchoContentRoot;
