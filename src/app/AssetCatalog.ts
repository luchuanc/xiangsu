import { z } from "zod";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../domain/common/DomainResult";
import {
  MUSIC_BASE_GAIN_BPS,
  MUSIC_IDS,
  SFX_BASE_GAIN_BPS,
  SFX_IDS,
} from "./AudioService";
import {
  FROZEN_SKILL_IDS,
  ANIMATION_DEFINITIONS,
  PASSIVE_SKILL_IDS,
  type AnimationDefinitionV1,
} from "../content/data/animations";
import { FROZEN_BATCH_MANIFESTS } from "../content/Catalog";
import type {
  AssetBundleDefinitionV1,
  AssetEntryV1,
  AssetManifestV1,
} from "../content/data/assets.manifest";

export type {
  AssetBundleDefinitionV1,
  AssetEntryV1,
  AssetManifestV1,
  AssetSourceRecord,
} from "../content/data/assets.manifest";
export type { AnimationDefinitionV1 } from "../content/data/animations";

export type AssetBatchId = "verticalSlice" | "floors02_05" | "floors06_10" | "abyssEchoes";
export type AssetValidationMode = "fixture" | "final" | { kind: "batch"; batchId: AssetBatchId };
export interface AssetCatalogOptions {
  /** 浏览器运行时只做逻辑契约校验；不读取本地文件系统或构建期物理元数据。 */
  runtime?: boolean;
  /** CLI/Node 校验时注入物理文件存在性；浏览器运行时不读取文件系统。 */
  fileExists?: (src: string) => boolean;
  /** 构建门禁注入真实 PNG/atlas/BitmapFont 元数据读取器；缺少文件时不以占位数据通过。 */
  metadataInspector?: AssetMetadataInspector;
  /** BitmapFont 必须覆盖的本地化字符集合；由 CLI 从冻结 locale 快照注入。 */
  requiredFontCharacters?: readonly string[];
}

export interface AssetImageMetadata {
  readonly width: number;
  readonly height: number;
}

export interface AssetAtlasFrameMetadata {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AssetAtlasMetadata {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly frames: Readonly<Record<string, AssetAtlasFrameMetadata>>;
}

export interface AssetBitmapFontMetadata {
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly characters: readonly string[];
}

export interface AssetMetadataInspector {
  inspectImage(src: string): AssetImageMetadata | null;
  inspectAtlas(imageSrc: string, dataSrc: string): AssetAtlasMetadata | null;
  inspectBitmapFont(descriptorSrc: string, textureSrc: string): AssetBitmapFontMetadata | null;
}

const BUNDLE_IDS = Object.freeze([
  "boot", "core_ui", "player_common", "town", "battle_common", "abyss_common",
  "floor_01", "floor_02", "floor_03", "floor_04", "floor_05", "floor_06", "floor_07", "floor_08", "floor_09", "floor_10",
] as const);
const BUNDLE_DEPENDS: Readonly<Record<(typeof BUNDLE_IDS)[number], readonly string[]>> = deepFreeze({
  boot: [],
  core_ui: ["boot"],
  player_common: ["core_ui"],
  town: ["player_common"],
  battle_common: ["player_common"],
  abyss_common: ["player_common"],
  floor_01: ["player_common"],
  floor_02: ["player_common"],
  floor_03: ["player_common"],
  floor_04: ["player_common"],
  floor_05: ["player_common"],
  floor_06: ["player_common", "abyss_common"],
  floor_07: ["player_common", "abyss_common"],
  floor_08: ["player_common", "abyss_common"],
  floor_09: ["player_common", "abyss_common"],
  floor_10: ["player_common", "abyss_common"],
});

const idSchema = z.string().min(1);
const sourceSchema = z.object({
  sourceKind: z.enum(["generated", "original", "licensed"]),
  sourceNote: z.string().min(1),
  licenseId: z.string().min(1),
}).strict();
const fieldClipSchema = (row: 0 | 1 | 2 | 3) => z.object({
  row: z.literal(row),
  idle: z.object({ startColumn: z.literal(0), frameCount: z.literal(4), fps: z.literal(6) }).strict(),
  walk: z.object({ startColumn: z.literal(4), frameCount: z.literal(6), fps: z.literal(10) }).strict(),
}).strict();
const fieldClipsSchema = z.object({
  down: fieldClipSchema(0), left: fieldClipSchema(1), right: fieldClipSchema(2), up: fieldClipSchema(3),
}).strict();
const battleClipsSchema = z.object({
  idle: z.object({ startFrame: z.literal(0), frameCount: z.literal(4), fps: z.literal(6), loop: z.literal(true) }).strict(),
  attack: z.object({ startFrame: z.literal(4), frameCount: z.literal(6), fps: z.literal(12), loop: z.literal(false), impactFrame: z.literal(8) }).strict(),
  skill: z.object({ startFrame: z.literal(10), frameCount: z.literal(8), fps: z.literal(12), loop: z.literal(false), impactFrame: z.literal(15) }).strict(),
  hit: z.object({ startFrame: z.literal(18), frameCount: z.literal(3), fps: z.literal(12), loop: z.literal(false) }).strict(),
  down: z.object({ startFrame: z.literal(21), frameCount: z.literal(6), fps: z.literal(10), loop: z.literal(false) }).strict(),
}).strict();

const assetSchemas = [
  z.object({ kind: z.literal("fieldActorSheet"), id: idSchema, bundleId: idSchema, src: z.string().min(1), frameWidth: z.literal(24), frameHeight: z.literal(32), columns: z.literal(10), rows: z.literal(4), clips: fieldClipsSchema, source: sourceSchema }).strict(),
  z.object({ kind: z.literal("battleActorSheet"), id: idSchema, bundleId: idSchema, src: z.string().min(1), frameWidth: z.union([z.literal(48), z.literal(64)]), frameHeight: z.union([z.literal(48), z.literal(64)]), columns: z.literal(27), rows: z.literal(1), clips: battleClipsSchema, source: sourceSchema }).strict(),
  z.object({ kind: z.literal("singleFrame"), id: idSchema, bundleId: idSchema, src: z.string().min(1), width: z.union([z.literal(16), z.literal(24), z.literal(32)]), height: z.union([z.literal(16), z.literal(24), z.literal(32)]), source: sourceSchema }).strict(),
  z.object({ kind: z.literal("mapTileset"), id: idSchema, bundleId: idSchema, src: z.string().min(1), tileSize: z.literal(16), columns: z.number().int().positive(), rows: z.number().int().positive(), source: sourceSchema }).strict(),
  z.object({ kind: z.literal("atlas"), id: idSchema, bundleId: idSchema, imageSrc: z.string().min(1), dataSrc: z.string().min(1), requiredFrames: z.array(z.string().min(1)).min(1), source: sourceSchema }).strict(),
  z.object({ kind: z.literal("bitmapFont"), id: idSchema, bundleId: idSchema, descriptorSrc: z.string().min(1), textureSrc: z.string().min(1), glyphHeight: z.literal(16), source: sourceSchema }).strict(),
  z.object({ kind: z.literal("image"), id: idSchema, bundleId: idSchema, src: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive(), source: sourceSchema }).strict(),
  z.object({ kind: z.literal("audio"), id: idSchema, bundleId: idSchema, oggSrc: z.string().min(1), mp3Src: z.string().min(1), channel: z.enum(["music", "sfx"]), loop: z.boolean(), baseGainBps: z.number().int().min(0).max(10_000), source: sourceSchema }).strict(),
] as const;
const assetSchema = z.discriminatedUnion("kind", assetSchemas);
const animationSchema = z.object({
  id: idSchema,
  bundleId: z.literal("battle_common"),
  presetId: z.enum(["melee", "projectile", "area", "heal", "shield", "status", "summon", "passive"]),
  element: z.enum(["physical", "fire", "frost", "lightning", "holy", "dark", "poison", "true"]),
  durationMs: z.union([z.literal(0), z.literal(300), z.literal(450), z.literal(600)]),
  screenShake: z.enum(["none", "light", "heavy"]),
  sfxId: z.enum(["sfx_attack", "sfx_skill", "sfx_heal", "sfx_status"]).nullable(),
}).strict();
const bundleSchema = z.object({ id: idSchema, dependsOn: z.array(idSchema), assetIds: z.array(idSchema) }).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  contentVersion: z.literal("content-1.2.0"),
  bundles: z.array(bundleSchema),
  assets: z.array(assetSchema),
  animations: z.array(animationSchema),
}).strict();

