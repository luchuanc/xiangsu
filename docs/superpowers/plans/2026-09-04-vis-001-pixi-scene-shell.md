# VIS-001 Pixi Scene Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty canvas/title debug strip with a real PixiJS scene root and a visible, touchable title screen that establishes the rendering contract for every later game scene.

**Architecture:** Keep `SceneRouter`, `GameApp`, persistence, and domain services unchanged. Add a route-owned `PixiSceneRoot` with explicit world/HUD/screen/modal layers, inject a small `TitleSceneView` adapter into the existing pure `TitleScene`, and render the visible title/buttons in Pixi while retaining only an invisible DOM semantic mirror for accessibility and automation.

**Tech Stack:** TypeScript 5, PixiJS v8 (`Container`, `Graphics`, `Text`), Vitest, Playwright, Vite, mobile H5 640×360 contain viewport.

**Spec:** `docs/superpowers/specs/2026-09-04-pixijs-visual-rebuild-design.md`

## Global Constraints

- Design coordinates remain exactly `640 × 360`; acceptance viewports are 568×320 and 844×390.
- Core code comments are Chinese.
- Do not change domain formulas, save schema, content IDs, combat logic, or resource contracts.
- Do not add WebGPU, shaders, particle systems, or performance-only abstractions.
- Visible game UI is Pixi; DOM is limited to system overlays and invisible semantic controls.
- Never reintroduce `像素远征 · 工程占位` as a normal visible runtime state.
- Preserve all existing RPG-001～RPG-029, dynamic loadout, Combo recursion, content, and test changes.
- `/Users/lcc/temp/xiangsu` has no independent Git boundary and is untracked inside `/Users/lcc/temp`; do not create a parent-repository commit. Record exact changed files and verification output instead.

## File Structure

- Create `src/app/PixiSceneRoot.ts`: route-owned composite Pixi container and runtime type guard.
- Create `src/ui/rendering/PixelButton.ts`: reusable 44px-minimum Pixi button with pointer and disabled states.
- Create `src/ui/rendering/TitleSceneRenderer.ts`: visible title composition, button layout, and lifecycle.
- Modify `src/scenes/title/TitleScene.ts`: inject and drive the renderer through a Pixi-free `TitleSceneView` interface.
- Modify `src/app/GameFlowController.ts`: create `PixiSceneRoot`, instantiate the production title renderer, and render only title semantic controls in title state.
- Modify `src/styles.css`: remove the visible debug-strip presentation; add full-canvas invisible semantic overlay rules.
- Modify `index.html`: replace engineering placeholder copy with neutral boot copy.
- Create `tests/unit/pixi-scene-root.test.ts`: layer order/type guard/destroy contract.
- Create `tests/unit/pixel-button.test.ts`: pointer, disabled, label, minimum hit-area contract.
- Create `tests/integration/title-scene-renderer.test.ts`: title lifecycle and callback integration without a WebGL renderer.
- Modify `tests/integration/town-scene.test.ts`: retain existing pure `TitleScene` behavior with optional view.
- Modify `tests/e2e/smoke.spec.ts`: assert boot placeholder disappears and the real title semantic surface exists.
- Modify `tests/e2e/playable-flow.spec.ts`: start the game through the title control without asserting the engineering placeholder.

---

### Task 1: Route-owned Pixi scene root

**Files:**
- Create: `src/app/PixiSceneRoot.ts`
- Test: `tests/unit/pixi-scene-root.test.ts`

**Interfaces:**
- Consumes: PixiJS v8 `Container`; existing `SceneRootLike` detached-root contract.
- Produces: `PixiSceneRoot`, `createPixiSceneRoot(): PixiSceneRoot`, `isPixiSceneRoot(root: SceneRootLike): root is PixiSceneRoot`.

- [ ] **Step 1: Write the failing root-layer test**

