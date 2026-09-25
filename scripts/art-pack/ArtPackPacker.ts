import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  ArtPackError,
  parseArtPackConfig,
  type ArtPackEntryV1,
  type AtlasPackEntryV1,
  type BattleActorPackEntryV1,
  type BitmapFontPackEntryV1,
  type FieldActorPackEntryV1,
} from "./ArtPackSchema";
import { assertContainedDirectory, assertContainedFile, assertContainedPath } from "./ArtPackPaths";
import { validateVerticalSliceEntries } from "./ArtPackManifest";
import { normalizeRgba, normalizedPixelSha256, paletteSha256 } from "./PixelNormalizer";

export interface PackArtOptions {
  projectRoot: string;
  mode: "check" | "publish";
}

export interface ArtPackOutputRecord {
  path: string;
  width?: number;
  height?: number;
  fileSha256: string;
  pixelSha256?: string;
}

export interface ArtPackLockV1 {
  schemaVersion: 1;
  packId: "visual-v1";
  paletteId: "frontier-night-32-v1";
  toolchain: { nodeMajor: number; sharp: string; libvips: string };
  paletteSha256: string;
  entries: Array<{
    assetId: string;
    inputSha256: string[];
    outputs: ArtPackOutputRecord[];
  }>;
}

export interface ArtPackResult {
  entries: ArtPackLockV1["entries"];
  lock: ArtPackLockV1;
}

interface ProducedFile {
  relativePath: string;
  bytes: Buffer;
  width?: number;
  height?: number;
  pixelSha256?: string;
}

interface PackedEntry {
  assetId: string;
  inputSha256: string[];
  files: ProducedFile[];
}

sharp.concurrency(1);
sharp.cache(false);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function absoluteInput(root: string, relativePath: string): string {
  return path.join(root, relativePath);
}

function outputFile(root: string, relativePath: string): string {
  return path.join(root, relativePath);
}

async function readInput(root: string, relativePath: string): Promise<{ bytes: Buffer; width: number; height: number; normalized: Uint8Array }> {
  const file = absoluteInput(root, relativePath);
  await assertContainedFile(root, file, "ART_PACK_INPUT_MISSING", "ART_PACK_INPUT_FORMAT_INVALID");
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(file);
  } catch {
    throw new ArtPackError("ART_PACK_INPUT_MISSING", relativePath);
  }
  const metadata = await sharp(bytes).metadata();
  const depth = (metadata as unknown as { depth?: string }).depth;
  const bitsPerSample = (metadata as unknown as { bitsPerSample?: number }).bitsPerSample;
  const exif = (metadata as unknown as { exif?: Buffer }).exif;
  if (metadata.format !== "png" || metadata.pages !== undefined && metadata.pages !== 1 || depth !== "uchar" || bitsPerSample !== undefined && bitsPerSample !== 8 || metadata.isProgressive || metadata.hasProfile || exif !== undefined || metadata.width === undefined || metadata.height === undefined) {
    throw new ArtPackError("ART_PACK_INPUT_FORMAT_INVALID", relativePath);
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const rawResult = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const normalized = normalizeRgba(width, height, new Uint8Array(rawResult.data));
  return { bytes, width, height, normalized };
}

