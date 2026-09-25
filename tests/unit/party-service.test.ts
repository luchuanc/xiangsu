import { describe, expect, it } from "vitest";

import type {
  CharacterDefinition,
  CharacterProgressV1,
  GameSaveV1,
  PartyStateV1,
} from "../../src/content/contracts";
import { fixtureContentRoot } from "../../src/content/data";
import { createDomainError, failure, success } from "../../src/domain/common/DomainResult";
import { createCharacterProgress } from "../../src/domain/character/Character";
import {
  PartyService,
  validateParty,
} from "../../src/domain/party/PartyService";
import { createNewGameSave } from "../../src/domain/save/GameSave";

const protagonist = fixtureContentRoot.characters[0];
const companion: CharacterDefinition = { ...protagonist, id: "char_iron_guard" };
const characterById = new Map([
  [protagonist.id, protagonist],
  [companion.id, companion],
]);
const content = {
  getCharacter: (id: string) => {
    const character = characterById.get(id);
    return character
      ? success(character)
      : failure(createDomainError("INVALID_CONTENT", { path: `characters.${id}`, issueKey: "missing_content" }));
  },
};

function progress(character: CharacterDefinition, recruited = true, currentHp = 100): CharacterProgressV1 {
  const result = createCharacterProgress(character, {
    recruited,
    level: 1,
    xp: 0,
    currentHp,
    skillPoints: 0,
  });
  if (!result.ok) throw new Error("队伍测试角色创建失败");
  return result.value;
}

function context(overrides: Record<string, CharacterProgressV1> = {}) {
  return {
    protagonistCharacterId: protagonist.id,
    characters: {
      [protagonist.id]: progress(protagonist, true, 100),
      [companion.id]: progress(companion, true, 100),
      ...overrides,
    },
  };
}

function party(slots: PartyStateV1["slots"]): PartyStateV1 {
  return { slots };
}

function save(): GameSaveV1 {
  const value = createNewGameSave(fixtureContentRoot, "2026-08-21T00:00:00.000Z");
  value.characters[companion.id] = progress(companion, true, 100);
  value.party = party([protagonist.id, null, null, null]);
  return value;
}

describe("PartyService", () => {
  it("接受 1～4 人固定槽位，并允许保存全员倒地队伍", () => {
    const service = new PartyService(content);
    const one = service.validateParty(party([protagonist.id, null, null, null]), context());
    const four = service.validateParty(party([protagonist.id, companion.id, null, null]), context());
    const defeatedContext = context({
      [protagonist.id]: progress(protagonist, true, 0),
      [companion.id]: progress(companion, true, 0),
    });
    const defeated = service.validateParty(party([protagonist.id, companion.id, null, null]), defeatedContext);
    const expedition = service.validatePartyForExpedition(party([protagonist.id, companion.id, null, null]), defeatedContext);

    expect(one.ok).toBe(true);
    expect(four.ok).toBe(true);
    expect(defeated.ok).toBe(true);
    expect(expedition.ok).toBe(false);
    if (!expedition.ok) expect(expedition.error).toEqual({ code: "INVALID_PARTY", details: { reason: "ALL_DEFEATED", characterId: null } });
  });

  it("拒绝空队和缺失主角", () => {
    expect(validateParty(content, party([null, null, null, null]), context())).toMatchObject({
      ok: false,
      error: { code: "INVALID_PARTY", details: { reason: "EMPTY", characterId: null } },
    });
    expect(validateParty(content, party([companion.id, null, null, null]), context())).toMatchObject({
      ok: false,
      error: { code: "INVALID_PARTY", details: { reason: "PROTAGONIST_REQUIRED", characterId: null } },
    });
  });

  it("拒绝重复、未知、未招募和非法槽位值", () => {
    const service = new PartyService(content);
    const duplicate = service.validateParty(party([protagonist.id, protagonist.id, null, null]), context());
    const unknown = service.validateParty(party([protagonist.id, "char_unknown", null, null]), context());
    const mismatchedDefinition = new PartyService({
      getCharacter: () => success({ ...protagonist, id: "char_other" }),
    }).validateParty(party([protagonist.id, null, null, null]), context());
    const unrecruited = service.validateParty(party([protagonist.id, companion.id, null, null]), context({
      [companion.id]: progress(companion, false, 100),
    }));
    const malformed = service.validateParty({ slots: [protagonist.id, undefined, null, null] } as unknown as PartyStateV1, context());

    expect(duplicate).toMatchObject({ ok: false, error: { code: "INVALID_PARTY", details: { reason: "DUPLICATE_CHARACTER", characterId: protagonist.id } } });
    expect(unknown).toMatchObject({ ok: false, error: { code: "INVALID_PARTY", details: { reason: "UNKNOWN_CHARACTER", characterId: "char_unknown" } } });
    expect(mismatchedDefinition).toMatchObject({ ok: false, error: { code: "INVALID_PARTY", details: { reason: "UNKNOWN_CHARACTER", characterId: protagonist.id } } });
    expect(unrecruited).toMatchObject({ ok: false, error: { code: "INVALID_PARTY", details: { reason: "NOT_RECRUITED", characterId: companion.id } } });
    expect(malformed).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT", details: { path: "party.slots[1]", issueKey: "character_id" } } });
  });

  it("提交时只给事务回调深拷贝，成功和失败都不修改输入", async () => {
    const service = new PartyService(content);
    const before = save();
    const beforeJson = JSON.stringify(before);
    const callbackArguments: GameSaveV1[] = [];
    const committed = await service.commit(before, party([protagonist.id, companion.id, null, null]), {
      expectedRevision: 1,
      protagonistCharacterId: protagonist.id,
      save: (expectedRevision, nextSave) => {
        expect(expectedRevision).toBe(1);
        callbackArguments.push(nextSave);
        return success({ ...nextSave, revision: 2 });
      },
    });
    expect(committed.ok).toBe(true);
    expect(before.party.slots).toEqual([protagonist.id, null, null, null]);
    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(callbackArguments[0]?.party.slots).toEqual([protagonist.id, companion.id, null, null]);

    const stale = await service.commit(before, party([protagonist.id, companion.id, null, null]), {
      expectedRevision: 1,
      protagonistCharacterId: protagonist.id,
      save: () => failure(createDomainError("STALE_REVISION", { expectedRevision: 1, actualRevision: 2 })),
    });
    expect(stale.ok).toBe(false);
    expect(JSON.stringify(before)).toBe(beforeJson);
  });
});
