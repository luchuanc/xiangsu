import { promises as fs } from "node:fs";
import path from "node:path";
import { ArtPackError } from "./ArtPackSchema";
import { verifyArtPack } from "./ArtPackValidator";

function readArgument(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new ArtPackError("ART_PACK_USAGE", `missing ${name}`);
  return value;
}

export async function runVerifyCli(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const configPath = path.resolve(readArgument(args, "--config"));
  const config = JSON.parse(await fs.readFile(configPath, "utf8")) as unknown;
  await verifyArtPack(config, { projectRoot: process.cwd() });
  console.log("ART_PACK_VERIFY_OK");
}

try {
  await runVerifyCli();
} catch (error) {
  const message = error instanceof ArtPackError ? error.message : `ART_PACK_INTERNAL:${error instanceof Error ? error.message : String(error)}`;
  console.error(message);
  process.exitCode = 1;
}
