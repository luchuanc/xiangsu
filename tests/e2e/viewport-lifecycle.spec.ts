import { test } from "@playwright/test";

test.describe("RPG-023 viewport/lifecycle", () => {
  test.skip(true, "当前沙箱禁止 webServer 绑定且完整主流程待 RPG-023 接线复验");

  test("568×320、五横屏、竖屏/hidden/context 生命周期", async ({ page }) => {
    await page.goto("/");
  });
});

