import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { FIELD_ACTOR_FRAME_IDS, FIELD_ACTOR_SPECS, type FieldActorPalette, type FieldActorSpec } from "./FieldActorDefinitions";

type Rgba = readonly [number, number, number, number];

interface Surface {
  readonly width: 24;
  readonly height: 32;
  readonly data: Uint8Array;
}

interface DrawingContext {
  readonly surface: Surface;
  readonly palette: Record<keyof FieldActorPalette, Rgba>;
  readonly facing: "down" | "left" | "right" | "up";
  readonly walking: boolean;
  readonly frameInClip: number;
  readonly motion: number;
  readonly mirror: boolean;
}

const HEX = /^#([0-9A-Fa-f]{6})$/;

function rgb(hex: string): Rgba {
  const match = HEX.exec(hex);
  if (!match) throw new Error(`FIELD_ART_COLOR_INVALID:${hex}`);
  return [Number.parseInt(match[1]!.slice(0, 2), 16), Number.parseInt(match[1]!.slice(2, 4), 16), Number.parseInt(match[1]!.slice(4, 6), 16), 255];
}

function surface(): Surface {
  return { width: 24, height: 32, data: new Uint8Array(24 * 32 * 4) };
}

function setPixel(target: Surface, x: number, y: number, color: Rgba): void {
  if (x < 0 || x >= target.width || y < 0 || y >= 29) return;
  const offset = (y * target.width + x) * 4;
  target.data[offset] = color[0];
  target.data[offset + 1] = color[1];
  target.data[offset + 2] = color[2];
  target.data[offset + 3] = color[3];
}

function pixelLine(target: Surface, points: readonly [number, number][], color: Rgba): void {
  for (const [x, y] of points) setPixel(target, x, y, color);
}

function mirroredX(context: DrawingContext, x: number): number {
  return context.mirror ? 23 - x : x;
}

function drawAt(context: DrawingContext, x: number, y: number, color: Rgba): void {
  setPixel(context.surface, mirroredX(context, x), y, color);
}

function drawRectAt(context: DrawingContext, x: number, y: number, width: number, height: number, color: Rgba): void {
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) drawAt(context, x + column, y + row, color);
}

function drawGround(context: DrawingContext): void {
  const { outline: dark, shadow } = context.palette;
  // 脚底固定落在第 28 行，半透明阴影改用同色深浅而不是半透明像素，便于 alpha threshold 后稳定。
  drawRectAt(context, 6, 28, 12, 1, dark);
  drawRectAt(context, 8, 27, 8, 1, shadow);
  if (context.motion !== 0) drawAt(context, 7 + (context.motion > 0 ? 1 : 0), 28, shadow);
}

function clearActor(context: DrawingContext): void {
  const transparent: Rgba = [0, 0, 0, 0];
  for (let y = 3; y <= 27; y += 1) for (let x = 2; x <= 21; x += 1) setPixel(context.surface, x, y, transparent);
}

function drawHumanoidProfile(context: DrawingContext, silhouette: FieldActorSpec["silhouette"]): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.palette;
  const y = context.motion < 0 ? -1 : context.motion > 0 ? 1 : 0;
  const legA = context.walking ? (context.frameInClip % 2 === 0 ? -1 : 1) : context.motion;
  const legB = -legA;
  const skin = silhouette === "watcher" ? accentHighlight : rgb("#D6D0C2");

  // 侧向采用窄肩、单侧脸和向前伸出的道具，轮廓变化来自相连主体而非离体标记点。
  drawRectAt(context, 7, 14 + y, 12, 12, dark);
  drawRectAt(context, 8, 15 + y, 10, 9, body);
  drawRectAt(context, 5, 16 + y, 4, 8, dark);
  drawRectAt(context, 6, 17 + y, 3, 6, accent);
  drawRectAt(context, 10, 5 + y, 8, 9, dark);
  drawRectAt(context, 11, 6 + y, 6, 3, accent);
  drawRectAt(context, 13, 9 + y, 4, 4, silhouette === "watcher" ? shadow : skin);
  if (silhouette !== "watcher") drawAt(context, 16, 10 + y, accentHighlight);
  drawRectAt(context, 9 + legA, 23 + y, 3, 5, dark);
  drawRectAt(context, 14 + legB, 23 + y, 3, 5, dark);
  drawRectAt(context, 10 + legA, 24 + y, 2, 4, shadow);
  drawRectAt(context, 15 + legB, 24 + y, 2, 4, shadow);

  if (silhouette === "guard") {
    drawRectAt(context, 4, 14 + y, 5, 9, dark);
    drawRectAt(context, 5, 15 + y, 3, 6, accent);
    drawRectAt(context, 18, 11 + y, 4, 2, highlight);
    drawRectAt(context, 20, 12 + y, 2, 14, dark);
    drawAt(context, 21, 11 + y, accentHighlight);
  } else if (silhouette === "mage" || silhouette === "seer") {
    drawRectAt(context, 19, 8 + y, 2, 19, dark);
    drawRectAt(context, 19, 7 + y, 2, 2, accentHighlight);
    drawAt(context, 20, 6 + y, highlight);
  } else if (silhouette === "wanderer") {
    drawRectAt(context, 19, 12 + y, 2, 15, dark);
    drawAt(context, 20, 11 + y, accentHighlight);
  } else if (silhouette === "ranger") {
    drawRectAt(context, 18, 13 + y, 3, 10, dark);
    drawAt(context, 20, 12 + y, accentHighlight);
  } else if (silhouette === "merchant" || silhouette === "cartographer") {
    drawRectAt(context, 4, 14 + y, 4, 10, accent);
    drawRectAt(context, 5, 15 + y, 2, 2, accentHighlight);
  } else if (silhouette === "blacksmith") {
    drawRectAt(context, 19, 10 + y, 2, 3, accentHighlight);
    drawRectAt(context, 20, 12 + y, 1, 14, dark);
  } else if (silhouette === "tavern" || silhouette === "innkeeper") {
    drawRectAt(context, 19, 17 + y, 3, 3, accentHighlight);
    drawAt(context, 20, 16 + y, accentHighlight);
  } else if (silhouette === "mentor") {
    drawRectAt(context, 4, 17 + y, 3, 5, accentHighlight);
    drawAt(context, 5, 16 + y, highlight);
  } else if (silhouette === "watcher") {
    drawRectAt(context, 19, 14 + y, 3, 11, dark);
    drawRectAt(context, 19, 15 + y, 2, 3, accent);
    drawAt(context, 20, 16 + y, accentHighlight);
  }
}

