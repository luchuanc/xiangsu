import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { BATTLE_ACTOR_SPECS } from "./battle-actors/BattleActorDefinitions";

const OUTPUT = "docs/art-source/review/vis-004a-battle-contact-sheet.png";
const CELL = 256;
const GAP = 12;
const COLUMNS = 5;

/** 生成首批战斗角色的放大 contact sheet，供人工复核，不参与运行时加载。 */
export async function generateBattleContactSheet(projectRoot = process.cwd()): Promise<void> {
  const rows = Math.ceil(BATTLE_ACTOR_SPECS.length / COLUMNS);
  const width = COLUMNS * CELL + (COLUMNS + 1) * GAP;
  const height = rows * CELL + (rows + 1) * GAP;
  const canvas = Buffer.alloc(width * height * 4);
  for (let index = 0; index < canvas.length; index += 4) {
    canvas[index] = 13;
    canvas[index + 1] = 20;
    canvas[index + 2] = 41;
    canvas[index + 3] = 255;
  }
  const composites: sharp.OverlayOptions[] = [];
  for (const [index, spec] of BATTLE_ACTOR_SPECS.entries()) {
    const frame = path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, "idle_00.png");
    const cellImage = await sharp(frame)
      .resize({ width: 192, height: 192, fit: "contain", background: { r: 13, g: 20, b: 41, alpha: 0 }, kernel: sharp.kernel.nearest })
      .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
      .toBuffer();
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    composites.push({ input: cellImage, left: GAP + column * (CELL + GAP) + 32, top: GAP + row * (CELL + GAP) + 24 });
  }
  const output = path.join(projectRoot, OUTPUT);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp(canvas, { raw: { width, height, channels: 4 } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
    .toFile(output);
  console.log(`BATTLE_CONTACT_SHEET_OK:${OUTPUT}:${width}x${height}`);
}

await generateBattleContactSheet().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

