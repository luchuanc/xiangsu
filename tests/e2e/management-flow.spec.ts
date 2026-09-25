import { expect, test } from "@playwright/test";
import { collectBrowserErrors, startNewGame, tapPixiMenu } from "./playable-helpers";

test("移动端点击完成背包、队伍、技能、Combo 和设置管理流程", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = collectBrowserErrors(page);
  await startNewGame(page);

  for (const route of ["inventory", "party", "skill", "combo", "settings"] as const) {
    await tapPixiMenu(page);
    await expect(page.getByTestId("management-title")).toContainText("冒险菜单", { timeout: 10_000 });
    await page.getByTestId(`management-hub-${route}`).click();
    await expect(page.getByTestId("management-summary")).toBeVisible({ timeout: 10_000 });

    if (route === "inventory") {
      const selectFirst = page.getByTestId("management-inventory-select-first");
      const emptyState = page.getByTestId("management-inventory-empty-state");
      // 不向真实新档注入装备：有装备时验收操作入口，空背包时验收可解释引导与无死按钮。
      if (await selectFirst.count()) {
        await expect(selectFirst).toBeVisible();
        await expect(selectFirst).toBeEnabled();
        await selectFirst.click();
        await expect(page.getByTestId("management-inventory-lock")).toBeEnabled();
      } else {
        await expect(emptyState).toBeVisible();
        await expect(emptyState).toContainText("野外探索");
        await expect(page.getByTestId("management-summary")).not.toContainText("empty");
        await expect(page.getByTestId("management-inventory-lock")).toHaveCount(0);
        await expect(page.getByTestId("management-inventory-equip")).toHaveCount(0);
        await expect(page.getByTestId("management-inventory-disassemble")).toHaveCount(0);
      }
      await expect(page.getByTestId("inventory-field-item-disabled-reason")).toContainText("requires_expedition");
    } else if (route === "party") {
      const recruitmentConfirm = page.getByTestId("management-party-confirm-recruitment");
      await expect(recruitmentConfirm).toBeVisible();
      await expect(recruitmentConfirm).toBeDisabled();
      await expect(page.getByTestId("management-party-recruitment-disabled-reason")).toContainText("evaluation_required");
      const evaluate = page.getByTestId("management-party-evaluate-recruitment");
      if (await evaluate.isEnabled()) {
        await evaluate.click();
        await expect.poll(async () => await page.getByTestId("management-party-recruitment-state").count() + await page.getByTestId("management-party-recruitment-disabled-reason").count()).toBe(1);
      }
    } else if (route === "skill") {
      const emberMage = page.getByTestId("management-skill-character-char_ember_mage");
      await expect(emberMage).toBeVisible();
      await expect(emberMage).toBeEnabled();
      await emberMage.click();
      await expect(page.getByTestId("management-summary")).toContainText("char_ember_mage");
      await expect(page.getByTestId("management-skill-focus")).toBeEnabled();
      await page.getByTestId("management-skill-focus").click();
      await expect(page.getByTestId("management-summary")).toBeVisible();
    } else if (route === "combo") {
      await page.getByTestId("management-combo-refresh").click();
      await expect(page.getByTestId("management-summary")).toContainText("Combo");
    } else {
      const before = await page.getByTestId("management-summary").textContent();
      await page.getByTestId("toggle-reduced-flashes").click();
      await expect.poll(async () => await page.getByTestId("management-summary").textContent()).not.toBe(before);
    }
    await page.getByTestId("return-town").click();
    await expect(page.getByTestId("flow-status")).toContainText("城镇");
  }

  expect(browserErrors).toEqual([]);
});
