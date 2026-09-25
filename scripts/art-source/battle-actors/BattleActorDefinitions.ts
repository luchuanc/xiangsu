import { BATTLE_ACTOR_FRAME_IDS } from "../../art-pack/ArtPackSchema";
import { FRONTIER_NIGHT_32_V1, paletteRgb } from "../../art-pack/PixelNormalizer";

export { BATTLE_ACTOR_FRAME_IDS };

export const BATTLE_ART_ASSET_COUNT = 10 as const;
export const BATTLE_ART_FRAME_WIDTH = 48 as const;
export const BATTLE_ART_FRAME_HEIGHT = 48 as const;
export const BATTLE_ART_COLUMNS = 27 as const;
export const BATTLE_ART_ROWS = 1 as const;
export const BATTLE_ART_NORMAL_ANCHOR = { x: 24, y: 42 } as const;
/** 普通角色的默认锚点；首领使用下方独立的 64 像素锚点。 */
export const BATTLE_ART_ANCHOR = BATTLE_ART_NORMAL_ANCHOR;
export const BATTLE_ART_BOSS_FRAME_WIDTH = 64 as const;
export const BATTLE_ART_BOSS_FRAME_HEIGHT = 64 as const;
export const BATTLE_ART_BOSS_ANCHOR = { x: 32, y: 58 } as const;
export const BATTLE_ART_PALETTE = FRONTIER_NIGHT_32_V1;

export type BattleActorKind = "character" | "enemy" | "boss";
export type BattleActorFacing = "left" | "right";

export interface BattleActorPalette {
  outline: string;
  shadow: string;
  base: string;
  highlight: string;
  accent: string;
  accentHighlight: string;
}

export type BattleActorSilhouette =
  | "wanderer"
  | "ironGuard"
  | "emberMage"
  | "priest"
  | "grassSlime"
  | "thornRat"
  | "fangWolf"
  | "goblinScout"
  | "stonehideBoar"
  | "hornedKing";

export interface BattleActorSpec {
  assetId: string;
  bundleId: "player_common" | "floor_01";
  kind: BattleActorKind;
  boss: boolean;
  facing: BattleActorFacing;
  inputDirectory: string;
  outputImage: string;
  outputData: string;
  frameWidth: 48 | 64;
  frameHeight: 48 | 64;
  columns: 27;
  rows: 1;
  anchor: { x: 24 | 32; y: 42 | 58 };
  palette: BattleActorPalette;
  silhouette: BattleActorSilhouette;
  frames: readonly string[];
}

const palette = (colors: BattleActorPalette): BattleActorPalette => colors;
const actorFrames = [...BATTLE_ACTOR_FRAME_IDS] as string[];

function base(
  assetId: string,
  bundleId: BattleActorSpec["bundleId"],
  kind: BattleActorKind,
  facing: BattleActorFacing,
  silhouette: BattleActorSilhouette,
  colors: BattleActorPalette,
  boss = false,
): BattleActorSpec {
  return {
    assetId,
    bundleId,
    kind,
    boss,
    facing,
    inputDirectory: `battle/${assetId}`,
    outputImage: `battle/${assetId}.png`,
    outputData: `battle/${assetId}.json`,
    frameWidth: boss ? 64 : 48,
    frameHeight: boss ? 64 : 48,
    columns: 27,
    rows: 1,
    anchor: boss ? BATTLE_ART_BOSS_ANCHOR : BATTLE_ART_NORMAL_ANCHOR,
    palette: palette(colors),
    silhouette,
    frames: actorFrames,
  };
}

const characters: BattleActorSpec[] = [
  base("sprite_battle_char_wanderer", "player_common", "character", "right", "wanderer", { outline: "#151B31", shadow: "#6B3B2A", base: "#28505A", highlight: "#6F9290", accent: "#B97945", accentHighlight: "#FFD98A" }),
  base("sprite_battle_char_iron_guard", "player_common", "character", "right", "ironGuard", { outline: "#151B31", shadow: "#364052", base: "#687080", highlight: "#B0B1B0", accent: "#28505A", accentHighlight: "#6F9290" }),
  base("sprite_battle_char_ember_mage", "player_common", "character", "right", "emberMage", { outline: "#151B31", shadow: "#8F5634", base: "#D65A62", highlight: "#F2B35D", accent: "#A93D4C", accentHighlight: "#FFD98A" }),
  base("sprite_battle_char_priest", "player_common", "character", "right", "priest", { outline: "#151B31", shadow: "#687080", base: "#D6D0C2", highlight: "#F2E5CB", accent: "#3F6B70", accentHighlight: "#9AAE73" }),
];

const enemies: BattleActorSpec[] = [
  base("sprite_battle_enemy_grass_slime", "floor_01", "enemy", "left", "grassSlime", { outline: "#151B31", shadow: "#36503D", base: "#557553", highlight: "#9AAE73", accent: "#F2E5CB", accentHighlight: "#FFD98A" }),
  base("sprite_battle_enemy_thorn_rat", "floor_01", "enemy", "left", "thornRat", { outline: "#151B31", shadow: "#4A2A25", base: "#8F5634", highlight: "#D79A54", accent: "#36503D", accentHighlight: "#9AAE73" }),
  base("sprite_battle_enemy_fang_wolf", "floor_01", "enemy", "left", "fangWolf", { outline: "#151B31", shadow: "#364052", base: "#687080", highlight: "#B0B1B0", accent: "#7C2E40", accentHighlight: "#D65A62" }),
  base("sprite_battle_enemy_goblin_scout", "floor_01", "enemy", "left", "goblinScout", { outline: "#151B31", shadow: "#23362E", base: "#557553", highlight: "#9AAE73", accent: "#7C2E40", accentHighlight: "#D65A62" }),
  base("sprite_battle_enemy_stonehide_boar", "floor_01", "enemy", "left", "stonehideBoar", { outline: "#151B31", shadow: "#4A5364", base: "#687080", highlight: "#B0B1B0", accent: "#D79A54", accentHighlight: "#FFD98A" }),
];

const boss = base("sprite_battle_boss_horned_king", "floor_01", "boss", "left", "hornedKing", { outline: "#0D1429", shadow: "#5E2234", base: "#A93D4C", highlight: "#D65A62", accent: "#D79A54", accentHighlight: "#FFD98A" }, true);

export const BATTLE_ACTOR_SPECS: readonly BattleActorSpec[] = Object.freeze([...characters, ...enemies, boss]);

const knownPalette = new Set(FRONTIER_NIGHT_32_V1);
for (const spec of BATTLE_ACTOR_SPECS) {
  for (const color of Object.values(spec.palette)) {
    if (!knownPalette.has(color)) throw new Error(`battle actor color outside fixed palette: ${spec.assetId}/${color}`);
    paletteRgb(color);
  }
}
