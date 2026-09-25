import { expect, test } from "@playwright/test";
import {
  arrangeGuardFront,
  clearFloorThroughBoss,
  collectBrowserErrors,
  prepareTownLoadoutAndRest,
  startNewGame,
  trainFloorEncounter,
  waitForTownReady,
} from "./playable-helpers";

test.describe("RPG-025 第 6～10 层深渊主线", () => {
  test("真实清理第 1～10 层后出现回响入口并进入回响战斗", async ({ page }) => {
    test.setTimeout(10_800_000);
    const browserErrors = collectBrowserErrors(page);
    await startNewGame(page);
    await arrangeGuardFront(page);

    // 先用真实首层遭遇获取足够的经验与装备，避免把首通难度错误地降到“裸装必过”。
    for (let training = 0; training < 6; training += 1) {
      console.log(`[abyss] training ${training + 1}/6`);
      await trainFloorEncounter(page, 1);
    }

    for (let floor = 1; floor <= 10; floor += 1) {
      let cleared = false;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        console.log(`[abyss] floor ${floor}/10 attempt ${attempt}/5 start`);
        const outcome = await clearFloorThroughBoss(page, floor);
        console.log(`[abyss] floor ${floor}/10 attempt ${attempt}/5 outcome=${outcome}`);
        if (outcome === "victory") {
          cleared = true;
          await prepareTownLoadoutAndRest(page);
          break;
        }

        // clearFloorThroughBoss 已等待战败回城；这里仍显式收口城镇状态，再整理装备并休息后重试同层。
        await waitForTownReady(page);
        await prepareTownLoadoutAndRest(page);
      }
      if (!cleared) {
        throw new Error(`楼层 ${floor} 在 5 次完整尝试后仍未首通`);
      }
    }

    const echoButtons = page.locator('[data-testid^="enter-abyss-echo-"]');
    await expect.poll(async () => await echoButtons.count(), { timeout: 10_000 }).toBeGreaterThan(0);
    let firstEnabledEchoIndex = -1;
    await expect.poll(async () => {
      for (let index = 0; index < await echoButtons.count(); index += 1) {
        if (await echoButtons.nth(index).isEnabled()) {
          firstEnabledEchoIndex = index;
          return index;
        }
      }
      return -1;
    }, { timeout: 30_000 }).toBeGreaterThanOrEqual(0);
    const firstEnabledEcho = echoButtons.nth(firstEnabledEchoIndex);
    await expect(firstEnabledEcho).toBeEnabled();
    console.log(`[abyss] echo entry index=${firstEnabledEchoIndex}`);
    await firstEnabledEcho.click();
    await expect(page.getByTestId("flow-status")).toContainText("战斗", { timeout: 10_000 });
    await expect(page.getByTestId("basic-attack")).toBeVisible();
    await expect(page.getByTestId("retreat")).toBeVisible();
    expect(browserErrors).toEqual([]);
  });
});
