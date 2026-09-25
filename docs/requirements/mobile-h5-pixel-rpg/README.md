# 《词链深渊》方案包入口

## 当前结论

- 方案版本：REQ-1.2 CONFIRMED / PLAN-1.2-draft
- 当前门禁：`PLAN_REVIEW`
- 当前产物：需求、玩法、移动 H5 UI、PixiJS v8 技术方案、严格数据契约、本地化/资源契约、六份冻结内容表、可复现平衡夹具、静态平衡核算、验证计划、28 张实施任务卡与统一任务模板
- 本轮优化：不做强制新手链或首个 Combo 保底；新增 10 个 Boss 读招、完整/短程/重试三种远征、重复指令辅助、8 个遭遇修正、4 条替代构筑门禁和 10 个深渊回响
- 方案校验：plan validator 0 errors/0 warnings；50 份 Markdown、28 张任务卡/79 条唯一无环依赖、R26/AC45/V45、10 Boss 意图、8 遭遇修正、10 回响、41 错误码/60 模板与 4 条替代构筑引用均已复验；基础 18 Combo 路径、11 张地图 hash 和 340 个逻辑资源沿用未改数值的通过证据；静态平衡门禁通过
- 当前未做：没有初始化应用、安装依赖、编写游戏代码或执行实现级测试

用户已于 2026-08-20 确认 REQ-1.3 自用验证目标并选择 AUTO；主 Agent 决策为 LOCAL_SUBAGENT。完成标准以功能完整、能从新游戏玩通十层与深渊为主，商业级性能与群体统计不阻塞；当前从 `RPG-001` 开始实施。

## 规范优先级

发生冲突时按以下顺序处理；不得自行取“看起来合理”的值：

1. `requirements.md` 的 R/AC 与用户后续明确变更。
2. `data-contracts.md` 的字段、判别联合、版本和引用约束。
3. 六份冻结表的逐行 ID、数值、数组、权重、触发和生产批次。
4. `balance-profile-spec.md` 的三档合法构筑、自动控制器、配对 seed 和统计口径。
5. `localization-spec.md` 与 `asset-spec.md` 的玩家文案、逻辑资源、帧、clip、bundle 和音频契约。
6. `game-design.md` 的公式、状态机与结算时点。
7. `ui-spec.md`、`plan.md` 和具体任务卡的交互/实施细节。

发现同优先级冲突时停止实施、记录冲突并回到方案层修订；禁止代码层添加别名、默认值或兼容分支。

## 六份冻结表清单

| 文件 | 冻结内容 |
| --- | --- |
| `balance-tables.md` | 等级/角色/敌人数值、18 状态、AI 展开、经济、5 堆叠物、50 掉落表 |
| `skills-table.md` | 42 角色技能、6 系统 effect、27 敌方通用技能、22 Boss 技能，共 97 个 SkillDefinition |
| `equipment-tables.md` | 60 底材、40 普通+8 深渊装备词条、15 装备触发 |
| `skill-affix-tables.md` | 20 普通+4 深渊技能词条及生成/结算顺序 |
| `combo-tables.md` | 18 个精确配方、触发、效果、预算和可达构筑 |
| `world-content-tables.md` | 10 层、11 地图碰撞蓝图/hash、50 遭遇及 8 个修正、10 个 Boss 意图映射、10 个深渊回响、7 NPC/对话、1 任务、5 招募与 1 商店 |

## 阅读与开工顺序

1. 产品确认：`requirements.md` → `game-design.md` → `balance-evaluation.md` → `balance-profile-spec.md` → 六份冻结表。
2. 交互确认：`ui-spec.md` → `localization-spec.md` → `asset-spec.md`。
3. 工程评审：`data-contracts.md` → `plan.md` → `verification.md`。
4. 实施恢复：`progress.md`，然后只执行其指定的当前任务卡。
5. 研究来源只读：`research-notes.md`；它不覆盖任何冻结值。

静态数值复现命令：`node docs/requirements/mobile-h5-pixel-rpg/balance-audit.mjs`。它只证明冻结输入内部一致，不能替代实现后逐字段执行 `balance-profile-spec.md` 的 600 场主档与 80 场替代构筑轻量回归。

## 首个交付里程碑

第一层垂直切片固定包含 1 个城镇、第一层地图、4 名可用角色、5 类普通/精英敌人+1 Boss、首个 Boss 意图、该层 5 个遭遇修正映射、5 个功能 NPC、11 个底材、12 个普通装备词条、8 个技能词条和 4 个可达 Combo，并跑通“新游戏 → 城镇整备 → 野外接触战斗 → 回合制结算 → 掉落/背包/装备/铭石/Combo → 读招反制 → 首层 Boss → 保存恢复”。完成后先执行 600 场主门禁与 200 场第一层替代构筑，再接入短程、重试和重复指令辅助；不以脚本掉落保证首个 Combo。
