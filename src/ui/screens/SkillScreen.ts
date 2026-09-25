import type { CharacterDefinition, CharacterId, CharacterProgressV1, GameSaveV1, ReforgePreviewV1, SkillAffixDefinition, SkillDefinition, SkillStoneInstance } from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../../domain/common/DomainResult";
import type { SkillContentSource, SkillService } from "../../domain/skill/SkillService";
import type { ConfirmSkillStoneReforgeOptions, SkillStoneReforgeOptions, SkillStoneGenerator } from "../../domain/skill/SkillStoneGenerator";
import { domainErrorView, MANAGEMENT_UI_METRICS, type ScreenErrorView, type ScreenLayoutView, type ScreenStatus } from "./GameMenu";

export interface SkillStoneContentSource extends SkillContentSource {
  getSkillAffix(id: string): DomainResult<Readonly<SkillAffixDefinition>>;
}

type SkillServiceLike = Pick<SkillService, "upgrade" | "equipSkill" | "reset"> & Partial<Pick<SkillService, "upgradeSkill" | "equipActiveSkill" | "resetSkills" | "unequipSkill" | "unequipActiveSkill">>;

export interface SkillStoneGeneratorLike {
  readonly openReforgePreview: SkillStoneGenerator["openReforgePreview"];
  readonly confirmReforge: SkillStoneGenerator["confirmReforge"];
}

export interface SkillScreenOptions {
  readonly currentSave: () => Readonly<GameSaveV1>;
  readonly content?: SkillContentSource;
  readonly skillContent?: SkillStoneContentSource;
  readonly skillService?: SkillServiceLike;
  readonly skillStoneGenerator?: SkillStoneGeneratorLike;
  readonly persist?: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
  readonly onStoreReplaced?: (save: Readonly<GameSaveV1>) => void;
}

export interface SkillStoneAffixView {
  readonly skillAffixId: string;
  readonly stackRule: SkillAffixDefinition["stackRule"];
  readonly targetRangeKey: string;
  readonly targetValue: string | null;
  readonly exclusiveGroup: string | null;
  readonly conflictWith: readonly string[];
}

export interface SkillStoneView {
  readonly instanceId: string;
  readonly attunedCharacterId: CharacterId;
  readonly affixes: readonly SkillStoneAffixView[];
}

export interface SkillDisabledReason {
  readonly skillId: string;
  readonly key: string;
}

export interface SkillScreenState {
  readonly status: ScreenStatus;
  readonly error: ScreenErrorView | null;
  readonly layout: ScreenLayoutView;
  readonly characterId: CharacterId;
  readonly skills: readonly SkillDefinition[];
  readonly skillLevels: Readonly<Record<string, number>>;
  readonly slots: readonly [string | null, string | null];
  readonly skillPoints: number;
  readonly disabledReasons: readonly SkillDisabledReason[];
  readonly stone: SkillStoneView | null;
  readonly focusCharacterId: CharacterId | null;
  readonly reforgePreview: ReforgePreviewV1 | null;
  readonly reforgeConfirming: number | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function targetRange(definition: SkillAffixDefinition): { key: string; value: string | null } {
  if (definition.target.kind === "allSkills") return { key: "skill_affix.target.all_skills", value: null };
  if (definition.target.kind === "family") return { key: "skill_affix.target.family", value: definition.target.familyId };
  return { key: "skill_affix.target.skill", value: definition.target.skillId };
}

/** 技能页只对领域服务的 preview/结果做投影，铭石字段严格来自内容定义。 */
export class SkillScreen {
  private readonly options: SkillScreenOptions;
  private characterIdValue: CharacterId;
  private statusValue: ScreenStatus = "success";
  private errorValue: ScreenErrorView | null = null;
  private resetConfirmation = false;
  private commitInFlight: Promise<DomainResult<GameSaveV1>> | null = null;
  private reforgePreviewValue: ReforgePreviewV1 | null = null;
  private reforgeConfirmingValue: 0 | 1 | 2 | null = null;
  private reforgeRequestValue: DomainResult<true> | null = null;

  public constructor(options: SkillScreenOptions) {
    this.options = options;
    const firstPartyCharacter = options.currentSave().party.slots.find((id): id is CharacterId => id !== null);
    this.characterIdValue = firstPartyCharacter ?? (Object.keys(options.currentSave().characters)[0] ?? "");
  }

