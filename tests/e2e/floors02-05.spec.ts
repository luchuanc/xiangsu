import { test } from "@playwright/test";

test.describe("RPG-024 第 2～5 层流程", () => {
  test.skip(true, "待 RPG-026 完成 main/SceneRouter 的正式内容根接线后，在获批浏览器端口执行；当前不伪造解锁、复战和远征刷新证据。");

  test("首通依次解锁第 2～5 层并保留复战状态", async () => {
    // 该流程依赖尚未接线的正式入口；保持显式 skip，不以单测替代浏览器证据。
  });
});
