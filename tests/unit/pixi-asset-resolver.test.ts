import { vi, describe, expect, it } from "vitest";

vi.hoisted(() => {
  // PixiJS 的正式 Texture/Spritesheet 运行时判定需要浏览器 navigator；Node focused 测试只补最小全局。
  vi.stubGlobal("navigator", {});
});

import { Spritesheet, Texture } from "pixi.js";
import type {
  AssetEntryV1,
  AssetManifestV1,
  FieldActorClipsV1,
} from "../../src/content/data/assets.manifest";
import {
  PixiAssetResolver,
  type PixiAssetResourceProvider,
} from "../../src/ui/rendering/PixiAssetResolver";

const source = {
  sourceKind: "generated" as const,
  sourceNote: "resolver test fixture",
  licenseId: "test",
};

const fieldClips: FieldActorClipsV1 = {
  down: { row: 0, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
  left: { row: 1, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
  right: { row: 2, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
  up: { row: 3, idle: { startColumn: 0, frameCount: 4, fps: 6 }, walk: { startColumn: 4, frameCount: 6, fps: 10 } },
};

const imageEntry: AssetEntryV1 = {
  kind: "image",
  id: "image_logo",
  bundleId: "boot",
  src: "/image_logo.png",
  width: 16,
  height: 16,
  source,
};

const actorEntry: AssetEntryV1 = {
  kind: "fieldActorSheet",
  id: "sprite_field_wanderer",
  bundleId: "actors",
  src: "/wanderer.png",
  frameWidth: 24,
  frameHeight: 32,
  columns: 10,
  rows: 4,
  clips: fieldClips,
  source,
};

const atlasEntry: AssetEntryV1 = {
  kind: "atlas",
  id: "atlas_core_ui",
  bundleId: "ui",
  imageSrc: "/core-ui.png",
  dataSrc: "/core-ui.json",
  requiredFrames: ["panel_9s"],
  source,
};

function makeManifest(
  assets: readonly AssetEntryV1[] = [imageEntry, actorEntry, atlasEntry],
  bundles: AssetManifestV1["bundles"] = [
    { id: "boot", dependsOn: [], assetIds: ["image_logo"] },
    { id: "actors", dependsOn: [], assetIds: ["sprite_field_wanderer"] },
    { id: "ui", dependsOn: [], assetIds: ["atlas_core_ui"] },
  ],
): AssetManifestV1 {
  return {
    schemaVersion: 1,
    contentVersion: "content-1.2.0",
    bundles,
    assets: [...assets],
    animations: [],
  };
}

function makeSheet(): Spritesheet {
  const sheet = new Spritesheet(Texture.WHITE, {
    frames: {
      panel_9s: {
        frame: { x: 0, y: 0, w: 1, h: 1 },
      },
    },
    meta: { scale: 1 },
  });
  sheet.parseSync();
  return sheet;
}

class FakeAssetService implements PixiAssetResourceProvider {
  public constructor(private readonly loaded: ReadonlyMap<string, unknown>) {}

  public getLoadedResource(bundleId: string): unknown | undefined {
    return this.loaded.get(bundleId);
  }
}

function makeResolver(
  manifest = makeManifest(),
  loaded: ReadonlyMap<string, unknown> = new Map([
    ["boot", { image_logo: Texture.WHITE }],
    ["actors", { sprite_field_wanderer: Texture.WHITE }],
    ["ui", { atlas_core_ui: makeSheet() }],
  ]),
): PixiAssetResolver {
  return new PixiAssetResolver(manifest, new FakeAssetService(loaded));
}

describe("PixiAssetResolver", () => {
  it("按精确 ID 解析 image/field spritesheet 与 atlas frame，并保留源对象身份", () => {
    const sheet = makeSheet();
    const image = Texture.WHITE;
    const actor = new Texture({ source: Texture.WHITE.source });
    const resolver = makeResolver(undefined, new Map([
      ["boot", { image_logo: image }],
      ["actors", { sprite_field_wanderer: actor }],
      ["ui", { atlas_core_ui: sheet }],
    ]));

    expect(resolver.requireTexture("image_logo")).toBe(image);
    expect(resolver.requireTexture("sprite_field_wanderer")).toBe(actor);
    expect(resolver.requireAtlasFrame("atlas_core_ui", "panel_9s")).toBe(sheet.textures.panel_9s);
    expect(resolver.requireEntry("image_logo")).toBe(imageEntry);
  });

  it("缺少逻辑资源 ID 时显式失败", () => {
    expect(() => makeResolver().requireEntry("not_in_manifest")).toThrow("PIXEL_ASSET_ENTRY_MISSING:not_in_manifest");
  });

  it("owner bundle 未加载时显式失败", () => {
    expect(() => makeResolver(undefined, new Map()).requireTexture("image_logo"))
      .toThrow("PIXEL_ASSET_BUNDLE_NOT_LOADED:boot");
  });

  it("owner bundle alias 缺失时显式失败", () => {
    expect(() => makeResolver(undefined, new Map([["boot", {}]])).requireTexture("image_logo"))
      .toThrow("PIXEL_ASSET_ALIAS_MISSING:image_logo");
  });

  it("atlas frame 缺失时显式失败", () => {
    expect(() => makeResolver().requireAtlasFrame("atlas_core_ui", "missing_frame"))
      .toThrow("PIXEL_ASSET_FRAME_MISSING:atlas_core_ui/missing_frame");
  });

  it("拒绝非 Pixi Texture/Spritesheet 的 shape-like 资源", () => {
    const resolver = makeResolver(undefined, new Map([
      ["boot", { image_logo: { width: 16, height: 16, source: {} } }],
      ["actors", { sprite_field_wanderer: { width: 24, height: 32, source: {} } }],
      ["ui", { atlas_core_ui: { textures: { panel_9s: Texture.WHITE } } }],
    ]));

    expect(() => resolver.requireTexture("image_logo")).toThrow("PIXEL_ASSET_RESOURCE_INVALID:image_logo");
    expect(() => resolver.requireTexture("sprite_field_wanderer")).toThrow("PIXEL_ASSET_RESOURCE_INVALID:sprite_field_wanderer");
    expect(() => resolver.requireAtlasFrame("atlas_core_ui", "panel_9s"))
      .toThrow("PIXEL_ASSET_RESOURCE_INVALID:atlas_core_ui");
  });

  it("索引阶段拒绝重复 asset ID 与重复 owner 归属", () => {
    const duplicateId = { ...imageEntry };
    expect(() => makeResolver(makeManifest([imageEntry, duplicateId]))).toThrow("PIXEL_ASSET_INDEX_DUPLICATE_ID:image_logo");

    const duplicateOwner = makeManifest(undefined, [
      { id: "boot", dependsOn: [], assetIds: ["image_logo"] },
      { id: "boot_copy", dependsOn: [], assetIds: ["image_logo"] },
      { id: "actors", dependsOn: [], assetIds: ["sprite_field_wanderer"] },
      { id: "ui", dependsOn: [], assetIds: ["atlas_core_ui"] },
    ]);
    expect(() => makeResolver(duplicateOwner)).toThrow("PIXEL_ASSET_INDEX_DUPLICATE_OWNER:image_logo");
  });

  it("索引阶段拒绝 bundle 引用未知 asset 与 manifest 中无 owner 的 asset", () => {
    const unknownMember = makeManifest(undefined, [
      { id: "boot", dependsOn: [], assetIds: ["image_logo", "not_in_manifest"] },
      { id: "actors", dependsOn: [], assetIds: ["sprite_field_wanderer"] },
      { id: "ui", dependsOn: [], assetIds: ["atlas_core_ui"] },
    ]);
    expect(() => makeResolver(unknownMember)).toThrow("PIXEL_ASSET_INDEX_ASSET_MISSING:not_in_manifest");

    const orphan: AssetEntryV1 = { ...imageEntry, id: "orphan_asset" };
    expect(() => makeResolver(makeManifest([imageEntry, actorEntry, atlasEntry, orphan])))
      .toThrow("PIXEL_ASSET_INDEX_OWNER_MISSING:orphan_asset");
  });

  it("索引阶段拒绝 entry owner 不一致、重复 bundleId 与同 bundle 重复成员", () => {
    const mismatch = makeManifest([imageEntry, actorEntry, atlasEntry], [
      { id: "boot", dependsOn: [], assetIds: ["image_logo"] },
      { id: "actors", dependsOn: [], assetIds: ["sprite_field_wanderer"] },
      { id: "ui", dependsOn: [], assetIds: ["atlas_core_ui"] },
    ]);
    mismatch.assets[0] = { ...imageEntry, bundleId: "other" };
    expect(() => makeResolver(mismatch)).toThrow("PIXEL_ASSET_INDEX_OWNER_MISMATCH:image_logo");

    const duplicateBundle = makeManifest(undefined, [
      { id: "boot", dependsOn: [], assetIds: ["image_logo"] },
      { id: "boot", dependsOn: [], assetIds: [] },
      { id: "actors", dependsOn: [], assetIds: ["sprite_field_wanderer"] },
      { id: "ui", dependsOn: [], assetIds: ["atlas_core_ui"] },
    ]);
    expect(() => makeResolver(duplicateBundle)).toThrow("PIXEL_ASSET_INDEX_DUPLICATE_OWNER:boot");

    const duplicateMember = makeManifest(undefined, [
      { id: "boot", dependsOn: [], assetIds: ["image_logo", "image_logo"] },
      { id: "actors", dependsOn: [], assetIds: ["sprite_field_wanderer"] },
      { id: "ui", dependsOn: [], assetIds: ["atlas_core_ui"] },
    ]);
    expect(() => makeResolver(duplicateMember)).toThrow("PIXEL_ASSET_INDEX_DUPLICATE_OWNER:image_logo");
  });

  it("资源提供器缺少强制 getLoadedResource 能力时显式失败", () => {
    expect(() => new PixiAssetResolver(makeManifest(), {} as PixiAssetResourceProvider))
      .toThrow("PIXEL_ASSET_RESOURCE_PROVIDER_INVALID");
  });
});
