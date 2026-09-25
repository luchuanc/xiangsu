import { floors02To05AssetManifest, type AssetEntryV1, type AssetManifestV1 } from "../../src/content/data/assets.manifest";
import {
  ArtPackError,
  BATTLE_ACTOR_FRAME_IDS,
  FIELD_ACTOR_FRAME_IDS,
  type ArtPackConfigV1,
  type ArtPackEntryV1,
} from "./ArtPackSchema";

function manifestAssetIndex(manifestRoot: AssetManifestV1): Map<string, { asset: AssetEntryV1; bundleId: string }> {
  const owners = new Map<string, string>();
  for (const bundle of manifestRoot.bundles) {
    for (const assetId of bundle.assetIds) {
      if (owners.has(assetId)) throw new ArtPackError("ART_PACK_MANIFEST_INVALID", `duplicate owner ${assetId}`);
      owners.set(assetId, bundle.id);
    }
  }
  const index = new Map<string, { asset: AssetEntryV1; bundleId: string }>();
  for (const asset of manifestRoot.assets) {
    const bundleId = owners.get(asset.id);
    if (!bundleId) throw new ArtPackError("ART_PACK_MANIFEST_INVALID", `owner missing ${asset.id}`);
    if (asset.bundleId !== bundleId) throw new ArtPackError("ART_PACK_MANIFEST_INVALID", `owner mismatch ${asset.id}`);
    if (index.has(asset.id)) throw new ArtPackError("ART_PACK_MANIFEST_INVALID", `duplicate asset ${asset.id}`);
    index.set(asset.id, { asset, bundleId });
  }
  return index;
}

const assetKind = (entry: ArtPackEntryV1): AssetEntryV1["kind"] => {
  switch (entry.kind) {
    case "fieldActor": return "fieldActorSheet";
    case "battleActor": return "battleActorSheet";
    default: return entry.kind;
  }
};

