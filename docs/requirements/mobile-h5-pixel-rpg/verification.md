# 验证

## 当前状态

- 状态：IMPLEMENTING
- 对应需求：REQ-1.3 CONFIRMED
- 对应方案：PLAN-1.3
- 已执行验证：REQ-1.3 的 plan/implementation validator 与静态平衡门禁通过；RPG-001～029 的工程、确定性基础、内容、存档、Pixi 运行时、探索、城镇、战斗表现、管理 screen adapter、短程/重试/辅助与深渊回响门禁按任务卡分批通过；当前全量 372 tests
- 实施门禁：需求已确认、架构评审 P0/P1 清零、AUTO 已决策为 LOCAL_SUBAGENT；RPG-001 复审 APPROVED 后按依赖图继续实施
- 通过规则：`PASS` 必须有命令输出、截图、存档样本或真机原始记录；未执行统一标记 `TODO/未执行`

## 最新复验（2026-08-26）

- 工程：`npm run test:unit` 为 72 files/372 tests；`save-schema` focused 15/15；PartyScreen+GameFlowController focused 2 files/25 tests；`npm run typecheck`、`npm run lint`、`npm run build` 均通过，build 仅有既有 >500KB chunk warning。
- 内容/资源：fixture、verticalSlice、floors02_05、floors06_10、abyssEchoes、final 的 content/assets 校验均通过。
- 真实 568×320 Chromium：`playable-flow.spec.ts` 与 `management-flow.spec.ts` 各 1/1 通过且无 console/pageerror；`floor-select.spec.ts` 使用真实 starter/resources 在 `obj_f01_n06`/后续战斗中队伍败北，记录为真实 FAIL，不是 skip；`abyss-mainline.spec.ts` 未执行。全量 E2E 本轮未重跑，`npx playwright test --list` 为 18 tests、13 个显式 skip。
- 正式 balance：命令 exit 0 但 JSON 为 `blocked=true, reason=MISSING_FORMAL_CONTENT_BATCH` 且 results 为空，不能作为 680 场通过证据；无真机/模拟器、最终视觉或十层/深渊完整主线证据。RPG-026 仍 DOING。

## Superpowers 验证与评审证据

- `brainstorming`：用于冻结专家建议的取舍；明确排除“强制新手任务链/首个 Combo 保底”，其余建议转为 R-022～R-026、AC-040～AC-045。
- `writing-plans`：用于把第一层纵切片、分批内容、移动减负与深渊回响拆成 RPG-022～RPG-028 的可执行依赖图。
- `business-requirement-agent`：用于维持 `context → requirements → plan → tasks → progress → verification` 单一需求真源和恢复协议。
- 当前证据边界：以上能力只证明方案取舍与任务化过程可追踪；任何浏览器、真机、战斗模拟和留存判断仍必须由下方 V-001～V-045 产生实现级证据。

## 方案阶段已执行证据

| 检查 | 命令/方法 | 实际结果 | 状态 |
| --- | --- | --- | --- |
| 需求包结构 | `node /Users/lcc/.codex/skills/business-requirement-agent/scripts/validate-requirement-package.mjs docs/requirements/mobile-h5-pixel-rpg --phase plan` | `ok=true`，0 errors / 0 warnings | PASS |
| 静态平衡 | `node docs/requirements/mobile-h5-pixel-rpg/balance-audit.mjs` | 普通/精英时长、十层 Boss 三档、XP、金币、完整/短程掉落期望及 1.2 修正/回响边界通过；第 10 层 lagging/ready/breakthrough 为 19.6/16.1/11.9 回合，对应狂暴 14 | PASS_STATIC |
| 文档与追踪 | 只读 Node 审计 Markdown fence、末尾换行、连续编号、任务协议和任务/计划 AC 集合 | 50 Markdown、28 任务；R-001～026、AC-001～045、V-001～045 完整；28/28 任务协议完整，45/45 AC 有归属 | PASS |
| 任务 DAG | 对比 plan 表、Mermaid 直接边和 28 张任务卡元数据，检查重复直接边并做环检测 | 三处依赖集合完全一致；79 条直接边、cycle=false | PASS |
| 碰撞蓝图重算 | 按 WORLD-1.2 的城镇矩形清除与十层节点/边顺序重新生成 row-major Uint8Array，并计算 SHA-256/walkable | `map_town` 与 `map_floor_01`～`map_floor_10` 共 11 张逐项匹配冻结 hash 和 walkable，11/11 | PASS |
| 冻结内容与引用 | 对 1.2 新增表做 ID/数量/引用审计；复核 4 条 alternative 的 Combo/词条引用；基础六表、地图和资源继续使用未改数值的 1.1 证据 | 10 Boss 意图的 intent/boss/skill 均唯一；8 修正定义、10×4 遭遇格及 59 个引用均合法，10 个 Boss 固定空数组；10 回响在 F6～10 各 2 个；4 个替代 Combo 与 26 个词条引用全存在 | PASS |
| 资源算术与动画/音频契约 | 按 ASSET-1.2 枚举内容派生、物理 AssetEntry、AnimationDefinition、音频、bundle 和图集 frame；逐分支复核动画派生表及音频事件路由 | 302 个内容派生资源、243 个物理 AssetEntry、97 个动画、340 个逻辑 ID、22 个双源音频、16 个 bundle、30 个 core UI frame、46 个 battle FX frame 均闭合；依赖图无环且音频引用零未知；6 个 BGM 全部有场景映射、16 个 SFX 各有唯一触发路由；六条指定被动唯一映射 `passive/physical/0/none/null`，其余 91 条音效非空，内联效果音效非空 | PASS |
| 错误与本地化 | 从 DomainError 联合生成预期终端 key，对比本地化模板和冻结数量 | 41 个错误码、60 个唯一终端模板；新增 8 修正+10 回响名称及说明数量已纳入 348/206 总门禁 | PASS |
| Combo 可达性 | 从角色/技能/装备词条/技能词条真实 tags 汇总 18 条最短路径 | 18/18 满足精确来源与数量；`equippedSkill:area` 仅由已装备 `skill_ember_flame_wave` 显式提供 | PASS |

以上方案证据只覆盖文本内部一致性；V-001～V-045 的应用、浏览器、600 场主档和 80 场替代构筑实现级证据仍保持 TODO，不能用本表替代。真机仅为建议附加证据。

## RPG-001 工程基线证据

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| `npm run typecheck` / `npm run lint` | 主 Agent 复跑均退出码 0 | PASS |
| `npm run test:unit` | `tests/unit/smoke.test.ts` 2/2；覆盖 init 完成前不挂 canvas、完成后挂载/render/冻结配置及初始化失败收口 | PASS |
| `npm run verify:content -- --mode fixture` | RPG-002 strict fixture 退出码 0；双跑 canonical 报告逐字节相等；batch/final 等待正式内容批次 | PASS_IMPL |
| `npm run build` | Vite 6.4.3 构建 718 modules，生成 `dist/`，退出码 0 | PASS |
| `npm run test:e2e -- tests/e2e/smoke.spec.ts` | 568×320 canvas/占位可见，console/pageerror 为空，1/1 通过 | PASS |
| 只读代码复审 | 修复轮 1 APPROVED，P0/P1/P2=0/0/0；重复启动生命周期明确移交 RPG-005/006 | PASS |