async function encodePng(width: number, height: number, normalized: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(normalized), { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
    .toBuffer();
}

function assertAtlasFrameNonEmpty(assetId: string, frameId: string, width: number, height: number, normalized: Uint8Array): void {
  for (let index = 3; index < normalized.length; index += 4) {
    if (normalized[index] !== 0) return;
  }
  throw new ArtPackError("ART_PACK_FRAME_EMPTY", `${assetId}/${frameId}`);
}

function assertAnimatedClips(entry: FieldActorPackEntryV1 | BattleActorPackEntryV1, hashes: Map<string, string>): void {
  const groups = entry.kind === "fieldActor"
    ? [
      ...["down", "left", "right", "up"].flatMap((direction) => [
        entry.frames.filter((frame) => frame.id.startsWith(`${direction}_idle_`)),
        entry.frames.filter((frame) => frame.id.startsWith(`${direction}_walk_`)),
      ]),
    ]
    : [
      ...["idle", "attack", "skill", "hit", "down"].map((action) => entry.frames.filter((frame) => frame.id.startsWith(`${action}_`))),
    ];
  for (const frames of groups) {
    if (frames.length > 0 && new Set(frames.map((frame) => hashes.get(frame.id))).size < 2) {
      throw new ArtPackError("ART_PACK_CLIP_NOT_ANIMATED", `${entry.assetId}/${frames[0]?.id.split("_").slice(-2, -1)[0] ?? "clip"}`);
    }
  }
}

function assertFramePixels(assetId: string, frameId: string, width: number, height: number, normalized: Uint8Array, anchorY: number): void {
  let opaque = 0;
  let anchorOpaque = false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (normalized[(y * width + x) * 4 + 3] === 0) continue;
      opaque += 1;
      if (y > anchorY) throw new ArtPackError("ART_PACK_ANCHOR_CLIP", `${assetId}/${frameId}`);
      if (y === anchorY) anchorOpaque = true;
    }
  }
  if (opaque === 0) throw new ArtPackError("ART_PACK_FRAME_EMPTY", `${assetId}/${frameId}`);
  if (!anchorOpaque) throw new ArtPackError("ART_PACK_ANCHOR_ROW_EMPTY", `${assetId}/${frameId}`);
}

function makeAtlasJson(image: string, width: number, height: number, frames: Array<{ id: string; x: number; y: number; width: number; height: number }>): Buffer {
  const frameMap: Record<string, unknown> = {};
  for (const frame of frames) {
    frameMap[frame.id] = {
      frame: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frame.width, h: frame.height },
      sourceSize: { w: frame.width, h: frame.height },
    };
  }
  return canonicalJson({
    frames: frameMap,
    meta: { app: "xiangsu-art-pack", version: "1", image, format: "RGBA8888", size: { w: width, h: height }, scale: "1" },
  });
}

async function packSheet(entry: FieldActorPackEntryV1 | BattleActorPackEntryV1, inputRoot: string): Promise<PackedEntry> {
  const sheetWidth = entry.frameWidth * entry.columns;
  const sheetHeight = entry.frameHeight * entry.rows;
  const sheet = new Uint8Array(sheetWidth * sheetHeight * 4);
  const hashes = new Map<string, string>();
  const frameRects: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
  const inputSha256: string[] = [];
  for (const [index, frame] of entry.frames.entries()) {
    const source = await readInput(inputRoot, frame.input);
    if (source.width !== entry.frameWidth || source.height !== entry.frameHeight) throw new ArtPackError("ART_PACK_DIMENSION_INVALID", `${entry.assetId}/${frame.id}`);
    assertFramePixels(entry.assetId, frame.id, source.width, source.height, source.normalized, entry.anchor.y);
    hashes.set(frame.id, normalizedPixelSha256(source.width, source.height, source.normalized));
    inputSha256.push(sha256(source.bytes));
    const column = index % entry.columns;
    const row = Math.floor(index / entry.columns);
    for (let y = 0; y < entry.frameHeight; y += 1) {
      const sourceStart = y * entry.frameWidth * 4;
      const destinationStart = ((row * entry.frameHeight + y) * sheetWidth + column * entry.frameWidth) * 4;
      sheet.set(source.normalized.subarray(sourceStart, sourceStart + entry.frameWidth * 4), destinationStart);
    }
    frameRects.push({ id: frame.id, x: column * entry.frameWidth, y: row * entry.frameHeight, width: entry.frameWidth, height: entry.frameHeight });
  }
  assertAnimatedClips(entry, hashes);
  const image = await encodePng(sheetWidth, sheetHeight, sheet);
  return {
    assetId: entry.assetId,
    inputSha256,
    files: [
      { relativePath: entry.output.image, bytes: image, width: sheetWidth, height: sheetHeight, pixelSha256: normalizedPixelSha256(sheetWidth, sheetHeight, sheet) },
      { relativePath: entry.output.data, bytes: makeAtlasJson(path.basename(entry.output.image), sheetWidth, sheetHeight, frameRects) },
    ],
  };
}

