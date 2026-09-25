import { generateFieldActorInputs } from "./field-actors/FieldActorRenderer";

export async function generateFieldArt(projectRoot = process.cwd()): Promise<void> {
  const frameCount = await generateFieldActorInputs(projectRoot);
  console.log(`FIELD_ART_GENERATE_OK:${frameCount}`);
}

await generateFieldArt().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
