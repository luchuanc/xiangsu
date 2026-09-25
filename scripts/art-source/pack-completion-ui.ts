/** Editable, native UI glyphs matching the existing brass/navy SVG icon system. */
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { floors06To10AssetManifest } from "../../src/content/data/assets.manifest";

const root = "public/assets/art/completion/v1";
const url = "/assets/art/completion/v1";
await mkdir(`${root}/source/ui`, { recursive: true });
const catalog = JSON.parse(await readFile(`${root}/catalog.json`, "utf8"));
const glyphs: Record<string, string> = {
  sword: "M5 20 19 6V2h-4L2 15m0-4 11 11M3 21l3-3",
  shield: "M12 2 21 6v7c0 5-6 8-9 10-3-2-9-5-9-10V6zM12 6v12",
  flame: "M13 2c2 7 8 8 8 14a9 9 0 0 1-18 0c0-4 3-6 4-9l3 5zM12 14l-2 5 3 2 2-3z",
  drop: "M12 2C10 7 4 11 4 16a8 8 0 0 0 16 0c0-5-6-9-8-14zM7 16l2 3",
  skull: "M4 12V9a8 8 0 0 1 16 0v5l-4 2v5H8v-5H4zM7 9h2v3H7zm8 0h2v3h-2zM11 18v3m3-3v3",
  snow: "M12 2v20M3 7l18 10M3 17 21 7M8 3l4 4 4-4M8 21l4-4 4 4",
  bolt: "M14 1 4 14h7l-1 9 10-14h-7z",
  heart: "M12 21 3 12C-2 4 7-1 12 6c5-7 14-2 9 6z",
  eye: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 8v8M9 12h6",
  arrow: "M12 3 4 11h5v10h6V11h5z",
  boot: "M6 3h9v10l6 3v5H3v-6h3zM7 8h7",
  star: "M12 1 15 8l8 4-8 3-3 8-3-8-8-3 8-4z",
  cross: "M9 2h6v7h7v6h-7v7H9v-7H2V9h7z",
  crown: "M2 6 7 11 12 2l5 9 5-5-3 15H5zM6 17h12",
  chain: "M10 6 7 3 2 8l4 5 3-3m5 8 3 3 5-5-4-5-3 3M8 16 16 8",
  flask: "M8 2h8M9 2v7l-5 9v4h16v-4l-5-9V2M7 15h10",
  gem: "M7 2h10l6 7-11 14L1 9zM1 9h22M7 2l5 21 5-21",
  hourglass: "M5 2h14M5 22h14M7 2v5l5 5-5 5v5m10-20v5l-5 5 5 5v5",
  alert: "M12 1 23 22H1zM12 8v7m0 3v1",
  lock: "M6 10V7a6 6 0 0 1 12 0v3M4 10h16v12H4zM12 14v4",
  chest: "M2 10V6l4-4h12l4 4v16H2zM2 10h20M10 9h4v6h-4z",
  portal: "M6 22V10a6 8 0 0 1 12 0v12M2 22h20M12 7v9m-3-3 3 3 3-3",
  coin: "M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20M12 6v12M8 8h7l-6 8h7",
  close: "M5 5 19 19M5 19 19 5", back: "M14 4 6 12l8 8M6 12h16",
  menu: "M3 5h18M3 12h18M3 19h18", target: "M2 8V2h6m8 0h6v6m0 8v6h-6m-8 0H2v-6M12 8v8M8 12h8",
};
const statusGlyphs: Record<string, [string, string]> = {
  bleed: ["drop", "#ed738b"], burn: ["flame", "#ff9b58"], poison: ["skull", "#a4db71"], slow: ["hourglass", "#b9a9da"], freeze: ["snow", "#91d9ff"], stun: ["star", "#ffe199"], taunt: ["alert", "#ed8d74"], guard_30: ["shield", "#d3b879"], shield: ["shield", "#75d5df"], marked: ["target", "#e994ac"], haste: ["boot", "#b0e0ad"], attack_up: ["sword", "#f3b881"], defense_up: ["shield", "#aecbea"], fear: ["eye", "#b9a0ed"], shock: ["bolt", "#ffe17f"], boss_phase_2: ["crown", "#dfa27d"], boss_phase_3: ["crown", "#c49aff"], boss_enrage: ["flame", "#ff6684"],
};
const comboGlyphs: Record<string, string> = {
  ember_chain: "flame", iron_reprise: "sword", blood_hunt: "drop", holy_bulwark: "shield", venom_bloom: "skull", frozen_verdict: "snow", storm_circuit: "bolt", execution_cadence: "sword", steadfast_aegis: "shield", swift_formation: "boot", perfect_strike: "target", dark_covenant: "eye", cleansing_light: "cross", front_fortress: "shield", backline_barrage: "arrow", triune_elements: "gem", ultimate_resonance: "star", abyss_dominion: "crown",
};
function svg(path: string, color = "#dbbd7d", extra = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="5" fill="#101d2b" stroke="#435369"/><g transform="translate(6 6) scale(.8333)" fill="none" stroke="${color}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="${path}"/>${extra}</g></svg>`;
}
for (const entry of floors06To10AssetManifest.assets) {
  if (entry.kind !== "singleFrame" || entry.id.startsWith("sprite_eq_")) continue;
  let glyph: string, color = "#dfbd7a", extra = "";
  if (entry.id.startsWith("icon_status_")) [glyph, color] = statusGlyphs[entry.id.slice(12)]!;
  else if (entry.id.startsWith("icon_combo_")) {
    const key = entry.id.slice(11); glyph = comboGlyphs[key]!;
    const index = Object.keys(comboGlyphs).indexOf(key);
    color = ["#e99a74", "#83cfd5", "#bdabeb", "#e2c885"][index % 4]!;
    extra = `<path d="M1 1h${2 + Math.floor(index / 4)}M20 22h3"/>`;
  } else {
    glyph = entry.id === "icon_item_forge_shard" ? "gem" : entry.id === "icon_item_inscription_dust" ? "star" : "flask";
    color = entry.id.includes("major") ? "#e786b0" : entry.id.includes("cleansing") ? "#83d5d8" : "#dfbd7a";
  }
  if (!glyphs[glyph]) throw new Error(`UI glyph not mapped: ${entry.id}`);
  const source = svg(glyphs[glyph], color, extra);
  await writeFile(`${root}/source/ui/${entry.id}.svg`, source);
  await sharp(Buffer.from(source)).resize(entry.width, entry.height, { kernel: "nearest" }).png().toFile(`${root}/icons/${entry.id}.png`);
  catalog[entry.id] = { src: `${url}/icons/${entry.id}.png`, previewSrc: `${url}/source/ui/${entry.id}.svg` };
}
const entry = floors06To10AssetManifest.assets.find((entry) => entry.id === "atlas_core_ui");
if (!entry || entry.kind !== "atlas") throw new Error("UI atlas contract missing");
const mapping: Record<string, string> = { cursor_target: "target", marker_interact: "star", marker_alert: "alert", marker_boss: "crown", marker_elite: "gem", object_chest_closed: "chest", object_portal_floor: "portal", object_portal_return: "back", icon_gold: "coin", icon_energy: "bolt", icon_hp: "heart", icon_attack: "sword", icon_defense: "shield", icon_speed: "boot", icon_critical: "target", icon_close: "close", icon_back: "back", icon_menu: "menu", icon_warning: "alert", slot_locked: "lock" };
const frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = {};
const layers: sharp.OverlayOptions[] = [];
for (const [i, name] of entry.requiredFrames.entries()) {
  const color = ({ quality_common: "#b8c0c6", quality_magic: "#75bcdf", quality_rare: "#dfbd7a", quality_epic: "#bc95e9", quality_abyss: "#e86c87", button_disabled_9s: "#465365", button_pressed_9s: "#68bdbb" } as Record<string, string>)[name] ?? "#bca16f";
  const source = mapping[name] ? svg(glyphs[mapping[name]!]!, color) : `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="1" y="1" width="30" height="30" rx="3" fill="#101d2b" stroke="${color}"/><path d="M4 9V4h5m14 0h5v5m0 14v5h-5M9 28H4v-5" fill="none" stroke="${color}"/></svg>`;
  await writeFile(`${root}/source/ui/${name}.svg`, source);
  const x = i % 8 * 32, y = Math.floor(i / 8) * 32;
  const w = name.startsWith("marker_") ? 16 : name.startsWith("object_") ? 24 : 32;
  const h = name.startsWith("marker_") ? 16 : 32;
  layers.push({ input: await sharp(Buffer.from(source)).resize(w, h, { kernel: "nearest" }).png().toBuffer(), left: x, top: y });
  frames[name] = { frame: { x, y, w, h } };
}
await sharp({ create: { width: 256, height: 128, channels: 4, background: "#00000000" } }).composite(layers).png().toFile(`${root}/atlases/core-ui.png`);
await writeFile(`${root}/atlases/core-ui.json`, JSON.stringify({ frames, meta: { image: "core-ui.png", size: { w: 256, h: 128 }, scale: "1" } }));
catalog.atlas_core_ui = { src: `${url}/atlases/core-ui.png`, dataSrc: `${url}/atlases/core-ui.json` };
await writeFile(`${root}/catalog.json`, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Packed UI: ${entry.requiredFrames.length} atlas frames; catalog ${Object.keys(catalog).length} entries.`);