async function packImageLike(entry: Extract<ArtPackEntryV1, { kind: "image" | "singleFrame" | "mapTileset" }>, inputRoot: string): Promise<PackedEntry> {
  const source = await readInput(inputRoot, entry.input);
  if (source.width !== entry.width || source.height !== entry.height) throw new ArtPackError("ART_PACK_DIMENSION_INVALID", entry.assetId);
  const bytes = await encodePng(source.width, source.height, source.normalized);
  return {
    assetId: entry.assetId,
    inputSha256: [sha256(source.bytes)],
    files: [{ relativePath: entry.output, bytes, width: source.width, height: source.height, pixelSha256: normalizedPixelSha256(source.width, source.height, source.normalized) }],
  };
}

async function packAtlas(entry: AtlasPackEntryV1, inputRoot: string): Promise<PackedEntry> {
  const canvas = new Uint8Array(entry.width * entry.height * 4);
  const inputSha256: string[] = [];
  for (const frame of entry.frames) {
    const source = await readInput(inputRoot, frame.input);
    if (source.width !== frame.width || source.height !== frame.height) throw new ArtPackError("ART_PACK_DIMENSION_INVALID", `${entry.assetId}/${frame.id}`);
    assertAtlasFrameNonEmpty(entry.assetId, frame.id, source.width, source.height, source.normalized);
    inputSha256.push(sha256(source.bytes));
    for (let y = 0; y < frame.height; y += 1) {
      const sourceStart = y * frame.width * 4;
      const destinationStart = ((frame.y + y) * entry.width + frame.x) * 4;
      canvas.set(source.normalized.subarray(sourceStart, sourceStart + frame.width * 4), destinationStart);
    }
  }
  const image = await encodePng(entry.width, entry.height, canvas);
  return {
    assetId: entry.assetId,
    inputSha256,
    files: [
      { relativePath: entry.imageOutput, bytes: image, width: entry.width, height: entry.height, pixelSha256: normalizedPixelSha256(entry.width, entry.height, canvas) },
      { relativePath: entry.dataOutput, bytes: makeAtlasJson(path.basename(entry.imageOutput), entry.width, entry.height, entry.frames) },
    ],
  };
}

async function packBitmapFont(entry: BitmapFontPackEntryV1, inputRoot: string): Promise<PackedEntry> {
  const image = await readInput(inputRoot, entry.imageInput);
  if (image.width !== entry.width || image.height !== entry.height) throw new ArtPackError("ART_PACK_DIMENSION_INVALID", entry.assetId);
  const descriptorPath = absoluteInput(inputRoot, entry.descriptorInput);
  await assertContainedFile(inputRoot, descriptorPath, "ART_PACK_INPUT_MISSING", "ART_PACK_INPUT_FORMAT_INVALID");
  const descriptor = await fs.readFile(descriptorPath);
  const page = /(?:^|\n)page\s+id=0\s+file="([^"]+)"/.exec(descriptor.toString("utf8"))?.[1];
  if (page !== path.basename(entry.imageOutput)) throw new ArtPackError("ART_PACK_FONT_DESCRIPTOR_INVALID", entry.assetId);
  const imageOutput = await encodePng(image.width, image.height, image.normalized);
  return {
    assetId: entry.assetId,
    inputSha256: [sha256(image.bytes), sha256(descriptor)],
    files: [
      { relativePath: entry.imageOutput, bytes: imageOutput, width: image.width, height: image.height, pixelSha256: normalizedPixelSha256(image.width, image.height, image.normalized) },
      { relativePath: entry.descriptorOutput, bytes: descriptor },
    ],
  };
}

async function packEntry(entry: ArtPackEntryV1, inputRoot: string): Promise<PackedEntry> {
  switch (entry.kind) {
    case "fieldActor":
    case "battleActor":
      return packSheet(entry, inputRoot);
    case "atlas":
      return packAtlas(entry, inputRoot);
    case "bitmapFont":
      return packBitmapFont(entry, inputRoot);
    case "image":
    case "singleFrame":
    case "mapTileset":
      return packImageLike(entry, inputRoot);
  }
}