  public get state(): SkillScreenState {
    const save = this.currentSave();
    const progress = save.characters[this.characterIdValue];
    const character = this.resolveCharacter(this.characterIdValue);
    const skills = character?.activeSkillIds.map((id) => this.resolveSkill(id)).filter((value): value is SkillDefinition => value !== null) ?? [];
    const skillLevels = progress?.skillLevels ?? {};
    const disabledReasons: SkillDisabledReason[] = [];
    for (const skill of skills) {
      if ((skillLevels[skill.id] ?? 0) >= skill.maxLevel) disabledReasons.push({ skillId: skill.id, key: "skill.level_max" });
      else if ((progress?.skillPoints ?? 0) < 1) disabledReasons.push({ skillId: skill.id, key: "skill.insufficient_points" });
      else if ((progress?.level ?? 0) < skill.unlockLevel) disabledReasons.push({ skillId: skill.id, key: "skill.locked_by_level" });
    }
    return Object.freeze({
      status: this.statusValue,
      error: this.errorValue,
      layout: MANAGEMENT_UI_METRICS,
      characterId: this.characterIdValue,
      skills: Object.freeze(clone(skills)),
      skillLevels: Object.freeze(clone(skillLevels)),
      slots: Object.freeze([...(progress?.equippedActiveSkillIds ?? [null, null])]) as [string | null, string | null],
      skillPoints: progress?.skillPoints ?? 0,
      disabledReasons: Object.freeze(disabledReasons),
      stone: this.projectStone(progress?.skillStoneInstanceId ?? null),
      focusCharacterId: save.skillStoneFocusCharacterId,
      reforgePreview: this.reforgePreviewValue ? Object.freeze(clone(this.reforgePreviewValue)) : null,
      reforgeConfirming: this.reforgeConfirmingValue,
    });
  }

  public showLoading(): void {
    this.statusValue = "loading";
    this.errorValue = null;
  }

  public showEmpty(): void {
    this.statusValue = "empty";
    this.errorValue = null;
  }

  public showDisabled(reasonKey: string): void {
    this.statusValue = "disabled";
    this.errorValue = Object.freeze({ code: reasonKey, details: null });
  }

  public selectCharacter(characterId: CharacterId): DomainResult<true> {
    const progress = this.currentSave().characters[characterId];
    if (!progress) return this.fail(invalid(`characters.${characterId}`, "missing_progress"));
    if (progress.recruited !== true) return this.fail(invalid(`characters.${characterId}`, "not_recruited"));
    this.characterIdValue = characterId;
    this.clearError();
    return success(true);
  }

  public stoneDetails(instanceId: string): DomainResult<SkillStoneView> {
    const save = this.currentSave();
    const stone = [...save.inventory.skillStones, ...save.inventory.overflowSkillStones].find((value) => value.instanceId === instanceId);
    if (!stone) return this.fail(failure(createDomainError("ITEM_NOT_OWNED", { instanceId, itemId: null })));
    if (!this.options.skillContent) return this.fail(invalid("skillContent", "getter_required"));
    const usedGroups = new Map<string, string>();
    const affixes: SkillStoneAffixView[] = [];
    for (const roll of [...stone.affixes, ...(stone.abyssAffix ? [stone.abyssAffix] : [])]) {
      const definition = this.options.skillContent.getSkillAffix(roll.skillAffixId);
      if (!definition.ok) return this.fail(definition);
      const range = targetRange(definition.value);
      const conflictWith: string[] = [];
      if (definition.value.exclusiveGroup !== null) {
        const prior = usedGroups.get(definition.value.exclusiveGroup);
        if (prior) conflictWith.push(prior);
        else usedGroups.set(definition.value.exclusiveGroup, definition.value.id);
      }
      affixes.push({ skillAffixId: definition.value.id, stackRule: definition.value.stackRule, targetRangeKey: range.key, targetValue: range.value, exclusiveGroup: definition.value.exclusiveGroup, conflictWith });
    }
    return success(Object.freeze({ instanceId: stone.instanceId, attunedCharacterId: stone.attunedCharacterId, affixes: Object.freeze(affixes) }));
  }

  public async upgrade(skillId: string): Promise<DomainResult<GameSaveV1>> {
    const service = this.options.skillService;
    const progress = this.currentSave().characters[this.characterIdValue];
    if (!service || !progress) return this.fail(failure(createDomainError("INVALID_CONTENT", { path: "skillService", issueKey: "required" })));
    const result = service.upgrade
      ? service.upgrade(progress, skillId, { inTown: this.inTown() })
      : service.upgradeSkill!(progress, skillId, { inTown: this.inTown() });
    if (!result.ok) return this.fail(result);
    return this.commitProgress(result.value);
  }

