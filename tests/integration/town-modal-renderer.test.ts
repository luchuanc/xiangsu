import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "node" } });
  }
});
import { Container, Rectangle, Texture, Text } from "pixi.js";
import { calculateViewport } from "../../src/app/ViewportService";
import { getTownModalPageSize, TownModalRenderer, type TownModalRendererOptions, type TownModalState } from "../../src/ui/rendering/TownModalRenderer";

function rendererOptions(
  onCommand = vi.fn(),
  viewport = calculateViewport({ width: 568, height: 320 }),
  extras: { onSemanticControlsChanged?: () => void } = {},
) {
  return {
    root: new Container(),
    assets: {
      requireEntry: vi.fn(() => ({ kind: "atlas", id: "atlas_core_ui", bundleId: "core_ui", imageSrc: "", dataSrc: "", requiredFrames: [], source: { sourceKind: "generated", sourceNote: "test", licenseId: "test" } })),
      requireTexture: vi.fn(() => Texture.WHITE),
      requireAtlasFrame: vi.fn(() => Texture.WHITE),
    },
    atlasId: "atlas_core_ui" as const,
    viewport,
    onCommand,
    ...extras,
  } as unknown as TownModalRendererOptions;
}

function rectanglesOverlap(a: Readonly<{ x: number; y: number; width: number; height: number }>, b: Readonly<{ x: number; y: number; width: number; height: number }>): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function controlsHaveGap(a: Readonly<{ x: number; y: number; width: number; height: number }>, b: Readonly<{ x: number; y: number; width: number; height: number }>, gap: number): boolean {
  const horizontal = a.x < b.x ? b.x - (a.x + a.width) : a.x - (b.x + b.width);
  const vertical = a.y < b.y ? b.y - (a.y + a.height) : a.y - (b.y + b.height);
  return horizontal >= gap || vertical >= gap;
}

function collectText(root: Container): string[] {
  const values: string[] = [];
  const visit = (node: Container): void => {
    for (const child of node.children) {
      if (child instanceof Text) values.push(child.text);
      if (child instanceof Container) visit(child);
    }
  };
  visit(root);
  return values;
}

function collectTextNodes(root: Container): Text[] {
  const values: Text[] = [];
  const visit = (node: Container): void => {
    for (const child of node.children) {
      if (child instanceof Text) values.push(child);
      if (child instanceof Container) visit(child);
    }
  };
  visit(root);
  return values;
}

function npcState(): TownModalState {
  return {
    kind: "npc",
    title: "商人",
    body: "欢迎来到边境营地。",
    statusText: null,
    errorText: null,
    busy: false,
    actions: [
      { testId: "town-modal-close", ariaLabel: "关闭", label: "关闭", command: { kind: "close" }, enabled: true, disabledReasonText: null },
      { testId: "town-modal-rest", ariaLabel: "免费休整", label: "免费休整", command: { kind: "rest" }, enabled: true, disabledReasonText: null },
    ],
  };
}

