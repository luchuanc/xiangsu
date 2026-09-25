import type { CharacterDefinition, GameSaveV1 } from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import { calculateStats } from "../character/StatCalculator";

export interface InnContentSource {
  getCharacter(id: string): DomainResult<Readonly<CharacterDefinition>>;
}

export interface InnResult {
  readonly save: GameSaveV1;
  readonly changed: boolean;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

/** 旅店只做免费全体恢复候选；保存提交由应用层协调器负责。 */
export class InnService {
  public constructor(private readonly content: InnContentSource) {}

  public rest(save: GameSaveV1): DomainResult<InnResult> {
    if (save.expedition !== null || save.battle !== null) return failure(createDomainError("NOT_IN_TOWN", null));
    const next = structuredClone(save);
    let changed = false;
    for (const characterId of next.party.slots) {
      if (characterId === null) continue;
      const progress = next.characters[characterId];
      if (!progress || !progress.recruited) return invalid(`characters.${characterId}`, "recruited_required");
      let character: DomainResult<Readonly<CharacterDefinition>>;
      try {
        character = this.content.getCharacter(characterId);
      } catch {
        return invalid(`characters.${characterId}`, "getter_failed");
      }
      if (!character.ok || character.value.id !== characterId) return invalid(`characters.${characterId}`, "missing_content");
      const stats = calculateStats(character.value, progress.level);
      if (!stats.ok) return stats;
      const maxHp = stats.value.stats.maxHp;
      if (progress.currentHp !== maxHp) {
        progress.currentHp = maxHp;
        changed = true;
      }
    }
    return success({ save: next, changed });
  }
}