function drawHumanoidBack(context: DrawingContext, silhouette: FieldActorSpec["silhouette"]): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.palette;
  const y = context.motion < 0 ? -1 : context.motion > 0 ? 1 : 0;
  const legA = context.walking ? (context.frameInClip % 2 === 0 ? -1 : 1) : context.motion;
  const legB = -legA;
  const wide = silhouette === "wanderer" || silhouette === "ranger" || silhouette === "cartographer" || silhouette === "watcher";

  // 背向显示后脑、披风/背包和背部高光，完全清掉正面脸部像素。
  drawRectAt(context, wide ? 4 : 6, 14 + y, wide ? 16 : 12, 12, dark);
  drawRectAt(context, wide ? 5 : 7, 15 + y, wide ? 14 : 10, 9, body);
  drawRectAt(context, 8, 5 + y, 8, 10, dark);
  drawRectAt(context, 9, 6 + y, 6, 7, accent);
  drawRectAt(context, 10, 8 + y, 4, 2, highlight);
  drawRectAt(context, wide ? 5 : 7, 16 + y, 3, 8, shadow);
  drawRectAt(context, wide ? 16 : 15, 16 + y, 3, 8, shadow);
  drawRectAt(context, 9 + legA, 23 + y, 3, 5, dark);
  drawRectAt(context, 14 + legB, 23 + y, 3, 5, dark);
  drawRectAt(context, 10 + legA, 24 + y, 2, 4, shadow);
  drawRectAt(context, 15 + legB, 24 + y, 2, 4, shadow);

  if (silhouette === "guard") {
    drawRectAt(context, 4, 15 + y, 5, 9, accent);
    drawRectAt(context, 5, 16 + y, 3, 5, accentHighlight);
  } else if (silhouette === "mage" || silhouette === "seer") {
    drawRectAt(context, 18, 7 + y, 3, 20, dark);
    drawRectAt(context, 18, 6 + y, 3, 2, accentHighlight);
    drawAt(context, 19, 5 + y, highlight);
  } else if (silhouette === "merchant" || silhouette === "cartographer" || silhouette === "watcher") {
    drawRectAt(context, 4, 14 + y, 5, 10, accent);
    drawRectAt(context, 5, 15 + y, 3, 4, accentHighlight);
  } else if (silhouette === "ranger") {
    drawRectAt(context, 16, 13 + y, 4, 9, accent);
    drawRectAt(context, 18, 12 + y, 2, 2, accentHighlight);
  } else if (silhouette === "wanderer") {
    drawRectAt(context, 17, 15 + y, 3, 10, accent);
    drawAt(context, 18, 14 + y, accentHighlight);
  } else if (silhouette === "blacksmith") {
    drawRectAt(context, 6, 13 + y, 3, 5, highlight);
  } else if (silhouette === "tavern" || silhouette === "innkeeper" || silhouette === "mentor") {
    drawRectAt(context, 8, 3 + y, 8, 2, accentHighlight);
    drawRectAt(context, 9, 4 + y, 6, 2, accent);
  } else if (silhouette === "priest") {
    drawRectAt(context, 10, 16 + y, 2, 7, accentHighlight);
    drawRectAt(context, 9, 18 + y, 4, 2, accentHighlight);
  }
}

