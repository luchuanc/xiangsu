# VIS-002D / VIS-002E 野外角色美术与激活报告

## 结论

第一批可玩范围的野外角色已经从纯色占位块替换为可辨识的正式像素图集：6 名角色、7 名城镇 NPC、5 类第一层遭遇物，共 18 个身份、720 帧。每个身份均具备结构不同的正面、侧面、背面主体，而不是靠附加少量方向标记伪造差异；运行时正式清单已切换到 `/assets/visual/v1/field/**`。

## 资源范围

- 角色：流浪剑士、铁卫、炎术师、祭司、游侠、霜见者。
- NPC：酒馆老板、铁匠、技能导师、商人、旅店老板、地图学家、深渊守望者。
- 第一层遭遇物：3 类普通遭遇、精英野猪、层 Boss。
- 原始逐帧 PNG：720 个 24×32 透明像素帧。
- 打包产物：18 张 240×128 PNG 与 18 份 JSON，固定 40 帧顺序及 anchor。
- art-pack：20 个 entry（2 张地图与 18 个 field actor）、38 个输出、722 个输入哈希。

## 自动验证

- focused 生成/打包/激活测试：5 files / 46 tests PASS。
- 方向结构复审 focused：4 files / 42 tests PASS。
- `npm run verify:field-art`：`FIELD_ART_VERIFY_OK:18 assets/720 frames`。
- `npm run verify:art`：`ART_PACK_VERIFY_OK`。
- `npm run verify:assets -- --batch verticalSlice`：PASS。
- `npm run typecheck`、`npm run lint`、`npm run build`：PASS；构建仅保留既有动态/静态 Pixi 导入与大 chunk warning。
- 独立只读复审：Approved，P0/P1/P2 为 0。18 个身份的 down/right/up alpha mask 均存在结构差异；最小 down/right 差异 67 像素、down/up 差异 17 像素。

## 真实浏览器验收

- 在真实 Vite 页面、无 TestHooks、无存档注入的 568×320 横屏会话中进入城镇。
- 请求确认正式主角、队友和 7 个 NPC 的 `/assets/visual/v1/field/*.png` 均为 `200 OK`，城镇地图 `/assets/visual/v1/maps/town.png` 为 `200 OK`。
- 动态摇杆按下中心并向右拖动后，主角从中央道路向右移动，同时切换为侧向帧；前后截图并非同一像素内容。
- 移动前截图：`.playwright-cli/page-2026-09-09T08-46-30-028Z.png`。
- 移动后截图：`.playwright-cli/page-2026-09-09T08-49-02-572Z.png`。
- 新会话控制台：0 error、0 warning；项目自有 `/favicon.svg` 返回 200。

## 已知边界

- 当前 field actor 是第一版正式 24×32 像素身份，不等于最终商业美术精修。
- 战斗角色图仍是独立的旧 battle placeholder；其可见战斗场景和正式 battle actor 将由后续卡分别完成。
- `art-pack-packer` 的 clip-collapse 测试无竞争复跑约 4.8 秒，接近既有 5 秒上限；这是测试时限余量风险，不是资源正确性失败。