## RPG-003 确定性基础证据

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| RNG 固定向量/恢复/派生 | seed `0x12345678` 初态、20 输出、终态、`loot` FNV hash/派生状态逐项通过；父流不推进 | PASS |
| 概率/权重边界 | 0/10000 不消费，1/9999 精确边界；拒绝采样、原数组累计、单候选消费、总和 `2^32` 通过 | PASS |
| 整数数学 | clamp、正负 floor/ceil、负 BPS 与 12500/15000/30000 倍率通过 | PASS |
| 领域结果/上下文 | 41 错误码、16 BattlePhase、6 WeaponType、七类 ID、注入 clock/seed 通过；10 万 UUID 无碰撞 | PASS |
| 回归与评审 | 目标 17/17、全量 19/19；typecheck/lint/build exit 0；只读复审 P0/P1/P2=0/0/0 | PASS |

## RPG-004 存档与稳定候选证据

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| `npm run test:unit -- tests/integration/indexeddb-save.test.ts` | 3/3；同一 readwrite transaction CAS、多标签 stale、未知版本原记录保护、确认后替换 | PASS |
| `npm run test:unit -- tests/unit/save-schema.test.ts` | 13/13；strict GameSave、确定性初始商店、AABB、动态装备/铭石引用、四 mode 与终局 reward 不变量 | PASS |
| `npm run test:unit -- tests/unit/save-coordinator.test.ts` | 9/9；失败 dirty/重试同 ID、blocking 预占、position 合并、in-flight revision/通知顺序、Store 深冻结 | PASS |
| 全量与构建 | 11 files/70 tests；typecheck/lint/build exit 0；Vite 718 modules；`fake-indexeddb@6.2.5` | PASS |
| 只读代码复审 | 最终 APPROVED，P0/P1/P2=0/0/0 | PASS |

## RPG-005 Pixi 运行时证据

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| V-005A 视口数学 | `viewport-service.test.ts` 8/8；640×360 contain、小数 offset、安全区、568×320 与 48/8 CSS px ceil 门槛精确 | PASS |
| V-005B 生命周期 | `app-lifecycle.test.ts` 11/11；fixed-step、30 FPS、丢帧、hidden/blocked/context、Pixi 指针解绑、singleton 并发/失败重试/销毁重启及组合恢复顺序 | PASS |
| V-005C 浏览器 resize | 无头 Chromium 依次实测 844×390、390×844、567×320、568×320；overlay 为隐藏/rotate/tooSmall/隐藏，pointerEvents 为 auto/none/none/auto，canvas contain 坐标有效，console/pageerror 为空 | PASS_BROWSER |
| V-005D 构建与回归 | 全量 14 files/93 tests；typecheck/lint/build 均退出 0；724 modules；仅单 chunk >500k 非阻断警告 | PASS |
| V-005E 音频 | `audio-service.test.ts` 4/4；封闭 6 BGM/16 SFX、锁前丢弃、gain/音量、同轨/异轨切换、hidden/resume 与 unlock 幂等 | PASS |
| 移动 smoke | `npm run test:e2e -- tests/e2e/smoke.spec.ts` 在 568×320 真实 Chromium 1/1，canvas/占位可见且 console/pageerror 为空 | PASS |
| 只读代码复审 | 最终 APPROVED，P0/P1/P2=0/0/0 | PASS |

## RPG-019 标题/城镇证据

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| NPC/商店/旅店 focused | `npm run test:unit -- tests/unit/npc-service.test.ts tests/unit/shop-service.test.ts tests/unit/inn-service.test.ts tests/integration/town-scene.test.ts`；4 files/11 tests passed | PASS |
| 全量单元与集成 | `npm run test:unit`；59 files/280 tests passed | PASS |
| 类型/静态/构建/内容 | `npm run typecheck`、`npm run lint`、`npm run build`、`npm run verify:content -- --mode fixture` 均退出码 0；build 仅有既有单 chunk >500KB 警告 | PASS |
| 标题/层数浏览器 E2E | `npm run test:e2e -- tests/e2e/title-continue.spec.ts tests/e2e/floor-select.spec.ts` 在 webServer 绑定 `127.0.0.1:5173` 时因沙箱 `EPERM` 未启动测试；未伪造通过 | NOT_RUN_ENV |
| 视觉/真机 | 未执行截图与真机试玩；当前实现为场景/面板适配器骨架，完整主流程接线留 RPG-020～023 | TODO |

## RPG-020 战斗表现证据

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| V-020A 状态投影/动画边界 | `npm run test:unit -- tests/integration/battle-scene.test.ts`；10/10 通过，覆盖 1v1/4v6 槽位、时间线、五按钮/二级抽屉、严格 Targeting、0 时长/null sfx、取消、Boss 意图、Combo/回响、保存成功后动画和奖励重试/幂等 | PASS |
| 全量单元与集成 | `npm run test:unit`；60 files/290 tests passed | PASS |
| 类型/静态/构建/内容 | `npm run typecheck`、`npm run lint`、`npm run build`、`npm run verify:content -- --mode fixture` 均退出码 0；build 仅有既有单 chunk >500KB warning | PASS |
| V-020B 触控战斗 | `npm run test:e2e -- tests/e2e/battle-touch.spec.ts` 因 webServer 绑定 `127.0.0.1:5173` 的 sandbox `EPERM` 未启动测试；spec 按任务卡保留为 `test.skip` 真实入口占位，未伪造浏览器证据 | NOT_RUN_ENV |
| V-020C 稳定点恢复 | `npm run test:e2e -- tests/e2e/battle-reload.spec.ts` 同样因 `EPERM` 未启动；后台/重载主流程接线留 RPG-023 | NOT_RUN_ENV |
| 视觉/真机 | 未执行 568×320 战斗截图、浏览器旋转或真机试玩；BattleScene/RewardScreen 当前为注入式表现适配器 | TODO |

## RPG-021 管理 UI 证据

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| V-021A～V-021C 管理 screen focused | 原有 inventory/skill adapter focused 已通过；最新 `npx vitest run tests/integration/party-screen.test.ts tests/integration/game-flow-controller.test.ts --environment node` 为 2 files/25 tests，覆盖四槽换位、主角保护、CAS 草稿与管理入口 | PASS |
| 全量单元与集成 | `npm run test:unit`；63 files/303 tests passed | PASS |
| 类型/静态/构建/内容 | `npm run typecheck`、`npm run lint`、`npm run build`、`npm run verify:content -- --mode fixture` 均退出码 0；构建仅有既有单 chunk >500KB warning；fixture contentVersion=`content-1.2.0` | PASS |
| V-021D 管理流程 E2E | 获批端口 `npm run test:e2e -- tests/e2e/management-flow.spec.ts --workers=1`；568×320 真实进入管理页并执行操作，1/1 通过且无 console/pageerror | PASS_BROWSER |
| 视觉/真机与主入口 | 未执行截图、真机/模拟器；管理流程已由 GameFlowController 接入，但十层/深渊主线仍缺完整浏览器证据 | TODO |
| 计划差异与领域缺口 | 铭石重铸改为显式 SkillStoneGenerator adapter；Inventory 移除铭石 dead `reforge` action；普通铭石分解暂无对应领域服务，未在 UI 层复制领域经济规则 | FOLLOW_UP |

## 追踪矩阵

