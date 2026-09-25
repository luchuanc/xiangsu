/**
 * 战斗命令的应用层事务边界。
 *
 * Gateway 每次从 GameStore 读取最新快照，先在副本上完成校验和根行动，再
 * 把战斗快照与消耗品扣除交给同一个 SaveCoordinator candidate。只有保存成功
 * 后才向上层返回事件；失败时权威快照、背包、RNG、revision 和事件全部不变。
 */
import type {
  BattleCommandV1,
  BattleDomainEventV1,
  BattleResolutionV1,
  BattleSnapshotV1,
  ContentRootV1,
  DropTableDefinition,
  EncounterDefinition,
  EquipmentBaseDefinition,
  ComboDefinition,
  GameSaveV1,
  SkillStoneInstance,
} from "../content/contracts";
import { GameStore, SaveCoordinator, type SaveCoordinatorResult } from "./GameStore";
import { createDomainError, failure, type DomainResult } from "../domain/common/DomainResult";
import { createProductionDomainContext } from "../domain/common/DomainContext";
import { SeededRng } from "../domain/common/SeededRng";
import { validateBattleCommand, type BattleCommandContentSource, type ValidatedBattleCommand } from "../domain/battle/BattleCommandValidator";
import { resolveBattleAction, resolveControlledSkipAction, type ActionContentSource } from "../domain/battle/ActionResolver";
import { resolveBattleDynamicModifiers } from "../domain/battle/BattleLoadoutRuntime";
import { createBattleComboRuntime, type BattleComboRuntimeAdapter } from "../domain/battle/BattleComboRuntime";
import { applyAbyssEchoOutcome, evaluateAbyssEchoOutcome } from "../domain/battle/BattleReducer";
import { SkillModifierResolver } from "../domain/skill/SkillModifierResolver";
import { generateLoot, type LootContentSource } from "../domain/reward/LootGenerator";
import { claimReward } from "../domain/reward/RewardService";

export interface BattleCommandGatewayOptions {
  readonly store: GameStore;
  readonly coordinator: SaveCoordinator;
  readonly content: GatewayContentSource;
  /** 回响奖励所需的严格 LootContentSource；普通战斗不要求注入。 */
  readonly lootContent?: LootContentSource;
  readonly nextId?: (kind: "root" | "event") => string;
}

export interface BattleCommandGatewaySuccess {
  readonly ok: true;
  readonly value: BattleResolutionV1;
  readonly save: GameSaveV1;
  readonly events: BattleResolutionV1["events"];
  readonly candidateId: string;
}

export interface BattleCommandGatewayFailure {
  readonly ok: false;
  readonly error: import("../domain/common/DomainResult").DomainErrorV1;
  readonly events: readonly [];
  readonly candidateId?: string;
}

export type BattleCommandGatewayResult = BattleCommandGatewaySuccess | BattleCommandGatewayFailure;

const productionDomainContext = createProductionDomainContext();
let fallbackIdSequence = 0;

