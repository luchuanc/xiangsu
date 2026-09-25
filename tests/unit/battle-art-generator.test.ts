import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  BATTLE_ACTOR_FRAME_IDS,
  BATTLE_ACTOR_SPECS,
  BATTLE_ART_ASSET_COUNT,
  BATTLE_ART_PALETTE,
} from "../../scripts/art-source/battle-actors/BattleActorDefinitions";

const projectRoot = path.resolve(".");
const palette = new Set(BATTLE_ART_PALETTE.map((value) => `${Number.parseInt(value.slice(1, 3), 16)}-${Number.parseInt(value.slice(3, 5), 16)}-${Number.parseInt(value.slice(5, 7), 16)}`));

interface RawFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

async function readFrame(file: string): Promise<RawFrame> {
  const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: raw.info.width, height: raw.info.height, data: raw.data };
}

function changedAlphaPixels(left: RawFrame, right: RawFrame): number {
  let changed = 0;
  for (let offset = 3; offset < left.data.length; offset += 4) {
    if (left.data[offset] !== right.data[offset]) changed += 1;
  }
  return changed;
}

function opaqueHorizontalBounds(frame: RawFrame): { readonly minX: number; readonly maxX: number } {
  let minX = frame.width;
  let maxX = -1;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if ((frame.data[(y * frame.width + x) * 4 + 3] ?? 0) === 0) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  return { minX, maxX };
}

describe("VIS-004A battle actor source", () => {
  it("冻结十个身份、27帧动作和普通/首领尺寸合同", () => {
    expect(BATTLE_ACTOR_SPECS).toHaveLength(BATTLE_ART_ASSET_COUNT);
    expect(BATTLE_ART_ASSET_COUNT).toBe(10);
    expect(BATTLE_ACTOR_FRAME_IDS).toHaveLength(27);
    expect(BATTLE_ACTOR_SPECS.filter((spec) => spec.kind === "character")).toHaveLength(4);
    expect(BATTLE_ACTOR_SPECS.filter((spec) => spec.kind === "enemy")).toHaveLength(5);
    expect(BATTLE_ACTOR_SPECS.filter((spec) => spec.kind === "boss")).toHaveLength(1);
    for (const spec of BATTLE_ACTOR_SPECS) {
      expect(spec.frames).toEqual(BATTLE_ACTOR_FRAME_IDS);
      expect(spec.columns).toBe(27);
      expect(spec.rows).toBe(1);
      expect(spec.frameWidth).toBe(spec.boss ? 64 : 48);
      expect(spec.frameHeight).toBe(spec.boss ? 64 : 48);
      expect(spec.anchor).toEqual(spec.boss ? { x: 32, y: 58 } : { x: 24, y: 42 });
    }
  });

  it("每帧只使用固定色板和二值 alpha，并保留脚底锚点", async () => {
    for (const spec of BATTLE_ACTOR_SPECS) {
      const firstFrame = spec.frames[0];
      if (!firstFrame) throw new Error(`缺少首帧 ${spec.assetId}`);
      const file = path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${firstFrame}.png`);
      const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let anchorPixels = 0;
      const colors = new Set<string>();
      for (let y = 0; y < raw.info.height; y += 1) {
        for (let x = 0; x < raw.info.width; x += 1) {
          const offset = (y * raw.info.width + x) * 4;
          const alpha = raw.data[offset + 3] ?? 0;
          expect([0, 255]).toContain(alpha);
          if (alpha === 0) continue;
          expect(y).toBeLessThanOrEqual(spec.anchor.y);
          if (y === spec.anchor.y) anchorPixels += 1;
          const color = `${raw.data[offset]}-${raw.data[offset + 1]}-${raw.data[offset + 2]}`;
          expect(palette.has(color)).toBe(true);
          colors.add(color);
        }
      }
      expect(anchorPixels, spec.assetId).toBeGreaterThan(0);
      expect(colors.size, spec.assetId).toBeGreaterThanOrEqual(4);
    }
  });

  it("动作 clip 有变化且十个身份的首帧不相同", async () => {
    const identityHashes = new Set<string>();
    for (const spec of BATTLE_ACTOR_SPECS) {
      const clipHashes = new Map<string, Set<string>>();
      for (const frame of spec.frames) {
        const file = path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${frame}.png`);
        const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const frameHash = createHash("sha256").update(raw.data).digest("hex");
        const clip = frame.split("_")[0] ?? "";
        const hashes = clipHashes.get(clip) ?? new Set<string>();
        hashes.add(frameHash);
        clipHashes.set(clip, hashes);
        if (frame === "idle_00") identityHashes.add(frameHash);
      }
      for (const [clip, hashes] of clipHashes) expect(hashes.size, `${spec.assetId}/${clip}`).toBeGreaterThanOrEqual(2);
    }
    expect(identityHashes).toHaveLength(BATTLE_ACTOR_SPECS.length);
  });

  it("动作轮廓有足够变化，攻击朝向正确且不触及裁切边界", async () => {
    for (const spec of BATTLE_ACTOR_SPECS) {
      const frames = new Map<string, RawFrame>();
      for (const frameId of spec.frames) {
        const frame = await readFrame(path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${frameId}.png`));
        frames.set(frameId, frame);
        for (let y = 0; y < frame.height; y += 1) {
          expect(frame.data[(y * frame.width) * 4 + 3] ?? 0, `${spec.assetId}/${frameId}/left`).toBe(0);
          expect(frame.data[(y * frame.width + frame.width - 1) * 4 + 3] ?? 0, `${spec.assetId}/${frameId}/right`).toBe(0);
        }
      }

      for (const clip of ["idle", "attack", "skill", "hit", "down"] as const) {
        const clipFrames = spec.frames.filter((frameId) => frameId.startsWith(`${clip}_`)).map((frameId) => frames.get(frameId)!);
        const first = clipFrames[0]!;
        const maxChanged = Math.max(...clipFrames.slice(1).map((frame) => changedAlphaPixels(first, frame)));
        expect(maxChanged, `${spec.assetId}/${clip}`).toBeGreaterThanOrEqual(spec.boss ? 16 : 8);
      }

      const attack = frames.get("attack_03")!;
      const bounds = opaqueHorizontalBounds(attack);
      const leftExtent = spec.anchor.x - bounds.minX;
      const rightExtent = bounds.maxX - spec.anchor.x;
      if (spec.facing === "right") expect(rightExtent, spec.assetId).toBeGreaterThan(leftExtent);
      else expect(leftExtent, spec.assetId).toBeGreaterThan(rightExtent);
    }
  });
});
