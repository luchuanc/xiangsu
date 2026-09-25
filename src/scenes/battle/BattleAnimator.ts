import type { BattleDomainEventV1, BattleSnapshotV1 } from "../../content/contracts";

export type BattleAnimationEventType = BattleDomainEventV1["type"];

export interface BattleAnimatorAudioLike {
  playSfx(id: string): boolean | void | Promise<boolean | void>;
}

export interface BattleAnimatorOptions {
  readonly durationMs?: Partial<Record<BattleAnimationEventType, number>>;
  readonly eventSfx?: Partial<Record<BattleAnimationEventType, string | null>>;
  readonly audio?: BattleAnimatorAudioLike;
  readonly reducedFlashes?: boolean;
  readonly speed?: 1 | 2;
  readonly onEvent?: (event: BattleDomainEventV1) => void;
  readonly onFinalSnapshot?: (snapshot: Readonly<BattleSnapshotV1>) => void;
}

export interface ComboBannerProjection {
  readonly visible: boolean;
  readonly comboId: string;
  readonly ownerKey: string;
  readonly targetUnitIds: readonly string[];
  readonly durationMs: number;
  readonly collapsed: boolean;
}

export interface EchoResultProjection {
  readonly status: "success" | "failed";
  readonly echoId: string;
  readonly failedReasons: readonly string[];
}

export interface BattleAnimationResult {
  readonly cancelled: boolean;
  readonly finalSnapshot: Readonly<BattleSnapshotV1>;
}

const DEFAULT_DURATION_MS: Readonly<Partial<Record<BattleAnimationEventType, number>>> = Object.freeze({
  PHASE_CHANGED: 0,
  // 起手冲刺是点击后的即时反馈；160ms 仍能看清动作，同时让命中反馈在移动端约 160~200ms 内出现。
  ACTION_STARTED: 160,
  INTENT_DECLARED: 350,
  INTENT_RELEASED: 0,
  INTENT_CLEARED: 0,
  DAMAGE_RESOLVED: 350,
  HEAL_RESOLVED: 350,
  SHIELD_GRANTED: 350,
  STATUS_CHANGED: 250,
  RESOURCE_CHANGED: 0,
  UNIT_SUMMONED: 350,
  UNIT_DEFEATED: 500,
  UNIT_REVIVED: 350,
  TURN_SKIPPED: 0,
  EXTRA_TURN_RESOLVED: 0,
  COMBO_TRIGGERED: 700,
  TRIGGER_REJECTED: 0,
  ACTION_FINISHED: 0,
  BATTLE_FINISHED: 800,
  ABYSS_ECHO_EVALUATED: 400,
  REWARD_PREPARED: 0,
});

function assertNever(value: never): never {
  throw new Error(`未知战斗表现事件: ${String(value)}`);
}