async function appendLicenseHash(entry: ArtPackEntryV1, inputRoot: string, packed: PackedEntry): Promise<PackedEntry> {
  if (entry.source.sourceKind !== "licensed" || !entry.source.licenseFile) return packed;
  const licenseRoot = path.dirname(inputRoot);
  const licensePath = path.join(licenseRoot, entry.source.licenseFile);
  await assertContainedFile(licenseRoot, licensePath, "ART_PACK_LICENSE_INVALID", "ART_PACK_LICENSE_INVALID");
  packed.inputSha256.push(sha256(await fs.readFile(licensePath)));
  return packed;
}

function toLockEntry(entry: PackedEntry): ArtPackLockV1["entries"][number] {
  return {
    assetId: entry.assetId,
    inputSha256: entry.inputSha256,
    outputs: [...entry.files].sort((left, right) => compareStrings(left.relativePath, right.relativePath)).map((file) => ({
      path: file.relativePath,
      ...(file.width === undefined ? {} : { width: file.width }),
      ...(file.height === undefined ? {} : { height: file.height }),
      fileSha256: sha256(file.bytes),
      ...(file.pixelSha256 === undefined ? {} : { pixelSha256: file.pixelSha256 }),
    })),
  };
}

function makeLock(entries: PackedEntry[]): ArtPackLockV1 {
  const sharpVersion = sharp.versions.sharp;
  if (sharpVersion !== "0.34.5") throw new ArtPackError("ART_PACK_TOOLCHAIN_INVALID", `sharp ${sharpVersion}`);
  return {
    schemaVersion: 1,
    packId: "visual-v1",
    paletteId: "frontier-night-32-v1",
    toolchain: { nodeMajor: Number.parseInt(process.versions.node.split(".")[0], 10), sharp: sharpVersion, libvips: sharp.versions.vips },
    paletteSha256: paletteSha256(),
    entries: entries.map(toLockEntry).sort((left, right) => compareStrings(left.assetId, right.assetId)),
  };
}

async function writeStagedFiles(stagingRoot: string, files: ProducedFile[]): Promise<void> {
  for (const file of files) {
    const target = outputFile(stagingRoot, file.relativePath);
    await assertContainedPath(stagingRoot, target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.bytes);
  }
}

interface BackupRecord {
  target: string;
  backup: string;
  existed: boolean;
}

async function moveExistingToBackup(target: string, backup: string): Promise<BackupRecord> {
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new ArtPackError("ART_PACK_PATH_SYMLINK", target);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.rename(target, backup);
    return { target, backup, existed: true };
  } catch (error) {
    if (error instanceof ArtPackError) throw error;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return { target, backup, existed: false };
    throw error;
  }
}

async function restoreBackups(records: readonly BackupRecord[], installed: readonly string[]): Promise<void> {
  for (const target of [...installed].reverse()) await fs.rm(target, { recursive: true, force: true });
  for (const record of [...records].reverse()) {
    if (!record.existed) continue;
    await fs.mkdir(path.dirname(record.target), { recursive: true });
    await fs.rename(record.backup, record.target);
  }
}

