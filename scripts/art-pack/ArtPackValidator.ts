import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  ArtPackError,
  isSafeRelativePath,
  parseArtPackConfig,
  type ArtPackEntryV1,
} from "./ArtPackSchema";
import { assertContainedDirectory, assertContainedFile, assertContainedPath } from "./ArtPackPaths";
import { validateVerticalSliceEntries } from "./ArtPackManifest";
import { normalizeRgba, normalizedPixelSha256, paletteSha256 } from "./PixelNormalizer";
import { canonicalJson, type ArtPackLockV1 } from "./ArtPackPacker";
import { createHash } from "node:crypto";

export interface VerifyArtOptions {
  projectRoot: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareStrings);
  const expected = [...keys].sort(compareStrings);
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function isLock(value: unknown): value is ArtPackLockV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ArtPackLockV1>;
  if (!exactKeys(candidate, ["schemaVersion", "packId", "paletteId", "toolchain", "paletteSha256", "entries"])) return false;
  if (candidate.schemaVersion !== 1 || candidate.packId !== "visual-v1" || candidate.paletteId !== "frontier-night-32-v1" || typeof candidate.paletteSha256 !== "string" || !candidate.toolchain || typeof candidate.toolchain !== "object" || !exactKeys(candidate.toolchain, ["nodeMajor", "sharp", "libvips"]) || typeof candidate.toolchain.nodeMajor !== "number" || !Number.isInteger(candidate.toolchain.nodeMajor) || typeof candidate.toolchain.sharp !== "string" || typeof candidate.toolchain.libvips !== "string" || !Array.isArray(candidate.entries)) return false;
  return candidate.entries.every((entry) => {
    if (!entry || typeof entry !== "object" || !exactKeys(entry, ["assetId", "inputSha256", "outputs"])) return false;
    if (typeof entry.assetId !== "string" || !Array.isArray(entry.inputSha256) || !entry.inputSha256.every((hash) => typeof hash === "string") || !Array.isArray(entry.outputs)) return false;
    return entry.outputs.every((output) => {
      if (!output || typeof output !== "object") return false;
      const keys = Object.keys(output);
      const required = ["path", "fileSha256"];
      if (!required.every((key) => keys.includes(key)) || keys.some((key) => !["path", "width", "height", "fileSha256", "pixelSha256"].includes(key))) return false;
      const typed = output as Partial<ArtPackLockV1["entries"][number]["outputs"][number]>;
      return typeof typed.path === "string" && typeof typed.fileSha256 === "string" && (typed.width === undefined || (typeof typed.width === "number" && Number.isInteger(typed.width) && typed.width > 0)) && (typed.height === undefined || (typeof typed.height === "number" && Number.isInteger(typed.height) && typed.height > 0)) && (typed.pixelSha256 === undefined || typeof typed.pixelSha256 === "string");
    });
  });
}

function canonicalLock(lock: ArtPackLockV1): ArtPackLockV1 {
  return {
    schemaVersion: lock.schemaVersion,
    packId: lock.packId,
    paletteId: lock.paletteId,
    toolchain: {
      nodeMajor: lock.toolchain.nodeMajor,
      sharp: lock.toolchain.sharp,
      libvips: lock.toolchain.libvips,
    },
    paletteSha256: lock.paletteSha256,
    entries: [...lock.entries].sort((left, right) => compareStrings(left.assetId, right.assetId)).map((entry) => ({
      assetId: entry.assetId,
      inputSha256: [...entry.inputSha256],
      outputs: [...entry.outputs].sort((left, right) => compareStrings(left.path, right.path)).map((output) => ({
        path: output.path,
        ...(output.width === undefined ? {} : { width: output.width }),
        ...(output.height === undefined ? {} : { height: output.height }),
        fileSha256: output.fileSha256,
        ...(output.pixelSha256 === undefined ? {} : { pixelSha256: output.pixelSha256 }),
      })),
    })),
  };
}

