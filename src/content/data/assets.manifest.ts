import { withCompletedArt } from "./completion-art";
import {
  MUSIC_BASE_GAIN_BPS,
  MUSIC_IDS,
  SFX_BASE_GAIN_BPS,
  type MusicId,
  type SfxId,
} from "../../app/AudioService";
import {
  ANIMATION_DEFINITIONS,
  type AnimationDefinitionV1,
} from "./animations";

export type AssetSourceKind = "generated" | "original" | "licensed";
export interface AssetSourceRecord {
  sourceKind: AssetSourceKind;
  sourceNote: string;
  licenseId: string;
}

export interface FieldDirectionClipsV1 {
  row: 0 | 1 | 2 | 3;
  idle: { startColumn: 0; frameCount: 4; fps: 6 };
  walk: { startColumn: 4; frameCount: 6; fps: 10 };
}
export interface FieldActorClipsV1 {
  down: FieldDirectionClipsV1;
  left: FieldDirectionClipsV1;
  right: FieldDirectionClipsV1;
  up: FieldDirectionClipsV1;
}
export interface BattleActorClipsV1 {
  idle: { startFrame: 0; frameCount: 4; fps: 6; loop: true };
  attack: { startFrame: 4; frameCount: 6; fps: 12; loop: false; impactFrame: 8 };
  skill: { startFrame: 10; frameCount: 8; fps: 12; loop: false; impactFrame: 15 };
  hit: { startFrame: 18; frameCount: 3; fps: 12; loop: false };
  down: { startFrame: 21; frameCount: 6; fps: 10; loop: false };
}

export type AssetEntryV1 =
  | { kind: "fieldActorSheet"; id: string; bundleId: string; src: string; frameWidth: 24; frameHeight: 32; columns: 10; rows: 4; clips: FieldActorClipsV1; source: AssetSourceRecord }
  | { kind: "battleActorSheet"; id: string; bundleId: string; src: string; frameWidth: 48 | 64; frameHeight: 48 | 64; columns: 27; rows: 1; clips: BattleActorClipsV1; source: AssetSourceRecord }
  | { kind: "singleFrame"; id: string; bundleId: string; src: string; width: 16 | 24 | 32; height: 16 | 24 | 32; source: AssetSourceRecord }
  | { kind: "mapTileset"; id: string; bundleId: string; src: string; tileSize: 16; columns: number; rows: number; source: AssetSourceRecord }
  | { kind: "atlas"; id: string; bundleId: string; imageSrc: string; dataSrc: string; requiredFrames: string[]; source: AssetSourceRecord }
  | { kind: "bitmapFont"; id: string; bundleId: string; descriptorSrc: string; textureSrc: string; glyphHeight: 16; source: AssetSourceRecord }
  | { kind: "image"; id: string; bundleId: string; src: string; width: number; height: number; source: AssetSourceRecord }
  | { kind: "audio"; id: string; bundleId: string; oggSrc: string; mp3Src: string; channel: "music" | "sfx"; loop: boolean; baseGainBps: number; source: AssetSourceRecord };

export interface AssetBundleDefinitionV1 {
  id: string;
  dependsOn: string[];
  assetIds: string[];
}

export interface AssetManifestV1 {
  schemaVersion: 1;
  contentVersion: "content-1.2.0";
  bundles: AssetBundleDefinitionV1[];
  assets: AssetEntryV1[];
  animations: AnimationDefinitionV1[];
}

const fixtureSource = (): AssetSourceRecord => ({
  sourceKind: "generated",
  sourceNote: "RPG-022 生成的项目原创像素占位资源；后续可替换物理文件但不得改变逻辑 ID、尺寸或帧名。",
  licenseId: "project-original-placeholder",
});

/** VIS-002C 正式地图来自 art-pack 的确定性手工像素绘制，不携带未声明的 licenseFile。 */
const visualV1Source = (sourceNote: string): AssetSourceRecord => ({
  sourceKind: "original",
  sourceNote,
  licenseId: "project-original",
});

const bundle = (id: string, dependsOn: string[], assetIds: string[]): AssetBundleDefinitionV1 => ({ id, dependsOn, assetIds });

const VERTICAL_SLICE_CHARACTERS = ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest"] as const;
const VERTICAL_SLICE_ENCOUNTERS = [
  "encounter_floor_01_normal_a", "encounter_floor_01_normal_b", "encounter_floor_01_normal_c",
  "encounter_floor_01_elite_boar", "encounter_floor_01_boss",
] as const;
const VERTICAL_SLICE_ENEMIES = ["enemy_grass_slime", "enemy_thorn_rat", "enemy_fang_wolf", "enemy_goblin_scout", "enemy_stonehide_boar", "boss_horned_king"] as const;
const VERTICAL_SLICE_NPCS = ["npc_tavern_keeper", "npc_blacksmith", "npc_skill_mentor", "npc_merchant", "npc_innkeeper"] as const;
const VERTICAL_SLICE_EQUIPMENT = [
  "eq_sword_t1_windblade", "eq_hammer_t1_stonemaul", "eq_bow_t1_reed", "eq_staff_t1_oak", "eq_focus_t1_frostglass", "eq_relic_t1_prayer",
  "eq_helmet_t1_traveler", "eq_armor_t1_leather", "eq_gloves_t1_hide", "eq_boots_t1_cloth", "eq_accessory_t1_charm",
] as const;
const VERTICAL_SLICE_STATUSES = [
  "status_bleed", "status_burn", "status_poison", "status_slow", "status_freeze", "status_stun", "status_taunt", "status_guard_30", "status_shield",
  "status_marked", "status_haste", "status_attack_up", "status_defense_up", "status_fear", "status_shock", "status_boss_phase_2", "status_boss_phase_3", "status_boss_enrage",
] as const;
const VERTICAL_SLICE_COMBOS = ["combo_ember_chain", "combo_iron_reprise", "combo_blood_hunt", "combo_holy_bulwark"] as const;
const VERTICAL_SLICE_ITEMS = ["item_forge_shard", "item_inscription_dust", "item_minor_potion", "item_major_potion", "item_cleansing_tonic"] as const;

