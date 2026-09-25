import { describe, expect, it, vi } from "vitest";

import { createNewGameSave } from "../../src/domain/save/GameSave";
import { fixtureContentRoot } from "../../src/content/data";
import { failure, success } from "../../src/domain/common/DomainResult";
import type { GameSaveV1, PartyStateV1 } from "../../src/content/contracts";
import { PartyScreen } from "../../src/ui/screens/PartyScreen";

const timestamp = "2026-08-24T00:00:00.000Z";

function save(): GameSaveV1 {
  const value = createNewGameSave(fixtureContentRoot, timestamp);
  value.characters.char_wanderer.recruited = true;
  return value;
}

describe("RPG-021 PartyScreen", () => {
  it("候补角色不能覆盖主角所在槽位，失败不改变 draft", () => {
    const current = save();
    const ranger = structuredClone(current.characters.char_wanderer);
    ranger.characterId = "char_ranger";
    ranger.recruited = true;
    current.characters.char_ranger = ranger;
    const party = { validateParty: vi.fn((value: PartyStateV1) => success(value)) };
    const screen = new PartyScreen({ currentSave: () => current, partyService: party, protagonistCharacterId: "char_wanderer" });
    const before = JSON.stringify(screen.state.draft);

    const result = screen.placeCharacter("char_ranger", 0);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_PARTY", details: { reason: "PROTAGONIST_REQUIRED", characterId: null } },
    });
    expect(JSON.stringify(screen.state.draft)).toBe(before);
  });

  it("四槽点击选择，跨槽换位保留主角，排位错误仍可解释", () => {
    const current = save();
    const guard = structuredClone(current.characters.char_wanderer);
    guard.characterId = "char_iron_guard";
    guard.recruited = true;
    const ranger = structuredClone(current.characters.char_wanderer);
    ranger.characterId = "char_ranger";
    ranger.recruited = true;
    current.characters.char_iron_guard = guard;
    current.characters.char_ranger = ranger;
    current.party.slots = ["char_wanderer", "char_iron_guard", "char_ranger", null];
    const party = {
      validateParty: vi.fn((value: PartyStateV1) => value.slots.includes("char_wanderer")
        ? success(value)
        : failure({ code: "INVALID_PARTY", details: { reason: "PROTAGONIST_REQUIRED", characterId: null } })),
    };
    const screen = new PartyScreen({ currentSave: () => current, partyService: party, protagonistCharacterId: "char_wanderer" });
    expect(screen.placeCharacter("char_iron_guard", 0).ok).toBe(true);
    expect(screen.state.draft.slots).toEqual(["char_iron_guard", "char_wanderer", "char_ranger", null]);
    expect(screen.placeCharacter("char_iron_guard", 0).ok).toBe(true);
    expect(screen.clearSlot(1)).toMatchObject({ ok: false, error: { code: "INVALID_PARTY", details: { reason: "PROTAGONIST_REQUIRED" } } });
    expect(screen.placeCharacter("char_wanderer", 3).ok).toBe(true);
    expect(screen.state.draft.slots).toEqual(["char_iron_guard", null, "char_ranger", "char_wanderer"]);
    expect(screen.placeCharacter("char_wanderer", 4)).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
  });

  it("取消不污染 Store，确认失败保留 draft，成功后才替换快照", async () => {
    const current = save();
    const persist = vi.fn()
      .mockResolvedValueOnce(failure({ code: "SAVE_FAILED", details: { operation: "save" } }))
      .mockResolvedValueOnce(success({ ...structuredClone(current), revision: 1 }));
    const party = { validateParty: vi.fn((value: PartyStateV1) => success(value)), commit: vi.fn(async (_save: GameSaveV1, value: PartyStateV1, options: { save: typeof persist }) => options.save(0, { ...structuredClone(current), party: value })) };
    const screen = new PartyScreen({ currentSave: () => current, partyService: party as never, persist, protagonistCharacterId: "char_wanderer" });
    screen.placeCharacter("char_wanderer", 0);
    expect(screen.state.draft.slots).toEqual(["char_wanderer", null, null, null]);
    screen.cancel();
    expect(screen.state.draft.slots).toEqual(current.party.slots);
    screen.placeCharacter("char_wanderer", 0);
    expect((await screen.confirm()).ok).toBe(false);
    expect(screen.state.draft.slots[0]).toBe("char_wanderer");
    expect((await screen.confirm()).ok).toBe(true);
    expect(screen.state.draft.slots[0]).toBe("char_wanderer");
  });

  it("招募确认必须匹配当前评估，成功后清空评估状态", async () => {
    const current = save();
    const recruitmentId = "recruit_priest_first_elite";
    const evaluation = {
      recruitmentId,
      characterId: "char_wanderer",
      condition: { kind: "gold", goldCost: 0, minimumClearedFloor: 0 },
      goldCost: 0,
    } as const;
    const recruitment = {
      evaluate: vi.fn(() => success(evaluation)),
      commit: vi.fn(async (_id: string, saveValue: GameSaveV1) => success(structuredClone(saveValue))),
    };
    const screen = new PartyScreen({
      currentSave: () => current,
      partyService: { validateParty: vi.fn((value: PartyStateV1) => success(value)) },
      protagonistCharacterId: "char_wanderer",
      recruitmentService: recruitment,
      persist: vi.fn(),
    });

    expect(await screen.confirmRecruitment(recruitmentId)).toMatchObject({
      ok: false,
      error: { code: "RECRUITMENT_LOCKED", details: { recruitmentId } },
    });
    expect(recruitment.commit).not.toHaveBeenCalled();

    expect(screen.evaluateRecruitment(recruitmentId).ok).toBe(true);
    expect(await screen.confirmRecruitment("recruit_other_candidate")).toMatchObject({
      ok: false,
      error: { code: "RECRUITMENT_LOCKED", details: { recruitmentId: "recruit_other_candidate" } },
    });
    expect(recruitment.commit).not.toHaveBeenCalled();

    expect((await screen.confirmRecruitment(recruitmentId)).ok).toBe(true);
    expect(screen.state.recruitment).toBeNull();
    expect(recruitment.commit).toHaveBeenCalledTimes(1);
  });
});
