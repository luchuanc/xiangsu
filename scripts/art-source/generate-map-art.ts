import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { buildMapBlueprint } from "../../src/content/builders/mapBlueprint";
import { buildMapVisualLayers, type MapVisualLayers } from "../../src/content/builders/mapVisualLayers";
import { createFloor01Tileset } from "./map-tiles/Floor01TilesetSource";
import { createTownTileset } from "./map-tiles/TownTilesetSource";
import { getTile, TILE_SIZE } from "./map-tiles/MapTilesetContract";
import type { PixelSurface } from "./map-tiles/PixelSurface";

const root = process.cwd();
const inputRoot = path.join(root, "art/visual/v1/input/maps");
const reviewRoot = path.join(root, "docs/art-source/review");

async function writePng(file: string, surface: PixelSurface): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(surface.data), { raw: { width: surface.width, height: surface.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
    .toFile(file);
}

function copyTileScaled(target: Uint8Array, targetWidth: number, tile: Uint8Array, destinationX: number, destinationY: number, scale: number): void {
  for (let y = 0; y < TILE_SIZE; y += 1) for (let x = 0; x < TILE_SIZE; x += 1) {
    const source = (y * TILE_SIZE + x) * 4;
    for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) {
      const destination = ((destinationY + y * scale + dy) * targetWidth + destinationX + x * scale + dx) * 4;
      target[destination] = tile[source]!;
      target[destination + 1] = tile[source + 1]!;
      target[destination + 2] = tile[source + 2]!;
      target[destination + 3] = tile[source + 3]!;
    }
  }
}

function mapPreview(blueprint: ReturnType<typeof buildMapBlueprint>, layers: MapVisualLayers, tileset: PixelSurface, scale = 2, overlay = false): PixelSurface {
  const width = blueprint.widthTiles * TILE_SIZE * scale;
  const height = blueprint.heightTiles * TILE_SIZE * scale;
  const data = new Uint8Array(width * height * 4);
  const putLayer = (layer: readonly number[]): void => {
    for (let y = 0; y < blueprint.heightTiles; y += 1) for (let x = 0; x < blueprint.widthTiles; x += 1) {
      const encoded = layer[y * blueprint.widthTiles + x] ?? 0;
      const isDecor = layer === layers.decorBackLayer || layer === layers.decorFrontLayer;
      if (isDecor && encoded === 0) continue;
      copyTileScaled(data, width, getTile(tileset, isDecor ? encoded - 1 : encoded), x * TILE_SIZE * scale, y * TILE_SIZE * scale, scale);
    }
  };
  putLayer(layers.groundLayer);
  putLayer(layers.decorBackLayer);
  putLayer(layers.decorFrontLayer);
  if (overlay) {
    for (let y = 0; y < blueprint.heightTiles; y += 1) for (let x = 0; x < blueprint.widthTiles; x += 1) if (blueprint.collisionLayer[y * blueprint.widthTiles + x] === 1) {
      for (let py = 0; py < TILE_SIZE * scale; py += 1) for (let px = 0; px < TILE_SIZE * scale; px += 1) {
        const offset = ((y * TILE_SIZE * scale + py) * width + x * TILE_SIZE * scale + px) * 4;
        data[offset] = Math.max(data[offset]!, 150);
        data[offset + 1] = Math.min(data[offset + 1]!, 32);
        data[offset + 2] = Math.min(data[offset + 2]!, 42);
        data[offset + 3] = 210;
      }
    }
  }
  return { width, height, data };
}

async function writeContactSheet(town: PixelSurface, floor: PixelSurface): Promise<void> {
  const townBlueprint = buildMapBlueprint("map_town");
  const floorBlueprint = buildMapBlueprint("map_floor_01");
  const townMap = mapPreview(townBlueprint, buildMapVisualLayers(townBlueprint), town, 1, false);
  const townCollision = mapPreview(townBlueprint, buildMapVisualLayers(townBlueprint), town, 1, true);
  const floorMap = mapPreview(floorBlueprint, buildMapVisualLayers(floorBlueprint), floor, 1, false);
  const floorCollision = mapPreview(floorBlueprint, buildMapVisualLayers(floorBlueprint), floor, 1, true);
  const width = 2200;
  const height = 1800;
  const canvas = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < canvas.length; offset += 4) { canvas[offset] = 13; canvas[offset + 1] = 20; canvas[offset + 2] = 41; canvas[offset + 3] = 255; }
  // 纯色分隔线让审阅者能直接区分 town/floor 与 normal/collision 四个区块。
  for (let y = 1024; y < 1032; y += 1) for (let x = 0; x < width; x += 1) { const offset = (y * width + x) * 4; canvas[offset] = 215; canvas[offset + 1] = 154; canvas[offset + 2] = 84; canvas[offset + 3] = 255; }
  for (let y = 0; y < 1024; y += 1) for (let x = 1024; x < 1032; x += 1) { const offset = (y * width + x) * 4; canvas[offset] = 215; canvas[offset + 1] = 154; canvas[offset + 2] = 84; canvas[offset + 3] = 255; }
  const compose = async (surface: PixelSurface, left: number, top: number, scale = 1): Promise<void> => {
    const resized = await sharp(Buffer.from(surface.data), { raw: { width: surface.width, height: surface.height, channels: 4 } })
      .resize({ width: Math.round(surface.width * scale), height: Math.round(surface.height * scale), kernel: sharp.kernel.nearest })
      .raw().toBuffer();
    const targetWidth = Math.round(surface.width * scale);
    const targetHeight = Math.round(surface.height * scale);
    for (let y = 0; y < targetHeight; y += 1) for (let x = 0; x < targetWidth; x += 1) {
      if (left + x >= width || top + y >= height) continue;
      const source = (y * targetWidth + x) * 4;
      const destination = ((top + y) * width + left + x) * 4;
      canvas[destination] = resized[source]!;
      canvas[destination + 1] = resized[source + 1]!;
      canvas[destination + 2] = resized[source + 2]!;
      canvas[destination + 3] = resized[source + 3]!;
    }
  };
  // 上方各自独立展示 tileset；下方把正常地图与 collision overlay 分栏，红色只出现在对照栏。
  await compose(town, 0, 0, 4);
  await compose(floor, 1040, 0, 4);
  await compose(townMap, 0, 540, 0.5);
  await compose(townCollision, 700, 540, 0.5);
  await compose(floorMap, 0, 1100, 0.5);
  await compose(floorCollision, 850, 1100, 0.5);
  await fs.mkdir(reviewRoot, { recursive: true });
  await sharp(Buffer.from(canvas), { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(path.join(reviewRoot, "vis-002c-map-contact-sheet.png"));
}

export async function generateMapArt(): Promise<void> {
  const town = createTownTileset();
  const floor = createFloor01Tileset();
  await writePng(path.join(inputRoot, "town.png"), town);
  await writePng(path.join(inputRoot, "floor_01.png"), floor);
  await writeContactSheet(town, floor);
  console.log("MAP_ART_GENERATE_OK");
}

await generateMapArt().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
