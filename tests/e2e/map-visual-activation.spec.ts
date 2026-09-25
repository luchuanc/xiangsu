import { expect, test, type Page } from "@playwright/test";
import { collectBrowserErrors, dragPixiJoystick, startNewGame, tapPixiInteraction } from "./playable-helpers";

type MapResponse = { url: string; status: number };
type MapTraffic = { requests: string[]; responses: MapResponse[] };

function listenForMapTraffic(page: Page): MapTraffic {
  const traffic: MapTraffic = { requests: [], responses: [] };
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/assets/") && /\/maps\/(town|floor_01)\.png$/.test(url)) traffic.requests.push(url);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/assets/") && /\/maps\/(town|floor_01)\.png$/.test(url)) {
      traffic.responses.push({ url, status: response.status() });
    }
  });
  return traffic;
}

async function attachScreenshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

async function expectFormalMap(traffic: MapTraffic, mapName: "town" | "floor_01"): Promise<void> {
  const formalPath = `/assets/visual/v1/maps/${mapName}.png`;
  const placeholderPath = `/assets/placeholder/maps/${mapName}.png`;
  await expect.poll(() => traffic.responses.some((entry) => entry.url.endsWith(formalPath) && entry.status === 200), {
    message: `${mapName} 必须通过正式 visual/v1 URL 返回 200`,
    timeout: 10_000,
  }).toBe(true);
  expect(traffic.requests.filter((url) => url.includes(placeholderPath)), `${mapName} request 不得命中 placeholder`).toHaveLength(0);
  expect(traffic.responses.filter((entry) => entry.url.includes(placeholderPath)), `${mapName} response 不得命中 placeholder`).toHaveLength(0);
  expect(traffic.requests.some((url) => url.endsWith(formalPath)), `${mapName} 必须发起正式 URL request`).toBe(true);
  expect(traffic.responses.filter((entry) => entry.url.endsWith(formalPath)).every((entry) => entry.status === 200)).toBe(true);
}

async function openFloor01FromCartographer(page: Page): Promise<void> {
  // 与 town-modal.spec 复用同一条真实摇杆路线：南侧出生点→主路→地图学家。
  await dragPixiJoystick(page, { x: 0, y: -1 }, 6_500);
  await dragPixiJoystick(page, { x: 1, y: 0 }, 3_800);
  await tapPixiInteraction(page);
  await expect(page.getByTestId("town-modal-open-floor-select")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("town-modal-open-floor-select").click();
  await expect(page.getByTestId("town-modal-select-floor-floor_01")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("town-modal-select-floor-floor_01").click();
  const enterFloor = page.getByTestId("town-modal-enter-floor-floor_01-exploration");
  await expect(enterFloor).toBeVisible({ timeout: 10_000 });
  await expect(enterFloor).toBeEnabled();
  await enterFloor.click();
  await expect(page.getByTestId("flow-status")).toContainText("野外", { timeout: 30_000 });
}

test("正式地图资源在真实移动端 H5 城镇与第一层流程中被激活", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = collectBrowserErrors(page);
  const mapTraffic = listenForMapTraffic(page);

  await page.setViewportSize({ width: 568, height: 320 });
  await startNewGame(page);
  await expectFormalMap(mapTraffic, "town");
  await attachScreenshot(page, "map-activation-town-568x320");

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#game-root canvas")).toBeVisible();
  await page.waitForTimeout(100);
  await attachScreenshot(page, "map-activation-town-844x390");

  await page.setViewportSize({ width: 568, height: 320 });
  await expect(page.locator("#game-root canvas")).toBeVisible();
  await page.waitForTimeout(100);
  await attachScreenshot(page, "map-activation-town-568x320-return");

  await openFloor01FromCartographer(page);
  await expectFormalMap(mapTraffic, "floor_01");
  await attachScreenshot(page, "map-activation-floor01-568x320");

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#game-root canvas")).toBeVisible();
  await page.waitForTimeout(100);
  await attachScreenshot(page, "map-activation-floor01-844x390");

  expect(browserErrors, "正式地图真实流程不得产生 console/pageerror").toEqual([]);
});
