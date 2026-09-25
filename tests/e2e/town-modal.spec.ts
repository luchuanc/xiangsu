import { expect, test, type Page } from "@playwright/test";
import { collectBrowserErrors, dragPixiJoystick, startNewGame, tapPixiInteraction } from "./playable-helpers";

async function pixelDifference(page: Page, before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(async ({ beforeBase64, afterBase64 }) => {
    const decode = async (encoded: string): Promise<ImageData> => {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PIXEL_DIFF_CONTEXT_MISSING");
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [left, right] = await Promise.all([decode(beforeBase64), decode(afterBase64)]);
    if (left.width !== right.width || left.height !== right.height) return 1;
    let difference = 0;
    const pixels = left.width * left.height;
    for (let index = 0; index < left.data.length; index += 4) {
      difference += Math.abs(left.data[index] - right.data[index]);
      difference += Math.abs(left.data[index + 1] - right.data[index + 1]);
      difference += Math.abs(left.data[index + 2] - right.data[index + 2]);
    }
    return difference / (pixels * 3 * 255);
  }, { beforeBase64: before.toString("base64"), afterBase64: after.toString("base64") });
}

async function assertSemanticLayout(page: Page): Promise<void> {
  const controls = page.locator("#game-flow-ui > button.town-modal-semantic");
  const rects = await controls.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }));
  expect(rects.length).toBeGreaterThan(0);
  for (let index = 0; index < rects.length; index += 1) {
    for (let next = index + 1; next < rects.length; next += 1) {
      const a = rects[index];
      const b = rects[next];
      const horizontalGap = a.right <= b.left ? b.left - a.right : a.left - b.right;
      const verticalGap = a.bottom <= b.top ? b.top - a.bottom : a.top - b.bottom;
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap, `semantic controls overlap: ${index}/${next}`).toBe(false);
      expect(Math.max(horizontalGap, verticalGap), `semantic controls gap < 8px: ${index}/${next}`).toBeGreaterThanOrEqual(8 - 0.01);
    }
  }
}

test("真实 Pixi 城镇面板：摇杆到地图学家并从楼层面板进入第一层", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = collectBrowserErrors(page);
  await startNewGame(page);

  // 初始点位在城镇南侧；沿空旷主路向上再向右接近地图学家。
  await dragPixiJoystick(page, { x: 0, y: -1 }, 6_500);
  await dragPixiJoystick(page, { x: 1, y: 0 }, 3_800);
  const canvas = page.locator("#game-root canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("PIXI_CANVAS_NOT_MEASURABLE");
  const modalClip = {
    x: canvasBox.x + canvasBox.width * 0.12,
    y: canvasBox.y + canvasBox.height * 0.06,
    width: canvasBox.width * 0.76,
    height: canvasBox.height * 0.88,
  };
  const beforeModal = await page.screenshot({ clip: modalClip });
  await tapPixiInteraction(page);
  await expect(page.getByTestId("town-modal-open-floor-select")).toBeVisible({ timeout: 10_000 });
  await expect(canvas).toBeVisible();
  const afterModal = await page.screenshot({ clip: modalClip });
  expect(await pixelDifference(page, beforeModal, afterModal), "NPC 面板中央区域必须产生真实像素变化").toBeGreaterThan(0.01);

  // production Pixi 路径只允许透明 semantic mirror，旧 DOM 入口不得与画布面板并存。
  await expect(page.locator('[data-testid="merchant-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="close-npc-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="enter-floor"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="npc-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="merchant-buy-"]')).toHaveCount(0);
  await expect(page.locator('#game-flow-ui > button.town-modal-semantic').first()).toHaveCSS("opacity", "0");
  await expect(page.locator('#game-flow-ui > button.town-modal-semantic').first()).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await expect(page.locator('#game-flow-ui > button.town-modal-semantic').first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator('#game-flow-ui > button.town-modal-semantic').first()).toHaveText("");

  // 透明语义镜像只转发 exact openFloorSelect command，展示层仍留在画布。
  await page.getByTestId("town-modal-open-floor-select").click();
  await expect(page.getByTestId("town-modal-select-floor-floor_01")).toBeVisible({ timeout: 10_000 });
  await assertSemanticLayout(page);
  await page.getByTestId("town-modal-select-floor-floor_01").click();
  const enterFloor = page.getByTestId("town-modal-enter-floor-floor_01-exploration");
  await expect(enterFloor).toBeVisible({ timeout: 10_000 });
  await expect(enterFloor).toBeEnabled();
  await assertSemanticLayout(page);
  await enterFloor.click();
  await expect(page.getByTestId("flow-status")).toContainText("野外", { timeout: 30_000 });
  expect(browserErrors, "真实 Pixi 城镇流程不得产生 console/pageerror").toEqual([]);
});
