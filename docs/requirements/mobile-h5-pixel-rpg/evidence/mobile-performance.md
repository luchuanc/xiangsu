# RPG-023 移动性能记录

## 当前边界

本记录只保留可复现的工程证据，不把“无明显问题”扩写为 FPS/P50/P90 结论。固定步模拟仍为 60Hz；`battery` 画质档只把 Pixi ticker 上限设为 30，`standard/high` 设为 60，规则结果不依赖渲染帧率。

| 项目 | 结果 |
| --- | --- |
| `npm run test:unit` | 66 files / 314 tests PASS |
| `npm run typecheck` / `npm run lint` | PASS |
| `npm run build` | PASS；仅既有 >500KB chunk warning |
| `npm run verify:assets -- --batch verticalSlice` | PASS；verticalSlice 90 项逻辑资源与 placeholder 物理文件 |
| `npm run test:e2e -- tests/e2e/viewport-lifecycle.spec.ts` | NOT_RUN_ENV：webServer 绑定 `127.0.0.1:5173` 被 sandbox 以 EPERM 拒绝；未伪造浏览器证据 |
| 真机/模拟器 10 分钟试玩 | NOT_RUN：当前未提供设备连接 |

## 后续复验

RPG-023 主入口/SceneRouter 接线完成后，在 568×320、667×375、844×390、915×412、1024×768 横屏及竖屏各执行一次，记录黑屏、输入失效、状态跳步、持续冻结和最大图集边长；不记录无法复现的微优化指标。