```ts
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { createPixiSceneRoot, isPixiSceneRoot } from "../../src/app/PixiSceneRoot";

describe("PixiSceneRoot", () => {
  it("按冻结顺序创建场景内层级并保持 detached", () => {
    const root = createPixiSceneRoot();
    expect(root).toBeInstanceOf(Container);
    expect(root.parent).toBeNull();
    expect(root.children).toEqual([
      root.mapBack,
      root.actors,
      root.mapFront,
      root.worldFx,
      root.hud,
      root.screen,
      root.modal,
      root.transition,
    ]);
    expect(root.actors.sortableChildren).toBe(true);
    expect(isPixiSceneRoot(root)).toBe(true);
    expect(isPixiSceneRoot({ parent: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and observe the module-missing red state**

Run: `npx vitest run tests/unit/pixi-scene-root.test.ts --environment node`

Expected: FAIL because `src/app/PixiSceneRoot.ts` does not exist.

- [ ] **Step 3: Implement the composite root**

```ts
import { Container } from "pixi.js";
import type { SceneRootLike } from "./Scene";

const PIXI_SCENE_ROOT_KIND = "pixi-scene-root-v1";

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
    // 场景所有可见对象随路由根整体挂载和销毁，禁止跨场景残留。
    this.addChild(this.mapBack, this.actors, this.mapFront, this.worldFx,
      this.hud, this.screen, this.modal, this.transition);
  }
}

export function createPixiSceneRoot(): PixiSceneRoot {
  return new PixiSceneRoot();
}

export function isPixiSceneRoot(root: SceneRootLike): root is PixiSceneRoot {
  return root instanceof Container
    && (root as Partial<PixiSceneRoot>).sceneRootKind === PIXI_SCENE_ROOT_KIND;
}
```

Use explicit `eventMode="none"` on noninteractive map/effect layers and retain `actors.sortableChildren=true`.

- [ ] **Step 4: Verify the root contract**

Run: `npx vitest run tests/unit/pixi-scene-root.test.ts --environment node`

Expected: PASS.

---

### Task 2: Reusable Pixi pixel button

**Files:**
- Create: `src/ui/rendering/PixelButton.ts`
- Test: `tests/unit/pixel-button.test.ts`

**Interfaces:**
- Consumes: PixiJS `Container`, `Graphics`, `Text`, `FederatedPointerEvent`.
- Produces: `PixelButtonOptions`, `PixelButton`, `setDisabled(value: boolean)`, `setLabel(value: string)`, `destroy()`.

- [ ] **Step 1: Write failing behavior tests**

```ts
const clicks: string[] = [];
const button = new PixelButton({
  label: "开始远征",
  width: 152,
  height: 48,
  onPress: () => clicks.push("pressed"),
});

expect(button.hitArea?.width).toBe(152);
expect(button.hitArea?.height).toBe(48);
expect(button.eventMode).toBe("static");
button.emit("pointertap", { stopPropagation() {} });
expect(clicks).toEqual(["pressed"]);
button.setDisabled(true);
button.emit("pointertap", { stopPropagation() {} });
expect(clicks).toEqual(["pressed"]);
```

Also assert widths/heights below 44 throw `PIXEL_BUTTON_HIT_AREA_TOO_SMALL`, and `setLabel` updates the visible text.

- [ ] **Step 2: Run and observe the module-missing failure**

Run: `npx vitest run tests/unit/pixel-button.test.ts --environment node`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the button**

Build one `Container` containing a shadow `Graphics`, face `Graphics`, and centered `Text`. Use square corners and 2px/3px integer strokes/shadows; do not use CSS gradients or rounded SaaS-card styling. Set:

```ts
this.eventMode = "static";
this.cursor = "pointer";
this.hitArea = new Rectangle(0, 0, options.width, options.height);
```

Pointer down changes the face translation by `(1, 1)`; pointer up/out restores it. Disabled state uses `eventMode="none"`, dim text, and a desaturated face. `onPress` fires once only on `pointertap` while enabled. All `Graphics` coordinates and child positions are integers.

- [ ] **Step 4: Verify button behavior**

Run: `npx vitest run tests/unit/pixel-button.test.ts --environment node`

Expected: PASS.

---

### Task 3: Visible title renderer and pure scene lifecycle

**Files:**
- Create: `src/ui/rendering/TitleSceneRenderer.ts`
- Modify: `src/scenes/title/TitleScene.ts`
- Create: `tests/integration/title-scene-renderer.test.ts`
- Modify: `tests/integration/town-scene.test.ts`

**Interfaces:**
- Consumes: `PixiSceneRoot.screen`, `PixelButton`, existing `TitleScene` lifecycle.
- Produces:

```ts
export interface TitleSceneViewState {
  readonly canContinue: boolean;
  readonly busy: boolean;
  readonly errorText: string | null;
}

