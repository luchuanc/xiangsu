import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parseArtPackConfig } from "../../scripts/art-pack/ArtPackSchema";
import { FIELD_ACTOR_FRAME_IDS } from "../../scripts/art-source/field-actors/FieldActorDefinitions";

/**
 * 包测试故意维护独立的 18 项验收表，避免“生成器 specs 自己证明自己”。
 * 资源 ID、bundle 和发布路径一旦漂移，必须先更新本表并接受评审。
 */
const EXPECTED_FIELD_ART = [
  { assetId: "sprite_field_char_wanderer", bundleId: "player_common", image: "field/sprite_field_char_wanderer.png", data: "field/sprite_field_char_wanderer.json" },
  { assetId: "sprite_field_char_iron_guard", bundleId: "player_common", image: "field/sprite_field_char_iron_guard.png", data: "field/sprite_field_char_iron_guard.json" },
  { assetId: "sprite_field_char_ember_mage", bundleId: "player_common", image: "field/sprite_field_char_ember_mage.png", data: "field/sprite_field_char_ember_mage.json" },
  { assetId: "sprite_field_char_priest", bundleId: "player_common", image: "field/sprite_field_char_priest.png", data: "field/sprite_field_char_priest.json" },
  { assetId: "sprite_field_char_ranger", bundleId: "player_common", image: "field/sprite_field_char_ranger.png", data: "field/sprite_field_char_ranger.json" },
  { assetId: "sprite_field_char_frost_seer", bundleId: "player_common", image: "field/sprite_field_char_frost_seer.png", data: "field/sprite_field_char_frost_seer.json" },
  { assetId: "sprite_npc_tavern_keeper", bundleId: "town", image: "field/sprite_npc_tavern_keeper.png", data: "field/sprite_npc_tavern_keeper.json" },
  { assetId: "sprite_npc_blacksmith", bundleId: "town", image: "field/sprite_npc_blacksmith.png", data: "field/sprite_npc_blacksmith.json" },
  { assetId: "sprite_npc_skill_mentor", bundleId: "town", image: "field/sprite_npc_skill_mentor.png", data: "field/sprite_npc_skill_mentor.json" },
  { assetId: "sprite_npc_merchant", bundleId: "town", image: "field/sprite_npc_merchant.png", data: "field/sprite_npc_merchant.json" },
  { assetId: "sprite_npc_innkeeper", bundleId: "town", image: "field/sprite_npc_innkeeper.png", data: "field/sprite_npc_innkeeper.json" },
  { assetId: "sprite_npc_cartographer", bundleId: "town", image: "field/sprite_npc_cartographer.png", data: "field/sprite_npc_cartographer.json" },
  { assetId: "sprite_npc_abyss_watcher", bundleId: "town", image: "field/sprite_npc_abyss_watcher.png", data: "field/sprite_npc_abyss_watcher.json" },
  { assetId: "sprite_field_encounter_floor_01_normal_a", bundleId: "floor_01", image: "field/sprite_field_encounter_floor_01_normal_a.png", data: "field/sprite_field_encounter_floor_01_normal_a.json" },
  { assetId: "sprite_field_encounter_floor_01_normal_b", bundleId: "floor_01", image: "field/sprite_field_encounter_floor_01_normal_b.png", data: "field/sprite_field_encounter_floor_01_normal_b.json" },
  { assetId: "sprite_field_encounter_floor_01_normal_c", bundleId: "floor_01", image: "field/sprite_field_encounter_floor_01_normal_c.png", data: "field/sprite_field_encounter_floor_01_normal_c.json" },
  { assetId: "sprite_field_encounter_floor_01_elite_boar", bundleId: "floor_01", image: "field/sprite_field_encounter_floor_01_elite_boar.png", data: "field/sprite_field_encounter_floor_01_elite_boar.json" },
  { assetId: "sprite_field_encounter_floor_01_boss", bundleId: "floor_01", image: "field/sprite_field_encounter_floor_01_boss.png", data: "field/sprite_field_encounter_floor_01_boss.json" },
] as const;

const FIELD_DIRECTION_CONTACT_SHEET_SHA256 = "a853817a1754c5a0375bf805051d11fb8adf00b6cb855ffb8f5b21f0ccd72274";

describe("VIS-002D field art pack", () => {
  it("art-pack 配置声明全部 18 张 field actor sheet", async () => {
    const config = parseArtPackConfig(JSON.parse(await fs.readFile(path.resolve("art/visual/v1/art-pack.json"), "utf8")) as unknown);
    const entries = config.entries.filter((entry) => entry.kind === "fieldActor");
    expect(entries).toHaveLength(EXPECTED_FIELD_ART.length);
    const entriesById = new Map(entries.map((entry) => [entry.assetId, entry]));
    for (const expected of EXPECTED_FIELD_ART) {
      const entry = entriesById.get(expected.assetId);
      expect(entry, expected.assetId).toBeDefined();
      if (!entry) continue;
      expect(entry.bundleId).toBe(expected.bundleId);
      expect(entry.output.image).toBe(expected.image);
      expect(entry.output.data).toBe(expected.data);
      expect(entry.frames.map((frame) => frame.id)).toEqual(FIELD_ACTOR_FRAME_IDS);
      expect(entry.anchor).toEqual({ x: 12, y: 28 });
    }
  });

  it("发布结果为 240x128 的透明 sheet 和同序 atlas", async () => {
    for (const expected of EXPECTED_FIELD_ART) {
      const output = path.resolve("public/assets/visual/v1", expected.image);
      const metadata = await sharp(output).metadata();
      expect(metadata.width).toBe(240);
      expect(metadata.height).toBe(128);
      await expect(fs.access(path.resolve("public/assets/visual/v1", expected.data))).resolves.toBeUndefined();
    }
  });

  it("18 个身份首帧 hash 全唯一且密度处在可辨识范围", async () => {
    const hashes = new Set<string>();
    for (const expected of EXPECTED_FIELD_ART) {
      const file = path.resolve("art/visual/v1/input/field", expected.assetId, "down_idle_00.png");
      const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let opaque = 0;
      for (let index = 3; index < raw.data.length; index += 4) if (raw.data[index] !== 0) opaque += 1;
      expect(opaque).toBeGreaterThanOrEqual(24);
      expect(opaque).toBeLessThanOrEqual(500);
      hashes.add(createHash("sha256").update(raw.data).digest("hex"));
    }
    expect(hashes).toHaveLength(EXPECTED_FIELD_ART.length);
  });

  it("四方向人工复核 contact sheet 由独立 golden hash 锁定", async () => {
    const contactSheet = path.resolve("docs/art-source/review/vis-002d-field-directions-contact-sheet.png");
    const metadata = await sharp(contactSheet).metadata();
    expect(metadata.width).toBe(808);
    expect(metadata.height).toBe(4760);
    expect(createHash("sha256").update(await fs.readFile(contactSheet)).digest("hex")).toBe(FIELD_DIRECTION_CONTACT_SHEET_SHA256);
  });
});
