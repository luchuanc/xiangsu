# RPG-023 移动可玩性记录

## 当前状态

完整 `town → exploration/shortFarm/bossRetry → battle → reward → town` 三循环仍需 RPG-023 主入口与 SceneRouter 接线后执行。RPG-027 已完成三模式领域/应用适配器：shortFarm 精确 3 normal+1 elite+1 chest+return，bossRetry detached 直入且不刷新商店，重复指令辅助支持 350ms 取消与 active→basic 降级。

| 场景 | 证据 | 状态 |
| --- | --- | --- |
| shortFarm 浏览器流程 | `tests/e2e/short-farm.spec.ts` 明确 `test.skip` | NOT_RUN_ENV / 接线待办 |
| bossRetry 浏览器流程 | `tests/e2e/boss-retry.spec.ts` 明确 `test.skip` | NOT_RUN_ENV / 接线待办 |
| viewport/lifecycle | `tests/e2e/viewport-lifecycle.spec.ts` 明确 `test.skip` | NOT_RUN_ENV / sandbox EPERM |
| 错误恢复、离线、覆盖 | 对应 specs 明确 `test.skip` | NOT_RUN_ENV / 接线待办 |
| 触控命中区 | `BattleHud` 保留冻结 `48×48` 与 `8px` 常量；尚未进行浏览器像素测量 | TODO |
| 真机试玩 | 未连接 iOS Safari/Android Chromium | NOT_RUN |

禁止用这些占位 spec 代替真实可玩性结论；主入口接线和浏览器运行环境可用后再补原始截图、console/pageerror 与三循环记录。