function outputPaths(entry: ArtPackEntryV1): Array<{ path: string; isPng: boolean }> {
  switch (entry.kind) {
    case "fieldActor":
    case "battleActor":
      return [{ path: entry.output.image, isPng: true }, { path: entry.output.data, isPng: false }];
    case "atlas":
      return [{ path: entry.imageOutput, isPng: true }, { path: entry.dataOutput, isPng: false }];
    case "bitmapFont":
      return [{ path: entry.imageOutput, isPng: true }, { path: entry.descriptorOutput, isPng: false }];
    default:
      return [{ path: entry.output, isPng: true }];
  }
}

function inputPaths(entry: ArtPackEntryV1): Array<{ relativePath: string; root: "input" | "pack" }> {
  const paths: Array<{ relativePath: string; root: "input" | "pack" }> = [];
  switch (entry.kind) {
    case "fieldActor":
    case "battleActor":
      paths.push(...entry.frames.map((frame) => ({ relativePath: frame.input, root: "input" as const })));
      break;
    case "atlas":
      paths.push(...entry.frames.map((frame) => ({ relativePath: frame.input, root: "input" as const })));
      break;
    case "bitmapFont":
      paths.push({ relativePath: entry.imageInput, root: "input" }, { relativePath: entry.descriptorInput, root: "input" });
      break;
    default:
      paths.push({ relativePath: entry.input, root: "input" });
      break;
  }
  if (entry.source.sourceKind === "licensed" && entry.source.licenseFile) paths.push({ relativePath: entry.source.licenseFile, root: "pack" });
  return paths;
}

async function readContainedRequired(root: string, file: string, code: string): Promise<Buffer> {
  await assertContainedFile(root, file, code);
  return fs.readFile(file);
}

async function verifyPixelOutput(file: string, lockOutput: ArtPackLockV1["entries"][number]["outputs"][number]): Promise<void> {
  if (lockOutput.width === undefined || lockOutput.height === undefined || lockOutput.pixelSha256 === undefined) return;
  const rawResult = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (rawResult.info.width !== lockOutput.width || rawResult.info.height !== lockOutput.height) throw new ArtPackError("ART_PACK_OUTPUT_DIMENSION_MISMATCH", lockOutput.path);
  const normalized = normalizeRgba(lockOutput.width, lockOutput.height, new Uint8Array(rawResult.data));
  if (normalizedPixelSha256(lockOutput.width, lockOutput.height, normalized) !== lockOutput.pixelSha256) throw new ArtPackError("ART_PACK_OUTPUT_PIXEL_HASH_MISMATCH", lockOutput.path);
}

