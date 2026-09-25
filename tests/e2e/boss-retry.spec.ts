import { test } from "@playwright/test";

test.describe("RPG-027 bossRetry", () => {
  test.skip(true, "等待 RPG-023 主入口/SceneRouter 接线后启用真实移动 H5 流程证据");

  test("接触层主后直入 Boss，失败/首通后入口状态正确", async ({ page }) => {
    await page.goto("/");
  });
});