function durationFor(type: BattleAnimationEventType): number {
  switch (type) {
    case "PHASE_CHANGED": return DEFAULT_DURATION_MS.PHASE_CHANGED ?? 0;
    case "ACTION_STARTED": return DEFAULT_DURATION_MS.ACTION_STARTED ?? 0;
    case "INTENT_DECLARED": return DEFAULT_DURATION_MS.INTENT_DECLARED ?? 0;
    case "INTENT_RELEASED": return DEFAULT_DURATION_MS.INTENT_RELEASED ?? 0;
    case "INTENT_CLEARED": return DEFAULT_DURATION_MS.INTENT_CLEARED ?? 0;
    case "DAMAGE_RESOLVED": return DEFAULT_DURATION_MS.DAMAGE_RESOLVED ?? 0;
    case "HEAL_RESOLVED": return DEFAULT_DURATION_MS.HEAL_RESOLVED ?? 0;
    case "SHIELD_GRANTED": return DEFAULT_DURATION_MS.SHIELD_GRANTED ?? 0;
    case "STATUS_CHANGED": return DEFAULT_DURATION_MS.STATUS_CHANGED ?? 0;
    case "RESOURCE_CHANGED": return DEFAULT_DURATION_MS.RESOURCE_CHANGED ?? 0;
    case "UNIT_SUMMONED": return DEFAULT_DURATION_MS.UNIT_SUMMONED ?? 0;
    case "UNIT_DEFEATED": return DEFAULT_DURATION_MS.UNIT_DEFEATED ?? 0;
    case "UNIT_REVIVED": return DEFAULT_DURATION_MS.UNIT_REVIVED ?? 0;
    case "TURN_SKIPPED": return DEFAULT_DURATION_MS.TURN_SKIPPED ?? 0;
    case "EXTRA_TURN_RESOLVED": return DEFAULT_DURATION_MS.EXTRA_TURN_RESOLVED ?? 0;
    case "COMBO_TRIGGERED": return DEFAULT_DURATION_MS.COMBO_TRIGGERED ?? 0;
    case "TRIGGER_REJECTED": return DEFAULT_DURATION_MS.TRIGGER_REJECTED ?? 0;
    case "ACTION_FINISHED": return DEFAULT_DURATION_MS.ACTION_FINISHED ?? 0;
    case "BATTLE_FINISHED": return DEFAULT_DURATION_MS.BATTLE_FINISHED ?? 0;
    case "ABYSS_ECHO_EVALUATED": return DEFAULT_DURATION_MS.ABYSS_ECHO_EVALUATED ?? 0;
    case "REWARD_PREPARED": return DEFAULT_DURATION_MS.REWARD_PREPARED ?? 0;
    default: return assertNever(type);
  }
}

/**
 * 表现队列只消费已经成功提交的事件；它不产生领域事件，也不写入领域状态。
 */
export class BattleAnimator {
  private readonly options: BattleAnimatorOptions;
  private readonly durationOverrides: Partial<Record<BattleAnimationEventType, number>>;
  private readonly sfxOverrides: Partial<Record<BattleAnimationEventType, string | null>>;
  private active = false;
  private destroyed = false;
  private cancelled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resolveDelay: (() => void) | null = null;
  private resolveActive: ((result: BattleAnimationResult) => void) | null = null;
  private finalSnapshot: Readonly<BattleSnapshotV1> | null = null;
  private comboKeys = new Set<string>();
  private lastBattleId: string | null = null;

  public constructor(options: BattleAnimatorOptions = {}) {
    this.options = options;
    this.durationOverrides = options.durationMs ?? {};
    this.sfxOverrides = options.eventSfx ?? {};
  }

  public get isPlaying(): boolean {
    return this.active;
  }

  public async play(events: readonly BattleDomainEventV1[], finalSnapshot: Readonly<BattleSnapshotV1>): Promise<BattleAnimationResult> {
    if (this.destroyed) throw new Error("BattleAnimator 已销毁");
    this.cancel();
    // 切换战斗时清理表现层去重键，避免把上一场的 Combo 横幅折叠到本场。
    if (this.lastBattleId !== null && this.lastBattleId !== finalSnapshot.battleId) this.comboKeys.clear();
    this.lastBattleId = finalSnapshot.battleId;
    this.active = true;
    this.cancelled = false;
    this.finalSnapshot = finalSnapshot;
    const result = await new Promise<BattleAnimationResult>((resolve) => {
      this.resolveActive = resolve;
      void this.playSerial(events, finalSnapshot);
    });
    this.active = false;
    this.resolveActive = null;
    return result;
  }

  public cancel(): void {
    if (!this.active) return;
    this.cancelled = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const resolveDelay = this.resolveDelay;
    this.resolveDelay = null;
    resolveDelay?.();
    const final = this.finalSnapshot;
    const resolve = this.resolveActive;
    this.active = false;
    this.resolveActive = null;
    if (final && resolve) {
      this.options.onFinalSnapshot?.(final);
      resolve({ cancelled: true, finalSnapshot: final });
    }
  }

  public skip(finalSnapshot: Readonly<BattleSnapshotV1>): void {
    this.finalSnapshot = finalSnapshot;
    if (this.active) this.cancel();
    else this.options.onFinalSnapshot?.(finalSnapshot);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.cancel();
    this.destroyed = true;
    this.comboKeys.clear();
    this.lastBattleId = null;
  }