function drawHumanoid(context: DrawingContext, silhouette: FieldActorSpec["silhouette"]): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.palette;
  const y = context.motion < 0 ? -1 : context.motion > 0 ? 1 : 0;
  const legA = context.walking ? (context.frameInClip % 2 === 0 ? -1 : 1) : context.motion;
  const legB = -legA;
  const skinColor = silhouette === "watcher" ? accentHighlight : rgb("#D6D0C2");
  const eye = accentHighlight;

  if (context.facing === "left" || context.facing === "right") {
    drawHumanoidProfile(context, silhouette);
    drawGround(context);
    return;
  }
  if (context.facing === "up") {
    drawHumanoidBack(context, silhouette);
    drawGround(context);
    return;
  }

  if (silhouette === "guard") {
    drawRectAt(context, 6, 13 + y, 12, 10, dark);
    drawRectAt(context, 7, 14 + y, 10, 8, body);
    drawRectAt(context, 8, 15 + y, 8, 2, highlight);
    drawRectAt(context, 9, 6 + y, 6, 7, dark);
    drawRectAt(context, 10, 7 + y, 4, 4, highlight);
    drawRectAt(context, 11, 8 + y, 2, 2, dark);
    drawRectAt(context, 4, 15 + y, 3, 8, dark);
    drawRectAt(context, 3, 16 + y, 3, 6, accent);
    drawRectAt(context, 4, 17 + y, 1, 4, accentHighlight);
    drawRectAt(context, 17, 14 + y, 3, 9, dark);
    drawRectAt(context, 18, 15 + y, 2, 6, accent);
    pixelLine(context.surface, [[mirroredX(context, 19), 12 + y], [mirroredX(context, 19), 13 + y], [mirroredX(context, 20), 14 + y], [mirroredX(context, 20), 15 + y]], highlight);
    drawRectAt(context, 8 + legA, 22 + y, 3, 6, dark);
    drawRectAt(context, 13 + legB, 22 + y, 3, 6, dark);
    drawRectAt(context, 9 + legA, 23 + y, 2, 4, shadow);
    drawRectAt(context, 14 + legB, 23 + y, 2, 4, shadow);
    drawGround(context);
    return;
  }

  if (silhouette === "mage" || silhouette === "seer") {
    const hood = silhouette === "seer" ? accent : shadow;
    drawRectAt(context, 5, 15 + y, 14, 10, dark);
    drawRectAt(context, 6, 15 + y, 12, 8, body);
    drawRectAt(context, 8, 21 + y, 8, 4, highlight);
    drawRectAt(context, 7, 5 + y, 10, 9, dark);
    drawRectAt(context, 8, 6 + y, 8, 7, hood);
    if (context.facing === "up") {
      drawRectAt(context, 9, 8 + y, 6, 5, body);
      drawRectAt(context, 10, 8 + y, 4, 1, highlight);
    } else {
      drawRectAt(context, 9, 8 + y, 6, 5, skinColor);
      drawAt(context, context.facing === "left" ? 10 : 13, 10 + y, eye);
      if (context.facing === "down") drawAt(context, 14, 10 + y, eye);
    }
    drawRectAt(context, 4, 16 + y, 3, 7, dark);
    drawRectAt(context, 17, 16 + y, 3, 7, dark);
    if (silhouette === "mage") {
      drawRectAt(context, 19, 8 + y, 1, 18, dark);
      drawAt(context, 19, 7 + y, accentHighlight);
      drawAt(context, 18, 8 + y, highlight);
      drawAt(context, 20, 8 + y, highlight);
      drawAt(context, 19, 9 + y, highlight);
    } else {
      drawRectAt(context, 19, 5 + y, 1, 22, dark);
      drawRectAt(context, 18, 5 + y, 3, 2, accentHighlight);
      drawAt(context, 19, 4 + y, accentHighlight);
      drawAt(context, 19, 7 + y, highlight);
    }
    drawRectAt(context, 8 + legA, 23 + y, 3, 5, dark);
    drawRectAt(context, 13 + legB, 23 + y, 3, 5, dark);
    drawRectAt(context, 9 + legA, 24 + y, 2, 4, shadow);
    drawRectAt(context, 14 + legB, 24 + y, 2, 4, shadow);
    drawGround(context);
    return;
  }

  // 其余角色与 NPC 共用“头部、衣身、道具”骨架，但服饰/道具由身份 silhouette 分支明确改变。
  const broadCape = silhouette === "wanderer" || silhouette === "ranger" || silhouette === "cartographer" || silhouette === "watcher";
  drawRectAt(context, broadCape ? 4 : 6, 14 + y, broadCape ? 16 : 12, 11, dark);
  drawRectAt(context, broadCape ? 5 : 7, 15 + y, broadCape ? 14 : 10, 8, body);
  if (silhouette === "wanderer" || silhouette === "ranger") {
    drawRectAt(context, 5, 16 + y, 2, 7, accent);
    drawRectAt(context, 17, 16 + y, 2, 7, accent);
    drawAt(context, 6, 19 + y, accentHighlight);
  }
  if (silhouette === "tavern") {
    drawRectAt(context, 7, 3 + y, 10, 2, dark);
    drawRectAt(context, 8, 3 + y, 8, 1, accent);
    drawRectAt(context, 9, 17 + y, 6, 7, accentHighlight);
    drawRectAt(context, 10, 18 + y, 4, 5, highlight);
  } else if (silhouette === "blacksmith") {
    drawRectAt(context, 5, 14 + y, 3, 9, shadow);
    drawRectAt(context, 16, 14 + y, 3, 9, shadow);
    drawRectAt(context, 9, 18 + y, 6, 6, accent);
  } else if (silhouette === "mentor") {
    drawRectAt(context, 8, 3 + y, 8, 2, accent);
    drawRectAt(context, 3, 17 + y, 3, 5, accentHighlight);
    drawAt(context, 4, 16 + y, accentHighlight);
  } else if (silhouette === "merchant") {
    drawRectAt(context, 3, 15 + y, 4, 9, accent);
    drawRectAt(context, 4, 14 + y, 2, 2, accentHighlight);
    drawAt(context, 5, 21 + y, highlight);
  } else if (silhouette === "innkeeper") {
    drawRectAt(context, 7, 3 + y, 10, 2, dark);
    drawRectAt(context, 8, 2 + y, 8, 1, accentHighlight);
    drawRectAt(context, 20, 12 + y, 1, 9, accentHighlight);
    drawAt(context, 20, 11 + y, accentHighlight);
  } else if (silhouette === "cartographer") {
    drawRectAt(context, 3, 17 + y, 4, 6, accentHighlight);
    drawRectAt(context, 4, 18 + y, 2, 3, highlight);
    drawRectAt(context, 18, 18 + y, 3, 5, accent);
  } else if (silhouette === "watcher") {
    drawRectAt(context, 8, 3 + y, 8, 3, shadow);
    drawRectAt(context, 6, 15 + y, 2, 8, shadow);
    drawRectAt(context, 16, 15 + y, 2, 8, shadow);
  } else if (silhouette === "priest") {
    drawRectAt(context, 10, 16 + y, 2, 7, accentHighlight);
    drawRectAt(context, 9, 18 + y, 4, 2, accentHighlight);
  }
  drawRectAt(context, 8, 21 + y, 8, 4, highlight);
  drawRectAt(context, 7, 5 + y, 10, 9, dark);
  if (silhouette === "ranger" || silhouette === "wanderer") {
    drawRectAt(context, 7, 6 + y, 10, 3, accent);
    if (context.facing === "up") {
      drawRectAt(context, 8, 9 + y, 8, 4, body);
      drawRectAt(context, 9, 9 + y, 6, 1, highlight);
    } else {
      drawRectAt(context, 8, 9 + y, 8, 4, skinColor);
    }
  } else if (silhouette === "watcher") {
    drawRectAt(context, 7, 6 + y, 10, 7, shadow);
    drawRectAt(context, 9, 9 + y, 6, 2, accentHighlight);
  } else {
    drawRectAt(context, 8, 6 + y, 8, 7, accent);
    if (context.facing === "up") {
      drawRectAt(context, 9, 9 + y, 6, 4, body);
      drawAt(context, 10, 9 + y, highlight);
      drawAt(context, 13, 9 + y, highlight);
    } else {
      drawRectAt(context, 9, 9 + y, 6, 4, skinColor);
    }
  }
  if (context.facing !== "up" && silhouette !== "watcher") {
    drawAt(context, context.facing === "left" ? 10 : 13, 10 + y, eye);
    if (context.facing === "down") drawAt(context, 14, 10 + y, eye);
  }
  drawRectAt(context, 4, 16 + y, 3, 7, dark);
  drawRectAt(context, 17, 16 + y, 3, 7, dark);
  if (silhouette === "wanderer") {
    drawRectAt(context, 18, 11 + y, 1, 15, dark);
    pixelLine(context.surface, [[mirroredX(context, 17), 12 + y], [mirroredX(context, 18), 11 + y], [mirroredX(context, 19), 12 + y]], accentHighlight);
  } else if (silhouette === "ranger") {
    drawRectAt(context, 19, 12 + y, 1, 13, dark);
    drawAt(context, 19, 11 + y, accentHighlight);
    drawAt(context, 18, 12 + y, accentHighlight);
    drawAt(context, 20, 12 + y, accentHighlight);
  } else if (silhouette === "tavern" || silhouette === "innkeeper") {
    drawRectAt(context, 19, 17 + y, 3, 3, accentHighlight);
    drawAt(context, 20, 16 + y, accentHighlight);
  } else if (silhouette === "blacksmith") {
    drawRectAt(context, 19, 10 + y, 2, 2, accentHighlight);
    drawRectAt(context, 20, 11 + y, 1, 13, dark);
  } else if (silhouette === "mentor" || silhouette === "cartographer") {
    drawRectAt(context, 19, 16 + y, 3, 6, accentHighlight);
    drawAt(context, 20, 15 + y, accent);
  } else if (silhouette === "merchant") {
    drawRectAt(context, 18, 13 + y, 4, 10, accent);
    drawAt(context, 20, 15 + y, accentHighlight);
  } else if (silhouette === "watcher") {
    drawRectAt(context, 19, 13 + y, 2, 13, dark);
    drawRectAt(context, 18, 14 + y, 4, 4, accent);
    drawAt(context, 19, 15 + y, accentHighlight);
  }
  drawRectAt(context, 8 + legA, 23 + y, 3, 5, dark);
  drawRectAt(context, 13 + legB, 23 + y, 3, 5, dark);
  drawRectAt(context, 9 + legA, 24 + y, 2, 4, shadow);
  drawRectAt(context, 14 + legB, 24 + y, 2, 4, shadow);
  drawGround(context);
}