## RPG-022 第一层垂直切片（部分收口）

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| 首层内容直接校验 | `npx vitest run --config /dev/null tests/content/vertical-slice-content.test.ts --environment node`；1 file/6 tests 通过。验证 `verticalSliceContentRoot` 的批次 Catalog、冻结 ID、合法池/掉落、地图可达性及 town/floor01 collision hash；任务卡原命令 `npm run test:unit -- tests/content/vertical-slice-content.test.ts` 因 vitest include 仅含 unit/integration 返回 No test files，未修改配置 | PASS_SUPPLEMENTAL / REQUIRED_COMMAND_NOT_RUN_CONFIG |
| 首层资产批次 | `npm run verify:assets -- --batch verticalSlice`；90 个逻辑 AssetEntry、114 个物理占位 PNG/JSON/FNT/OGG/MP3，`assets candidate valid` | PASS |
| 类型/静态/构建 | `npm run typecheck`、`npm run lint`、`npm run build` 均退出码 0；build 仅有既有单 chunk >500KB warning | PASS |
| 正式内容批次 CLI | `npm run verify:content -- --mode batch --batch verticalSlice`；脚本仅对 verticalSlice batch 显式选择 `verticalSliceContentRoot`，输出 content-1.2.0 及冻结 counts/hash，退出码 0 | PASS |
| fixture 内容/资源回归 | `npm run verify:content -- --mode fixture` 与 `npm run verify:assets` 均退出码 0；candidateAssetManifest 保持旧 38 项 fixture，verticalSlice 使用独立 90 项 manifest | PASS |
| 第一层平衡 | `npm run test:balance -- --floors 1 --profiles lagging,ready,breakthrough,alternative --seeds 20` 退出码 0 但返回 `blocked=true reason=MISSING_FORMAL_CONTENT_BATCH`；正式 candidate 仍为 fixture，未伪造 80 场通过报告 | BLOCKED_SCOPE |
| 全量单元回归 | `npm run test:unit`；63 files/303 tests 全部通过；AssetCatalog/AssetService 既有 fixture=38/full=243 契约已由 manifest 拆分恢复 | PASS |
| 垂直切片 E2E | `npm run test:e2e -- tests/e2e/vertical-slice.spec.ts` 因 `127.0.0.1:5173` listen EPERM 未启动；spec 明确 `test.skip` 等待 main/SceneRouter 接线 | NOT_RUN_ENV |
| 视觉/真机 | 未执行截图、真机/模拟器试玩；主入口/SceneRouter 不在本卡白名单 | TODO |

## RPG-024 第 2～5 层内容扩展证据

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| V-024A 内容 focused | `npx vitest run --config /dev/null tests/content/floors02-05.test.ts --environment node`；11/11 通过，覆盖四张地图 hash/walkable、14 类新增敌人/Boss、20 遭遇、27 底材、14 装备词条、8 技能词条、7 Combo、掉落/NPC/招募与严格池 | PASS |
| V-024C 累计内容 CLI | `npm run verify:content -- --mode batch --batch floors02_05`；退出码 0，content-1.2.0，counts=`characters 6 / skills 85 / statuses 18 / equipmentBases 38 / equipmentAffixes 26 / affixTriggers 8 / skillAffixes 16 / combos 11 / enemies 20 / encounters 25 / encounterModifiers 8 / bossIntents 5 / floors 5 / maps 6 / npcs 7 / dialogues 7 / quests 1 / recruitments 5 / shops 1 / items 5 / dropTables 25`，四张新地图 collision hash 与冻结表一致 | PASS |
| V-024F 累计资源 CLI | `npm run verify:assets -- --batch floors02_05`；退出码 0，168 项逻辑资源通过尺寸、clip、bundle、来源和物理文件门禁；本层新增 78 个非零占位文件 | PASS |
| fixture 回归 | `npm run verify:content -- --mode fixture`、`npm run verify:assets`；均退出码 0，既有 fixture manifest/根未被批次扩展污染 | PASS |
| V-024D 工程回归 | `npm run test:unit` 66 files/314 tests、`npm run typecheck`、`npm run lint`、`npm run build` 均退出码 0；build 仅保留既有 >500KB chunk warning | PASS |
| V-024B 层流程 E2E | `npm run test:e2e -- tests/e2e/floors02-05.spec.ts` 未进入测试；webServer 绑定 `127.0.0.1:5173` 在当前 sandbox 返回 `listen EPERM`，spec 保留明确 `test.skip`，未伪造浏览器证据 | NOT_RUN_ENV |
| V-024E/G 正式平衡 | `npm run test:balance -- --floors 2,3,4,5 --profiles lagging,ready,breakthrough --seeds 20` 与 `npm run test:balance -- --floors 3 --profiles alternative --seeds 20` 均退出码 0，但返回 `blocked=true reason=MISSING_FORMAL_CONTENT_BATCH`；当前脚本仍是无渲染占位框架，未伪造 240+20 场结果 | BLOCKED_SCOPE |
| 视觉/真机 | 未执行四层截图、真机/模拟器试玩；占位资源仅证明尺寸/来源/路由，不代表最终像素美术 | TODO |

## RPG-025 第 6～10 层深渊内容扩展证据

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| V-025A/B 内容与掉落 focused | `npx vitest run --config /dev/null tests/content/vertical-slice-content.test.ts tests/content/floors02-05.test.ts tests/content/floors06-10.test.ts tests/unit/abyss-loot.test.ts --environment node`；4 files/25 tests 通过，覆盖五张地图 collision hash/walkable、10 类普通/5 Boss、冻结底材/词条/技能词条/Combo 配额、深渊掉落与第十层 crown 首杀表 | PASS |
| V-025D 累计内容 CLI | `npm run verify:content -- --mode batch --batch floors06_10`；content-1.2.0，counts=`characters 6 / skills 97 / statuses 18 / equipmentBases 60 / equipmentAffixes 48 / affixTriggers 15 / skillAffixes 24 / combos 18 / enemies 35 / encounters 50 / encounterModifiers 8 / bossIntents 10 / abyssEchoes 0 / floors 10 / maps 11 / npcs 7 / dialogues 7 / quests 1 / recruitments 5 / shops 1 / items 5 / dropTables 50`；5 张深渊地图 hash 与冻结快照一致 | PASS |
| V-025D 累计资源 CLI | `npm run verify:assets -- --batch floors06_10`；`assets candidate valid`；与 verticalSlice/floors02_05/fixture 资源门禁串行复跑均通过；深渊新增 76 个占位物理文件（PNG 74、音频 2） | PASS |
| verticalSlice 回归修复 | 首层根对 town/drop/shop 使用按首层 manifest 派生投影，避免后续 NPC/底材引用泄漏；`npx vitest ... vertical-slice-content.test.ts` 6/6、`verify:content --mode batch --batch verticalSlice` 退出码 0；碰撞 hash 未改变 | PASS_IMPL |
| 工程回归/构建 | `npm run test:unit` 67 files/316 tests；`npm run typecheck`、`npm run lint`、`npm run build` 均退出码 0；build 仅保留既有单 chunk >500KB warning | PASS |
| V-025C 主线 E2E | `npm run test:e2e -- tests/e2e/abyss-mainline.spec.ts` 当前 webServer 绑定 `127.0.0.1:5173` 因沙箱 `listen EPERM` 未进入测试；spec 为明确 `test.skip`，未伪造浏览器证据 | NOT_RUN_ENV |
| V-025E/F 正式 balance | `npm run test:balance -- --floors 6-10 --profiles lagging,ready,breakthrough --seeds 20` 与 alternative 命令仍返回 `blocked=true reason=MISSING_FORMAL_CONTENT_BATCH`；当前脚本尚未接入真实战斗模拟，未伪造 300+40 场结果 | BLOCKED_SCOPE |
| 视觉/真机 | 未执行第 6～10 层截图、真机/模拟器试玩；占位资源仅证明尺寸/来源/路由，不代表最终像素美术 | TODO |

