# VIS-003B / VIS-003C 可见战斗与首屏操作报告

## 结论

本轮关闭了“有规则但没有游戏画面”的核心缺口：城镇出生屏现在给出可见目标方向、摇杆有跟手反馈且主角能移动；触发遭遇后会进入真实 Pixi 回合制战斗画面，并可直接点击画布内的普攻、技能、防御、药水、更多和撤退。

## VIS-003C 首屏与移动反馈

- 摇杆增加独立拇指节点，拖动时在半径内移动，释放、取消、失焦、暂停后归中。
- 主角增加低矮脚影和高对比定位标记；这些是定位辅助，不替代正式角色图集。
- 出生屏显示稳定的最近功能 NPC 边缘指引，当前为“制图师 ↑”；NPC 进入视口后隐藏，进入交互距离后按钮切换为“交谈”。
- HUD 按钮增加像素下沉与换色反馈，命中区域不随视觉位移。

真实截图：

- 出生首屏：`.playwright-cli/page-2026-09-10T03-32-04-933Z.png`。
- 摇杆按住：`.playwright-cli/vis003c-joystick-held.png`。
- 摇杆释放：`.playwright-cli/vis003c-joystick-released.png`。

## VIS-003B 首版战斗画面

- 左侧最多 4 名队员、右侧最多 6 名敌人，位置来自既有 `BattleView` 固定槽位。
- 顶部显示回合、当前行动者、速度和严格按领域队列排列的行动顺序。
- 单位卡显示名称、HP 条/数值、能量和速度；当前行动者为金色描边，倒下单位显示灰态。
- 底部 Pixi HUD 复用既有 GameFlow/Gateway/CAS 指令链；普攻后敌方与我方 HP 均按真实后续回合更新。
- 技能与更多为可开关二级抽屉；未接入的战报明确禁用，不再充当假关闭按钮。
- 568×320 contain 下按钮真实命中尺寸至少 48 CSS px、间隔至少 8 CSS px；640→568→844 resize 会按新逻辑尺寸重建按钮。
- header、timeline 和按钮都锚定 `safeRect`；表现层异步 `prepare` 完成前不允许进入场景。

真实截图：

- 返修前首次可见战斗：`.playwright-cli/page-2026-09-09T09-05-19-774Z.png`。
- 画布普攻后：`.playwright-cli/page-2026-09-09T09-06-04-753Z.png`。
- 返修后 568×320：`.playwright-cli/vis003b-battle-reviewed-568.png`。
- 技能抽屉：`.playwright-cli/vis003b-skill-drawer-open.png`。

## 验证

- 战斗/字段 focused：3 files / 25 tests PASS。
- 战斗复审 focused：2 files / 16 tests PASS。
- `npm run typecheck`：PASS。
- `npm run lint`：PASS。
- `npm run build`：PASS；保留既有 Pixi 动态/静态导入与大 chunk warning。
- `npm run test:e2e -- tests/e2e/visible-field-first-screen.spec.ts tests/e2e/visible-battle-ui.spec.ts`：2/2 PASS，21.3 秒；真实标题→新游戏→canvas 摇杆→制图师→第一层→遭遇→战斗，没有存档注入或 TestHooks。
- 浏览器手工链路直接点击画布“普攻”，敌人 HP 从 300 降至 243，我方随后承受敌方回合伤害；console error 0、warning 0。
- 最终全量 unit：97 files / 635 tests PASS，并发 town route 压力向量已通过。
- VIS-003B 最终独立复审：Approved，P0/P1/P2 均为 0。

## 已知边界

- 程序化剪影已在 VIS-004C 被正式 27 帧 battle actor sheet 替换；详见 `2026-09-10-vis-004abc-battle-art.md`。
