/**
 * 内容校验 CLI：只接受冻结参数，输出稳定 canonical JSON 与 SHA-256 报告。
 * 本脚本不读取 Markdown；数据入口是结构化 TypeScript 内容根。
 */
import { createHash } from "node:crypto";
import { ContentCatalog, type BatchId, type ValidationMode } from "../src/content/Catalog";
import { candidateContentRoot, finalContentRoot, fixtureContentRoot } from "../src/content/data";
import { abyssEchoContentRoot } from "../src/content/data/abyssEchoes";
import { floors02To05Content } from "../src/content/data/floors02-05";
import { floors06To10Content } from "../src/content/data/floors06-10";
import { verticalSliceContentRoot } from "../src/content/data/verticalSlice";
import { expectedLocaleKeys, localeTokenSpec, validateLocale, zhCN } from "../src/content/locales/zh-CN";
import { assertFrozenBlueprint, buildAllMapBlueprints } from "../src/content/builders/mapBlueprint";
import type { ContentRootV1 } from "../src/content/contracts";

const batchIds: readonly BatchId[] = ["verticalSlice", "floors02_05", "floors06_10", "abyssEchoes"];
const collectionNames = ["characters", "skills", "statuses", "equipmentBases", "equipmentAffixes", "affixTriggers", "skillAffixes", "combos", "enemies", "encounters", "encounterModifiers", "bossIntents", "abyssEchoes", "floors", "maps", "npcs", "dialogues", "quests", "recruitments", "shops", "items", "dropTables"] as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}
function canonicalJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function counts(root: ContentRootV1): Record<string, number> { return Object.fromEntries(collectionNames.map((name) => [name, root[name].length])); }
function parseArgs(args: readonly string[]): ValidationMode {
  if (args.length === 0) return "final";
  if (args[0] !== "--mode" || args.length < 2) throw new Error("参数必须是 --mode fixture|final 或 --mode batch --batch <batchId>");
  const mode = args[1];
  if (mode === "fixture" && args.length === 2) return "fixture";
  if (mode === "final" && args.length === 2) return "final";
  if (mode === "batch" && args.length === 4 && args[2] === "--batch" && batchIds.includes(args[3] as BatchId)) return { kind: "batch", batchId: args[3] as BatchId };
  throw new Error("mode/batch 参数非法或存在多余参数");
}
function rootForMode(mode: ValidationMode): ContentRootV1 {
  if (typeof mode !== "string" && mode.batchId === "verticalSlice") return verticalSliceContentRoot;
  // 累计批次必须使用对应冻结内容根，不能回退到 fixture 根导致批次 ID 丢失。
  if (typeof mode !== "string" && mode.batchId === "floors02_05") return floors02To05Content;
  if (typeof mode !== "string" && mode.batchId === "floors06_10") return floors06To10Content;
  if (typeof mode !== "string" && mode.batchId === "abyssEchoes") return abyssEchoContentRoot;
  if (mode === "fixture") return fixtureContentRoot;
  if (typeof mode !== "string") return candidateContentRoot;
  return finalContentRoot;
}
function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

try {
  const mode = parseArgs(process.argv.slice(2));
  const root = rootForMode(mode);
  const catalog = ContentCatalog.create(root, mode);
  if (!catalog.ok) fail(`内容校验失败: ${catalog.error.code}:${catalog.error.details.issueKey}`);
  const locale = validateLocale(zhCN);
  if (!locale.ok) fail(`本地化校验失败: ${locale.error.code}:${locale.error.details.issueKey}`);
  const blueprints = buildAllMapBlueprints();
  for (const blueprint of blueprints) assertFrozenBlueprint(blueprint);
  const canonicalContent = canonicalJson(root);
  const canonicalLocale = canonicalJson(zhCN);
  const report = {
    mode,
    contentVersion: root.contentVersion,
    counts: counts(root),
    locale: { keyCount: expectedLocaleKeys.length, tokenKeyCount: Object.keys(localeTokenSpec).length },
    hashes: {
      contentSha256: sha256(canonicalContent),
      localeSha256: sha256(canonicalLocale),
      collisionSha256: Object.fromEntries(blueprints.map((blueprint) => [blueprint.mapId, blueprint.collisionSha256])),
    },
  };
  process.stdout.write(`${canonicalJson(report)}\n`);
} catch (error) {
  if (process.exitCode !== 1) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
