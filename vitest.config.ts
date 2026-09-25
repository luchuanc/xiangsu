import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // RPG-004 的正式命令同时覆盖 unit 与 integration，不能让集成测试被静默排除。
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
});
