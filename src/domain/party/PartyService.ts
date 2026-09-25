/**
 * 队伍领域边界。
 *
 * 队伍只保存四个固定槽位；角色静态定义、角色招募状态和存档写入能力
 * 都由调用方显式注入。本服务只返回新的值，不修改传入的快照。
 */
import type {
  CharacterDefinition,
  CharacterId,
  CharacterProgressV1,
  GameSaveV1,
  PartyStateV1,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";

export interface PartyContentSource {
  getCharacter(id: CharacterId): DomainResult<Readonly<CharacterDefinition>>;
}

/** Party 校验所需的最小存档投影，避免服务读取未声明的业务字段。 */
export interface PartyValidationContext {
  readonly protagonistCharacterId: CharacterId;
  readonly characters: Readonly<Record<CharacterId, Pick<CharacterProgressV1, "characterId" | "recruited" | "currentHp">>>;
}

export interface PartyCommitOptions {
  readonly expectedRevision: number;
  readonly protagonistCharacterId: CharacterId;
  readonly save: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function invalidParty(
  reason: "EMPTY" | "PROTAGONIST_REQUIRED" | "DUPLICATE_CHARACTER" | "UNKNOWN_CHARACTER" | "NOT_RECRUITED" | "ALL_DEFEATED",
  characterId: CharacterId | null,
): DomainResult<never> {
  return failure(createDomainError("INVALID_PARTY", { reason, characterId }));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneParty(party: PartyStateV1): PartyStateV1 {
  return { slots: [...party.slots] as PartyStateV1["slots"] };
}

function validateContext(context: PartyValidationContext): DomainResult<true> {
  if (!isRecord(context)) return invalid("partyContext", "not_object");
  if (typeof context.protagonistCharacterId !== "string" || context.protagonistCharacterId.length === 0) {
    return invalid("partyContext.protagonistCharacterId", "empty_id");
  }
  if (!isRecord(context.characters)) return invalid("partyContext.characters", "not_object");
  return success(true);
}

function validateSlotsShape(party: PartyStateV1): DomainResult<PartyStateV1["slots"]> {
  if (!isRecord(party)) return invalid("party", "not_object");
  const partyKeys = Object.keys(party);
  if (partyKeys.length !== 1 || partyKeys[0] !== "slots") return invalid("party", "strict_shape");
  if (!Array.isArray(party.slots) || party.slots.length !== 4) return invalid("party.slots", "slot_count");
  const slotKeys = Object.keys(party.slots);
  if (slotKeys.length !== 4 || slotKeys.some((key, index) => key !== String(index))) {
    return invalid("party.slots", "slot_shape");
  }
  for (const [index, characterId] of party.slots.entries()) {
    if (characterId !== null && (typeof characterId !== "string" || characterId.length === 0)) {
      return invalid(`party.slots[${index}]`, "character_id");
    }
  }
  return success(party.slots as PartyStateV1["slots"]);
}

function characterProgressFor(
  context: PartyValidationContext,
  characterId: CharacterId,
): Pick<CharacterProgressV1, "characterId" | "recruited" | "currentHp"> | undefined {
  if (!Object.prototype.hasOwnProperty.call(context.characters, characterId)) return undefined;
  return context.characters[characterId];
}

/**
 * 校验可保存的编队。全员倒地在这里是合法状态，出城时再走独立门禁。
 */
export function validateParty(
  content: PartyContentSource,
  party: PartyStateV1,
  context: PartyValidationContext,
): DomainResult<PartyStateV1> {
  const contextResult = validateContext(context);
  if (!contextResult.ok) return contextResult;
  if (!content || typeof content.getCharacter !== "function") return invalid("content.getCharacter", "getter_required");
  const slotsResult = validateSlotsShape(party);
  if (!slotsResult.ok) return slotsResult;
  const slots = slotsResult.value;
  const occupied = slots.filter((characterId): characterId is CharacterId => characterId !== null);
  if (occupied.length === 0) return invalidParty("EMPTY", null);
  if (!occupied.includes(context.protagonistCharacterId)) return invalidParty("PROTAGONIST_REQUIRED", null);

  const seen = new Set<CharacterId>();
  for (const characterId of occupied) {
    if (seen.has(characterId)) return invalidParty("DUPLICATE_CHARACTER", characterId);
    seen.add(characterId);

    let characterResult: DomainResult<Readonly<CharacterDefinition>>;
    try {
      characterResult = content.getCharacter(characterId);
    } catch {
      return invalidParty("UNKNOWN_CHARACTER", characterId);
    }
    if (!characterResult.ok) return invalidParty("UNKNOWN_CHARACTER", characterId);
    if (characterResult.value.id !== characterId) return invalidParty("UNKNOWN_CHARACTER", characterId);

    const progress = characterProgressFor(context, characterId);
    if (!progress || progress.characterId !== characterId || progress.recruited !== true) {
      return invalidParty("NOT_RECRUITED", characterId);
    }
  }
  return success(cloneParty({ slots }));
}

/** 远征入口的额外门禁：至少有一名已编入队伍的角色存活。 */
export function validatePartyForExpedition(
  content: PartyContentSource,
  party: PartyStateV1,
  context: PartyValidationContext,
): DomainResult<PartyStateV1> {
  const valid = validateParty(content, party, context);
  if (!valid.ok) return valid;
  const occupied = valid.value.slots.filter((characterId): characterId is CharacterId => characterId !== null);
  for (const characterId of occupied) {
    const progress = characterProgressFor(context, characterId);
    if (!progress || !Number.isSafeInteger(progress.currentHp) || progress.currentHp < 0) {
      return invalid(`characters.${characterId}.currentHp`, "current_hp");
    }
    if (progress.currentHp > 0) return success(cloneParty(valid.value));
  }
  return invalidParty("ALL_DEFEATED", null);
}

function cloneSave(save: GameSaveV1): GameSaveV1 {
  return structuredClone(save);
}

/**
 * 以一次显式 CAS/事务回调提交新编队。领域层不会自行递增 revision，
 * 也不会在保存失败时改写调用方的 GameSave。
 */
export async function commitParty(
  content: PartyContentSource,
  save: GameSaveV1,
  party: PartyStateV1,
  options: PartyCommitOptions,
): Promise<DomainResult<GameSaveV1>> {
  if (!options || typeof options !== "object") return invalid("options", "not_object");
  if (!isRecord(save)) return invalid("save", "not_object");
  if (!isRecord(save.characters)) return invalid("save.characters", "not_object");
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) {
    return invalid("options.expectedRevision", "revision");
  }
  if (typeof options.save !== "function") return invalid("options.save", "transaction_required");
  const context: PartyValidationContext = {
    protagonistCharacterId: options.protagonistCharacterId,
    characters: save.characters,
  };
  const partyResult = validateParty(content, party, context);
  if (!partyResult.ok) return partyResult;
  let nextSave: GameSaveV1;
  try {
    nextSave = cloneSave(save);
  } catch {
    return invalid("save", "clone_failed");
  }
  nextSave.party = cloneParty(partyResult.value);
  try {
    return await options.save(options.expectedRevision, nextSave);
  } catch {
    return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
  }
}

export class PartyService {
  private readonly content: PartyContentSource;

  public constructor(content: PartyContentSource) {
    this.content = content;
  }

  public validateParty(party: PartyStateV1, context: PartyValidationContext): DomainResult<PartyStateV1> {
    return validateParty(this.content, party, context);
  }

  public validatePartyForExpedition(party: PartyStateV1, context: PartyValidationContext): DomainResult<PartyStateV1> {
    return validatePartyForExpedition(this.content, party, context);
  }

  public commit(save: GameSaveV1, party: PartyStateV1, options: PartyCommitOptions): Promise<DomainResult<GameSaveV1>> {
    return commitParty(this.content, save, party, options);
  }
}
