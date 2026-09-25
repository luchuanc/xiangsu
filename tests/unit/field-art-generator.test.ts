import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  FIELD_ACTOR_FRAME_IDS,
  FIELD_ACTOR_SPECS,
  FIELD_ART_ASSET_COUNT,
  FIELD_ART_PALETTE,
} from "../../scripts/art-source/field-actors/FieldActorDefinitions";

const projectRoot = path.resolve(".");
const STRUCTURAL_DIRECTION_ASSETS = new Set([
  "sprite_field_char_iron_guard",
  "sprite_npc_abyss_watcher",
  "sprite_field_encounter_floor_01_normal_a",
  "sprite_field_encounter_floor_01_normal_b",
  "sprite_field_encounter_floor_01_normal_c",
  "sprite_field_encounter_floor_01_elite_boar",
  "sprite_field_encounter_floor_01_boss",
]);

describe("VIS-002D field actor source", () => {
  it("冻结 18 个 field actor、40 帧和固定 24x32 合同", () => {
    expect(FIELD_ACTOR_SPECS).toHaveLength(FIELD_ART_ASSET_COUNT);
    expect(FIELD_ART_ASSET_COUNT).toBe(18);
    expect(FIELD_ACTOR_FRAME_IDS).toHaveLength(40);
    for (const spec of FIELD_ACTOR_SPECS) {
      expect(spec.frameWidth).toBe(24);
      expect(spec.frameHeight).toBe(32);
      expect(spec.columns).toBe(10);
      expect(spec.rows).toBe(4);
      expect(spec.anchor).toEqual({ x: 12, y: 28 });
      expect(spec.frames).toEqual(FIELD_ACTOR_FRAME_IDS);
    }
  });

  it("每个身份使用至少四种固定色板颜色并写入独立目录", async () => {
    for (const spec of FIELD_ACTOR_SPECS) {
      const frame = spec.frames[0];
      if (!frame) throw new Error(`缺少首帧 ${spec.assetId}`);
      const file = path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${frame}.png`);
      const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const colors = new Set<string>();
      for (let index = 0; index < raw.data.length; index += 4) {
        if (raw.data[index + 3] !== 0) colors.add(`${raw.data[index]}-${raw.data[index + 1]}-${raw.data[index + 2]}`);
      }
      expect(colors.size).toBeGreaterThanOrEqual(4);
      expect(spec.inputDirectory).toContain(spec.assetId);
    }
    expect(FIELD_ART_PALETTE).toHaveLength(32);
  });

  it("每张首帧保持脚底锚点且 28 行以下透明", async () => {
    for (const spec of FIELD_ACTOR_SPECS) {
      const frame = spec.frames[0];
      if (!frame) throw new Error(`缺少首帧 ${spec.assetId}`);
      const file = path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${frame}.png`);
      const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let anchorPixels = 0;
      for (let y = 0; y < raw.info.height; y += 1) {
        for (let x = 0; x < raw.info.width; x += 1) {
          const alpha = raw.data[(y * raw.info.width + x) * 4 + 3] ?? 0;
          if (y > 28) expect(alpha).toBe(0);
          if (y === 28 && alpha !== 0) anchorPixels += 1;
        }
      }
      expect(anchorPixels).toBeGreaterThan(0);
    }
  });

  it("首帧身份图形不退化为极小点或满矩形", async () => {
    const hashes = new Set<string>();
    for (const spec of FIELD_ACTOR_SPECS) {
      const file = path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, "down_idle_00.png");
      const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let opaque = 0;
      for (let index = 3; index < raw.data.length; index += 4) if (raw.data[index] !== 0) opaque += 1;
      expect(opaque).toBeGreaterThanOrEqual(24);
      expect(opaque).toBeLessThanOrEqual(500);
      hashes.add(createHash("sha256").update(raw.data).digest("hex"));
    }
    expect(hashes).toHaveLength(FIELD_ACTOR_SPECS.length);
  });

  it("四个朝向首帧均有独立像素 hash", async () => {
    const directions = ["down", "left", "right", "up"] as const;
    for (const spec of FIELD_ACTOR_SPECS) {
      const hashes = new Set<string>();
      for (const direction of directions) {
        const file = path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${direction}_idle_00.png`);
        const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        hashes.add(createHash("sha256").update(raw.data).digest("hex"));
      }
      expect(hashes, spec.assetId).toHaveLength(4);
    }
  });

  it("方向差异必须来自主体 alpha 轮廓，不接受统一叠加的离体单像素", async () => {
    const readAlpha = async (spec: (typeof FIELD_ACTOR_SPECS)[number], direction: "down" | "right" | "up"): Promise<Buffer> => {
      const file = path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${direction}_idle_00.png`);
      return sharp(file).ensureAlpha().raw().toBuffer();
    };
    const maskDifference = (front: Buffer, other: Buffer): number => {
      let difference = 0;
      for (let y = 4; y <= 27; y += 1) for (let x = 1; x <= 22; x += 1) {
        const offset = (y * 24 + x) * 4 + 3;
        if (Boolean(front[offset]) !== Boolean(other[offset])) difference += 1;
      }
      return difference;
    };
    for (const spec of FIELD_ACTOR_SPECS) {
      const down = await readAlpha(spec, "down");
      const right = await readAlpha(spec, "right");
      const up = await readAlpha(spec, "up");
      const minimum = STRUCTURAL_DIRECTION_ASSETS.has(spec.assetId) ? 12 : 8;
      expect(maskDifference(down, right), `${spec.assetId} down/right`).toBeGreaterThanOrEqual(minimum);
      expect(maskDifference(down, up), `${spec.assetId} down/up`).toBeGreaterThanOrEqual(minimum);
    }
  });
});