function fallbackUuidV4(): string {
  // 无 Web Crypto 的测试适配器仍返回合法 v4 UUID；计数器只在本模块内递增，保证不重复。
  const hex = fallbackIdSequence.toString(16).padStart(32, "0").slice(-32);
  fallbackIdSequence += 1;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function defaultIdFactory(kind: "root" | "event"): string {
  // 浏览器优先使用 crypto.randomUUID；存在 crypto 时的非法生产错误必须继续抛出。
  if (typeof globalThis.crypto?.randomUUID === "function") return productionDomainContext.nextId(kind);
  return `${kind}_${fallbackUuidV4()}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function noBattle(): Extract<DomainResult<never>, { readonly ok: false }> {
  return failure(createDomainError("INVALID_BATTLE_PHASE", { expected: ["AWAIT_COMMAND", "AI_DECIDE", "VALIDATE"], actual: "COMPLETE" }));
}

type GatewayContentSource = BattleCommandContentSource & ActionContentSource & {
  getDropTable?(id: string): DomainResult<Readonly<DropTableDefinition>>;
  getRoot?(): Readonly<ContentRootV1>;
  getEquipmentBase?(id: string): DomainResult<Readonly<EquipmentBaseDefinition>>;
  getCombo?(id: string): DomainResult<Readonly<ComboDefinition>>;
};

function contentInvalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function strictGetter<T extends { readonly id: string }>(
  getter: ((id: string) => DomainResult<Readonly<T>>) | undefined,
  id: string,
  path: string,
): DomainResult<Readonly<T>> {
  if (typeof getter !== "function") return contentInvalid(path, "getter_required");
  let result: DomainResult<Readonly<T>>;
  try {
    result = getter(id);
  } catch {
    return contentInvalid(path, "getter_failed");
  }
  if (!result.ok) return contentInvalid(path, "missing_reference");
  if (!result.value || result.value.id !== id) return contentInvalid(path, "id_mismatch");
  return result;
}

function deterministicGold(rng: SeededRng, encounter: Readonly<EncounterDefinition>): DomainResult<number> {
  if (!Number.isSafeInteger(encounter.goldRewardMin) || !Number.isSafeInteger(encounter.goldRewardMax) || encounter.goldRewardMin < 0 || encounter.goldRewardMax < encounter.goldRewardMin) {
    return contentInvalid(`encounters.${encounter.id}.goldReward`, "range");
  }
  try {
    return { ok: true, value: rng.nextIntInclusive(encounter.goldRewardMin, encounter.goldRewardMax) };
  } catch {
    return contentInvalid(`encounters.${encounter.id}.goldReward`, "rng_failed");
  }
}

function createAbyssEchoLootRng(
  expedition: Readonly<NonNullable<GameSaveV1["expedition"]>>,
  save: Readonly<GameSaveV1>,
  echoId: string,
): DomainResult<SeededRng> {
  // 战斗流与掉落流是同一回响尝试下的兄弟子流；终端战斗行动不会改变奖励抽取。
  if (!Number.isSafeInteger(expedition.expeditionSeed) || expedition.expeditionSeed < 0 || expedition.expeditionSeed > 0xffff_ffff) {
    return contentInvalid("expedition.expeditionSeed", "range");
  }
  if (!Number.isSafeInteger(save.world.echoAttemptSequence) || save.world.echoAttemptSequence < 0) {
    return contentInvalid("world.echoAttemptSequence", "range");
  }
  try {
    return {
      ok: true,
      value: SeededRng.fromSeed(expedition.expeditionSeed)
        .derive(`echo:${echoId}:attempt:${save.world.echoAttemptSequence}`)
        .derive("loot"),
    };
  } catch {
    return contentInvalid("expedition", "loot_rng_failed");
  }
}

function eventSequence(events: readonly BattleDomainEventV1[]): number {
  const last = events[events.length - 1];
  return last ? last.sequence + 1 : 0;
}

function echoEventBase(
  battle: Readonly<BattleSnapshotV1>,
  events: readonly BattleDomainEventV1[],
  eventId: string,
): Pick<BattleDomainEventV1, "eventId" | "sequence" | "battleId" | "round" | "rootActionId" | "rootActionDefinitionId" | "chainDepth" | "triggerSource" | "visualSkillId" | "contextSkillKind" | "effect"> {
  // 终局/奖励事件属于触发终局的同一个根行动，不能重新创建空 root。
  const rootEvent = events.find((event) => event.rootActionId !== null && event.rootActionDefinitionId !== null);
  return {
    eventId,
    sequence: eventSequence(events),
    battleId: battle.battleId,
    round: battle.round,
    rootActionId: rootEvent?.rootActionId ?? null,
    rootActionDefinitionId: rootEvent?.rootActionDefinitionId ?? null,
    chainDepth: 0,
    triggerSource: null,
    visualSkillId: null,
    contextSkillKind: null,
    effect: null,
  };
}

function createLootContent(
  source: GatewayContentSource,
  save: Readonly<GameSaveV1>,
  explicit: LootContentSource | undefined,
): DomainResult<LootContentSource> {
  if (explicit) return { ok: true, value: explicit };
  // 正式 Catalog 同时提供 getRoot/getItem/getCharacter/getSkill/getSkillAffix；
  // 这里仅按这些显式契约组装 LootContentSource，不从其它字段猜测。 
  if (!source.getRoot || !source.getItem || !source.getCharacter || !source.getSkill || !source.getSkillAffix) {
    return contentInvalid("lootContent", "dependencies_required");
  }
  let root: Readonly<ContentRootV1>;
  try {
    root = source.getRoot();
  } catch {
    return contentInvalid("content.getRoot", "getter_failed");
  }
  const recruitedCharacterIds = Object.values(save.characters).filter((character) => character.recruited).map((character) => character.characterId);
  if (recruitedCharacterIds.length === 0) return contentInvalid("characters", "recruited_required");
  return {
    ok: true,
    value: {
      getItem: source.getItem.bind(source),
      equipment: {
        equipmentBases: root.equipmentBases,
        equipmentAffixes: root.equipmentAffixes,
        economy: root.economy,
      },
      skillStone: {
        getCharacter: source.getCharacter.bind(source),
        getSkill: source.getSkill.bind(source),
        getSkillAffix: source.getSkillAffix.bind(source),
        getRoot: () => root,
      },
      recruitedCharacterIds,
    },
  };
}

export class BattleCommandGateway {
  private readonly store: GameStore;
  private readonly coordinator: SaveCoordinator;
  private readonly content: GatewayContentSource;
  private readonly lootContent?: LootContentSource;
  private readonly nextId: (kind: "root" | "event") => string;
  private readonly pendingResolutions = new Map<string, BattleResolutionV1>();

  public constructor(options: BattleCommandGatewayOptions) {
    this.store = options.store;
    this.coordinator = options.coordinator;
    this.content = options.content;
    this.lootContent = options.lootContent;
    this.nextId = options.nextId ?? defaultIdFactory;
  }

  /**
   * 从同一份候选存档创建 Combo runtime；普通根行动与控制跳过必须共用
   * 这条适配路径，避免控制状态遗漏周期击倒后的 onDefeatUnit 候选。
   */
  private buildComboRuntime(save: Readonly<GameSaveV1>): DomainResult<BattleComboRuntimeAdapter | undefined> {
    if (!(this.content.getRoot && this.content.getEquipmentBase && this.content.getCombo && this.content.getSkillAffix && this.content.getEquipmentAffix)) {
      return { ok: true, value: undefined };
    }
    const comboResult = createBattleComboRuntime({
      save: save as unknown as GameSaveV1,
      content: {
        getRoot: this.content.getRoot.bind(this.content),
        getCharacter: this.content.getCharacter.bind(this.content),
        getSkill: this.content.getSkill.bind(this.content),
        getEquipmentBase: this.content.getEquipmentBase.bind(this.content),
        getEquipmentAffix: this.content.getEquipmentAffix.bind(this.content),
        getSkillAffix: this.content.getSkillAffix.bind(this.content),
        getCombo: this.content.getCombo.bind(this.content),
      },
    });
    if (!comboResult.ok) return comboResult;
    return { ok: true, value: comboResult.value };
  }

  private buildResolution(command: BattleCommandV1): DomainResult<BattleResolutionV1> {
    const save = this.store.getSnapshot();
    if (!save.battle) return noBattle();
    const validation = validateBattleCommand({
      snapshot: save.battle as unknown as BattleSnapshotV1,
      expedition: save.expedition as unknown as Parameters<typeof validateBattleCommand>[0]["expedition"],
      command,
      content: this.content,
      inventory: save.inventory as unknown as GameSaveV1["inventory"],
      characters: save.characters as unknown as GameSaveV1["characters"],
      skillStones: Object.fromEntries(save.inventory.skillStones.map((stone) => [stone.attunedCharacterId, stone])) as Record<string, SkillStoneInstance>,
      skillModifierResolver: this.content.getSkillAffix ? new SkillModifierResolver({ getSkillAffix: this.content.getSkillAffix.bind(this.content) }) : undefined,
    });
    if (!validation.ok) return validation;
    const comboResult = this.buildComboRuntime(save as unknown as GameSaveV1);
    if (!comboResult.ok) return comboResult;
    const comboRuntime = comboResult.value;
    const input = this.actionInput(clone(save.battle) as BattleSnapshotV1, validation.value, command, save as unknown as GameSaveV1, comboRuntime);
    return resolveBattleAction(input);
  }

  private actionInput(snapshot: NonNullable<GameSaveV1["battle"]>, validated: ValidatedBattleCommand, command: BattleCommandV1, save: Readonly<GameSaveV1>, comboRuntime?: BattleComboRuntimeAdapter) {
    return {
      snapshot,
      command,
      skill: validated.skill,
      skillKind: validated.skillKind,
      skillLevel: validated.skillLevel,
      skillModifierResolution: validated.skillModifierResolution,
      item: validated.item,
      content: this.content,
      // 解析时闭包捕获同一次 buildResolution 的存档，保存失败 retry 不会重新读取
      // 新快照或重新抽取动态词条。
      // 旧的纯战斗测试适配器若未提供装备词条 getter，就不启用 loadout
      // 解析器；正式 Catalog 会提供该显式 getter，不会静默猜测字段。
      dynamicModifierResolver: this.content.getEquipmentAffix ? ({ actor, target, effect, skill, round }: Parameters<NonNullable<import("../domain/battle/ActionResolver").BattleActionResolverInput["dynamicModifierResolver"]>>[0]) => resolveBattleDynamicModifiers({
        save: save as unknown as GameSaveV1,
        actor,
        target,
        effect,
        skill,
        round,
        content: {
          getCharacter: this.content.getCharacter.bind(this.content),
          getSkill: this.content.getSkill.bind(this.content),
          getStatus: this.content.getStatus?.bind(this.content),
          getEquipmentAffix: this.content.getEquipmentAffix?.bind(this.content),
        },
      }) : undefined,
      comboRuntime,
      rng: SeededRng.fromState(snapshot.rngState),
      nextId: this.nextId,
      targetUnitIds: validated.targetUnitIds,
    };
  }

  /**
   * 回响终局和奖励都在同一个 nextSave 上组合；这里只生成候选，不触碰 Store。
   * 因而奖励 RNG、物品库存、clearedEchoIds 和回城状态会随同一 candidate 重试。
   */
  private prepareAbyssEchoTerminal(
    nextSave: GameSaveV1,
    resolution: BattleResolutionV1,
  ): DomainResult<{ readonly save: GameSaveV1; readonly resolution: BattleResolutionV1 }> {
    const expedition = nextSave.expedition;
    const battle = nextSave.battle;
    if (expedition?.mode !== "abyssEcho" || !battle || battle.outcome === "ongoing") {
      return { ok: true, value: { save: nextSave, resolution } };
    }
    const echoId = expedition.abyssEchoId;
    if (typeof echoId !== "string" || echoId.length === 0) return contentInvalid("expedition.abyssEchoId", "required");
    const echoResult = strictGetter(this.content.getAbyssEcho, echoId, `abyssEchoes.${echoId}`);
    if (!echoResult.ok) return echoResult;
    const echo = echoResult.value;
    if (echo.bossEncounterId !== battle.encounterId) return contentInvalid("battle.encounterId", "echo_boss_mismatch");

    const evaluation = evaluateAbyssEchoOutcome(battle, echo);
    if (!evaluation.ok) return evaluation;
    const applied = applyAbyssEchoOutcome(battle, echo);
    if (!applied.ok) return applied;
    const finalBattle = applied.value;
    // COMPLETE 快照不再保留任何尚未应用的队列事件或 Boss 意图。
    finalBattle.pendingEvents = [];
    finalBattle.pendingBossIntents = [];
    // 击杀以外的终局（例如战败）即使指标碰巧满足，也不能判定回响成功。
    const echoSuccess = battle.outcome === "victory" && evaluation.value.success;
    finalBattle.abyssEchoOutcome = echoSuccess ? "success" : "failed";
    finalBattle.reward = null;
    finalBattle.pendingEvents = [];

    const evaluatedEvent: BattleDomainEventV1 = {
      ...echoEventBase(battle, resolution.events, this.nextId("event")),
      type: "ABYSS_ECHO_EVALUATED",
      echoId,
      success: echoSuccess,
      failedReasons: [...evaluation.value.failedReasons],
    };
    const events: BattleDomainEventV1[] = [...resolution.events, evaluatedEvent];

    if (echoSuccess) {
      const encounterResult = strictGetter(this.content.getEncounter, battle.encounterId, `encounters.${battle.encounterId}`);
      if (!encounterResult.ok) return encounterResult;
      const encounter = encounterResult.value;
      const dropTableResult = strictGetter(this.content.getDropTable, encounter.dropTableId, `dropTables.${encounter.dropTableId}`);
      if (!dropTableResult.ok) return dropTableResult;
      const lootContent = createLootContent(this.content, nextSave, this.lootContent);
      if (!lootContent.ok) return lootContent;

      const lootRng = createAbyssEchoLootRng(expedition, nextSave, echoId);
      if (!lootRng.ok) return lootRng;
      const rewardRng = lootRng.value;
      const gold = deterministicGold(rewardRng, encounter);
      if (!gold.ok) return gold;
      const transactionId = `reward_abyss_echo_${echo.id}_${battle.battleId}`;
      const generated = generateLoot({
        transactionId,
        source: { kind: "abyssEcho", echoId, encounterId: battle.encounterId },
        table: dropTableResult.value,
        inventory: nextSave.inventory,
        content: lootContent.value,
        rng: rewardRng,
        abyssEcho: {
          bonusAbyssUpgradeChanceBps: echo.bonusAbyssUpgradeChanceBps,
          firstClearForgeShards: echo.firstClearForgeShards,
          firstClearInscriptionDust: echo.firstClearInscriptionDust,
          isFirstClear: !nextSave.world.clearedEchoIds.includes(echoId),
        },
        xp: encounter.xpReward,
        gold: gold.value,
        acquiredAt: nextSave.updatedAt,
        // 默认生成器的冒号 ID 不是存档实体 ID；候选内显式固定为 schema 合法 ID。
        nextInstanceId: (index) => `${transactionId}_instance_${index}`,
      });
      if (!generated.ok) return generated;
      const claimed = claimReward({
        inventory: nextSave.inventory,
        reward: generated.value,
        claimedRewardTransactionIds: nextSave.claimedRewardTransactionIds,
        content: lootContent.value,
      });
      if (!claimed.ok) return claimed;
      nextSave.inventory = claimed.value.inventory;
      nextSave.claimedRewardTransactionIds = [...claimed.value.claimedRewardTransactionIds];
      nextSave.gold += claimed.value.reward.gold;
      finalBattle.reward = claimed.value.reward;
      if (!nextSave.world.clearedEchoIds.includes(echoId)) nextSave.world.clearedEchoIds.push(echoId);

      const rewardEvent: BattleDomainEventV1 = {
        ...echoEventBase(finalBattle, events, this.nextId("event")),
        type: "REWARD_PREPARED",
        transactionId,
      };
      events.push(rewardEvent);
    }

    nextSave.expedition = null;
    nextSave.battle = finalBattle;
    const finalResolution: BattleResolutionV1 = {
      ...resolution,
      snapshot: clone(finalBattle),
      events,
    };
    return { ok: true, value: { save: nextSave, resolution: finalResolution } };
  }

  private async submitResolution(
    expectedBattleRevision: number,
    resolution: BattleResolutionV1,
    command: BattleCommandV1 | undefined,
  ): Promise<BattleCommandGatewayResult> {
    const current = this.store.getSnapshot();
    const currentBattle = current.battle;
    const expectedResolutionRevision = expectedBattleRevision + 1;
    // buildResolution 与 submit 之间可能有其它写入；禁止把旧 battleId/revision 覆盖到新快照。
    if (!currentBattle
      || currentBattle.battleId !== resolution.snapshot.battleId
      || currentBattle.battleRevision !== expectedBattleRevision
      || resolution.snapshot.battleRevision !== expectedResolutionRevision) {
      return {
        ok: false,
        error: createDomainError("STALE_BATTLE_REVISION", {
          expectedRevision: expectedResolutionRevision,
          actualRevision: resolution.snapshot.battleRevision,
        }),
        events: [],
      };
    }
    const nextSave = clone(current) as unknown as GameSaveV1;
    nextSave.battle = clone(resolution.snapshot);
    if (resolution.consumedItem) {
      const itemId = resolution.consumedItem.itemId;
      const owned = nextSave.inventory.stackables[itemId] ?? 0;
      if (owned < resolution.consumedItem.quantity) return { ok: false, error: createDomainError("ITEM_NOT_OWNED", { instanceId: null, itemId }), events: [] };
      nextSave.inventory.stackables[itemId] = owned - resolution.consumedItem.quantity;
      nextSave.battle.successfulItemUses += resolution.consumedItem.quantity;
    }
    const terminal = this.prepareAbyssEchoTerminal(nextSave, resolution);
    if (!terminal.ok) return { ok: false, error: terminal.error, events: [] };
    const effectiveResolution = terminal.value.resolution;
    const saved: SaveCoordinatorResult = await this.coordinator.commit("battle", terminal.value.save, {
      events: effectiveResolution.events,
      command: command ?? {
        type: "CONTROL_SKIP",
        expectedBattleRevision,
        actorUnitId: effectiveResolution.events.find((event) => event.type === "ACTION_STARTED")?.actorUnitId ?? null,
      },
    });
    if (!saved.ok) {
      if (saved.candidateId) this.pendingResolutions.set(saved.candidateId, clone(effectiveResolution));
      return { ok: false, error: saved.error, events: [], candidateId: saved.candidateId };
    }
    return { ok: true, value: effectiveResolution, save: saved.save, events: effectiveResolution.events, candidateId: saved.candidateId };
  }

  private async submit(command: BattleCommandV1, resolution: BattleResolutionV1): Promise<BattleCommandGatewayResult> {
    return this.submitResolution(command.expectedBattleRevision, resolution, command);
  }

  /** 从最新 Store 快照提交一条命令；非法命令不会产生根 ID 或保存候选。 */
  public async execute(command: BattleCommandV1): Promise<BattleCommandGatewayResult> {
    const resolution = this.buildResolution(command);
    if (!resolution.ok) return { ok: false, error: resolution.error, events: [] };
    return this.submit(command, resolution.value);
  }

  /**
   * 提交控制状态的跳过根行动；它不伪造 BattleCommandV1，仍走同一 CAS
   * candidate 和失败重试边界。
   */
  public async executeControlSkip(): Promise<BattleCommandGatewayResult> {
    const save = this.store.getSnapshot();
    if (!save.battle) {
      const missing = noBattle();
      return { ok: false, error: missing.error, events: [] };
    }
    const battle = clone(save.battle) as BattleSnapshotV1;
    const comboResult = this.buildComboRuntime(save as unknown as GameSaveV1);
    if (!comboResult.ok) return { ok: false, error: comboResult.error, events: [] };
    const resolution = resolveControlledSkipAction({
      snapshot: battle,
      actorUnitId: battle.currentUnitId ?? undefined,
      content: this.content,
      comboRuntime: comboResult.value,
      rng: SeededRng.fromState(battle.rngState),
      nextId: this.nextId,
    });
    if (!resolution.ok) return { ok: false, error: resolution.error, events: [] };
    return this.submitResolution(battle.battleRevision, resolution.value, undefined);
  }

  /** 保存失败后只重试同一个冻结 candidate，避免重新抽 RNG 或生成 rootActionId。 */
  public async retry(candidateId: string): Promise<BattleCommandGatewayResult> {
    const resolution = this.pendingResolutions.get(candidateId);
    if (!resolution) return { ok: false, error: createDomainError("SAVE_FAILED", { operation: "save" }), events: [] };
    const saved = await this.coordinator.retry(candidateId);
    if (!saved.ok) return { ok: false, error: saved.error, events: [], candidateId: saved.candidateId };
    this.pendingResolutions.delete(candidateId);
    return { ok: true, value: resolution, save: saved.save, events: resolution.events, candidateId };
  }

  /** 便于 UI 命名和测试调用，仍走同一 execute 实现。 */
  public async dispatch(command: BattleCommandV1): Promise<BattleCommandGatewayResult> {
    return this.execute(command);
  }
}

export async function executeBattleCommand(
  options: BattleCommandGatewayOptions,
  command: BattleCommandV1,
): Promise<BattleCommandGatewayResult> {
  return new BattleCommandGateway(options).execute(command);
}