  public projectCombo(event: BattleDomainEventV1): ComboBannerProjection | null {
    if (event.type !== "COMBO_TRIGGERED") return null;
    // 事件可能在未调用 play 的恢复路径直接投影，仍需按战斗边界隔离去重键。
    if (this.lastBattleId !== null && this.lastBattleId !== event.battleId) this.comboKeys.clear();
    this.lastBattleId = event.battleId;
    const rootKey = event.rootActionId ?? event.eventId;
    const key = `${event.battleId}:${rootKey}:${event.ownerKey}:${event.comboId}`;
    // 只有同一战斗、同一根行动的后续事件折叠；firstInBattle 不能跨 root 复用旧键。
    const collapsed = this.comboKeys.has(key);
    this.comboKeys.add(key);
    return Object.freeze({
      visible: true,
      comboId: event.comboId,
      ownerKey: event.ownerKey,
      targetUnitIds: Object.freeze([...event.targetUnitIds]),
      durationMs: this.options.reducedFlashes ? 400 : 700,
      collapsed,
    });
  }

  public projectEcho(event: BattleDomainEventV1): EchoResultProjection | null {
    if (event.type !== "ABYSS_ECHO_EVALUATED") return null;
    return Object.freeze({ status: event.success ? "success" : "failed", echoId: event.echoId, failedReasons: Object.freeze([...event.failedReasons]) });
  }

  private async playSerial(events: readonly BattleDomainEventV1[], finalSnapshot: Readonly<BattleSnapshotV1>): Promise<void> {
    for (const event of events) {
      if (this.cancelled || !this.active) return;
      this.emitEvent(event);
      const duration = this.animationDuration(event.type);
      if (duration <= 0) continue;
      await new Promise<void>((resolve) => {
        this.resolveDelay = resolve;
        this.timer = setTimeout(() => {
          this.timer = null;
          this.resolveDelay = null;
          resolve();
        }, duration);
      });
    }
    if (!this.active || this.cancelled) return;
    this.active = false;
    this.options.onFinalSnapshot?.(finalSnapshot);
    this.resolveActive?.({ cancelled: false, finalSnapshot });
  }

  private emitEvent(event: BattleDomainEventV1): void {
    this.options.onEvent?.(event);
    const sfx = this.sfxOverrides[event.type] ?? null;
    if (sfx !== null) void this.options.audio?.playSfx(sfx);
    // 显式穷举保证新增领域事件不会被静默忽略。
    switch (event.type) {
      case "PHASE_CHANGED":
      case "ACTION_STARTED":
      case "INTENT_DECLARED":
      case "INTENT_RELEASED":
      case "INTENT_CLEARED":
      case "DAMAGE_RESOLVED":
      case "HEAL_RESOLVED":
      case "SHIELD_GRANTED":
      case "STATUS_CHANGED":
      case "RESOURCE_CHANGED":
      case "UNIT_SUMMONED":
      case "UNIT_DEFEATED":
      case "UNIT_REVIVED":
      case "TURN_SKIPPED":
      case "EXTRA_TURN_RESOLVED":
      case "COMBO_TRIGGERED":
      case "TRIGGER_REJECTED":
      case "ACTION_FINISHED":
      case "BATTLE_FINISHED":
      case "ABYSS_ECHO_EVALUATED":
      case "REWARD_PREPARED":
        return;
      default:
        assertNever(event);
    }
  }

  private animationDuration(type: BattleAnimationEventType): number {
    const configured = this.durationOverrides[type];
    const base = configured === undefined ? durationFor(type) : configured;
    if (!Number.isFinite(base) || base < 0) throw new RangeError("动画时长必须是非负有限数");
    if (this.options.reducedFlashes && type === "COMBO_TRIGGERED") return 400;
    const speed = this.options.speed ?? 1;
    return Math.floor(base / speed);
  }
}
