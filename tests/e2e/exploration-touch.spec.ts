import { expect, test } from "@playwright/test";
import { collectBrowserErrors, enterFloor, startNewGame } from "./playable-helpers";

test("移动 H5 探索方向键按住移动，释放后坐标保持稳定", async ({ page }) => {
  test.setTimeout(60_000);
  const browserErrors = collectBrowserErrors(page);
  await startNewGame(page);
  await enterFloor(page, 1);

  const position = page.getByTestId("exploration-position");
  const right = page.getByTestId("move-right");
  const interact = page.getByTestId("interact");
  await expect(position).toBeVisible();
  await expect(right).toBeVisible();
  await expect(interact).toBeVisible();

  const before = await position.textContent();
  await right.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 520,
    clientY: 240,
  });
  await expect.poll(async () => position.textContent(), { timeout: 5_000 }).not.toBe(before);

  await right.dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 520,
    clientY: 240,
  });
  const afterRelease = await position.textContent();
  await page.waitForTimeout(180);
  expect(await position.textContent()).toBe(afterRelease);
  expect(browserErrors).toEqual([]);
});
