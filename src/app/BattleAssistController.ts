import type {
  BattleCommandV1,
  BattleSnapshotV1,
  BattleUnitStateV1,
  CharacterDefinition,
  EncounterDefinition,
  FloorDefinition,
  GameSaveV1,
  SkillDefinition,
  TargetRule,
} from "../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../domain/common/DomainResult";
import { getLegalTargetUnitIds, selectPrimaryTarget } from "../domain/battle/Targeting";

export interface BattleAssistClock {
  setTimeout(handler: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BattleAssistGateway {
  execute(command: BattleCommandV1): Promise<{ readonly ok: boolean; readonly [key: string]: unknown }>;
}

export interface BattleAssistStore {
  getSnapshot(): Readonly<GameSaveV1>;
}

export interface BattleAssistContent {
  getCharacter(id: string): DomainResult<Readonly<CharacterDefinition>>;
  getFloor(id: string): DomainResult<Readonly<FloorDefinition>>;
  getEncounter(id: string): DomainResult<Readonly<EncounterDefinition>>;
  getSkill(id: string): DomainResult<Readonly<SkillDefinition>>;
}

export interface BattleAssistContext {
  readonly save: Readonly<GameSaveV1>;
  readonly snapshot: Readonly<BattleSnapshotV1>;
}

export type BattleAssistRecordedAction = { readonly kind: "basic" } | { readonly kind: "active"; readonly skillId: string };

export interface BattleAssistState {
  readonly enabled: boolean;
  readonly armed: boolean;
  readonly countdownMs: number;
  readonly lastActionByCharacter: Readonly<Record<string, BattleAssistRecordedAction | null>>;
}

export interface BattleAssistOptions {
  readonly content: BattleAssistContent;
  readonly gateway: BattleAssistGateway;
  readonly store?: BattleAssistStore;
  readonly clock?: BattleAssistClock;
  readonly delayMs?: number;
  readonly onStateChange?: (state: BattleAssistState) => void;
  /** 稳定命令成功后由上层以同一 SaveCoordinator 候选持久化偏好。 */
  readonly onActionRecorded?: (characterId: string, action: BattleAssistRecordedAction) => void | Promise<void>;
}

const browserClock: BattleAssistClock = {
  setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function invalidTarget(targetUnitId: string | null): DomainResult<never> {
  return failure(createDomainError("INVALID_TARGET", { reason: "UNKNOWN", targetUnitId }));
}

function emptyTargetRule(rule: TargetRule): boolean {
  return rule === "self" || rule === "allAllies" || rule === "allEnemies" || rule === "randomEnemy";
}

function alive(unit: BattleUnitStateV1): boolean {
  return unit.currentHp > 0;
}

/**
 * 重复指令辅助只生成既有 BattleCommandV1，不引入 AUTO 命令。
 * 倒计时、输入取消和目标选择均在应用层完成，最终 revision/资源校验仍由
 * BattleCommandGateway 负责，因此人工命令抢先到达时自然得到 stale 结果。
 */
export class BattleAssistController {
  private readonly options: BattleAssistOptions;
  private readonly clock: BattleAssistClock;
  private readonly delayMs: number;
  private enabled = false;
  private armed = false;
  private countdownMs = 0;
  private timer: unknown = null;
  private token = 0;
  private readonly lastActionByCharacter = new Map<string, BattleAssistRecordedAction | null>();

  public constructor(options: BattleAssistOptions) {
    this.options = options;
    this.clock = options.clock ?? browserClock;
    this.delayMs = options.delayMs ?? 350;
  }

  public get state(): BattleAssistState {
    return Object.freeze({
      enabled: this.enabled,
      armed: this.armed,
      countdownMs: this.countdownMs,
      lastActionByCharacter: Object.freeze(Object.fromEntries(this.lastActionByCharacter)),
    });
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel("disabled");
    this.emit();
  }

  public toggleEnabled(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  public loadRecordedActions(actions: Readonly<Record<string, BattleAssistRecordedAction | null>>): void {
    this.lastActionByCharacter.clear();
    for (const [characterId, action] of Object.entries(actions)) this.lastActionByCharacter.set(characterId, action);
    this.emit();
  }

  public onAwaitCommand(context: BattleAssistContext): boolean {
    this.cancel("rearm");
    if (!this.enabled || !this.isEligible(context) || context.snapshot.phase !== "AWAIT_COMMAND") {
      this.emit();
      return false;
    }
    const actor = this.actorFor(context.snapshot);
    if (!actor || !alive(actor) || actor.faction !== "party") {
      this.emit();
      return false;
    }
    const token = ++this.token;
    this.armed = true;
    this.countdownMs = this.delayMs;
    this.timer = this.clock.setTimeout(() => {
      if (token !== this.token || !this.armed) return;
      this.timer = null;
      this.armed = false;
      this.countdownMs = 0;
      void this.submit(context, token);
      this.emit();
    }, this.delayMs);
    this.emit();
    return true;
  }

  public arm(context: BattleAssistContext): boolean {
    return this.onAwaitCommand(context);
  }

  public cancel(reason = "input"): void {
    void reason;
    this.token += 1;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.armed = false;
    this.countdownMs = 0;
  }

  public onPointerDown(): void { this.cancel("pointerdown"); this.emit(); }
  public onVisibilityHidden(): void { this.cancel("hidden"); this.emit(); }
  public onResize(): void { this.cancel("resize"); this.emit(); }
  public onPause(): void { this.cancel("pause"); this.emit(); }
  public onOverlayOpened(): void { this.cancel("overlay"); this.emit(); }
  public onManualCommand(): void { this.cancel("manual"); this.emit(); }

  public recordSuccessfulCommand(characterId: string, command: BattleCommandV1): void {
    const action: BattleAssistRecordedAction | null = command.type === "USE_BASIC"
      ? { kind: "basic" }
      : command.type === "USE_SKILL"
        ? { kind: "active", skillId: command.skillId }
        : null;
    if (action === null) return;
    this.lastActionByCharacter.set(characterId, action);
    void this.options.onActionRecorded?.(characterId, action);
    this.emit();
  }

  public chooseTargets(
    snapshot: Readonly<BattleSnapshotV1>,
    actorUnitId: string,
    targetRule: TargetRule,
    requiresFrontAccess = false,
  ): DomainResult<readonly string[]> {
    if (emptyTargetRule(targetRule)) {
      const legal = getLegalTargetUnitIds(snapshot, actorUnitId, targetRule, requiresFrontAccess);
      return legal.ok ? success([]) : legal;
    }
    const primary = selectPrimaryTarget(snapshot, actorUnitId, targetRule as "singleAlly" | "singleEnemy" | "deadAlly", requiresFrontAccess);
    return primary.ok ? success([primary.value.targetUnitId]) : primary;
  }

  public buildCommand(context: BattleAssistContext): DomainResult<BattleCommandV1> {
    const actor = this.actorFor(context.snapshot);
    if (!actor || actor.faction !== "party" || !alive(actor)) return invalidTarget(actor?.unitId ?? null);
    const characterResult = this.options.content.getCharacter(actor.definitionId);
    if (!characterResult.ok) return characterResult;
    const character = characterResult.value;
    const recorded = this.lastActionByCharacter.get(character.id) ?? context.save.battleAssist.lastActionByCharacter[character.id] ?? null;
    const active = recorded?.kind === "active" ? this.activeSkillIfLegal(context, actor, character, recorded.skillId) : null;
    const chosenSkill = active ? success(active) : this.options.content.getSkill(character.basicSkillId);
    if (!chosenSkill.ok) return chosenSkill;
    const targetIds = this.chooseTargets(context.snapshot, actor.unitId, chosenSkill.value.targetRule, chosenSkill.value.requiresFrontAccess);
    if (!targetIds.ok) return targetIds;
    const common = { expectedBattleRevision: context.snapshot.battleRevision, actorUnitId: actor.unitId, targetUnitIds: [...targetIds.value] };
    return success(active
      ? { type: "USE_SKILL", ...common, skillId: active.id }
      : { type: "USE_BASIC", ...common });
  }

  public dispose(): void {
    this.cancel("dispose");
    this.lastActionByCharacter.clear();
  }

  private activeSkillIfLegal(
    context: BattleAssistContext,
    actor: BattleUnitStateV1,
    character: Readonly<CharacterDefinition>,
    skillId: string,
  ): Readonly<SkillDefinition> | null {
    if (!character.activeSkillIds.includes(skillId as typeof character.activeSkillIds[number])) return null;
    const skillResult = this.options.content.getSkill(skillId);
    if (!skillResult.ok) return null;
    const skill = skillResult.value;
    const level = context.save.characters[character.id]?.skillLevels[skill.id] ?? 0;
    if (level < skill.unlockLevel || level <= 0) return null;
    if ((actor.cooldowns[skill.id] ?? 0) !== 0) return null;
    const levelIndex = Math.min(4, Math.max(0, level - 1));
    if (actor.energy < skill.energyCostByLevel[levelIndex]) return null;
    return skill;
  }

  private async submit(context: BattleAssistContext, token: number): Promise<void> {
    if (token !== this.token || !this.enabled) return;
    const latestSave = this.options.store?.getSnapshot() ?? context.save;
    const latestSnapshot = latestSave.battle ?? context.snapshot;
    if (latestSnapshot.phase !== "AWAIT_COMMAND" || !this.isEligible({ save: latestSave, snapshot: latestSnapshot })) return;
    const latestContext = { save: latestSave, snapshot: latestSnapshot };
    const command = this.buildCommand(latestContext);
    if (!command.ok) return;
    const result = await this.options.gateway.execute(command.value);
    if (!result.ok || token !== this.token) return;
    const actor = this.actorFor(latestSnapshot);
    if (actor) this.recordSuccessfulCommand(actor.definitionId, command.value);
  }

  private isEligible(context: BattleAssistContext): boolean {
    const expedition = context.save.expedition;
    if (!expedition || (expedition.mode !== "exploration" && expedition.mode !== "shortFarm")) return false;
    const floorResult = this.options.content.getFloor(expedition.floorId);
    if (!floorResult.ok) return false;
    if (!context.save.world.clearedBossEncounterIds.includes(floorResult.value.bossEncounterId)) return false;
    const encounterResult = this.options.content.getEncounter(context.snapshot.encounterId);
    return encounterResult.ok && (encounterResult.value.kind === "normal" || encounterResult.value.kind === "elite");
  }

  private actorFor(snapshot: Readonly<BattleSnapshotV1>): BattleUnitStateV1 | undefined {
    return snapshot.units.find((unit) => unit.unitId === snapshot.currentUnitId);
  }

  private emit(): void {
    this.options.onStateChange?.(this.state);
  }
}
