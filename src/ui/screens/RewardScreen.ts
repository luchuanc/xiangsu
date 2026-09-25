import type { DomainResult } from "../../domain/common/DomainResult";

export type RewardScreenStatus = "empty" | "loading" | "error" | "success";

export interface RewardPreviewItem {
  readonly id: string;
  readonly quality: "common" | "magic" | "rare" | "epic" | "abyss";
  readonly breakthrough?: "breakthrough" | "counter" | "combo" | null;
}

export interface RewardPreview {
  readonly transactionId: string;
  readonly keyItems?: readonly RewardPreviewItem[];
  readonly gold?: number;
  readonly xp?: number;
  readonly stackableCapConversions?: readonly { itemId: string; quantity: number; gold: number }[];
}

export interface RewardScreenState {
  readonly status: RewardScreenStatus;
  readonly reward: RewardPreview | null;
  readonly error: unknown | null;
  readonly claimed: boolean;
  readonly cardDelayMs: readonly number[];
}

export interface RewardClaimResult {
  readonly ok: boolean;
  readonly error?: unknown;
}

export interface RewardScreenOptions {
  readonly claim: () => Promise<RewardClaimResult | DomainResult<unknown>>;
  readonly onReturn?: () => void;
}

function isSuccess(value: RewardClaimResult | DomainResult<unknown>): boolean {
  return value.ok;
}

/** 战利品页只管理展示状态和领取事务结果，不改写奖励领域对象。 */
export class RewardScreen {
  private readonly claimOperation: () => Promise<RewardClaimResult | DomainResult<unknown>>;
  private readonly onReturn?: () => void;
  private value: RewardPreview | null = null;
  private statusValue: RewardScreenStatus = "empty";
  private errorValue: unknown | null = null;
  private claimedValue = false;
  private claimInFlight: Promise<RewardClaimResult> | null = null;

  public constructor(options: RewardScreenOptions) {
    this.claimOperation = options.claim;
    this.onReturn = options.onReturn;
  }

  public get state(): RewardScreenState {
    const qualities = this.value?.keyItems?.map((item) => item.quality) ?? [];
    return Object.freeze({
      status: this.statusValue,
      reward: this.value,
      error: this.errorValue,
      claimed: this.claimedValue,
      cardDelayMs: Object.freeze(qualities.map((quality) => quality === "rare" ? 350 : quality === "epic" ? 500 : quality === "abyss" ? 700 : 0)),
    });
  }

  public setReward(reward: RewardPreview): void {
    if (!reward || typeof reward.transactionId !== "string" || reward.transactionId.length === 0) throw new TypeError("reward.transactionId 必须存在");
    this.value = structuredClone(reward);
    this.statusValue = "success";
    this.errorValue = null;
    this.claimedValue = false;
  }

  public setLoading(): void {
    this.statusValue = "loading";
    this.errorValue = null;
  }

  public claimReward(): Promise<RewardClaimResult> {
    if (this.claimedValue) return Promise.resolve({ ok: true });
    if (this.value === null) return Promise.resolve({ ok: false, error: "REWARD_EMPTY" });
    if (this.claimInFlight !== null) return this.claimInFlight;
    this.setLoading();
    const operation = this.claimOnce();
    this.claimInFlight = operation;
    // 成功和失败都释放锁；失败保留 reward/error，由下一次点击重试。
    void operation.then(() => {
      if (this.claimInFlight === operation) this.claimInFlight = null;
    });
    return operation;
  }

  private async claimOnce(): Promise<RewardClaimResult> {
    try {
      const result = await this.claimOperation();
      if (!isSuccess(result)) {
        this.statusValue = "error";
        this.errorValue = "error" in result ? result.error : result;
        return { ok: false, error: this.errorValue };
      }
      this.claimedValue = true;
      this.statusValue = "success";
      this.errorValue = null;
      return { ok: true };
    } catch (error) {
      this.statusValue = "error";
      this.errorValue = error;
      return { ok: false, error };
    }
  }

  public returnToMap(): void {
    if (!this.claimedValue) return;
    this.onReturn?.();
  }
}
