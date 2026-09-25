import type {
  BattleSnapshotV1,
  BattleUnitStateV1,
  EnemyTargetStrategy,
  TargetRule,
} from "../../content/contracts";

export interface BattleSlotPosition {
  readonly x: number;
  readonly y: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

// 战斗单位位置是逻辑坐标，表现层不根据单位速度或 definitionId 重新排位。
export const PARTY_SLOT_POSITIONS: readonly BattleSlotPosition[] = Object.freeze([
  { x: 144, y: 150, anchorX: 24, anchorY: 42 },
  { x: 144, y: 220, anchorX: 24, anchorY: 42 },
  { x: 224, y: 150, anchorX: 24, anchorY: 42 },
  { x: 224, y: 220, anchorX: 24, anchorY: 42 },
]);

export const ENEMY_SLOT_POSITIONS: readonly BattleSlotPosition[] = Object.freeze([
  { x: 496, y: 150, anchorX: 24, anchorY: 42 },
  { x: 496, y: 220, anchorX: 24, anchorY: 42 },
  { x: 416, y: 150, anchorX: 24, anchorY: 42 },
  { x: 416, y: 220, anchorX: 24, anchorY: 42 },
  { x: 576, y: 150, anchorX: 24, anchorY: 42 },
  { x: 576, y: 220, anchorX: 24, anchorY: 42 },
]);

export interface BattleBossProjectionOptions {
  readonly phaseThresholdBps: readonly number[];
  readonly enrageRound: number;
  readonly enrageState: "before" | "pending" | "enraged";
  readonly counterKind: string | null;
}

export interface BattleUnitViewModel {
  readonly unit: BattleUnitStateV1;
  readonly unitId: string;
  readonly slot: number;
  readonly position: BattleSlotPosition;
  readonly alive: boolean;
  readonly isCurrentActor: boolean;
}

export interface BattleIntentViewModel {
  readonly intentId: string;
  readonly sourceUnitId: string;
  readonly skillId: string;
  readonly targetStrategy: EnemyTargetStrategy;
  readonly declaredRound: number;
  readonly delayed: boolean;
  readonly counterKind: string | null;
}

export interface BattleBossViewModel {
  readonly phaseThresholdBps: readonly number[];
  readonly enrage: { readonly state: "before" | "pending" | "enraged"; readonly round: number };
  readonly intent: BattleIntentViewModel | null;
}

export interface BattleViewModel {
  readonly battleId: string;
  readonly phase: BattleSnapshotV1["phase"];
  readonly outcome: BattleSnapshotV1["outcome"];
  readonly round: number;
  readonly party: readonly BattleUnitViewModel[];
  readonly enemies: readonly BattleUnitViewModel[];
  readonly timeline: readonly BattleUnitViewModel[];
  readonly boss: BattleBossViewModel | null;
}

export interface BattleViewOptions {
  readonly snapshot: Readonly<BattleSnapshotV1>;
  readonly boss?: BattleBossProjectionOptions;
}

function positionFor(unit: BattleUnitStateV1): BattleSlotPosition {
  const positions = unit.faction === "party" ? PARTY_SLOT_POSITIONS : ENEMY_SLOT_POSITIONS;
  return positions[unit.slot] ?? positions[0];
}

function unitView(unit: BattleUnitStateV1, currentUnitId: string | null): BattleUnitViewModel {
  return Object.freeze({
    unit,
    unitId: unit.unitId,
    slot: unit.slot,
    position: positionFor(unit),
    alive: unit.currentHp > 0,
    isCurrentActor: unit.unitId === currentUnitId,
  });
}

function targetRuleFromEvent(skillId: string): TargetRule | null {
  // 事件只保存结构化 skillId，View 不根据名称推断技能目标规则；没有注入定义时保持 null。
  void skillId;
  return null;
}

export class BattleView {
  private snapshot: Readonly<BattleSnapshotV1>;
  private readonly bossOptions: BattleBossProjectionOptions | undefined;

  public constructor(options: BattleViewOptions) {
    this.snapshot = options.snapshot;
    this.bossOptions = options.boss;
  }

  public setSnapshot(snapshot: Readonly<BattleSnapshotV1>): void {
    this.snapshot = snapshot;
  }

  public project(): BattleViewModel {
    const party = this.snapshot.units
      .filter((unit) => unit.faction === "party")
      .map((unit) => unitView(unit, this.snapshot.currentUnitId));
    const enemies = this.snapshot.units
      .filter((unit) => unit.faction === "enemy")
      .map((unit) => unitView(unit, this.snapshot.currentUnitId));
    const byId = new Map(this.snapshot.units.map((unit) => [unit.unitId, unit]));
    const timeline = this.snapshot.initiativeQueueUnitIds
      .map((unitId) => byId.get(unitId))
      .filter((unit): unit is BattleUnitStateV1 => unit !== undefined)
      .map((unit) => unitView(unit, this.snapshot.currentUnitId));

    const boss = this.bossOptions
      ? this.projectBoss()
      : null;
    return Object.freeze({
      battleId: this.snapshot.battleId,
      phase: this.snapshot.phase,
      outcome: this.snapshot.outcome,
      round: this.snapshot.round,
      party: Object.freeze(party),
      enemies: Object.freeze(enemies),
      timeline: Object.freeze(timeline),
      boss,
    });
  }

  private projectBoss(): BattleBossViewModel {
    const options = this.bossOptions!;
    const pending = this.snapshot.pendingBossIntents[0] ?? null;
    const intent = pending
      ? Object.freeze({
        intentId: pending.intentId,
        sourceUnitId: pending.sourceUnitId,
        skillId: pending.skillId,
        targetStrategy: pending.targetStrategy,
        declaredRound: pending.declaredRound,
        delayed: this.snapshot.round > pending.declaredRound,
        counterKind: options.counterKind,
      })
      : null;
    return Object.freeze({
      phaseThresholdBps: Object.freeze([...options.phaseThresholdBps]),
      enrage: Object.freeze({ state: options.enrageState, round: options.enrageRound }),
      intent,
    });
  }

  /** 只用于结构化调试，不能由字符串推断目标规则。 */
  public getStructuredTargetRule(skillId: string): TargetRule | null {
    return targetRuleFromEvent(skillId);
  }
}