## RPG-028 深渊回响终局闭环证据（历史快照，2026-08-25）

| 检查 | 实际结果 | 状态 |
|---|---|---|
| V-028A 内容与引用 | `npx vitest run --config /dev/null tests/content/abyss-echo-content.test.ts --environment node`；1 file/3 tests 通过，10 行定义、楼层/Boss 引用、20 个 locale key 生成规则和累计 Catalog root 均通过；正式 Vitest include 不包含 `tests/content`，不伪造为正式 unit 结果 | PASS_SUPPLEMENTAL |
| V-028B/C/D 指令、次数、倍率、目标与奖励 | `npx vitest run tests/unit/battle-command.test.ts tests/integration/battle-command-save.test.ts tests/unit/abyss-echo-service.test.ts tests/integration/abyss-echo-battle.test.ts tests/integration/abyss-echo-reward.test.ts --environment node`；5 files/24 tests 通过；覆盖 itemUseLimit 0/1/2、原子扣除、Boss-only 倍率、objective 顺序、增强装备掉落、首清材料与失败重试 | PASS |
| 独立 battle/loot RNG | 回响集成测试比较相同 expedition seed/attempt、不同终端 battle RNG 的 reward/inventory/gold 字节结果，并断言战斗 rngState 保持各自轨迹；保存失败重试复用同一 candidate，不重抽 loot | PASS_IMPL |
| 工程回归/构建 | `npm run test:unit`；70 files/334 tests；`npm run typecheck`、`npm run lint`、`npm run build` 均退出码 0；build 仅有既有 >500KB chunk warning | PASS |
| V-028E 终局写回 | Gateway 在同一 SaveCoordinator candidate 写回 COMPLETE、回城、奖励、clearedEchoIds 与成功道具扣除；失败/战败无奖励；重试不重复扣除或分配 ID | PASS_IMPL |
| V-028F abyssEchoes/final CLI | `npm run verify:content -- --mode batch --batch abyssEchoes`、`npm run verify:content -- --mode final`、`npm run verify:assets -- --batch abyssEchoes`、`npm run verify:assets -- --final` 以及 fixture 对应命令全部退出码 0 | PASS |
| E2E/正式 balance | 获批本地端口下 `npm run test:e2e -- tests/e2e/smoke.spec.ts` 1/1 PASS；全量 `npm run test:e2e` 为 1 passed/16 skipped，`abyss-echo.spec.ts` 明确 skip 等待 main/SceneRouter；`npm run test:balance -- --floors 1,3,6,10 --profiles lagging,ready,breakthrough,alternative --seeds 20` exit0 但 `blocked=true reason=MISSING_FORMAL_CONTENT_BATCH`；未伪造完整浏览器流程或 680 场结果 | PASS_SMOKE / NOT_RUN_SCOPE / BLOCKED_SCOPE |

## RPG-029 主入口可玩闭环（RPG-026 自用功能版补充）

| 检查 | 实际结果 | 状态 |
|---|---|---|
| V-029A 首层真实移动流程 | 获批端口 `npm run test:e2e -- tests/e2e/playable-flow.spec.ts --workers=1`；Playwright `mobile-h5` 568×320，真实点击新游戏→城镇→第1层→自动寻怪→回合战斗→领取奖励→回城，1/1 通过且无 console/pageerror | PASS |
| V-029B 快速连续点击保护 | 流程 E2E 在每次点击后等待按钮恢复可用；GameFlowController 的 basic/potion/skill/ultimate 共享 in-flight Promise，提交期间 disabled，避免重复 revision/CAS 进入 error | PASS_IMPL |
| V-029C 战斗与主流程回归 | 最新 PartyScreen+GameFlowController focused 为 2 files/25 tests；`npm run test:unit` 为 72 files/372 tests；typecheck、lint、build 均 exit 0（build 仅既有 >500KB chunk warning） | PASS |
| V-029D 内容/资源回归 | `verify:content` fixture、batch verticalSlice、batch abyssEchoes、final 与 `verify:assets` fixture、batch verticalSlice、batch abyssEchoes、final 均 exit 0 | PASS |
| V-029E 浏览器结果 | 本轮定向运行 `playable-flow` 与 `management-flow` 各 1/1 通过；`floor-select` 使用真实 starter/resources 在 `obj_f01_n06`/后续战斗中队伍败北，记录为真实 FAIL；`abyss-mainline` 未执行。全量 E2E 本轮未重跑，`playwright --list` 为 18 tests/13 个显式 skip | PARTIAL_REAL_EVIDENCE |
| V-029F 正式平衡模拟 | `npm run test:balance -- --floors 1 --profiles lagging,ready,breakthrough,alternative --seeds 20` exit 0，但 JSON 为 `blocked=true, reason=MISSING_FORMAL_CONTENT_BATCH`、results 为空；按用户自用功能版口径保留为非阻塞后续 | BLOCKED_SCOPE |
| V-029G 真机/视觉 | 未连接 iOS/Android 真机或模拟器；未宣称最终像素美术、旋转/后台/触控实机通过 | NOT_RUN |

## RPG-026 功能版增量：动态倍率与 Combo 递归接线（最新结果见上方 2026-08-26 复验）

| 检查 | 实际结果 | 状态 |
|---|---|---|
| 动态装备/被动倍率 | `npx vitest run tests/unit/battle-loadout-runtime.test.ts tests/unit/action-resolver.test.ts tests/integration/battle-command-save.test.ts --environment node`；动态装备词条/被动影响伤害，Gateway 保存失败重试复用同一 loadout 视图 | PASS |
| Combo 根行动触发 | focused `action-resolver`、`combo-trigger-runtime`、`battle-command-save` 修复后 3 files/17 tests；覆盖个人/队伍候选、beforeAction、afterDirectHit、onDirectDamageTaken、onHeal、onOverheal、onGainShield、onDefeatUnit、afterRootAction、派生效果和保存失败重试 | PASS |
| 派生事件递归与 trace | 新增派生 DAMAGE→afterDirectHit/onDirectDamageTaken、HEAL→onHeal/onOverheal、SHIELD→onGainShield、UNIT_DEFEATED→onDefeatUnit 的 FIFO collector；链深度 3 与预算拒绝有界；`sequence` 无重复且严格等于数组下标，独立 `globalSequence` 按实际 push 顺序编号 | PASS |
| 工程回归/构建 | 最新 `npm run test:unit`：72 files/372 tests；`npm run typecheck`、`npm run lint`、`npm run build` 均退出码 0；build 仅有既有 >500KB chunk warning | PASS |
| 内容/资源门禁 | fixture、verticalSlice、abyssEchoes、final content 与对应 assets 批次均退出码 0；final counts（命名字段）为 characters=6、skills=97、statuses=18、equipmentBases=60、equipmentAffixes=48、affixTriggers=15、skillAffixes=24、combos=18、enemies=35、encounters=50、encounterModifiers=8、bossIntents=10、abyssEchoes=10、floors=10、maps=11、npcs=7、dialogues=7、quests=1、recruitments=5、shops=1、items=5、dropTables=50 | PASS |
| 首层移动 H5 回归 | 获批端口运行 `npm run test:e2e -- tests/e2e/playable-flow.spec.ts --workers=1`；mobile-h5 568×320，真实点击新游戏→城镇→第1层→自动寻怪→战斗→奖励→回城，1/1 通过且无 console/pageerror | PASS |
| 正式平衡 | `npm run test:balance -- --floors 1 --profiles lagging,ready,breakthrough,alternative --seeds 20` 退出码 0，但 JSON 为 `blocked=true, reason=MISSING_FORMAL_CONTENT_BATCH`，results 为空；未伪造数值结果 | BLOCKED_SCOPE |
| 真实管理/十层/真机 | `management-flow.spec.ts` 已真实 1/1 通过；`floor-select` 真实战斗败北，`abyss-mainline` 本轮未执行；未执行真机/模拟器和最终像素视觉验收；技能词条仍仅参与 Combo 配方匹配而非独立 trigger source | PARTIAL_NOT_RUN |

