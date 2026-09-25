import { describe, expect, it } from "vitest";
import {
  ART_PACK_SCHEMA_VERSION,
  artPackConfigSchema,
  parseArtPackConfig,
  type ArtPackConfigV1,
  type FieldActorPackEntryV1,
} from "../../scripts/art-pack/ArtPackSchema";

const source = {
  sourceKind: "generated" as const,
  sourceNote: "schema test fixture",
  licenseId: "generated-fixture",
  licenseFile: null,
};

function makeImage(overrides: Record<string, unknown> = {}) {
  return {
    kind: "image" as const,
    assetId: "image_logo",
    bundleId: "boot",
    input: "images/logo.png",
    output: "ui/logo.png",
    width: 2,
    height: 2,
    source,
    ...overrides,
  };
}

function makeField(overrides: Partial<FieldActorPackEntryV1> = {}): FieldActorPackEntryV1 {
  const directions = ["down", "left", "right", "up"] as const;
  const frames = directions.flatMap((direction) => [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `${direction}_idle_${String(index).padStart(2, "0")}`,
      input: `field/hero/${direction}-idle${String(index).padStart(2, "0")}.png`,
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `${direction}_walk_${String(index).padStart(2, "0")}`,
      input: `field/hero/${direction}-walk${String(index).padStart(2, "0")}.png`,
    })),
  ]);
  return {
    kind: "fieldActor",
    assetId: "actor_hero",
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

function makeBattle(overrides: Record<string, unknown> = {}) {
  const frames = ["idle", "attack", "skill", "hit", "down"].flatMap((clip) => {
    const count = clip === "idle" ? 4 : clip === "attack" ? 6 : clip === "skill" ? 8 : clip === "hit" ? 3 : 6;
    return Array.from({ length: count }, (_, index) => ({
      id: `${clip}_${String(index).padStart(2, "0")}`,
      input: `battle/hero/${clip}${String(index).padStart(2, "0")}.png`,
    }));
  });
  return {
    kind: "battleActor" as const,
    assetId: "actor_battle_hero",
    bundleId: "player_common",
    boss: false,
    frameWidth: 48,
    frameHeight: 48,
    columns: 27,
    rows: 1,
    frames,
    output: { image: "battle/hero.png", data: "battle/hero.json" },
    anchor: { x: 24, y: 42 },
    source,
    ...overrides,
  };
}

function makeSingleFrame(overrides: Record<string, unknown> = {}) {
  return {
    kind: "singleFrame" as const,
    assetId: "sprite_eq_sword_t1_windblade",
    bundleId: "core_ui",
    input: "icons/sword.png",
    output: "ui/sword.png",
    width: 24,
    height: 24,
    source,
    ...overrides,
  };
}

function makeMapTileset(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function makeAtlas(overrides: Record<string, unknown> = {}) {
  return {
    kind: "atlas" as const,
    assetId: "atlas_test",
    bundleId: "core_ui",
    imageOutput: "atlas/ui.png",
    dataOutput: "atlas/ui.json",
    width: 2,
    height: 2,
    frames: [{ id: "frame_a", input: "atlas/ui.png", x: 0, y: 0, width: 2, height: 2 }],
    requiredFrames: ["frame_a"],
    source,
    ...overrides,
  };
}

function makeBitmapFont(overrides: Record<string, unknown> = {}) {
  return {
    kind: "bitmapFont" as const,
    assetId: "font_test",
    bundleId: "boot",
    imageInput: "fonts/ui.png",
    descriptorInput: "fonts/ui.fnt",
    imageOutput: "fonts/ui.png",
    descriptorOutput: "fonts/ui.fnt",
    width: 2,
    height: 2,
    glyphHeight: 16,
    source,
    ...overrides,
  };
}

function makeConfig(entries: readonly unknown[] = []): ArtPackConfigV1 {
  return {
    schemaVersion: ART_PACK_SCHEMA_VERSION,
    packId: "visual-v1",
    inputRoot: "art/visual/v1/input",
    outputRoot: "public/assets/visual/v1",
    paletteId: "frontier-night-32-v1",
    alphaMode: "threshold-128",
    entries: entries as ArtPackConfigV1["entries"],
  };
}

describe("art-pack schema", () => {
  it("accepts the empty production configuration exactly", () => {
    const config = makeConfig();
    expect(artPackConfigSchema.parse(config)).toEqual(config);
    expect(parseArtPackConfig(config)).toEqual(config);
  });

  it("rejects unknown fields through strict schemas", () => {
    expect(() => parseArtPackConfig({ ...makeConfig(), unexpected: true })).toThrow("ART_PACK_SCHEMA_INVALID");
    expect(() => parseArtPackConfig({ ...makeConfig([makeImage()]), entries: [{ ...makeImage(), extra: true }] })).toThrow("ART_PACK_SCHEMA_INVALID");
  });

  it("rejects path escape, URL, backslash, and data URI paths", () => {
    for (const input of ["../escape.png", "/absolute.png", "https://example.test/x.png", "file:/tmp/x.png", "mailto:x@example.test", "images\\x.png", "data:image/png;base64,abc", "DATA:image/png;base64,abc"]) {
      expect(() => parseArtPackConfig(makeConfig([makeImage({ input })]))).toThrow("ART_PACK_PATH_INVALID");
    }
  });

  it("rejects duplicate asset IDs and output paths", () => {
    expect(() => parseArtPackConfig(makeConfig([makeImage(), makeImage({ output: "ui/other.png" })]))).toThrow("ART_PACK_DUPLICATE_ASSET");
    expect(() => parseArtPackConfig(makeConfig([makeImage(), makeImage({ assetId: "image_other" })]))).toThrow("ART_PACK_DUPLICATE_OUTPUT");
  });

  it("separates input paths from output paths when their relative names match", () => {
    const field = makeField({
      frames: makeField().frames.map((frame, index) => index === 0 ? { ...frame, input: "field/hero.png" } : frame),
      output: { image: "field/hero.png", data: "field/hero.json" },
    });
    const battle = makeBattle({
      frames: makeBattle().frames.map((frame, index) => index === 0 ? { ...frame, input: "battle/hero.png" } : frame),
      output: { image: "battle/hero.png", data: "battle/hero.json" },
    });
    const entries = [
      makeImage({ input: "same/logo.png", output: "same/logo.png" }),
      makeSingleFrame({ input: "same/sword.png", output: "same/sword.png" }),
      makeMapTileset(),
      field,
      battle,
      makeAtlas(),
      makeBitmapFont(),
    ];
    for (const entry of entries) expect(parseArtPackConfig(makeConfig([entry]))).toMatchObject({ entries: [entry] });
  });

  it("rejects only formal output collisions, including two outputs in one entry", () => {
    const sameInputDifferentOutput = makeImage({ assetId: "image_other", input: "ui/logo.png", output: "ui/other.png" });
    expect(parseArtPackConfig(makeConfig([makeImage(), sameInputDifferentOutput])).entries).toHaveLength(2);
    expect(() => parseArtPackConfig(makeConfig([makeImage(), makeImage({ assetId: "image_other", input: "images/other.png", output: "ui/logo.png" })]))).toThrow("ART_PACK_DUPLICATE_OUTPUT");
    expect(() => parseArtPackConfig(makeConfig([makeField({ output: { image: "field/same.png", data: "field/same.png" } })]))).toThrow("ART_PACK_DUPLICATE_OUTPUT");
    expect(() => parseArtPackConfig(makeConfig([makeBattle({ output: { image: "battle/same.png", data: "battle/same.png" } })]))).toThrow("ART_PACK_DUPLICATE_OUTPUT");
    expect(() => parseArtPackConfig(makeConfig([makeAtlas({ imageOutput: "atlas/same.png", dataOutput: "atlas/same.png" })]))).toThrow("ART_PACK_DUPLICATE_OUTPUT");
    expect(() => parseArtPackConfig(makeConfig([makeBitmapFont({ imageOutput: "fonts/same.png", descriptorOutput: "fonts/same.png" })]))).toThrow("ART_PACK_DUPLICATE_OUTPUT");
  });

  it("rejects audio entries and non-contract palette/alpha", () => {
    expect(() => parseArtPackConfig(makeConfig([{ ...makeImage(), kind: "audio" }]))).toThrow("ART_PACK_SCHEMA_INVALID");
    expect(() => parseArtPackConfig({ ...makeConfig(), paletteId: "other-32" })).toThrow("ART_PACK_SCHEMA_INVALID");
    expect(() => parseArtPackConfig({ ...makeConfig(), alphaMode: "preserve" })).toThrow("ART_PACK_SCHEMA_INVALID");
  });

  it("enforces field actor frame count/order and fixed anchor", () => {
    expect(parseArtPackConfig(makeConfig([makeField()])).entries).toHaveLength(1);
    expect(() => parseArtPackConfig(makeConfig([makeField({ anchor: { x: 11, y: 28 } })]))).toThrow("ART_PACK_ANCHOR_INVALID");
    expect(() => parseArtPackConfig(makeConfig([makeField({ frames: makeField().frames.slice(1) })]))).toThrow("ART_PACK_FRAME_SET_INVALID");
  });

  it("requires a license file only for licensed sources", () => {
    expect(() => parseArtPackConfig(makeConfig([makeImage({ source: { ...source, sourceKind: "licensed", licenseId: "cc0", licenseFile: null } })]))).toThrow("ART_PACK_LICENSE_INVALID");
    expect(() => parseArtPackConfig(makeConfig([makeImage({ source: { ...source, licenseId: "unknown" } })]))).toThrow("ART_PACK_LICENSE_INVALID");
    expect(parseArtPackConfig(makeConfig([makeImage({ source: { ...source, sourceKind: "licensed", licenseId: "cc0", licenseFile: "licenses/cc0.txt" } })]))).toBeTruthy();
  });
});
