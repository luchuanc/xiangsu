import { Assets, Rectangle, Texture } from "pixi.js";
import portraitUrls from "../../../public/assets/art/completion/v1/portraits.json";
import effectAtlas from "../../../public/assets/art/completion/v1/atlases/extended-fx.json";

/** 战斗美术独立版本资源；与领域内容数量契约无关，所有映射均显式声明。 */
export interface BattleArtResources {
  readonly background: Texture;
  readonly actors: ReadonlyMap<string, Texture>;
  readonly effects?: ReadonlyMap<string, Texture>;
}

let loading: Promise<BattleArtResources> | undefined;

/** 同一应用共享源纹理，场景切换不销毁；加载失败清理任务，允许重试。 */
export function loadBattleArtResources(): Promise<BattleArtResources> {
  loading ??= load().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

async function load(): Promise<BattleArtResources> {
  const [background, effectsSource] = await Promise.all([
    Assets.load<Texture>("/assets/art/battle-premium/v1/forest-arena.png"),
    Assets.load<Texture>("/assets/art/completion/v1/atlases/battle-fx.png"),
  ]);
  const actors = new Map<string, Texture>();
  // Load reviewed 160px cutouts, avoiding decoding the large generation atlases in battle.
  await Promise.all(Object.entries(portraitUrls).map(async ([id, url]) => {
    const texture = await Assets.load<Texture>(url);
    texture.source.scaleMode = "nearest";
    actors.set(id, texture);
  }));
  effectsSource.source.scaleMode = "nearest";
  const effects = new Map<string, Texture>();
  for (const [id, { frame }] of Object.entries(effectAtlas.frames)) {
    effects.set(id, new Texture({ source: effectsSource.source, frame: new Rectangle(frame.x, frame.y, frame.w, frame.h) }));
  }
  return { background, actors, effects };
}
