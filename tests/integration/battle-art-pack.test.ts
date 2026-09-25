import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parseArtPackConfig, BATTLE_ACTOR_FRAME_IDS } from "../../scripts/art-pack/ArtPackSchema";
import { BATTLE_ACTOR_SPECS } from "../../scripts/art-source/battle-actors/BattleActorDefinitions";

const root = path.resolve(".");

describe("VIS-004A battle art pack", () => {
  it("art-pack 配置包含首批十个正式 battle sheet", async () => {
    const config = parseArtPackConfig(JSON.parse(await fs.readFile(path.join(root, "art/visual/v1/art-pack.json"), "utf8")));
    const entries = config.entries.filter((entry) => entry.kind === "battleActor");
    expect(entries).toHaveLength(BATTLE_ACTOR_SPECS.length);
    expect(entries.map((entry) => entry.assetId)).toEqual(BATTLE_ACTOR_SPECS.map((spec) => spec.assetId));
    for (const entry of entries) {
      expect(entry.frames.map((frame) => frame.id)).toEqual(BATTLE_ACTOR_FRAME_IDS);
      expect(entry.output.image).toBe(`battle/${entry.assetId}.png`);
      expect(entry.output.data).toBe(`battle/${entry.assetId}.json`);
      expect(entry.source.sourceKind).toBe("original");
    }
  });

  it("已发布的 sheet、atlas 和 authoritative lock 均能回读", async () => {
    const lock = JSON.parse(await fs.readFile(path.join(root, "art/visual/v1/art-pack.lock.json"), "utf8")) as { entries: Array<{ assetId: string; outputs: Array<{ path: string; width?: number; height?: number; fileSha256: string }> }> };
    for (const spec of BATTLE_ACTOR_SPECS) {
      const imagePath = path.join(root, "public/assets/visual/v1", spec.outputImage);
      const dataPath = path.join(root, "public/assets/visual/v1", spec.outputData);
      const metadata = await sharp(imagePath).metadata();
      expect(metadata.width).toBe(spec.frameWidth * 27);
      expect(metadata.height).toBe(spec.frameHeight);
      const atlas = JSON.parse(await fs.readFile(dataPath, "utf8")) as { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> };
      expect(Object.keys(atlas.frames)).toEqual(BATTLE_ACTOR_FRAME_IDS);
      expect(atlas.frames.idle_00?.frame).toEqual({ x: 0, y: 0, w: spec.frameWidth, h: spec.frameHeight });
      expect(atlas.frames.down_05?.frame).toEqual({ x: spec.frameWidth * 26, y: 0, w: spec.frameWidth, h: spec.frameHeight });
      const locked = lock.entries.find((entry) => entry.assetId === spec.assetId);
      expect(locked?.outputs.map((output) => output.path)).toEqual([spec.outputData, spec.outputImage].sort());
      expect(locked?.outputs.every((output) => /^[0-9a-f]{64}$/.test(output.fileSha256))).toBe(true);
    }
  });
});

