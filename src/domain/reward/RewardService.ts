/**
 * 奖励事务的严格 dry-run 与幂等提交骨架。
 *
 * 这里不直接写 GameStore/SaveCoordinator：调用方把 dry-run 通过后的完整
 * 候选接入同一 revision 事务。库存、金币、经验和进度因此可以保持全有
 * 或全无，重复 transactionId 也不会重放资产。
 */
import type {
  BattleSnapshotV1,
  CharacterProgressV1,
  InventoryStateV1,
  RewardTransactionV1,
  StackableItemDefinition,
} from "../../content/contracts";
import { createDomainError, failure, success, type DomainResult } from "../common/DomainResult";
import { dryRunReceive, type InventoryDryRun } from "../inventory/Inventory";

export interface RewardContentSource {
  getItem(id: string): DomainResult<Readonly<StackableItemDefinition>>;
}

export interface RewardDryRunValue {
  readonly reward: RewardTransactionV1;
  readonly inventory: InventoryStateV1;
  readonly placements: InventoryDryRun["placements"];
}

export interface RewardClaimValue extends RewardDryRunValue {
  readonly claimedRewardTransactionIds: readonly string[];
}

export interface RewardDryRunInput {
  readonly inventory: Readonly<InventoryStateV1>;
  readonly reward: Readonly<RewardTransactionV1>;
  readonly content: RewardContentSource;
}

