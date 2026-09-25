/** Packs reviewed AI source atlases. Reproducible slicing only; never regenerates source art. */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { floors06To10AssetManifest } from "../../src/content/data/assets.manifest";
import { EQUIPMENT_BASE_DEFINITIONS } from "../../src/content/data/equipment";
import { ENCOUNTER_DEFINITIONS } from "../../src/content/data/encounters";
import { ENEMY_DEFINITIONS } from "../../src/content/data/enemies";

const root = "public/assets/art/completion/v1";
const url = "/assets/art/completion/v1";
type RecordEntry = { src: string; previewSrc?: string; dataSrc?: string };
const catalog: Record<string, RecordEntry> = {};
for (const dir of ["icons", "portraits", "battle", "field", "atlases"]) await mkdir(`${root}/${dir}`, { recursive: true });
const blank = (width: number, height: number) => sharp({ create: { width, height, channels: 4, background: "#00000000" } });
type Crop = readonly [number, number, number, number];
async function cut(file: string, crop: Crop): Promise<Buffer> {
  const [left, top, width, height] = crop;
  return sharp(file).extract({ left, top, width, height }).png().toBuffer();
}
async function fit(input: Buffer, size: number): Promise<Buffer> {
  return sharp(input).trim({ threshold: 12 }).resize(size, size, { fit: "contain", background: "#00000000", kernel: "nearest" }).png().toBuffer();
}
/** Exclude tiny neighbour fragments clipped by a cell boundary. Complete interior
 * islands, including spores and floating crystals, remain in the extracted sprite. */
