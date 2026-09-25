import { describe, expect, it, vi } from "vitest";

import { createNewGameSave } from "../../src/domain/save/GameSave";
import { fixtureContentRoot } from "../../src/content/data";
import { failure, success } from "../../src/domain/common/DomainResult";
import type { CharacterProgressV1, GameSaveV1, ReforgePreviewV1, SkillDefinition, SkillStoneInstance } from "../../src/content/contracts";
import { SkillScreen } from "../../src/ui/screens/SkillScreen";

const timestamp = "2026-08-24T00:00:00.000Z";

function save(): GameSaveV1 {
  const value = createNewGameSave(fixtureContentRoot, timestamp);
  const progress = value.characters.char_wanderer;
  progress.recruited = true;
  progress.level = 2;
  progress.skillPoints = 1;
  return value;
}

function skill(id: string, level = 1): SkillDefinition {
  return { ...fixtureContentRoot.skills.find((value) => value.id === id)!, unlockLevel: level, maxLevel: 5 };
}

function reforgeStone(instanceId: string, overrides: Partial<SkillStoneInstance> = {}): SkillStoneInstance {
  return {
    instanceId,
    attunedCharacterId: "char_wanderer",
    itemLevel: 10,
    quality: "rare",
    affixes: [
      { skillAffixId: "affix_power", roll: 100, reforged: false },
      { skillAffixId: "affix_repeat", roll: 100, reforged: false },
    ],
    abyssAffix: null,
    locked: false,
    acquiredAt: timestamp,
    sourceTransactionId: "tx_reforge",
    reforgeLockedIndex: null,
    reforgeCount: 0,
    ...overrides,
  };
}

function skillStonePreview(instanceId: string, reforgeCount = 0): ReforgePreviewV1 {
  return {
    contentVersion: "content-1.2.0",
    itemKind: "skillStone",
    instanceId,
    lockedIndex: 0,
    reforgeCount,
    costItemId: "item_inscription_dust",
    costQuantity: 7,
    candidates: [0, 1, 2].map((candidateIndex) => ({
      candidateIndex: candidateIndex as 0 | 1 | 2,
      kind: "skillStone" as const,
      roll: { skillAffixId: `affix_candidate_${candidateIndex}`, roll: 100 + candidateIndex, reforged: false },
    })),
  };
}

