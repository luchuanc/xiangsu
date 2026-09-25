# 结项

## 状态

- 自用功能版：首层主入口可操作。真实 568×320 Chromium 已验证新游戏→城镇→第 1 层→自动寻怪→回合战斗→奖励→回城，以及城镇管理流程各 1/1 通过。
- 严格结项：仍未完成。`floor-select` 使用真实 starter/resources 在 `obj_f01_n06`/后续战斗中队伍败北；正式无渲染平衡返回 `MISSING_FORMAL_CONTENT_BATCH`；十层/深渊完整主线、真机/模拟器、最终像素视觉和离线/后台/旋转人工证据仍缺失。RPG-026 继续保持 DOING。

## 交付摘要

RPG-028 深渊回响功能与内容/资源自动化门禁已闭合；RPG-029 将已有 Pixi 场景、领域服务和 IndexedDB 存档接入主入口，形成首层可玩纵切片。2026-08-26 又修复了等级成长与被动百分比 max HP 计算顺序、四槽队伍跨槽换位、奖励 defeatedEncounterObjectIds 地图顺序规范化及移动管理页滚动；动态装备/被动倍率与 Combo 派生递归保持通过。

## 需求完成情况

- 领域、存档、内容/资源和工程自动化门禁：已通过当前已执行范围。
- 首层真实浏览器流程：`playable-flow.spec.ts` 1/1 PASS，`management-flow.spec.ts` 1/1 PASS，均无 console/pageerror。
- 完整楼层/深渊流程：未形成通过证据；`floor-select` 的真实战斗败北保留为 FAIL，不通过降低敌方数值掩盖资源/难度门槛。
- 正式数值核算：未完成；balance 命令虽 exit 0，但 JSON 为 `blocked=true, reason=MISSING_FORMAL_CONTENT_BATCH` 且 results 为空。

## 最终验证

详见 [release-candidate.md](evidence/release-candidate.md) 与 [verification.md](verification.md) 的“最新复验（2026-08-26）”：全量 `npm run test:unit` 为 72 files/372 tests；`save-schema` focused 15/15；PartyScreen+GameFlowController focused 2 files/25 tests；`typecheck`、`lint`、`build` 通过；fixture、verticalSlice、floors02_05、floors06_10、abyssEchoes、final 的 content/assets 校验通过。

## 发布与观察

- 当前仅形成可本地自用检查的候选构建，未部署、未托管、未上传商店。
- 本轮目标浏览器证据为 568×320；`npx playwright test --list` 显示 18 tests，其中 13 个为 spec 明确 skip。全量 E2E 本轮未重跑，不引用历史 `2 passed/16 skipped` 作为当前结论。
- 无真机/模拟器连接，因此不对 iOS Safari、Android Chromium 或微信 WebView 做通过承诺。

## 实际回滚路径

候选失败时保留当前证据和最后通过构建，不覆盖部署；回到首个失败门禁对应任务做最小修复。存档采用既有 schema/contentVersion 校验和 CAS 事务，不执行猜测迁移。

## 剩余风险

- `floor-select` 暴露出真实 starter/resources 在首层后段的战斗资源与难度门槛；这是当前玩法的真实卡点，不能用自动补给或降低敌方数值伪造十层通过。
- `abyss-mainline` 本轮未执行，不能由领域/content/assets 通过外推完整深渊 UI 主线。
- 正式 PROFILE-1.2 无渲染平衡模拟仍被 `MISSING_FORMAL_CONTENT_BATCH` 阻断。
- 真机/模拟器、最终像素美术与视觉测量、离线/后台/旋转人工证据缺失；当前占位资源门禁不等于最终美术验收。

## 稳定知识候选

- 奖励保存前必须按当前地图 encounter 顺序规范化 `defeatedEncounterObjectIds`；无序记录会被严格存档校验拒绝。
- max HP 计算必须先合并等级成长与 flat，再应用 percent，之后叠加装备 flat/percent，并保持 floor 顺序；等级变化后的当前 HP 不能超过该结果。
- 队伍管理通过草稿和 CAS 提交；四槽换位保留主角且保存失败时保留 draft 以便重试。

## Skill/流程改进候选

- 将 `run-balance-simulation.ts` 从缺正式批次的阻断框架升级为真实合法内容/战斗控制器模拟，再执行 PROFILE-1.2 的 600+80 场回归。
- 为 floor-select/abyss-mainline 接入真实可玩主线后，再逐项消除 E2E 明确 skip，并补齐无 console/pageerror 的移动视口证据。

## 仅归档材料

- 本文及 `release-candidate.md` 保留历史验证边界；旧的测试计数和旧 E2E 汇总不得作为 2026-08-26 当前结论。

## 后续事项

1. 继续补正式 balance 批次和真实战斗模拟，先核算“弱装备卡关、获得关键装备/Combo 后跃迁”的难度曲线。
2. 继续接入并实跑第 2～10 层、深渊回响主线与 Boss 结算 E2E；不以单元测试替代浏览器证据。
3. 有设备后补 iOS Safari/Android Chromium 真机试玩、旋转/后台/触控与最终像素视觉测量。