## RPG-027 短程、Boss 重试与重复指令辅助证据

| 检查 | 实际结果 | 状态 |
| --- | --- | --- |
| V-027A shortFarm | `npm run test:unit -- tests/unit/expedition-mode.test.ts`；5/5，严格物化 3 normal+1 elite+1 chest+return，拒绝 Boss/未知对象/未首通/溢出 | PASS |
| V-027B bossRetry | `npm run test:unit -- tests/integration/boss-retry.test.ts`；3/3，接触门禁、detached expedition+battle、保存失败同 candidate 重试、商店字节不变、首通/charge 边界 | PASS |
| V-027C battleAssist | `npm run test:unit -- tests/integration/battle-assist.test.ts`；3/3，normal/elite 场景门禁、350ms 取消、active→basic、群体/随机空目标、整数交叉与 slot/id 稳定排序 | PASS |
| 首通前解锁接线 | `EncounterTransitionService` 在 exploration Boss 战候选内读取 `FloorDefinition.bossEncounterId`，仅在 battle 创建且保存成功路径追加 `bossRetryUnlockedFloorIds`；旧 adapter 无 getFloor 时不猜字段 | PASS_IMPL |
| 全量回归/构建 | `npm run test:unit` 66 files/314 tests；`npm run typecheck`、`npm run lint`、`npm run build` 均退出码 0；仅既有 >500KB chunk warning | PASS |
| 内容/资产门禁 | `npm run verify:content -- --mode batch --batch verticalSlice`、fixture、`npm run verify:assets -- --batch verticalSlice`、默认 fixture 均退出码 0 | PASS |
| V-027D 移动流程 | `npm run test:e2e -- tests/e2e/short-farm.spec.ts tests/e2e/boss-retry.spec.ts` 在 webServer 绑定 `127.0.0.1:5173` 时因 sandbox `listen EPERM` 未启动；两个 spec 明确 `test.skip` 等待 RPG-023 主入口接线 | NOT_RUN_ENV |
| V-027E 正式平衡/垂直流程 | `npm run test:balance -- --floors 1 --profiles lagging,ready,breakthrough,alternative --seeds 20` 退出码 0 但返回 `blocked=true reason=MISSING_FORMAL_CONTENT_BATCH`；未伪造正式通过。verticalSlice E2E 留 RPG-023/RPG-026 | BLOCKED_SCOPE |
| 视觉/真机 | 未执行真实 568×320 点击、截图、真机/模拟器；HUD 保留 48×48/8px 常量，辅助仅提供状态投影 | TODO |

