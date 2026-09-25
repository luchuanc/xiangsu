import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import mapArtGolden from "../../art/visual/v1/map-art.golden.json";
import { buildMapBlueprint } from "../../src/content/builders/mapBlueprint";
import { buildMapVisualLayers } from "../../src/content/builders/mapVisualLayers";
import { assertMapTilesetContract, getTile, MAP_TILESET_HEIGHT, MAP_TILESET_WIDTH, tileEdgeSignature } from "./map-tiles/MapTilesetContract";
import { createFloor01Tileset } from "./map-tiles/Floor01TilesetSource";
import { createTownTileset } from "./map-tiles/TownTilesetSource";
import type { PixelSurface } from "./map-tiles/PixelSurface";

const root = process.cwd();

type MapArtGolden = {
  schemaVersion: number;
  paletteId: string;
  tileSize: number;
  tilesets: Record<"town" | "floor_01", { rawPixelSha256: string; autotileEdgeSha256: string }>;
  visualLayers: Record<"map_town" | "map_floor_01", { sha256: string }>;
  contactSheet: { sha256: string };
};

function assertStrictGoldenShape(value: unknown): asserts value is MapArtGolden {
  if (!value || typeof value !== "object") throw new Error("MAP_ART_GOLDEN_INVALID");
  const rootKeys = Object.keys(value as Record<string, unknown>).sort();
  if (JSON.stringify(rootKeys) !== JSON.stringify(["contactSheet", "paletteId", "schemaVersion", "tileSize", "tilesets", "visualLayers"])) throw new Error("MAP_ART_GOLDEN_FIELDS_INVALID");
  const typed = value as MapArtGolden;
  if (typed.schemaVersion !== 1 || typed.paletteId !== "FRONTIER_NIGHT_32_V1" || typed.tileSize !== 16) throw new Error("MAP_ART_GOLDEN_HEADER_INVALID");
  if (JSON.stringify(Object.keys(typed.tilesets).sort()) !== JSON.stringify(["floor_01", "town"])) throw new Error("MAP_ART_GOLDEN_TILESET_FIELDS_INVALID");
  for (const entry of Object.values(typed.tilesets)) {
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["autotileEdgeSha256", "rawPixelSha256"]) || !/^[0-9a-f]{64}$/.test(entry.rawPixelSha256) || !/^[0-9a-f]{64}$/.test(entry.autotileEdgeSha256)) throw new Error("MAP_ART_GOLDEN_TILESET_ENTRY_INVALID");
  }
  if (JSON.stringify(Object.keys(typed.visualLayers).sort()) !== JSON.stringify(["map_floor_01", "map_town"])) throw new Error("MAP_ART_GOLDEN_LAYER_FIELDS_INVALID");
  for (const entry of Object.values(typed.visualLayers)) if (JSON.stringify(Object.keys(entry)) !== JSON.stringify(["sha256"]) || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error("MAP_ART_GOLDEN_LAYER_ENTRY_INVALID");
  if (JSON.stringify(Object.keys(typed.contactSheet)) !== JSON.stringify(["sha256"]) || !/^[0-9a-f]{64}$/.test(typed.contactSheet.sha256)) throw new Error("MAP_ART_GOLDEN_CONTACT_FIELDS_INVALID");
}

function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }

async function readSurface(file: string): Promise<PixelSurface> {
  const metadata = await sharp(file).metadata();
  if (metadata.width !== MAP_TILESET_WIDTH || metadata.height !== MAP_TILESET_HEIGHT || metadata.format !== "png") throw new Error(`MAP_ART_DIMENSION_INVALID:${file}`);
  const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: raw.info.width, height: raw.info.height, data: new Uint8Array(raw.data) };
}

