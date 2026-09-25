import { test } from "@playwright/test";

test.describe("RPG-023 error recovery", () => {
  test.skip(true, "等待完整入口接线后用公开 TestHooks 注入 41 code/60 template 矩阵");

  test("资源、存档和 WebGL 恢复不泄漏 raw key", async ({ page }) => {
    await page.goto("/");
  });
});

