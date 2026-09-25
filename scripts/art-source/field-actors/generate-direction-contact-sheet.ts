import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { FIELD_ACTOR_SPECS } from "./FieldActorDefinitions";

const CELL_SCALE = 8;
const CELL_WIDTH = 24 * CELL_SCALE;
const CELL_HEIGHT = 32 * CELL_SCALE;
const GAP = 8;
const DIRECTIONS = ["down", "right", "up", "left"] as const;
const OUTPUT = "docs/art-source/review/vis-002d-field-directions-contact-sheet.png";

/** 生成供人工放大复核的四方向 contact sheet；不参与运行时资源加载。 */
export async function generateFieldDirectionContactSheet(projectRoot = process.cwd()): Promise<void> {
  const width = DIRECTIONS.length * CELL_WIDTH + (DIRECTIONS.length + 1) * GAP;
  const height = FIELD_ACTOR_SPECS.length * CELL_HEIGHT + (FIELD_ACTOR_SPECS.length + 1) * GAP;
  const canvas = Buffer.alloc(width * height * 4);
  for (let index = 0; index < canvas.length; index += 4) {
    canvas[index] = 13;
    canvas[index + 1] = 20;
    canvas[index + 2] = 41;
    canvas[index + 3] = 255;
  }
  const composites: sharp.OverlayOptions[] = [];
  for (const [row, spec] of FIELD_ACTOR_SPECS.entries()) {
    for (const [column, direction] of DIRECTIONS.entries()) {
      const input = path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${direction}_idle_00.png`);
      const image = await sharp(input).resize({ width: CELL_WIDTH, height: CELL_HEIGHT, kernel: sharp.kernel.nearest }).png().toBuffer();
      composites.push({ input: image, left: GAP + column * (CELL_WIDTH + GAP), top: GAP + row * (CELL_HEIGHT + GAP) });
    }
  }
  const output = path.join(projectRoot, OUTPUT);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp(canvas, { raw: { width, height, channels: 4 } }).composite(composites).png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false }).toFile(output);
  console.log(`FIELD_DIRECTION_CONTACT_SHEET_OK:${OUTPUT}:${width}x${height}`);
}

await generateFieldDirectionContactSheet().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