const fieldAssetIds = (prefix: string, ids: readonly string[]): string[] => ids.map((id) => `${prefix}${id}`);
const playerFieldAssetIds = fieldAssetIds("sprite_field_", VERTICAL_SLICE_CHARACTERS);
const playerBattleAssetIds = VERTICAL_SLICE_CHARACTERS.map((id) => `sprite_battle_${id}`);
const encounterFieldAssetIds = fieldAssetIds("sprite_field_", VERTICAL_SLICE_ENCOUNTERS);
const npcFieldAssetIds = fieldAssetIds("sprite_", VERTICAL_SLICE_NPCS);
const enemyBattleAssetIds = VERTICAL_SLICE_ENEMIES.map((id) => `sprite_battle_${id}`);
const equipmentAssetIds = fieldAssetIds("sprite_", VERTICAL_SLICE_EQUIPMENT);
const statusAssetIds = fieldAssetIds("icon_", VERTICAL_SLICE_STATUSES);
const comboAssetIds = fieldAssetIds("icon_", VERTICAL_SLICE_COMBOS);
const itemAssetIds = fieldAssetIds("icon_", VERTICAL_SLICE_ITEMS);

const verticalSliceBundles: AssetBundleDefinitionV1[] = [
  bundle("boot", [], ["font_pixel_zh_cn", "image_boot_logo", "image_boot_background", "bgm_title"]),
  bundle("core_ui", ["boot"], ["atlas_core_ui", "sfx_ui_confirm", "sfx_ui_cancel", "sfx_ui_error", "sfx_combo_unlock", ...equipmentAssetIds, ...statusAssetIds, ...comboAssetIds, ...itemAssetIds]),
  bundle("player_common", ["core_ui"], ["bgm_field", "sfx_step", "sfx_encounter", ...playerFieldAssetIds, ...playerBattleAssetIds]),
  bundle("town", ["player_common"], ["tileset_map_town", "bgm_town", ...npcFieldAssetIds]),
  bundle("battle_common", ["player_common"], ["atlas_battle_fx", "bgm_boss", "bgm_final_boss", "sfx_attack", "sfx_skill", "sfx_hit", "sfx_heal", "sfx_status", "sfx_combo_trigger", "sfx_loot_rare", "sfx_loot_abyss", "sfx_boss_phase", "sfx_battle_result"]),
  bundle("abyss_common", ["player_common"], []),
  bundle("floor_01", ["player_common"], ["tileset_map_floor_01", ...encounterFieldAssetIds, ...enemyBattleAssetIds]),
  bundle("floor_02", ["player_common"], []),
  bundle("floor_03", ["player_common"], []),
  bundle("floor_04", ["player_common"], []),
  bundle("floor_05", ["player_common"], []),
  bundle("floor_06", ["player_common", "abyss_common"], []),
  bundle("floor_07", ["player_common", "abyss_common"], []),
  bundle("floor_08", ["player_common", "abyss_common"], []),
  bundle("floor_09", ["player_common", "abyss_common"], []),
  bundle("floor_10", ["player_common", "abyss_common"], []),
];

const CORE_UI_FRAMES = [
  "panel_9s", "button_normal_9s", "button_pressed_9s", "button_disabled_9s", "slot_empty", "slot_locked", "quality_common", "quality_magic", "quality_rare", "quality_epic", "quality_abyss", "cursor_target", "marker_interact", "marker_alert", "marker_boss", "marker_elite", "object_chest_closed", "object_portal_floor", "object_portal_return", "icon_gold", "icon_energy", "icon_hp", "icon_attack", "icon_defense", "icon_speed", "icon_critical", "icon_close", "icon_back", "icon_menu", "icon_warning",
];
const BATTLE_FX_FRAMES = [
  "fx_slash_00", "fx_slash_01", "fx_slash_02", "fx_slash_03", "fx_slash_04", "fx_slash_05", "fx_projectile_physical", "fx_projectile_fire", "fx_projectile_frost", "fx_projectile_lightning", "fx_projectile_holy", "fx_projectile_dark", "fx_projectile_poison", "fx_projectile_true", "fx_area_00", "fx_area_01", "fx_area_02", "fx_area_03", "fx_area_04", "fx_area_05", "fx_area_06", "fx_area_07", "fx_heal_00", "fx_heal_01", "fx_heal_02", "fx_heal_03", "fx_heal_04", "fx_heal_05", "fx_shield_00", "fx_shield_01", "fx_shield_02", "fx_shield_03", "fx_shield_04", "fx_shield_05", "fx_status_00", "fx_status_01", "fx_status_02", "fx_status_03", "fx_summon_00", "fx_summon_01", "fx_summon_02", "fx_summon_03", "fx_summon_04", "fx_summon_05", "fx_summon_06", "fx_summon_07",
];

