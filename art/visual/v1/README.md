# VIS-002 像素资源包

`art-pack.json` 是 VIS-002A 的正式输入配置。当前包含 VIS-002C 产出的 town/floor01 两张确定性原创地图 tileset；其它角色、战斗和 UI 资源仍由后续任务补齐。它只描述经过人工切分、修正并完成授权登记的像素帧；ImageGen 母稿不能直接作为运行时 sprite/sheet。

```bash
npm run pack:art -- --check
npm run pack:art
npm run verify:art
```

工具会将输入先写入 `public/assets/visual/.staging-v1-*`，全部尺寸、帧、锚点、像素、atlas、字体和 hash 门禁通过后才逐文件发布到 `public/assets/visual/v1`。失败不会覆盖旧输出，也不会删除未声明文件。

当前没有切换运行时 manifest 路径；VIS-002F 才会在独立任务中接入已验收的 visual URL。地图视觉层 builder 已接入 town/floor01 的静态内容数据，但运行时仍使用 placeholder URL，直到 VIS-002F 完成 manifest 切换。

`map-art.golden.json` 是人工审阅后的地图美术 golden，冻结 tileset raw/edge、三层视觉数组和 contact sheet SHA。`npm run generate:map-art` 只重建 PNG/contact sheet，不自动改写 golden；若像素设计确实变更，必须先审阅生成物，再显式更新该 JSON 并重新执行完整验证。
