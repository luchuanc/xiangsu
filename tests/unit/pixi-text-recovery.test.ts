import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => vi.stubGlobal("navigator", {}));
import { Container, Sprite, Text, Texture } from "pixi.js";
import { invalidatePixiTextTextures } from "../../src/app/PixiTextRecovery";

describe("文字上下文恢复", () => {
  it("递归清理文字 GPU 缓存但不销毁节点或共享图片", () => {
    const root = new Container();
    const nested = new Container();
    const label = new Text({ text: "盾击" });
    const sprite = new Sprite(Texture.EMPTY);
    const unload = vi.spyOn(label, "unload");
    const spriteUnload = vi.spyOn(sprite, "unload");
    root.addChild(nested);
    nested.addChild(label, sprite);
    invalidatePixiTextTextures(root);
    expect(unload).toHaveBeenCalledOnce();
    expect(spriteUnload).not.toHaveBeenCalled();
    expect(label.text).toBe("盾击");
    expect(label.destroyed).toBe(false);
    expect(Texture.EMPTY.destroyed).toBe(false);
    root.destroy({ children: true });
  });

  it("不将 Node fake stage 猜测为 Pixi 场景", () => {
    expect(() => invalidatePixiTextTextures({ children: [] })).not.toThrow();
  });
});
