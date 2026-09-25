import { afterEach, describe, expect, it, vi } from "vitest";
import { assetUrl } from "../../src/app/assetUrl";

afterEach(() => vi.unstubAllEnvs());
describe("asset deployment paths", () => {
  it("prefixes dynamic textures and leaves external and relative resources intact", () => {
    vi.stubEnv("BASE_URL", "/xiangsu/");
    expect(assetUrl("/assets/hero.png")).toBe("/xiangsu/assets/hero.png");
    expect(assetUrl("https://cdn.example.com/hero.png")).toBe("https://cdn.example.com/hero.png");
    expect(assetUrl("//cdn.example.com/hero.png")).toBe("//cdn.example.com/hero.png");
    expect(assetUrl("hero.png")).toBe("hero.png");
    vi.stubEnv("BASE_URL", "/");
    expect(assetUrl("/assets/hero.png")).toBe("/assets/hero.png");
  });
});