function drawSlime(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accentHighlight } = context.palette;
  const bob = context.motion < 0 ? -1 : context.motion > 0 ? 1 : 0;
  if (context.facing === "left" || context.facing === "right") {
    clearActor(context);
    drawRectAt(context, 8, 21 + bob, 14, 7, dark);
    drawRectAt(context, 9, 18 + bob, 11, 10, dark);
    drawRectAt(context, 11, 16 + bob, 8, 12, dark);
    drawRectAt(context, 12, 17 + bob, 7, 10, body);
    drawRectAt(context, 11, 21 + bob, 8, 6, body);
    drawRectAt(context, 12, 18 + bob, 4, 3, highlight);
    drawAt(context, 17, 22 + bob, accentHighlight);
    drawAt(context, 18, 23 + bob, dark);
    drawRectAt(context, 7, 25 + bob, 3, 2, shadow);
    drawGround(context);
    return;
  }
  if (context.facing === "up") {
    clearActor(context);
    drawRectAt(context, 7, 21 + bob, 13, 7, dark);
    drawRectAt(context, 8, 18 + bob, 11, 10, dark);
    drawRectAt(context, 9, 16 + bob, 9, 12, dark);
    drawRectAt(context, 10, 17 + bob, 7, 10, body);
    drawRectAt(context, 9, 21 + bob, 9, 6, body);
    drawRectAt(context, 11, 18 + bob, 5, 2, highlight);
    drawAt(context, 12, 19 + bob, accentHighlight);
    drawRectAt(context, 6, 25 + bob, 3, 2, shadow);
    drawGround(context);
    return;
  }
  drawRectAt(context, 6, 21 + bob, 12, 7, dark);
  drawRectAt(context, 7, 18 + bob, 10, 10, dark);
  drawRectAt(context, 8, 16 + bob, 8, 12, dark);
  drawRectAt(context, 9, 17 + bob, 6, 10, body);
  drawRectAt(context, 8, 21 + bob, 8, 6, body);
  drawRectAt(context, 9, 18 + bob, 4, 3, highlight);
  drawAt(context, 10, 19 + bob, accentHighlight);
  drawAt(context, 10, 23 + bob, dark);
  drawAt(context, 14, 23 + bob, dark);
  drawRectAt(context, 5, 25 + bob, 2, 2, shadow);
  drawRectAt(context, 17, 25 + bob, 2, 2, shadow);
  drawGround(context);
}

