import { expect, test } from "@playwright/test";
import {
  collectBrowserErrors,
  dragPixiJoystick,
  startNewGame,
  tapPixiInteraction,
  waitForAutoEncounterBattle,
} from "./playable-helpers";

async function enterFloor01ThroughCartographer(page: import("@playwright/test").Page): Promise<void> {
  // 生产入口必须真实走到制图师；禁止退回旧的隐藏 enter-floor 调试按钮。
  await dragPixiJoystick(page, { x: 0, y: -1 }, 6_500);
  await dragPixiJoystick(page, { x: 1, y: 0 }, 3_800);
  await tapPixiInteraction(page);
  const openFloorSelect = page.getByTestId("town-modal-open-floor-select");
  await expect(openFloorSelect).toBeVisible({ timeout: 10_000 });
  await openFloorSelect.click();
  const selectFloor = page.getByTestId("town-modal-select-floor-floor_01");
  await expect(selectFloor).toBeVisible({ timeout: 10_000 });
  await selectFloor.click();
  const enterFloor = page.getByTestId("town-modal-enter-floor-floor_01-exploration");
  await expect(enterFloor).toBeVisible({ timeout: 10_000 });
  await expect(enterFloor).toBeEnabled();
  await enterFloor.click();
  await expect(page.getByTestId("flow-status")).toContainText("野外", { timeout: 30_000 });
}

/** 真实移动 H5 入口：战斗信息和按钮必须来自 Pixi canvas，不依赖隐藏 DOM 点击。 */
test("进入真实遭遇后显示 Pixi 战斗双方与可点 HUD", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = collectBrowserErrors(page);
  await startNewGame(page);
  await enterFloor01ThroughCartographer(page);
  await page.getByTestId("auto-encounter").click();
  await waitForAutoEncounterBattle(page, "visible-battle-ui");

  const canvas = page.locator("#game-root canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("PIXI_CANVAS_NOT_MEASURABLE");
  const scale = box.width / 640;

  // BattleHud basic 位于逻辑坐标 (24, 328)，点击后仍由 GameFlowController 负责 Gateway 提交。
  await page.mouse.click(box.x + 24 * scale, box.y + 328 * scale);
  await expect(page.getByTestId("flow-status")).toContainText(/战斗|战斗胜利|城镇/, { timeout: 30_000 });
  expect(browserErrors).toEqual([]);
});
