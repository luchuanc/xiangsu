import { describe, expect, it } from "vitest";

import { createComboPreview, type ComboMatchResult } from "../../src/domain/combo/ComboPreview";

function result(scope: "personal" | "party", matchedComboIds: readonly string[]): ComboMatchResult {
  return {
    scope,
    matchedComboIds,
    tagContributions: [],
    diagnostics: [],
  };
}

describe("ComboPreview", () => {
  it("输出稳定、去重的新增/失去/不变集合", () => {
    const preview = createComboPreview(
      result("personal", ["combo_z", "combo_a", "combo_a"]),
      result("personal", ["combo_b", "combo_z", "combo_b"]),
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value).toEqual({
      scope: "personal",
      addedIds: ["combo_b"],
      removedIds: ["combo_a"],
      unchangedIds: ["combo_z"],
    });
  });

  it("不修改 before/after，作用域不一致时拒绝", () => {
    const before = result("personal", ["combo_a"]);
    const after = result("party", ["combo_b"]);
    const beforeCopy = structuredClone(before);
    const afterCopy = structuredClone(after);
    const preview = createComboPreview(before, after);
    expect(preview).toMatchObject({ ok: false, error: { code: "INVALID_CONTENT" } });
    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });
});
