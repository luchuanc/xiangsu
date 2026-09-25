# RPG-026 自用候选构建与增量验收记录

## 最新结论（2026-08-26）

工程、内容、资源、单元/集成测试和生产构建门禁已通过。主入口的首层可玩流程和管理流程已在获批本地端口的 568×320 `mobile-h5` Playwright 视口跑通；等级成长/被动百分比计算、四槽队伍换位和奖励遇敌顺序也已补齐回归。`floor-select` 使用真实 starter/resources 在首层后段战斗中队伍真实败北，不能记为通过；十层/深渊主线、正式 PROFILE-1.2 平衡模拟、真机和最终视觉仍未形成通过证据，因此不宣称“全量验收完成”或“680 场通过”。

## 候选输入

| 项目 | 实际值 |
| --- | --- |
| 工作区 | `/Users/lcc/temp/xiangsu`；父仓库将该目录显示为未跟踪目录，本项目没有可用 commit SHA |
| Node / npm | `v18.20.8` / `10.8.2` |
| contentVersion | `content-1.2.0` |
| package-lock SHA-256 | `e36bd3156d864dc13ede782532c200634d83039a7c4f957e0ba7a48f1bdaaf8f` |
| dist | 本轮重新 `npm run build` 通过，产物 287 files；hash-of-hash 未作为本轮验收依据 |
| 关键依赖 | PixiJS 8.19.0、Vite 6.4.3、Vitest 3.2.7、TypeScript 6.0.3、Playwright 1.61.1、fake-indexeddb 6.2.5 |

## 自动化门禁

| 命令 | 原始结果 | 状态 |
| --- | --- | --- |
| `npm run typecheck` | exit 0 | PASS |
| `npm run lint` | exit 0 | PASS |
| `npm run test:unit` | 72 files / 372 tests，exit 0 | PASS |
| `npx vitest run tests/unit/save-schema.test.ts --environment node` | 15/15，覆盖等级成长、被动/装备 max HP 顺序及边界 | PASS |
| `npx vitest run tests/integration/party-screen.test.ts tests/integration/game-flow-controller.test.ts --environment node` | 2 files / 25 tests，覆盖四槽换位、主角保护、CAS 草稿与奖励顺序 | PASS |
| `npm run verify:content -- --mode fixture` | exit 0 | PASS |
| `npm run verify:content -- --mode batch --batch verticalSlice` | exit 0；content-1.2.0 | PASS |
| `npm run verify:content -- --mode batch --batch floors02_05` | exit 0；content-1.2.0 | PASS |
| `npm run verify:content -- --mode batch --batch floors06_10` | exit 0；content-1.2.0 | PASS |
| `npm run verify:content -- --mode batch --batch abyssEchoes` | exit 0；10 echoes | PASS |
| `npm run verify:content -- --mode final` | exit 0；累计集合一致 | PASS |
| `npm run verify:assets`、各批次 `--batch` 与 `--final` | fixture、verticalSlice、floors02_05、floors06_10、abyssEchoes、final 均 valid | PASS |
| `npm run build` | exit 0；Vite 成功，仅既有 >500KB chunk warning | PASS |

## 真实浏览器证据

| 流程 | 实际结果 | 状态 |
| --- | --- | --- |
| `npm run test:e2e -- tests/e2e/playable-flow.spec.ts --workers=1`（获批本地端口） | 568×320 真实点击新游戏→城镇→第 1 层→自动寻怪→回合战斗→奖励→回城，1/1；无 console/pageerror | PASS |
| `npm run test:e2e -- tests/e2e/management-flow.spec.ts --workers=1`（获批本地端口） | 568×320 真实进入管理页并执行管理操作，1/1；无 console/pageerror | PASS |
| `npm run test:e2e -- tests/e2e/floor-select.spec.ts --workers=1`（获批本地端口） | 真实 starter/resources 在 `obj_f01_n06`/后续战斗中队伍败北；非 skip、非环境假失败 | FAIL_REAL_DIFFICULTY_GATE |
| `npm run test:e2e -- tests/e2e/abyss-mainline.spec.ts --workers=1` | 本轮未执行 | NOT_RUN |
| `npx playwright test --list` | 18 tests；其中 13 个为 spec 明确 `test.skip` | INVENTORY_ONLY |
| 全量 `npm run test:e2e` | 本轮未重跑，不引用历史 `2 passed/16 skipped` 作为当前结论 | NOT_RUN |

## 关键回归

- `GameSave` 的 max HP 现在按等级成长、被动 flat/percent、装备 flat/percent 的冻结顺序计算；铁卫 Lv2 的 max HP=633 回归通过。
- `PartyScreen.placeCharacter` 支持主角仍在队伍内的四槽跨槽换位，`GameFlowController` 使用显式 slot testid 并沿 CAS 保存；管理页增加移动端纵向滚动。
- 奖励结算将 `defeatedEncounterObjectIds` 按当前地图 encounter 顺序规范化，避免合法击败记录因乱序无法保存。
- Combo 动态倍率/递归 focused 仍为 3 files / 17 tests；技能词条当前仍只参与 Combo 配方匹配，未作为独立 trigger source。

## 未通过/未执行边界

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| `npm run test:balance -- --floors 1 --profiles lagging,ready,breakthrough,alternative --seeds 20` | exit 0，但 JSON 为 `blocked=true, reason=MISSING_FORMAL_CONTENT_BATCH`，results 为空 | BLOCKED_SCOPE |
| 十层/深渊完整主线 | `floor-select` 已暴露真实资源/难度门槛；`abyss-mainline` 本轮未执行，不能外推为通过 | NOT_RUN_SCOPE |
| 真机/模拟器 | 未提供设备连接，未执行 | NOT_RUN |
| 最终像素视觉、离线/后台/旋转人工验收 | 未执行 | NOT_RUN |

不得用当前单元/领域证据替代上述浏览器、真机或正式 680 场模拟证据。部署/托管未执行，也未获得部署授权。
