import type { NpcDefinition, WorldProgressV1 } from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";

export interface NpcContentSource {
  getNpc(id: string): DomainResult<Readonly<NpcDefinition>>;
}

export interface NpcUnlockState {
  readonly world: Pick<WorldProgressV1, "highestUnlockedFloor" | "clearedBossEncounterIds" | "storyCompleted">;
}

export interface NpcRoute {
  readonly npcId: string;
  readonly function: NpcDefinition["function"];
  readonly dialogueId: string;
  readonly spriteId: string;
}

export interface NpcResolution {
  readonly npc: Readonly<NpcDefinition>;
  readonly route: NpcRoute;
  readonly locked: boolean;
  readonly lockReasonKey: string | null;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function locked(npc: Readonly<NpcDefinition>): DomainResult<never> {
  return failure(createDomainError("NPC_LOCKED", { npcId: npc.id, lockReasonKey: npc.lockReasonKey }));
}

function validateDefinition(npc: Readonly<NpcDefinition>): DomainResult<true> {
  if (!npc || typeof npc !== "object") return invalid("npc", "not_object");
  if (typeof npc.id !== "string" || typeof npc.dialogueId !== "string" || typeof npc.spriteId !== "string") return invalid("npc", "reference_type");
  if (npc.id.length === 0 || npc.dialogueId.length === 0 || npc.spriteId.length === 0) return invalid("npc", "empty_reference");
  if (npc.unlockCondition.kind === "floorCleared" && (!Number.isSafeInteger(npc.unlockCondition.floorNumber) || npc.unlockCondition.floorNumber < 1)) {
    return invalid(`npcs.${npc.id}.unlockCondition.floorNumber`, "floor_range");
  }
  return success(true);
}

function isUnlocked(npc: Readonly<NpcDefinition>, state: NpcUnlockState): boolean {
  switch (npc.unlockCondition.kind) {
    case "always":
      return true;
    case "floorCleared":
      return state.world.highestUnlockedFloor >= npc.unlockCondition.floorNumber;
    case "encounterCleared":
      return state.world.clearedBossEncounterIds.includes(npc.unlockCondition.encounterId);
    default:
      return false;
  }
}

/** 严格按 NpcDefinition.function 返回固定路由，未知 function 不静默落到默认页。 */
export function resolveNpcRoute(npc: Readonly<NpcDefinition>, state: NpcUnlockState): DomainResult<NpcResolution> {
  const valid = validateDefinition(npc);
  if (!valid.ok) return valid;
  const functions: readonly NpcDefinition["function"][] = ["tavern", "blacksmith", "skillMentor", "merchant", "inn", "cartographer", "abyssWatcher"];
  if (!functions.includes(npc.function)) return invalid(`npcs.${npc.id}.function`, "unknown_function");
  const route: NpcRoute = Object.freeze({ npcId: npc.id, function: npc.function, dialogueId: npc.dialogueId, spriteId: npc.spriteId });
  if (!isUnlocked(npc, state)) return locked(npc);
  return success(Object.freeze({ npc, route, locked: false, lockReasonKey: null }));
}

export class NpcService {
  public constructor(private readonly content: NpcContentSource) {}

  public resolve(npcId: string, state: NpcUnlockState): DomainResult<NpcResolution> {
    if (typeof npcId !== "string" || npcId.length === 0) return invalid("npcId", "empty_id");
    let result: DomainResult<Readonly<NpcDefinition>>;
    try {
      result = this.content.getNpc(npcId);
    } catch {
      return invalid(`npcs.${npcId}`, "getter_failed");
    }
    if (!result.ok) return result;
    if (result.value.id !== npcId) return invalid(`npcs.${npcId}`, "id_mismatch");
    return resolveNpcRoute(result.value, state);
  }
}
