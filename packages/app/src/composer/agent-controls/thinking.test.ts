import { describe, expect, it } from "vitest";
import { resolveNextThinkingOptionId } from "./thinking";

const OPTIONS = [{ id: "low" }, { id: "medium" }, { id: "high" }];

describe("resolveNextThinkingOptionId", () => {
  it("returns null when there is nothing to cycle", () => {
    expect(resolveNextThinkingOptionId({ options: [], selectedId: "low" })).toBeNull();
    expect(resolveNextThinkingOptionId({ options: [{ id: "low" }], selectedId: "low" })).toBeNull();
  });

  it("advances to the next option", () => {
    expect(resolveNextThinkingOptionId({ options: OPTIONS, selectedId: "low" })).toBe("medium");
    expect(resolveNextThinkingOptionId({ options: OPTIONS, selectedId: "medium" })).toBe("high");
  });

  it("wraps around from the last option", () => {
    expect(resolveNextThinkingOptionId({ options: OPTIONS, selectedId: "high" })).toBe("low");
  });

  it("starts from the first option when the selection is unknown", () => {
    expect(resolveNextThinkingOptionId({ options: OPTIONS, selectedId: null })).toBe("medium");
    expect(resolveNextThinkingOptionId({ options: OPTIONS, selectedId: undefined })).toBe("medium");
    expect(resolveNextThinkingOptionId({ options: OPTIONS, selectedId: "gone" })).toBe("medium");
  });
});
