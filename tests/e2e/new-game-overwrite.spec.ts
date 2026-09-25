import { test } from "@playwright/test";

test.describe("RPG-023 new game overwrite", () => {
  test.skip(true, "等待 RPG-023 主入口接线后执行原始 IndexedDB 字节/revision 比较");

  test("取消覆盖保持原存档逐字节不变", async ({ page }) => {
    await page.goto("/");
  });
});