const MUSIC_SET = new Set<string>(MUSIC_IDS);
const SFX_SET = new Set<string>(SFX_IDS);
const PASSIVE_SET = new Set<string>(PASSIVE_SKILL_IDS.map((id) => `anim_${id}`));
const FROZEN_ANIMATION_SET = new Set<string>(FROZEN_SKILL_IDS.map((id) => `anim_${id}`));
const FINAL_ASSET_ENTRY_COUNT = 243;
type AssetKind = AssetEntryV1["kind"];
interface AssetExpectation {
  readonly id: string;
  readonly kind: AssetKind;
  readonly bundleId: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameWidth?: number;
  readonly frameHeight?: number;
}

const FINAL_CONTENT = FROZEN_BATCH_MANIFESTS.floors06_10;
const BOSS_IDS = new Set(["boss_horned_king", "boss_brood_spider", "boss_iron_devourer", "boss_bog_witch", "boss_ember_guardian", "boss_abyss_butcher", "boss_crimson_knight", "boss_pale_jailer", "boss_thousand_eye", "boss_abyss_king"]);
const AUDIO_BUNDLE_BY_ID: Readonly<Record<string, string>> = {
  bgm_title: "boot", bgm_town: "town", bgm_field: "player_common", bgm_abyss: "abyss_common", bgm_boss: "battle_common", bgm_final_boss: "battle_common",
  sfx_ui_confirm: "core_ui", sfx_ui_cancel: "core_ui", sfx_ui_error: "core_ui", sfx_step: "player_common", sfx_encounter: "player_common", sfx_attack: "battle_common", sfx_skill: "battle_common", sfx_hit: "battle_common", sfx_heal: "battle_common", sfx_status: "battle_common", sfx_combo_unlock: "core_ui", sfx_combo_trigger: "battle_common", sfx_loot_rare: "battle_common", sfx_loot_abyss: "battle_common", sfx_boss_phase: "battle_common", sfx_battle_result: "battle_common",
};

