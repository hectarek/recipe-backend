import { describe, expect, it } from "bun:test";
import { parseIngredient } from "../../src/parsers/ingredient-parser.js";

describe("parseIngredient", () => {
  it("parses mixed fraction quantity with unit", () => {
    const result = parseIngredient("1 1/2 cups chopped carrots");
    expect(result.qty).toBeCloseTo(1.5);
    expect(result.unit).toBe("cup");
    expect(result.name).toBe("carrots");
  });

  it("parses unicode fraction quantities", () => {
    const result = parseIngredient("½ tsp salt");
    expect(result.qty).toBeCloseTo(0.5);
    expect(result.unit).toBe("tsp");
    expect(result.name).toBe("salt");
  });

  it("handles descriptors and commas", () => {
    const result = parseIngredient("2 tbsp butter, melted");
    expect(result.qty).toBe(2);
    expect(result.unit).toBe("tbsp");
    expect(result.name).toBe("butter");
  });

  it("returns null quantity when none present", () => {
    const result = parseIngredient("Salt to taste");
    expect(result.qty).toBeNull();
    expect(result.unit).toBeNull();
    expect(result.name.toLowerCase()).toBe("salt");
  });
});
