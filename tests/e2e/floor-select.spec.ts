import { expect, test } from "@playwright/test";
import { arrangeGuardFront, clearFloorThroughBoss, collectBrowserErrors, enterFloor, prepareTownLoadoutAndRest, returnRetainedExpedition, startNewGame, trainFirstFloorEncounter, waitForAutoEncounterBattle, waitForTownReady, winCurrentBattleAndClaim } from "./playable-helpers";

test("首层 Boss 首通解锁第二层，并完成第二层一场真实战斗", async ({ page }) => {
  test.setTimeout(1_200_000);
  const browserErrors = collectBrowserErrors(page);
  await startNewGame(page);
  await arrangeGuardFront(page);

  // 先用六次真实首个普通遭遇积累 XP/掉落；每次结束远征后才在城镇整理装备。
  for (let training = 0; training < 6; training += 1) {
    await trainFirstFloorEncounter(page);
  }

  // 整层不降低为短程路线；战败只结束本次尝试，回城清理完成后用新掉落重整再试。
  let floorCleared = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const outcome = await clearFloorThroughBoss(page, 1);
    if (outcome === "victory") {
      floorCleared = true;
      break;
    }
    await waitForTownReady(page);
    await prepareTownLoadoutAndRest(page);
  }
  expect(floorCleared, "首层整层在三次真实成长尝试后仍未通关").toBe(true);

  // Boss 首通已经回到可管理的城镇；再次确认装备和恢复，再进入已解锁的第二层。
  await prepareTownLoadoutAndRest(page);

  const floorTwo = page.getByTestId("enter-floor-floor_02-exploration");
  await expect(floorTwo).toBeVisible({ timeout: 10_000 });
  await expect(floorTwo).toBeEnabled();
  await enterFloor(page, 2);
  await page.getByTestId("auto-encounter").click();
  await waitForAutoEncounterBattle(page, "floor2-first-encounter");
  await winCurrentBattleAndClaim(page);
  await returnRetainedExpedition(page);
  await expect(page.getByTestId("flow-status")).toContainText("城镇");
  expect(browserErrors).toEqual([]);
});