  public async equip(skillId: string, slot: 0 | 1): Promise<DomainResult<GameSaveV1>> {
    const service = this.options.skillService;
    const progress = this.currentSave().characters[this.characterIdValue];
    if (!service || !progress) return this.fail(failure(createDomainError("INVALID_CONTENT", { path: "skillService", issueKey: "required" })));
    const result = service.equipSkill
      ? service.equipSkill(progress, skillId, slot, { inTown: this.inTown() })
      : service.equipActiveSkill!(progress, skillId, slot, { inTown: this.inTown() });
    if (!result.ok) return this.fail(result);
    return this.commitProgress(result.value);
  }

  public async unequip(slot: 0 | 1): Promise<DomainResult<GameSaveV1>> {
    const service = this.options.skillService;
    const progress = this.currentSave().characters[this.characterIdValue];
    if (!service || !progress) return this.fail(failure(createDomainError("INVALID_CONTENT", { path: "skillService", issueKey: "required" })));
    if (!service.unequipSkill && !service.unequipActiveSkill) return this.fail(failure(createDomainError("INVALID_CONTENT", { path: "skillService.unequip", issueKey: "required" })));
    const result = service.unequipSkill
      ? service.unequipSkill(progress, slot, { inTown: this.inTown() })
      : service.unequipActiveSkill!(progress, slot, { inTown: this.inTown() });
    if (!result.ok) return this.fail(result);
    return this.commitProgress(result.value);
  }

  public requestReset(): void {
    this.resetConfirmation = true;
  }

  public cancelReset(): void {
    this.resetConfirmation = false;
  }