function drawThornRat(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.palette;
  const bob = context.motion;
  if (context.facing === "left" || context.facing === "right") {
    clearActor(context);
    drawRectAt(context, 8, 21 + bob, 14, 7, dark);
    drawRectAt(context, 10, 18 + bob, 11, 9, body);
    drawRectAt(context, 16, 16 + bob, 6, 8, body);
    drawRectAt(context, 18, 15 + bob, 2, 3, accent);
    drawAt(context, 21, 19 + bob, accentHighlight);
    drawAt(context, 21, 20 + bob, dark);
    for (const [x, y] of [[11, 17], [13, 15], [15, 14]] as const) {
      drawAt(context, x, y + bob, accent);
      drawAt(context, x + 1, y - 1 + bob, highlight);
    }
    pixelLine(context.surface, [[mirroredX(context, 9), 23 + bob], [mirroredX(context, 7), 21 + bob], [mirroredX(context, 6), 19 + bob]], body);
    drawRectAt(context, 10, 26 + bob, 3, 2, shadow);
    drawGround(context);
    return;
  }
  if (context.facing === "up") {
    clearActor(context);
    drawRectAt(context, 6, 21 + bob, 14, 7, dark);
    drawRectAt(context, 8, 18 + bob, 11, 9, body);
    drawRectAt(context, 9, 16 + bob, 8, 7, body);
    drawRectAt(context, 9, 15 + bob, 2, 3, accent);
    drawRectAt(context, 12, 14 + bob, 2, 3, accent);
    for (const [x, y] of [[8, 17], [10, 15], [12, 14], [14, 15], [16, 17]] as const) {
      drawAt(context, x, y + bob, accent);
      drawAt(context, x + 1, y - 1 + bob, highlight);
    }
    drawRectAt(context, 7, 26 + bob, 3, 2, shadow);
    drawRectAt(context, 14, 26 + bob, 3, 2, shadow);
    drawGround(context);
    return;
  }
  drawRectAt(context, 5, 21 + bob, 14, 7, dark);
  drawRectAt(context, 7, 18 + bob, 10, 9, body);
  drawRectAt(context, 9, 16 + bob, 7, 7, body);
  drawRectAt(context, 10, 15 + bob, 2, 3, accent);
  drawRectAt(context, 13, 15 + bob, 2, 3, accent);
  drawAt(context, 15, 18 + bob, accentHighlight);
  drawAt(context, 16, 19 + bob, dark);
  for (const [x, y] of [[8, 17], [10, 15], [12, 14], [14, 15]] as const) {
    drawAt(context, x, y + bob, accent);
    drawAt(context, x + 1, y - 1 + bob, highlight);
  }
  pixelLine(context.surface, [[mirroredX(context, 5), 22 + bob], [mirroredX(context, 3), 20 + bob], [mirroredX(context, 2), 18 + bob], [mirroredX(context, 1), 19 + bob]], body);
  drawRectAt(context, 7, 26 + bob, 3, 2, shadow);
  drawRectAt(context, 14, 26 + bob, 3, 2, shadow);
  drawGround(context);
}

