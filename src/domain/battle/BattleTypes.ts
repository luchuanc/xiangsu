/**
 * 战斗领域的输入、快照和纯 reducer 事件类型。
 *
 * 这些类型只描述战斗创建和回合队列所需的最小依赖，不把 Pixi、存档事务
 * 或伤害结算塞进战斗核心。所有外部内容都必须通过显式 getter 注入。
 */
import type {
  BattleSnapshotV1,
  BattleUnitStateV1,
  CharacterDefinition,
  CharacterId,
  CharacterProgressV1,
  ComboId,
  EncounterDefinition,
  EnemyDefinition,
  ExpeditionSnapshotV1,
  MapDefinition,
  MapObjectDefinition,
  PartyStateV1,
  SkillDefinition,
  StatBlock,
  StatusDefinition,
} from "../../content/contracts";
import type { DomainResult } from "../common/DomainResult";
import type { RngState } from "../common/SeededRng";

/** BattleFactory 只要求内容源提供本卡明确使用的 getter。 */
export interface BattleContentSource {
  getCharacter(id: CharacterId): DomainResult<Readonly<CharacterDefinition>>;
  getSkill(id: string): DomainResult<Readonly<SkillDefinition>>;
  getEnemy(id: string): DomainResult<Readonly<EnemyDefinition>>;
  getEncounter(id: string): DomainResult<Readonly<EncounterDefinition>>;
  getMap(id: string): DomainResult<Readonly<MapDefinition>>;
  getStatus?(id: string): DomainResult<Readonly<StatusDefinition>>;
}

/** 入战静态属性的三个互相可核验快照。 */
export interface BattleStatBaseline {
  readonly prePercentStats: StatBlock;
  readonly staticPercentByStatBps: Record<keyof StatBlock, number>;
  readonly stats: StatBlock;
}

export type CharacterBaselineResolver = (
  character: Readonly<CharacterDefinition>,
  progress: Readonly<CharacterProgressV1>,
) => DomainResult<BattleStatBaseline>;

export type EnemyBaselineResolver = (
  enemy: Readonly<EnemyDefinition>,
  slot: number,
) => DomainResult<BattleStatBaseline>;

export type EncounterMapObject = Extract<MapObjectDefinition, { kind: "encounter" }>;

/** 创建战斗快照所需的全部显式输入。 */
export interface BattleFactoryInput {
  readonly battleId: string;
  readonly expedition: Readonly<ExpeditionSnapshotV1>;
  readonly map: Readonly<MapDefinition>;
  readonly encounter: Readonly<EncounterDefinition>;
  readonly encounterObject: Readonly<EncounterMapObject>;
  readonly party: Readonly<PartyStateV1>;
  readonly characters: Readonly<Record<CharacterId, Readonly<CharacterProgressV1>>>;
  readonly returnMapId: string;
  readonly returnSafePosition: Readonly<{ x: number; y: number }>;
  /** 内容侧 Combo ID 的快照；战斗指标按该数组原顺序建立 key。 */
  readonly comboIds: readonly ComboId[];
  /** 二选一；SeededRng 只读取 state，不在创建阶段推进随机流。 */
  readonly rngState?: RngState;
  readonly rng?: { getState(): RngState };
  readonly calculateCharacterBaseline?: CharacterBaselineResolver;
  readonly calculateEnemyBaseline?: EnemyBaselineResolver;
}

export interface BattleFactoryOptions {
  readonly calculateCharacterBaseline?: CharacterBaselineResolver;
  readonly calculateEnemyBaseline?: EnemyBaselineResolver;
}

/** 每轮固定的速度读取结果；队列建立后不得由 SPEED_CHANGED 重排。 */
export interface InitiativeSnapshot {
  readonly queueUnitIds: readonly string[];
  readonly speedByUnitId: Readonly<Record<string, number>>;
}

/** 纯 reducer 接收的有限事件集合。 */
export type BattleReducerEvent =
  | { readonly type: "ROUND_START" }
  | { readonly type: "TURN_START" }
  | { readonly type: "COMMAND_VALID" }
  | { readonly type: "COMMAND_INVALID" }
  | { readonly type: "DRAIN_PRE_ACTION_COMPLETE" }
  | { readonly type: "RESOLVE_ACTION_COMPLETE" }
  | { readonly type: "DRAIN_TRIGGERS_COMPLETE" }
  | { readonly type: "TURN_END" }
  | { readonly type: "ROUND_END" }
  | { readonly type: "UNIT_DEFEATED"; readonly unitId: string }
  | {
      readonly type: "UNIT_SUMMONED";
      readonly unit: BattleUnitStateV1;
    }
  | {
      readonly type: "UNIT_SUMMONED";
      readonly enemyId: string;
      readonly preferredSlots: readonly number[];
      readonly maxAliveCopies: number;
    }
  | {
      readonly type: "UNIT_SUMMONED";
      readonly enemy: Readonly<EnemyDefinition>;
      readonly preferredSlots: readonly number[];
      readonly maxAliveCopies: number;
    }
  | { readonly type: "SPEED_CHANGED"; readonly unitId: string; readonly speed: number }
  | { readonly type: "RETREAT" };

export type SummonedUnitResolver = (
  enemy: Readonly<EnemyDefinition>,
  slot: number,
  eligibleRound: number,
) => DomainResult<BattleUnitStateV1>;

export interface BattleReducerOptions {
  readonly getEnemy?: (id: string) => DomainResult<Readonly<EnemyDefinition>>;
  readonly getStatus?: (id: string) => DomainResult<Readonly<StatusDefinition>>;
  readonly isSkipTurnStatus?: (status: Readonly<BattleUnitStateV1["statuses"][number]>) => boolean;
  readonly resolveSummonedUnit?: SummonedUnitResolver;
}

export type BattleReductionResult = DomainResult<BattleSnapshotV1>;

/** 复制入战快照，保证外层调用方不会拿到 reducer 内部可变引用。 */
export function cloneBattleSnapshot(snapshot: BattleSnapshotV1): BattleSnapshotV1 {
  return structuredClone(snapshot);
}
