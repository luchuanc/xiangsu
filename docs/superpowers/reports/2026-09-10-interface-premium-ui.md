# 非战斗界面统一精修

## 交付范围

标题界面接入本轮生成的像素城镇夜景；共享按钮统一深蓝、旧金、青绿状态。城镇和野外 HUD 增加功能图标、血条层次、摇杆刻度；NPC、商人及楼层弹窗统一卡片、标题和状态层级。管理页包含固定导航、滚动内容和固定返回入口，队伍与技能改用角色名称及卡片呈现。奖励页直接展示已保存奖励事务中的金币、经验和掉落，不重新生成奖励。

生成素材及提示词记录：`public/assets/art/interface-premium/v1/README.md`。标题图已接入生产入口，而非仅展示设计稿。城镇和野外地形、行走角色仍使用原有素材，本轮未重新绘制地图。

## 验证

- 全量 `npm run test:unit -- --maxWorkers=1`：99 文件、652 项通过；未修改超时阈值。串行运行避免既有资源生命周期测试在 CPU 竞争时触及 5 秒限制。
- 最终 typecheck、lint、build 通过。构建仍有既有大于 500KB chunk 和混合静态/动态导入提示。
- 弹窗第二轮局部回归另行执行，覆盖正文与按钮字号调整。
- 真实浏览器通过新游戏、城镇管理、设置保存、NPC、选层、摇杆移动、触碰遇敌、普攻及领奖流程。未注入存档或使用 TestHooks。
- 844×390、568×320 浏览器视口检查；568×320 野外最终检查旧调试方向按钮不可见，页面无横向溢出。
- 浏览器证据不等于手机真机验收。最终弹窗字号修改以 focused 回归为证，未将旧弹窗截图冒充新版验收。

## 截图

- `output/playwright/premium-title-final.png`
- `output/playwright/premium-skills-568.png`
- `output/playwright/premium-settings.png`
- `output/playwright/premium-reward.png`
- `output/playwright/premium-field-final.png`