function drawWolfGoblin(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.palette;
  const bob = context.motion;
  if (context.facing === "left" || context.facing === "right") {
    clearActor(context);
    drawRectAt(context, 6, 21 + bob, 16, 7, dark);
    drawRectAt(context, 8, 18 + bob, 13, 8, body);
    drawRectAt(context, 18, 16 + bob, 5, 7, dark);
    drawRectAt(context, 19, 17 + bob, 3, 4, highlight);
    drawAt(context, 22, 18 + bob, accentHighlight);
    drawAt(context, 22, 19 + bob, dark);
    drawRectAt(context, 9, 25 + bob, 3, 4, shadow);
    drawRectAt(context, 17, 25 + bob, 3, 4, shadow);
    drawRectAt(context, 9, 10 + bob, 7, 8, dark);
    drawRectAt(context, 10, 11 + bob, 5, 6, accent);
    drawAt(context, 14, 13 + bob, accentHighlight);
    drawRectAt(context, 20, 5 + bob, 1, 18, dark);
    drawAt(context, 20, 4 + bob, highlight);
    drawGround(context);
    return;
  }
  if (context.facing === "up") {
    clearActor(context);
    drawRectAt(context, 4, 20 + bob, 16, 8, dark);
    drawRectAt(context, 6, 18 + bob, 12, 8, body);
    drawRectAt(context, 6, 25 + bob, 3, 4, shadow);
    drawRectAt(context, 15, 25 + bob, 3, 4, shadow);
    drawRectAt(context, 8, 10 + bob, 7, 8, dark);
    drawRectAt(context, 9, 11 + bob, 5, 6, accent);
    drawRectAt(context, 10, 11 + bob, 3, 1, highlight);
    drawRectAt(context, 10, 8 + bob, 1, 3, accent);
    drawRectAt(context, 18, 6 + bob, 1, 17, dark);
    drawAt(context, 18, 5 + bob, highlight);
    drawGround(context);
    return;
  }
  // 狼的四足轮廓与背上的哥布林头/短矛，避免用单一色块表示复合遭遇。
  drawRectAt(context, 3, 20 + bob, 17, 7, dark);
  drawRectAt(context, 5, 18 + bob, 13, 8, body);
  drawRectAt(context, 16, 16 + bob, 5, 7, dark);
  drawRectAt(context, 17, 17 + bob, 3, 4, highlight);
  drawAt(context, 19, 18 + bob, accentHighlight);
  drawAt(context, 20, 19 + bob, dark);
  drawRectAt(context, 7, 25 + bob, 3, 4, shadow);
  drawRectAt(context, 15, 25 + bob, 3, 4, shadow);
  drawRectAt(context, 8, 10 + bob, 7, 8, dark);
  drawRectAt(context, 9, 11 + bob, 5, 6, accent);
  drawAt(context, 10, 13 + bob, accentHighlight);
  drawAt(context, 13, 13 + bob, accentHighlight);
  drawRectAt(context, 11, 8 + bob, 1, 3, accent);
  drawRectAt(context, 19, 5 + bob, 1, 18, dark);
  drawAt(context, 19, 4 + bob, highlight);
  drawGround(context);
}

