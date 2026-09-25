import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { BATTLE_ACTOR_FRAME_IDS, BATTLE_ACTOR_SPECS, type BattleActorPalette, type BattleActorSilhouette, type BattleActorSpec } from "./BattleActorDefinitions";

export interface BattleActorSurface {
  readonly width: 48 | 64;
  readonly height: 48 | 64;
  readonly data: Uint8Array;
}

type Rgba = readonly [number, number, number, number];

interface DrawingContext {
  readonly surface: BattleActorSurface;
  readonly colors: Record<keyof BattleActorPalette, Rgba>;
  readonly spec: BattleActorSpec;
  readonly action: "idle" | "attack" | "skill" | "hit" | "down";
  readonly frameInClip: number;
  readonly mirror: boolean;
  readonly scale: number;
}

const HEX = /^#([0-9A-Fa-f]{6})$/;

function rgb(hex: string): Rgba {
  const match = HEX.exec(hex);
  if (!match) throw new Error(`BATTLE_ART_COLOR_INVALID:${hex}`);
  return [Number.parseInt(match[1]!.slice(0, 2), 16), Number.parseInt(match[1]!.slice(2, 4), 16), Number.parseInt(match[1]!.slice(4, 6), 16), 255];
}

function surface(spec: BattleActorSpec): BattleActorSurface {
  return { width: spec.frameWidth, height: spec.frameHeight, data: new Uint8Array(spec.frameWidth * spec.frameHeight * 4) };
}

function logicalX(context: DrawingContext, x: number): number {
  return context.mirror ? 47 - x : x;
}

function xSpan(context: DrawingContext, x: number): [number, number] {
  const left = Math.floor(logicalX(context, x) * context.scale);
  const right = Math.floor((logicalX(context, x) + 1) * context.scale) - 1;
  return [Math.min(left, right), Math.max(left, right)];
}

function ySpan(context: DrawingContext, y: number): [number, number] {
  const anchor = context.spec.boss ? 58 : 42;
  const left = Math.floor(anchor + (y - 42) * context.scale);
  const right = Math.floor(anchor + (y + 1 - 42) * context.scale) - 1;
  return [Math.min(left, right), Math.max(left, right)];
}

function setPixel(context: DrawingContext, x: number, y: number, color: Rgba): void {
  const [left, right] = xSpan(context, x);
  const [top, bottom] = ySpan(context, y);
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      if (column < 0 || column >= context.surface.width || row < 0 || row >= context.surface.height) continue;
      const offset = (row * context.surface.width + column) * 4;
      context.surface.data[offset] = color[0];
      context.surface.data[offset + 1] = color[1];
      context.surface.data[offset + 2] = color[2];
      context.surface.data[offset + 3] = color[3];
    }
  }
}

function rect(context: DrawingContext, x: number, y: number, width: number, height: number, color: Rgba): void {
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) setPixel(context, x + column, y + row, color);
}

function line(context: DrawingContext, x1: number, y1: number, x2: number, y2: number, color: Rgba): void {
  const dx = Math.abs(x2 - x1);
  const sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1);
  const sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  let x = x1;
  let y = y1;
  while (true) {
    setPixel(context, x, y, color);
    if (x === x2 && y === y2) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
}

function motion(context: DrawingContext): { readonly bob: number; readonly shift: number; readonly recoil: number } {
  switch (context.action) {
    case "idle": return { bob: context.frameInClip % 2, shift: 0, recoil: 0 };
    case "attack": return { bob: context.frameInClip === 0 ? 0 : 1, shift: [0, 1, 2, 3, 2, 1][context.frameInClip] ?? 0, recoil: 0 };
    case "skill": return { bob: context.frameInClip % 3 === 0 ? 0 : 1, shift: [0, 0, 1, 2, 3, 3, 2, 1][context.frameInClip] ?? 0, recoil: 0 };
    case "hit": return { bob: context.frameInClip === 1 ? 1 : 0, shift: 0, recoil: context.frameInClip === 1 ? -2 : 0 };
    case "down": return { bob: Math.min(4, context.frameInClip), shift: 0, recoil: 0 };
  }
}

function ground(context: DrawingContext, color: Rgba, shadow: Rgba): void {
  rect(context, 13, 42, 22, 1, color);
  rect(context, 17, 41, 14, 1, shadow);
}

