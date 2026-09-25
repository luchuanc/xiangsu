# VIS-002F 地图正式资源激活报告

## 结论

已将 VIS-002C 生成的两张正式地图 tileset 接入第一层正式资源清单：运行时请求 `/assets/visual/v1/maps/town.png` 与 `/assets/visual/v1/maps/floor_01.png`。fixture 与 candidate 仍保持 38 项和 `__fixture__/maps/**` 路径；第 2～5 层、第 6～10 层累计清单通过继承第一层资源获得相同正式 URL。

## 改动范围

- `src/content/data/assets.manifest.ts`
  - 仅修改 `verticalSliceAssets` 的 `tileset_map_town`、`tileset_map_floor_01` 两项 URL、source 元数据。
  - `id`、bundle、16×16 tile、16 columns、16 rows 保持不变。
  - 正式 source 为 `sourceKind=original`、`licenseId=project-original`，sourceNote 与 art-pack 元数据一致；没有新增 licenseFile。
  - 新增 `visualV1Source` 中文注释 helper；fixture/candidate 未指向正式地图。
- `tests/integration/map-art-pack.test.ts`
  - 锁定正式 URL、source、尺寸、placeholder 禁止条件、两累计 manifest 继承关系。
  - 锁定 fixture/candidate 38 项和旧 `__fixture__` 地图 URL。
- `tests/e2e/map-visual-activation.spec.ts`
  - 新增真实 Playwright 城镇→地图学家→楼层面板→第一层流程。
  - 监听地图请求/响应，要求正式 PNG 200、禁止 placeholder，并附加 568×320/844×390 截图。
  - 不注入存档、不使用 TestHooks、不把截图写入仓库，要求无 console/pageerror。

## 验证

- `npx vitest run tests/integration/map-art-pack.test.ts tests/unit/asset-catalog.test.ts tests/integration/asset-service.test.ts tests/unit/pixi-asset-resolver.test.ts --environment node`：31/31 PASS。
- `npm run verify:art`：`ART_PACK_VERIFY_OK`。
- `npm run verify:assets -- --batch verticalSlice`：`assets candidate valid`。
- `npm run typecheck`：PASS。
- `npm run lint`：PASS。
- `npm run build`：PASS（保留既有大 chunk warning）。
- `npm run test:unit`：88/90 files、598/602 tests 通过；4 项既有 5 秒超时（`game-flow-controller` 的 3 项 lease 生命周期测试、`art-pack-packer` 的 1 项 field clip 测试）导致进程失败，本卡 focused 测试与正式资源校验均通过。
- `npm run test:e2e -- tests/e2e/map-visual-activation.spec.ts tests/e2e/town-modal.spec.ts`：`NOT_RUN_ENV`。Playwright webServer 无法监听 `127.0.0.1:5173`，返回 `listen EPERM`，未执行浏览器断言，未伪造证据。

### 主线程真实浏览器补充验收

- 在获批的本地 `127.0.0.1:5173` Vite 服务上，以全新浏览器数据从标题页点击新游戏，使用真实 Pixi 虚拟摇杆移动到地图学家，通过正式楼层面板进入第一层；未注入存档、未使用 TestHooks、未拦截或伪造网络请求。
- 请求列表确认 `/assets/visual/v1/maps/town.png` 与 `/assets/visual/v1/maps/floor_01.png` 均返回 `200 OK`；两张地图均未请求对应的 placeholder URL。
- 568×320 城镇截图：`.playwright-cli/page-2026-09-09T04-32-11-301Z.png`。
- 844×390 城镇截图：`.playwright-cli/page-2026-09-09T04-29-40-791Z.png`。
- 568×320 第一层截图：`.playwright-cli/page-2026-09-09T04-34-39-523Z.png`。
- 844×390 第一层截图：`.playwright-cli/page-2026-09-09T04-35-31-364Z.png`。
- 两种横屏尺寸下 HUD、虚拟摇杆、地图与操作区均保持可见且 contain 居中。该次截图中的 field actor 仍是纯色占位图；此后 VIS-002D/VIS-002E 已完成并在独立报告中补充了正式角色、NPC 与遭遇物验收证据。
- 该次会话曾有 `/favicon.ico` 404；此后已增加项目自有 `favicon.svg`。2026-09-09 后续全新浏览器会话复验为 0 console error、0 warning，不能把后续修复倒算为本卡最初的零错误证据。

本卡没有修改 AssetCatalog、AssetService、PixiAssetResolver、GameFlow、SceneRouter、main、renderer、地图数据、collision/object、标题/UI 或角色/战斗美术。