export interface TitleSceneView {
  prepare(): void | Promise<void>;
  enter(state: TitleSceneViewState): void;
  update(state: TitleSceneViewState): void;
  pause(): void;
  resume(state: TitleSceneViewState): void;
  destroy(): void;
}
```

`TitleSceneOptions` gains optional `view?: TitleSceneView` and `getViewState?: () => TitleSceneViewState`. Existing callers that omit both behave exactly as before.

- [ ] **Step 1: Write the lifecycle red test**

Use a real `PixiSceneRoot` and a fake view log:

```ts
const calls: string[] = [];
const view: TitleSceneView = {
  prepare: () => calls.push("prepare"),
  enter: () => calls.push("enter"),
  update: () => calls.push("update"),
  pause: () => calls.push("pause"),
  resume: () => calls.push("resume"),
  destroy: () => calls.push("destroy"),
};
```

Assert `prepare → enter → pause → resume → pause → destroy` and idempotent destroy. Assert the legacy `TitleScene` test still passes without a view.

- [ ] **Step 2: Run and observe the missing-interface failure**

Run: `npx vitest run tests/integration/title-scene-renderer.test.ts tests/integration/town-scene.test.ts --environment node`

Expected: FAIL because `TitleSceneView` is not defined/wired.

- [ ] **Step 3: Implement `TitleSceneRenderer`**

The renderer receives:

```ts
export interface TitleSceneRendererOptions {
  readonly root: PixiSceneRoot;
  readonly onNewGame: () => void;
  readonly onContinue: () => void;
}
```

Compose a full-screen `Graphics` backdrop using a deliberate temporary pixel-art composition: midnight navy sky, stepped mountain silhouettes, warm town-light rectangles, foreground stone steps, and a thin abyss-red horizon. Add large title `像素远征`, subtitle `构筑你的队伍，踏入十层深渊`, a gold primary `继续远征` button, a stone secondary `开始新游戏` button, and bottom version copy. All shapes use integer coordinates and no gradients.

The temporary procedural backdrop is an intentional first-card rendering proof and is replaced by the ImageGen title artwork in VIS-002; it must already read as a coherent pixel-game title rather than an engineering placeholder.

- [ ] **Step 4: Wire the optional view into `TitleScene`**

In `prepare`, await `view.prepare()`. In `enter`, call `view.enter(getViewState())`; in pause/resume/destroy mirror the scene lifecycle. Guard duplicate destroy. Keep audio and destination behavior unchanged.

- [ ] **Step 5: Run focused integration tests**

Run: `npx vitest run tests/integration/title-scene-renderer.test.ts tests/integration/town-scene.test.ts --environment node`

Expected: PASS.

---

### Task 4: Production flow integration and semantic DOM cleanup

**Files:**
- Modify: `src/app/GameFlowController.ts`
- Modify: `src/styles.css`
- Modify: `index.html`
- Modify: `tests/integration/game-flow-controller.test.ts`

**Interfaces:**
- Consumes: `createPixiSceneRoot`, `isPixiSceneRoot`, `TitleSceneRenderer`, existing `newGame()` and `continueGame()`.
- Produces: every production route receives a `PixiSceneRoot`; title state exposes invisible semantic controls with test IDs `new-game` and `continue`.

- [ ] **Step 1: Add failing flow assertions**

Extend the existing new-game/continue integration fixture so the injected root can be a real `PixiSceneRoot`. Assert:

```ts
expect(controller.state).toBe("title");
expect(root.screen.children.length).toBeGreaterThan(0);
expect(document.querySelector('[data-testid="new-game"]')?.getAttribute("aria-label"))
  .toBe("开始新游戏");
expect(document.querySelector("#game-flow-ui")?.classList.contains("semantic-ui"))
  .toBe(true);
