import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { floors06To10AssetManifest } from "../../src/content/data/assets.manifest";
import { COMPLETION_ART } from "../../src/content/data/completion-art";
import { EQUIPMENT_BASE_DEFINITIONS } from "../../src/content/data/equipment";
import { ENEMY_DEFINITIONS } from "../../src/content/data/enemies";
import { CHARACTER_DEFINITIONS } from "../../src/content/data/characters";
import { FROZEN_BATCH_MANIFESTS } from "../../src/content/Catalog";
import { ANIMATION_DEFINITIONS } from "../../src/content/data/animations";
import { ENCOUNTER_DEFINITIONS } from "../../src/content/data/encounters";
import { STATUS_DEFINITIONS } from "../../src/content/data/statuses";
import { COMBO_DEFINITIONS } from "../../src/content/data/combos";
import { battleEffectFrames, skillIconUrl } from "../../src/ui/rendering/BattleEffectArt";
import { zhCN } from "../../src/content/locales/zh-CN";
import { validateAssets } from "../validate-assets";

const root = "public/assets/art/completion/v1";
const entries = new Map(floors06To10AssetManifest.assets.map((entry) => [entry.id, entry]));
const issues: string[] = [];
const groups = {
  equipment: EQUIPMENT_BASE_DEFINITIONS.map((entry) => entry.spriteId),
  enemies: ENEMY_DEFINITIONS.map((entry) => entry.spriteId),
  characters: CHARACTER_DEFINITIONS.map((entry) => entry.battleSpriteId),
  encounters: ENCOUNTER_DEFINITIONS.map((entry) => entry.fieldSpriteId),
  statuses: STATUS_DEFINITIONS.map((entry) => entry.iconId),
  combos: COMBO_DEFINITIONS.map((entry) => entry.iconId),
};
for (const [group, ids] of Object.entries(groups)) for (const id of ids) {
  const entry = entries.get(id);
  if (!entry) issues.push(`${group}: missing asset ${id}`);
  else if (entry.source.licenseId.includes("placeholder")) issues.push(`${group}: placeholder ${id}`);
}
const hashes = new Map<string, string>();
for (const [id, art] of Object.entries(COMPLETION_ART)) {
  for (const src of [art.src, art.previewSrc, art.dataSrc]) if (src && !existsSync(`public${src}`)) issues.push(`Missing file: ${src}`);
  if (!art.src.endsWith(".png")) continue;
  const { data, info } = await sharp(`public${art.src}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0, transparent = 0;
  for (let i = 3; i < data.length; i += 4) { if (data[i]! > 32) visible++; if (data[i] === 0) transparent++; }
  if (visible < 8) issues.push(`Empty image: ${id}`);
  if (!transparent) issues.push(`Missing alpha: ${id}`);
  if (id.startsWith("sprite_eq_") || id.startsWith("sprite_battle_")) {
    const hash = createHash("sha256").update(data).digest("hex");
    if (hashes.has(hash)) issues.push(`Duplicate art: ${id} = ${hashes.get(hash)}`);
    hashes.set(hash, id);
  }
  if (info.channels !== 4) issues.push(`Invalid channel count: ${id}`);
}
const fx = JSON.parse(await readFile(`${root}/atlases/extended-fx.json`, "utf8"));
const animations = new Map(ANIMATION_DEFINITIONS.map((animation) => [animation.id, animation]));
let passive = 0;
const skillIds = FROZEN_BATCH_MANIFESTS.floors06_10.skills;
for (const skillId of skillIds) {
  const animation = animations.get(`anim_${skillId}`);
  if (!animation) { issues.push(`No animation: ${skillId}`); continue; }
  if (animation.presetId === "passive") passive++;
  for (const frame of battleEffectFrames(animation.presetId, animation.element)) if (!fx.frames[frame]) issues.push(`Missing skill frame: ${skillId}/${frame}`);
  if (!existsSync(`public${skillIconUrl(skillId)}`)) issues.push(`No skill icon: ${skillId}`);
}
const validation = validateAssets(["--final"]);
if (!validation.ok) issues.push(validation.message);
const report = {
  counts: Object.fromEntries(Object.entries(groups).map(([group, ids]) => [group, ids.length])),
  skills: { total: skillIds.length, animated: skillIds.length - passive, passive, note: "Passive effects have icons but no cast animation. Active skills share preset and element families." },
  newAssets: Object.keys(COMPLETION_ART).length, effectFrames: Object.keys(fx.frames).length,
  uiFrames: 30, issues,
  limitations: ["New monster action sheets use affine motion of generated poses, not hand-drawn articulation.", "Later-floor field markers use directional flips and shading, not distinct four-view drawings.", "Map tiles and audio were not replaced in this asset pass."],
};
await writeFile(`${root}/coverage.json`, JSON.stringify(report, null, 2) + "\n");
const labels = zhCN as Record<string, string>;
const names = new Map([
  ...EQUIPMENT_BASE_DEFINITIONS.map((entry) => [entry.spriteId, labels[entry.nameKey] ?? entry.id] as const),
  ...ENEMY_DEFINITIONS.map((entry) => [entry.spriteId, labels[entry.nameKey] ?? entry.id] as const),
  ...CHARACTER_DEFINITIONS.map((entry) => [entry.battleSpriteId, labels[entry.nameKey] ?? entry.id] as const),
  ...STATUS_DEFINITIONS.map((entry) => [entry.iconId, labels[entry.nameKey] ?? entry.id] as const),
  ...COMBO_DEFINITIONS.map((entry) => [entry.iconId, labels[entry.nameKey] ?? entry.id] as const),
]);
const portraits: Record<string, string> = JSON.parse(await readFile(`${root}/portraits.json`, "utf8"));
const review = Object.entries(groups).flatMap(([group, ids]) => ids.map((id) => {
  const entry = entries.get(id)!;
  const art = COMPLETION_ART[id];
  const src = portraits[id] ?? art?.previewSrc ?? ("src" in entry ? entry.src : "");
  const frame = !portraits[id] && !art?.previewSrc && (entry.kind === "battleActorSheet" || entry.kind === "fieldActorSheet") ? { width: entry.frameWidth, height: entry.frameHeight, columns: entry.columns, rows: entry.rows } : null;
  return { id, group, name: names.get(id) ?? id, src, frame };
}));
await writeFile(`${root}/review.json`, JSON.stringify(review));
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exitCode = 1;
