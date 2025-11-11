import { describe, expect, it } from "bun:test";
import { matchIngredientToFood } from "../../src/matchers/food-matcher.js";
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
});

describe("matchIngredientToFood", () => {
  it("matches exact lowercase names", () => {
    const match = matchIngredientToFood(ingredient("chicken breast"), lookup);
    expect(match?.id).toBe("1");
  });

  it("matches by alias", () => {
    const match = matchIngredientToFood(ingredient("olive oil"), lookup);
    expect(match?.id).toBe("3");
  });

  it("matches by token inclusion", () => {
    const match = matchIngredientToFood(
      ingredient("brown rice cooked"),
      lookup
    );
    expect(match?.id).toBe("2");
  });

  it("returns null when no match found", () => {
    const match = matchIngredientToFood(ingredient("dragon fruit"), lookup);
    expect(match).toBeNull();
  });
});