export async function verifyArtPack(value: unknown, options: VerifyArtOptions): Promise<{ ok: true; lock: ArtPackLockV1 }> {
  const config = parseArtPackConfig(value);
  validateVerticalSliceEntries(config);
  const outputRoot = path.join(options.projectRoot, config.outputRoot);
  const inputRoot = path.join(options.projectRoot, config.inputRoot);
  const lockPath = path.join(options.projectRoot, "art/visual/v1/art-pack.lock.json");
  await assertContainedDirectory(options.projectRoot, inputRoot);
  await assertContainedDirectory(options.projectRoot, outputRoot);
  await assertContainedPath(path.dirname(lockPath), lockPath);
  await assertContainedFile(path.dirname(lockPath), lockPath, "ART_PACK_LOCK_MISSING", "ART_PACK_LOCK_INVALID");
  let lockValue: unknown;
  let lockBytes: Buffer;
  try {
    lockBytes = await fs.readFile(lockPath);
    lockValue = JSON.parse(lockBytes.toString("utf8")) as unknown;
  } catch {
    throw new ArtPackError("ART_PACK_LOCK_MISSING", lockPath);
  }
  if (!isLock(lockValue)) throw new ArtPackError("ART_PACK_LOCK_INVALID", "shape");
  const lock = lockValue;
  // 不能直接 stringify 解析对象：必须按固定字段顺序重建，避免通过重排键名绕过 canonical lock 检查。
  if (!lockBytes.equals(canonicalJson(canonicalLock(lock)))) throw new ArtPackError("ART_PACK_LOCK_CANONICAL_INVALID", lockPath);
  if (lock.schemaVersion !== 1 || lock.packId !== "visual-v1" || lock.paletteId !== "frontier-night-32-v1" || lock.paletteSha256 !== paletteSha256() || lock.toolchain.nodeMajor !== Number.parseInt(process.versions.node.split(".")[0], 10) || lock.toolchain.sharp !== sharp.versions.sharp || sharp.versions.sharp !== "0.34.5" || lock.toolchain.libvips !== sharp.versions.vips) {
    throw new ArtPackError("ART_PACK_TOOLCHAIN_INVALID", "lock");
  }
  const configEntries = [...config.entries].sort((left, right) => compareStrings(left.assetId, right.assetId));
  if (lock.entries.length !== configEntries.length || lock.entries.some((entry, index) => entry.assetId !== configEntries[index]?.assetId)) throw new ArtPackError("ART_PACK_LOCK_INVALID", "entries");
  for (const [index, entry] of configEntries.entries()) {
    const lockEntry = lock.entries[index];
    const expectedInputs = inputPaths(entry);
    if (lockEntry.inputSha256.length !== expectedInputs.length) throw new ArtPackError("ART_PACK_LOCK_INVALID", `${entry.assetId}/inputs`);
    for (const [inputIndex, input] of expectedInputs.entries()) {
      const root = input.root === "input" ? inputRoot : path.dirname(inputRoot);
      const code = input.root === "input" ? "ART_PACK_INPUT_MISSING" : "ART_PACK_LICENSE_INVALID";
      const bytes = await readContainedRequired(root, path.join(root, input.relativePath), code);
      if (sha256(bytes) !== lockEntry.inputSha256[inputIndex]) throw new ArtPackError("ART_PACK_INPUT_HASH_MISMATCH", `${entry.assetId}/${input.relativePath}`);
    }
    const expectedOutputs = outputPaths(entry).sort((left, right) => compareStrings(left.path, right.path));
    if (lockEntry.outputs.length !== expectedOutputs.length || lockEntry.outputs.some((output, outputIndex) => output.path !== expectedOutputs[outputIndex]?.path)) throw new ArtPackError("ART_PACK_LOCK_INVALID", `${entry.assetId}/outputs`);
    for (const [outputIndex, output] of lockEntry.outputs.entries()) {
      if (!isSafeRelativePath(output.path)) throw new ArtPackError("ART_PACK_LOCK_INVALID", output.path);
      const contract = expectedOutputs[outputIndex];
      if (!contract) throw new ArtPackError("ART_PACK_LOCK_INVALID", `${entry.assetId}/outputs`);
      if (contract.isPng) {
        if (output.width === undefined || output.height === undefined || output.pixelSha256 === undefined) throw new ArtPackError("ART_PACK_LOCK_INVALID", `${entry.assetId}/${output.path}/pixel-metadata`);
      } else if (output.width !== undefined || output.height !== undefined || output.pixelSha256 !== undefined) {
        throw new ArtPackError("ART_PACK_LOCK_INVALID", `${entry.assetId}/${output.path}/non-png-metadata`);
      }
      const filePath = path.join(outputRoot, output.path);
      const file = await readContainedRequired(outputRoot, filePath, "ART_PACK_OUTPUT_MISSING");
      if (sha256(file) !== output.fileSha256) throw new ArtPackError("ART_PACK_OUTPUT_HASH_MISMATCH", output.path);
      await verifyPixelOutput(filePath, output);
    }
  }
  return { ok: true, lock };
}