const FIELD_ENCOUNTER_OWNER: Readonly<Record<string, string>> = Object.freeze({
  encounter_floor_01_normal_a: "floor_01", encounter_floor_01_normal_b: "floor_01", encounter_floor_01_normal_c: "floor_01", encounter_floor_01_elite_boar: "floor_01", encounter_floor_01_boss: "floor_01",
  encounter_floor_02_normal_a: "floor_02", encounter_floor_02_normal_b: "floor_02", encounter_floor_02_normal_c: "floor_02", encounter_floor_02_elite_guardian: "floor_02", encounter_floor_02_boss: "floor_02",
  encounter_floor_03_normal_a: "floor_03", encounter_floor_03_normal_b: "floor_03", encounter_floor_03_normal_c: "floor_03", encounter_floor_03_elite_golem: "floor_03", encounter_floor_03_boss: "floor_03",
  encounter_floor_04_normal_a: "floor_04", encounter_floor_04_normal_b: "floor_04", encounter_floor_04_normal_c: "floor_04", encounter_floor_04_elite_wraith: "floor_04", encounter_floor_04_boss: "floor_04",
  encounter_floor_05_normal_a: "floor_05", encounter_floor_05_normal_b: "floor_05", encounter_floor_05_normal_c: "floor_05", encounter_floor_05_elite_cultist: "floor_05", encounter_floor_05_boss: "floor_05",
  encounter_floor_06_normal_a: "floor_06", encounter_floor_06_normal_b: "floor_06", encounter_floor_06_normal_c: "floor_06", encounter_floor_06_elite_mauler: "floor_06", encounter_floor_06_boss: "floor_06",
  encounter_floor_07_normal_a: "floor_07", encounter_floor_07_normal_b: "floor_07", encounter_floor_07_normal_c: "floor_07", encounter_floor_07_elite_acolyte: "floor_07", encounter_floor_07_boss: "floor_07",
  encounter_floor_08_normal_a: "floor_08", encounter_floor_08_normal_b: "floor_08", encounter_floor_08_normal_c: "floor_08", encounter_floor_08_elite_warden: "floor_08", encounter_floor_08_boss: "floor_08",
  encounter_floor_09_normal_a: "floor_09", encounter_floor_09_normal_b: "floor_09", encounter_floor_09_normal_c: "floor_09", encounter_floor_09_elite_shard: "floor_09", encounter_floor_09_boss: "floor_09",
  encounter_floor_10_normal_a: "floor_10", encounter_floor_10_normal_b: "floor_10", encounter_floor_10_normal_c: "floor_10", encounter_floor_10_elite_knight: "floor_10", encounter_floor_10_boss: "floor_10",
});
const ENEMY_OWNER: Readonly<Record<string, string>> = Object.freeze({
  enemy_grass_slime: "floor_01", enemy_thorn_rat: "floor_01", enemy_fang_wolf: "floor_01", enemy_goblin_scout: "floor_01", enemy_stonehide_boar: "floor_01", boss_horned_king: "floor_01",
  enemy_sporeling: "floor_02", enemy_venom_spider: "floor_02", enemy_fungal_guardian: "floor_02", boss_brood_spider: "floor_02",
  enemy_cave_bat: "floor_03", enemy_ore_golem: "floor_03", enemy_bomb_goblin: "floor_03", boss_iron_devourer: "floor_03",
  enemy_bog_leech: "floor_04", enemy_mist_wraith: "floor_04", boss_bog_witch: "floor_04",
  enemy_ember_hound: "floor_05", enemy_ash_cultist: "floor_05", boss_ember_guardian: "floor_05",
  enemy_abyss_mauler: "floor_06", enemy_dread_eye: "floor_06", boss_abyss_butcher: "floor_06",
  enemy_blood_ghoul: "floor_07", enemy_crimson_acolyte: "floor_07", boss_crimson_knight: "floor_07",
  enemy_frost_warden: "floor_08", enemy_ice_revenant: "floor_08", boss_pale_jailer: "floor_08",
  enemy_void_spark: "floor_09", enemy_watcher_shard: "floor_09", boss_thousand_eye: "floor_09",
  enemy_throne_knight: "floor_10", enemy_abyss_herald: "floor_10", boss_abyss_king: "floor_10",
});

const expectAsset = (id: string, kind: AssetKind, bundleId: string, size: Partial<Pick<AssetExpectation, "width" | "height" | "frameWidth" | "frameHeight">> = {}): AssetExpectation => ({ id, kind, bundleId, ...size });

const FIXTURE_EXPECTED_ASSETS: readonly AssetExpectation[] = Object.freeze([
  expectAsset("font_pixel_zh_cn", "bitmapFont", "boot"), expectAsset("image_boot_logo", "image", "boot", { width: 320, height: 96 }), expectAsset("image_boot_background", "image", "boot", { width: 640, height: 360 }),
  expectAsset("atlas_core_ui", "atlas", "core_ui"), expectAsset("atlas_battle_fx", "atlas", "battle_common"),
  expectAsset("tileset_map_town", "mapTileset", "town"), ...Array.from({ length: 10 }, (_, index) => expectAsset(`tileset_map_floor_${String(index + 1).padStart(2, "0")}`, "mapTileset", `floor_${String(index + 1).padStart(2, "0")}`)),
  ...[...MUSIC_IDS, ...SFX_IDS].map((id) => expectAsset(id, "audio", AUDIO_BUNDLE_BY_ID[id] ?? "")),
]);