const fieldClips: FieldActorClipsV1 = {
  down: { row: 0, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
  left: { row: 1, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
  right: { row: 2, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
  up: { row: 3, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
};
const battleClips: BattleActorClipsV1 = {
  idle: { startFrame: 0, frameCount: 4, fps: 6, loop: true },
  attack: { startFrame: 4, frameCount: 6, fps: 12, loop: false, impactFrame: 8 },
  skill: { startFrame: 10, frameCount: 8, fps: 12, loop: false, impactFrame: 15 },
  hit: { startFrame: 18, frameCount: 3, fps: 12, loop: false },
  down: { startFrame: 21, frameCount: 6, fps: 10, loop: false },
};

function imageEntry(id: string, bundleId: string, src: string, width: number, height: number): AssetEntryV1 {
  return { kind: "image", id, bundleId, src, width, height, source: fixtureSource() };
}

/** VIS-002D 产出的正式 field actor 只在选定批次激活，逻辑 ID 与裁剪契约保持不变。 */
function visualFieldActorEntry(id: string, bundleId: string): AssetEntryV1 {
  return {
    kind: "fieldActorSheet",
    id,
    bundleId,
    src: `/assets/visual/v1/field/${id}.png`,
    frameWidth: 24,
    frameHeight: 32,
    columns: 10,
    rows: 4,
    clips: fieldClips,
    source: visualV1Source("确定性手工像素绘制的 field actor sheet，项目原创。"),
  };
}

/** VIS-004B 只在 verticalSlice 正式批次激活已生成的 battle actor，不改变 fixture/candidate 占位语义。 */
function visualBattleActorEntry(id: string, bundleId: string, boss = false): AssetEntryV1 {
  const frameSize = boss ? 64 : 48;
  return {
    kind: "battleActorSheet",
    id,
    bundleId,
    src: `/assets/visual/v1/battle/${id}.png`,
    frameWidth: frameSize,
    frameHeight: frameSize,
    columns: 27,
    rows: 1,
    clips: battleClips,
    source: visualV1Source("确定性手工像素绘制的 battle actor sheet，项目原创。"),
  };
}

function singleFrameEntry(id: string, width: 16 | 24 | 32, height: 16 | 24 | 32): AssetEntryV1 {
  return { kind: "singleFrame", id, bundleId: "core_ui", src: `/assets/placeholder/icons/${id}.png`, width, height, source: fixtureSource() };
}

function audioEntry(id: MusicId | SfxId, bundleId: string): AssetEntryV1 {
  const isMusic = (MUSIC_IDS as readonly string[]).includes(id);
  return {
    kind: "audio",
    id,
    bundleId,
    oggSrc: `/assets/placeholder/audio/${id}.ogg`,
    mp3Src: `/assets/placeholder/audio/${id}.mp3`,
    channel: isMusic ? "music" : "sfx",
    loop: isMusic,
    baseGainBps: isMusic ? MUSIC_BASE_GAIN_BPS[id as MusicId] : SFX_BASE_GAIN_BPS[id as SfxId],
    source: fixtureSource(),
  };
}

function fixtureAudioEntry(id: MusicId | SfxId, bundleId: string): AssetEntryV1 {
  const entry = audioEntry(id, bundleId);
  if (entry.kind !== "audio") throw new Error("fixture 音频构造器只能接收 audio entry");
  return {
    ...entry,
    oggSrc: `__fixture__/audio/${id}.ogg`,
    mp3Src: `__fixture__/audio/${id}.mp3`,
  };
}

const verticalSliceAssets: AssetEntryV1[] = [
  { kind: "bitmapFont", id: "font_pixel_zh_cn", bundleId: "boot", descriptorSrc: "/assets/placeholder/fonts/pixel.zh-cn.fnt", textureSrc: "/assets/placeholder/fonts/pixel.zh-cn.png", glyphHeight: 16, source: fixtureSource() },
  imageEntry("image_boot_logo", "boot", "/assets/placeholder/images/boot-logo.png", 320, 96),
  imageEntry("image_boot_background", "boot", "/assets/placeholder/images/boot-background.png", 640, 360),
  { kind: "atlas", id: "atlas_core_ui", bundleId: "core_ui", imageSrc: "/assets/placeholder/atlases/core-ui.png", dataSrc: "/assets/placeholder/atlases/core-ui.json", requiredFrames: [...CORE_UI_FRAMES], source: fixtureSource() },
  { kind: "atlas", id: "atlas_battle_fx", bundleId: "battle_common", imageSrc: "/assets/placeholder/atlases/battle-fx.png", dataSrc: "/assets/placeholder/atlases/battle-fx.json", requiredFrames: [...BATTLE_FX_FRAMES], source: fixtureSource() },
  { kind: "mapTileset", id: "tileset_map_town", bundleId: "town", src: "/assets/visual/v1/maps/town.png", tileSize: 16, columns: 16, rows: 16, source: visualV1Source("确定性手工像素绘制的城镇 tileset，项目原创。") },
  { kind: "mapTileset", id: "tileset_map_floor_01", bundleId: "floor_01", src: "/assets/visual/v1/maps/floor_01.png", tileSize: 16, columns: 16, rows: 16, source: visualV1Source("确定性手工像素绘制的第一层 tileset，项目原创。") },
  ...playerFieldAssetIds.map((id) => visualFieldActorEntry(id, "player_common")),
  ...encounterFieldAssetIds.map((id) => visualFieldActorEntry(id, "floor_01")),
  ...npcFieldAssetIds.map((id) => visualFieldActorEntry(id, "town")),
  ...playerBattleAssetIds.map((id) => visualBattleActorEntry(id, "player_common")),
  ...enemyBattleAssetIds.map((id) => visualBattleActorEntry(id, "floor_01", id === "sprite_battle_boss_horned_king")),
  ...equipmentAssetIds.map((id) => singleFrameEntry(id, 24, 24)),
  ...statusAssetIds.map((id) => singleFrameEntry(id, 16, 16)),
  ...comboAssetIds.map((id) => singleFrameEntry(id, 24, 24)),
  ...itemAssetIds.map((id) => singleFrameEntry(id, 24, 24)),
  audioEntry("bgm_title", "boot"),
  audioEntry("bgm_town", "town"),
  audioEntry("bgm_field", "player_common"),
  audioEntry("bgm_boss", "battle_common"),
  audioEntry("bgm_final_boss", "battle_common"),
  audioEntry("sfx_ui_confirm", "core_ui"), audioEntry("sfx_ui_cancel", "core_ui"), audioEntry("sfx_ui_error", "core_ui"),
  audioEntry("sfx_step", "player_common"), audioEntry("sfx_encounter", "player_common"),
  audioEntry("sfx_attack", "battle_common"), audioEntry("sfx_skill", "battle_common"), audioEntry("sfx_hit", "battle_common"), audioEntry("sfx_heal", "battle_common"), audioEntry("sfx_status", "battle_common"), audioEntry("sfx_combo_unlock", "core_ui"), audioEntry("sfx_combo_trigger", "battle_common"), audioEntry("sfx_loot_rare", "battle_common"), audioEntry("sfx_loot_abyss", "battle_common"), audioEntry("sfx_boss_phase", "battle_common"), audioEntry("sfx_battle_result", "battle_common"),
];

const FLOORS02_05_CHARACTERS = ["char_ranger", "char_frost_seer"] as const;
const FLOORS02_05_NPCS = ["npc_cartographer", "npc_abyss_watcher"] as const;
const FLOORS02_05_ENCOUNTERS = [
  "encounter_floor_02_normal_a", "encounter_floor_02_normal_b", "encounter_floor_02_normal_c", "encounter_floor_02_elite_guardian", "encounter_floor_02_boss",
  "encounter_floor_03_normal_a", "encounter_floor_03_normal_b", "encounter_floor_03_normal_c", "encounter_floor_03_elite_golem", "encounter_floor_03_boss",
  "encounter_floor_04_normal_a", "encounter_floor_04_normal_b", "encounter_floor_04_normal_c", "encounter_floor_04_elite_wraith", "encounter_floor_04_boss",
  "encounter_floor_05_normal_a", "encounter_floor_05_normal_b", "encounter_floor_05_normal_c", "encounter_floor_05_elite_cultist", "encounter_floor_05_boss",
] as const;
const FLOORS02_05_ENEMIES = [
  "enemy_sporeling", "enemy_venom_spider", "enemy_fungal_guardian", "boss_brood_spider",
  "enemy_cave_bat", "enemy_ore_golem", "enemy_bomb_goblin", "boss_iron_devourer",
  "enemy_bog_leech", "enemy_mist_wraith", "boss_bog_witch", "enemy_ember_hound", "enemy_ash_cultist", "boss_ember_guardian",
] as const;
const FLOORS02_05_EQUIPMENT = [
  "eq_sword_t2_bloodiron", "eq_hammer_t2_bastion", "eq_bow_t2_hawkeye", "eq_staff_t2_cinder", "eq_focus_t2_mist_orb", "eq_relic_t2_silver_bell", "eq_helmet_t2_iron", "eq_armor_t2_chain", "eq_gloves_t2_rivet", "eq_boots_t2_scout", "eq_accessory_t2_gem",
  "eq_sword_t3_emberedge", "eq_hammer_t3_magma", "eq_bow_t3_bloodstring", "eq_staff_t3_volcano", "eq_focus_t3_iceheart", "eq_relic_t3_sun_shard", "eq_helmet_t3_ember", "eq_armor_t3_plate", "eq_gloves_t3_flame", "eq_boots_t3_ash", "eq_accessory_t3_sigil",
  "eq_helmet_t4_abyss", "eq_armor_t4_abyss", "eq_gloves_t4_crimson", "eq_boots_t4_bloodstep", "eq_accessory_t4_eye",
] as const;
const FLOORS02_05_COMBOS = ["combo_venom_bloom", "combo_frozen_verdict", "combo_storm_circuit", "combo_execution_cadence", "combo_steadfast_aegis", "combo_swift_formation", "combo_perfect_strike"] as const;

function floorAssetPath(kind: "field" | "battle" | "icon" | "map", id: string): string {
  return `/assets/floors/02-05/${kind}/${id}.png`;
}
function floorFieldActorEntry(id: string, bundleId: string): AssetEntryV1 {
  if (VISUAL_FIELD_ACTOR_IDS.has(id)) return visualFieldActorEntry(id, bundleId);
  return { kind: "fieldActorSheet", id, bundleId, src: floorAssetPath("field", id), frameWidth: 24, frameHeight: 32, columns: 10, rows: 4, clips: fieldClips, source: fixtureSource() };
}
function floorBattleActorEntry(id: string, bundleId: string, boss = false): AssetEntryV1 {
  return { kind: "battleActorSheet", id, bundleId, src: floorAssetPath("battle", id), frameWidth: boss ? 64 : 48, frameHeight: boss ? 64 : 48, columns: 27, rows: 1, clips: battleClips, source: fixtureSource() };
}
function floorSingleFrameEntry(id: string, width: 16 | 24 | 32, height: 16 | 24 | 32): AssetEntryV1 {
  return { kind: "singleFrame", id, bundleId: "core_ui", src: floorAssetPath("icon", id), width, height, source: fixtureSource() };
}
function floorMapTilesetEntry(id: string, bundleId: string): AssetEntryV1 {
  return { kind: "mapTileset", id, bundleId, src: floorAssetPath("map", id), tileSize: 16, columns: 16, rows: 16, source: fixtureSource() };
}

const floor02To05FieldEncounterAssetIds = FLOORS02_05_ENCOUNTERS.map((id) => `sprite_field_${id}`);
const floor02To05EnemyBattleAssetIds = FLOORS02_05_ENEMIES.map((id) => `sprite_battle_${id}`);
const floor02To05PlayerFieldAssetIds = FLOORS02_05_CHARACTERS.map((id) => `sprite_field_${id}`);
const floor02To05PlayerBattleAssetIds = FLOORS02_05_CHARACTERS.map((id) => `sprite_battle_${id}`);
const floor02To05NpcAssetIds = FLOORS02_05_NPCS.map((id) => `sprite_${id}`);
const floor02To05EquipmentAssetIds = FLOORS02_05_EQUIPMENT.map((id) => `sprite_${id}`);
const floor02To05ComboAssetIds = FLOORS02_05_COMBOS.map((id) => `icon_${id}`);

/** 第 2～5 层累计清单中仅激活已生成的两名角色与两名 NPC；其它楼层遭遇继续使用原路径。 */
const VISUAL_FIELD_ACTOR_IDS = new Set([
  "sprite_field_char_ranger",
  "sprite_field_char_frost_seer",
  "sprite_npc_cartographer",
  "sprite_npc_abyss_watcher",
]);

const floors02To05Assets: AssetEntryV1[] = [
  ...FLOORS02_05_CHARACTERS.flatMap((id) => [floorFieldActorEntry(`sprite_field_${id}`, "player_common"), floorBattleActorEntry(`sprite_battle_${id}`, "player_common")]),
  ...FLOORS02_05_NPCS.map((id) => floorFieldActorEntry(`sprite_${id}`, "town")),
  ...FLOORS02_05_ENCOUNTERS.map((id) => floorFieldActorEntry(`sprite_field_${id}`, `floor_${id.slice("encounter_floor_".length, "encounter_floor_".length + 2)}`)),
  ...FLOORS02_05_ENEMIES.map((id) => floorBattleActorEntry(`sprite_battle_${id}`, `floor_${id === "boss_brood_spider" || id === "enemy_sporeling" || id === "enemy_venom_spider" || id === "enemy_fungal_guardian" ? "02" : id === "boss_iron_devourer" || id === "enemy_cave_bat" || id === "enemy_ore_golem" || id === "enemy_bomb_goblin" ? "03" : id === "boss_bog_witch" || id === "enemy_bog_leech" || id === "enemy_mist_wraith" ? "04" : "05"}`, id.startsWith("boss_"))),
  ...FLOORS02_05_EQUIPMENT.map((id) => floorSingleFrameEntry(`sprite_${id}`, 24, 24)),
  ...FLOORS02_05_COMBOS.map((id) => floorSingleFrameEntry(`icon_${id}`, 24, 24)),
  floorMapTilesetEntry("tileset_map_floor_02", "floor_02"),
  floorMapTilesetEntry("tileset_map_floor_03", "floor_03"),
  floorMapTilesetEntry("tileset_map_floor_04", "floor_04"),
  floorMapTilesetEntry("tileset_map_floor_05", "floor_05"),
];

function addBundleAssets(bundleId: string, assetIds: readonly string[]): AssetBundleDefinitionV1 {
  const original = verticalSliceBundles.find((bundleDefinition) => bundleDefinition.id === bundleId);
  if (!original) throw new Error(`资源 bundle 不存在: ${bundleId}`);
  return bundle(bundleId, [...original.dependsOn], [...original.assetIds, ...assetIds]);
}

const floors02To05Bundles: AssetBundleDefinitionV1[] = [
  addBundleAssets("boot", []),
  addBundleAssets("core_ui", [...floor02To05EquipmentAssetIds, ...floor02To05ComboAssetIds]),
  addBundleAssets("player_common", [...floor02To05PlayerFieldAssetIds, ...floor02To05PlayerBattleAssetIds]),
  addBundleAssets("town", floor02To05NpcAssetIds),
  addBundleAssets("battle_common", []),
  addBundleAssets("abyss_common", []),
  addBundleAssets("floor_01", []),
  addBundleAssets("floor_02", ["tileset_map_floor_02", ...floor02To05FieldEncounterAssetIds.slice(0, 5), ...floor02To05EnemyBattleAssetIds.slice(0, 4)]),
  addBundleAssets("floor_03", ["tileset_map_floor_03", ...floor02To05FieldEncounterAssetIds.slice(5, 10), ...floor02To05EnemyBattleAssetIds.slice(4, 8)]),
  addBundleAssets("floor_04", ["tileset_map_floor_04", ...floor02To05FieldEncounterAssetIds.slice(10, 15), ...floor02To05EnemyBattleAssetIds.slice(8, 11)]),
  addBundleAssets("floor_05", ["tileset_map_floor_05", ...floor02To05FieldEncounterAssetIds.slice(15, 20), ...floor02To05EnemyBattleAssetIds.slice(11, 14)]),
  addBundleAssets("floor_06", []), addBundleAssets("floor_07", []), addBundleAssets("floor_08", []), addBundleAssets("floor_09", []), addBundleAssets("floor_10", []),
];

const FLOORS06_10_ENCOUNTERS = [
  "encounter_floor_06_normal_a", "encounter_floor_06_normal_b", "encounter_floor_06_normal_c", "encounter_floor_06_elite_mauler", "encounter_floor_06_boss",
  "encounter_floor_07_normal_a", "encounter_floor_07_normal_b", "encounter_floor_07_normal_c", "encounter_floor_07_elite_acolyte", "encounter_floor_07_boss",
  "encounter_floor_08_normal_a", "encounter_floor_08_normal_b", "encounter_floor_08_normal_c", "encounter_floor_08_elite_warden", "encounter_floor_08_boss",
  "encounter_floor_09_normal_a", "encounter_floor_09_normal_b", "encounter_floor_09_normal_c", "encounter_floor_09_elite_shard", "encounter_floor_09_boss",
  "encounter_floor_10_normal_a", "encounter_floor_10_normal_b", "encounter_floor_10_normal_c", "encounter_floor_10_elite_knight", "encounter_floor_10_boss",
] as const;
const FLOORS06_10_ENEMIES = [
  "enemy_abyss_mauler", "enemy_dread_eye", "enemy_blood_ghoul", "enemy_crimson_acolyte", "enemy_frost_warden", "enemy_ice_revenant", "enemy_void_spark", "enemy_watcher_shard", "enemy_throne_knight", "enemy_abyss_herald",
  "boss_abyss_butcher", "boss_crimson_knight", "boss_pale_jailer", "boss_thousand_eye", "boss_abyss_king",
] as const;
const FLOORS06_10_EQUIPMENT = [
  "eq_sword_t4_voidcutter", "eq_hammer_t4_jailer", "eq_bow_t4_starchaser", "eq_staff_t4_nightflame", "eq_focus_t4_thousand_lens", "eq_relic_t4_pale_grail",
  "eq_sword_t5_kingbreaker", "eq_hammer_t5_worldfall", "eq_bow_t5_voidrain", "eq_staff_t5_abyss_sun", "eq_focus_t5_zero_core", "eq_relic_t5_dawn_crown",
  "eq_helmet_t5_pale", "eq_armor_t5_frost", "eq_gloves_t5_void", "eq_boots_t5_starless", "eq_accessory_t5_star",
  "eq_helmet_t6_king", "eq_armor_t6_sovereign", "eq_gloves_t6_king", "eq_boots_t6_throne", "eq_accessory_t6_crown",
] as const;
const FLOORS06_10_COMBOS = ["combo_dark_covenant", "combo_cleansing_light", "combo_front_fortress", "combo_backline_barrage", "combo_triune_elements", "combo_ultimate_resonance", "combo_abyss_dominion"] as const;

function deepAssetPath(kind: "field" | "battle" | "icon" | "map", id: string): string {
  return `/assets/floors/06-10/${kind}/${id}.png`;
}
function deepFieldActorEntry(id: string, bundleId: string): AssetEntryV1 {
  return { kind: "fieldActorSheet", id, bundleId, src: deepAssetPath("field", id), frameWidth: 24, frameHeight: 32, columns: 10, rows: 4, clips: fieldClips, source: fixtureSource() };
}
function deepBattleActorEntry(id: string, bundleId: string, boss = false): AssetEntryV1 {
  return { kind: "battleActorSheet", id, bundleId, src: deepAssetPath("battle", id), frameWidth: boss ? 64 : 48, frameHeight: boss ? 64 : 48, columns: 27, rows: 1, clips: battleClips, source: fixtureSource() };
}
function deepSingleFrameEntry(id: string, width: 16 | 24 | 32, height: 16 | 24 | 32): AssetEntryV1 {
  return { kind: "singleFrame", id, bundleId: "core_ui", src: deepAssetPath("icon", id), width, height, source: fixtureSource() };
}
function deepAudioEntry(id: MusicId, bundleId: string): AssetEntryV1 {
  const entry = audioEntry(id, bundleId);
  if (entry.kind !== "audio") throw new Error("深渊资源构造器只能接收 audio entry");
  return { ...entry, oggSrc: `/assets/abyss/${id}.ogg`, mp3Src: `/assets/abyss/${id}.mp3` };
}
function deepFloorNumber(id: string): string {
  const match = /floor_(\d\d)/.exec(id);
  return match?.[1] ?? "10";
}
const floors06To10Assets: AssetEntryV1[] = [
  ...FLOORS06_10_ENCOUNTERS.map((id) => deepFieldActorEntry(`sprite_field_${id}`, `floor_${deepFloorNumber(id)}`)),
  ...FLOORS06_10_ENEMIES.map((id) => {
    const floor = id === "enemy_abyss_mauler" || id === "enemy_dread_eye" || id === "boss_abyss_butcher" ? "06"
      : id === "enemy_blood_ghoul" || id === "enemy_crimson_acolyte" || id === "boss_crimson_knight" ? "07"
        : id === "enemy_frost_warden" || id === "enemy_ice_revenant" || id === "boss_pale_jailer" ? "08"
          : id === "enemy_void_spark" || id === "enemy_watcher_shard" || id === "boss_thousand_eye" ? "09" : "10";
    return deepBattleActorEntry(`sprite_battle_${id}`, `floor_${floor}`, id.startsWith("boss_"));
  }),
  ...FLOORS06_10_EQUIPMENT.map((id) => deepSingleFrameEntry(`sprite_${id}`, 24, 24)),
  ...FLOORS06_10_COMBOS.map((id) => deepSingleFrameEntry(`icon_${id}`, 24, 24)),
  ...["06", "07", "08", "09", "10"].map((floor) => ({ kind: "mapTileset" as const, id: `tileset_map_floor_${floor}`, bundleId: `floor_${floor}`, src: deepAssetPath("map", `tileset_map_floor_${floor}`), tileSize: 16 as const, columns: 16, rows: 16, source: fixtureSource() })),
  deepAudioEntry("bgm_abyss", "abyss_common"),
];

const floors06To10Bundles: AssetBundleDefinitionV1[] = floors02To05Bundles.map((bundleDefinition) => {
  const additions: string[] = bundleDefinition.id === "core_ui"
    ? [...FLOORS06_10_EQUIPMENT.map((id) => `sprite_${id}`), ...FLOORS06_10_COMBOS.map((id) => `icon_${id}`)]
      : bundleDefinition.id === "abyss_common" ? ["bgm_abyss"]
        : bundleDefinition.id.startsWith("floor_") && Number(bundleDefinition.id.slice(-2)) >= 6
          ? [
            ...FLOORS06_10_ENCOUNTERS.filter((id) => `floor_${deepFloorNumber(id)}` === bundleDefinition.id).map((id) => `sprite_field_${id}`),
            ...FLOORS06_10_ENEMIES.filter((id) => {
              const asset = floors06To10Assets.find((candidate) => candidate.id === `sprite_battle_${id}`);
              return asset?.bundleId === bundleDefinition.id;
            }).map((id) => `sprite_battle_${id}`),
            `tileset_map_${bundleDefinition.id}`,
          ]
          : [];
  return { ...bundleDefinition, assetIds: [...bundleDefinition.assetIds, ...additions] };
});

const fixtureBundles: AssetBundleDefinitionV1[] = [
  bundle("boot", [], ["font_pixel_zh_cn", "image_boot_logo", "image_boot_background", "bgm_title"]),
  bundle("core_ui", ["boot"], ["atlas_core_ui", "sfx_ui_confirm", "sfx_ui_cancel", "sfx_ui_error", "sfx_combo_unlock"]),
  bundle("player_common", ["core_ui"], ["bgm_field", "sfx_step", "sfx_encounter"]),
  bundle("town", ["player_common"], ["tileset_map_town", "bgm_town"]),
  bundle("battle_common", ["player_common"], ["atlas_battle_fx", "bgm_boss", "bgm_final_boss", "sfx_attack", "sfx_skill", "sfx_hit", "sfx_heal", "sfx_status", "sfx_combo_trigger", "sfx_loot_rare", "sfx_loot_abyss", "sfx_boss_phase", "sfx_battle_result"]),
  bundle("abyss_common", ["player_common"], ["bgm_abyss"]),
  bundle("floor_01", ["player_common"], ["tileset_map_floor_01"]),
  bundle("floor_02", ["player_common"], ["tileset_map_floor_02"]),
  bundle("floor_03", ["player_common"], ["tileset_map_floor_03"]),
  bundle("floor_04", ["player_common"], ["tileset_map_floor_04"]),
  bundle("floor_05", ["player_common"], ["tileset_map_floor_05"]),
  bundle("floor_06", ["player_common", "abyss_common"], ["tileset_map_floor_06"]),
  bundle("floor_07", ["player_common", "abyss_common"], ["tileset_map_floor_07"]),
  bundle("floor_08", ["player_common", "abyss_common"], ["tileset_map_floor_08"]),
  bundle("floor_09", ["player_common", "abyss_common"], ["tileset_map_floor_09"]),
  bundle("floor_10", ["player_common", "abyss_common"], ["tileset_map_floor_10"]),
];

const fixtureAssets: AssetEntryV1[] = [
  { kind: "bitmapFont", id: "font_pixel_zh_cn", bundleId: "boot", descriptorSrc: "__fixture__/fonts/pixel.zh-cn.fnt", textureSrc: "__fixture__/fonts/pixel.zh-cn.png", glyphHeight: 16, source: fixtureSource() },
  imageEntry("image_boot_logo", "boot", "__fixture__/images/boot-logo.png", 320, 96),
  imageEntry("image_boot_background", "boot", "__fixture__/images/boot-background.png", 640, 360),
  { kind: "atlas", id: "atlas_core_ui", bundleId: "core_ui", imageSrc: "__fixture__/atlases/core-ui.png", dataSrc: "__fixture__/atlases/core-ui.json", requiredFrames: [...CORE_UI_FRAMES], source: fixtureSource() },
  { kind: "atlas", id: "atlas_battle_fx", bundleId: "battle_common", imageSrc: "__fixture__/atlases/battle-fx.png", dataSrc: "__fixture__/atlases/battle-fx.json", requiredFrames: [...BATTLE_FX_FRAMES], source: fixtureSource() },
  ...(["town", ...Array.from({ length: 10 }, (_, index) => `floor_${String(index + 1).padStart(2, "0")}`)] as string[]).map((bundleId, index) => ({
    kind: "mapTileset" as const,
    id: index === 0 ? "tileset_map_town" : `tileset_map_floor_${String(index).padStart(2, "0")}`,
    bundleId,
    src: `__fixture__/maps/${bundleId}.png`,
    tileSize: 16 as const,
    columns: 16,
    rows: 16,
    source: fixtureSource(),
  })),
  fixtureAudioEntry("bgm_title", "boot"),
  fixtureAudioEntry("bgm_town", "town"),
  fixtureAudioEntry("bgm_field", "player_common"),
  fixtureAudioEntry("bgm_abyss", "abyss_common"),
  fixtureAudioEntry("bgm_boss", "battle_common"),
  fixtureAudioEntry("bgm_final_boss", "battle_common"),
  fixtureAudioEntry("sfx_ui_confirm", "core_ui"), fixtureAudioEntry("sfx_ui_cancel", "core_ui"), fixtureAudioEntry("sfx_ui_error", "core_ui"),
  fixtureAudioEntry("sfx_step", "player_common"), fixtureAudioEntry("sfx_encounter", "player_common"),
  fixtureAudioEntry("sfx_attack", "battle_common"), fixtureAudioEntry("sfx_skill", "battle_common"), fixtureAudioEntry("sfx_hit", "battle_common"), fixtureAudioEntry("sfx_heal", "battle_common"), fixtureAudioEntry("sfx_status", "battle_common"), fixtureAudioEntry("sfx_combo_unlock", "core_ui"), fixtureAudioEntry("sfx_combo_trigger", "battle_common"), fixtureAudioEntry("sfx_loot_rare", "battle_common"), fixtureAudioEntry("sfx_loot_abyss", "battle_common"), fixtureAudioEntry("sfx_boss_phase", "battle_common"), fixtureAudioEntry("sfx_battle_result", "battle_common"),
];

const makeManifest = (manifestBundles: AssetBundleDefinitionV1[], manifestAssets: AssetEntryV1[]): AssetManifestV1 => ({
  schemaVersion: 1,
  contentVersion: "content-1.2.0",
  bundles: manifestBundles,
  assets: manifestAssets === fixtureAssets ? manifestAssets : manifestAssets.map(withCompletedArt),
  animations: [...ANIMATION_DEFINITIONS],
});

/** 第一层批次资源；正式校验脚本按 batch verticalSlice 显式选择。 */
export const verticalSliceAssetManifest: AssetManifestV1 = Object.freeze(makeManifest(verticalSliceBundles, verticalSliceAssets));

/** 第 2～5 层累计资源清单；只增加本批新逻辑 ID，不改变第一层 fixture/verticalSlice 清单。 */
export const floors02To05AssetManifest: AssetManifestV1 = Object.freeze(makeManifest(floors02To05Bundles, [...verticalSliceAssets, ...floors02To05Assets]));

/** 第 6～10 层累计资源清单；深渊资源路径与 bundle 依赖均显式展开。 */
export const floors06To10AssetManifest: AssetManifestV1 = Object.freeze(makeManifest(floors06To10Bundles, [...verticalSliceAssets, ...floors02To05Assets, ...floors06To10Assets]));

/** Fixture 只代表逻辑声明通过，保留 RPG-006 的 38 项最小资源集合。 */
export const fixtureAssetManifest: AssetManifestV1 = Object.freeze(makeManifest(fixtureBundles, fixtureAssets));
export const candidateAssetManifest = fixtureAssetManifest;