function drawStonehideBoar(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.palette;
  const bob = context.motion;
  if (context.facing === "left" || context.facing === "right") {
    clearActor(context);
    drawRectAt(context, 7, 19 + bob, 16, 9, dark);
    drawRectAt(context, 9, 17 + bob, 12, 10, body);
    drawRectAt(context, 18, 16 + bob, 5, 8, body);
    drawRectAt(context, 19, 18 + bob, 4, 5, shadow);
    drawAt(context, 22, 19 + bob, accentHighlight);
    drawAt(context, 22, 21 + bob, dark);
    drawAt(context, 20, 23 + bob, accentHighlight);
    for (const [x, y] of [[10, 16], [13, 15], [16, 16], [19, 17]] as const) {
      drawRectAt(context, x, y + bob, 3, 3, accent);
      drawAt(context, x + 1, y + bob, highlight);
    }
    drawRectAt(context, 9, 26 + bob, 3, 3, shadow);
    drawRectAt(context, 18, 26 + bob, 3, 3, shadow);
    drawGround(context);
    return;
  }
  if (context.facing === "up") {
    clearActor(context);
    drawRectAt(context, 4, 19 + bob, 17, 9, dark);
    drawRectAt(context, 6, 17 + bob, 13, 10, body);
    drawRectAt(context, 8, 15 + bob, 10, 9, shadow);
    drawRectAt(context, 10, 14 + bob, 5, 4, highlight);
    for (const [x, y] of [[7, 16], [10, 14], [13, 15], [16, 16]] as const) {
      drawRectAt(context, x, y + bob, 3, 3, accent);
      drawAt(context, x + 1, y + bob, accentHighlight);
    }
    drawRectAt(context, 7, 26 + bob, 3, 3, shadow);
    drawRectAt(context, 15, 26 + bob, 3, 3, shadow);
    drawGround(context);
    return;
  }
  drawRectAt(context, 3, 19 + bob, 18, 9, dark);
  drawRectAt(context, 5, 17 + bob, 14, 10, body);
  drawRectAt(context, 8, 15 + bob, 10, 9, shadow);
  drawRectAt(context, 10, 14 + bob, 5, 4, highlight);
  drawRectAt(context, 17, 19 + bob, 5, 6, body);
  drawAt(context, 20, 20 + bob, accentHighlight);
  drawAt(context, 20, 22 + bob, dark);
  drawAt(context, 18, 23 + bob, accentHighlight);
  drawAt(context, 21, 24 + bob, accentHighlight);
  for (const [x, y] of [[7, 16], [10, 14], [13, 15], [16, 16]] as const) {
    drawRectAt(context, x, y + bob, 3, 3, accent);
    drawAt(context, x + 1, y + bob, accentHighlight);
  }
  drawRectAt(context, 6, 26 + bob, 3, 3, shadow);
  drawRectAt(context, 15, 26 + bob, 3, 3, shadow);
  drawGround(context);
}

