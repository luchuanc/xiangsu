/**
 * 固定招募领域服务。
 *
 * 招募条件由 RecruitmentDefinition 严格驱动；角色初始化委托给注入的
 * ProgressionService。金币、角色记录和其它存档字段只在一次显式事务回调
 * 中提交，领域层不自行递增 revision，也不自动修改 PartyState。
 */
import type {
  CharacterId,
  CharacterProgressV1,
  GameSaveV1,
  RecruitmentCondition,
  RecruitmentDefinition,
  RecruitmentId,
} from "../../content/contracts";
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import type { ProgressionService } from "../character/ProgressionService";

export interface RecruitmentContentSource {
  getRecruitment(id: RecruitmentId): DomainResult<Readonly<RecruitmentDefinition>>;
}

export interface RecruitmentCommitOptions {
  readonly expectedRevision: number;
  readonly save: (expectedRevision: number, nextSave: GameSaveV1) => Promise<DomainResult<GameSaveV1>> | DomainResult<GameSaveV1>;
}

export interface RecruitmentEvaluation {
  readonly recruitmentId: RecruitmentId;
  readonly characterId: CharacterId;
  readonly condition: RecruitmentCondition;
  readonly goldCost: number;
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recruitmentLocked(recruitmentId: RecruitmentId): DomainResult<never> {
  return failure(createDomainError("RECRUITMENT_LOCKED", { recruitmentId }));
}

function validateSaveProjection(save: GameSaveV1): DomainResult<true> {
  if (!isRecord(save)) return invalid("save", "not_object");
  if (!Number.isSafeInteger(save.gold) || save.gold < 0) return invalid("save.gold", "gold_range");
  if (!isRecord(save.characters)) return invalid("save.characters", "not_object");
  if (!isRecord(save.world)) return invalid("save.world", "not_object");
  if (!Number.isSafeInteger(save.world.highestUnlockedFloor) || save.world.highestUnlockedFloor < 1 || save.world.highestUnlockedFloor > 10) {
    return invalid("save.world.highestUnlockedFloor", "floor_range");
  }
  if (!Array.isArray(save.world.completedQuestIds) || save.world.completedQuestIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return invalid("save.world.completedQuestIds", "id_array");
  }
  if (!Array.isArray(save.world.clearedBossEncounterIds) || save.world.clearedBossEncounterIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return invalid("save.world.clearedBossEncounterIds", "id_array");
  }
  return success(true);
}

function cloneSave(save: GameSaveV1): GameSaveV1 {
  return structuredClone(save);
}

function validateCondition(
  condition: RecruitmentCondition,
  recruitmentId: RecruitmentId,
): DomainResult<true> {
  if (!condition || typeof condition !== "object") return invalid(`recruitments.${recruitmentId}.condition`, "not_object");
  if (condition.kind === "questCompleted") {
    if (typeof condition.questId !== "string" || condition.questId.length === 0) return invalid(`recruitments.${recruitmentId}.condition.questId`, "empty_id");
    return success(true);
  }
  if (condition.kind === "gold") {
    if (!Number.isSafeInteger(condition.goldCost) || condition.goldCost < 0) return invalid(`recruitments.${recruitmentId}.condition.goldCost`, "gold_cost");
    if (!Number.isSafeInteger(condition.minimumClearedFloor) || condition.minimumClearedFloor < 0 || condition.minimumClearedFloor > 10) return invalid(`recruitments.${recruitmentId}.condition.minimumClearedFloor`, "floor_range");
    return success(true);
  }
  if (condition.kind === "firstClear") {
    if (!Number.isSafeInteger(condition.floorNumber) || condition.floorNumber < 1 || condition.floorNumber > 10) return invalid(`recruitments.${recruitmentId}.condition.floorNumber`, "floor_range");
    return success(true);
  }
  return invalid(`recruitments.${recruitmentId}.condition.kind`, "unknown_condition");
}

function resolveRecruitment(
  content: RecruitmentContentSource,
  recruitmentId: RecruitmentId,
): DomainResult<Readonly<RecruitmentDefinition>> {
  if (!content || typeof content.getRecruitment !== "function") return invalid("content.getRecruitment", "getter_required");
  if (typeof recruitmentId !== "string" || recruitmentId.length === 0) return invalid("recruitmentId", "empty_id");
  try {
    const result = content.getRecruitment(recruitmentId);
    if (!result.ok) return result;
    if (result.value.id !== recruitmentId) return invalid(`recruitments.${recruitmentId}`, "id_mismatch");
    return result;
  } catch {
    return invalid(`recruitments.${recruitmentId}`, "getter_failed");
  }
}

function progressFor(
  save: GameSaveV1,
  characterId: CharacterId,
): CharacterProgressV1 | undefined {
  if (!Object.prototype.hasOwnProperty.call(save.characters, characterId)) return undefined;
  return save.characters[characterId];
}

export interface RecruitmentServiceOptions {
  readonly content: RecruitmentContentSource;
  readonly progression: Pick<ProgressionService, "getCharacter" | "createCaughtUpRecruit">;
  readonly protagonistCharacterId: CharacterId;
}

export class RecruitmentService {
  private readonly content: RecruitmentContentSource;
  private readonly progression: RecruitmentServiceOptions["progression"];
  private readonly protagonistCharacterId: CharacterId;

  public constructor(options: RecruitmentServiceOptions) {
    this.content = options.content;
    this.progression = options.progression;
    this.protagonistCharacterId = options.protagonistCharacterId;
  }

