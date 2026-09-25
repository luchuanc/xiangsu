import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import { expect, test, type Locator } from "@playwright/test";

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly channels: 3 | 4;
  readonly pixels: Buffer;
}

function paethPredictor(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

/**
 * Playwright 的 locator.screenshot 返回 PNG；这里仅解码截图行过滤器，避免增加 png/sharp 依赖。
 * 该哨兵只证明画布不是单一纯色，不替代人工视觉检查。
 */
function decodePng(png: Buffer): DecodedPng {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, signature.length).equals(signature)) throw new Error("PNG_SIGNATURE_INVALID");

  let offset = signature.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error("PNG_CHUNK_TRUNCATED");
    const data = png.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  let channels: 3 | 4;
  if (colorType === 6) {
    channels = 4;
  } else if (colorType === 2) {
    channels = 3;
  } else {
    throw new Error(`PNG_FORMAT_UNSUPPORTED:${width}x${height}/${bitDepth}/${colorType}`);
  }
  if (width <= 0 || height <= 0 || bitDepth !== 8 || idatChunks.length === 0) {
    throw new Error(`PNG_FORMAT_UNSUPPORTED:${width}x${height}/${bitDepth}/${colorType}`);
  }

  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(width * height * channels);
  let inputOffset = 0;
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset++] ?? 255;
    const encoded = inflated.subarray(inputOffset, inputOffset + rowBytes);
    inputOffset += rowBytes;
    if (encoded.length !== rowBytes) throw new Error("PNG_SCANLINE_TRUNCATED");
    const current = Buffer.alloc(rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= channels ? current[index - channels] ?? 0 : 0;
      const up = previous[index] ?? 0;
      const upperLeft = index >= channels ? previous[index - channels] ?? 0 : 0;
      const value = encoded[index] ?? 0;
      current[index] = filter === 0
        ? value
        : filter === 1
          ? (value + left) & 0xff
          : filter === 2
            ? (value + up) & 0xff
            : filter === 3
              ? (value + Math.floor((left + up) / 2)) & 0xff
              : filter === 4
                ? (value + paethPredictor(left, up, upperLeft)) & 0xff
                : (() => { throw new Error(`PNG_FILTER_UNSUPPORTED:${filter}`); })();
    }
    current.copy(pixels, y * rowBytes);
    previous = current;
  }
  return { width, height, channels, pixels };
}

function assertCanvasHasColorBuckets(png: Buffer, viewport: string): DecodedPng {
  const decoded = decodePng(png);
  const buckets = new Map<number, number>();
  for (let index = 0; index < decoded.pixels.length; index += decoded.channels) {
    const alpha = decoded.channels === 4 ? decoded.pixels[index + 3] ?? 0 : 255;
    if (alpha < 16) continue;
    const red = decoded.pixels[index] ?? 0;
    const green = decoded.pixels[index + 1] ?? 0;
    const blue = decoded.pixels[index + 2] ?? 0;
    const bucket = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  const sortedCounts = [...buckets.values()].sort((left, right) => right - left);
  const nonBackgroundBuckets = Math.max(0, buckets.size - (sortedCounts.length > 0 ? 1 : 0));
  expect(
    nonBackgroundBuckets,
    `${viewport} canvas screenshot must contain at least three non-background color buckets`,
  ).toBeGreaterThanOrEqual(3);
  return decoded;
}

interface LogicalRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 检查标题/按钮自己的固定区域有足够亮像素，防止遮罩覆盖后仅靠全局色桶误判通过。 */
function assertRegionHasVisibleArtwork(
  decoded: DecodedPng,
  region: LogicalRegion,
  label: string,
): void {
  const scaleX = decoded.width / 640;
  const scaleY = decoded.height / 360;
  const left = Math.max(0, Math.floor(region.x * scaleX));
  const top = Math.max(0, Math.floor(region.y * scaleY));
  const right = Math.min(decoded.width, Math.ceil((region.x + region.width) * scaleX));
  const bottom = Math.min(decoded.height, Math.ceil((region.y + region.height) * scaleY));
  let brightPixels = 0;
  let totalPixels = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * decoded.width + x) * decoded.channels;
      const red = decoded.pixels[index] ?? 0;
      const green = decoded.pixels[index + 1] ?? 0;
      const blue = decoded.pixels[index + 2] ?? 0;
      if (Math.max(red, green, blue) >= 100) brightPixels += 1;
      totalPixels += 1;
    }
  }
  const occupancy = totalPixels === 0 ? 0 : brightPixels / totalPixels;
  expect(occupancy, `${label} 固定区域应有可见亮像素`).toBeGreaterThan(0.015);
}

