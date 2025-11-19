import { describe, expect, it } from "bun:test";
import {
  parseIngredient,
  parseIngredients,
} from "../../src/parsers/ingredient-parser.js";

describe("parseIngredient", () => {
  it("parses mixed fraction quantity with unit", () => {
    const result = parseIngredient("1 1/2 cups chopped carrots");
    expect(result.qty).toBeCloseTo(1.5);
    expect(result.unit).toBe("cup");
    expect(result.name).toBe("carrot");
    expect(result.descriptors).toContain("chopped");
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
    expect(result.descriptors).toContain("melted");
  });

  it("returns null quantity when none present", () => {
    const result = parseIngredient("Salt to taste");
    expect(result.qty).toBeNull();
    expect(result.unit).toBeNull();
    expect(result.name.toLowerCase()).toBe("salt");
  });

  it("parses simple fraction", () => {
    const result = parseIngredient("1/2 cup milk");
    expect(result.qty).toBeCloseTo(0.5);
    expect(result.unit).toBe("cup");
    expect(result.name).toBe("milk");
  });

  it("parses range quantities", () => {
    const result = parseIngredient("1-2 cups flour");
    expect(result.qty).toBe(1);
    expect(result.unit).toBe("cup");
    expect(result.name).toBe("flour");
  });

  it("parses decimal quantities", () => {
    const result = parseIngredient("1.5 tsp vanilla");
    expect(result.qty).toBe(1.5);
    expect(result.unit).toBe("tsp");
    expect(result.name).toBe("vanilla");
  });

  it("handles two-word units", () => {
    const result = parseIngredient("1 olive oil");
    expect(result.qty).toBe(1);
    expect(result.unit).toBeNull(); // "olive oil" is not a recognized unit
    expect(result.name).toContain("olive");
  });

  it("handles empty string", () => {
    const result = parseIngredient("");
    expect(result.raw).toBe("");
    expect(result.name).toBe("");
  });

  it("preserves original raw string", () => {
    const raw = "1 1/2 cups chopped carrots";
    const result = parseIngredient(raw);
    expect(result.raw).toBe(raw);
  });
});

describe("parseIngredients", () => {
  it("parses multiple ingredients", () => {
    const ingredients = ["1 cup rice", "2 tbsp olive oil", "Salt to taste"];
    const results = parseIngredients(ingredients);

    expect(results).toHaveLength(3);
    expect(results[0]?.qty).toBe(1);
    expect(results[1]?.qty).toBe(2);
    expect(results[2]?.qty).toBeNull();
  });

  it("handles empty array", () => {
    const results = parseIngredients([]);
    expect(results).toHaveLength(0);
  });
});