```

Do not rewrite the dozens of fake-root tests; optional rendering must preserve them.

- [ ] **Step 2: Run the focused test and observe red**

Run: `npx vitest run tests/integration/game-flow-controller.test.ts --environment node`

Expected: the new title-rendering assertion fails.

- [ ] **Step 3: Integrate the production scene root and renderer**

Change `defaultRootFactory` to dynamically import `createPixiSceneRoot`. In `createScene("title")`, only create `TitleSceneRenderer` when `isPixiSceneRoot(context.root)` is true. Inject:

```ts
new TitleSceneRenderer({
  root: context.root,
  onNewGame: () => { void this.newGame(); },
  onContinue: () => { void this.continueGame(); },
});
```

State is `{ canContinue: this.storedSaveAvailable, busy: false, errorText: null }`. Do not add a second save or navigation path.

- [ ] **Step 4: Convert DOM flow UI to semantic overlay**

Set `ui.className = "semantic-ui"`. For title state, keep the two buttons as transparent controls positioned over the Pixi buttons in logical percentages. Every other state keeps its current DOM controls in the tree for ongoing development but applies a temporary `.legacy-debug-ui` class with `display:none`; later VIS cards replace each state with aligned semantics.

Required CSS behavior:

```css
#game-flow-ui.semantic-ui {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}

#game-flow-ui.semantic-ui > button {
  position: absolute;
  opacity: 0;
  pointer-events: auto;
  touch-action: manipulation;
}
```

Do not leave visible text, backgrounds, borders, shadows, or scrollbars on this overlay. Keep each semantic button at least 44 CSS pixels high. Change `index.html` boot copy to `像素远征 · 正在点亮篝火`.

- [ ] **Step 5: Verify flow integration**

Run: `npx vitest run tests/integration/game-flow-controller.test.ts tests/integration/title-scene-renderer.test.ts --environment node`

Expected: PASS.

---

### Task 5: Static and real-browser acceptance

**Files:**
- Modify: `tests/e2e/smoke.spec.ts`
- Modify: `tests/e2e/playable-flow.spec.ts`
- Evidence output only: `/private/tmp/xiangsu-vis-001-568x320.png`
- Evidence output only: `/private/tmp/xiangsu-vis-001-844x390.png`

**Interfaces:**
- Consumes: production Vite entry and title semantic buttons.
- Produces: browser evidence that canvas is non-empty, title controls are usable, and engineering placeholder/debug strip is absent.

- [ ] **Step 1: Replace placeholder E2E assertions**

In `smoke.spec.ts`, wait for the title semantic control, then assert:

```ts
await expect(page.locator("#startup-placeholder")).toHaveCSS("display", "none");
await expect(page.getByTestId("new-game")).toHaveAttribute("aria-label", "开始新游戏");
await expect(page.getByText("工程占位")).toHaveCount(0);
await expect(page.locator("#game-flow-ui")).not.toContainText("标题：选择开始或继续");
```

Capture the canvas with `page.locator("canvas").screenshot(...)` at both viewports. Read pixels with Playwright screenshot output and assert at least three non-background color buckets; this prevents a blank solid canvas from passing.

- [ ] **Step 2: Run static verification**

Run in order:

```bash
npx vitest run tests/unit/pixi-scene-root.test.ts tests/unit/pixel-button.test.ts tests/integration/title-scene-renderer.test.ts tests/integration/game-flow-controller.test.ts --environment node
npm run test:unit
npm run typecheck
npm run lint
npm run build
```

Expected: every command exits 0. The existing Vite >500KB chunk warning is informational only.

- [ ] **Step 3: Run focused real Playwright**

Run: `npm run test:e2e -- tests/e2e/smoke.spec.ts tests/e2e/playable-flow.spec.ts`

Expected: both specs execute in a browser and pass; no `test.skip`, console error, or pageerror. If the sandbox blocks `127.0.0.1`, rerun with the already approved external execution path and record the actual outcome; do not report browser success from unit tests.

- [ ] **Step 4: Inspect both screenshots**

Open both images and verify:

- The title and two buttons are visible and centered inside safe bounds.
- The canvas contains the pixel-art night/town composition, not a flat fill.
- No visible DOM debug strip or engineering placeholder remains.
- Button labels are readable at 568×320.
- 844×390 keeps the 640×360 composition centered without stretching.

- [ ] **Step 5: Record the card result**

Report exact changed files, focused/full/static/browser command results, screenshot paths, and these explicit remaining items: town movement, NPC world interaction, first-floor exploration, battle rendering, rewards, complete management UI, ImageGen final art, floors 2–10, and abyss visuals. VIS-001 is a foundation card and does not claim the full game goal is complete.
