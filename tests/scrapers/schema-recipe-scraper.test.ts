import { describe, expect, it } from "bun:test";
import { extractRecipeFromHtml } from "../../src/scrapers/schema-recipe-scraper.js";

const SAMPLE_HTML = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Lemon Chicken Rice Bowl",
        "image": "https://example.com/image.jpg",
        "recipeYield": "4 servings",
        "recipeIngredient": [
          "1 lb chicken breast, sliced",
          "2 cups cooked brown rice",
          "2 tbsp olive oil"
        ],
        "recipeInstructions": [
          "Season the chicken.",
          { "@type": "HowToStep", "text": "Cook the rice." }
        ],
        "totalTime": "PT30M"
      }
    </script>
  </head>
  <body></body>
</html>
`;

const NO_RECIPE_SCHEMA_REGEX = /No recipe schema/i;

describe("extractRecipeFromHtml", () => {
  it("parses recipe information from JSON-LD", () => {
    const result = extractRecipeFromHtml(
      SAMPLE_HTML,
      "https://example.com/recipe"
    );

    expect(result.recipe.title).toBe("Lemon Chicken Rice Bowl");
    expect(result.recipe.instructions.split("\n")).toHaveLength(2);
    expect(result.ingredients).toHaveLength(3);
    expect(result.recipe.time?.total).toBe("PT30M");
  });

  it("throws when no recipe schema is present", () => {
    expect(() =>
      extractRecipeFromHtml("<html></html>", "https://example.com")
    ).toThrow(NO_RECIPE_SCHEMA_REGEX);
  });

  it("decodes HTML entities in recipe titles", () => {
    const htmlWithEntities = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Healthier Beef &amp; Barley Soup",
        "recipeIngredient": [],
        "recipeInstructions": "Cook soup."
      }
    </script>
  </head>
  <body></body>
</html>
`;

    const result = extractRecipeFromHtml(
      htmlWithEntities,
      "https://example.com/recipe"
    );

    expect(result.recipe.title).toBe("Healthier Beef & Barley Soup");
  });

  it("handles multiple HTML entities and whitespace in titles", () => {
    const htmlWithMultipleEntities = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Tom &amp; Jerry&apos;s  &nbsp;  Special  &quot;Dish&quot;",
        "recipeIngredient": [],
        "recipeInstructions": "Cook."
      }
    </script>
  </head>
  <body></body>
</html>
`;

    const result = extractRecipeFromHtml(
      htmlWithMultipleEntities,
      "https://example.com/recipe"
    );

    expect(result.recipe.title).toBe('Tom & Jerry\'s Special "Dish"');
  });

  it("handles numeric HTML entities in titles", () => {
    const htmlWithNumericEntities = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Recipe &#39;Test&#39; &amp; More",
        "recipeIngredient": [],
        "recipeInstructions": "Cook."
      }
    </script>
  </head>
  <body></body>
</html>
`;

    const result = extractRecipeFromHtml(
      htmlWithNumericEntities,
      "https://example.com/recipe"
    );

    expect(result.recipe.title).toBe("Recipe 'Test' & More");
  });
});
