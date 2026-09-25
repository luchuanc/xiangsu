import { Container } from "pixi.js";

export interface PixiRootLayers {
  sceneRoot: Container;
  mapBackRoot: Container;
  actorRoot: Container;
  mapFrontRoot: Container;
  worldFxRoot: Container;
  hudRoot: Container;
  screenRoot: Container;
  modalScrimRoot: Container;
  modalRoot: Container;
  toastRoot: Container;
  transitionRoot: Container;
}

/**
 * 创建固定的 Pixi 根层级；只有 Container 作为组合节点挂载到 stage。
 */
export function createPixiRootLayers(stage: Container): PixiRootLayers {
  const sceneRoot = new Container({ isRenderGroup: true });
  const mapBackRoot = new Container();
  const actorRoot = new Container();
  const mapFrontRoot = new Container();
  const worldFxRoot = new Container();
  const hudRoot = new Container();
  const screenRoot = new Container();
  const modalScrimRoot = new Container();
  const modalRoot = new Container();
  const toastRoot = new Container();
  const transitionRoot = new Container();

  // 地图层不参与事件命中；角色层保留可排序能力，后续按脚底 Y 设置 zIndex。
  mapBackRoot.eventMode = "none";
  mapFrontRoot.eventMode = "none";
  worldFxRoot.eventMode = "none";
  actorRoot.sortableChildren = true;

  sceneRoot.addChild(mapBackRoot, actorRoot, mapFrontRoot, worldFxRoot);
  stage.addChild(
    sceneRoot,
    hudRoot,
    screenRoot,
    modalScrimRoot,
    modalRoot,
    toastRoot,
    transitionRoot,
  );

  return {
    sceneRoot,
    mapBackRoot,
    actorRoot,
    mapFrontRoot,
    worldFxRoot,
    hudRoot,
    screenRoot,
    modalScrimRoot,
    modalRoot,
    toastRoot,
    transitionRoot,
  };
}
