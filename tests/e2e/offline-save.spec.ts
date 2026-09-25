import { test } from "@playwright/test";

test.describe("RPG-023 offline/save", () => {
  test.skip(true, "等待 RPG-023 主入口与 IndexedDB 流程接线后执行");

  test("断网继续、新存档覆盖确认与 storage.persist 三分支", async ({ page }) => {
    await page.goto("/");
  });
});

