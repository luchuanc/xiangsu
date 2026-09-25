import { FIELD_ACTOR_FRAME_IDS } from "../../art-pack/ArtPackSchema";
import { FRONTIER_NIGHT_32_V1, paletteRgb } from "../../art-pack/PixelNormalizer";

export { FIELD_ACTOR_FRAME_IDS };

export const FIELD_ART_ASSET_COUNT = 18 as const;
export const FIELD_ART_FRAME_WIDTH = 24 as const;
export const FIELD_ART_FRAME_HEIGHT = 32 as const;
export const FIELD_ART_COLUMNS = 10 as const;
export const FIELD_ART_ROWS = 4 as const;
export const FIELD_ART_ANCHOR = { x: 12, y: 28 } as const;
export const FIELD_ART_PALETTE = FRONTIER_NIGHT_32_V1;

export type FieldActorKind = "character" | "npc" | "encounter";
export type FieldActorFacing = "down" | "left" | "right" | "up";

export interface FieldActorPalette {
  outline: string;
  shadow: string;
  base: string;
  highlight: string;
  accent: string;
  accentHighlight: string;
}

export interface FieldActorSpec {
  assetId: string;
  bundleId: "player_common" | "town" | "floor_01";
  kind: FieldActorKind;
  inputDirectory: string;
  outputImage: string;
  outputData: string;
  frameWidth: 24;
  frameHeight: 32;
  columns: 10;
  rows: 4;
  anchor: { x: 12; y: 28 };
  palette: FieldActorPalette;
  /** 供生成器选择独立的轮廓、道具和轮廓比例，不是运行时兼容别名。 */
  silhouette: "wanderer" | "guard" | "mage" | "priest" | "ranger" | "seer" | "tavern" | "blacksmith" | "mentor" | "merchant" | "innkeeper" | "cartographer" | "watcher" | "slime" | "thornRat" | "wolfGoblin" | "stonehideBoar" | "hornedKing";
  frames: readonly string[];
}

const palette = (colors: FieldActorPalette): FieldActorPalette => colors;

const actorFrames = [...FIELD_ACTOR_FRAME_IDS] as string[];
const base = (assetId: string, bundleId: FieldActorSpec["bundleId"], kind: FieldActorKind, silhouette: FieldActorSpec["silhouette"], colors: FieldActorPalette): FieldActorSpec => ({
  assetId,
  bundleId,
  kind,
  inputDirectory: `field/${assetId}`,
  outputImage: `field/${assetId}.png`,
  outputData: `field/${assetId}.json`,
  frameWidth: 24,
  frameHeight: 32,
  columns: 10,
  rows: 4,
  anchor: { x: 12, y: 28 },
  palette: palette(colors),
  silhouette,
  frames: actorFrames,
});

const characters: FieldActorSpec[] = [
  base("sprite_field_char_wanderer", "player_common", "character", "wanderer", { outline: "#151B31", shadow: "#6B3B2A", base: "#28505A", highlight: "#6F9290", accent: "#B97945", accentHighlight: "#FFD98A" }),
  base("sprite_field_char_iron_guard", "player_common", "character", "guard", { outline: "#151B31", shadow: "#364052", base: "#687080", highlight: "#B0B1B0", accent: "#28505A", accentHighlight: "#6F9290" }),
  base("sprite_field_char_ember_mage", "player_common", "character", "mage", { outline: "#151B31", shadow: "#8F5634", base: "#D65A62", highlight: "#F2B35D", accent: "#A93D4C", accentHighlight: "#FFD98A" }),
  base("sprite_field_char_priest", "player_common", "character", "priest", { outline: "#151B31", shadow: "#687080", base: "#D6D0C2", highlight: "#F2E5CB", accent: "#3F6B70", accentHighlight: "#9AAE73" }),
  base("sprite_field_char_ranger", "player_common", "character", "ranger", { outline: "#151B31", shadow: "#36503D", base: "#557553", highlight: "#9AAE73", accent: "#B97945", accentHighlight: "#F2B35D" }),
  base("sprite_field_char_frost_seer", "player_common", "character", "seer", { outline: "#151B31", shadow: "#28505A", base: "#3F6B70", highlight: "#6F9290", accent: "#D6D0C2", accentHighlight: "#F2E5CB" }),
];

