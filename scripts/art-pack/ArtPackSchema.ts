import { z } from "zod";

export const ART_PACK_SCHEMA_VERSION = 1 as const;
export const ART_PACK_ID = "visual-v1" as const;
export const ART_PACK_INPUT_ROOT = "art/visual/v1/input" as const;
export const ART_PACK_OUTPUT_ROOT = "public/assets/visual/v1" as const;
export const ART_PACK_PALETTE_ID = "frontier-night-32-v1" as const;
export const ART_PACK_ALPHA_MODE = "threshold-128" as const;

export const FIELD_ACTOR_FRAME_IDS = ["down", "left", "right", "up"].flatMap((direction) => [
  ...Array.from({ length: 4 }, (_, index) => `${direction}_idle_${String(index).padStart(2, "0")}`),
  ...Array.from({ length: 6 }, (_, index) => `${direction}_walk_${String(index).padStart(2, "0")}`),
]);
export const BATTLE_ACTOR_FRAME_IDS = [
  ...Array.from({ length: 4 }, (_, index) => `idle_${String(index).padStart(2, "0")}`),
  ...Array.from({ length: 6 }, (_, index) => `attack_${String(index).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, index) => `skill_${String(index).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `hit_${String(index).padStart(2, "0")}`),
  ...Array.from({ length: 6 }, (_, index) => `down_${String(index).padStart(2, "0")}`),
];

export class ArtPackError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(`${code}:${message}`);
    this.name = "ArtPackError";
  }
}

const sourceRecordSchema = z.object({
  sourceKind: z.enum(["generated", "original", "licensed"]),
  sourceNote: z.string().min(1),
  licenseId: z.string().min(1),
  licenseFile: z.string().nullable(),
}).strict();

const frameSchema = z.object({
  id: z.string().min(1),
  input: z.string().min(1),
}).strict();

const sheetOutputSchema = z.object({
  image: z.string().min(1),
  data: z.string().min(1),
}).strict();

const baseFields = {
  assetId: z.string().min(1),
  bundleId: z.string().min(1),
  source: sourceRecordSchema,
};

const fieldActorSchema = z.object({
  ...baseFields,
  kind: z.literal("fieldActor"),
  frameWidth: z.literal(24),
  frameHeight: z.literal(32),
  columns: z.literal(10),
  rows: z.literal(4),
  frames: z.array(frameSchema),
  output: sheetOutputSchema,
  anchor: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strict(),
}).strict();

const battleActorSchema = z.object({
  ...baseFields,
  kind: z.literal("battleActor"),
  boss: z.boolean(),
  frameWidth: z.union([z.literal(48), z.literal(64)]),
  frameHeight: z.union([z.literal(48), z.literal(64)]),
  columns: z.union([z.literal(27), z.literal(27)]),
  rows: z.literal(1),
  frames: z.array(frameSchema),
  output: sheetOutputSchema,
  anchor: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strict(),
}).strict();