async function assertCanvasContainGeometry(
  canvas: Locator,
  viewportWidth: number,
  viewportHeight: number,
): Promise<{ readonly width: number; readonly height: number }> {
  const box = await canvas.boundingBox();
  expect(box, `${viewportWidth}×${viewportHeight} canvas bounding box`).not.toBeNull();
  if (!box) return { width: 0, height: 0 };
  const expectedScale = Math.min(viewportWidth / 640, viewportHeight / 360);
  const expectedWidth = 640 * expectedScale;
  const expectedHeight = 360 * expectedScale;
  await expect.poll(async () => {
    const current = await canvas.boundingBox();
    if (!current) return "pending";
    return Math.abs(current.width - expectedWidth) <= 1
      && Math.abs(current.height - expectedHeight) <= 1
      ? "ready"
      : "pending";
  }, { timeout: 5_000 }).toBe("ready");
  const settledBox = await canvas.boundingBox();
  expect(settledBox).not.toBeNull();
  if (!settledBox) return { width: 0, height: 0 };
  expect(Math.abs(settledBox.width - expectedWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(settledBox.height - expectedHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(settledBox.width / settledBox.height - 16 / 9)).toBeLessThan(0.01);
  expect(Math.abs(settledBox.x - (viewportWidth - expectedWidth) / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(settledBox.y - (viewportHeight - expectedHeight) / 2)).toBeLessThanOrEqual(1);
  return { width: settledBox.width, height: settledBox.height };
}

test("标题页显示真实 Pixi canvas、可访问控制与启动门禁，且无工程占位", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/");

  const canvas = page.locator("#game-root canvas");
  await expect(canvas).toBeVisible();
  const newGame = page.getByTestId("new-game");
  await expect(newGame).toBeAttached();
  await expect(page.locator("#startup-placeholder")).toHaveCSS("display", "none");
  await expect(page.locator("#system-overlay")).toHaveCSS("display", "none");
  await expect(newGame).toHaveAttribute("aria-label", "开始新游戏");
  await expect(newGame).toBeEnabled();
  await expect(page.getByText("工程占位")).toHaveCount(0);
  await expect(page.locator("#game-flow-ui")).not.toContainText("标题：选择或继续");

  // 标题入口必须由真实 Playwright 指针点击验证，不能用隐藏语义层的 evaluate click 冒充。
  await newGame.click();
  await expect(page.getByTestId("flow-status")).toContainText("城镇", { timeout: 10_000 });

  // 新游戏已完成一次真实路由后，通过重载回到标题，再采集两个 viewport 的画布证据。
  await page.reload();
  await expect(page.getByTestId("new-game")).toBeAttached({ timeout: 10_000 });
  await expect(page.getByTestId("flow-status")).toContainText("标题", { timeout: 10_000 });
  await expect(page.locator("#startup-placeholder")).toHaveCSS("display", "none");
  await expect(page.locator("#system-overlay")).toHaveCSS("display", "none");
  await expect(page.getByTestId("new-game")).toBeEnabled();

  const geometry568 = await assertCanvasContainGeometry(canvas, 568, 320);
  const screenshot568 = await canvas.screenshot({
    path: "/private/tmp/xiangsu-vis-001-568x320.png",
    animations: "disabled",
  });
  const decoded568 = assertCanvasHasColorBuckets(screenshot568, "568×320");
  expect(decoded568.width).toBe(Math.ceil(geometry568.width));
  expect(decoded568.height).toBe(Math.ceil(geometry568.height));
  assertRegionHasVisibleArtwork(decoded568, { x: 160, y: 28, width: 320, height: 105 }, "标题");
  assertRegionHasVisibleArtwork(decoded568, { x: 56, y: 194, width: 216, height: 56 }, "继续按钮");
  assertRegionHasVisibleArtwork(decoded568, { x: 56, y: 260, width: 216, height: 56 }, "开始按钮");

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(canvas).toBeVisible();
  const geometry844 = await assertCanvasContainGeometry(canvas, 844, 390);
  const screenshot844 = await canvas.screenshot({
    path: "/private/tmp/xiangsu-vis-001-844x390.png",
    animations: "disabled",
  });
  const decoded844 = assertCanvasHasColorBuckets(screenshot844, "844×390");
  expect(decoded844.width).toBe(Math.ceil(geometry844.width));
  expect(decoded844.height).toBe(Math.ceil(geometry844.height));
  assertRegionHasVisibleArtwork(decoded844, { x: 160, y: 28, width: 320, height: 105 }, "844×390 标题");
  assertRegionHasVisibleArtwork(decoded844, { x: 56, y: 194, width: 216, height: 56 }, "844×390 继续按钮");
  assertRegionHasVisibleArtwork(decoded844, { x: 56, y: 260, width: 216, height: 56 }, "844×390 开始按钮");

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