const npcs: FieldActorSpec[] = [
  base("sprite_npc_tavern_keeper", "town", "npc", "tavern", { outline: "#151B31", shadow: "#6B3B2A", base: "#A93D4C", highlight: "#D65A62", accent: "#D6D0C2", accentHighlight: "#FFD98A" }),
  base("sprite_npc_blacksmith", "town", "npc", "blacksmith", { outline: "#151B31", shadow: "#202742", base: "#4A5364", highlight: "#B0B1B0", accent: "#D79A54", accentHighlight: "#F2B35D" }),
  base("sprite_npc_skill_mentor", "town", "npc", "mentor", { outline: "#151B31", shadow: "#2B1B1D", base: "#5E2234", highlight: "#A93D4C", accent: "#28505A", accentHighlight: "#6F9290" }),
  base("sprite_npc_merchant", "town", "npc", "merchant", { outline: "#151B31", shadow: "#8F5634", base: "#D79A54", highlight: "#FFD98A", accent: "#36503D", accentHighlight: "#9AAE73" }),
  base("sprite_npc_innkeeper", "town", "npc", "innkeeper", { outline: "#151B31", shadow: "#28505A", base: "#3F6B70", highlight: "#6F9290", accent: "#F2E5CB", accentHighlight: "#FFD98A" }),
  base("sprite_npc_cartographer", "town", "npc", "cartographer", { outline: "#151B31", shadow: "#4A2A25", base: "#7C2E40", highlight: "#D65A62", accent: "#B0B1B0", accentHighlight: "#F2E5CB" }),
  base("sprite_npc_abyss_watcher", "town", "npc", "watcher", { outline: "#0D1429", shadow: "#2B1B1D", base: "#5E2234", highlight: "#A93D4C", accent: "#6F9290", accentHighlight: "#D79A54" }),
];

const encounters: FieldActorSpec[] = [
  base("sprite_field_encounter_floor_01_normal_a", "floor_01", "encounter", "slime", { outline: "#151B31", shadow: "#36503D", base: "#557553", highlight: "#9AAE73", accent: "#F2E5CB", accentHighlight: "#FFD98A" }),
  base("sprite_field_encounter_floor_01_normal_b", "floor_01", "encounter", "thornRat", { outline: "#151B31", shadow: "#4A2A25", base: "#8F5634", highlight: "#D79A54", accent: "#36503D", accentHighlight: "#9AAE73" }),
  base("sprite_field_encounter_floor_01_normal_c", "floor_01", "encounter", "wolfGoblin", { outline: "#151B31", shadow: "#364052", base: "#687080", highlight: "#B0B1B0", accent: "#7C2E40", accentHighlight: "#D65A62" }),
  base("sprite_field_encounter_floor_01_elite_boar", "floor_01", "encounter", "stonehideBoar", { outline: "#151B31", shadow: "#4A5364", base: "#687080", highlight: "#B0B1B0", accent: "#D79A54", accentHighlight: "#FFD98A" }),
  base("sprite_field_encounter_floor_01_boss", "floor_01", "encounter", "hornedKing", { outline: "#0D1429", shadow: "#5E2234", base: "#A93D4C", highlight: "#D65A62", accent: "#D79A54", accentHighlight: "#FFD98A" }),
];

export const FIELD_ACTOR_SPECS: readonly FieldActorSpec[] = Object.freeze([...characters, ...npcs, ...encounters]);

const knownPalette = new Set(FRONTIER_NIGHT_32_V1);
for (const spec of FIELD_ACTOR_SPECS) {
  for (const color of Object.values(spec.palette)) {
    if (!knownPalette.has(color)) throw new Error(`field actor color outside fixed palette: ${spec.assetId}/${color}`);
    paletteRgb(color);
  }
}