export interface RewardClaimInput extends RewardDryRunInput {
  readonly claimedRewardTransactionIds: readonly string[];
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function sourceShape(source: RewardTransactionV1["source"]): DomainResult<true> {
  if (!source || typeof source !== "object") return invalid("reward.source", "object_required");
  const keys = Object.keys(source).sort().join(",");
  if (source.kind === "encounter" && keys === "encounterId,kind,mapId,objectId" && [source.encounterId, source.mapId, source.objectId].every((value) => typeof value === "string" && value.length > 0)) return success(true);
  if (source.kind === "chest" && keys === "dropTableId,kind,mapId,objectId" && [source.mapId, source.objectId, source.dropTableId].every((value) => typeof value === "string" && value.length > 0)) return success(true);
  if (source.kind === "abyssEcho" && keys === "echoId,encounterId,kind" && [source.echoId, source.encounterId].every((value) => typeof value === "string" && value.length > 0)) return success(true);
  return invalid("reward.source", "strict_source");
}

function getItem(content: RewardContentSource, itemId: string): DomainResult<Readonly<StackableItemDefinition>> {
  try {
    const result = content.getItem(itemId);
    if (!result.ok) return result;
    if (result.value.id !== itemId) return invalid(`items.${itemId}`, "id_mismatch");
    return result;
  } catch {
    return invalid(`items.${itemId}`, "getter_failed");
  }
}

function validateReward(reward: Readonly<RewardTransactionV1>): DomainResult<true> {
  if (!reward || typeof reward.transactionId !== "string" || reward.transactionId.length === 0) return invalid("reward.transactionId", "required");
  const source = sourceShape(reward.source);
  if (!source.ok) return source;
  if (!Number.isSafeInteger(reward.gold) || reward.gold < 0 || !Number.isSafeInteger(reward.xp) || reward.xp < 0) return invalid("reward", "non_negative_integer");
  if (!reward.stackables || typeof reward.stackables !== "object" || Array.isArray(reward.stackables)) return invalid("reward.stackables", "object_required");
  if (!Array.isArray(reward.equipment) || !Array.isArray(reward.skillStones) || !Array.isArray(reward.instanceOrder)) return invalid("reward.instances", "array_required");
  if (reward.source.kind === "chest" && (reward.gold !== 0 || reward.xp !== 0)) return invalid("reward", "chest_zero_reward");
  if (reward.claimed) return failure(createDomainError("REWARD_ALREADY_CLAIMED", { transactionId: reward.transactionId }));
  return success(true);
}

function normalizeReward(
  inventory: Readonly<InventoryStateV1>,
  reward: Readonly<RewardTransactionV1>,
  content: RewardContentSource,
): DomainResult<RewardTransactionV1> {
  const validated = validateReward(reward);
  if (!validated.ok) return validated;
  const next: RewardTransactionV1 = structuredClone(reward);
  // LootGenerator 已把转换固化在候选中；重载/重试时只校验并保留，不按后来库存重算。
  if (next.stackableCapConversions.length > 0) {
    const ids = new Set<string>();
    for (const conversion of next.stackableCapConversions) {
      if (ids.has(conversion.itemId) || !Number.isSafeInteger(conversion.quantity) || conversion.quantity <= 0 || !Number.isSafeInteger(conversion.gold) || conversion.gold < 0) return invalid("reward.stackableCapConversions", "row_shape");
      ids.add(conversion.itemId);
      const item = getItem(content, conversion.itemId);
      if (!item.ok) return item;
      if (conversion.gold !== conversion.quantity * item.value.baseGoldValue) return invalid(`reward.stackableCapConversions.${conversion.itemId}`, "gold_formula");
    }
    return success(next);
  }
  const stackables: Record<string, number> = {};
  const conversions: RewardTransactionV1["stackableCapConversions"] = [];
  let gold = next.gold;
  for (const [itemId, requested] of Object.entries(next.stackables)) {
    if (!Number.isSafeInteger(requested) || requested < 0) return invalid(`reward.stackables.${itemId}`, "quantity_range");
    const item = getItem(content, itemId);
    if (!item.ok) return item;
    const owned = inventory.stackables[itemId] ?? 0;
    if (!Number.isSafeInteger(owned) || owned < 0 || owned > 9_999) return invalid(`inventory.stackables.${itemId}`, "quantity_range");
    const accepted = Math.min(requested, 9_999 - owned);
    const overflow = requested - accepted;
    if (accepted > 0) stackables[itemId] = accepted;
    if (overflow > 0) {
      const convertedGold = overflow * item.value.baseGoldValue;
      gold += convertedGold;
      conversions.push({ itemId, quantity: overflow, gold: convertedGold });
    }
  }
  next.stackables = stackables;
  next.stackableCapConversions = conversions;
  next.gold = gold;
  return success(next);
}

/** 只执行奖励库存 dry-run，不修改传入 inventory/reward。 */
export function dryRunReward(input: RewardDryRunInput): DomainResult<RewardDryRunValue> {
  const reward = normalizeReward(input.inventory, input.reward, input.content);
  if (!reward.ok) return reward;
  const received = dryRunReceive(input.inventory, {
    equipment: reward.value.equipment,
    skillStones: reward.value.skillStones,
    stackables: reward.value.stackables,
    instanceOrder: reward.value.instanceOrder,
  });
  if (!received.ok) return received;
  return success({ reward: reward.value, inventory: received.value.inventory, placements: received.value.placements });
}

/** 同一 transactionId 只能成功追加一次 claimed ID；失败不修改任何资产。 */
export function claimReward(input: RewardClaimInput): DomainResult<RewardClaimValue> {
  if (!Array.isArray(input.claimedRewardTransactionIds)) return invalid("claimedRewardTransactionIds", "array_required");
  if (input.claimedRewardTransactionIds.some((id) => typeof id !== "string" || id.length === 0) || new Set(input.claimedRewardTransactionIds).size !== input.claimedRewardTransactionIds.length) return invalid("claimedRewardTransactionIds", "unique_ids");
  if (input.claimedRewardTransactionIds.includes(input.reward.transactionId)) return failure(createDomainError("REWARD_ALREADY_CLAIMED", { transactionId: input.reward.transactionId }));
  const dryRun = dryRunReward(input);
  if (!dryRun.ok) return dryRun;
  const claimed = [...input.claimedRewardTransactionIds, input.reward.transactionId];
  while (claimed.length > 100) claimed.shift();
  return success({ ...dryRun.value, reward: { ...dryRun.value.reward, claimed: true }, claimedRewardTransactionIds: claimed });
}

export function determineBattleOutcome(snapshot: Readonly<BattleSnapshotV1>): BattleSnapshotV1["outcome"] {
  const partyAlive = snapshot.units.some((unit) => unit.faction === "party" && unit.currentHp > 0);
  const enemyAlive = snapshot.units.some((unit) => unit.faction === "enemy" && unit.currentHp > 0);
  if (!partyAlive) return "defeat";
  if (!enemyAlive) return "victory";
  return "ongoing";
}

export function createCompleteSentinel(input: { readonly snapshot: Readonly<BattleSnapshotV1>; readonly outcome?: Exclude<BattleSnapshotV1["outcome"], "ongoing"> }): DomainResult<BattleSnapshotV1> {
  const outcome = input.outcome ?? determineBattleOutcome(input.snapshot);
  if (outcome === "ongoing") return invalid("battle.outcome", "still_ongoing");
  const next = structuredClone(input.snapshot) as BattleSnapshotV1;
  next.phase = "COMPLETE";
  next.outcome = outcome;
  next.pendingEvents = [];
  // 终局哨兵不能保留任何待释放 Boss 意图；cleanup 只负责移除哨兵，不能再次触发意图。
  next.pendingBossIntents = [];
  return success(next);
}

/** COMPLETE cleanup 不承担结算，只把已完成战斗移除；重复调用保持同一空结果。 */
export function cleanupComplete(snapshot: Readonly<BattleSnapshotV1>): DomainResult<null> {
  if (snapshot.phase !== "COMPLETE") return invalid("battle.phase", "complete_required");
  return success(null);
}

/** 战败恢复骨架：所有已招募角色先获得 1 HP，再由调用方执行本次升级 maxHp 变更。 */
export function reviveRecruitedForDefeat(
  characters: Readonly<Record<string, CharacterProgressV1>>,
  recruitedCharacterIds: readonly string[],
): DomainResult<Record<string, CharacterProgressV1>> {
  const next = structuredClone(characters);
  for (const characterId of recruitedCharacterIds) {
    const character = next[characterId];
    if (!character || !character.recruited) return invalid(`characters.${characterId}`, "recruited_required");
    character.currentHp = 1;
  }
  return success(next);
}

export class RewardService {
  public dryRun(input: RewardDryRunInput): DomainResult<RewardDryRunValue> { return dryRunReward(input); }
  public claim(input: RewardClaimInput): DomainResult<RewardClaimValue> { return claimReward(input); }
}
