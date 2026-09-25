import { test } from "@playwright/test";

test.describe("RPG-027 shortFarm", () => {
  test.skip(true, "等待 RPG-023 主入口/SceneRouter 接线后启用真实移动 H5 流程证据");

  test("城镇→已首通层短程→回城并保留商店字节", async ({ page }) => {
    await page.goto("/");
  });
});

