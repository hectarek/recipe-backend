import { describe, expect, it } from "bun:test";
import {
  matchIngredientToFood,
  rankFoodCandidates,
} from "../../src/matchers/food-matcher.js";
import type { FoodLookupItem, ParsedIngredient } from "../../src/types.js";

const lookup: FoodLookupItem[] = [
  { id: "1", name: "Chicken breast, cooked", aliases: ["chicken breast"] },
  { id: "2", name: "Rice, brown, cooked" },
  { id: "3", name: "Extra virgin olive oil", aliases: ["olive oil"] },
];

const ingredient = (name: string): ParsedIngredient => ({
  raw: name,
  name,
  qty: 1,
  unit: "cup",
  normalizedTokens: name.toLowerCase().split(" ").filter(Boolean),
});

describe("matchIngredientToFood", () => {
  it("matches exact lowercase names", async () => {
    const match = await matchIngredientToFood(
      ingredient("chicken breast"),
      lookup
    );
    expect(match?.food.id).toBe("1");
    expect(match?.confidence).toBeGreaterThanOrEqual(90);
  });

  it("matches by alias", async () => {
    const match = await matchIngredientToFood(ingredient("olive oil"), lookup);
    expect(match?.food.id).toBe("3");
  });

  it("matches by token inclusion", async () => {
    const match = await matchIngredientToFood(
      ingredient("brown rice cooked"),
      lookup
    );
    expect(match?.food.id).toBe("2");
  });

  it("returns null when no match found", async () => {
    const match = await matchIngredientToFood(
      ingredient("dragon fruit"),
      lookup
    );
    expect(match).toBeNull();
  });

  it("handles empty lookup array", async () => {
    const match = await matchIngredientToFood(ingredient("chicken"), []);
    expect(match).toBeNull();
  });
});

describe("rankFoodCandidates", () => {
  it("ranks candidates by confidence", async () => {
    const testIngredient = {
      raw: "chicken",
      name: "chicken",
      qty: 1,
      unit: "cup",
      normalizedTokens: ["chicken"],
    };

    const candidates = await rankFoodCandidates(testIngredient, lookup);

    expect(candidates.length).toBeGreaterThan(0);
    // Should be sorted by confidence (highest first)
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1]?.confidence).toBeGreaterThanOrEqual(
        candidates[i]?.confidence ?? 0
      );
    }
  });

  it("returns empty array for empty lookup", async () => {
    const candidates = await rankFoodCandidates(ingredient("chicken"), []);
    expect(candidates).toEqual([]);
  });

  it("includes match reasons in candidates", async () => {
    const candidates = await rankFoodCandidates(
      ingredient("chicken breast"),
      lookup
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.reasons.length).toBeGreaterThan(0);
  });
});