| ID | R/AC | 类型 | 命令/步骤 | 预期 | 实际 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V-001 | R-001 / AC-001 | E2E+视觉 | `npm run test:e2e -- tests/e2e/viewport-lifecycle.spec.ts`，截取 568×320、667×375、844×390、915×412、1024×768 横屏 | 关键 UI 位于安全矩形，无裁切或不可达控件 | 未执行 | TODO | - |
| V-002 | R-001 / AC-002 | E2E | 同一 spec 中竖屏进入、横竖切换、返回横屏 | 竖屏期间 ticker/世界/按钮停止，状态不变，恢复无跳步 | 未执行 | TODO | - |
| V-003 | R-002、R-016 / AC-003 | 单元+E2E | input 单测；双指同时拖摇杆和点交互；触发 pointercancel | 八向移动、指针独占、取消后归零且无重复动作 | 未执行 | TODO | - |
| V-004 | R-002 / AC-004 | 单元 | map-blueprint + movement-system：复核 11 个 hash/BFS；顶墙、斜移、NPC、边界和最多 3 步追赶 | hash/walkable/锚点精确；移动均不穿透 | 未执行 | TODO | - |
| V-005 | R-002、R-003 / AC-005 | 单元+E2E | NPC/InteractionSystem 测试；同距目标夹具 | 28 逻辑像素内按距离、ID 稳定选唯一目标，功能/锁定原因正确 | 未执行 | TODO | - |
| V-006 | R-003、R-004 / AC-006 | E2E+存档 | `npm run test:e2e -- tests/e2e/floor-select.spec.ts`，首杀后重载 | 只能进入已解锁层，下一层永久解锁且读档保留 | 未执行 | TODO | - |
| V-007 | R-004、R-017 / AC-007 | E2E | 运行 floors02-05 与 abyss-mainline specs；第十层复战 | 1～10 层均可进、首杀、复战，第十层首杀完成主线 | 未执行 | TODO | - |
| V-008 | R-005 / AC-008 | 单元+E2E | encounter AI 单测与 exploration-touch spec | 接触只触发一次，胜利移除遭遇，返回 180 固定步内不再触发 | 未执行 | TODO | - |
| V-009 | R-007 / AC-009 | 集成+视觉 | battle scene 测试；1v1、4v6 截图 | 我方左/敌方右，槽位和时间线与快照一致 | 未执行 | TODO | - |
| V-010 | R-007 / AC-010 | 单元 | `npm run test:unit -- tests/unit/initiative.test.ts` | 速度降序、同速我方优先、槽位升序且固定输入可重现 | 未执行 | TODO | - |
| V-011 | R-007 / AC-011 | 单元 | initiative/reducer 的死亡、召唤、轮中速度变化夹具 | 死亡跳过、召唤下轮行动、速度变化下轮生效 | 未执行 | TODO | - |
| V-012 | R-008 / AC-012 | 单元+E2E | battle-command/action-resolver/save gateway 测试及 battle-touch spec；注入道具保存失败 | 普攻、两主动、终极、防御、道具、撤退的能量/冷却/禁用态无误；战斗道具 context、目标、库存及原子扣除正确 | 未执行 | TODO | - |
| V-013 | R-007、R-012、R-019 / AC-013 | 单元 | status/trigger/combo runtime 测试与循环 golden trace | 状态时点正确，链深度/预算截断无限追击和反击 | 未执行 | TODO | - |
| V-014 | R-008、R-013 / AC-014 | 集成 | headless battle + reward service；重复提交同 transactionId | 胜利生命/复苏/清理正确，奖励与遭遇移除只提交一次 | 未执行 | TODO | - |
| V-015 | R-008 / AC-015 | 单元+E2E | 普通撤退、Boss 撤退、全队倒地夹具 | 普通撤退返回安全点；Boss 禁用；战败回城 50% 生命且不丢物品 | 未执行 | TODO | - |
| V-016 | R-006 / AC-016 | 单元+集成 | character/party/recruitment 与 expedition-create 测试 | 固定条件招募、主角必选、1～4 名已招募角色、唯一角色、前后排、经验比例正确；全倒地可暂存但离城被拒绝 | 未执行 | TODO | - |
| V-017 | R-009 / AC-017 | 单元+E2E | skill service 测试及 management-flow spec | 等级解锁、每级 1 点、最高 5 级、2 主动槽、免费重置正确 | 未执行 | TODO | - |
| V-018 | R-010 / AC-018 | 单元+E2E | equipment service 与管理页测试 | 六部位唯一、武器限制、非城镇/战斗换装被拒绝 | 未执行 | TODO | - |
| V-019 | R-010 / AC-019 | 单元+E2E | inventory 119/120/121、79/80/81、29/30/31 边界；field-item service 的合法/禁用/保存失败矩阵 | 容量/溢出准确，奖励不丢失，锁定/装备物不可分解；野外药水扣除与回血原子，净化药剂拒绝 | 未执行 | TODO | - |
| V-020 | R-011、R-013 / AC-020 | 单元 | equipment-generator 固定种子矩阵 | 0/2/3/4/4+1 词条正确，锻造目标合法，无重复/互斥且可重现 | 未执行 | TODO | - |
| V-021 | R-012 / AC-021 | 单元+E2E | combo-preview 测试；角色/装备/技能变更前后 | 新增/失去列表稳定，确认后的激活集合与预览相同 | 未执行 | TODO | - |
| V-022 | R-012、R-019 / AC-022 | 单元 | matcher/guard/trigger queue 循环夹具 | Combo 不自供标签，同根不重复，depth=3 和预算均能截断 | 未执行 | TODO | - |
| V-023 | R-013、R-019 / AC-023 | 单元+E2E | abyss-loot 测试；第 6～10 层 Boss 首杀/复战/重载 | 使用深渊表，第十层指定独有只首杀保证一次 | 未执行 | TODO | - |
| V-024 | R-014 / AC-024 | 单元+E2E | save coordinator、battle snapshot、battle-reload、奖励/交易重试 | 所有检查点可重载，仅稳定点恢复，奖励/交易不重复 | 未执行 | TODO | - |
| V-025 | R-015 / AC-025 | E2E+真机 | 后台 30 秒后恢复探索和战斗，比较前后状态 | 无瞬移、粘连输入或战斗跳步，音量状态正确恢复 | 未执行 | TODO | - |
| V-026 | R-015 / AC-026 | 单元+E2E | 枚举 41 个错误码的 60 个终端模板；注入无效配置、未知 schema、资源三次失败、IndexedDB 失败、野外物品三种禁用原因、远征模式/回响锁定及队伍未招募/全倒地分支 | 模板/token 全覆盖；恢复/禁用路径分别阻断或告警并可按契约重试，不显示 raw key/内部 ID，不猜字段、不吞错 | 未执行 | TODO | - |
| V-027 | R-017 / AC-027 | E2E | `npm run test:e2e -- tests/e2e/vertical-slice.spec.ts` | 新游戏→城镇→一层→Boss→奖励→构筑→退出→继续完整通过 | 未执行 | TODO | - |
| V-028 | R-017 / AC-028 | 内容+E2E | `npm run verify:content -- --mode final`；执行内容数量脚本与十层 specs | 6 角色、10 野外图、25 普通/精英、10 Boss、60 装备、40+8 装备词条、24 技能词条、18 Combo | 未执行 | TODO | - |
| V-029 | R-018 / AC-029 | E2E | 首次加载后模拟 offline，继续探索、战斗、装备、存档 | 无必需网络请求，当前游戏功能完整可用 | 未执行 | TODO | - |
| V-030 | R-016 / AC-030 | E2E+人工 | management-flow/battle-touch；测量 48px 命中区、8px 间隔和 450ms 长按 | 核心操作无需 hover/拖拽，触控命中与间距达标 | 未执行 | TODO | - |
| V-031 | R-018 / AC-031 | E2E+单人试玩 | 568×320 连续三次城镇→野外→战斗→奖励→回城；检查图集≤2048；有真机则附加 10 分钟试玩 | 无未捕获错误、黑屏、输入失效、状态跳步或持续冻结；真机缺失仅记建议证据 NOT_RUN | 未执行 | TODO | - |
| V-032 | R-014 / AC-032 | E2E+字节比较 | 已有存档点击新游戏，取消后读取原始记录 | 二次确认出现；取消后字节和 revision 完全不变 | 未执行 | TODO | - |
| V-033 | R-019 / AC-033 | 单元 | `npm run test:unit -- tests/unit/skill-stone-generator.test.ts` | 1/2/3/4 条、目标来源唯一、无重复/互斥、固定种子一致 | 未执行 | TODO | - |
| V-034 | R-019 / AC-034 | 单元+E2E | modifier/trigger tests；铭石详情和冲突装备流程 | 六类型按显式 stackRule 结算，采用/抑制来源可解释，冲突提交前阻止 | 未执行 | TODO | - |
| V-035 | R-020 / AC-035 | 内容/locale/资源快照+人工复核 | `npm run verify:content -- --mode final`；`npm run verify:assets -- --final`；生成按 ID 排序的 canonical JSON，与六份冻结表、LOC/ASSET-1.2 逐行复核 | 内容数量及每个整数、数组、权重、规则完全一致；11 个 collision hash/walkable 精确；348 名称、206 说明/任务描述、7 对话、2 lock、34 标签、25 技能族、12 skill modifier、9 skill-affix operation、41 错误码/60 终端模板与核心 UI key 完整；另有 10 Boss 意图、8 遭遇修正、10 深渊回响；302 派生资源、243 AssetEntry、97 动画、11 tileset、5 系统资源、22 音频及 clip/bundle/source/6 BGM+16 SFX 路由完整；被动空效果 nullable sfx 规则精确，无表外默认/raw ID/缺图回退 | 未执行 | TODO | - |
| V-036 | R-006、R-021 / AC-036 | 单元+集成 | `character-progression` 与 `recruitment-service`：主角分别在 Lv1/12/25/50 招募三名延后角色，重载并重复提交 | 新角色 level/xp 下限/level-1 点数/满生命/空 loadout 准确；未招募无 XP、重复无副作用 | 未执行 | TODO | - |
| V-037 | R-021 / AC-037 | 静态审计+无渲染模拟 | 先运行 `node docs/requirements/mobile-h5-pixel-rpg/balance-audit.mjs`；实现后逐字段执行 PROFILE-1.2：F1 `60+20`，F2～5 `240+20`，F6～10 `300+40`，最终汇总 680 场 | canonical 夹具/配对 seed 精确；normal 1.8～4.5、elite 2.8～8.8；落后/整备/突破方向正确，替代构筑至少 10/20 胜且不全胜 | 1.3 静态门禁通过；真实 680 场未执行 | TODO | `balance-evaluation.md`、`balance-profile-spec.md` |
| V-038 | R-021 / AC-038 | 无渲染模拟 | 同一 balance suite 单列 floor10，记录胜率、结束轮、狂暴、来源占比与 30 轮超时 | 整备胜率≤20%且进入狂暴；突破胜率 60%～85%、P75<14；无无限治疗/刮痧 | 未执行 | TODO | - |
| V-039 | R-011、R-013、R-019、R-021 / AC-039 | 单元+E2E+视觉 | 定向铭石、重铸刷新/取消/确认、商店新远征刷新；关键掉落与 Combo 首获/首触发截图；前后伤害 trace 比较 | 第一枚精英铭石命中专注角色；稳定 1～3 候选不偷换；中性升级 15%～30%、Combo 窗口 25%～50% 或明确克制跃迁；演出可跳过且 reduced 模式保留信息 | 未执行 | TODO | - |
| V-040 | R-022 / AC-040 | 单元+E2E+视觉 | 对 10 个 Boss 各执行声明、控制跳过、存档重载、狂暴抢占和释放；分别用 ×1/×2 动画速度截图并比较领域 trace | 高威胁技能固定先声明；待释放 skillId/targetStrategy 稳定，控制只延后，狂暴优先且不清除意图；HUD 技能名、目标、元素、反制类别、阶段线与事件一致 | 未执行 | TODO | - |
| V-041 | R-023、R-024 / AC-041 | E2E+单人试玩 | 已首通层各跑一次完整/短程/Boss 重试，记录对象数量和是否能完成回城 | 短程严格 3 普通+1 精英+1 宝箱；三模式均可完成；辅助可取消且减少重复操作 | 未执行 | TODO | - |
| V-042 | R-023 / AC-042 | 单元+E2E+存档 | 首次接触未首通 Boss 后战败，重载并连点重试，胜利后再次进层数页 | 重试点永久解锁；直接挑战可正常首通；首通后入口隐藏；快照、奖励和楼层解锁幂等，重试不增加回响次数 | 未执行 | TODO | - |
| V-043 | R-024 / AC-043 | 单元+E2E | 在已首通/未首通、normal/elite/Boss/echo 中开启辅助；覆盖冷却、卸下技能、无目标、350ms 内触摸取消 | 仅已首通层 normal/elite 提交；只重放普攻/主动，非法时固定降级普攻；目标稳定；Boss、未首通层、回响及禁记指令始终手动 | 未执行 | TODO | - |
| V-044 | R-025 / AC-044 | 内容+单元+无渲染模拟 | 校验 50 个 encounter.modifierIds 与 8 个修正；运行第 1/3/6/10 层主/替代构筑各 20 配对种子和词条/通用来源支配性报告 | 修正逐 ID 精确且有领域测试；每条替代构筑至少 10/20 胜且不全胜；无四层以上单词条垄断、无通用来源>35%、无代表层唯一 Combo 解 | 未执行 | TODO | - |
| V-045 | R-026 / AC-045 | 单元+E2E+存档 | 第十层首通前后检查入口；完整远征获取 0/1/5/6 次；逐个执行 10 回响的战败、胜利、重复首通、保存失败和离线重载 | 门禁、次数上限与原子扣除准确；10 组倍率/目标/道具限制/升格 bonus 精确；首通材料只发一次；无每日、赛季、网络或动态难度依赖 | 未执行 | TODO | - |

