import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { packArtConfig, type PackArtOptions } from "../../scripts/art-pack/ArtPackPacker";
import { verifyArtPack } from "../../scripts/art-pack/ArtPackValidator";
import { BATTLE_ACTOR_FRAME_IDS, type ArtPackConfigV1, type ArtPackEntryV1, type BattleActorPackEntryV1, type FieldActorPackEntryV1 } from "../../scripts/art-pack/ArtPackSchema";
import { validateVerticalSliceEntries } from "../../scripts/art-pack/ArtPackManifest";
import { verticalSliceAssetManifest, type AssetEntryV1, type AssetManifestV1 } from "../../src/content/data/assets.manifest";

let root = "";

const source = {
  sourceKind: "generated" as const,
  sourceNote: "packer test fixture",
  licenseId: "generated-fixture",
  licenseFile: null,
};

async function writePng(relativePath: string, width: number, height: number, color: [number, number, number, number], maxOpaqueY = height - 1): Promise<void> {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y <= maxOpaqueY; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set(color, (y * width + x) * 4);
  }
  await writePngFile(path.join(root, "art/visual/v1/input", relativePath), width, height, raw);
}

async function writePngFile(file: string, width: number, height: number, raw: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp(raw, { raw: { width, height, channels: 4 } }).png().toFile(file);
}

function config(entries: ArtPackConfigV1["entries"]): ArtPackConfigV1 {
  return {
    schemaVersion: 1,
    packId: "visual-v1",
    inputRoot: "art/visual/v1/input",
    outputRoot: "public/assets/visual/v1",
    paletteId: "frontier-night-32-v1",
    alphaMode: "threshold-128",
    entries,
  };
}

function imageEntry(overrides: Record<string, unknown> = {}) {
  return {
    kind: "image" as const,
    assetId: "image_boot_logo",
    bundleId: "boot",
    input: "images/logo.png",
    output: "ui/logo.png",
    width: 320,
    height: 96,
    source,
    ...overrides,
  };
}

function fieldEntry(overrides: Partial<FieldActorPackEntryV1> = {}): FieldActorPackEntryV1 {
  const frames = ["down", "left", "right", "up"].flatMap((direction) => [
    ...Array.from({ length: 4 }, (_, index) => ({ id: `${direction}_idle_${String(index).padStart(2, "0")}`, input: `field/hero/${direction}-idle${String(index).padStart(2, "0")}.png` })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `${direction}_walk_${String(index).padStart(2, "0")}`, input: `field/hero/${direction}-walk${String(index).padStart(2, "0")}.png` })),
  ]);
  return {
    kind: "fieldActor" as const,
    assetId: "sprite_field_char_wanderer",
    bundleId: "player_common",
    frameWidth: 24,
    frameHeight: 32,
    columns: 10,
    rows: 4,
    frames,
    output: { image: "field/hero.png", data: "field/hero.json" },
    anchor: { x: 12, y: 28 },
    source,
    ...overrides,
  };
}

function battleEntry(overrides: Partial<BattleActorPackEntryV1> = {}): BattleActorPackEntryV1 {
  return {
    kind: "battleActor",
    assetId: "sprite_battle_char_wanderer",
    bundleId: "player_common",
    boss: false,
    frameWidth: 48,
    frameHeight: 48,
    columns: 27,
    rows: 1,
    frames: BATTLE_ACTOR_FRAME_IDS.map((id) => ({ id, input: `battle/hero/${id}.png` })),
    output: { image: "battle/hero.png", data: "battle/hero.json" },
    anchor: { x: 24, y: 42 },
    source,
    ...overrides,
  };
}

function options(mode: PackArtOptions["mode"] = "publish"): PackArtOptions {
  return { projectRoot: root, mode };
}

function manifestFixture(): AssetManifestV1 {
  return structuredClone(verticalSliceAssetManifest);
}

function manifestAsset(manifest: AssetManifestV1, assetId: string): AssetEntryV1 {
  const asset = manifest.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`missing manifest fixture asset ${assetId}`);
  return asset;
}

