import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import {
  FIELD_ACTOR_FRAME_IDS,
  FIELD_ACTOR_SPECS,
  FIELD_ART_PALETTE,
  type FieldActorSpec,
} from "./field-actors/FieldActorDefinitions";

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function paletteColorSet(): Set<string> {
  return new Set(FIELD_ART_PALETTE.map((value) => {
    const red = Number.parseInt(value.slice(1, 3), 16);
    const green = Number.parseInt(value.slice(3, 5), 16);
    const blue = Number.parseInt(value.slice(5, 7), 16);
    return `${red}-${green}-${blue}`;
  }));
}

async function verifyFrame(projectRoot: string, spec: FieldActorSpec, frameId: string, colors: Set<string>): Promise<string> {
  const file = path.resolve(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${frameId}.png`);
  const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (raw.info.width !== 24 || raw.info.height !== 32) throw new Error(`FIELD_ART_DIMENSION_INVALID:${spec.assetId}/${frameId}`);
  let anchorPixels = 0;
  let opaquePixels = 0;
  const frameColors = new Set<string>();
  for (let y = 0; y < raw.info.height; y += 1) {
    for (let x = 0; x < raw.info.width; x += 1) {
      const offset = (y * raw.info.width + x) * 4;
      const alpha = raw.data[offset + 3] ?? 0;
      if (alpha !== 0 && alpha !== 255) throw new Error(`FIELD_ART_ALPHA_INVALID:${spec.assetId}/${frameId}`);
      if (alpha === 0) continue;
      if (y > 28) throw new Error(`FIELD_ART_ANCHOR_CLIP:${spec.assetId}/${frameId}`);
      if (y === 28) anchorPixels += 1;
      opaquePixels += 1;
      const color = `${raw.data[offset]}-${raw.data[offset + 1]}-${raw.data[offset + 2]}`;
      if (!colors.has(color)) throw new Error(`FIELD_ART_PALETTE_INVALID:${spec.assetId}/${frameId}/${color}`);
      frameColors.add(color);
    }
  }
  if (opaquePixels === 0 || anchorPixels === 0) throw new Error(`FIELD_ART_FRAME_EMPTY:${spec.assetId}/${frameId}`);
  if (frameColors.size < 4) throw new Error(`FIELD_ART_DETAIL_TOO_LOW:${spec.assetId}/${frameId}`);
  return hash(raw.data);
}

export async function verifyFieldArt(projectRoot = process.cwd()): Promise<void> {
  const colors = paletteColorSet();
  const seenIdentityHashes = new Set<string>();
  for (const spec of FIELD_ACTOR_SPECS) {
    const clipHashes = new Map<string, Set<string>>();
    let firstHash = "";
    for (const [index, frameId] of spec.frames.entries()) {
      if (frameId !== FIELD_ACTOR_FRAME_IDS[index]) throw new Error(`FIELD_ART_FRAME_ORDER_INVALID:${spec.assetId}/${frameId}`);
      const frameHash = await verifyFrame(projectRoot, spec, frameId, colors);
      if (index === 0) firstHash = frameHash;
      const [direction, clip] = frameId.split("_") as [string, string];
      const key = `${direction}_${clip}`;
      const hashes = clipHashes.get(key) ?? new Set<string>();
      hashes.add(frameHash);
      clipHashes.set(key, hashes);
    }
    for (const [clip, hashes] of clipHashes) if (hashes.size < 2) throw new Error(`FIELD_ART_CLIP_NOT_ANIMATED:${spec.assetId}/${clip}`);
    if (seenIdentityHashes.has(firstHash)) throw new Error(`FIELD_ART_IDENTITY_COLLISION:${spec.assetId}`);
    seenIdentityHashes.add(firstHash);
  }
  console.log(`FIELD_ART_VERIFY_OK:${FIELD_ACTOR_SPECS.length} assets/${FIELD_ACTOR_SPECS.length * FIELD_ACTOR_FRAME_IDS.length} frames`);
}

await verifyFieldArt().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
