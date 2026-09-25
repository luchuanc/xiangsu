import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
let root = "";
const CLI_TEST_TIMEOUT_MS = 30_000;

const emptyConfig = {
  schemaVersion: 1,
  packId: "visual-v1",
  inputRoot: "art/visual/v1/input",
  outputRoot: "public/assets/visual/v1",
  paletteId: "frontier-night-32-v1",
  alphaMode: "threshold-128",
  entries: [],
};

async function writeConfig(value: unknown = emptyConfig): Promise<string> {
  const configPath = path.join(root, "art/visual/v1/art-pack.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return configPath;
}

async function writeInputLogo(): Promise<void> {
  const width = 320;
  const height = 96;
  const raw = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < 92; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set([215, 154, 84, 255], (y * width + x) * 4);
  }
  const file = path.join(root, "art/visual/v1/input/images/logo.png");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp(raw, { raw: { width, height, channels: 4 } }).png().toFile(file);
}

async function runCli(script: "pack-art.ts" | "verify-art.ts", args: string[] = []) {
  return execFileAsync(process.execPath, [
    path.resolve("node_modules/vite-node/vite-node.mjs"),
    "--root",
    path.resolve("."),
    path.resolve(`scripts/art-pack/${script}`),
    "--config",
    path.join(root, "art/visual/v1/art-pack.json"),
    ...args,
  ], { cwd: root, env: { ...process.env, FORCE_COLOR: "0" } });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "xiangsu-art-cli-"));
  await fs.mkdir(path.join(root, "art/visual/v1/input"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("art pack CLI", () => {
  it("packs, checks, and verifies an empty production configuration", async () => {
    await writeConfig();
    const check = await runCli("pack-art.ts", ["--check"]);
    expect(check.stdout).toContain("ART_PACK_CHECK_OK");
    const pack = await runCli("pack-art.ts");
    expect(pack.stdout).toContain("ART_PACK_PACK_OK");
    const verify = await runCli("verify-art.ts");
    expect(verify.stdout).toContain("ART_PACK_VERIFY_OK");
  }, CLI_TEST_TIMEOUT_MS);

  it("returns stable ART_PACK error output and non-zero exit for invalid config", async () => {
    await writeConfig({ ...emptyConfig, unexpected: true });
    await expect(runCli("pack-art.ts")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("ART_PACK_SCHEMA_INVALID"),
    });
  }, CLI_TEST_TIMEOUT_MS);

  it("verify detects a missing lock/output after a successful check", async () => {
    await writeConfig();
    await runCli("pack-art.ts");
    await fs.rm(path.join(root, "art/visual/v1/art-pack.lock.json"));
    await expect(runCli("verify-art.ts")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("ART_PACK_LOCK_MISSING"),
    });
  }, CLI_TEST_TIMEOUT_MS);

  it("verify rejects non-canonical or tampered lock metadata", async () => {
    await writeConfig();
    await runCli("pack-art.ts");
    const lockPath = path.join(root, "art/visual/v1/art-pack.lock.json");
    const original = await fs.readFile(lockPath);
    const lock = JSON.parse(original.toString("utf8")) as Record<string, unknown>;

    await fs.writeFile(lockPath, `${JSON.stringify({ ...lock, toolchain: { ...(lock.toolchain as object), nodeMajor: 999 } }, null, 2)}\n`, "utf8");
    await expect(runCli("verify-art.ts")).rejects.toMatchObject({ stderr: expect.stringContaining("ART_PACK_TOOLCHAIN_INVALID") });

    await fs.writeFile(lockPath, `${JSON.stringify({ ...lock, extra: true }, null, 2)}\n`, "utf8");
    await expect(runCli("verify-art.ts")).rejects.toMatchObject({ stderr: expect.stringContaining("ART_PACK_LOCK_INVALID") });

    await fs.writeFile(lockPath, JSON.stringify(lock), "utf8");
    await expect(runCli("verify-art.ts")).rejects.toMatchObject({ stderr: expect.stringContaining("ART_PACK_LOCK_CANONICAL_INVALID") });
    await fs.writeFile(lockPath, original);
  }, CLI_TEST_TIMEOUT_MS);

  it("packs a non-empty PNG through the CLI and verifies canonical pixel metadata", async () => {
    await writeInputLogo();
    await writeConfig({
      ...emptyConfig,
      entries: [{
        kind: "image",
        assetId: "image_boot_logo",
        bundleId: "boot",
        input: "images/logo.png",
        output: "ui/logo.png",
        width: 320,
        height: 96,
        source: { sourceKind: "generated", sourceNote: "cli fixture", licenseId: "generated-fixture", licenseFile: null },
      }],
    });
    await runCli("pack-art.ts");
    const lockPath = path.join(root, "art/visual/v1/art-pack.lock.json");
    const original = await fs.readFile(lockPath);
    const lock = JSON.parse(original.toString("utf8")) as { entries: Array<{ outputs: Array<{ pixelSha256?: string }> }> };
    expect(lock.entries[0]?.outputs[0]?.pixelSha256).toMatch(/^[0-9a-f]{64}$/);
    await runCli("verify-art.ts");
    lock.entries[0]!.outputs[0]!.pixelSha256 = "0".repeat(64);
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await expect(runCli("verify-art.ts")).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("ART_PACK_OUTPUT_PIXEL_HASH_MISMATCH") });
    await fs.writeFile(lockPath, original);
  }, CLI_TEST_TIMEOUT_MS);
});
