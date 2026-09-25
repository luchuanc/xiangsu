# VIS-003 Field Rendering and Walkable Town Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the existing town and exploration projections as a real PixiJS world, then let the player move the protagonist through the town with touch/keyboard input, collision, camera following, NPC interaction, and a floor portal.

**Architecture:** Keep `MovementSystem`, `CollisionGrid`, `CameraSystem`, `InteractionSystem`, `GameStore`, and `SaveCoordinator` as the only rule sources. Add a Pixi-only asset resolver and a shared `FieldSceneView` consumed by both `TownScene` and `ExplorationScene`; the renderer projects tiles, actors, camera, HUD, and interaction state but never mutates save/domain state. `GameApp` remains the only ticker and publishes viewport changes to the active flow.

**Tech Stack:** TypeScript 5, PixiJS v8, Vitest, Playwright, Vite, fixed 640×360 logical canvas with mobile-H5 contain scaling.

**Spec:** `docs/superpowers/specs/2026-09-04-pixijs-visual-rebuild-design.md`

## Global Constraints

- Preserve every existing RPG-001～RPG-029, loadout, Combo recursion, save, content, and reward change.
- Core code comments are Chinese.
- Do not change formulas, save schema, map hashes, object coordinates, content IDs, or encounter rules.
- Do not infer asset IDs, NPC routes, tiles, or names from string suffixes; use exact content/manifest getters.
- Use the existing `GameApp` fixed-step; never start another ticker.
- Visible field UI is Pixi. DOM may mirror the same callbacks for semantics but may not become a second business state.
- World layers always use full 640×360 coordinates; only HUD and semantic controls react to `safeRect`.
- At 568×320, every primary hit rectangle must resolve to at least 48 CSS px and gaps to at least 8 CSS px through `getHitAreaThresholds(scale)`.
- Texture sampling remains nearest, mipmap off, integer positions/anchors.
- Renderer destroy/detach must happen before its scene bundle lease unloads.
- `/Users/lcc/temp/xiangsu` has no independent Git boundary; record exact files and verification rather than creating a parent-repository commit.

## Frozen Interfaces

```ts
export interface FieldSceneFrame {
  readonly map: TileMapView;
  readonly actors: readonly ActorView[];
  readonly camera: CameraPosition;
  readonly hud: ExplorationHudLayout;
  readonly hudStatus: FieldHudStatus;
  readonly interactionTarget: InteractionTarget | null;
  readonly hiddenObjectIds: readonly string[];
  readonly animationStep: number;
}

export interface FieldHudStatus {
  readonly sceneKind: "town" | "exploration";
  readonly mapId: string;
  readonly mapDisplayName: string;
  readonly partySlots: readonly [
    FieldHudPartySlot,
    FieldHudPartySlot,
    FieldHudPartySlot,
    FieldHudPartySlot,
  ];
}

export interface FieldHudPartySlot {
  readonly slot: 0 | 1 | 2 | 3;
  readonly member: {
    readonly characterId: string;
    readonly displayName: string;
    readonly currentHp: number;
    readonly maxHp: number;
  } | null;
}

export interface FieldSceneView {
  prepare(frame: FieldSceneFrame): void | Promise<void>;
  enter(frame: FieldSceneFrame): void;
  update(frame: FieldSceneFrame): void;
  setViewport(viewport: ViewportResult): void;
  pause(): void;
  resume(frame: FieldSceneFrame): void;
  destroy(): void;
}

export interface PixiRenderAssetSource {
  requireEntry(assetId: string): Readonly<AssetEntryV1>;
  requireTexture(assetId: string): Texture;
  requireAtlasFrame(atlasId: string, frameId: string): Texture;
}
```

`FieldSceneRenderer` owns only textures it creates with `new Texture({ source, frame })`; it destroys those derived textures with `destroy(false)` and never destroys AssetService-owned source textures or spritesheets.

---

### Task 1: Dynamic mobile layout and viewport publication

**Files:**
- Create: `src/ui/layout/MobileGameLayout.ts`
- Modify: `src/app/GameApp.ts`
- Modify: `src/app/GameFlowController.ts`
- Modify: `src/scenes/exploration/ExplorationHud.ts`
- Modify: `src/styles.css`
- Test: `tests/unit/mobile-game-layout.test.ts`
- Test: `tests/integration/app-lifecycle.test.ts`
- Test: `tests/integration/game-flow-controller.test.ts`

