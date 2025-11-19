import { describe, expect, it } from "bun:test";
import { normalizeIngredientName } from "../../src/normalizers/ingredient-normalizer.js";

describe("normalizeIngredientName", () => {
  it("removes parenthetical content", () => {
    const result = normalizeIngredientName("butter (salted or unsalted)");
    expect(result.baseName).not.toContain("(");
    expect(result.baseName).not.toContain(")");
    expect(result.descriptors).toContain("salted or unsalted");
  });

  it("removes descriptor phrases", () => {
    const result = normalizeIngredientName("chopped onion");
    expect(result.baseName).not.toContain("chopped");
    expect(result.descriptors).toContain("chopped");
  });

  it("singularizes tokens", () => {
    const result = normalizeIngredientName("carrots");
    expect(result.tokens).toContain("carrot");
    expect(result.tokens).not.toContain("carrots");
  });

  it("handles multiple descriptors", () => {
    const result = normalizeIngredientName(
      "2 cups finely chopped fresh parsley"
    );
    expect(result.descriptors.length).toBeGreaterThan(0);
    expect(result.descriptors).toContain("chopped");
    // "fresh" is not in DESCRIPTORS list, so it remains in baseName
    expect(result.baseName).toContain("parsley");
  });

  it("removes punctuation", () => {
    const result = normalizeIngredientName("olive oil, extra virgin");
    expect(result.baseName).not.toContain(",");
  });

  it("handles empty input", () => {
    const result = normalizeIngredientName("");
    expect(result.baseName).toBe("");
    expect(result.tokens).toEqual([]);
    expect(result.descriptors).toEqual([]);
  });

  it("handles complex ingredient names", () => {
    const result = normalizeIngredientName(
      "chicken breast (boneless, skinless), sliced"
    );
    expect(result.baseName).toContain("chicken");
    expect(result.baseName).toContain("breast");
    expect(result.descriptors.length).toBeGreaterThan(0);
  });
});
