import { generateBattleActorInputs } from "./battle-actors/BattleActorRenderer";

export async function generateBattleArt(projectRoot = process.cwd()): Promise<void> {
  const frameCount = await generateBattleActorInputs(projectRoot);
  console.log(`BATTLE_ART_GENERATE_OK:${frameCount}`);
}

await generateBattleArt().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