function drawHuman(context: DrawingContext, silhouette: Exclude<BattleActorSilhouette, "grassSlime" | "thornRat" | "fangWolf" | "goblinScout" | "stonehideBoar" | "hornedKing">): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.colors;
  const { bob, shift, recoil } = motion(context);
  const down = context.action === "down";
  const collapse = down ? 7 : 0;
  const y = bob + collapse;
  // 所有局部坐标只描述“朝右”源姿态；敌方仅由 logicalX 整体镜像一次。
  const lean = recoil + shift;
  const x = 24 + lean;
  const bodyLeft = x - 8;
  const headLeft = x - 6;

  if (down) {
    rect(context, bodyLeft - 5, 32 + bob, 19, 7, dark);
    rect(context, bodyLeft - 3, 33 + bob, 15, 4, body);
    rect(context, headLeft - 5, 29 + bob, 8, 5, shadow);
    rect(context, headLeft - 3, 30 + bob, 5, 2, accent);
    rect(context, bodyLeft + 2, 38, 3, 4, dark);
    ground(context, dark, shadow);
    return;
  }

  const robe = silhouette === "priest" || silhouette === "emberMage";
  rect(context, bodyLeft - (robe ? 2 : 0), 17 + y, robe ? 20 : 16, 18, dark);
  rect(context, bodyLeft - (robe ? 1 : 0), 18 + y, robe ? 18 : 14, 15, body);
  rect(context, bodyLeft + 1, 19 + y, robe ? 8 : 7, 2, highlight);
  rect(context, headLeft, 7 + y, 12, 11, dark);
  rect(context, headLeft + 2, 8 + y, 8, 8, silhouette === "emberMage" ? accent : shadow);
  rect(context, headLeft + 4, 11 + y, 4, 4, silhouette === "ironGuard" ? highlight : accentHighlight);
  setPixel(context, headLeft + 7, 12 + y, dark);

  if (silhouette === "ironGuard") {
    rect(context, bodyLeft - 5, 18 + y, 5, 12, dark);
    rect(context, bodyLeft - 4, 19 + y, 3, 9, accent);
    rect(context, bodyLeft + 14, 17 + y, 4, 14, dark);
    rect(context, bodyLeft + 15, 19 + y, 2, 8, accent);
    line(context, bodyLeft + 18, 12 + y, bodyLeft + 18, 35 + y, highlight);
  } else if (silhouette === "wanderer") {
    rect(context, bodyLeft + 15, 14 + y, 3, 17, dark);
    line(context, bodyLeft + 16, 12 + y, bodyLeft + 18, 14 + y, accentHighlight);
    rect(context, bodyLeft - 3, 21 + y, 3, 8, accent);
  } else if (silhouette === "emberMage") {
    rect(context, bodyLeft + 15, 11 + y, 2, 22, dark);
    setPixel(context, bodyLeft + 16, 9 + y, accentHighlight);
    setPixel(context, bodyLeft + 15, 10 + y, highlight);
    setPixel(context, bodyLeft + 17, 10 + y, highlight);
    rect(context, bodyLeft - 3, 22 + y, 3, 7, accent);
  } else if (silhouette === "priest") {
    rect(context, bodyLeft + 16, 12 + y, 2, 21, dark);
    rect(context, bodyLeft + 14, 15 + y, 6, 2, accentHighlight);
    rect(context, bodyLeft + 16, 13 + y, 2, 6, accentHighlight);
    rect(context, bodyLeft - 2, 21 + y, 3, 8, accent);
  }

  const stride = context.action === "attack" || context.action === "skill" ? (context.frameInClip % 2 === 0 ? 1 : -1) : 0;
  rect(context, bodyLeft + 1 + stride, 33 + y, 4, 9 - y, dark);
  rect(context, bodyLeft + 10 - stride, 33 + y, 4, 9 - y, dark);
  rect(context, bodyLeft + 2 + stride, 36 + y, 2, 6 - y, shadow);
  rect(context, bodyLeft + 11 - stride, 36 + y, 2, 6 - y, shadow);
  ground(context, dark, shadow);

  if (context.action === "attack") {
    const handX = bodyLeft + 17;
    line(context, handX, 23 + y, handX + 8, 16 + y, accentHighlight);
    line(context, handX + 8, 16 + y, handX + 10, 14 + y, highlight);
  }
  if (context.action === "skill") {
    const fx = bodyLeft + 20;
    for (const [dx, dy] of [[0, 0], [2, -2], [2, 2], [4, 0]] as const) setPixel(context, fx + dx, 20 + y + dy, accentHighlight);
  }
  if (context.action === "hit" && context.frameInClip === 1) {
    for (const [dx, dy] of [[-11, -3], [-9, 0], [-8, 4], [10, -2], [11, 2]] as const) setPixel(context, x + dx, 23 + dy, accentHighlight);
  }
}

