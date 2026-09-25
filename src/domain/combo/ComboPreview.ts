/**
 * Combo 变更预览。
 *
 * 预览只比较 Matcher 的结果集合，不持有也不修改角色、装备或存档快照；
 * 所有输出 ID 使用原生 UTF-16 字符串升序，保证提交前后的展示稳定。
 */
import {
  createDomainError,
  failure,
  success,
  type DomainResult,
} from "../common/DomainResult";
import type { ComboId } from "../../content/contracts";
import type { ComboMatchResult } from "./ComboMatcher";

export type { ComboMatchResult } from "./ComboMatcher";

export interface ComboPreviewResult {
  readonly scope: "personal" | "party";
  readonly addedIds: readonly ComboId[];
  readonly removedIds: readonly ComboId[];
  readonly unchangedIds: readonly ComboId[];
}

function invalid(path: string, issueKey: string): DomainResult<never> {
  return failure(createDomainError("INVALID_CONTENT", { path, issueKey }));
}

function normalizeIds(value: unknown, path: string): DomainResult<readonly ComboId[]> {
  if (!Array.isArray(value)) return invalid(path, "array_required");
  const ids = new Set<string>();
  for (const [index, id] of value.entries()) {
    if (typeof id !== "string" || id.length === 0) return invalid(`${path}[${index}]`, "id_required");
    ids.add(id);
  }
  return success([...ids].sort());
}

function checkResultShape(value: ComboMatchResult, path: string): DomainResult<true> {
  if (!value || typeof value !== "object") return invalid(path, "object_required");
  if (value.scope !== "personal" && value.scope !== "party") return invalid(`${path}.scope`, "scope_required");
  return success(true);
}

export function createComboPreview(
  before: ComboMatchResult,
  after: ComboMatchResult,
  expectedScope?: "personal" | "party",
): DomainResult<ComboPreviewResult> {
  const beforeShape = checkResultShape(before, "before");
  if (!beforeShape.ok) return beforeShape;
  const afterShape = checkResultShape(after, "after");
  if (!afterShape.ok) return afterShape;
  if (before.scope !== after.scope) return invalid("scope", "mismatch");
  if (expectedScope !== undefined && expectedScope !== before.scope) return invalid("scope", "unexpected_scope");
  const beforeIds = normalizeIds(before.matchedComboIds, "before.matchedComboIds");
  if (!beforeIds.ok) return beforeIds;
  const afterIds = normalizeIds(after.matchedComboIds, "after.matchedComboIds");
  if (!afterIds.ok) return afterIds;
  const beforeSet = new Set(beforeIds.value);
  const afterSet = new Set(afterIds.value);
  const addedIds = afterIds.value.filter((id) => !beforeSet.has(id));
  const removedIds = beforeIds.value.filter((id) => !afterSet.has(id));
  const unchangedIds = beforeIds.value.filter((id) => afterSet.has(id));
  return success(Object.freeze({
    scope: before.scope,
    addedIds: Object.freeze(addedIds),
    removedIds: Object.freeze(removedIds),
    unchangedIds: Object.freeze(unchangedIds),
  }));
}

export class ComboPreviewService {
  public create(before: ComboMatchResult, after: ComboMatchResult, expectedScope?: "personal" | "party"): DomainResult<ComboPreviewResult> {
    return createComboPreview(before, after, expectedScope);
  }
}