async function publishStaging(stagingRoot: string, outputRoot: string, files: readonly ProducedFile[], lock: ArtPackLockV1, lockPath: string): Promise<void> {
  const backupRoot = `${stagingRoot}.backup`;
  const records: BackupRecord[] = [];
  const installed: string[] = [];
  const lockTemp = `${lockPath}.${process.pid}.tmp`;
  try {
    await assertContainedDirectory(path.dirname(outputRoot), outputRoot);
    await assertContainedPath(path.dirname(lockPath), lockPath);
    await fs.mkdir(path.dirname(lockTemp), { recursive: true });
    await fs.writeFile(lockTemp, canonicalJson(lock));
    const targets = files.map((file) => outputFile(outputRoot, file.relativePath)).sort(compareStrings);
    for (const target of targets) {
      await assertContainedPath(outputRoot, target);
      const relative = path.relative(outputRoot, target);
      records.push(await moveExistingToBackup(target, path.join(backupRoot, relative)));
    }
    records.push(await moveExistingToBackup(lockPath, path.join(backupRoot, "__lock__.json")));
    for (const file of [...files].sort((left, right) => compareStrings(left.relativePath, right.relativePath))) {
      const source = outputFile(stagingRoot, file.relativePath);
      const target = outputFile(outputRoot, file.relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(source, target);
      installed.push(target);
    }
    await fs.rename(lockTemp, lockPath);
    installed.push(lockPath);
  } catch (error) {
    await fs.rm(lockTemp, { force: true }).catch(() => undefined);
    try {
      await restoreBackups(records, installed);
      await fs.rm(backupRoot, { recursive: true, force: true });
    } catch (rollbackError) {
      throw new ArtPackError("ART_PACK_ROLLBACK_FAILED", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    }
    throw error;
  }
  // 新产物与新 lock 都已安装后才算提交。备份清理属于提交后的 best-effort，失败时保留备份以便人工恢复，不能再回滚已提交的新状态。
  try {
    await fs.rm(backupRoot, { recursive: true, force: true });
  } catch {
    // 清理失败时保留残余备份；新 outputs 与 lock 已提交，不能再次回滚。
  }
}

export async function packArtConfig(value: unknown, options: PackArtOptions): Promise<ArtPackResult> {
  const config = parseArtPackConfig(value);
  validateVerticalSliceEntries(config);
  if (!options.projectRoot) throw new ArtPackError("ART_PACK_PROJECT_ROOT_INVALID", "empty");
  const inputRoot = path.join(options.projectRoot, config.inputRoot);
  const outputRoot = path.join(options.projectRoot, config.outputRoot);
  const stagingParent = path.join(options.projectRoot, "public/assets/visual");
  const lockRoot = path.join(options.projectRoot, "art/visual/v1");
  const lockPath = path.join(lockRoot, "art-pack.lock.json");
  await assertContainedDirectory(options.projectRoot, inputRoot);
  // 创建目录前先检查最近已存在祖先，避免 mkdir 穿过 symlink；创建后再做一次目录类型校验。
  await assertContainedPath(options.projectRoot, stagingParent);
  await fs.mkdir(stagingParent, { recursive: true });
  await assertContainedDirectory(options.projectRoot, stagingParent);
  if (options.mode === "publish") {
    await assertContainedPath(options.projectRoot, outputRoot);
    await fs.mkdir(outputRoot, { recursive: true });
    await assertContainedDirectory(options.projectRoot, outputRoot);
    await assertContainedPath(options.projectRoot, lockRoot);
    await fs.mkdir(lockRoot, { recursive: true });
    await assertContainedDirectory(options.projectRoot, lockRoot);
  }
  for (const entry of config.entries) {
    if (entry.source.sourceKind !== "licensed" || !entry.source.licenseFile) continue;
    const licenseRoot = path.dirname(inputRoot);
    const licensePath = path.join(licenseRoot, entry.source.licenseFile);
    try {
      await assertContainedFile(licenseRoot, licensePath, "ART_PACK_LICENSE_INVALID", "ART_PACK_LICENSE_INVALID");
    } catch (error) {
      if (error instanceof ArtPackError && error.code === "ART_PACK_PATH_INVALID") throw new ArtPackError("ART_PACK_LICENSE_INVALID", entry.assetId);
      throw error;
    }
  }
  const stagingRoot = await fs.mkdtemp(path.join(stagingParent, ".staging-v1-"));
  await assertContainedDirectory(stagingParent, stagingRoot);
  try {
    const packed: PackedEntry[] = [];
    for (const entry of config.entries) packed.push(await appendLicenseHash(entry, inputRoot, await packEntry(entry, inputRoot)));
    const lock = makeLock(packed);
    const files = packed.flatMap((entry) => entry.files);
    await writeStagedFiles(stagingRoot, files);
    if (options.mode === "publish") {
      await publishStaging(stagingRoot, outputRoot, files, lock, lockPath);
    }
    return { entries: lock.entries, lock };
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

export { canonicalJson };