function drawGrassSlime(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.colors;
  const { bob, shift } = motion(context);
  const x = 24 + shift;
  const squash = context.action === "down" ? 4 : context.action === "hit" && context.frameInClip === 1 ? 2 : 0;
  const bodyHeight = Math.max(1, 17 - squash - bob);
  const innerHeight = Math.max(1, 16 - squash - bob);
  rect(context, x - 12, 25 + bob + squash, 24, bodyHeight, dark);
  rect(context, x - 10, 24 + bob + squash, 20, innerHeight, body);
  rect(context, x - 7, 25 + bob + squash, 13, 5, highlight);
  rect(context, x - 7, 33 + bob + squash, 4, Math.max(1, 4 - bob), shadow);
  setPixel(context, x - 4, 30 + bob, dark);
  setPixel(context, x + 5, 30 + bob, dark);
  setPixel(context, x - 4, 29 + bob, accentHighlight);
  setPixel(context, x + 5, 29 + bob, accentHighlight);
  if (context.action === "attack") line(context, x + 10, 34 + bob, x + 18, 31 + bob, accentHighlight);
  if (context.action === "skill") {
    for (const [dx, dy] of [[-16, 4], [-14, 1], [14, -1], [16, 3]] as const) setPixel(context, x + dx, 27 + dy + bob, accent);
  }
  ground(context, dark, shadow);
}

function drawThornRat(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.colors;
  const { bob, shift } = motion(context);
  const x = 24 + shift;
  const y = 27 + bob;
  rect(context, x - 12, y + 5, 24, Math.max(1, 10 - bob), dark);
  rect(context, x - 10, y + 6, 19, Math.max(1, 7 - bob), body);
  rect(context, x - 6, y + 2, 10, 6, shadow);
  rect(context, x - 4, y, 4, 4, accent);
  rect(context, x + 3, y - 1, 4, 5, dark);
  setPixel(context, x + 5, y + 4, accentHighlight);
  line(context, x - 10, y + 11, x - 19, y + 8, accent);
  line(context, x - 19, y + 8, x - 22, y + 4, accent);
  const footY = Math.min(41, y + 12);
  rect(context, x - 6, footY, 3, Math.max(1, 42 - footY), dark);
  rect(context, x + 5, footY, 3, Math.max(1, 42 - footY), dark);
  if (context.action === "attack") line(context, x + 13, y + 7, x + 19, y + 5, accentHighlight);
  if (context.action === "skill") {
    line(context, x + 13, y + 3, x + 17, y - 2, highlight);
    setPixel(context, x + 18, y - 3, accentHighlight);
  }
  ground(context, dark, shadow);
}

function drawFangWolf(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.colors;
  const { bob, shift } = motion(context);
  const x = 24 + shift;
  const y = 20 + bob;
  rect(context, x - 12, y + 8, 23, Math.max(1, 15 - bob), dark);
  rect(context, x - 10, y + 10, 19, Math.max(1, 10 - bob), body);
  rect(context, x - 8, y + 2, 13, 10, dark);
  rect(context, x - 6, y + 4, 9, 6, shadow);
  rect(context, x - 9, y - 2, 5, 7, dark);
  rect(context, x + 3, y - 3, 5, 8, dark);
  rect(context, x - 6, y + 5, 3, 3, accent);
  setPixel(context, x + 3, y + 6, accentHighlight);
  const legY = Math.min(41, y + 20);
  rect(context, x - 5, legY, 4, Math.max(1, 42 - legY), dark);
  rect(context, x + 5, legY, 4, Math.max(1, 42 - legY), dark);
  line(context, x - 11, y + 14, x - 17, y + 10, shadow);
  if (context.action === "attack") line(context, x + 10, y + 12, x + 18, y + 7, accentHighlight);
  if (context.action === "skill") {
    for (const offset of [-2, 0, 2]) line(context, x + 15, y + 7 + offset, x + 19, y + 7 + offset, highlight);
  }
  ground(context, dark, shadow);
}

function drawGoblinScout(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.colors;
  const { bob, shift } = motion(context);
  const x = 24 + shift;
  const y = bob;
  rect(context, x - 7, 17 + y, 14, 17, dark);
  rect(context, x - 5, 19 + y, 10, 12, body);
  rect(context, x - 9, 8 + y, 18, 12, dark);
  rect(context, x - 7, 10 + y, 14, 8, shadow);
  rect(context, x - 12, 10 + y, 6, 4, accent);
  rect(context, x + 6, 10 + y, 6, 4, accent);
  setPixel(context, x + 4, 13 + y, accentHighlight);
  rect(context, x - 10, 20 + y, 4, 8, dark);
  rect(context, x + 6, 20 + y, 4, 8, dark);
  rect(context, x - 6, 32 + y, 4, 10 - y, dark);
  rect(context, x + 3, 32 + y, 4, 10 - y, dark);
  if (context.action === "attack") {
    line(context, x + 11, 23 + y, x + 18, 15 + y, accentHighlight);
    line(context, x + 18, 15 + y, x + 19, 18 + y, highlight);
  }
  if (context.action === "skill") rect(context, x + 13, 7 + y, 3, 3, accentHighlight);
  ground(context, dark, shadow);
}