const imageSchema = z.object({
  ...baseFields,
  kind: z.literal("image"),
  input: z.string().min(1),
  output: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

const singleFrameSchema = z.object({
  ...baseFields,
  kind: z.literal("singleFrame"),
  input: z.string().min(1),
  output: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

const mapTilesetSchema = z.object({
  ...baseFields,
  kind: z.literal("mapTileset"),
  input: z.string().min(1),
  output: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
}).strict();

const atlasFrameSchema = z.object({
  id: z.string().min(1),
  input: z.string().min(1),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

const atlasSchema = z.object({
  ...baseFields,
  kind: z.literal("atlas"),
  imageOutput: z.string().min(1),
  dataOutput: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frames: z.array(atlasFrameSchema).min(1),
  requiredFrames: z.array(z.string().min(1)).min(1),
}).strict();

const bitmapFontSchema = z.object({
  ...baseFields,
  kind: z.literal("bitmapFont"),
  imageInput: z.string().min(1),
  descriptorInput: z.string().min(1),
  imageOutput: z.string().min(1),
  descriptorOutput: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  glyphHeight: z.number().int().positive(),
}).strict();

export const artPackEntrySchema = z.discriminatedUnion("kind", [
  fieldActorSchema,
  battleActorSchema,
  singleFrameSchema,
  mapTilesetSchema,
  atlasSchema,
  bitmapFontSchema,
  imageSchema,
]);

export const artPackConfigSchema = z.object({
  schemaVersion: z.literal(ART_PACK_SCHEMA_VERSION),
  packId: z.literal(ART_PACK_ID),
  inputRoot: z.literal(ART_PACK_INPUT_ROOT),
  outputRoot: z.literal(ART_PACK_OUTPUT_ROOT),
  paletteId: z.literal(ART_PACK_PALETTE_ID),
  alphaMode: z.literal(ART_PACK_ALPHA_MODE),
  entries: z.array(artPackEntrySchema),
}).strict();

export type ArtSourceRecordV1 = z.infer<typeof sourceRecordSchema>;
export type FieldActorPackEntryV1 = z.infer<typeof fieldActorSchema>;
export type BattleActorPackEntryV1 = z.infer<typeof battleActorSchema>;
export type SingleFramePackEntryV1 = z.infer<typeof singleFrameSchema>;
export type MapTilesetPackEntryV1 = z.infer<typeof mapTilesetSchema>;
export type AtlasPackEntryV1 = z.infer<typeof atlasSchema>;
export type BitmapFontPackEntryV1 = z.infer<typeof bitmapFontSchema>;
export type ImagePackEntryV1 = z.infer<typeof imageSchema>;
export type ArtPackEntryV1 = z.infer<typeof artPackEntrySchema>;
export type ArtPackConfigV1 = z.infer<typeof artPackConfigSchema>;

interface EntryPathGroups {
  inputs: string[];
  outputs: string[];
  licenses: string[];
}

const entryPathGroups = (entry: ArtPackEntryV1): EntryPathGroups => {
  const licenses = entry.source.licenseFile === null ? [] : [entry.source.licenseFile];
  switch (entry.kind) {
    case "fieldActor":
    case "battleActor":
      return { inputs: entry.frames.map((frame) => frame.input), outputs: [entry.output.image, entry.output.data], licenses };
    case "atlas":
      return { inputs: entry.frames.map((frame) => frame.input), outputs: [entry.imageOutput, entry.dataOutput], licenses };
    case "bitmapFont":
      return { inputs: [entry.imageInput, entry.descriptorInput], outputs: [entry.imageOutput, entry.descriptorOutput], licenses };
    default:
      return { inputs: [entry.input], outputs: [entry.output], licenses };
  }
};

export function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\u0000") || value.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/i.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function validateSource(entry: ArtPackEntryV1): void {
  const { source } = entry;
  if (source.licenseId === "unknown" || (source.sourceKind === "licensed") !== (source.licenseFile !== null)) {
    throw new ArtPackError("ART_PACK_LICENSE_INVALID", entry.assetId);
  }
  if (source.sourceKind === "licensed" && (!source.licenseFile || !source.licenseFile.startsWith("licenses/") || !isSafeRelativePath(source.licenseFile))) {
    throw new ArtPackError("ART_PACK_LICENSE_INVALID", entry.assetId);
  }
}

function validateFrames(entry: ArtPackEntryV1): void {
  if (entry.kind === "fieldActor" && (entry.frames.length !== FIELD_ACTOR_FRAME_IDS.length || entry.frames.map((frame) => frame.id).join("\u0000") !== FIELD_ACTOR_FRAME_IDS.join("\u0000"))) {
    throw new ArtPackError("ART_PACK_FRAME_SET_INVALID", entry.assetId);
  }
  if (entry.kind === "fieldActor" && (entry.anchor.x !== 12 || entry.anchor.y !== 28)) {
    throw new ArtPackError("ART_PACK_ANCHOR_INVALID", entry.assetId);
  }
  if (entry.kind === "battleActor") {
    const expectedWidth = entry.boss ? 64 : 48;
    const expectedHeight = entry.boss ? 64 : 48;
    const expectedAnchor = entry.boss ? { x: 32, y: 58 } : { x: 24, y: 42 };
    if (entry.frames.length !== BATTLE_ACTOR_FRAME_IDS.length || entry.frameWidth !== expectedWidth || entry.frameHeight !== expectedHeight || entry.anchor.x !== expectedAnchor.x || entry.anchor.y !== expectedAnchor.y || entry.frames.map((frame) => frame.id).join("\u0000") !== BATTLE_ACTOR_FRAME_IDS.join("\u0000")) {
      throw new ArtPackError("ART_PACK_FRAME_SET_INVALID", entry.assetId);
    }
  }
}

function validateAtlas(entry: AtlasPackEntryV1): void {
  const ids = new Set<string>();
  const rectangles: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const frame of entry.frames) {
    if (ids.has(frame.id)) throw new ArtPackError("ART_PACK_DUPLICATE_FRAME", `${entry.assetId}/${frame.id}`);
    ids.add(frame.id);
    if (frame.x + frame.width > entry.width || frame.y + frame.height > entry.height) throw new ArtPackError("ART_PACK_ATLAS_BOUNDS", `${entry.assetId}/${frame.id}`);
    for (const previous of rectangles) {
      if (frame.x < previous.x + previous.width && frame.x + frame.width > previous.x && frame.y < previous.y + previous.height && frame.y + frame.height > previous.y) {
        throw new ArtPackError("ART_PACK_ATLAS_OVERLAP", `${entry.assetId}/${frame.id}`);
      }
    }
    rectangles.push(frame);
  }
  if (entry.requiredFrames.length !== entry.frames.length || entry.requiredFrames.some((frameId, index) => frameId !== entry.frames[index]?.id)) {
    throw new ArtPackError("ART_PACK_FRAME_SET_INVALID", entry.assetId);
  }
}

export function parseArtPackConfig(value: unknown): ArtPackConfigV1 {
  const parsed = artPackConfigSchema.safeParse(value);
  if (!parsed.success) throw new ArtPackError("ART_PACK_SCHEMA_INVALID", parsed.error.issues.map((issue) => issue.path.join(".")).join(","));
  const assetIds = new Set<string>();
  const outputs = new Set<string>();
  for (const entry of parsed.data.entries) {
    if (assetIds.has(entry.assetId)) throw new ArtPackError("ART_PACK_DUPLICATE_ASSET", entry.assetId);
    assetIds.add(entry.assetId);
    validateSource(entry);
    validateFrames(entry);
    if (entry.kind === "atlas") validateAtlas(entry);
    const paths = entryPathGroups(entry);
    for (const candidate of [...paths.inputs, ...paths.outputs, ...paths.licenses]) {
      if (!isSafeRelativePath(candidate)) throw new ArtPackError("ART_PACK_PATH_INVALID", candidate);
    }
    for (const output of paths.outputs) {
      if ([...outputs].some((existing) => existing === output || existing.startsWith(`${output}/`) || output.startsWith(`${existing}/`))) {
        throw new ArtPackError("ART_PACK_DUPLICATE_OUTPUT", output);
      }
      outputs.add(output);
    }
  }
  return parsed.data;
}