function assertEqual(value: boolean, code: string, detail: string): void {
  if (!value) throw new ArtPackError(code, detail);
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validateActorClip(entry: Extract<ArtPackEntryV1, { kind: "fieldActor" | "battleActor" }>, asset: Extract<AssetEntryV1, { kind: "fieldActorSheet" | "battleActorSheet" }>): void {
  assertEqual(entry.frames.length === entry.columns * entry.rows, "ART_PACK_MANIFEST_FRAME_INVALID", entry.assetId);
  if (entry.kind === "fieldActor" && asset.kind === "fieldActorSheet") {
    const expected = Object.values(asset.clips).flatMap((direction) => [direction.idle.frameCount, direction.walk.frameCount]).reduce((sum, count) => sum + count, 0);
    assertEqual(entry.frames.length === expected, "ART_PACK_MANIFEST_CLIP_INVALID", entry.assetId);
    assertEqual(entry.frameWidth === asset.frameWidth && entry.frameHeight === asset.frameHeight && entry.columns === asset.columns && entry.rows === asset.rows, "ART_PACK_MANIFEST_DIMENSION_INVALID", entry.assetId);
    const expectedDirections = [
      ["down", asset.clips.down],
      ["left", asset.clips.left],
      ["right", asset.clips.right],
      ["up", asset.clips.up],
    ] as const;
    for (const [direction, clips] of expectedDirections) {
      assertEqual(hasExactKeys(clips, ["row", "idle", "walk"]) && hasExactKeys(clips.idle, ["startColumn", "frameCount", "fps"]) && hasExactKeys(clips.walk, ["startColumn", "frameCount", "fps"]), "ART_PACK_MANIFEST_CLIP_INVALID", `${entry.assetId}/${direction}/shape`);
      assertEqual(clips.row === expectedDirections.findIndex(([candidate]) => candidate === direction), "ART_PACK_MANIFEST_CLIP_INVALID", `${entry.assetId}/${direction}/row`);
      assertEqual(clips.idle.startColumn === 0 && clips.idle.frameCount === 4 && clips.idle.fps === 6, "ART_PACK_MANIFEST_CLIP_INVALID", `${entry.assetId}/${direction}/idle`);
      assertEqual(clips.walk.startColumn === 4 && clips.walk.frameCount === 6 && clips.walk.fps === 10, "ART_PACK_MANIFEST_CLIP_INVALID", `${entry.assetId}/${direction}/walk`);
    }
    const frameById = new Map(entry.frames.map((frame, index) => [frame.id, { frame, index }]));
    for (const [index, frameId] of FIELD_ACTOR_FRAME_IDS.entries()) {
      assertEqual(entry.frames[index]?.id === frameId, "ART_PACK_MANIFEST_FRAME_INVALID", `${entry.assetId}/${frameId}`);
    }
    for (const [row, direction] of ["down", "left", "right", "up"].entries()) {
      const clips = asset.clips[direction as keyof typeof asset.clips];
      for (const [clipName, clip] of [["idle", clips.idle], ["walk", clips.walk]] as const) {
        for (let offset = 0; offset < clip.frameCount; offset += 1) {
          const frameId = `${direction}_${clipName}_${String(offset).padStart(2, "0")}`;
          const located = frameById.get(frameId);
          const expectedIndex = row * entry.columns + clip.startColumn + offset;
          assertEqual(located?.index === expectedIndex, "ART_PACK_MANIFEST_CLIP_INVALID", `${entry.assetId}/${frameId}`);
        }
      }
    }
  }
  if (entry.kind === "battleActor" && asset.kind === "battleActorSheet") {
    const expected = Object.values(asset.clips).reduce((sum, clip) => sum + clip.frameCount, 0);
    assertEqual(entry.frames.length === expected, "ART_PACK_MANIFEST_CLIP_INVALID", entry.assetId);
    assertEqual(entry.frameWidth === asset.frameWidth && entry.frameHeight === asset.frameHeight && entry.columns === asset.columns && entry.rows === asset.rows, "ART_PACK_MANIFEST_DIMENSION_INVALID", entry.assetId);
    const clips = [
      ["idle", asset.clips.idle],
      ["attack", asset.clips.attack],
      ["skill", asset.clips.skill],
      ["hit", asset.clips.hit],
      ["down", asset.clips.down],
    ] as const;
    const expectedClipFields = [
      ["idle", 0, 4, 6, true, undefined],
      ["attack", 4, 6, 12, false, 8],
      ["skill", 10, 8, 12, false, 15],
      ["hit", 18, 3, 12, false, undefined],
      ["down", 21, 6, 10, false, undefined],
    ] as const;
    for (const [name, clip] of clips) {
      const expectedKeys = name === "idle" ? ["startFrame", "frameCount", "fps", "loop"] : name === "hit" || name === "down" ? ["startFrame", "frameCount", "fps", "loop"] : ["startFrame", "frameCount", "fps", "loop", "impactFrame"];
      assertEqual(hasExactKeys(clip, expectedKeys), "ART_PACK_MANIFEST_CLIP_INVALID", `${entry.assetId}/${name}/shape`);
    }
    for (const [[name, clip], [, startFrame, frameCount, fps, loop, impactFrame]] of clips.map((value, index) => [value, expectedClipFields[index]] as const)) {
      assertEqual(clip.startFrame === startFrame && clip.frameCount === frameCount && clip.fps === fps && clip.loop === loop && (clip as { impactFrame?: number }).impactFrame === impactFrame, "ART_PACK_MANIFEST_CLIP_INVALID", `${entry.assetId}/${name}`);
    }
    for (const [index, frameId] of BATTLE_ACTOR_FRAME_IDS.entries()) {
      assertEqual(entry.frames[index]?.id === frameId, "ART_PACK_MANIFEST_FRAME_INVALID", `${entry.assetId}/${frameId}`);
    }
    for (const [index, frameId] of BATTLE_ACTOR_FRAME_IDS.entries()) {
      const clipName = frameId.split("_")[0];
      const clip = asset.clips[clipName as keyof typeof asset.clips];
      assertEqual(clip.startFrame <= index && index < clip.startFrame + clip.frameCount, "ART_PACK_MANIFEST_CLIP_INVALID", `${entry.assetId}/${frameId}`);
    }
  }
}

function validateEntry(entry: ArtPackEntryV1, manifest: { asset: AssetEntryV1; bundleId: string }): void {
  const { asset, bundleId } = manifest;
  assertEqual(assetKind(entry) === asset.kind, "ART_PACK_MANIFEST_TYPE_INVALID", entry.assetId);
  assertEqual(entry.bundleId === bundleId, "ART_PACK_MANIFEST_BUNDLE_INVALID", entry.assetId);
  switch (entry.kind) {
    case "fieldActor":
    case "battleActor":
      if (asset.kind === "fieldActorSheet" || asset.kind === "battleActorSheet") validateActorClip(entry, asset);
      break;
    case "image":
      if (asset.kind === "image") assertEqual(entry.width === asset.width && entry.height === asset.height, "ART_PACK_MANIFEST_DIMENSION_INVALID", entry.assetId);
      break;
    case "singleFrame":
      if (asset.kind === "singleFrame") assertEqual(entry.width === asset.width && entry.height === asset.height, "ART_PACK_MANIFEST_DIMENSION_INVALID", entry.assetId);
      break;
    case "mapTileset":
      if (asset.kind === "mapTileset") assertEqual(entry.tileWidth === asset.tileSize && entry.tileHeight === asset.tileSize && entry.width === asset.columns * asset.tileSize && entry.height === asset.rows * asset.tileSize, "ART_PACK_MANIFEST_DIMENSION_INVALID", entry.assetId);
      break;
    case "atlas":
      if (asset.kind === "atlas") {
        // 显式 manifest fixture 入口也必须保持 schema 的正尺寸合同，不能只依赖上游 parse。
        assertEqual(entry.width > 0 && entry.height > 0, "ART_PACK_MANIFEST_DIMENSION_INVALID", entry.assetId);
        assertEqual(JSON.stringify(entry.requiredFrames) === JSON.stringify(asset.requiredFrames), "ART_PACK_MANIFEST_FRAMES_INVALID", entry.assetId);
      }
      break;
    case "bitmapFont":
      if (asset.kind === "bitmapFont") {
        assertEqual(entry.width > 0 && entry.height > 0, "ART_PACK_MANIFEST_DIMENSION_INVALID", entry.assetId);
        assertEqual(entry.glyphHeight === asset.glyphHeight, "ART_PACK_MANIFEST_DIMENSION_INVALID", entry.assetId);
      }
      break;
  }
}

/**
 * 正式 visual-v1 包覆盖第一层及已冻结的 2～5 层累计资源；fixture/单元测试仍可显式传入旧根。
 * 函数名保留是为了兼容现有调用点，默认根切换只扩大已存在的正式资源集合。
 */
export function validateVerticalSliceEntries(config: ArtPackConfigV1, manifestRoot: AssetManifestV1 = floors02To05AssetManifest): void {
  const index = manifestAssetIndex(manifestRoot);
  for (const entry of config.entries) {
    const manifest = index.get(entry.assetId);
    if (!manifest) throw new ArtPackError("ART_PACK_MANIFEST_ASSET_MISSING", entry.assetId);
    validateEntry(entry, manifest);
  }
}