## 自动化验证

### 计划命令

| 命令 | 建立任务 | 覆盖 | 当前可用 |
| --- | --- | --- | --- |
| `npm run typecheck` | RPG-001 | TypeScript strict 与跨层引用 | 是；RPG-001 已通过 |
| `npm run lint` | RPG-001 | 静态质量与禁止依赖规则 | 是；RPG-001 已通过 |
| `npm run verify:content -- --mode fixture|batch|final` | RPG-002 | strict schema、唯一 ID、typed 引用、真实合法生成池与阶段精确数量；无参数等同 final | 是；fixture 已通过，生产 batch/final 会在内容未齐时精确失败 |
| `npm run verify:assets` | RPG-006 | 逻辑资源精确集合、尺寸/clip、bundle、音频双源与授权来源 | 是；fixture、verticalSlice、abyssEchoes、final 均通过 |
| `npm run test:unit` | RPG-001 起逐步扩展 | 纯领域、内容、存档和集成 | 是；当前 72 files/372 tests 通过 |
| `npm run test:e2e` | RPG-001 起逐步扩展 | 移动视口、触控、完整流程与截图 | 本轮未重跑全量；获批端口下 568×320 `playable-flow` 与 `management-flow` 各 1/1 通过，`floor-select` 真实败北；列表为 18 tests/13 个显式 skip |
| `npm run test:balance` | RPG-016/022/024/025/026 | 已建立 `--fixture smoke --seeds 3` 入口；当前缺正式 enemy/encounter 批次时明确输出 `MISSING_FORMAL_CONTENT_BATCH`，后续内容批次再执行 680 场分批回归 | 是；smoke 已通过执行并按设计阻断，正式批次未运行 |
| `npm run build` | RPG-001 | 生产构建与 bundle 审计输入 | 是；RPG-001 已通过 |

### 固定要求

- 所有随机相关测试传入明确 seed，并断言 RNG 最终状态或完整结果。
- 战斗 golden trace 断言领域事件，不断言动画时间。
- E2E 使用测试钩子设置确定性内容/存档，只通过公开领域命令推进，不直接改 Pixi View。
- 内容测试必须失败于缺字段、未知枚举、重复 ID、无效引用、空合法池和互斥冲突；不允许字段别名兼容。
- 冻结表转录测试必须生成 canonical JSON（对象 key 稳定排序、数组保持策划顺序）和 SHA-256；每个内容生产任务记录前后 hash，人工逐行复核对应批次。
- 本地化测试必须枚举所有内容/UI key、60 个终端错误模板和精确 token 集；资源测试按相同 fixture/batch/final 模式枚举逻辑 ID，不允许测试环境隐式缺图兜底。
- 每个缺陷修复必须增加一个能在修复前失败的回归用例。

## 人工与视觉验证

### 必拍状态

1. 568×320、844×390 下的城镇探索、NPC 对话、层数选择和背包详情。
2. 1v1 与 4v6 战斗、行动时间线、技能目标选择、状态说明和奖励溢出。
3. 技能铭石详情：目标范围、stackRule、采用来源、被抑制来源与冲突阻断。
4. Combo 变更预览与演出：新增、失去、个人/队伍作用域、配方标签数量、首获 900ms 卡片和每战首次触发横幅；同时截 reduced 模式。
5. 竖屏、小窗口、资源失败、保存失败、未知存档版本和新游戏覆盖确认。
6. 第 1、5、6、10 层地图与对应 Boss，确认普通区/深渊区视觉区分。
7. Boss 意图的声明/延后/狂暴并存、完整/短程/重试层数卡、辅助倒计时取消和 10 个深渊回响详情/结算。

### 人工检查方法