function drawStonehideBoar(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.colors;
  const { bob, shift } = motion(context);
  const x = 24 + shift;
  const y = 21 + bob;
  rect(context, x - 14, y + 8, 28, Math.max(1, 14 - bob), dark);
  rect(context, x - 12, y + 10, 24, Math.max(1, 9 - bob), body);
  rect(context, x - 14, y + 12, 7, Math.max(1, 7 - bob), shadow);
  rect(context, x + 7, y + 5, 9, 10, dark);
  rect(context, x + 8, y + 7, 8, 6, highlight);
  rect(context, x + 12, y + 8, 2, 2, accentHighlight);
  const legY = Math.min(41, y + 19);
  rect(context, x - 9, legY, 4, Math.max(1, 42 - legY), dark);
  rect(context, x + 6, legY, 4, Math.max(1, 42 - legY), dark);
  line(context, x - 15, y + 14, x - 20, y + 10, accent);
  setPixel(context, x + 11, y + 14, accentHighlight);
  if (context.action === "attack") {
    line(context, x + 18, y + 12, x + 19, y + 8, highlight);
    line(context, x + 17, y + 13, x + 18, y + 17, highlight);
  }
  if (context.action === "skill") for (const dx of [-17, -14, 14, 17]) setPixel(context, x + dx, y + 4, accentHighlight);
  ground(context, dark, shadow);
}

function drawHornedKing(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.colors;
  const { bob, shift, recoil } = motion(context);
  const x = 24 + shift + recoil;
  const y = bob;
  rect(context, x - 12, 15 + y, 24, Math.max(1, 25 - y), dark);
  rect(context, x - 9, 18 + y, 18, Math.max(1, 19 - y), body);
  rect(context, x - 11, 24 + y, 22, 8, accent);
  rect(context, x - 10, 5 + y, 20, 14, dark);
  rect(context, x - 7, 8 + y, 14, 9, shadow);
  rect(context, x - 3, 11 + y, 7, 5, accentHighlight);
  setPixel(context, x + 4, 12 + y, dark);
  rect(context, x - 16, 4 + y, 5, 12, accentHighlight);
  rect(context, x + 11, 4 + y, 5, 12, accentHighlight);
  rect(context, x - 18, 2 + y, 5, 4, accentHighlight);
  rect(context, x + 13, 2 + y, 5, 4, accentHighlight);
  rect(context, x - 8, 37 + y, 5, 6 - y, dark);
  rect(context, x + 4, 37 + y, 5, 6 - y, dark);
  line(context, x + 12, 20 + y, x + 17, 12 + y, highlight);
  line(context, x + 17, 12 + y, x + 19, 9 + y, accentHighlight);
  if (context.action === "skill") {
    for (const [dx, dy] of [[-17, 21], [-14, 18], [14, 18], [17, 21]] as const) rect(context, x + dx, 8 + dy + y, 2, 2, accentHighlight);
  }
  ground(context, dark, shadow);
}

function renderFrame(spec: BattleActorSpec, frameId: string): BattleActorSurface {
  const target = surface(spec);
  const split = frameId.split("_");
  const action = split[0] as DrawingContext["action"];
  const frameInClip = Number.parseInt(split[1] ?? "0", 10);
  const context: DrawingContext = {
    surface: target,
    colors: Object.fromEntries(Object.entries(spec.palette).map(([key, value]) => [key, rgb(value)])) as Record<keyof BattleActorPalette, Rgba>,
    spec,
    action,
    frameInClip,
    mirror: spec.facing === "left",
    scale: spec.boss ? 4 / 3 : 1,
  };
  switch (spec.silhouette) {
    case "grassSlime": drawGrassSlime(context); break;
    case "thornRat": drawThornRat(context); break;
    case "fangWolf": drawFangWolf(context); break;
    case "goblinScout": drawGoblinScout(context); break;
    case "stonehideBoar": drawStonehideBoar(context); break;
    case "hornedKing": drawHornedKing(context); break;
    default: drawHuman(context, spec.silhouette); break;
  }
  return target;
}

export function renderBattleActorFrame(spec: BattleActorSpec, frameId: string): BattleActorSurface {
  if (!(BATTLE_ACTOR_FRAME_IDS as readonly string[]).includes(frameId)) throw new Error(`BATTLE_ART_FRAME_INVALID:${frameId}`);
  return renderFrame(spec, frameId);
}

export async function writeBattleActorFrame(file: string, rendered: BattleActorSurface): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(rendered.data), { raw: { width: rendered.width, height: rendered.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
    .toFile(file);
}

export async function generateBattleActorInputs(projectRoot: string): Promise<number> {
  let frameCount = 0;
  for (const spec of BATTLE_ACTOR_SPECS) {
    for (const frameId of spec.frames) {
      await writeBattleActorFrame(path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${frameId}.png`), renderFrame(spec, frameId));
      frameCount += 1;
    }
  }
  return frameCount;
}