const FINAL_EXPECTED_ASSETS: readonly AssetExpectation[] = Object.freeze([
  ...FINAL_CONTENT.characters.map((id) => expectAsset(`sprite_field_${id}`, "fieldActorSheet", "player_common", { frameWidth: 24, frameHeight: 32 })),
  ...FINAL_CONTENT.encounters.map((id) => expectAsset(`sprite_field_${id}`, "fieldActorSheet", FIELD_ENCOUNTER_OWNER[id] ?? "", { frameWidth: 24, frameHeight: 32 })),
  ...FINAL_CONTENT.npcs.map((id) => expectAsset(`sprite_${id}`, "fieldActorSheet", "town", { frameWidth: 24, frameHeight: 32 })),
  ...FINAL_CONTENT.characters.map((id) => expectAsset(`sprite_battle_${id}`, "battleActorSheet", "player_common", { frameWidth: 48, frameHeight: 48 })),
  ...FINAL_CONTENT.enemies.map((id) => expectAsset(`sprite_battle_${id}`, "battleActorSheet", ENEMY_OWNER[id] ?? "", { frameWidth: BOSS_IDS.has(id) ? 64 : 48, frameHeight: BOSS_IDS.has(id) ? 64 : 48 })),
  ...FINAL_CONTENT.equipmentBases.map((id) => expectAsset(`sprite_${id}`, "singleFrame", "core_ui", { width: 24, height: 24 })),
  ...FINAL_CONTENT.statuses.map((id) => expectAsset(`icon_${id}`, "singleFrame", "core_ui", { width: 16, height: 16 })),
  ...FINAL_CONTENT.combos.map((id) => expectAsset(`icon_${id}`, "singleFrame", "core_ui", { width: 24, height: 24 })),
  ...FINAL_CONTENT.items.map((id) => expectAsset(`icon_${id}`, "singleFrame", "core_ui", { width: 24, height: 24 })),
  expectAsset("tileset_map_town", "mapTileset", "town"), ...Array.from({ length: 10 }, (_, index) => expectAsset(`tileset_map_floor_${String(index + 1).padStart(2, "0")}`, "mapTileset", `floor_${String(index + 1).padStart(2, "0")}`)),
  expectAsset("atlas_core_ui", "atlas", "core_ui"), expectAsset("atlas_battle_fx", "atlas", "battle_common"), expectAsset("font_pixel_zh_cn", "bitmapFont", "boot"), expectAsset("image_boot_logo", "image", "boot", { width: 320, height: 96 }), expectAsset("image_boot_background", "image", "boot", { width: 640, height: 360 }),
  ...[...MUSIC_IDS, ...SFX_IDS].map((id) => expectAsset(id, "audio", AUDIO_BUNDLE_BY_ID[id] ?? "")),
]);

function expectedAssetsForBatch(batchId: AssetBatchId): readonly AssetExpectation[] {
  // 批次集合直接读取内容侧冻结 manifest；不能用数组切片或 ID 名称顺序推断批次。
  const content = FROZEN_BATCH_MANIFESTS[batchId];
  const floors = new Set(content.floors);
  const characters = new Set(content.characters);
  const encounters = new Set(content.encounters);
  const enemies = new Set(content.enemies);
  const npcs = new Set(content.npcs);
  const equipment = new Set(content.equipmentBases);
  const combos = new Set(content.combos);
  const bundles = new Set(["boot", "core_ui", "player_common", "town", "battle_common", ...content.floors]);
  // 第六层起的探索场景显式依赖 abyss_common，不能只按 floor bundle 过滤。
  if ([...floors].some((floorId) => Number(floorId.slice("floor_".length)) >= 6)) bundles.add("abyss_common");
  return FINAL_EXPECTED_ASSETS.filter((asset) => {
    if (asset.kind === "audio") return bundles.has(asset.bundleId);
    if (asset.id.startsWith("sprite_field_")) {
      const logicalId = asset.id.slice("sprite_field_".length);
      return characters.has(logicalId)
        || (encounters.has(logicalId) && floors.has(FIELD_ENCOUNTER_OWNER[logicalId] ?? ""));
    }
    if (asset.id.startsWith("sprite_battle_")) {
      const logicalId = asset.id.slice("sprite_battle_".length);
      return characters.has(logicalId)
        || (enemies.has(logicalId) && floors.has(ENEMY_OWNER[logicalId] ?? ""));
    }
    if (asset.id.startsWith("sprite_")) return npcs.has(asset.id.slice("sprite_".length)) || equipment.has(asset.id.slice("sprite_".length));
    if (asset.id.startsWith("icon_status_")) return content.statuses.includes(asset.id.slice("icon_".length));
    if (asset.id.startsWith("icon_item_")) return content.items.includes(asset.id.slice("icon_".length));
    if (asset.id.startsWith("icon_combo_")) return combos.has(asset.id.slice("icon_".length));
    if (asset.kind === "mapTileset") return asset.bundleId === "town" || floors.has(asset.bundleId);
    return asset.bundleId === "boot" || asset.bundleId === "core_ui" || asset.bundleId === "battle_common";
  });
}

