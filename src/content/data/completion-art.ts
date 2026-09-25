import catalogJson from "../../../public/assets/art/completion/v1/catalog.json";
import type { AssetEntryV1 } from "./assets.manifest";

export const COMPLETION_ART: Readonly<Record<string, { src: string; previewSrc?: string; dataSrc?: string }>> = catalogJson;

/** Preserve IDs, ownership, dimensions and animation clips; only replace reviewed art sources. */
export function withCompletedArt(entry: AssetEntryV1): AssetEntryV1 {
  const art = COMPLETION_ART[entry.id];
  if (!art) return entry;
  const source = {
    sourceKind: entry.id === "atlas_core_ui" || entry.id.startsWith("icon_") ? "original" as const : "generated" as const,
    licenseId: "project-original",
    sourceNote: "completion/v1: built-in image generation and editable native SVG UI; prompts and reproducible packing scripts included.",
  };
  if (entry.kind === "atlas" && art.dataSrc) return { ...entry, imageSrc: art.src, dataSrc: art.dataSrc, source };
  if (entry.kind === "singleFrame" || entry.kind === "battleActorSheet" || entry.kind === "fieldActorSheet") return { ...entry, src: art.src, source };
  return entry;
}

export function artIconUrl(assetId: string): string | null {
  const art = COMPLETION_ART[assetId];
  return art?.previewSrc ?? art?.src ?? null;
}
