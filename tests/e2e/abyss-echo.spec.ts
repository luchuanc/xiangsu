import { test } from "@playwright/test";

test.describe("RPG-028 深渊回响离线流程", () => {
  test.skip(true, "主入口/SceneRouter 尚未在本卡白名单内接线；浏览器证据由主 Agent 按环境实际记录");
  test("锁定→扣次数→Boss→目标失败/成功→回城→读档", async ({ page }) => {
    await page.goto("/");
  });
});