async function isolateCell(input: Buffer, neighbourRatio = 0.035): Promise<Buffer> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const visited = new Uint8Array(width * height);
  const components: { pixels: number[]; edge: boolean }[] = [];
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || data[start * 4 + 3]! <= 16) continue;
    const pixels = [start]; visited[start] = 1; let edge = false;
    for (let cursor = 0; cursor < pixels.length; cursor++) {
      const point = pixels[cursor]!, x = point % width, y = Math.floor(point / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited[next] || data[next * 4 + 3]! <= 16) continue;
        visited[next] = 1; pixels.push(next);
      }
    }
    components.push({ pixels, edge });
  }
  const largest = Math.max(0, ...components.map((component) => component.pixels.length));
  for (const component of components) if (component.edge && component.pixels.length < largest * neighbourRatio) {
    for (const point of component.pixels) data[point * 4 + 3] = 0;
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
for (const [i, base] of EQUIPMENT_BASE_DEFINITIONS.entries()) {
  const x = Math.round(i % 10 * 1536 / 10), y = Math.round(Math.floor(i / 10) * 1024 / 6);
  const raw = await cut(`${root}/source/equipment.png`, [x, y, Math.round((i % 10 + 1) * 1536 / 10) - x, Math.round((Math.floor(i / 10) + 1) * 1024 / 6) - y]);
  await sharp(await fit(raw, 96)).toFile(`${root}/icons/${base.spriteId}-hd.png`);
  await sharp(await fit(raw, 24)).toFile(`${root}/icons/${base.spriteId}.png`);
  catalog[base.spriteId] = { src: `${url}/icons/${base.spriteId}.png`, previewSrc: `${url}/icons/${base.spriteId}-hd.png` };
}

// AI sheets have unequal subject extents. These rectangles were inspected individually.
const mid: readonly (readonly [string, Crop])[] = [
  ["enemy_sporeling", [0, 0, 280, 350]], ["enemy_venom_spider", [283, 90, 274, 258]],
  ["enemy_fungal_guardian", [575, 0, 310, 350]], ["boss_brood_spider", [890, 60, 340, 290]],
  ["enemy_cave_bat", [1230, 20, 306, 330]], ["enemy_ore_golem", [0, 350, 310, 300]],
  ["enemy_bomb_goblin", [330, 360, 220, 290]], ["boss_iron_devourer", [565, 350, 390, 300]],
  ["enemy_bog_leech", [960, 420, 310, 235]], ["enemy_mist_wraith", [1230, 350, 306, 319]],
  ["boss_bog_witch", [0, 650, 316, 374]], ["enemy_ember_hound", [316, 680, 344, 344]],
  ["enemy_ash_cultist", [670, 670, 235, 354]], ["boss_ember_guardian", [910, 654, 355, 370]],
  ["char_frost_seer", [1265, 670, 271, 354]],
];
const deep: readonly (readonly [string, Crop])[] = [
  ["enemy_abyss_mauler", [0, 0, 307, 339]], ["enemy_dread_eye", [307, 0, 254, 339]],
  ["boss_abyss_butcher", [561, 0, 390, 339]], ["enemy_blood_ghoul", [964, 0, 300, 339]],
  ["enemy_crimson_acolyte", [1267, 0, 269, 339]], ["boss_crimson_knight", [0, 340, 312, 331]],
  ["enemy_frost_warden", [328, 340, 290, 331]], ["enemy_ice_revenant", [621, 340, 313, 331]],
  ["boss_pale_jailer", [941, 340, 322, 331]], ["enemy_void_spark", [1270, 340, 266, 331]],
  ["enemy_watcher_shard", [0, 672, 237, 352]], ["boss_thousand_eye", [239, 672, 341, 352]],
  ["enemy_throne_knight", [550, 672, 330, 352]], ["enemy_abyss_herald", [873, 672, 265, 352]],
  ["boss_abyss_king", [1110, 672, 426, 352]],
];
const actorInputs = new Map<string, Buffer>();
for (const [sheet, entries] of [["monstersMidClean", mid], ["monstersDeepClean", deep]] as const) {
  for (const [id, crop] of entries) actorInputs.set(id, await isolateCell(await cut(`${root}/source/${sheet}.png`, crop), id === "boss_abyss_king" ? 0.15 : 0.035));
}
actorInputs.set("char_ranger", await cut("public/assets/art/battle-premium/v1/forest-roster.png", [0, 180, 540, 544]));

// Affine sprite motion: breathe / lunge / channel / recoil / fall. Not hand-drawn poses.
for (const [id, input] of actorInputs) {
  const assetId = `sprite_battle_${id}`;
  const entry = floors06To10AssetManifest.assets.find((asset) => asset.id === assetId);
  if (!entry || entry.kind !== "battleActorSheet") throw new Error(`Missing battle contract: ${assetId}`);
  const size = entry.frameWidth;
  const art = await fit(input, size - 12);
  const frames: sharp.OverlayOptions[] = [];
  for (let frame = 0; frame < 27; frame++) {
    const idle = frame < 4, attack = frame >= 4 && frame < 10, skill = frame >= 10 && frame < 18, hit = frame >= 18 && frame < 21;
    const t = idle ? frame / 4 : attack ? (frame - 4) / 6 : skill ? (frame - 10) / 8 : hit ? (frame - 18) / 3 : (frame - 21) / 5;
    const h = Math.max(8, Math.round((size - 12) * (idle ? 1 - Math.sin(t * Math.PI * 2) * 0.04 : attack ? 1 - Math.sin(t * Math.PI) * 0.12 : skill ? 1 - Math.sin(t * Math.PI) * 0.06 : hit ? 0.88 + t * 0.1 : 1 - t * 0.72)));
    const w = size - 12;
    const dx = attack ? Math.round(Math.sin(t * Math.PI) * (id.startsWith("char_") ? 4 : -4)) : hit ? Math.round(t * 3) : 0;
    const image = await sharp(art).resize(w, h, { fit: "fill", kernel: "nearest" }).png().toBuffer();
    frames.push({ input: image, left: frame * size + 6 + dx, top: size - 6 - h });
  }
  await blank(size * 27, size).composite(frames).png().toFile(`${root}/battle/${assetId}.png`);
  await sharp(await fit(input, 160)).toFile(`${root}/portraits/${assetId}.png`);
  catalog[assetId] = { src: `${url}/battle/${assetId}.png`, previewSrc: `${url}/portraits/${assetId}.png` };
}
for (const encounter of ENCOUNTER_DEFINITIONS) {
  const entry = floors06To10AssetManifest.assets.find((asset) => asset.id === encounter.fieldSpriteId);
  if (!entry || entry.kind !== "fieldActorSheet" || encounter.id.startsWith("encounter_floor_01_")) continue;
  const candidates = encounter.enemyIdsBySlot.filter((id): id is string => id !== null && actorInputs.has(id));
  if (encounter.kind !== "normal") candidates.sort((a, b) => (ENEMY_DEFINITIONS.find((enemy) => enemy.id === b)?.stats.maxHp ?? 0) - (ENEMY_DEFINITIONS.find((enemy) => enemy.id === a)?.stats.maxHp ?? 0));
  const enemyId = candidates[0];
  if (!enemyId) throw new Error(`Missing encounter art: ${encounter.id}`);
  const art = await fit(actorInputs.get(enemyId)!, 22);
  const frames: sharp.OverlayOptions[] = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 10; col++) {
    const h = 22 - (col % 3);
    let sprite = sharp(art).resize(22, h, { fit: "fill", kernel: "nearest" });
    if (row === 2) sprite = sprite.flop();
    if (row === 3) sprite = sprite.modulate({ brightness: 0.8 });
    frames.push({ input: await sprite.png().toBuffer(), left: col * 24 + 1, top: row * 32 + 28 - h });
  }
  await blank(240, 128).composite(frames).png().toFile(`${root}/field/${entry.id}.png`);
  catalog[entry.id] = { src: `${url}/field/${entry.id}.png` };
}

