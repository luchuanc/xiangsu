import { expect, test } from "@playwright/test";
import { collectBrowserErrors, dragPixiJoystick, startNewGame, tapPixiInteraction } from "./playable-helpers";

/**
 * 首屏只走真实标题→新游戏→canvas 摇杆，确认移动端用户能看到并操作字段场景。
 * 不注入存档、不读取 TestHooks；路线终点用现有制图师交互面板作为可观察结果。
 */
test("首屏显示字段地图并可用 canvas 摇杆走到制图师", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 568, height: 320 });
  await startNewGame(page);

  const canvas = page.locator("#game-root canvas");
  await expect(canvas).toBeVisible();
  await test.info().attach("visible-field-first-screen", { body: await page.screenshot(), contentType: "image/png" });

  // 仅拖动真实 Pixi 摇杆：向上离开出生点，再向右抵达制图师所在房间。
  await dragPixiJoystick(page, { x: 0, y: -1 }, 6_500);
  await dragPixiJoystick(page, { x: 1, y: 0 }, 3_800);
  await tapPixiInteraction(page);

  await expect(page.getByTestId("town-modal-open-floor-select")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("flow-status")).toContainText("城镇");
  expect(browserErrors).toEqual([]);
});
