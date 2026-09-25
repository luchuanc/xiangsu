import { describe, expect, it } from "vitest";
import { createMobileGameLayout } from "../../src/ui/layout/MobileGameLayout";
import { calculateViewport, getHitAreaThresholds } from "../../src/app/ViewportService";
import { ExplorationHud } from "../../src/scenes/exploration/ExplorationHud";

describe("MobileGameLayout", () => {
  it.each([
    [{ width: 568, height: 320 }, 55, 10],
    [{ width: 640, height: 360 }, 48, 8],
    [{ width: 844, height: 390 }, 45, 8],
  ] as const)("按视口发布动态命中尺寸 %j", (size, hitSize, gap) => {
    const viewport = calculateViewport(size);
    const layout = createMobileGameLayout(viewport);

    expect(layout).toMatchObject({ hitSize, gap });
    expect(layout.viewport).toBe(viewport);
    expect(layout.fieldHud.joystickHitSize).toBe(Math.max(104, hitSize));
  });

  it("摇杆和动作控件在安全区内，底部锚点不复用旧的 56px action Y", () => {
    const viewport = calculateViewport(
      { width: 844, height: 390 },
      { top: 20, right: 26, bottom: 34, left: 22 },
    );
    const thresholds = getHitAreaThresholds(viewport.scale);
    const hud = new ExplorationHud(viewport.safeRect, thresholds);
    const layout = hud.getLayout();

    for (const control of layout.controls) {
      expect(control.x).toBeGreaterThanOrEqual(viewport.safeRect.x);
      expect(control.y).toBeGreaterThanOrEqual(viewport.safeRect.y);
      expect(control.x + control.width).toBeLessThanOrEqual(viewport.safeRect.right);
      expect(control.y + control.height).toBeLessThanOrEqual(viewport.safeRect.bottom);
    }

    const joystick = layout.controls.find((item) => item.id === "joystick");
    expect(joystick).toBeDefined();
    expect(joystick!.y).toBe(
      viewport.safeRect.bottom - Math.max(104, thresholds.hitSizeLogical) - thresholds.gapLogical,
    );
  });

  it("极端安全区不生成越界或重叠控件，而由 tooSmall 门禁阻止进入", () => {
    const viewport = calculateViewport(
      { width: 640, height: 360 },
      { top: 0, right: 0, bottom: 190, left: 0 },
    );
    expect(viewport.blockedReason).toBe("tooSmall");
    expect(new ExplorationHud(viewport.safeRect).getLayout().controls).toHaveLength(0);
  });
});