describe("RPG-021 SkillScreen", () => {
  it("导师升级/双槽/免费重置经领域 preview，技能点和等级锁定原因可见", async () => {
    const current = save();
    const skills = fixtureContentRoot.skills;
    const content = {
      getCharacter: () => success(fixtureContentRoot.characters[0]),
      getSkill: (id: string) => {
        const value = skills.find((skillValue) => skillValue.id === id);
        return value ? success(value) : failure({ code: "INVALID_CONTENT", details: { path: id, issueKey: "missing" } });
      },
    };
    const skillService = {
      upgrade: vi.fn((progress: CharacterProgressV1, id: string) => success({ ...structuredClone(progress), skillLevels: { ...progress.skillLevels, [id]: 1 }, skillPoints: 0 })),
      equipSkill: vi.fn((progress: CharacterProgressV1, id: string, slot: 0 | 1) => success({ ...structuredClone(progress), equippedActiveSkillIds: slot === 0 ? [id, progress.equippedActiveSkillIds[1]] : [progress.equippedActiveSkillIds[0], id] })),
      reset: vi.fn((progress: CharacterProgressV1) => success({ ...structuredClone(progress), skillPoints: 5, equippedActiveSkillIds: [null, null] as [string | null, string | null] })),
    };
    const persist = vi.fn(async (_revision: number, next: GameSaveV1) => {
      Object.assign(current, structuredClone(next));
      return success({ ...structuredClone(next), revision: next.revision + 1 });
    });
    const screen = new SkillScreen({ currentSave: () => current, content, skillService: skillService as never, persist });
    expect(screen.state.skills).toHaveLength(4);
    expect((await screen.upgrade(skills[1]!.id)).ok).toBe(true);
    expect((await screen.equip(skills[1]!.id, 0)).ok).toBe(true);
    expect(screen.state.slots[0]).toBe(skills[1]!.id);
    screen.requestReset();
    expect((await screen.reset()).ok).toBe(true);
    expect(screen.state.disabledReasons.some((value) => value.key === "skill.insufficient_points")).toBe(false);
  });

  it("铭石显示 stackRule/目标范围/冲突，调谐专注仅无远征且已招募", async () => {
    const current = save();
    const stone: SkillStoneInstance = { instanceId: "stone_1", attunedCharacterId: "char_wanderer", itemLevel: 1, quality: "magic", affixes: [{ skillAffixId: "affix_power", roll: 100, reforged: false }], abyssAffix: null, locked: false, acquiredAt: timestamp, sourceTransactionId: "tx", reforgeLockedIndex: null, reforgeCount: 0 };
    current.inventory.skillStones.push(stone);
    const screen = new SkillScreen({
      currentSave: () => current,
      persist: async (_revision, next) => {
        Object.assign(current, structuredClone(next));
        return success({ ...structuredClone(next), revision: next.revision + 1 });
      },
      skillContent: { getCharacter: () => success(fixtureContentRoot.characters[0]), getSkill: (id: string) => success(skill(id)), getSkillAffix: () => success({ id: "affix_power", nameKey: "affix.power", descriptionKey: "affix.power.desc", kind: "amplify", pool: "normal", target: { kind: "allSkills" }, minItemLevel: 1, allowedQualities: ["magic"], exclusiveGroup: null, stackRule: "add", weight: 1, goldValue: 1, rollMin: 0, rollMax: 100, operation: { kind: "addPowerBps" }, tags: [] }) },
    });
    const stoneResult = screen.stoneDetails("stone_1");
    expect(stoneResult.ok && stoneResult.value.affixes[0]).toMatchObject({ stackRule: "add", targetRangeKey: "skill_affix.target.all_skills" });
    expect((await screen.setFocus("char_wanderer")).ok).toBe(true);
    current.expedition = { expeditionId: "exp", expeditionSeed: 1, mode: "exploration", abyssEchoId: null, floorId: "floor_01", mapId: "map_floor_01", playerPosition: { x: 0, y: 0 }, safePosition: { x: 0, y: 0 }, defeatedEncounterObjectIds: [], openedChestObjectIds: [], encounterProtectionStepsRemaining: 0, focusedEliteStoneConsumed: false, startedAt: timestamp };
    expect((await screen.setFocus("char_wanderer")).ok).toBe(false);
  });

  it("调谐铭石拒绝溢出、绑定角色不匹配和已被其他角色装备，失败不保存", async () => {
    const current = save();
    const currentStone: SkillStoneInstance = { instanceId: "stone_current", attunedCharacterId: "char_wanderer", itemLevel: 1, quality: "magic", affixes: [], abyssAffix: null, locked: false, acquiredAt: timestamp, sourceTransactionId: "tx_current", reforgeLockedIndex: null, reforgeCount: 0 };
    const overflowStone: SkillStoneInstance = { ...structuredClone(currentStone), instanceId: "stone_overflow" };
    const mismatchStone: SkillStoneInstance = { ...structuredClone(currentStone), instanceId: "stone_mismatch", attunedCharacterId: "char_other" };
    const otherEquippedStone: SkillStoneInstance = { ...structuredClone(currentStone), instanceId: "stone_other_equipped" };
    current.inventory.skillStones.push(currentStone, mismatchStone, otherEquippedStone);
    current.inventory.overflowSkillStones.push(overflowStone);
    const other = structuredClone(current.characters.char_wanderer);
    other.characterId = "char_other";
    other.skillStoneInstanceId = "stone_other_equipped";
    current.characters.char_other = other;
    const persist = vi.fn(async (_revision: number, next: GameSaveV1) => success({ ...structuredClone(next), revision: next.revision + 1 }));
    const screen = new SkillScreen({ currentSave: () => current, persist });

    expect((await screen.attuneStone("stone_overflow")).ok).toBe(false);
    expect((await screen.attuneStone("stone_mismatch")).ok).toBe(false);
    expect((await screen.attuneStone("stone_other_equipped")).ok).toBe(false);
    expect(persist).not.toHaveBeenCalled();

    expect((await screen.attuneStone("stone_current")).ok).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("铭石重铸通过显式 generator 原子扣料换装，失败保留预览且连点复用提交", async () => {
    const current = save();
    const stone = reforgeStone("stone_reforge");
    current.inventory.skillStones.push(stone);
    current.inventory.stackables.item_inscription_dust = 12;
    const preview = skillStonePreview(stone.instanceId);
    const replacement = { ...structuredClone(stone), affixes: [structuredClone(preview.candidates[1]!.roll), ...stone.affixes.slice(1)], reforgeLockedIndex: 0, reforgeCount: 1 };
    const generator = {
      openReforgePreview: vi.fn(() => success(preview)),
      confirmReforge: vi.fn((_instance: SkillStoneInstance, value: ReforgePreviewV1, options: { expectedLockedIndex: number; expectedReforgeCount: number; candidateIndex: 0 | 1 | 2 }) => {
        expect(value).toEqual(preview);
        expect(options).toEqual({ expectedLockedIndex: 0, expectedReforgeCount: 0, candidateIndex: 1 });
        return success(replacement);
      }),
    };
    let release!: (value: ReturnType<typeof failure> | ReturnType<typeof success<GameSaveV1>>) => void;
    const pending = new Promise<ReturnType<typeof failure> | ReturnType<typeof success<GameSaveV1>>>((resolve) => { release = resolve; });
    const persist = vi.fn()
      .mockImplementationOnce(() => pending)
      .mockImplementationOnce(async (_revision: number, next: GameSaveV1) => success({ ...structuredClone(next), revision: next.revision + 1 }));
    const screen = new SkillScreen({
      currentSave: () => current,
      skillStoneGenerator: generator as never,
      persist,
      onStoreReplaced: (next) => Object.assign(current, structuredClone(next)),
    });
    expect(screen.previewReforge(stone.instanceId, 0)).toEqual(success(preview));
    expect(screen.requestReforge(1)).toEqual(success(true));
    const first = screen.confirmReforge();
    const second = screen.confirmReforge();
    expect(second).toBe(first);
    expect(generator.confirmReforge).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    const submitted = persist.mock.calls[0]![1] as GameSaveV1;
    expect(submitted.inventory.stackables.item_inscription_dust).toBe(5);
    expect(submitted.inventory.skillStones.find((value) => value.instanceId === stone.instanceId)).toEqual(replacement);

    release(failure({ code: "SAVE_FAILED", details: { operation: "save" } }));
    expect((await first).ok).toBe(false);
    expect(screen.state.reforgePreview).toEqual(preview);
    expect(screen.state.reforgeConfirming).toBe(1);
    expect(current.inventory.stackables.item_inscription_dust).toBe(12);

    const retry = screen.confirmReforge();
    expect((await retry).ok).toBe(true);
    expect(generator.confirmReforge).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(current.inventory.stackables.item_inscription_dust).toBe(5);
    expect(current.inventory.skillStones.find((value) => value.instanceId === stone.instanceId)).toEqual(replacement);
    expect(screen.state.reforgePreview).toBeNull();
    expect(screen.state.reforgeConfirming).toBeNull();
  });

  it("铭石重铸预览拒绝深渊槽、锁定、已装备和非当前调谐角色", () => {
    const current = save();
    current.inventory.skillStones.push(
      reforgeStone("stone_locked", { locked: true }),
      reforgeStone("stone_equipped"),
      reforgeStone("stone_wrong_owner", { attunedCharacterId: "char_other" }),
      reforgeStone("stone_abyss", { abyssAffix: { skillAffixId: "sa_abyss_guard", roll: 100, reforged: false } }),
    );
    current.characters.char_wanderer.skillStoneInstanceId = "stone_equipped";
    const generator = { openReforgePreview: vi.fn(() => success(skillStonePreview("unused"))) };
    const screen = new SkillScreen({ currentSave: () => current, skillStoneGenerator: generator as never, persist: vi.fn() });
    expect(screen.previewReforge("stone_locked", 0).ok).toBe(false);
    expect(screen.previewReforge("stone_equipped", 0).ok).toBe(false);
    expect(screen.previewReforge("stone_wrong_owner", 0).ok).toBe(false);
    expect(screen.previewReforge("stone_abyss", 2).ok).toBe(false);
    expect(generator.openReforgePreview).not.toHaveBeenCalled();
  });
});