**Interfaces:**
- Consumes: `ViewportResult`, `getHitAreaThresholds(scale)`, `GameApp.lastViewport`.
- Produces: `createMobileGameLayout(viewport)` and `GameFlowRuntimeLike.subscribeViewport(listener): () => void`.

- [ ] **Step 1: Add failing layout tests**

Assert exact contracts:

```ts
expect(createMobileGameLayout(calculateViewport({ width: 568, height: 320 })))
  .toMatchObject({ hitSize: 55, gap: 10 });

const hud = new ExplorationHud(viewport.safeRect, { hitSizeLogical: 55, gapLogical: 10 });
const joystick = hud.getLayout().controls.find((item) => item.id === "joystick")!;
expect(joystick.y).toBeGreaterThanOrEqual(viewport.safeRect.y);
expect(joystick.y + joystick.height).toBeLessThanOrEqual(viewport.safeRect.bottom);
```

Also assert 640×360 returns hit 48/gap 8; 844×390 returns hit 45/gap 8; simulated side/bottom insets keep all controls inside `safeRect`.

- [ ] **Step 2: Add failing viewport lifecycle tests**

Subscribe before `GameApp.start()`, dispatch `window.resize` and `visualViewport.resize`, and assert one immutable current `ViewportResult` is emitted after each successful layout. Blocked/hidden/context-lost states still publish layout but do not enable input. Unsubscribe and destroy must prevent later callbacks.

- [ ] **Step 3: Implement the layout contract**

`MobileGameLayout` returns:

```ts
export interface MobileGameLayout {
  readonly viewport: ViewportResult;
  readonly hitSize: number;
  readonly gap: number;
  readonly fieldHud: {
    readonly top: number;
    readonly left: number;
    readonly right: number;
    readonly bottom: number;
    readonly joystickVisibleSize: 96;
    readonly joystickHitSize: number;
  };
}
```

Use `Math.max(104, hitSize)` for the joystick hit size. Anchor its bottom with `safeRect.bottom - joystickHitSize - gap`; do not reuse the 56px action-button Y value.

- [ ] **Step 4: Publish viewport without adding a ticker**

Add a listener set to `GameApp`; after canvas width/height/left/top are assigned in `applyViewport()`, synchronously publish the same immutable viewport. Expose `subscribeViewport()` through `GameFlowRuntimeLike`. `GameFlowController` updates its current viewport and forwards it to the active scene/view without rebuilding the save or route.

The system overlay must stay above semantic controls, and a blocked overlay must make both canvas and semantic root noninteractive. Keep `#system-overlay[hidden] { display:none }` unchanged.

- [ ] **Step 5: Verify Task 1**

Run:

```bash
npx vitest run tests/unit/mobile-game-layout.test.ts tests/integration/app-lifecycle.test.ts tests/integration/game-flow-controller.test.ts --environment node
npm run typecheck
npm run lint
```

Expected: all pass; no browser claim yet.

---

### Task 2: Strict Pixi asset resolver

**Files:**
- Create: `src/ui/rendering/PixiAssetResolver.ts`
- Test: `tests/unit/pixi-asset-resolver.test.ts`

**Interfaces:**
- Consumes: explicit `AssetManifestV1`, `AssetServiceLike.getLoadedResource(bundleId)`.
- Produces: `PixiAssetResolver implements PixiRenderAssetSource`.

- [ ] **Step 1: Add failing resolver tests**

Build a minimal manifest containing an image, a spritesheet, and an atlas. Assert:

- exact ID returns its loaded `Texture`;
- atlas frame is read from `Spritesheet.textures[frameId]`;
- missing asset ID throws `PIXEL_ASSET_ENTRY_MISSING:<id>`;
- unloaded owner bundle throws `PIXEL_ASSET_BUNDLE_NOT_LOADED:<bundleId>`;
- missing alias throws `PIXEL_ASSET_ALIAS_MISSING:<assetId>`;
- missing frame throws `PIXEL_ASSET_FRAME_MISSING:<atlasId>/<frameId>`;
- an object that is not Pixi `Texture`/`Spritesheet` is rejected rather than guessed.

- [ ] **Step 2: Implement exact owner lookup**

Index `manifest.assets` by ID and `manifest.bundles` by asset membership once in the constructor. Reject duplicate IDs/owners. Read only the alias map returned by `getLoadedResource(ownerBundleId)`; do not scan every loaded bundle or derive the owner from the asset name.

