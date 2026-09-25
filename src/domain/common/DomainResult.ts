/** 领域错误码必须与数据契约保持一一对应，不提供别名或兜底错误。 */
export type DomainErrorCode =
  | "INVALID_CONTENT"
  | "UNSUPPORTED_SAVE_VERSION"
  | "STALE_REVISION"
  | "STALE_BATTLE_REVISION"
  | "INVALID_PARTY"
  | "CHARACTER_ALREADY_RECRUITED"
  | "RECRUITMENT_LOCKED"
  | "INSUFFICIENT_GOLD"
  | "NOT_IN_TOWN"
  | "NPC_LOCKED"
  | "FLOOR_LOCKED"
  | "EXPEDITION_MODE_LOCKED"
  | "ABYSS_ECHO_LOCKED"
  | "INVALID_BATTLE_PHASE"
  | "NOT_CURRENT_ACTOR"
  | "SKILL_LOCKED"
  | "SKILL_ON_COOLDOWN"
  | "INSUFFICIENT_ENERGY"
  | "INVALID_TARGET"
  | "FORMATION_BLOCKED"
  | "RETREAT_FORBIDDEN"
  | "INVENTORY_FULL"
  | "OVERFLOW_NOT_EMPTY"
  | "ITEM_NOT_OWNED"
  | "ITEM_USE_FORBIDDEN"
  | "ITEM_LOCKED"
  | "ITEM_EQUIPPED"
  | "WEAPON_NOT_ALLOWED"
  | "SKILL_LOCKED_BY_LEVEL"
  | "SKILL_LEVEL_MAX"
  | "INSUFFICIENT_SKILL_POINTS"
  | "AFFIX_POOL_EMPTY"
  | "AFFIX_CONFLICT"
  | "AFFIX_NOT_REFORGEABLE"
  | "REFORGE_PREVIEW_STALE"
  | "SHOP_OFFER_UNAVAILABLE"
  | "BUYBACK_UNAVAILABLE"
  | "STACKABLE_CAP_EXCEEDED"
  | "REWARD_ALREADY_CLAIMED"
  | "SAVE_FAILED"
  | "ASSET_LOAD_FAILED";

export type BattlePhase =
  | "INIT"
  | "ROUND_START"
  | "TURN_START"
  | "AWAIT_COMMAND"
  | "AI_DECIDE"
  | "VALIDATE"
  | "DRAIN_PRE_ACTION"
  | "RESOLVE_ACTION"
  | "DRAIN_TRIGGERS"
  | "TURN_END"
  | "ROUND_END"
  | "VICTORY"
  | "DEFEAT"
  | "RETREAT"
  | "REWARD_PENDING"
  | "COMPLETE";

export type WeaponType =
  | "sword"
  | "hammer"
  | "bow"
  | "staff"
  | "focus"
  | "relic";

export const DOMAIN_ERROR_CODES: readonly DomainErrorCode[] = [
  "INVALID_CONTENT",
  "UNSUPPORTED_SAVE_VERSION",
  "STALE_REVISION",
  "STALE_BATTLE_REVISION",
  "INVALID_PARTY",
  "CHARACTER_ALREADY_RECRUITED",
  "RECRUITMENT_LOCKED",
  "INSUFFICIENT_GOLD",
  "NOT_IN_TOWN",
  "NPC_LOCKED",
  "FLOOR_LOCKED",
  "EXPEDITION_MODE_LOCKED",
  "ABYSS_ECHO_LOCKED",
  "INVALID_BATTLE_PHASE",
  "NOT_CURRENT_ACTOR",
  "SKILL_LOCKED",
  "SKILL_ON_COOLDOWN",
  "INSUFFICIENT_ENERGY",
  "INVALID_TARGET",
  "FORMATION_BLOCKED",
  "RETREAT_FORBIDDEN",
  "INVENTORY_FULL",
  "OVERFLOW_NOT_EMPTY",
  "ITEM_NOT_OWNED",
  "ITEM_USE_FORBIDDEN",
  "ITEM_LOCKED",
  "ITEM_EQUIPPED",
  "WEAPON_NOT_ALLOWED",
  "SKILL_LOCKED_BY_LEVEL",
  "SKILL_LEVEL_MAX",
  "INSUFFICIENT_SKILL_POINTS",
  "AFFIX_POOL_EMPTY",
  "AFFIX_CONFLICT",
  "AFFIX_NOT_REFORGEABLE",
  "REFORGE_PREVIEW_STALE",
  "SHOP_OFFER_UNAVAILABLE",
  "BUYBACK_UNAVAILABLE",
  "STACKABLE_CAP_EXCEEDED",
  "REWARD_ALREADY_CLAIMED",
  "SAVE_FAILED",
  "ASSET_LOAD_FAILED",
];