- 使用浏览器像素测量或自动截图标注确认 48 CSS px 命中区和 8px 间隔。
- 在 iOS Safari 与 Android Chromium 真机各执行一次双指移动+交互、长按说明和系统手势取消。
- 将截图与 `ui-spec.md` 的安全区/层级/信息优先级逐项比对；视觉差异必须记录，不以“看起来可以”替代证据。
- 像素资源必须检查 nearest 缩放、整数位置、无半像素模糊和无错误图集边缘渗色。

## 基本可玩性与建议性能记录

### 设备与场景

| 环境 | 浏览器 | 场景 | 时长/次数 | 判定 |
| --- | --- | --- | --- | --- |
| 必需：桌面 Chromium | 当前可用版本 | 568×320 的 town→floor→battle→reward→town | 连续 3 次 | 无未捕获错误、黑屏、输入失效、状态跳步或持续冻结 |
| 建议：用户现有手机 | Safari 或 Chromium | 城镇、探索、4v6、奖励与回城 | 10 分钟 | 能完成操作；明显卡顿如实记录并只修复可复现阻塞问题 |
| 浏览器两档 | Chromium | 固定输入探索与相同战斗种子 | 各 1 次 | 30/60 目标帧档的距离与规则结果一致，不要求设备实际达到目标帧率 |

### 记录字段

- 设备型号、系统、浏览器版本、构建 hash、画质档、屏幕 CSS 尺寸。
- 必需记录环境、构建 hash、屏幕 CSS 尺寸、是否存在未捕获错误/黑屏/输入失效/状态跳步/持续冻结，以及最大图集边长。
- FPS、1% low、draw calls、heap、gzip 和 bundle 体积均为可选诊断字段；无明显问题时不为补齐这些数据延迟功能交付。
- 无真机时真机行标记 NOT_RUN，但桌面移动视口通过即可满足自用功能版 AC-031。

## 迁移、发布与回滚验证

- schemaVersion 1 只读取精确 GameSaveV1；未知版本保留原始记录并阻断，不执行猜测迁移。
- contentVersion 变化必须有明确迁移；没有迁移时阻断旧存档，且不覆盖原记录。
- 回滚静态部署时不得写回或删除 IndexedDB；用旧候选构建读取同版本快照进行冒烟。
- 候选构建记录 Node/npm、lockfile hash、commit SHA、contentVersion、构建产物 hash 和 gzip 报告。
- 实际部署、托管和域名不属于当前计划授权；RPG-026 只生成候选构建。
- 新游戏覆盖、奖励幂等、交易失败和保存失败必须各执行一次真实 IndexedDB 恢复验证。

## 架构评审

- 状态：PASS；P0=0/P1=0，原 P1-01 已由 AUTO→LOCAL_SUBAGENT 关闭，P2=4 均有实施归属
- 触发时间：2026-08-20，用户确认 REQ-1.2 后立即启动。
- 评审输入：`requirements.md`、`game-design.md`、`balance-evaluation.md`、`balance-profile-spec.md`、`ui-spec.md`、`data-contracts.md`、`localization-spec.md`、`asset-spec.md`、六份冻结表、`plan.md`、全部任务卡。
- 必查项：领域层零 Pixi/DOM/IndexedDB 依赖、权威状态唯一、存档/奖励事务、RNG 命名空间、触发预算、本地化 token、资源 ID/生命周期、移动性能、任务依赖可执行性。
- 通过门禁：无 P0/P1；P2 有明确归属任务、风险和复验项。未完成评审且未完成执行代理模式选择，不得把 RPG-001 置为 DOING。
- 复验结果：原独立评审 Agent 只读复验确认 P1-02～08 已闭环、P2-01～04 均有归属；plan phase 为 0 errors/0 warnings，implementation phase 唯一错误是执行代理模式 `UNSELECTED`。

| 评审项 | 级别 | 处理 | 复验状态 |
| --- | --- | --- | --- |
| 执行代理状态与任务卡冲突 | P1-01 | 用户选择 AUTO；决策 LOCAL_SUBAGENT，28 张卡及 Agent 记录已统一 | RESOLVED |
| RPG-001 缺 E2E smoke | P1-02 | 已实现并实跑 568×320 canvas/占位/console smoke | RESOLVED_IMPL |
| 568×320 与 48/8 CSS 门槛冲突 | P1-03 | 小数 contain + ceil 逻辑换算 + CSS 实测 | RESOLVED_DOC |
| 回响失败奖励空值不变量 | P1-04 | 按 outcome/phase 拆分 reward 不变量 | RESOLVED_DOC |
| bossRetry 商店刷新冲突 | P1-05 | 仅 exploration/shortFarm 刷新并做字节断言 | RESOLVED_DOC |
| 回响 RNG 子流不足 | P1-06 | attemptNumber 与 battle/loot 子流冻结 | RESOLVED_DOC |
| 保存失败脏状态冲突 | P1-07 | 权威旧 Store、候选重试、事务内 CAS、多标签重载 | RESOLVED_DOC |
| 内容校验 CLI 模式不确定 | P1-08 | fixture/batch/final 命令与阶段批次固定 | RESOLVED_DOC |
| 运行时 ID 唯一性 | P2-01 | RPG-003 固定 kind+UUID 工厂和碰撞/重试测试 | ASSIGNED |
| 任务状态真源所有权 | P2-02 | 实现 Agent 只写代码；主 Agent 唯一回写三份状态文档 | ASSIGNED |
| WebGL context/storage persist | P2-03 | RPG-005/006/023 实现恢复与三分支验证 | ASSIGNED |
| 自用移动端试玩 | P2-04 | RPG-023 在 568×320 完成三循环；可用真机仅附加试玩 | REVISED_NON_BLOCKING |

## 未执行项与风险

| 项目 | 原因 | 风险 | 后续动作 |
| --- | --- | --- | --- |
| 完整游戏自动测试 | 当前完成 RPG-001～005 工程、内容、确定性基础、存档底座与 Pixi 运行时 | 尚不能证明地图、战斗和完整循环 | 后续任务逐步扩充 unit/E2E，RPG-023 完成三循环 |
| 游戏场景视觉/E2E | RPG-018 已有探索适配器，RPG-019 已有标题/城镇/面板适配器，RPG-020 已有战斗/奖励适配器，RPG-021 已有管理 screen adapter；标题/层数/战斗/管理 E2E 因 127.0.0.1:5173 EPERM 未执行 | 小屏场景布局、完整主流程和主入口接线仍需真实画面验证 | RPG-022～023 分阶段截图与浏览器复验 |
| 用户手机试玩 | 尚无构建且未登记设备 | 可能遗漏特定 WebView 问题 | RPG-023 有可用真机则附加 10 分钟试玩；无真机不阻塞自用功能版 |
| 正式素材授权 | ASSET-1.2 已冻结逻辑契约，物理文件仍为待生产占位素材 | 最终视觉和资源体积可能变化 | RPG-022 起逐文件登记来源；候选构建禁止 unknown/热链，替换不得改 ID/尺寸/clip |
| 微信 WebView 支持等级 | 垂直切片后才定级 | 微信内置浏览器可能有音频/内存差异 | RPG-023 增补实机事实后决定是否单列需求 |
| 完整冻结内容尚未全部转录 | RPG-002 已建立 strict Catalog/CLI 与纵切片夹具，后续批次仍待 RPG-022/024/025/026 填充 | 后续内容批次仍可能出现转录错误 | 各内容任务逐批生成 hash，V-035 最终复核 |