function drawHornedKing(context: DrawingContext): void {
  const { outline: dark, shadow, base: body, highlight, accent, accentHighlight } = context.palette;
  const bob = context.motion < 0 ? -1 : context.motion > 0 ? 1 : 0;
  if (context.facing === "left" || context.facing === "right") {
    clearActor(context);
    drawRectAt(context, 7, 15 + bob, 16, 13, dark);
    drawRectAt(context, 8, 16 + bob, 14, 11, body);
    drawRectAt(context, 10, 6 + bob, 9, 10, dark);
    drawRectAt(context, 11, 8 + bob, 7, 7, shadow);
    drawRectAt(context, 15, 10 + bob, 3, 4, accentHighlight);
    drawAt(context, 17, 11 + bob, dark);
    drawRectAt(context, 9, 23 + bob, 8, 4, accent);
    drawRectAt(context, 18, 4 + bob, 3, 7, accentHighlight);
    drawRectAt(context, 17, 3 + bob, 3, 2, accentHighlight);
    drawRectAt(context, 20, 17 + bob, 3, 9, dark);
    drawRectAt(context, 21, 10 + bob, 1, 17, dark);
    drawAt(context, 21, 9 + bob, accentHighlight);
    drawRectAt(context, 10, 25 + bob, 3, 4, dark);
    drawRectAt(context, 16, 25 + bob, 3, 4, dark);
    drawGround(context);
    return;
  }
  if (context.facing === "up") {
    clearActor(context);
    drawRectAt(context, 5, 15 + bob, 15, 13, dark);
    drawRectAt(context, 6, 16 + bob, 13, 11, body);
    drawRectAt(context, 8, 7 + bob, 9, 9, dark);
    drawRectAt(context, 9, 9 + bob, 7, 6, shadow);
    drawRectAt(context, 11, 10 + bob, 3, 4, body);
    drawRectAt(context, 5, 4 + bob, 3, 7, accentHighlight);
    drawRectAt(context, 4, 3 + bob, 3, 2, accentHighlight);
    drawRectAt(context, 16, 4 + bob, 3, 7, accentHighlight);
    drawRectAt(context, 17, 3 + bob, 3, 2, accentHighlight);
    drawRectAt(context, 8, 23 + bob, 9, 4, accent);
    drawRectAt(context, 9, 25 + bob, 3, 4, dark);
    drawRectAt(context, 14, 25 + bob, 3, 4, dark);
    drawGround(context);
    return;
  }
  drawRectAt(context, 4, 15 + bob, 16, 13, dark);
  drawRectAt(context, 5, 16 + bob, 14, 11, body);
  drawRectAt(context, 7, 23 + bob, 10, 4, accent);
  drawRectAt(context, 7, 6 + bob, 10, 10, dark);
  drawRectAt(context, 8, 8 + bob, 8, 7, shadow);
  if (context.facing === "up") {
    drawRectAt(context, 10, 10 + bob, 4, 4, body);
    drawRectAt(context, 10, 10 + bob, 4, 1, highlight);
  } else {
    drawRectAt(context, 10, 10 + bob, 4, 4, accentHighlight);
    drawAt(context, context.facing === "left" ? 11 : 13, 11 + bob, dark);
    if (context.facing === "down") drawAt(context, 11, 11 + bob, dark);
  }
  drawRectAt(context, 5, 4 + bob, 3, 7, accentHighlight);
  drawRectAt(context, 4, 3 + bob, 3, 2, accentHighlight);
  drawRectAt(context, 16, 4 + bob, 3, 7, accentHighlight);
  drawRectAt(context, 17, 3 + bob, 3, 2, accentHighlight);
  drawRectAt(context, 2, 17 + bob, 4, 8, dark);
  drawRectAt(context, 18, 16 + bob, 4, 9, dark);
  drawRectAt(context, 20, 10 + bob, 1, 17, dark);
  drawAt(context, 20, 9 + bob, accentHighlight);
  drawRectAt(context, 8, 25 + bob, 3, 4, dark);
  drawRectAt(context, 13, 25 + bob, 3, 4, dark);
  drawGround(context);
}

function renderFrame(spec: FieldActorSpec, frameId: string): Surface {
  const surfaceTarget = surface();
  const [facing, clip, frameText] = frameId.split("_") as ["down" | "left" | "right" | "up", "idle" | "walk", string];
  const frameInClip = Number.parseInt(frameText, 10);
  const walking = clip === "walk";
  const motion = walking ? [-1, 0, 1, 0, -1, 0][frameInClip] ?? 0 : [0, 0, 1, 0][frameInClip] ?? 0;
  const colors = Object.fromEntries(Object.entries(spec.palette).map(([key, value]) => [key, rgb(value)])) as Record<keyof FieldActorPalette, Rgba>;
  const context: DrawingContext = { surface: surfaceTarget, palette: colors, facing, walking, frameInClip, motion, mirror: facing === "left" };
  if (spec.silhouette === "slime") drawSlime(context);
  else if (spec.silhouette === "thornRat") drawThornRat(context);
  else if (spec.silhouette === "wolfGoblin") drawWolfGoblin(context);
  else if (spec.silhouette === "stonehideBoar") drawStonehideBoar(context);
  else if (spec.silhouette === "hornedKing") drawHornedKing(context);
  else drawHumanoid(context, spec.silhouette);
  return surfaceTarget;
}

export function renderFieldActorFrame(spec: FieldActorSpec, frameId: string): Surface {
  if (!(FIELD_ACTOR_FRAME_IDS as readonly string[]).includes(frameId)) throw new Error(`FIELD_ART_FRAME_INVALID:${frameId}`);
  return renderFrame(spec, frameId);
}

export async function writeFieldActorFrame(file: string, rendered: Surface): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(rendered.data), { raw: { width: rendered.width, height: rendered.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
    .toFile(file);
}

export async function generateFieldActorInputs(projectRoot: string): Promise<number> {
  let frameCount = 0;
  for (const spec of FIELD_ACTOR_SPECS) {
    for (const frameId of spec.frames) {
      await writeFieldActorFrame(path.join(projectRoot, "art/visual/v1/input", spec.inputDirectory, `${frameId}.png`), renderFrame(spec, frameId));
      frameCount += 1;
    }
  }
  return frameCount;
}
