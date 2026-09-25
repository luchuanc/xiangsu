import { Container } from "pixi.js";
import type { SceneRootLike } from "./Scene";

const PIXI_SCENE_ROOT_KIND = "pixi-scene-root-v1";

/**
 * 路由拥有的业务场景复合根；所有场景显示层随根一起挂载、卸载和销毁。
 */
export class PixiSceneRoot extends Container {
  public readonly sceneRootKind = PIXI_SCENE_ROOT_KIND;
  public readonly mapBack = new Container();
  public readonly actors = new Container({ sortableChildren: true });
  public readonly mapFront = new Container();
  public readonly worldFx = new Container();
  public readonly hud = new Container();
  public readonly screen = new Container();
  public readonly modal = new Container();
  public readonly transition = new Container();

  public constructor() {
    super();
    // 地图和世界特效只负责显示，不参与指针命中；角色层保留脚底 Y 排序能力。
    this.mapBack.eventMode = "none";
    this.mapFront.eventMode = "none";
    this.worldFx.eventMode = "none";
    this.addChild(
      this.mapBack,
      this.actors,
      this.mapFront,
      this.worldFx,
      this.hud,
      this.screen,
      this.modal,
      this.transition,
    );
  }
}

export function createPixiSceneRoot(): PixiSceneRoot {
  return new PixiSceneRoot();
}

export function isPixiSceneRoot(root: SceneRootLike): root is PixiSceneRoot {
  return root instanceof Container
    && (root as unknown as Partial<PixiSceneRoot>).sceneRootKind === PIXI_SCENE_ROOT_KIND;
}