const fxEntry = floors06To10AssetManifest.assets.find((entry) => entry.id === "atlas_battle_fx");
if (!fxEntry || fxEntry.kind !== "atlas") throw new Error("Missing FX contract");
const fxFrames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = {};
const fxInputs: sharp.OverlayOptions[] = [];
const elements = ["physical", "fire", "frost", "lightning", "holy", "dark", "poison", "true"];
const rows = [0, 1, 2, 3, 4, 7, 6, 0];
const rawFrames: Buffer[][] = [];
// Row spacing in the generated source is optical, not exactly 128px. Crop the
// reviewed row gutters so sparks from a neighbouring effect never leak in.
const effectRows = [[0, 112], [113, 131], [245, 121], [367, 126], [494, 114], [609, 121], [731, 127], [859, 165]] as const;
for (let row = 0; row < 8; row++) {
  rawFrames[row] = [];
  for (let col = 0; col < 8; col++) rawFrames[row]!.push(await cut(`${root}/source/effects.png`, [col * 192, effectRows[row]![0], 192, effectRows[row]![1]]));
}
const frames = [...fxEntry.requiredFrames];
// Additional element-specific animations retain the original 46 required frame names.
for (const element of elements) for (let i = 0; i < 8; i++) frames.push(`fx_element_${element}_${String(i).padStart(2, "0")}`);
for (const [index, name] of frames.entries()) {
  let row = 0, col = Number(name.slice(-2)) || 0;
  if (name.startsWith("fx_projectile_")) { row = rows[elements.indexOf(name.slice(14))] ?? 0; col = 2; }
  else if (name.startsWith("fx_element_")) row = rows[elements.indexOf(name.slice(11, -3))] ?? 0;
  else if (name.startsWith("fx_area_")) row = 1;
  else if (name.startsWith("fx_heal_")) row = 4;
  else if (name.startsWith("fx_shield_")) row = 5;
  else if (name.startsWith("fx_status_")) row = 6;
  else if (name.startsWith("fx_summon_")) row = 7;
  if (/^fx_(slash|heal|shield)_/.test(name)) col = [0, 1, 3, 4, 6, 7][col]!;
  if (name.startsWith("fx_status_")) col = [0, 3, 5, 7][col]!;
  const x = index % 10 * 64, y = Math.floor(index / 10) * 64;
  const size = name.startsWith("fx_element_") ? 64 : 32;
  // Preserve the original frame canvas so the animation stays registered.
  const image = await sharp(rawFrames[row]![col]!).resize(size, size, { fit: "contain", kernel: "nearest", background: "#00000000" }).png().toBuffer();
  fxInputs.push({ input: image, left: x, top: y }); fxFrames[name] = { frame: { x, y, w: size, h: size } };
}
const fxHeight = Math.ceil(frames.length / 10) * 64;
await blank(640, fxHeight).composite(fxInputs).png().toFile(`${root}/atlases/battle-fx.png`);
const fxMeta = { image: "battle-fx.png", size: { w: 640, h: fxHeight }, scale: "1" };
await writeFile(`${root}/atlases/battle-fx.json`, JSON.stringify({ frames: Object.fromEntries(fxEntry.requiredFrames.map((name) => [name, fxFrames[name]])), meta: fxMeta }));
await writeFile(`${root}/atlases/extended-fx.json`, JSON.stringify({ frames: fxFrames, meta: fxMeta }));
catalog.atlas_battle_fx = { src: `${url}/atlases/battle-fx.png`, dataSrc: `${url}/atlases/battle-fx.json` };
for (const [i, name] of ["melee", "fire", "frost", "lightning", "heal", "shield", "status", "summon"].entries()) {
  await sharp(await fit(rawFrames[i]![4]!, 64)).toFile(`${root}/icons/skill-${name}.png`);
}

await writeFile(`${root}/catalog.json`, JSON.stringify(catalog, null, 2) + "\n");
// Expose the already-shipped premium roster in the review gallery as well.
const portraits: Record<string, string> = Object.fromEntries(Object.entries(catalog).filter(([id]) => id.startsWith("sprite_battle_")).map(([id, art]) => [id, art.previewSrc!]));
const legacyIds = ["char_wanderer", "char_iron_guard", "char_ember_mage", "char_priest", "enemy_grass_slime", "enemy_thorn_rat", "enemy_fang_wolf", "enemy_goblin_scout"];
for (const [index, id] of legacyIds.entries()) {
  const raw = await isolateCell(await cut("public/assets/art/battle-premium/v1/roster.png", [index % 4 * 384, Math.floor(index / 4) * 512, 384, 512]));
  await sharp(await fit(raw, 160)).toFile(`${root}/portraits/sprite_battle_${id}.png`);
  portraits[`sprite_battle_${id}`] = `${url}/portraits/sprite_battle_${id}.png`;
}
for (const [id, crop] of [["enemy_stonehide_boar", [680, 220, 770, 504]], ["boss_horned_king", [1500, 0, 672, 724]]] as const) {
  const raw = await cut("public/assets/art/battle-premium/v1/forest-roster.png", crop);
  await sharp(await fit(raw, 160)).toFile(`${root}/portraits/sprite_battle_${id}.png`);
  portraits[`sprite_battle_${id}`] = `${url}/portraits/sprite_battle_${id}.png`;
}
await writeFile(`${root}/portraits.json`, JSON.stringify(portraits, null, 2));
console.log(`Packed ${EQUIPMENT_BASE_DEFINITIONS.length} equipment, ${actorInputs.size} actors, ${frames.length} FX frames; catalog ${Object.keys(catalog).length} entries.`);
