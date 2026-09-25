import { Container, Text } from "pixi.js";

/**
 * WebGL 恢复后重建文字 GPU 缓存。Pixi 会回收文字绘制用的 Canvas，
 * 不能像 PNG 源纹理一样直接重传；公开 unload 会清引用并触发下一帧重新栅格化。
 */
export function invalidatePixiTextTextures(stage: unknown): void {
  if (!(stage instanceof Container)) return;
  const visit = (node: Container): void => {
    if (node instanceof Text) node.unload();
    for (const child of node.children) visit(child);
  };
  visit(stage);
}