- [ ] **Step 3: Verify Task 2**

Run:

```bash
npx vitest run tests/unit/pixi-asset-resolver.test.ts --environment node
npm run typecheck
npm run lint
```

Expected: all pass.

---

### Task 3: Shared field scene view and Pixi renderer

**Files:**
- Create: `src/scenes/exploration/FieldSceneView.ts`
- Create: `src/ui/rendering/FieldSceneRenderer.ts`
- Create: `src/ui/rendering/FieldHudRenderer.ts`
- Modify: `src/scenes/exploration/ActorView.ts`
- Modify: `src/scenes/exploration/ExplorationHud.ts`
- Test: `tests/integration/field-scene-renderer.test.ts`
- Test: `tests/integration/exploration-scene.test.ts`

**Interfaces:**
- Consumes: `PixiSceneRoot`, `PixiRenderAssetSource`, `FieldSceneFrame`, existing `VirtualJoystick`, `TouchButton`, and one injected `InputState`.
- Produces: `FieldSceneRenderer implements FieldSceneView`.

- [ ] **Step 1: Add failing tile and layer tests**

With a 2×2 fake map and 16px tiles, assert:

- ground value `0` creates tileset tile 0;
- ground value `1` creates tileset tile 1;
- decor value `0` creates nothing;
- decor value `1` creates tileset tile 0;
- an index outside the sheet columns/rows throws a precise error;
- ground/decorBack mount to `root.mapBack`, actors to `root.actors`, decorFront to `root.mapFront`.

- [ ] **Step 2: Add failing actor/camera tests**

First preserve a frozen copy of the existing discriminated `ActorResourceReference` on `ActorView.resource`; keep `resourceId` for compatibility. Add `displayName?: string` to `ActorViewOptions` and expose a trimmed frozen `displayName: string | null`; the renderer only draws the label when explicitly supplied and never derives one from IDs. Assert player/NPC/encounter/object resources are resolved from the exact discriminator. `FieldSceneRenderer` receives an explicit `objectAtlasId`; it never infers an atlas from a frame ID. Actor sprites use normalized anchor `(12/24, 28/32)` for 24×32 sheets; `zIndex` follows foot Y; hidden object IDs remove actors; four world layers receive `camera.rootOffsetX/rootOffsetY` while HUD remains unshifted.

Track previous actor positions and last non-zero facing inside the renderer only. Every actor starts facing down; no delta uses idle while preserving the last facing. Dominant deltas choose right/left/down/up; exact diagonal ties choose the vertical axis. `animationStep` is the 60Hz fixed-step sequence and the frame is `floor(animationStep * clip.fps / 60) % frameCount`, read only from explicit manifest clips rather than key names or input strings.

- [ ] **Step 3: Add failing HUD input tests**

The renderer receives one injected `InputState`. Dragging the Pixi joystick updates that exact instance; releasing, pausing, leaving the hit area, system-blocking, or destroying resets it. Buttons use one explicit mapping: `map/inventory/party/settings/menu` preserve those action tokens while control ID `interaction` emits the existing scene token `interact`. Interaction/menu buttons use dynamic hit rectangles from `MobileGameLayout`; disabled interaction never emits an action.

The HUD also renders the exact `FieldHudStatus`: map display name and four stable party slots. Empty slots do not collapse, `currentHp = 0` renders an empty bar, display values clamp visually to `0..maxHp` without mutating the projection, and HUD never moves with the camera.

- [ ] **Step 4: Implement renderer ownership**

Create/destroy only route-owned Sprite/Graphics/Text and derived frame textures. Do not destroy textures returned directly by `PixiRenderAssetSource`. `prepare()` builds tiles once and actors/HUD from the first frame; `update()` mutates positions/frames/state without recreating the whole map; `pause()` freezes controls; `resume()` reapplies a complete frame; `destroy()` removes every listener and child exactly once.

- [ ] **Step 5: Verify Task 3**

Run:

```bash
npx vitest run tests/integration/field-scene-renderer.test.ts tests/unit/touch-input.test.ts --environment node
npm run typecheck
npm run lint
```

Expected: all pass.

---

### Task 4: Make TownScene a real field runtime

**Files:**
- Modify: `src/scenes/town/TownScene.ts`
- Test: `tests/integration/town-scene.test.ts`