function assertLayers(mapId: "map_town" | "map_floor_01"): void {
  const blueprint = buildMapBlueprint(mapId);
  const layers = buildMapVisualLayers(blueprint);
  const expectedLength = blueprint.widthTiles * blueprint.heightTiles;
  if (layers.groundLayer.length !== expectedLength || layers.decorBackLayer.length !== expectedLength || layers.decorFrontLayer.length !== expectedLength) throw new Error(`MAP_ART_LAYER_LENGTH_INVALID:${mapId}`);
  for (const [name, layer] of Object.entries(layers)) {
    if (layer.some((tile) => !Number.isInteger(tile) || tile < 0 || tile > 256)) throw new Error(`MAP_ART_LAYER_TILE_INVALID:${mapId}:${name}`);
    const isDecor = name === "decorBackLayer" || name === "decorFrontLayer";
    if (layer.some((tile) => isDecor ? tile > 0 && tile - 1 > 95 : tile > 95)) throw new Error(`MAP_ART_RESERVED_TILE_REFERENCED:${mapId}:${name}`);
  }
  const expected = mapArtGolden.visualLayers[mapId].sha256;
  if (sha256(JSON.stringify(layers)) !== expected) throw new Error(`MAP_ART_LAYER_GOLDEN_MISMATCH:${mapId}`);
}

export async function verifyMapArt(): Promise<void> {
  const goldenPath = path.join(root, "art/visual/v1/map-art.golden.json");
  const goldenText = await fs.readFile(goldenPath, "utf8");
  const parsedGolden = JSON.parse(goldenText) as unknown;
  if (goldenText !== `${JSON.stringify(parsedGolden, null, 2)}\n` || JSON.stringify(parsedGolden) !== JSON.stringify(mapArtGolden)) throw new Error("MAP_ART_GOLDEN_NONCANONICAL");
  assertStrictGoldenShape(mapArtGolden);
  const town = await readSurface(path.join(root, "art/visual/v1/input/maps/town.png"));
  const floor = await readSurface(path.join(root, "art/visual/v1/input/maps/floor_01.png"));
  assertMapTilesetContract(town);
  assertMapTilesetContract(floor);
  const expectedTown = createTownTileset();
  const expectedFloor = createFloor01Tileset();
  if (!Buffer.from(town.data).equals(Buffer.from(expectedTown.data))) throw new Error("MAP_ART_TOWN_NONDETERMINISTIC");
  if (!Buffer.from(floor.data).equals(Buffer.from(expectedFloor.data))) throw new Error("MAP_ART_FLOOR_NONDETERMINISTIC");
  if (sha256(town.data) !== mapArtGolden.tilesets.town.rawPixelSha256 || sha256(floor.data) !== mapArtGolden.tilesets.floor_01.rawPixelSha256) throw new Error("MAP_ART_TILESET_GOLDEN_MISMATCH");
  const townEdges = sha256(JSON.stringify(Array.from({ length: 16 }, (_, mask) => tileEdgeSignature(getTile(town, 32 + mask)))));
  const floorEdges = sha256(JSON.stringify(Array.from({ length: 16 }, (_, mask) => tileEdgeSignature(getTile(floor, 32 + mask)))));
  // 16 mask 的原始边像素摘要固定，防止交换 N/E 后只剩“有像素”而未被发现。
  if (townEdges !== mapArtGolden.tilesets.town.autotileEdgeSha256 || floorEdges !== mapArtGolden.tilesets.floor_01.autotileEdgeSha256) throw new Error("MAP_ART_AUTOTILE_GOLDEN_MISMATCH");
  assertLayers("map_town");
  assertLayers("map_floor_01");
  const contactPath = path.join(root, "docs/art-source/review/vis-002c-map-contact-sheet.png");
  const contact = await fs.readFile(contactPath);
  if (sha256(contact) !== mapArtGolden.contactSheet.sha256) throw new Error("MAP_ART_CONTACT_SHEET_GOLDEN_MISMATCH");
  console.log("MAP_ART_VERIFY_OK");
}

await verifyMapArt().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
