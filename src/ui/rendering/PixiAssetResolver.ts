import { Spritesheet, Texture } from "pixi.js";
import type {
  AssetEntryV1,
  AssetManifestV1,
} from "../../content/data/assets.manifest";

export interface PixiAssetResourceProvider {
  getLoadedResource(bundleId: string): unknown | undefined;
}

export interface PixiRenderAssetSource {
  requireEntry(assetId: string): Readonly<AssetEntryV1>;
  requireTexture(assetId: string): Texture;
  requireAtlasFrame(atlasId: string, frameId: string): Texture;
}

type LoadedAliasMap = Record<string, unknown>;

/**
 * 将静态 manifest 的逻辑资源 ID 精确映射到已加载的 Pixi 资源。
 * 该类只负责解析，不负责加载、缓存或销毁 AssetService 持有的源资源。
 */
export class PixiAssetResolver implements PixiRenderAssetSource {
  private readonly entries = new Map<string, Readonly<AssetEntryV1>>();
  private readonly owners = new Map<string, string>();

  public constructor(
    manifest: AssetManifestV1,
    private readonly assetService: PixiAssetResourceProvider,
  ) {
    if (typeof assetService.getLoadedResource !== "function") {
      throw new Error("PIXEL_ASSET_RESOURCE_PROVIDER_INVALID");
    }
    this.indexManifest(manifest);
  }

  public requireEntry(assetId: string): Readonly<AssetEntryV1> {
    const entry = this.entries.get(assetId);
    if (!entry) throw new Error(`PIXEL_ASSET_ENTRY_MISSING:${assetId}`);
    return entry;
  }

  public requireTexture(assetId: string): Texture {
    const entry = this.requireEntry(assetId);
    const resource = this.requireAlias(entry.id);
    if (!(resource instanceof Texture)) {
      throw new Error(`PIXEL_ASSET_RESOURCE_INVALID:${assetId}`);
    }
    return resource;
  }

  public requireAtlasFrame(atlasId: string, frameId: string): Texture {
    const entry = this.requireEntry(atlasId);
    if (entry.kind !== "atlas") {
      throw new Error(`PIXEL_ASSET_RESOURCE_INVALID:${atlasId}`);
    }

    const resource = this.requireAlias(atlasId);
    if (!(resource instanceof Spritesheet)) {
      throw new Error(`PIXEL_ASSET_RESOURCE_INVALID:${atlasId}`);
    }
    if (!Object.prototype.hasOwnProperty.call(resource.textures, frameId)) {
      throw new Error(`PIXEL_ASSET_FRAME_MISSING:${atlasId}/${frameId}`);
    }

    const frame = resource.textures[frameId];
    if (!(frame instanceof Texture)) {
      throw new Error(`PIXEL_ASSET_RESOURCE_INVALID:${atlasId}/${frameId}`);
    }
    return frame;
  }

  private indexManifest(manifest: AssetManifestV1): void {
    for (const entry of manifest.assets) {
      if (entry.id.length === 0 || entry.bundleId.length === 0) {
        throw new Error(`PIXEL_ASSET_INDEX_INVALID_ENTRY:${entry.id}`);
      }
      if (this.entries.has(entry.id)) {
        throw new Error(`PIXEL_ASSET_INDEX_DUPLICATE_ID:${entry.id}`);
      }
      this.entries.set(entry.id, entry);
    }

    const bundleIds = new Set<string>();
    for (const bundle of manifest.bundles) {
      if (bundle.id.length === 0) {
        throw new Error("PIXEL_ASSET_INDEX_INVALID_OWNER:");
      }
      if (bundleIds.has(bundle.id)) {
        throw new Error(`PIXEL_ASSET_INDEX_DUPLICATE_OWNER:${bundle.id}`);
      }
      bundleIds.add(bundle.id);

      for (const assetId of bundle.assetIds) {
        if (!this.entries.has(assetId)) {
          throw new Error(`PIXEL_ASSET_INDEX_ASSET_MISSING:${assetId}`);
        }
        if (this.owners.has(assetId)) {
          throw new Error(`PIXEL_ASSET_INDEX_DUPLICATE_OWNER:${assetId}`);
        }
        this.owners.set(assetId, bundle.id);
      }
    }

    for (const entry of manifest.assets) {
      const owner = this.owners.get(entry.id);
      if (!owner) {
        throw new Error(`PIXEL_ASSET_INDEX_OWNER_MISSING:${entry.id}`);
      }
      if (owner !== entry.bundleId) {
        throw new Error(`PIXEL_ASSET_INDEX_OWNER_MISMATCH:${entry.id}`);
      }
    }
  }

  private requireAlias(assetId: string): unknown {
    const owner = this.owners.get(assetId);
    if (!owner) {
      // 构造阶段已保证该分支不可达，保留稳定错误以防索引被意外破坏。
      throw new Error(`PIXEL_ASSET_INDEX_OWNER_MISSING:${assetId}`);
    }

    const loaded = this.assetService.getLoadedResource(owner);
    if (loaded === undefined) {
      throw new Error(`PIXEL_ASSET_BUNDLE_NOT_LOADED:${owner}`);
    }
    if (!this.isAliasMap(loaded) || !Object.prototype.hasOwnProperty.call(loaded, assetId)) {
      throw new Error(`PIXEL_ASSET_ALIAS_MISSING:${assetId}`);
    }
    return loaded[assetId];
  }

  private isAliasMap(value: unknown): value is LoadedAliasMap {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