async function snapshotTree(directory: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      output.push(`${relative}<missing>`);
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryRelative = path.join(relative, entry.name);
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        output.push(`${entryRelative}/<directory>`);
        await visit(entryPath, `${entryRelative}/`);
      } else if (entry.isSymbolicLink()) {
        output.push(`${entryRelative}/<symlink:${await fs.readlink(entryPath)}>`);
      } else {
        output.push(`${entryRelative}:${(await fs.readFile(entryPath)).toString("base64")}`);
      }
    }
  }
  await visit(directory, "");
  return output;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "xiangsu-art-pack-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("art packer", () => {
  it("packs a field sheet in exact frame order and positions", async () => {
    const entry = fieldEntry();
    for (const [index, frame] of entry.frames.entries()) await writePng(frame.input, 24, 32, index % 2 === 0 ? [13, 20, 41, 255] : [21, 27, 49, 255], 28);
    const result = await packArtConfig(config([entry]), options());
    expect(result.entries).toHaveLength(1);

    const sheet = await sharp(path.join(root, "public/assets/visual/v1/field/hero.png")).metadata();
    expect(sheet.width).toBe(240);
    expect(sheet.height).toBe(128);
    const atlas = JSON.parse(await fs.readFile(path.join(root, "public/assets/visual/v1/field/hero.json"), "utf8")) as {
      frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
    };
    expect(Object.keys(atlas.frames)).toEqual(entry.frames.map((frame) => frame.id));
    expect(atlas.frames["down_idle_00"].frame).toEqual({ x: 0, y: 0, w: 24, h: 32 });
    expect(atlas.frames["up_walk_05"].frame).toEqual({ x: 216, y: 96, w: 24, h: 32 });
  });

  it("requires two different normalized hashes inside every action clip", async () => {
    const entry = fieldEntry();
    for (const [index, frame] of entry.frames.entries()) await writePng(frame.input, 24, 32, index === entry.frames.length - 1 ? [21, 27, 49, 255] : [13, 20, 41, 255], 28);
    await expect(packArtConfig(config([entry]), options())).rejects.toThrow("ART_PACK_CLIP_NOT_ANIMATED");
  });

  it("rejects each field action clip independently when its hashes collapse", async () => {
    const entry = fieldEntry();
    await writePng("field/clip-base.png", 24, 32, [13, 20, 41, 255], 28);
    await writePng("field/clip-alt.png", 24, 32, [21, 27, 49, 255], 28);
    const clips = ["down_idle", "down_walk", "left_idle", "left_walk", "right_idle", "right_walk", "up_idle", "up_walk"];
    for (const targetClip of clips) {
      const candidate: FieldActorPackEntryV1 = {
        ...entry,
        frames: entry.frames.map((frame, index) => ({
          ...frame,
          input: frame.id.startsWith(`${targetClip}_`) ? "field/clip-base.png" : index % 2 === 0 ? "field/clip-base.png" : "field/clip-alt.png",
        })),
      };
      await expect(packArtConfig(config([candidate]), options())).rejects.toThrow("ART_PACK_CLIP_NOT_ANIMATED");
    }
  });

  it("packs a battle actor with the fixed 27-frame underscore contract", async () => {
    const entry = battleEntry();
    for (const [index, frame] of entry.frames.entries()) await writePng(frame.input, 48, 48, index % 2 === 0 ? [13, 20, 41, 255] : [21, 27, 49, 255], 42);
    await packArtConfig(config([entry]), options());
    const metadata = await sharp(path.join(root, "public/assets/visual/v1/battle/hero.png")).metadata();
    expect(metadata.width).toBe(1296);
    expect(metadata.height).toBe(48);
  });

  it("rejects each battle action clip independently when its hashes collapse", async () => {
    const entry = battleEntry();
    await writePng("battle/clip-base.png", 48, 48, [13, 20, 41, 255], 42);
    await writePng("battle/clip-alt.png", 48, 48, [21, 27, 49, 255], 42);
    for (const targetClip of ["idle", "attack", "skill", "hit", "down"]) {
      const candidate: BattleActorPackEntryV1 = {
        ...entry,
        frames: entry.frames.map((frame, index) => ({
          ...frame,
          input: frame.id.startsWith(`${targetClip}_`) ? "battle/clip-base.png" : index % 2 === 0 ? "battle/clip-base.png" : "battle/clip-alt.png",
        })),
      };
      await expect(packArtConfig(config([candidate]), options())).rejects.toThrow("ART_PACK_CLIP_NOT_ANIMATED");
    }
  });

  it("packs a single image and rejects wrong input dimensions", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await packArtConfig(config([imageEntry()]), options());
    expect((await sharp(path.join(root, "public/assets/visual/v1/ui/logo.png")).metadata()).width).toBe(320);

    await writePng("images/bad.png", 3, 2, [215, 154, 84, 255]);
    await expect(packArtConfig(config([imageEntry({ input: "images/bad.png", output: "ui/bad.png" })]), options())).rejects.toThrow("ART_PACK_DIMENSION_INVALID");
  });

  it("reads same-relative inputs from inputRoot and writes same-relative outputs to outputRoot", async () => {
    const image = imageEntry({ input: "same/logo.png", output: "same/logo.png" });
    const singleFrame = {
      kind: "singleFrame" as const,
      assetId: "sprite_eq_sword_t1_windblade",
      bundleId: "core_ui",
      input: "same/sword.png",
      output: "same/sword.png",
      width: 24,
      height: 24,
      source,
    };
    const mapTileset = {
      kind: "mapTileset" as const,
      assetId: "tileset_map_town",
      bundleId: "town",
      input: "same/town.png",
      output: "same/town.png",
      width: 256,
      height: 256,
      tileWidth: 16,
      tileHeight: 16,
      source,
    };
    await writePng(image.input, 320, 96, [215, 154, 84, 255], 92);
    await writePng(singleFrame.input, 24, 24, [13, 20, 41, 255], 23);
    await writePng(mapTileset.input, 256, 256, [21, 27, 49, 255], 255);
    await packArtConfig(config([image, singleFrame, mapTileset]), options());
    for (const relativePath of [image.input, singleFrame.input, mapTileset.input]) {
      await expect(fs.access(path.join(root, "art/visual/v1/input", relativePath))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "public/assets/visual/v1", relativePath))).resolves.toBeUndefined();
    }
    expect((await verifyArtPack(config([image, singleFrame, mapTileset]), { projectRoot: root })).ok).toBe(true);
  });

  it("packs explicit atlas frames without automatic layout and rejects overlap", async () => {
    await writePng("icons/a.png", 2, 2, [13, 20, 41, 255]);
    await writePng("icons/b.png", 2, 2, [215, 154, 84, 255]);
    const coreFrames = [...(verticalSliceAssetManifest.assets.find((asset) => asset.id === "atlas_core_ui") as { requiredFrames: string[] }).requiredFrames];
    const atlas = {
      kind: "atlas" as const,
      assetId: "atlas_core_ui",
      bundleId: "core_ui",
      imageOutput: "ui/icons.png",
      dataOutput: "ui/icons.json",
      width: coreFrames.length * 2,
      height: 2,
      frames: coreFrames.map((id, index) => ({ id, input: `icons/${index}.png`, x: index * 2, y: 0, width: 2, height: 2 })),
      requiredFrames: coreFrames,
      source,
    };
    for (const [index, frame] of atlas.frames.entries()) await writePng(frame.input, 2, 2, index % 2 === 0 ? [13, 20, 41, 255] : [215, 154, 84, 255]);
    await packArtConfig(config([atlas]), options());
    const descriptor = JSON.parse(await fs.readFile(path.join(root, "public/assets/visual/v1/ui/icons.json"), "utf8")) as { frames: Record<string, unknown> };
    expect(Object.keys(descriptor.frames)).toEqual(coreFrames);
    await expect(packArtConfig(config([{ ...atlas, dataOutput: "ui/overlap.json", imageOutput: "ui/overlap.png", frames: atlas.frames.map((frame, index) => index === 1 ? { ...frame, x: 1 } : frame) }]), options())).rejects.toThrow("ART_PACK_ATLAS_OVERLAP");
    await writePng("icons/empty.png", 2, 2, [0, 0, 0, 0]);
    await expect(packArtConfig(config([{ ...atlas, dataOutput: "ui/empty.json", imageOutput: "ui/empty.png", frames: [{ ...atlas.frames[0], input: "icons/empty.png" }, ...atlas.frames.slice(1)] }]), options())).rejects.toThrow("ART_PACK_FRAME_EMPTY");
  });

  it("validates bitmap font page basename and does not publish on failure", async () => {
    await writePng("fonts/ui.png", 2, 2, [13, 20, 41, 255]);
    await fs.mkdir(path.join(root, "art/visual/v1/input/fonts"), { recursive: true });
    await fs.writeFile(path.join(root, "art/visual/v1/input/fonts/ui.fnt"), "info face=ui\npage id=0 file=\"ui.png\"\n", "utf8");
    const entry = {
      kind: "bitmapFont" as const,
      assetId: "font_pixel_zh_cn",
      bundleId: "boot",
      imageInput: "fonts/ui.png",
      descriptorInput: "fonts/ui.fnt",
      imageOutput: "font/ui.png",
      descriptorOutput: "font/ui.fnt",
      width: 2,
      height: 2,
      glyphHeight: 16,
      source,
    };
    await packArtConfig(config([entry]), options());
    expect(await fs.readFile(path.join(root, "public/assets/visual/v1/font/ui.fnt"), "utf8")).toContain('file="ui.png"');

    const oldOutput = path.join(root, "public/assets/visual/v1/sentinel.txt");
    await fs.mkdir(path.dirname(oldOutput), { recursive: true });
    await fs.writeFile(oldOutput, "keep", "utf8");
    await expect(packArtConfig(config([{ ...entry, descriptorInput: "fonts/bad.fnt", imageOutput: "font/bad.png", descriptorOutput: "font/bad.fnt" }]), options())).rejects.toThrow("ART_PACK_INPUT_MISSING");
    expect(await fs.readFile(oldOutput, "utf8")).toBe("keep");
  });

  it("audits licensed files in the authoritative lock", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await fs.mkdir(path.join(root, "art/visual/v1/licenses"), { recursive: true });
    await fs.writeFile(path.join(root, "art/visual/v1/licenses/cc0.txt"), "CC0\n", "utf8");
    const entry = imageEntry({ source: { sourceKind: "licensed", sourceNote: "test", licenseId: "cc0", licenseFile: "licenses/cc0.txt" } });
    await packArtConfig(config([entry]), options());
    const lock = JSON.parse(await fs.readFile(path.join(root, "art/visual/v1/art-pack.lock.json"), "utf8")) as { entries: Array<{ inputSha256: string[] }> };
    expect(lock.entries[0]?.inputSha256).toHaveLength(2);
    expect((await verifyArtPack(config([entry]), { projectRoot: root })).ok).toBe(true);
    await fs.writeFile(path.join(root, "art/visual/v1/licenses/cc0.txt"), "changed\n", "utf8");
    await expect(verifyArtPack(config([entry]), { projectRoot: root })).rejects.toThrow("ART_PACK_INPUT_HASH_MISMATCH");
  });

  it("keeps the committed new outputs and lock when backup cleanup partially fails", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await packArtConfig(config([imageEntry()]), options());
    const previousLock = await fs.readFile(path.join(root, "art/visual/v1/art-pack.lock.json"));
    await writePng("images/logo.png", 320, 96, [13, 20, 41, 255], 92);
    const originalRm = fs.rm.bind(fs);
    let injected = false;
    const remove = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (!injected && String(target).endsWith(".backup")) {
        injected = true;
        await originalRm(path.join(String(target), "ui/logo.png"), options);
        throw new Error("injected backup cleanup failure");
      }
      return originalRm(target, options);
    });
    await expect(packArtConfig(config([imageEntry()]), options())).resolves.toBeTruthy();
    remove.mockRestore();
    const nextLock = await fs.readFile(path.join(root, "art/visual/v1/art-pack.lock.json"));
    expect(nextLock).not.toEqual(previousLock);
    expect((await verifyArtPack(config([imageEntry()]), { projectRoot: root })).ok).toBe(true);
    expect(injected).toBe(true);
  });

  it("check mode only stages, while publish leaves undeclared files intact", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await packArtConfig(config([imageEntry()]), options("check"));
    await expect(fs.access(path.join(root, "public/assets/visual/v1/ui/logo.png"))).rejects.toThrow();
    const sentinel = path.join(root, "public/assets/visual/v1/keep.txt");
    await fs.mkdir(path.dirname(sentinel), { recursive: true });
    await fs.writeFile(sentinel, "keep", "utf8");
    await packArtConfig(config([imageEntry()]), options("publish"));
    expect(await fs.readFile(sentinel, "utf8")).toBe("keep");
  });

  it("check mode does not create the formal output root or lock", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    const outputRoot = path.join(root, "public/assets/visual/v1");
    const lockPath = path.join(root, "art/visual/v1/art-pack.lock.json");
    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.rm(lockPath, { force: true });
    await packArtConfig(config([imageEntry()]), options("check"));
    await expect(fs.access(outputRoot)).rejects.toThrow();
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it("is byte deterministic and canonicalizes entry order", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await writePng("images/other.png", 640, 360, [13, 20, 41, 255], 356);
    const second = imageEntry({ assetId: "image_boot_background", input: "images/other.png", output: "ui/other.png", width: 640, height: 360 });
    const firstConfig = config([second, imageEntry()]);
    await packArtConfig(firstConfig, options());
    const firstLock = await fs.readFile(path.join(root, "art/visual/v1/art-pack.lock.json"));
    const firstPng = await fs.readFile(path.join(root, "public/assets/visual/v1/ui/logo.png"));
    await packArtConfig(config([imageEntry(), second]), options());
    expect(await fs.readFile(path.join(root, "art/visual/v1/art-pack.lock.json"))).toEqual(firstLock);
    expect(await fs.readFile(path.join(root, "public/assets/visual/v1/ui/logo.png"))).toEqual(firstPng);
  });

  it("verifies lock/output and reports tampering with stable codes", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await packArtConfig(config([imageEntry()]), options());
    expect((await verifyArtPack(config([imageEntry()]), { projectRoot: root })).ok).toBe(true);
    await fs.appendFile(path.join(root, "public/assets/visual/v1/ui/logo.png"), Buffer.from([1]));
    await expect(verifyArtPack(config([imageEntry()]), { projectRoot: root })).rejects.toThrow("ART_PACK_OUTPUT_HASH_MISMATCH");
  });

  it("requires canonical PNG lock metadata and the actual sharp version", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await packArtConfig(config([imageEntry()]), options());
    const lockPath = path.join(root, "art/visual/v1/art-pack.lock.json");
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8")) as { entries: Array<{ outputs: Array<Record<string, unknown>> }>; toolchain: Record<string, unknown> };
    const output = lock.entries[0]?.outputs[0];
    if (!output) throw new Error("test lock output missing");
    const reordered = { pixelSha256: output.pixelSha256, fileSha256: output.fileSha256, height: output.height, width: output.width, path: output.path };
    lock.entries[0]!.outputs[0] = reordered;
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await expect(verifyArtPack(config([imageEntry()]), { projectRoot: root })).rejects.toThrow("ART_PACK_LOCK_CANONICAL_INVALID");
    lock.entries[0]!.outputs[0] = output;
    delete output.pixelSha256;
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await expect(verifyArtPack(config([imageEntry()]), { projectRoot: root })).rejects.toThrow("ART_PACK_LOCK_INVALID");
    output.pixelSha256 = (await packArtConfig(config([imageEntry()]), options())).lock.entries[0]!.outputs[0]!.pixelSha256;
    lock.toolchain.sharp = "0.0.0";
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await expect(verifyArtPack(config([imageEntry()]), { projectRoot: root })).rejects.toThrow("ART_PACK_TOOLCHAIN_INVALID");
  });

  it("rolls back every formal output and the old lock when the second rename fails", async () => {
    const second = imageEntry({ assetId: "image_boot_background", input: "images/other.png", output: "ui/other.png", width: 640, height: 360 });
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await writePng("images/other.png", 640, 360, [13, 20, 41, 255], 356);
    const outputRoot = path.join(root, "public/assets/visual/v1/ui");
    await fs.mkdir(outputRoot, { recursive: true });
    await fs.writeFile(path.join(outputRoot, "logo.png"), "old-logo", "utf8");
    await fs.mkdir(path.join(outputRoot, "other.png"));
    const oldLock = Buffer.from("old-lock\n");
    await fs.mkdir(path.join(root, "art/visual/v1"), { recursive: true });
    await fs.writeFile(path.join(root, "art/visual/v1/art-pack.lock.json"), oldLock);
    const originalRename = fs.rename.bind(fs);
    const rename = vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
      if (String(source).includes(".staging-v1-") && !String(source).includes(".backup") && String(target).endsWith("/ui/other.png")) throw new Error("injected second rename failure");
      return originalRename(source, target);
    });
    await expect(packArtConfig(config([imageEntry(), second]), options())).rejects.toThrow("injected second rename failure");
    rename.mockRestore();
    expect(await fs.readFile(path.join(outputRoot, "logo.png"), "utf8")).toBe("old-logo");
    expect(await fs.readFile(path.join(root, "art/visual/v1/art-pack.lock.json"))).toEqual(oldLock);
  });

  it("rejects input, output, and license symlink escapes", async () => {
    const outside = path.join(root, "outside.png");
    await writePngFile(outside, 2, 2, Buffer.alloc(16, 255));
    await fs.mkdir(path.join(root, "art/visual/v1/input/images"), { recursive: true });
    await fs.symlink(outside, path.join(root, "art/visual/v1/input/images/link.png"));
    await expect(packArtConfig(config([imageEntry({ input: "images/link.png" })]), options())).rejects.toThrow("ART_PACK_PATH_SYMLINK");

    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    const externalOutput = path.join(root, "external-output");
    await fs.mkdir(externalOutput, { recursive: true });
    await fs.mkdir(path.join(root, "public/assets/visual"), { recursive: true });
    await fs.rm(path.join(root, "public/assets/visual/v1"), { recursive: true, force: true });
    await fs.symlink(externalOutput, path.join(root, "public/assets/visual/v1"));
    await expect(packArtConfig(config([imageEntry()]), options())).rejects.toThrow("ART_PACK_PATH_SYMLINK");

    const safeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xiangsu-art-license-"));
    await fs.mkdir(path.join(safeRoot, "art/visual/v1/input/images"), { recursive: true });
    await fs.mkdir(path.join(safeRoot, "art/visual/v1/licenses"), { recursive: true });
    await writePngFile(path.join(safeRoot, "art/visual/v1/input/images/logo.png"), 2, 2, Buffer.alloc(16, 255));
    await fs.symlink(outside, path.join(safeRoot, "art/visual/v1/licenses/LICENSE.txt"));
    await expect(packArtConfig({ ...config([imageEntry({ source: { sourceKind: "licensed", sourceNote: "test", licenseId: "cc0", licenseFile: "licenses/LICENSE.txt" } })]), entries: [imageEntry({ source: { sourceKind: "licensed", sourceNote: "test", licenseId: "cc0", licenseFile: "licenses/LICENSE.txt" } })] }, { projectRoot: safeRoot, mode: "publish" })).rejects.toThrow("ART_PACK_PATH_SYMLINK");
  });

  it("rejects an input-root ancestor symlink and preserves the external tree", async () => {
    const external = path.join(root, "external-input");
    await fs.mkdir(external, { recursive: true });
    await fs.writeFile(path.join(external, "keep.txt"), "keep-input", "utf8");
    const before = await snapshotTree(external);
    const inputRoot = path.join(root, "art/visual/v1/input");
    await fs.rm(inputRoot, { recursive: true, force: true });
    await fs.mkdir(path.dirname(inputRoot), { recursive: true });
    await fs.symlink(external, inputRoot);
    await expect(packArtConfig(config([imageEntry()]), options("publish"))).rejects.toThrow("ART_PACK_PATH_SYMLINK");
    expect(await snapshotTree(external)).toEqual(before);
  });

  it("rejects an output-root ancestor symlink in publish and verify without touching external files", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    const external = path.join(root, "external-output-root");
    await fs.mkdir(external, { recursive: true });
    await fs.writeFile(path.join(external, "keep.txt"), "keep-output", "utf8");
    const before = await snapshotTree(external);
    const outputRoot = path.join(root, "public/assets/visual/v1");
    await fs.mkdir(path.dirname(outputRoot), { recursive: true });
    await fs.symlink(external, outputRoot);
    await expect(packArtConfig(config([imageEntry()]), options("publish"))).rejects.toThrow("ART_PACK_PATH_SYMLINK");
    expect(await snapshotTree(external)).toEqual(before);

    await fs.rm(outputRoot, { recursive: true, force: true });
    await packArtConfig(config([imageEntry()]), options("publish"));
    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.symlink(external, outputRoot);
    await expect(verifyArtPack(config([imageEntry()]), { projectRoot: root })).rejects.toThrow("ART_PACK_PATH_SYMLINK");
    expect(await snapshotTree(external)).toEqual(before);
  });

  it("rejects a license-root ancestor symlink in pack and verify without touching external files", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    const external = path.join(root, "external-license-root");
    await fs.mkdir(external, { recursive: true });
    await fs.writeFile(path.join(external, "keep.txt"), "keep-license", "utf8");
    const before = await snapshotTree(external);
    const licenseRoot = path.join(root, "art/visual/v1/licenses");
    await fs.symlink(external, licenseRoot);
    const licensed = imageEntry({ source: { sourceKind: "licensed", sourceNote: "test", licenseId: "cc0", licenseFile: "licenses/cc0.txt" } });
    await expect(packArtConfig(config([licensed]), options("publish"))).rejects.toThrow("ART_PACK_PATH_SYMLINK");
    expect(await snapshotTree(external)).toEqual(before);

    await fs.rm(licenseRoot, { recursive: true, force: true });
    await fs.mkdir(licenseRoot, { recursive: true });
    await fs.writeFile(path.join(licenseRoot, "cc0.txt"), "CC0\n", "utf8");
    await packArtConfig(config([licensed]), options("publish"));
    await fs.rm(licenseRoot, { recursive: true, force: true });
    await fs.symlink(external, licenseRoot);
    await expect(verifyArtPack(config([licensed]), { projectRoot: root })).rejects.toThrow("ART_PACK_PATH_SYMLINK");
    expect(await snapshotTree(external)).toEqual(before);
  });

  it("rejects a lock-file symlink while keeping its external target unchanged", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await packArtConfig(config([imageEntry()]), options("publish"));
    const external = path.join(root, "external-lock-root");
    await fs.mkdir(external, { recursive: true });
    const externalLock = path.join(external, "lock.json");
    await fs.writeFile(externalLock, "external-lock", "utf8");
    const before = await snapshotTree(external);
    const lockPath = path.join(root, "art/visual/v1/art-pack.lock.json");
    await fs.rm(lockPath, { force: true });
    await fs.symlink(externalLock, lockPath);
    await expect(packArtConfig(config([imageEntry()]), options("publish"))).rejects.toThrow("ART_PACK_PATH_SYMLINK");
    await expect(verifyArtPack(config([imageEntry()]), { projectRoot: root })).rejects.toThrow("ART_PACK_PATH_SYMLINK");
    expect(await snapshotTree(external)).toEqual(before);
  });

  it("checks the staging ancestor before mkdir and leaves an external symlink target untouched", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    const external = path.join(root, "external-public");
    await fs.mkdir(external, { recursive: true });
    await fs.writeFile(path.join(external, "keep.txt"), "keep-staging", "utf8");
    const before = await snapshotTree(external);
    await fs.rm(path.join(root, "public"), { recursive: true, force: true });
    await fs.symlink(external, path.join(root, "public"));
    await expect(packArtConfig(config([imageEntry()]), options("check"))).rejects.toThrow("ART_PACK_PATH_SYMLINK");
    expect(await snapshotTree(external)).toEqual(before);
  });

  it("rejects a file where a staging ancestor must be a directory", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await fs.mkdir(path.join(root, "public"), { recursive: true });
    await fs.writeFile(path.join(root, "public/assets"), "not-a-directory", "utf8");
    await expect(packArtConfig(config([imageEntry()]), options("check"))).rejects.toThrow("ART_PACK_PATH_INVALID");
  });

  it("requires every asset entry to exist in the vertical slice manifest", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    await expect(packArtConfig(config([imageEntry({ assetId: "not_in_vertical_slice" })]), options())).rejects.toThrow("ART_PACK_MANIFEST_ASSET_MISSING");
  });

  it("默认正式根覆盖 2～5 层新增的 field actor，仍拒绝更高层 ID", () => {
    const entries = [
      fieldEntry({ assetId: "sprite_field_char_ranger", bundleId: "player_common", output: { image: "field/ranger.png", data: "field/ranger.json" } }),
      fieldEntry({ assetId: "sprite_field_char_frost_seer", bundleId: "player_common", output: { image: "field/seer.png", data: "field/seer.json" } }),
      fieldEntry({ assetId: "sprite_npc_cartographer", bundleId: "town", output: { image: "field/cartographer.png", data: "field/cartographer.json" } }),
      fieldEntry({ assetId: "sprite_npc_abyss_watcher", bundleId: "town", output: { image: "field/watcher.png", data: "field/watcher.json" } }),
    ];
    expect(() => validateVerticalSliceEntries(config(entries))).not.toThrow();
    expect(() => validateVerticalSliceEntries(config([fieldEntry({ assetId: "sprite_field_encounter_floor_06_normal_a", bundleId: "floor_06" })]))).toThrow("ART_PACK_MANIFEST_ASSET_MISSING");
  });

  it("rejects a licensed entry whose physical license file is missing", async () => {
    await writePng("images/logo.png", 320, 96, [215, 154, 84, 255], 92);
    const entry = imageEntry({ source: { sourceKind: "licensed", sourceNote: "test", licenseId: "cc0", licenseFile: "licenses/missing.txt" } });
    await expect(packArtConfig(config([entry]), options())).rejects.toThrow("ART_PACK_LICENSE_INVALID");
  });

  it("validates every manifest contract against an explicit real-shape fixture", () => {
    const wrongEntryBundle = imageEntry({ bundleId: "core_ui" });
    expect(() => validateVerticalSliceEntries(config([wrongEntryBundle]), manifestFixture())).toThrow("ART_PACK_MANIFEST_BUNDLE_INVALID");

    const missingOwner = manifestFixture();
    const bootBundle = missingOwner.bundles.find((bundle) => bundle.id === "boot");
    if (!bootBundle) throw new Error("missing boot bundle fixture");
    bootBundle.assetIds = bootBundle.assetIds.filter((assetId) => assetId !== "image_boot_logo");
    expect(() => validateVerticalSliceEntries(config([imageEntry()]), missingOwner)).toThrow("ART_PACK_MANIFEST_INVALID");

    const ownerMismatch = manifestFixture();
    const ownerMismatchAsset = manifestAsset(ownerMismatch, "image_boot_logo");
    ownerMismatchAsset.bundleId = "core_ui";
    expect(() => validateVerticalSliceEntries(config([imageEntry()]), ownerMismatch)).toThrow("ART_PACK_MANIFEST_INVALID");

    const wrongKind = manifestFixture();
    (manifestAsset(wrongKind, "image_boot_logo") as unknown as { kind: string }).kind = "singleFrame";
    expect(() => validateVerticalSliceEntries(config([imageEntry()]), wrongKind)).toThrow("ART_PACK_MANIFEST_TYPE_INVALID");

    const wrongDimensions = manifestFixture();
    const dimensionAsset = manifestAsset(wrongDimensions, "image_boot_logo");
    if (dimensionAsset.kind !== "image") throw new Error("image fixture kind changed");
    dimensionAsset.width = 319;
    expect(() => validateVerticalSliceEntries(config([imageEntry()]), wrongDimensions)).toThrow("ART_PACK_MANIFEST_DIMENSION_INVALID");

    const fieldDirections = ["down", "left", "right", "up"] as const;
    const fieldClipNames = ["idle", "walk"] as const;
    for (const direction of fieldDirections) {
      for (const clipName of fieldClipNames) {
        const cases: Array<[string, (asset: Extract<AssetEntryV1, { kind: "fieldActorSheet" }>) => void]> = [
          ["row", (asset) => { asset.clips[direction].row = ((asset.clips[direction].row + 1) % 4) as 0 | 1 | 2 | 3; }],
          ["startColumn", (asset) => { (asset.clips[direction][clipName] as unknown as { startColumn: number }).startColumn = clipName === "idle" ? 1 : 3; }],
          ["frameCount", (asset) => { (asset.clips[direction][clipName] as unknown as { frameCount: number }).frameCount = clipName === "idle" ? 3 : 5; }],
          ["fps", (asset) => { (asset.clips[direction][clipName] as unknown as { fps: number }).fps = clipName === "idle" ? 7 : 11; }],
          ["strict-extra-loop", (asset) => { (asset.clips[direction][clipName] as unknown as Record<string, unknown>).loop = false; }],
        ];
        for (const [field, mutate] of cases) {
          const fixture = manifestFixture();
          const asset = manifestAsset(fixture, "sprite_field_char_wanderer");
          if (asset.kind !== "fieldActorSheet") throw new Error(`field fixture kind changed for ${direction}/${clipName}/${field}`);
          mutate(asset);
          expect(() => validateVerticalSliceEntries(config([fieldEntry()]), fixture), `${direction}/${clipName}/${field}`).toThrow("ART_PACK_MANIFEST_CLIP_INVALID");
        }
      }
    }

    const battleClipNames = ["idle", "attack", "skill", "hit", "down"] as const;
    for (const clipName of battleClipNames) {
      const clipCases: Array<[string, (asset: Extract<AssetEntryV1, { kind: "battleActorSheet" }>) => void]> = [
        ["startFrame", (asset) => { (asset.clips[clipName] as unknown as { startFrame: number }).startFrame += 1; }],
        ["frameCount", (asset) => { (asset.clips[clipName] as unknown as { frameCount: number }).frameCount -= 1; }],
        ["fps", (asset) => { (asset.clips[clipName] as unknown as { fps: number }).fps += 1; }],
        ["loop", (asset) => { (asset.clips[clipName] as unknown as { loop: boolean }).loop = !asset.clips[clipName].loop; }],
      ];
      if (clipName === "idle" || clipName === "hit" || clipName === "down") {
        clipCases.push(["strict-extra-impactFrame", (asset) => { (asset.clips[clipName] as unknown as Record<string, unknown>).impactFrame = 0; }]);
      } else {
        clipCases.push(["impactFrame", (asset) => { (asset.clips[clipName] as unknown as { impactFrame: number }).impactFrame += 1; }]);
      }
      for (const [field, mutate] of clipCases) {
        const fixture = manifestFixture();
        const asset = manifestAsset(fixture, "sprite_battle_char_wanderer");
        if (asset.kind !== "battleActorSheet") throw new Error(`battle fixture kind changed for ${clipName}/${field}`);
        mutate(asset);
        expect(() => validateVerticalSliceEntries(config([battleEntry()]), fixture), `${clipName}/${field}`).toThrow("ART_PACK_MANIFEST_CLIP_INVALID");
      }
    }

    const singleFrameEntry = {
      kind: "singleFrame" as const,
      assetId: "sprite_eq_sword_t1_windblade",
      bundleId: "core_ui",
      input: "icons/sword.png",
      output: "ui/sword.png",
      width: 24,
      height: 24,
      source,
    };
    const mapTilesetEntry = {
      kind: "mapTileset" as const,
      assetId: "tileset_map_town",
      bundleId: "town",
      input: "maps/town.png",
      output: "maps/town.png",
      width: 256,
      height: 256,
      tileWidth: 16,
      tileHeight: 16,
      source,
    };
    const bitmapFontEntry = {
      kind: "bitmapFont" as const,
      assetId: "font_pixel_zh_cn",
      bundleId: "boot",
      imageInput: "fonts/pixel.png",
      descriptorInput: "fonts/pixel.fnt",
      imageOutput: "fonts/pixel.png",
      descriptorOutput: "fonts/pixel.fnt",
      width: 256,
      height: 256,
      glyphHeight: 16,
      source,
    };
    const atlasBaseFixture = manifestFixture();
    const atlasBaseAsset = manifestAsset(atlasBaseFixture, "atlas_core_ui");
    if (atlasBaseAsset.kind !== "atlas") throw new Error("atlas fixture kind changed");
    const makeAtlasEntry = (requiredFrames: string[]) => ({
      kind: "atlas" as const,
      assetId: "atlas_core_ui",
      bundleId: "core_ui",
      imageOutput: "ui/atlas.png",
      dataOutput: "ui/atlas.json",
      width: 256,
      height: 192,
      frames: requiredFrames.map((id, index) => ({ id, input: `atlas/${index}.png`, x: 0, y: 0, width: 1, height: 1 })),
      requiredFrames: [...requiredFrames],
      source,
    });
    const dimensionCases: Array<[
      string,
      string,
      () => ArtPackEntryV1,
      (asset: AssetEntryV1) => void,
      (entry: ArtPackEntryV1) => void,
    ]> = [
      ["fieldActor", "sprite_field_char_wanderer", () => fieldEntry(), (asset) => { if (asset.kind !== "fieldActorSheet") throw new Error("field fixture kind changed"); (asset as unknown as { frameWidth: number }).frameWidth = 23; }, () => undefined],
      ["battleActor", "sprite_battle_char_wanderer", () => battleEntry(), (asset) => { if (asset.kind !== "battleActorSheet") throw new Error("battle fixture kind changed"); (asset as unknown as { frameWidth: number }).frameWidth = 47; }, () => undefined],
      ["image", "image_boot_logo", () => imageEntry(), (asset) => { if (asset.kind !== "image") throw new Error("image fixture kind changed"); asset.width = 319; }, () => undefined],
      ["singleFrame", "sprite_eq_sword_t1_windblade", () => singleFrameEntry, (asset) => { if (asset.kind !== "singleFrame") throw new Error("single frame fixture kind changed"); (asset as unknown as { width: number }).width = 23; }, () => undefined],
      ["mapTileset", "tileset_map_town", () => mapTilesetEntry, (asset) => { if (asset.kind !== "mapTileset") throw new Error("map fixture kind changed"); asset.columns = 15; }, () => undefined],
      ["bitmapFont", "font_pixel_zh_cn", () => bitmapFontEntry, (asset) => { if (asset.kind !== "bitmapFont") throw new Error("font fixture kind changed"); (asset as unknown as { glyphHeight: number }).glyphHeight = 15; }, () => undefined],
      ["atlas", "atlas_core_ui", () => makeAtlasEntry(atlasBaseAsset.requiredFrames), () => undefined, (entry) => { if (entry.kind !== "atlas") throw new Error("atlas entry kind changed"); entry.width = 0; }],
    ];
    for (const [kind, assetId, makeEntry, mutateAsset, mutateEntry] of dimensionCases) {
      const fixture = manifestFixture();
      const entry = makeEntry();
      mutateAsset(manifestAsset(fixture, assetId));
      mutateEntry(entry);
      expect(() => validateVerticalSliceEntries(config([entry]), fixture), `${kind}/${assetId}`).toThrow("ART_PACK_MANIFEST_DIMENSION_INVALID");
    }

    const atlasFixture = manifestFixture();
    const atlasAsset = manifestAsset(atlasFixture, "atlas_core_ui");
    if (atlasAsset.kind !== "atlas") throw new Error("atlas fixture kind changed");
    const atlasEntry = {
      kind: "atlas" as const,
      assetId: "atlas_core_ui",
      bundleId: "core_ui",
      imageOutput: "ui/atlas.png",
      dataOutput: "ui/atlas.json",
      width: 2,
      height: 2,
      frames: atlasAsset.requiredFrames.map((id, index) => ({ id, input: `atlas/${index}.png`, x: 0, y: 0, width: 1, height: 1 })),
      requiredFrames: [...atlasAsset.requiredFrames],
      source,
    };
    atlasAsset.requiredFrames = atlasAsset.requiredFrames.slice(1);
    expect(() => validateVerticalSliceEntries(config([atlasEntry]), atlasFixture)).toThrow("ART_PACK_MANIFEST_FRAMES_INVALID");
  });
});