**Interfaces:**
- Consumes: town `MapDefinition`, `CollisionGrid`, `movePlayer`, `CameraSystem`, `InteractionSystem(40)`, `FieldSceneView`.
- Produces: `TownScene` lifecycle and fixed-step updates over a complete `FieldSceneFrame`.

- [ ] **Step 1: Add failing town runtime tests**

Assert:

- `prepare()` builds `TileMapView`/actors and initializes camera at `{640,800}` before first render;
- each fixed step snapshots input exactly once and moves at the existing 72px/s rule;
- wall tiles and all seven blocking NPC objects cannot be crossed;
- camera follows and clamps to the 1280×960 map;
- NPC within 40px becomes the target and `interact` resolves it exactly once;
- open panel freezes movement and resets pointers; closing retains position/facing and restores input;
- portal `obj_town_floor_portal` opens floor selection rather than directly mutating the save;
- pause/resume/destroy propagate to the view and are idempotent.

- [ ] **Step 2: Extend TownScene options without guessing assets**

Add exact inputs:

```ts
readonly map: Readonly<MapDefinition>;
readonly resources: ExplorationSceneResources;
readonly tilesetAssetId: string;
readonly playerFieldSpriteId: string;
readonly npcPresentation: (npcId: string) => Readonly<{ spriteId: string; displayName: string }>;
readonly view?: FieldSceneView;
readonly onInteraction?: (target: InteractionTarget) => void | Promise<void>;
readonly getHudStatus: () => Readonly<FieldHudStatus>;
```

The content layer supplies each mapping. Unknown NPC/resource IDs fail before entering; do not create a default sprite.

- [ ] **Step 3: Implement fixed-step order**

The order is immutable: one snapshot → `movePlayer` → camera → actor sync → interaction selection → view update → at most one action dispatch. Reuse existing `interactNpc()` and panel methods. Do not duplicate collision AABB, speed, or NPC gate logic.

- [ ] **Step 4: Verify Task 4**

Run:

```bash
npx vitest run tests/integration/town-scene.test.ts --environment node
npm run typecheck
npm run lint
```

Expected: all pass.

---

### Task 5: Wire town rendering into GameFlow

**Files:**
- Modify: `src/app/GameFlowController.ts`
- Modify: `src/scenes/exploration/ExplorationScene.ts`
- Test: `tests/integration/game-flow-controller.test.ts`
- Test: `tests/integration/exploration-scene.test.ts`

**Interfaces:**
- Consumes: `PixiSceneRoot`, `PixiAssetResolver`, `FieldSceneRenderer`, exact `map_town`, content getters, and GameApp's existing fixed-step.
- Produces: visible town route and a view-ready exploration route.

- [ ] **Step 1: Add failing flow tests**

Assert production town creation:

- queries exact town map and exact manifest IDs;
- acquires the town bundle before renderer preparation;
- installs a fixed handler for both `town` and `exploration`, never for title/battle/reward;
- forwards viewport updates to the active view;
- removes the viewport subscription and fixed handler on destroy;
- NPC world interaction calls `NpcService.resolve` only once;
- holding the Pixi joystick is not zeroed by `renderUi()` when there are no legacy DOM move pointers.
- projects exact `map_town`/expedition map display names and four party slots from the current authoritative save; max HP reuses `calculateStaticMaxHp`, missing content/localization fails explicitly, and raw IDs are never used as player-visible fallback.
- Town and Exploration forward `map/inventory/party/settings/menu` from the one fixed-step snapshot to GameFlow; neither scene nor GameFlow may take a second snapshot after movement/interaction consumed it.

- [ ] **Step 2: Split NPC resolution to prevent recursion**

Keep `handleNpc(npcId)` for semantic/test callers. Move its current post-resolution switch into:

```ts
private async applyNpcResolution(resolution: NpcResolution): Promise<void>
```

World interaction lets `TownScene.interactNpc()` resolve once, then calls `applyNpcResolution`. Never call `handleNpc()` from `TownScene.onNpcRoute`.

- [ ] **Step 3: Integrate exact assets and renderer**

For real `PixiSceneRoot`, build `PixiAssetResolver` from the active manifest and runtime asset service. Supply explicit player/NPC resource IDs and localized NPC display names from exact content definitions plus `zhCN`; create `FieldSceneRenderer`; inject the same `InputState` already consumed by the scene. Missing localization is explicit invalid content, never a raw-ID fallback. Fake-root tests continue without Pixi.