  public async reset(): Promise<DomainResult<GameSaveV1>> {
    if (!this.resetConfirmation) return this.fail(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
    this.resetConfirmation = false;
    const service = this.options.skillService;
    const progress = this.currentSave().characters[this.characterIdValue];
    if (!service || !progress) return this.fail(failure(createDomainError("INVALID_CONTENT", { path: "skillService", issueKey: "required" })));
    const result = service.reset
      ? service.reset(progress, { inTown: this.inTown() })
      : service.resetSkills!(progress, { inTown: this.inTown() });
    if (!result.ok) return this.fail(result);
    return this.commitProgress(result.value);
  }

  public async setFocus(characterId: CharacterId): Promise<DomainResult<GameSaveV1>> {
    const save = this.currentSave();
    if (!this.inTown()) return this.fail(failure(createDomainError("NOT_IN_TOWN", null)));
    const progress = save.characters[characterId];
    if (!progress || progress.recruited !== true) return this.fail(failure(createDomainError("INVALID_PARTY", { reason: "NOT_RECRUITED", characterId })));
    const next = clone(save) as GameSaveV1;
    next.skillStoneFocusCharacterId = characterId;
    return this.commitSave(next);
  }

  public async attuneStone(instanceId: string): Promise<DomainResult<GameSaveV1>> {
    const save = this.currentSave();
    if (!this.inTown()) return this.fail(failure(createDomainError("NOT_IN_TOWN", null)));
    const regularStone = save.inventory.skillStones.find((value) => value.instanceId === instanceId);
    const overflowStone = save.inventory.overflowSkillStones.find((value) => value.instanceId === instanceId);
    const stone = regularStone ?? overflowStone;
    if (!stone) return this.fail(failure(createDomainError("ITEM_NOT_OWNED", { instanceId, itemId: null })));
    if (overflowStone) return this.fail(invalid(`inventory.overflowSkillStones.${instanceId}`, "overflow_skill_stone"));
    if (stone.attunedCharacterId !== this.characterIdValue) return this.fail(invalid(`inventory.skillStones.${instanceId}.attunedCharacterId`, "attuned_character_mismatch"));
    const equippedByOtherCharacter = Object.values(save.characters).some((value) => value.characterId !== this.characterIdValue && value.skillStoneInstanceId === instanceId);
    if (equippedByOtherCharacter) return this.fail(failure(createDomainError("ITEM_EQUIPPED", { instanceId })));
    const progress = save.characters[this.characterIdValue];
    if (!progress) return this.fail(invalid(`characters.${this.characterIdValue}`, "missing_progress"));
    const next = clone(save);
    next.characters[this.characterIdValue].skillStoneInstanceId = instanceId;
    return this.commitSave(next);
  }

  /** 铭石普通槽预览只调用纯 generator，不修改存档或消耗材料。 */
  public previewReforge(instanceId: string, requestedIndex: number): DomainResult<ReforgePreviewV1> {
    if (!this.inTown()) return this.fail(failure(createDomainError("NOT_IN_TOWN", null)));
    if (!this.options.skillStoneGenerator) return this.fail(invalid("skillStoneGenerator", "required"));
    const save = this.currentSave();
    const stone = this.resolveReforgeStone(save, instanceId, requestedIndex);
    if (!stone.ok) return this.fail(stone);
    let result: DomainResult<ReforgePreviewV1>;
    try {
      const options: SkillStoneReforgeOptions = {
        contentVersion: save.contentVersion,
        requestedIndex,
        equipped: false,
      };
      result = this.options.skillStoneGenerator.openReforgePreview(clone(stone.value), options);
    } catch {
      return this.fail(invalid("skillStoneGenerator.openReforgePreview", "failed"));
    }
    if (!result.ok) return this.fail(result);
    if (result.value.itemKind !== "skillStone" || result.value.instanceId !== instanceId || result.value.costItemId !== "item_inscription_dust") {
      return this.fail(invalid("skillStoneGenerator.openReforgePreview", "preview_contract"));
    }
    this.reforgePreviewValue = clone(result.value);
    this.reforgeConfirmingValue = null;
    this.reforgeRequestValue = null;
    this.clearError();
    return success(clone(result.value));
  }

  /** 第一次点击仅锁定候选，不触发 generator confirm 或扣料。 */
  public requestReforge(candidateIndex: 0 | 1 | 2): DomainResult<true> {
    const preview = this.reforgePreviewValue;
    if (!preview) return this.fail(failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: 0, actualReforgeCount: 0 })));
    const candidate = preview.candidates.find((value) => value.candidateIndex === candidateIndex);
    if (!candidate || candidate.kind !== "skillStone") return this.fail(failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: preview.reforgeCount, actualReforgeCount: preview.reforgeCount })));
    this.reforgeConfirmingValue = candidateIndex;
    this.reforgeRequestValue ??= success(true);
    return this.reforgeRequestValue;
  }

  /** 第二次点击才确认候选；铭石与材料在同一保存快照中提交。 */
  public confirmReforge(): Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1> {
    const preview = this.reforgePreviewValue;
    const candidateIndex = this.reforgeConfirmingValue;
    if (!preview || candidateIndex === null) return this.fail(failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: preview?.reforgeCount ?? 0, actualReforgeCount: preview?.reforgeCount ?? 0 })));
    if (!this.inTown()) return this.fail(failure(createDomainError("NOT_IN_TOWN", null)));
    if (!this.options.skillStoneGenerator) return this.fail(invalid("skillStoneGenerator", "required"));
    if (this.commitInFlight !== null) return this.commitInFlight;
    const save = clone(this.currentSave());
    const stone = this.resolveReforgeStone(save, preview.instanceId, preview.lockedIndex);
    if (!stone.ok) return this.fail(stone);
    if (stone.value.reforgeCount !== preview.reforgeCount) return this.fail(failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: preview.reforgeCount, actualReforgeCount: stone.value.reforgeCount })));
    if (stone.value.reforgeLockedIndex !== null && stone.value.reforgeLockedIndex !== preview.lockedIndex) return this.fail(failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: preview.reforgeCount, actualReforgeCount: stone.value.reforgeCount })));
    const candidate = preview.candidates.find((value) => value.candidateIndex === candidateIndex);
    if (!candidate || candidate.kind !== "skillStone") return this.fail(failure(createDomainError("REFORGE_PREVIEW_STALE", { expectedReforgeCount: preview.reforgeCount, actualReforgeCount: preview.reforgeCount })));
    if (!Number.isSafeInteger(preview.costQuantity) || preview.costQuantity <= 0) return this.fail(invalid("reforgePreview.costQuantity", "positive_integer"));
    const owned = save.inventory.stackables[preview.costItemId] ?? 0;
    if (owned < preview.costQuantity) return this.fail(failure(createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId: preview.costItemId })));
    let replacement: SkillStoneInstance;
    try {
      const options: ConfirmSkillStoneReforgeOptions = {
        expectedLockedIndex: preview.lockedIndex,
        expectedReforgeCount: preview.reforgeCount,
        candidateIndex,
      };
      const result = this.options.skillStoneGenerator.confirmReforge(clone(stone.value), clone(preview), options);
      if (!result.ok) return this.fail(result);
      replacement = result.value;
    } catch {
      return this.fail(invalid("skillStoneGenerator.confirmReforge", "failed"));
    }
    const stoneIndex = save.inventory.skillStones.findIndex((value) => value.instanceId === preview.instanceId);
    if (stoneIndex < 0) return this.fail(failure(createDomainError("ITEM_NOT_OWNED", { instanceId: preview.instanceId, itemId: null })));
    save.inventory.skillStones[stoneIndex] = clone(replacement);
    save.inventory.stackables[preview.costItemId] = owned - preview.costQuantity;
    return this.commitSave(save, () => {
      this.reforgePreviewValue = null;
      this.reforgeConfirmingValue = null;
      this.reforgeRequestValue = null;
    });
  }

  private resolveCharacter(characterId: string): Readonly<CharacterDefinition> | null {
    if (!this.options.content) return null;
    const result = this.options.content.getCharacter(characterId);
    return result.ok ? result.value : null;
  }

  private projectStone(instanceId: string | null): SkillStoneView | null {
    if (instanceId === null) return null;
    const result = this.stoneDetails(instanceId);
    return result.ok ? result.value : null;
  }

  private resolveSkill(skillId: string): Readonly<SkillDefinition> | null {
    if (!this.options.content) return null;
    const result = this.options.content.getSkill(skillId);
    return result.ok ? result.value : null;
  }

  private inTown(): boolean {
    const save = this.currentSave();
    return save.expedition === null && save.battle === null;
  }

  private async commitProgress(progress: CharacterProgressV1): Promise<DomainResult<GameSaveV1>> {
    const save = clone(this.currentSave());
    save.characters[this.characterIdValue] = clone(progress);
    return this.commitSave(save);
  }

  private commitSave(save: GameSaveV1, onSuccess: () => void = () => undefined): Promise<DomainResult<GameSaveV1>> {
    if (!this.options.persist) return Promise.resolve(this.fail(failure(createDomainError("SAVE_FAILED", { operation: "save" }))));
    if (this.commitInFlight !== null) return this.commitInFlight;
    this.statusValue = "loading";
    this.errorValue = null;
    const operation = this.persist(save).then((result) => {
      if (result.ok) onSuccess();
      return result;
    });
    this.commitInFlight = operation;
    void operation.then(() => { if (this.commitInFlight === operation) this.commitInFlight = null; });
    return operation;
  }

  private async persist(save: GameSaveV1): Promise<DomainResult<GameSaveV1>> {
    try {
      const result = await this.options.persist!(save.revision, save);
      if (!result.ok) return this.fail(result);
      this.statusValue = "success";
      this.errorValue = null;
      this.options.onStoreReplaced?.(result.value);
      return result;
    } catch {
      return this.fail(failure(createDomainError("SAVE_FAILED", { operation: "save" })));
    }
  }

  private clearError(): void {
    this.statusValue = "success";
    this.errorValue = null;
  }

  private currentSave(): Readonly<GameSaveV1> {
    return this.options.currentSave();
  }

  private resolveReforgeStone(save: Readonly<GameSaveV1>, instanceId: string, requestedIndex: number): DomainResult<SkillStoneInstance> {
    const progress = save.characters[this.characterIdValue];
    if (!progress) return invalid(`characters.${this.characterIdValue}`, "missing_progress");
    if (progress.recruited !== true) return invalid(`characters.${this.characterIdValue}`, "not_recruited");
    const stone = save.inventory.skillStones.find((value) => value.instanceId === instanceId);
    if (!stone) {
      if (save.inventory.overflowSkillStones.some((value) => value.instanceId === instanceId)) return this.fail(invalid(`inventory.overflowSkillStones.${instanceId}`, "overflow_skill_stone"));
      return failure(createDomainError("ITEM_NOT_OWNED", { instanceId, itemId: null }));
    }
    if (stone.attunedCharacterId !== this.characterIdValue) return invalid(`inventory.skillStones.${instanceId}.attunedCharacterId`, "attuned_character_mismatch");
    if (stone.locked) return failure(createDomainError("AFFIX_NOT_REFORGEABLE", { instanceId, reason: "LOCKED_ITEM" }));
    if (Object.values(save.characters).some((value) => value.skillStoneInstanceId === instanceId)) return failure(createDomainError("AFFIX_NOT_REFORGEABLE", { instanceId, reason: "EQUIPPED_ITEM" }));
    if (!Number.isSafeInteger(requestedIndex) || requestedIndex < 0 || requestedIndex >= stone.affixes.length) return failure(createDomainError("AFFIX_NOT_REFORGEABLE", { instanceId, reason: "ABYSS_SLOT" }));
    if (stone.reforgeLockedIndex !== null && stone.reforgeLockedIndex !== requestedIndex) return failure(createDomainError("AFFIX_NOT_REFORGEABLE", { instanceId, reason: "WRONG_LOCKED_INDEX" }));
    return success(stone);
  }

  private fail<T>(result: DomainResult<T>): DomainResult<T> {
    if (!result.ok) { this.statusValue = "error"; this.errorValue = domainErrorView(result.error); }
    return result;
  }
}