describe("VIS-003 TownModalRenderer", () => {
  it("共享 page size 按真实 safeRect 几何从 3 向 1 取最大可行页", () => {
    const normal = calculateViewport({ width: 568, height: 320 });
    const inset = calculateViewport({ width: 568, height: 320 }, { top: 20, right: 0, bottom: 24, left: 0 });
    const wide = calculateViewport({ width: 844, height: 390 });
    expect(getTownModalPageSize(normal)).toBe(3);
    expect(getTownModalPageSize(inset)).toBe(2);
    expect(getTownModalPageSize(wide)).toBe(3);
  });

  it("渲染 Pixi modal、使用 safeRect，并让 pointertap 与 semanticControls 共用 exact command", () => {
    const onCommand = vi.fn();
    const renderer = new TownModalRenderer(rendererOptions(onCommand));
    renderer.render(npcState());

    expect(renderer.semanticControls.map((control) => control.testId)).toEqual(["town-modal-close", "town-modal-rest"]);
    expect(renderer.semanticControls.every((control) => control.rect.width * rendererOptions().viewport.scale >= 48)).toBe(true);
    expect(renderer.semanticControls.every((control) => control.rect.height * rendererOptions().viewport.scale >= 48)).toBe(true);
    expect(renderer.semanticControls[0]?.rect.x).toBeGreaterThanOrEqual(rendererOptions().viewport.safeRect.x);
    expect(renderer.semanticControls[0]?.rect.y).toBeGreaterThanOrEqual(rendererOptions().viewport.safeRect.y);
    expect(renderer.root.children.length).toBeGreaterThan(0);

    const button = renderer.root.children
      .flatMap((child) => child.children)
      .find((child) => child.eventMode === "static" && child.hitArea && (child.hitArea as Rectangle).width < 640);
    expect(button).toBeDefined();
    button?.emit("pointertap", {} as never);
    expect(onCommand).toHaveBeenCalledWith({ kind: "close" });
    renderer.destroy();
    expect(renderer.root.children).toHaveLength(0);
  });

  it("商店/楼层分页只展示当前页并拒绝越界页，不把离页按钮镜像到 semanticControls", () => {
    const renderer = new TownModalRenderer(rendererOptions());
    renderer.render({
      kind: "merchant",
      title: "行商人",
      body: "挑一件趁手的装备。",
      statusText: null,
      errorText: null,
      busy: false,
      gold: 500,
      offers: new Array(8).fill(null).map((_, index) => ({
        offerId: `offer_${index}`,
        name: `物品${index}`,
        priceText: `${index + 1} 金币`,
        sold: false,
        enabled: true,
        disabledReasonText: null,
      })),
      busyOfferId: null,
      pageIndex: 0,
      pageCount: 3,
      actions: [
        { testId: "town-modal-close", ariaLabel: "关闭", label: "关闭", command: { kind: "close" }, enabled: true, disabledReasonText: null },
        { testId: "town-modal-next", ariaLabel: "下一页", label: "下一页", command: { kind: "changePage", panel: "merchant", pageIndex: 1 }, enabled: true, disabledReasonText: null },
      ],
    });
    expect(renderer.semanticControls.map((control) => control.testId)).toEqual([
      "town-modal-buy-offer_0",
      "town-modal-buy-offer_1",
      "town-modal-buy-offer_2",
      "town-modal-close",
      "town-modal-next",
    ]);
    expect(renderer.root.children.length).toBeGreaterThan(0);
    renderer.destroy();
  });

  it("NPC 使用居中的对话内容卡，并保持移动端可读字号与命令图标层", () => {
    const renderer = new TownModalRenderer(rendererOptions());
    renderer.render(npcState());
    const textNodes = collectTextNodes(renderer.root);
    expect(textNodes.find((node) => node.text === "商人")?.style.fontSize).toBe(20);
    expect(textNodes.find((node) => node.text === "欢迎来到边境营地。")?.style.fontSize).toBe(13);
    expect(textNodes.filter((node) => node.text === "关闭" || node.text === "免费休整").every((node) => Number(node.style.fontSize) >= 11)).toBe(true);
    expect(collectText(renderer.root)).toContain("城镇事务");
    expect(renderer.root.children.length).toBeGreaterThan(0);
    renderer.destroy();
  });

  it("viewport 改变后 renderer 按共享 page size 读取当前页，busy offer/floor 都有处理中说明", () => {
    const normal = calculateViewport({ width: 568, height: 320 });
    const inset = calculateViewport({ width: 568, height: 320 }, { top: 20, right: 0, bottom: 24, left: 0 });
    const renderer = new TownModalRenderer(rendererOptions(vi.fn(), normal));
    renderer.render({
      kind: "merchant",
      title: "行商人",
      body: "挑一件趁手的装备。",
      statusText: null,
      errorText: null,
      busy: true,
      gold: 500,
      offers: new Array(8).fill(null).map((_, index) => ({
        offerId: `offer_${index}`,
        name: `物品${index}`,
        priceText: `${index + 1} 金币`,
        sold: false,
        enabled: true,
        disabledReasonText: null,
      })),
      busyOfferId: "offer_4",
      pageIndex: 2,
      pageCount: 3,
      actions: [{ testId: "town-modal-close", ariaLabel: "关闭", label: "关闭", command: { kind: "close" }, enabled: true, disabledReasonText: null }],
    });
    expect(renderer.semanticControls.map((control) => control.testId)).toEqual(["town-modal-buy-offer_6", "town-modal-buy-offer_7", "town-modal-close"]);
    expect(renderer.semanticControls.filter((control) => control.testId.startsWith("town-modal-buy-")).every((control) => control.disabled)).toBe(true);
    expect(renderer.semanticControls.filter((control) => control.testId.startsWith("town-modal-buy-")).every((control) => control.ariaLabel.includes("处理中"))).toBe(true);
    expect(collectText(renderer.root).some((text) => text.includes("处理中"))).toBe(true);

    renderer.setViewport(inset);
    expect(renderer.semanticControls.map((control) => control.testId)).toEqual(["town-modal-buy-offer_4", "town-modal-buy-offer_5", "town-modal-close"]);
    renderer.render({
      kind: "floorSelect",
      title: "选择楼层",
      body: "选择远征模式。",
      statusText: null,
      errorText: null,
      busy: true,
      selectedFloorId: "floor_01",
      pageIndex: 0,
      pageCount: 2,
      entries: [{
        floorId: "floor_01",
        title: "第一层",
        subtitle: "普通远征",
        locked: false,
        modes: [{ mode: "exploration", label: "完整远征", enabled: true, disabledReasonText: null }],
      }],
      actions: [{ testId: "town-modal-close", ariaLabel: "关闭", label: "关闭", command: { kind: "close" }, enabled: true, disabledReasonText: null }],
    });
    const floorMode = renderer.semanticControls.find((control) => control.testId.includes("enter-floor"));
    expect(floorMode?.disabled).toBe(true);
    expect(floorMode?.ariaLabel).toContain("处理中");
    renderer.destroy();
  });

  it("floorSelect busy 时未锁定楼层显示处理中，锁定楼层仍优先显示尚未解锁", () => {
    const renderer = new TownModalRenderer(rendererOptions());
    renderer.render({
      kind: "floorSelect",
      title: "选择楼层",
      body: "选择远征模式。",
      statusText: null,
      errorText: null,
      busy: true,
      selectedFloorId: null,
      pageIndex: 0,
      pageCount: 1,
      entries: [
        { floorId: "floor_open", title: "可进入楼层", subtitle: "普通远征", locked: false, modes: [] },
        { floorId: "floor_locked", title: "锁定楼层", subtitle: "尚未解锁", locked: true, modes: [] },
      ],
      actions: [{ testId: "town-modal-close", ariaLabel: "关闭", label: "关闭", command: { kind: "close" }, enabled: true, disabledReasonText: null }],
    });
    const open = renderer.semanticControls.find((control) => control.testId === "town-modal-select-floor-floor_open");
    const locked = renderer.semanticControls.find((control) => control.testId === "town-modal-select-floor-floor_locked");
    expect(open?.disabled).toBe(true);
    expect(open?.ariaLabel).toContain("处理中");
    expect(locked?.disabled).toBe(true);
    expect(locked?.ariaLabel).toContain("尚未解锁");
    expect(locked?.ariaLabel).not.toContain("处理中");
    const texts = collectText(renderer.root);
    expect(texts.some((text) => text.includes("处理中"))).toBe(true);
    expect(texts.some((text) => text.includes("尚未解锁"))).toBe(true);
    renderer.destroy();
  });

  it("楼层每页最多三个条目，详情模式最多两个，所有命中区有确定间距且不重叠", () => {
    const viewport = calculateViewport({ width: 568, height: 320 });
    const renderer = new TownModalRenderer(rendererOptions(vi.fn(), viewport));
    renderer.render({
      kind: "floorSelect",
      title: "选择楼层",
      body: "从当前页选择远征模式。",
      statusText: null,
      errorText: null,
      busy: false,
      selectedFloorId: "floor_02",
      pageIndex: 0,
      pageCount: 2,
      entries: new Array(6).fill(null).map((_, index) => ({
        floorId: `floor_0${index + 1}`,
        title: `第${index + 1}层`,
        subtitle: "普通远征",
        locked: false,
        modes: [
          { mode: "exploration" as const, label: "完整远征", enabled: true, disabledReasonText: null },
          { mode: "shortFarm" as const, label: "短程刷取", enabled: true, disabledReasonText: null },
          { mode: "bossRetry" as const, label: "Boss 重试", enabled: true, disabledReasonText: null },
        ],
      })),
      actions: [
        { testId: "town-modal-close", ariaLabel: "关闭", label: "关闭", command: { kind: "close" }, enabled: true, disabledReasonText: null },
        { testId: "town-modal-floor-next", ariaLabel: "下一页", label: "下一页", command: { kind: "changePage", panel: "floorSelect", pageIndex: 1 }, enabled: true, disabledReasonText: null },
      ],
    });
    const ids = renderer.semanticControls.map((control) => control.testId);
    expect(ids.filter((id) => id.startsWith("town-modal-select-floor-")).length).toBe(3);
    expect(ids.filter((id) => id.startsWith("town-modal-enter-floor-")).length).toBe(2);
    for (let index = 0; index < renderer.semanticControls.length; index += 1) {
      for (let next = index + 1; next < renderer.semanticControls.length; next += 1) {
        const a = renderer.semanticControls[index];
        const b = renderer.semanticControls[next];
        expect(rectanglesOverlap(a.rect, b.rect)).toBe(false);
        expect(controlsHaveGap(a.rect, b.rect, getHitAreaGap(viewport.scale))).toBe(true);
      }
    }
    renderer.destroy();
  });

  it("setEnabled 同步语义禁用态并投影 disabled reason 到可见文案与 aria-label", () => {
    const onSemanticControlsChanged = vi.fn();
    const renderer = new TownModalRenderer(rendererOptions(vi.fn(), calculateViewport({ width: 568, height: 320 }), { onSemanticControlsChanged }));
    renderer.render({
      ...npcState(),
      actions: [{ testId: "town-modal-rest", ariaLabel: "免费休整", label: "免费休整", command: { kind: "rest" }, enabled: false, disabledReasonText: "仅限旅店" }],
    });
    expect(renderer.semanticControls[0]?.disabled).toBe(true);
    expect(renderer.semanticControls[0]?.ariaLabel).toContain("仅限旅店");
    expect(collectText(renderer.root).some((text) => text.includes("仅限旅店"))).toBe(true);
    renderer.setEnabled(false);
    expect(renderer.semanticControls.every((control) => control.disabled)).toBe(true);
    expect(onSemanticControlsChanged).toHaveBeenCalled();
    renderer.destroy();
  });

  it("568×320、844×390 与非对称 safeRect 下所有当前页命中区仍满足安全区/触控门槛", () => {
    const viewports = [
      calculateViewport({ width: 568, height: 320 }),
      calculateViewport({ width: 568, height: 320 }, { top: 20, right: 0, bottom: 24, left: 0 }),
      calculateViewport({ width: 844, height: 390 }),
      calculateViewport({ width: 844, height: 390 }, { top: 7, right: 19, bottom: 13, left: 29 }),
    ];
    for (const viewport of viewports) {
      const renderer = new TownModalRenderer(rendererOptions(vi.fn(), viewport));
      renderer.render({
        kind: "floorSelect",
        title: "选择楼层",
        body: "从当前页选择远征模式。",
        statusText: null,
        errorText: null,
        busy: false,
        selectedFloorId: "floor_03",
        pageIndex: 0,
        pageCount: 2,
        entries: new Array(6).fill(null).map((_, index) => ({
          floorId: `floor_0${index + 1}`,
          title: `第${index + 1}层`,
          subtitle: "普通远征",
          locked: false,
          modes: [{ mode: "exploration" as const, label: "完整远征", enabled: true, disabledReasonText: null }],
        })),
        actions: [{ testId: "town-modal-close", ariaLabel: "关闭", label: "关闭", command: { kind: "close" }, enabled: true, disabledReasonText: null }],
      });
      for (const control of renderer.semanticControls) {
        expect(control.rect.x).toBeGreaterThanOrEqual(viewport.safeRect.x);
        expect(control.rect.y).toBeGreaterThanOrEqual(viewport.safeRect.y);
        expect(control.rect.x + control.rect.width).toBeLessThanOrEqual(viewport.safeRect.right);
        expect(control.rect.y + control.rect.height).toBeLessThanOrEqual(viewport.safeRect.bottom);
        expect(control.rect.width * viewport.scale).toBeGreaterThanOrEqual(48);
        expect(control.rect.height * viewport.scale).toBeGreaterThanOrEqual(48);
      }
      const listControls = renderer.semanticControls.filter((control) => control.testId.startsWith("town-modal-select-floor-"));
      const footer = renderer.semanticControls.find((control) => control.testId === "town-modal-close");
      const lastList = listControls.at(-1);
      if (lastList && footer) {
        expect(footer.rect.y - (lastList.rect.y + lastList.rect.height)).toBeGreaterThanOrEqual(getHitAreaGap(viewport.scale));
      }
      renderer.destroy();
    }
  });
});

function getHitAreaGap(scale: number): number {
  // getHitAreaThresholds keeps this stable in logical pixels; the test uses the same
  // CSS conversion bound to ensure the 8px physical gap survives narrow DPRs.
  return Math.max(8 / scale, 8);
}