Update `ExplorationScene` to accept optional `FieldSceneView`, initialize its camera during `prepare()`, pass defeated encounters and opened chests in `hiddenObjectIds`, and destroy the view inside `lease.release({ beforeUnload })`.

Build `FieldHudStatus` only in `GameFlowController`: preserve all four slots including nulls, resolve exact character/map definitions and `zhCN[nameKey]`, and reuse `calculateStaticMaxHp()` with the existing equipment/passive content adapter. Inject a getter into Town/Exploration; renderer and scenes must never read Store/content or duplicate HP formulas. Cache only by save revision + scene kind + map ID, and refresh the complete frame after panel close/resume.

- [ ] **Step 4: Fix fixed-step and held-input lifecycle**

Install the handler when state is town or exploration. `fixedUpdateStep()` first advances town when active; otherwise keep existing exploration/auto-encounter behavior unchanged. `resetHeldMoveInput()` may call `inputState.setMove(0,0)` only when it actually clears one or more legacy DOM pointers; route pause/destroy still uses `InputLayer.resetAll()`.

- [ ] **Step 5: Verify Task 5**

Run:

```bash
npx vitest run tests/integration/game-flow-controller.test.ts tests/integration/exploration-scene.test.ts tests/integration/town-scene.test.ts --environment node
npm run test:unit
npm run typecheck
npm run lint
npm run build
npm run verify:content -- --mode batch --batch verticalSlice
npm run verify:assets -- --batch verticalSlice
```

Expected: all pass except only explicitly pre-existing, separately evidenced failures; no browser claim yet.

---

### Task 6: Real touch and visual acceptance

**Files:**
- Create: `tests/e2e/helpers/logical-coordinates.ts`
- Modify: `tests/e2e/smoke.spec.ts`
- Modify: `tests/e2e/exploration-touch.spec.ts`
- Modify: `tests/e2e/playable-flow.spec.ts`
- Evidence only: `/private/tmp/xiangsu-visual/town-{568x320,640x360,844x390}.png`

**Interfaces:**
- Consumes: canvas bounding box and fixed 640×360 coordinates.
- Produces: `logicalToClient(canvasBox, point)` and real pointer/touch evidence.

- [ ] **Step 1: Replace town legacy-control assertions**

Do not use hidden `enter-floor`, NPC, or movement DOM buttons as visible UI proof. Use the visible title pointer control, then tap/drag the Pixi joystick using coordinates derived from the current canvas box and logical layout.

- [ ] **Step 2: Prove movement and interaction**

At 568×320:

1. Enter a new game with a real pointer.
2. Capture the visible town containing map, protagonist, at least five NPCs, and HUD.
3. Drag the visible joystick; use a scene semantic position status only as an assertion aid and screenshots/pixel movement as visual evidence.
4. Release and assert position stops changing.
5. Navigate near one NPC, assert the visible interaction affordance enables, and open/close its panel with real canvas coordinates.
6. Navigate to `obj_town_floor_portal`, open the visible floor panel, and select floor 1.

- [ ] **Step 3: Run the viewport matrix**

Repeat screenshots at 640×360 and 844×390. Assert 16:9 contain, world not stretched, HUD inside `safeRect`, primary hit boxes at least 48 CSS px, no click on pillar bars. Also run 390×844 rotate gate and 567×320 too-small gate; system overlay must block canvas and semantics.

- [ ] **Step 4: Browser error gate**

Collect `console.error`, `pageerror`, same-origin `requestfailed`, and unhandled promise evidence for every visible flow. All must be empty. No `test.skip`, save injection, TestHooks, direct position mutation, or hidden legacy click may be used for the visible acceptance path.

- [ ] **Step 5: Final verification**

Run:

```bash
npm run test:e2e -- tests/e2e/smoke.spec.ts tests/e2e/exploration-touch.spec.ts tests/e2e/playable-flow.spec.ts
```

Then inspect all three town screenshots at original resolution. The card is complete only if the map, protagonist, NPCs, HUD, movement, NPC panel, and floor portal are visibly usable. A green hidden-DOM business regression is not completion.

## Follow-on Cards

- VIS-002 art-pack task replaces current one-color placeholders with project-original ImageGen-derived title/town/floor/actor/UI resources while preserving IDs and dimensions.
- VIS-004 uses the same `FieldSceneRenderer` for floor 1 encounters, chests, portal, and contact transition.
- VIS-005A–D add battle projection, touch command/target UI, committed-event presentation, and the independent reward scene.
