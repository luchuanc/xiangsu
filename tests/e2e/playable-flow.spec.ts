import { expect, test, type Page } from "@playwright/test";

/**
 * 业务回归仍通过旧语义 DOM 控件驱动；这些控件在正式流程中被隐藏，不能当作可见游戏 UI 证据。
 * 点击前只校验节点已挂载且未禁用，使用 DOM click 保持与无障碍语义层一致。
 */
async function clickLegacyControl(page: Page, testId: string): Promise<void> {
  const control = page.getByTestId(testId);
  await expect(control).toHaveCount(1, { timeout: 10_000 });
  await expect(control).toBeAttached({ timeout: 10_000 });
  await expect(control).toBeEnabled({ timeout: 10_000 });
  await control.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error(`legacy_control_not_button:${element.tagName}`);
    }
    if (element.disabled) throw new Error("legacy_control_disabled");
    element.click();
  });
}

async function hasAttachedControl(
  page: Page,
  testId: string,
): Promise<boolean> {
  return (await page.getByTestId(testId).count()) > 0;
}

test("业务回归：新游戏到首个奖励继续探索（隐藏语义控件，不作为可见 UI 证据）", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/");
  await expect(page.locator("#game-root canvas")).toBeVisible();
  await expect(page.locator("#startup-placeholder")).toHaveCSS("display", "none");

  await expect(page.getByTestId("flow-status")).toContainText("标题");
  await clickLegacyControl(page, "new-game");
  await expect(page.getByTestId("flow-status")).toContainText("城镇");

  await clickLegacyControl(page, "enter-floor");
  await expect(page.getByTestId("flow-status")).toContainText("野外");
  await clickLegacyControl(page, "auto-encounter");
  await expect(page.getByTestId("flow-status")).toContainText("战斗", { timeout: 10_000 });

  // 普攻和敌方 AI 都由真实 Gateway/Reducer 轮转；这里只重复移动端按钮，
  // 不注入伤害或直接篡改敌方生命值。
  for (let index = 0; index < 64; index += 1) {
    if (await hasAttachedControl(page, "claim-reward")) break;
    const attack = page.getByTestId("basic-attack");
    await expect(attack).toHaveCount(1, { timeout: 5_000 });
    await expect(attack).toBeAttached({ timeout: 5_000 });
    await expect(attack).toBeEnabled({ timeout: 5_000 });
    await clickLegacyControl(page, "basic-attack");
    await expect.poll(async () => {
      if (await hasAttachedControl(page, "claim-reward")) return "reward";
      const currentAttack = page.getByTestId("basic-attack");
      return (await currentAttack.count()) > 0 && await currentAttack.isEnabled() ? "ready" : "busy";
    }, { timeout: 5_000 }).toMatch(/^(ready|reward)$/);
  }

  await expect(page.getByTestId("claim-reward")).toHaveCount(1, { timeout: 5_000 });
  await clickLegacyControl(page, "claim-reward");
  await expect(page.getByTestId("flow-status")).toContainText("野外");
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