function expectedAssetsForMode(mode: AssetValidationMode): readonly AssetExpectation[] {
  if (mode === "fixture") return FIXTURE_EXPECTED_ASSETS;
  return typeof mode === "string" ? FINAL_EXPECTED_ASSETS : expectedAssetsForBatch(mode.batchId);
}
const CORE_UI_FRAMES = ["panel_9s", "button_normal_9s", "button_pressed_9s", "button_disabled_9s", "slot_empty", "slot_locked", "quality_common", "quality_magic", "quality_rare", "quality_epic", "quality_abyss", "cursor_target", "marker_interact", "marker_alert", "marker_boss", "marker_elite", "object_chest_closed", "object_portal_floor", "object_portal_return", "icon_gold", "icon_energy", "icon_hp", "icon_attack", "icon_defense", "icon_speed", "icon_critical", "icon_close", "icon_back", "icon_menu", "icon_warning"] as const;
const BATTLE_FX_FRAMES = ["fx_slash_00", "fx_slash_01", "fx_slash_02", "fx_slash_03", "fx_slash_04", "fx_slash_05", "fx_projectile_physical", "fx_projectile_fire", "fx_projectile_frost", "fx_projectile_lightning", "fx_projectile_holy", "fx_projectile_dark", "fx_projectile_poison", "fx_projectile_true", "fx_area_00", "fx_area_01", "fx_area_02", "fx_area_03", "fx_area_04", "fx_area_05", "fx_area_06", "fx_area_07", "fx_heal_00", "fx_heal_01", "fx_heal_02", "fx_heal_03", "fx_heal_04", "fx_heal_05", "fx_shield_00", "fx_shield_01", "fx_shield_02", "fx_shield_03", "fx_shield_04", "fx_shield_05", "fx_status_00", "fx_status_01", "fx_status_02", "fx_status_03", "fx_summon_00", "fx_summon_01", "fx_summon_02", "fx_summon_03", "fx_summon_04", "fx_summon_05", "fx_summon_06", "fx_summon_07"] as const;

