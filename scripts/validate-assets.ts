import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { AssetCatalog, type AssetBatchId, type AssetValidationMode } from "../src/app/AssetCatalog";
import { candidateAssetManifest, floors02To05AssetManifest, floors06To10AssetManifest, verticalSliceAssetManifest } from "../src/content/data/assets.manifest";
import { zhCN } from "../src/content/locales/zh-CN";

const BATCH_IDS: readonly AssetBatchId[] = ["verticalSlice", "floors02_05", "floors06_10", "abyssEchoes"];

export interface ValidateAssetsResult {
  ok: boolean;
  mode: AssetValidationMode;
  message: string;
}

function publicPath(src: string): string {
  // manifest 中的源是浏览器 public URL；CLI 统一映射到 public 根，禁止相对路径逃逸。
  const publicRoot = resolve(process.cwd(), "public");
  const normalized = src.startsWith("/") ? src.slice(1) : src;
  const candidate = resolve(publicRoot, normalized);
  const withinPublic = relative(publicRoot, candidate) !== "" && !relative(publicRoot, candidate).startsWith(`..${sep}`) && relative(publicRoot, candidate) !== "..";
  return withinPublic ? candidate : "";
}

function pngMetadata(src: string): { width: number; height: number } | null {
  const path = publicPath(src);
  if (!existsSync(path)) return null;
  const data = readFileSync(path);
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function atlasMetadata(imageSrc: string, dataSrc: string): { imageWidth: number; imageHeight: number; frames: Record<string, { x: number; y: number; width: number; height: number }> } | null {
  const image = pngMetadata(imageSrc);
  const path = publicPath(dataSrc);
  if (!image || !existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("frames" in parsed) || !parsed.frames || typeof parsed.frames !== "object" || Array.isArray(parsed.frames)) return null;
  const frames: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const [id, value] of Object.entries(parsed.frames as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || !("frame" in value) || !value.frame || typeof value.frame !== "object") return null;
    const frame = value.frame as Record<string, unknown>;
    if (typeof frame.x !== "number" || typeof frame.y !== "number" || typeof frame.w !== "number" || typeof frame.h !== "number") return null;
    frames[id] = { x: frame.x, y: frame.y, width: frame.w, height: frame.h };
  }
  return { imageWidth: image.width, imageHeight: image.height, frames };
}

function bitmapFontMetadata(descriptorSrc: string, textureSrc: string): { textureWidth: number; textureHeight: number; characters: readonly string[] } | null {
  const texture = pngMetadata(textureSrc);
  const path = publicPath(descriptorSrc);
  if (!texture || !existsSync(path)) return null;
  const characters: string[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^char\s+id=(\d+)/.exec(line.trim());
    if (match) characters.push(String.fromCodePoint(Number(match[1])));
  }
  return { textureWidth: texture.width, textureHeight: texture.height, characters };
}

function parseMode(argv: readonly string[]): AssetValidationMode | null {
  if (argv.length === 0) return "fixture";
  if (argv.length === 1 && argv[0] === "--final") return "final";
  if (argv.length === 2 && argv[0] === "--batch" && BATCH_IDS.includes(argv[1] as AssetBatchId)) {
    return { kind: "batch", batchId: argv[1] as AssetBatchId };
  }
  return null;
}

export function validateAssets(argv: readonly string[] = process.argv.slice(2)): ValidateAssetsResult {
  const mode = parseMode(argv);
  if (mode === null) return { ok: false, mode: "fixture", message: "用法：verify:assets [--final | --batch verticalSlice|floors02_05|floors06_10|abyssEchoes]" };
  // 批次校验必须使用对应冻结 manifest，fixture 只保留给默认/其它模式。
  const manifest = mode === "final"
    ? floors06To10AssetManifest
    : typeof mode !== "string" && mode.batchId === "verticalSlice"
    ? verticalSliceAssetManifest
    : typeof mode !== "string" && mode.batchId === "floors02_05"
      ? floors02To05AssetManifest
      : typeof mode !== "string" && mode.batchId === "floors06_10"
      ? floors06To10AssetManifest
      : typeof mode !== "string" && mode.batchId === "abyssEchoes"
        ? floors06To10AssetManifest
      : candidateAssetManifest;
  const catalog = AssetCatalog.create(manifest, mode, {
    fileExists: (src) => existsSync(publicPath(src)),
    metadataInspector: {
      inspectImage: pngMetadata,
      inspectAtlas: atlasMetadata,
      inspectBitmapFont: bitmapFontMetadata,
    },
    requiredFontCharacters: [...new Set(Object.values(zhCN).join(""))],
  });
  if (!catalog.ok) return { ok: false, mode, message: `${catalog.error.code}:${catalog.error.details.path}:${catalog.error.details.issueKey}` };
  return { ok: true, mode, message: `assets ${mode === "fixture" ? "fixture" : "candidate"} valid` };
}

const result = validateAssets();
if (result.ok) {
  console.log(result.message);
} else {
  console.error(result.message);
  process.exitCode = 1;
}