export interface DomainErrorDetailsByCode {
  INVALID_CONTENT: { path: string; issueKey: string };
  UNSUPPORTED_SAVE_VERSION: { schemaVersion: number; contentVersion: string };
  STALE_REVISION: { expectedRevision: number; actualRevision: number };
  STALE_BATTLE_REVISION: { expectedRevision: number; actualRevision: number };
  INVALID_PARTY: {
    reason:
      | "EMPTY"
      | "PROTAGONIST_REQUIRED"
      | "DUPLICATE_CHARACTER"
      | "UNKNOWN_CHARACTER"
      | "NOT_RECRUITED"
      | "ALL_DEFEATED";
    characterId: string | null;
  };
  CHARACTER_ALREADY_RECRUITED: { characterId: string };
  RECRUITMENT_LOCKED: { recruitmentId: string };
  INSUFFICIENT_GOLD: { required: number; owned: number };
  NOT_IN_TOWN: null;
  NPC_LOCKED: { npcId: string; lockReasonKey: string };
  FLOOR_LOCKED: { floorNumber: number };
  EXPEDITION_MODE_LOCKED: {
    mode: "shortFarm" | "bossRetry";
    floorId: string;
    reason: "FLOOR_NOT_CLEARED" | "BOSS_NOT_CONTACTED" | "BOSS_ALREADY_CLEARED";
  };
  ABYSS_ECHO_LOCKED: {
    echoId: string;
    reason: "STORY_NOT_COMPLETED" | "NO_CHARGE";
  };
  INVALID_BATTLE_PHASE: { expected: BattlePhase[]; actual: BattlePhase };
  NOT_CURRENT_ACTOR: { actorUnitId: string; currentUnitId: string | null };
  SKILL_LOCKED: { skillId: string };
  SKILL_ON_COOLDOWN: { skillId: string; remainingTurns: number };
  INSUFFICIENT_ENERGY: { required: number; owned: number };
  INVALID_TARGET: {
    reason: "COUNT" | "DEAD" | "FULL_HP" | "WRONG_FACTION" | "UNKNOWN" | "TAUNTED";
    targetUnitId: string | null;
  };
  FORMATION_BLOCKED: { targetUnitId: string };
  RETREAT_FORBIDDEN: null;
  INVENTORY_FULL: {
    kind: "equipment" | "skillStone" | "overflow";
    requiredSlots: number;
    availableSlots: number;
  };
  OVERFLOW_NOT_EMPTY: { count: number };
  ITEM_NOT_OWNED: { instanceId: string | null; itemId: string | null };
  ITEM_USE_FORBIDDEN: {
    itemId: string;
    reason: "NOT_IN_EXPEDITION" | "BATTLE_ACTIVE" | "WRONG_CONTEXT" | "ECHO_LIMIT";
  };
  ITEM_LOCKED: { instanceId: string };
  ITEM_EQUIPPED: { instanceId: string };
  WEAPON_NOT_ALLOWED: { characterId: string; weaponType: WeaponType };
  SKILL_LOCKED_BY_LEVEL: {
    skillId: string;
    unlockLevel: number;
    characterLevel: number;
  };
  SKILL_LEVEL_MAX: { skillId: string };
  INSUFFICIENT_SKILL_POINTS: { required: number; owned: number };
  AFFIX_POOL_EMPTY: {
    poolKind:
      | "equipmentNormal"
      | "equipmentAbyss"
      | "skillStoneNormal"
      | "skillStoneAbyss";
    itemLevel: number;
  };
  AFFIX_CONFLICT: { exclusiveGroup: string; sourceIds: string[] };
  AFFIX_NOT_REFORGEABLE: {
    instanceId: string;
    reason: "ABYSS_SLOT" | "WRONG_LOCKED_INDEX" | "LOCKED_ITEM" | "EQUIPPED_ITEM";
  };
  REFORGE_PREVIEW_STALE: {
    expectedReforgeCount: number;
    actualReforgeCount: number;
  };
  SHOP_OFFER_UNAVAILABLE: { offerId: string };
  BUYBACK_UNAVAILABLE: { sequence: number };
  STACKABLE_CAP_EXCEEDED: {
    itemId: string;
    cap: 9999;
    owned: number;
    requested: number;
  };
  REWARD_ALREADY_CLAIMED: { transactionId: string };
  SAVE_FAILED: { operation: "create" | "load" | "save" | "replace" };
  ASSET_LOAD_FAILED: { bundleId: string; attempts: 3 };
}

export type DomainErrorV1 = {
  [Code in DomainErrorCode]: {
    code: Code;
    details: DomainErrorDetailsByCode[Code];
  };
}[DomainErrorCode];

export type DomainSuccess<T> = { readonly ok: true; readonly value: T };
export type DomainFailure = { readonly ok: false; readonly error: DomainErrorV1 };
export type DomainResult<T> = DomainSuccess<T> | DomainFailure;

/** 构造严格的领域错误联合，不接受未知 code 或模糊 details。 */
export function createDomainError<Code extends DomainErrorCode>(
  code: Code,
  details: DomainErrorDetailsByCode[Code],
): DomainErrorV1 {
  if (!DOMAIN_ERROR_CODES.includes(code)) {
    throw new RangeError(`未知领域错误码: ${String(code)}`);
  }

  return { code, details } as DomainErrorV1;
}

export function success<T>(value: T): DomainSuccess<T> {
  return { ok: true, value };
}

export function failure(error: DomainErrorV1): DomainFailure {
  return { ok: false, error };
}

export function isSuccess<T>(result: DomainResult<T>): result is DomainSuccess<T> {
  return result.ok;
}

export function isFailure<T>(result: DomainResult<T>): result is DomainFailure {
  return !result.ok;
}