function invalid(path: string, issueKey: string): ReturnType<typeof failure> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function duplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function validateBundleGraph(bundles: readonly AssetBundleDefinitionV1[]): { path: string; issueKey: string } | null {
  if (bundles.length !== BUNDLE_IDS.length) return { path: "bundles", issueKey: "bundle_count" };
  const ids = bundles.map((bundle) => bundle.id);
  if (JSON.stringify(ids) !== JSON.stringify(BUNDLE_IDS)) return { path: "bundles", issueKey: "bundle_ids" };
  const map = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  for (const id of BUNDLE_IDS) {
    const bundle = map.get(id);
    if (!bundle) return { path: `bundles.${id}`, issueKey: "missing_bundle" };
    if (JSON.stringify(bundle.dependsOn) !== JSON.stringify(BUNDLE_DEPENDS[id])) return { path: `bundles.${id}.dependsOn`, issueKey: "depends_on" };
    const duplicateId = duplicate(bundle.assetIds);
    if (duplicateId) return { path: `bundles.${id}.assetIds`, issueKey: `duplicate_asset_id:${duplicateId}` };
    for (const dependency of bundle.dependsOn) {
      if (!map.has(dependency)) return { path: `bundles.${id}.dependsOn`, issueKey: `unknown_bundle:${dependency}` };
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): { path: string; issueKey: string } | null => {
    if (visiting.has(id)) return { path: `bundles.${id}.dependsOn`, issueKey: "dependency_cycle" };
    if (visited.has(id)) return null;
    visiting.add(id);
    const bundle = map.get(id);
    for (const dependency of bundle?.dependsOn ?? []) {
      const issue = visit(dependency);
      if (issue) return issue;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const id of BUNDLE_IDS) {
    const issue = visit(id);
    if (issue) return issue;
  }
  return null;
}

function validateAnimations(animations: readonly AnimationDefinitionV1[]): { path: string; issueKey: string } | null {
  const duplicateId = duplicate(animations.map((animation) => animation.id));
  if (duplicateId) return { path: "animations", issueKey: `duplicate_id:${duplicateId}` };
  if (animations.length !== FROZEN_SKILL_IDS.length) return { path: "animations", issueKey: "expected_count_97" };
  const actual = new Set(animations.map((animation) => animation.id));
  for (const id of FROZEN_ANIMATION_SET) if (!actual.has(id)) return { path: "animations", issueKey: `missing_id:${id}` };
  for (const id of actual) if (!FROZEN_ANIMATION_SET.has(id)) return { path: "animations", issueKey: `unexpected_id:${id}` };
  const passive = animations.filter((animation) => animation.presetId === "passive");
  if (passive.length !== PASSIVE_SET.size) return { path: "animations", issueKey: "passive_count" };
  for (const [index, animation] of animations.entries()) {
    const expected = ANIMATION_DEFINITIONS[index];
    if (!expected || animation.id !== expected.id || JSON.stringify(animation) !== JSON.stringify(expected)) {
      return { path: `animations.${animation.id}`, issueKey: "canonical_projection" };
    }
  }
  for (const animation of animations) {
    if (!/^anim_[^\s]+$/.test(animation.id)) return { path: `animations.${animation.id}`, issueKey: "invalid_id" };
    if (animation.presetId === "passive" && (animation.durationMs !== 0 || animation.sfxId !== null)) return { path: `animations.${animation.id}`, issueKey: "passive_duration_or_sfx" };
    if (animation.presetId !== "passive" && animation.sfxId === null) return { path: `animations.${animation.id}`, issueKey: "non_passive_sfx_required" };
  }
  return null;
}

function validateExpectedAssets(mode: AssetValidationMode, assets: readonly AssetEntryV1[]): { path: string; issueKey: string } | null {
  const expected = expectedAssetsForMode(mode);
  if (mode === "final" && expected.length !== FINAL_ASSET_ENTRY_COUNT) return { path: "assets", issueKey: `internal_expected_count_${FINAL_ASSET_ENTRY_COUNT}` };
  if (assets.length !== expected.length) return { path: "assets", issueKey: `expected_count_${expected.length}` };
  const expectedById = new Map(expected.map((asset) => [asset.id, asset]));
  const actualById = new Map(assets.map((asset) => [asset.id, asset]));
  for (const expectation of expected) {
    const asset = actualById.get(expectation.id);
    if (!asset) return { path: "assets", issueKey: `missing_id:${expectation.id}` };
    if (asset.kind !== expectation.kind) return { path: `assets.${asset.id}.kind`, issueKey: `expected_${expectation.kind}` };
    if (asset.bundleId !== expectation.bundleId) return { path: `assets.${asset.id}.bundleId`, issueKey: `expected_${expectation.bundleId}` };
    if (expectation.width !== undefined && (asset.kind !== "singleFrame" && asset.kind !== "image" || asset.width !== expectation.width)) return { path: `assets.${asset.id}.width`, issueKey: `expected_${expectation.width}` };
    if (expectation.height !== undefined && (asset.kind !== "singleFrame" && asset.kind !== "image" || asset.height !== expectation.height)) return { path: `assets.${asset.id}.height`, issueKey: `expected_${expectation.height}` };
    if (expectation.frameWidth !== undefined && (asset.kind !== "fieldActorSheet" && asset.kind !== "battleActorSheet" || asset.frameWidth !== expectation.frameWidth)) return { path: `assets.${asset.id}.frameWidth`, issueKey: `expected_${expectation.frameWidth}` };
    if (expectation.frameHeight !== undefined && (asset.kind !== "fieldActorSheet" && asset.kind !== "battleActorSheet" || asset.frameHeight !== expectation.frameHeight)) return { path: `assets.${asset.id}.frameHeight`, issueKey: `expected_${expectation.frameHeight}` };
  }
  for (const asset of assets) if (!expectedById.has(asset.id)) return { path: `assets.${asset.id}`, issueKey: "unexpected_id" };
  return null;
}

function sourceValues(asset: AssetEntryV1): readonly string[] {
  if (asset.kind === "audio") return [asset.oggSrc, asset.mp3Src];
  if (asset.kind === "atlas") return [asset.imageSrc, asset.dataSrc];
  if (asset.kind === "bitmapFont") return [asset.descriptorSrc, asset.textureSrc];
  return [asset.src];
}

function validateSource(asset: AssetEntryV1): { path: string; issueKey: string } | null {
  if (asset.source.sourceNote.trim().length === 0 || asset.source.licenseId.trim().length === 0) return { path: `assets.${asset.id}.source`, issueKey: "source_required" };
  if (asset.source.licenseId.trim().toLowerCase() === "unknown") return { path: `assets.${asset.id}.source.licenseId`, issueKey: "unknown_license" };
  for (const source of sourceValues(asset)) {
    if (/^(?:https?:|data:|\/\/)/i.test(source.trim())) return { path: `assets.${asset.id}`, issueKey: "hotlink_forbidden" };
    if (source.trim().length === 0) return { path: `assets.${asset.id}`, issueKey: "source_required" };
  }
  return null;
}

function validateAssetDetails(asset: AssetEntryV1, expected: AssetExpectation, options: AssetCatalogOptions, requireMetadata: boolean): { path: string; issueKey: string } | null {
  if (asset.kind === "fieldActorSheet") {
    if (asset.frameWidth * asset.columns !== 240 || asset.frameHeight * asset.rows !== 128) return { path: `assets.${asset.id}`, issueKey: "field_sheet_dimensions" };
    if (asset.clips.down.row !== 0 || asset.clips.left.row !== 1 || asset.clips.right.row !== 2 || asset.clips.up.row !== 3) return { path: `assets.${asset.id}.clips`, issueKey: "field_clip_rows" };
  }
  if (asset.kind === "battleActorSheet") {
    if (asset.frameWidth !== asset.frameHeight || asset.frameWidth * asset.columns !== (asset.frameWidth === 64 ? 1728 : 1296) || asset.frameHeight * asset.rows !== asset.frameHeight) return { path: `assets.${asset.id}`, issueKey: "battle_sheet_dimensions" };
  }
  if (asset.kind === "image") {
    if (asset.id === "image_boot_logo" && (asset.width !== 320 || asset.height !== 96)) return { path: `assets.${asset.id}`, issueKey: "boot_logo_size" };
    if (asset.id === "image_boot_background" && (asset.width !== 640 || asset.height !== 360)) return { path: `assets.${asset.id}`, issueKey: "boot_background_size" };
  }
  if (asset.kind === "atlas") {
    const expected = asset.id === "atlas_core_ui" ? CORE_UI_FRAMES : asset.id === "atlas_battle_fx" ? BATTLE_FX_FRAMES : null;
    if (expected && JSON.stringify(asset.requiredFrames) !== JSON.stringify(expected)) return { path: `assets.${asset.id}.requiredFrames`, issueKey: "atlas_frames" };
    if (duplicate(asset.requiredFrames)) return { path: `assets.${asset.id}.requiredFrames`, issueKey: "duplicate_frame" };
  }
  if (asset.kind === "audio") {
    const knownBundle = AUDIO_BUNDLE_BY_ID[asset.id];
    if (!knownBundle) return { path: `assets.${asset.id}`, issueKey: "unknown_audio_id" };
    if (knownBundle !== asset.bundleId) return { path: `assets.${asset.id}.bundleId`, issueKey: "audio_bundle" };
    const expectedChannel = MUSIC_SET.has(asset.id) ? "music" : "sfx";
    if (asset.channel !== expectedChannel) return { path: `assets.${asset.id}.channel`, issueKey: "audio_channel" };
    const expectedGain = expectedChannel === "music"
      ? MUSIC_BASE_GAIN_BPS[asset.id as keyof typeof MUSIC_BASE_GAIN_BPS]
      : SFX_BASE_GAIN_BPS[asset.id as keyof typeof SFX_BASE_GAIN_BPS];
    if (asset.baseGainBps !== expectedGain) return { path: `assets.${asset.id}.baseGainBps`, issueKey: "audio_gain" };
  }
  const inspector = options.metadataInspector;
  // fixture 只校验逻辑声明；物理元数据门禁仅在 batch/final 候选模式启用。
  if (!requireMetadata) return null;
  if (!inspector) return { path: `assets.${asset.id}`, issueKey: "metadata_unverified" };
  if (asset.kind === "fieldActorSheet" || asset.kind === "battleActorSheet" || asset.kind === "singleFrame" || asset.kind === "image" || asset.kind === "mapTileset") {
    const image = inspector.inspectImage(asset.src);
    if (!image) return { path: `assets.${asset.id}`, issueKey: "image_metadata_missing" };
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || image.width > 2048 || image.height > 2048) return { path: `assets.${asset.id}`, issueKey: "image_metadata_dimensions" };
    if (asset.kind === "fieldActorSheet" && (image.width !== 240 || image.height !== 128)) return { path: `assets.${asset.id}`, issueKey: "field_image_dimensions" };
    if (asset.kind === "battleActorSheet" && (image.width !== asset.frameWidth * asset.columns || image.height !== asset.frameHeight * asset.rows)) return { path: `assets.${asset.id}`, issueKey: "battle_image_dimensions" };
    if (asset.kind === "singleFrame" && (image.width !== asset.width || image.height !== asset.height)) return { path: `assets.${asset.id}`, issueKey: "single_frame_dimensions" };
    if (asset.kind === "image" && (image.width !== asset.width || image.height !== asset.height)) return { path: `assets.${asset.id}`, issueKey: "image_dimensions" };
    if (asset.kind === "mapTileset" && (image.width !== asset.columns * asset.tileSize || image.height !== asset.rows * asset.tileSize)) return { path: `assets.${asset.id}`, issueKey: "tileset_dimensions" };
  }
  if (asset.kind === "atlas") {
    const atlas = inspector.inspectAtlas(asset.imageSrc, asset.dataSrc);
    if (!atlas) return { path: `assets.${asset.id}`, issueKey: "atlas_metadata_missing" };
    if (atlas.imageWidth <= 0 || atlas.imageHeight <= 0 || atlas.imageWidth > 2048 || atlas.imageHeight > 2048) return { path: `assets.${asset.id}`, issueKey: "atlas_dimensions" };
    const actualFrames = Object.keys(atlas.frames);
    if (actualFrames.length !== asset.requiredFrames.length || actualFrames.some((frame) => !asset.requiredFrames.includes(frame))) return { path: `assets.${asset.id}`, issueKey: "atlas_frames" };
    for (const frameId of asset.requiredFrames) {
      const frame = atlas.frames[frameId];
      if (!frame || frame.x < 0 || frame.y < 0 || frame.width <= 0 || frame.height <= 0 || !Number.isInteger(frame.x) || !Number.isInteger(frame.y) || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.x + frame.width > atlas.imageWidth || frame.y + frame.height > atlas.imageHeight) return { path: `assets.${asset.id}.${frameId}`, issueKey: "atlas_frame_bounds" };
      if (asset.id === "atlas_battle_fx" && (frame.width !== 32 || frame.height !== 32)) return { path: `assets.${asset.id}.${frameId}`, issueKey: "atlas_frame_size" };
      if (asset.id === "atlas_core_ui") {
        const isObject = frameId === "object_chest_closed" || frameId === "object_portal_floor" || frameId === "object_portal_return";
        const isMarker = frameId === "marker_interact" || frameId === "marker_alert" || frameId === "marker_boss" || frameId === "marker_elite";
        if ((isObject && (frame.width !== 24 || frame.height !== 32)) || (isMarker && (frame.width !== 16 || frame.height !== 16))) {
          return { path: `assets.${asset.id}.${frameId}`, issueKey: "atlas_frame_size" };
        }
      }
    }
  }
  if (asset.kind === "bitmapFont") {
    const font = inspector.inspectBitmapFont(asset.descriptorSrc, asset.textureSrc);
    if (!font) return { path: `assets.${asset.id}`, issueKey: "font_metadata_missing" };
    if (!Number.isInteger(font.textureWidth) || !Number.isInteger(font.textureHeight) || font.textureWidth <= 0 || font.textureHeight <= 0 || font.textureWidth > 2048 || font.textureHeight > 2048) return { path: `assets.${asset.id}`, issueKey: "font_texture_dimensions" };
    if (options.requiredFontCharacters === undefined && requireMetadata) return { path: `assets.${asset.id}`, issueKey: "font_charset_unverified" };
    if (options.requiredFontCharacters) {
      const chars = new Set(font.characters);
      for (const character of options.requiredFontCharacters) if (!chars.has(character)) return { path: `assets.${asset.id}`, issueKey: `font_missing_character:${character}` };
    }
  }
  return null;
}

export class AssetCatalog {
  public readonly mode: AssetValidationMode;
  private readonly manifest: Readonly<AssetManifestV1>;
  private readonly assets = new Map<string, AssetEntryV1>();
  private readonly bundles = new Map<string, AssetBundleDefinitionV1>();
  private readonly animations = new Map<string, AnimationDefinitionV1>();

  private constructor(manifest: AssetManifestV1, mode: AssetValidationMode = "fixture") {
    this.manifest = deepFreeze(manifest) as Readonly<AssetManifestV1>;
    for (const asset of manifest.assets) this.assets.set(asset.id, asset);
    for (const bundle of manifest.bundles) this.bundles.set(bundle.id, bundle);
    for (const animation of manifest.animations) this.animations.set(animation.id, animation);
    this.mode = mode;
  }

  public static create(
    input: unknown,
    mode: AssetValidationMode = "fixture",
    options: AssetCatalogOptions = {},
  ): DomainResult<AssetCatalog> {
    const parsed = manifestSchema.safeParse(input);
    if (!parsed.success) return invalid("manifest", "schema");
    const manifest = parsed.data as unknown as AssetManifestV1;
    const bundleIssue = validateBundleGraph(manifest.bundles);
    if (bundleIssue) return invalid(bundleIssue.path, bundleIssue.issueKey);

    const assetDuplicate = duplicate(manifest.assets.map((asset) => asset.id));
    if (assetDuplicate) return invalid("assets", `duplicate_id:${assetDuplicate}`);
    const animationIssue = validateAnimations(manifest.animations);
    if (animationIssue) return invalid(animationIssue.path, animationIssue.issueKey);
    const expectedAssetsIssue = validateExpectedAssets(mode, manifest.assets);
    // 精确集合先于物理文件检查，避免同数量伪数据以缺文件错误掩盖真实契约错误。
    if (expectedAssetsIssue) return invalid(expectedAssetsIssue.path, expectedAssetsIssue.issueKey);
    if (mode !== "fixture" && !options.runtime && !options.fileExists) return invalid("assets", "physical_files_unverified");

    const bundleMap = new Map(manifest.bundles.map((bundle) => [bundle.id, bundle]));
    const ownerByAsset = new Map<string, string>();
    for (const bundle of manifest.bundles) {
      for (const assetId of bundle.assetIds) {
        if (ownerByAsset.has(assetId)) return invalid(`bundles.${bundle.id}.assetIds`, `asset_owner_duplicate:${assetId}`);
        ownerByAsset.set(assetId, bundle.id);
        if (!manifest.assets.some((asset) => asset.id === assetId)) return invalid(`bundles.${bundle.id}.assetIds`, `unknown_asset:${assetId}`);
      }
    }
    for (const asset of manifest.assets) {
      if (!bundleMap.has(asset.bundleId)) return invalid(`assets.${asset.id}.bundleId`, "unknown_bundle");
      if (ownerByAsset.get(asset.id) !== asset.bundleId) return invalid(`assets.${asset.id}.bundleId`, "owner_mismatch");
      const sourceIssue = validateSource(asset);
      if (sourceIssue) return invalid(sourceIssue.path, sourceIssue.issueKey);
      if (asset.kind === "audio") {
        const known = asset.channel === "music" ? MUSIC_SET : SFX_SET;
        if (!known.has(asset.id)) return invalid(`assets.${asset.id}`, "unknown_audio_id");
        if (asset.channel === "music" && !asset.loop) return invalid(`assets.${asset.id}.loop`, "music_loop_required");
        if (asset.channel === "sfx" && asset.loop) return invalid(`assets.${asset.id}.loop`, "sfx_loop_forbidden");
      }
      const expected = expectedAssetsForMode(mode).find((candidate) => candidate.id === asset.id);
      if (!expected) return invalid(`assets.${asset.id}`, "unexpected_id");
      const detailIssue = validateAssetDetails(asset, expected, options, mode !== "fixture" && options.runtime !== true);
      if (detailIssue) return invalid(detailIssue.path, detailIssue.issueKey);
      if (options.fileExists && mode !== "fixture" && options.runtime !== true) {
        for (const src of sourceValues(asset)) if (!options.fileExists(src)) return invalid(`assets.${asset.id}`, `missing_file:${src}`);
      }
    }
    return success(new AssetCatalog(manifest, mode));
  }

  public getManifest(): Readonly<AssetManifestV1> {
    return this.manifest;
  }

  public getAsset(id: string): DomainResult<Readonly<AssetEntryV1>> {
    const asset = this.assets.get(id);
    return asset ? success(asset) : invalid(`assets.${id}`, "missing_asset");
  }

  public getBundle(id: string): DomainResult<Readonly<AssetBundleDefinitionV1>> {
    const bundle = this.bundles.get(id);
    return bundle ? success(bundle) : invalid(`bundles.${id}`, "missing_bundle");
  }

  public getAnimation(id: string): DomainResult<Readonly<AnimationDefinitionV1>> {
    const animation = this.animations.get(id);
    return animation ? success(animation) : invalid(`animations.${id}`, "missing_animation");
  }

  public getBundleIds(): readonly string[] {
    return [...BUNDLE_IDS];
  }

  public getAssetIdsForBundle(id: string): DomainResult<readonly string[]> {
    const bundle = this.bundles.get(id);
    return bundle ? success(bundle.assetIds) : invalid(`bundles.${id}`, "missing_bundle");
  }

  public getDependencies(id: string): DomainResult<readonly string[]> {
    const bundle = this.bundles.get(id);
    return bundle ? success(bundle.dependsOn) : invalid(`bundles.${id}`, "missing_bundle");
  }
}

export const ASSET_BUNDLE_IDS = BUNDLE_IDS;
export const ASSET_BUNDLE_DEPENDS_ON = BUNDLE_DEPENDS;
export { assetSchema, animationSchema, manifestSchema };
