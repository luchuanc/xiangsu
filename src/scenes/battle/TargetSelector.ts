import type { BattleSnapshotV1, TargetRule } from "../../content/contracts";
import { failure, success, type DomainResult } from "../../domain/common/DomainResult";
import { getLegalTargetUnitIds, validateTargetSelection } from "../../domain/battle/Targeting";

export interface TargetSelectionRequest {
  readonly action: "basic" | "active" | "ultimate" | "item";
  readonly skillId?: string;
  readonly targetRule: TargetRule;
  readonly requiresFrontAccess?: boolean;
}

export interface TargetSelection {
  readonly request: TargetSelectionRequest;
  readonly targetUnitIds: readonly string[];
}

/** 目标选择器只投影领域 Targeting 的候选和错误，不复制前排/嘲讽规则。 */
export class TargetSelector {
  private selection: TargetSelection | null = null;

  public get isSelecting(): boolean {
    return this.selection !== null;
  }

  public begin(request: TargetSelectionRequest): void {
    this.selection = { request, targetUnitIds: [] };
  }

  public legalTargets(snapshot: Readonly<BattleSnapshotV1>): readonly string[] {
    if (this.selection === null) return [];
    const rule = this.selection.request.targetRule;
    if (rule === "randomEnemy" || rule === "allAllies" || rule === "allEnemies") return [];
    const actorUnitId = this.currentActor(snapshot);
    if (actorUnitId === null) return [];
    const result = getLegalTargetUnitIds(
      snapshot,
      actorUnitId,
      rule,
      this.selection.request.requiresFrontAccess ?? false,
    );
    return result.ok ? result.value : [];
  }

  public select(unitId: string, snapshot: Readonly<BattleSnapshotV1>): DomainResult<TargetSelection> {
    if (this.selection === null) return failure({ code: "INVALID_TARGET", details: { reason: "UNKNOWN", targetUnitId: null } });
    const request = this.selection.request;
    const actorUnitId = this.currentActor(snapshot);
    if (actorUnitId === null) return failure({ code: "INVALID_TARGET", details: { reason: "UNKNOWN", targetUnitId: null } });
    if (request.targetRule === "randomEnemy" || request.targetRule === "allAllies" || request.targetRule === "allEnemies" || request.targetRule === "self") {
      const validation = validateTargetSelection({ snapshot, actorUnitId, targetRule: request.targetRule, requiresFrontAccess: request.requiresFrontAccess, targetUnitIds: [] });
      if (!validation.ok) return validation;
      this.selection = { request, targetUnitIds: [] };
      return success({ request, targetUnitIds: [] });
    }
    const validation = validateTargetSelection({ snapshot, actorUnitId, targetRule: request.targetRule, requiresFrontAccess: request.requiresFrontAccess, targetUnitIds: [unitId] });
    if (!validation.ok) return validation;
    this.selection = { request, targetUnitIds: [unitId] };
    return success({ request, targetUnitIds: [...this.selection.targetUnitIds] });
  }

  public confirm(snapshot: Readonly<BattleSnapshotV1>): DomainResult<TargetSelection> {
    if (this.selection === null) return failure({ code: "INVALID_TARGET", details: { reason: "UNKNOWN", targetUnitId: null } });
    const rule = this.selection.request.targetRule;
    const actorUnitId = this.currentActor(snapshot);
    if (actorUnitId === null) return failure({ code: "INVALID_TARGET", details: { reason: "UNKNOWN", targetUnitId: null } });
    const emptyTargetRule = rule === "self" || rule === "allAllies" || rule === "allEnemies" || rule === "randomEnemy";
    const targetUnitIds = emptyTargetRule ? [] : this.selection.targetUnitIds;
    const validation = validateTargetSelection({ snapshot, actorUnitId, targetRule: rule, requiresFrontAccess: this.selection.request.requiresFrontAccess, targetUnitIds });
    if (!validation.ok) return validation;
    return success({ request: this.selection.request, targetUnitIds: [...this.selection.targetUnitIds] });
  }

  public cancel(): void {
    this.selection = null;
  }

  private currentActor(snapshot: Readonly<BattleSnapshotV1>): string | null {
    return snapshot.currentUnitId ?? null;
  }
}
