# 像素远征

PixiJS 8 + TypeScript + Vite 构建的离线单机像素 RPG。存档保存在玩家浏览器的 IndexedDB，无需游戏服务端。

```sh
npm ci
npm run dev
npm run build
```

生产环境将 `dist/` 完整部署到独立站点根路径 `/`，保留根路径下的 `assets/` 资源。建议使用 Node.js 24。

```sh
npm run typecheck
npm run lint
npm run test:unit
```

发布平台：<https://github.com/luchuanc/publishing>。默认接入 `main` 分支，构建命令 `npm run build`，产物目录 `dist`。发布与回滚不清除玩家存档，请保持版本间存档兼容。

游戏设计与需求见 `docs/requirements/mobile-h5-pixel-rpg/`；美术资源与制作说明见 `art/` 和 `docs/art-source/`。
