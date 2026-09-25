# 战斗界面精修交付

## 本轮结果

从纯色背景与简化方块角色改为生成的森林遗迹背景、透明角色立绘与古铜金/深蓝战斗 UI。新增独立战斗按钮组件，普攻、技能、防御、药水、更多均有图标、禁用态与按下反馈。技能抽屉使用底部独立行，有返回入口，当前角色技能与终极显示真实名称；未开放槽位明确禁用。

角色信息卡简化为名称、HP、EN，行动条与当前行动者独立排版；下排卡片避开底部操作栏。保持 48 CSS px 命中尺寸、8 CSS px 间隔与原 Gateway 指令提交链路。

生成资源与来源见 `public/assets/art/battle-premium/v1/README.md`。11 个精确立绘 ID，资源失败可重试，同次加载共享 Promise。异步安装尊重场景销毁状态；场景退出不销毁共享纹理。

## 浏览器实测

- 568×320 与 844×390 横屏截图已目视检查。
- 真实标题→城镇摇杆移动→制图师→首层→遇敌→战斗操作流程通过，无存档注入。
- 真实 Pixi 技能按钮“盾击”可施放，敌人 HP 255→223，推进到第 3 回合，人物不切回旧图。
- WebGL 丢失/恢复首次暴露文字缓存丢失，已用 Pixi 公开 `Text.unload()` 在恢复钩子失效缓存；再次实测图片和文字均恢复，输入恢复。
- 浏览器控制台检查 0 errors。这是桌面浏览器移动尺寸验证，不是真机验收。

截图：

- `output/playwright/battle-premium-final.png`
- `output/playwright/battle-premium-568.png`
- `output/playwright/battle-premium-skills-844.png`
- `output/playwright/battle-premium-skill-impact.png`

## 明确边界

本批立绘是单姿势透明图，保留冲刺、受击位移、染色、浮字与技能反馈，不是新制作的逐帧动作。未覆盖的后续角色仍用既有正式动画素材；背景当前为统一森林遗迹场景。未改变战斗数值、存档合同或开放第二主动技能槽。生成 PNG 共约 6.3 MB，后续可做移动端图像压缩；当前保留原始质量。

## 自动化记录

最终 `visible-battle-ui.spec.ts`：1/1 PASS（33.4s）。文字恢复 focused：2 files / 17 tests PASS。
全量与浏览器并跑时，既有探索路径测试触发 5000ms 超时（648/649 PASS）；降低 workers 为 2 后，探索项通过，但既有 transition 销毁项触发相同门槛（仍 648/649 PASS）。未修改原断言和超时；不能将此轮全量报告为全绿。文字恢复修复前全量曾 647/647 PASS。

上述两项单独重跑 2/2 PASS（473ms / 643ms）。最终 typecheck、lint、build 均 PASS；build 保留既有大 chunk 与静态/动态混合导入告警。