  /**
   * 评估一个招募项。未满足条件、金币不足和重复招募均返回明确领域错误，
   * 不生成候选存档。
   */
  public evaluate(recruitmentId: RecruitmentId, save: GameSaveV1): DomainResult<RecruitmentEvaluation> {
    const saveResult = validateSaveProjection(save);
    if (!saveResult.ok) return saveResult;
    const recruitmentResult = resolveRecruitment(this.content, recruitmentId);
    if (!recruitmentResult.ok) return recruitmentResult;
    const recruitment = recruitmentResult.value;
    const conditionResult = validateCondition(recruitment.condition, recruitmentId);
    if (!conditionResult.ok) return conditionResult;

    const target = progressFor(save, recruitment.characterId);
    if (!target) return invalid(`characters.${recruitment.characterId}`, "missing_progress");
    if (target.characterId !== recruitment.characterId) return invalid(`characters.${recruitment.characterId}.characterId`, "character_id_mismatch");
    if (typeof target.recruited !== "boolean") return invalid(`characters.${recruitment.characterId}.recruited`, "boolean_required");
    if (target.recruited) return failure(createDomainError("CHARACTER_ALREADY_RECRUITED", { characterId: recruitment.characterId }));
    let knownCharacter: ReturnType<RecruitmentServiceOptions["progression"]["getCharacter"]>;
    try {
      knownCharacter = this.progression.getCharacter(recruitment.characterId);
    } catch {
      return invalid(`characters.${recruitment.characterId}`, "getter_failed");
    }
    if (!knownCharacter.ok) return knownCharacter;
    if (knownCharacter.value.id !== recruitment.characterId) return invalid(`characters.${recruitment.characterId}`, "character_id_mismatch");

    let goldCost = 0;
    const condition = recruitment.condition;
    if (condition.kind === "questCompleted") {
      if (!save.world.completedQuestIds.includes(condition.questId)) return recruitmentLocked(recruitmentId);
    } else if (condition.kind === "gold") {
      goldCost = condition.goldCost;
      if (save.world.highestUnlockedFloor < condition.minimumClearedFloor) return recruitmentLocked(recruitmentId);
      if (save.gold < condition.goldCost) return failure(createDomainError("INSUFFICIENT_GOLD", { required: condition.goldCost, owned: save.gold }));
    } else if (condition.kind === "firstClear") {
      // 首通层数由存档的连续 Boss 前缀表示；解锁下一层即表示目标层已首通。
      const cleared = condition.floorNumber < 10
        ? save.world.highestUnlockedFloor > condition.floorNumber
        : save.world.highestUnlockedFloor === 10 && save.world.clearedBossEncounterIds.length >= 10;
      if (!cleared) return recruitmentLocked(recruitmentId);
    }

    return success({
      recruitmentId,
      characterId: recruitment.characterId,
      condition: structuredClone(condition),
      goldCost,
    });
  }

  /** 在一个显式存档事务中提交金币扣除和追赶角色，不自动改队伍。 */
  public async commit(
    recruitmentId: RecruitmentId,
    save: GameSaveV1,
    options: RecruitmentCommitOptions,
  ): Promise<DomainResult<GameSaveV1>> {
    if (!options || typeof options !== "object") return invalid("options", "not_object");
    if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) return invalid("options.expectedRevision", "revision");
    if (typeof options.save !== "function") return invalid("options.save", "transaction_required");
    const evaluation = this.evaluate(recruitmentId, save);
    if (!evaluation.ok) return evaluation;

    const protagonist = progressFor(save, this.protagonistCharacterId);
    if (!protagonist) return invalid(`characters.${this.protagonistCharacterId}`, "missing_protagonist_progress");
    if (protagonist.characterId !== this.protagonistCharacterId) return invalid(`characters.${this.protagonistCharacterId}.characterId`, "character_id_mismatch");
    if (protagonist.recruited !== true) return invalid(`characters.${this.protagonistCharacterId}.recruited`, "protagonist_not_recruited");
    if (!Number.isSafeInteger(protagonist.level) || protagonist.level < 1 || protagonist.level > 50) return invalid(`characters.${this.protagonistCharacterId}.level`, "level_range");

    let caughtUp: DomainResult<CharacterProgressV1>;
    try {
      caughtUp = this.progression.createCaughtUpRecruit(evaluation.value.characterId, protagonist.level);
    } catch {
      return invalid(`characters.${evaluation.value.characterId}`, "caught_up_recruit_failed");
    }
    if (!caughtUp.ok) return caughtUp;
    if (caughtUp.value.characterId !== evaluation.value.characterId) return invalid(`characters.${evaluation.value.characterId}`, "character_id_mismatch");

    let nextSave: GameSaveV1;
    try {
      nextSave = cloneSave(save);
    } catch {
      return invalid("save", "clone_failed");
    }
    nextSave.characters[evaluation.value.characterId] = caughtUp.value;
    nextSave.gold -= evaluation.value.goldCost;
    try {
      return await options.save(options.expectedRevision, nextSave);
    } catch {
      return failure(createDomainError("SAVE_FAILED", { operation: "save" }));
    }
  }
}

/** 无状态入口，便于调用方把服务依赖保持在场景/应用层。 */
export function evaluateRecruitment(
  options: RecruitmentServiceOptions,
  recruitmentId: RecruitmentId,
  save: GameSaveV1,
): DomainResult<RecruitmentEvaluation> {
  return new RecruitmentService(options).evaluate(recruitmentId, save);
}
