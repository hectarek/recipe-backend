import { describe, expect, it } from "bun:test";
import { extractRecipeFromHtml } from "../../src/scrapers/schema-recipe-scraper.js";

describe("extractRecipeFromHtml - Edge Cases", () => {
  it("handles nested @graph structure", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Recipe",
            "name": "Nested Recipe",
            "recipeIngredient": ["1 cup flour"],
            "recipeInstructions": "Mix ingredients"
          }
        ]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.title).toBe("Nested Recipe");
    expect(result.ingredients).toEqual(["1 cup flour"]);
  });

  it("handles array of JSON-LD scripts", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Article",
        "name": "Not a recipe"
      }
    </script>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Second Recipe",
        "recipeIngredient": ["2 cups sugar"]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.title).toBe("Second Recipe");
    expect(result.ingredients).toEqual(["2 cups sugar"]);
  });

  it("handles recipe with array @type", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": ["Thing", "Recipe"],
        "name": "Array Type Recipe",
        "recipeIngredient": ["1 egg"]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.title).toBe("Array Type Recipe");
  });

  it("handles instructions as HowToStep array", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeInstructions": [
          { "@type": "HowToStep", "text": "Step 1" },
          { "@type": "HowToStep", "text": "Step 2" },
          { "@type": "HowToStep", "text": "Step 3" }
        ]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    const steps = result.recipe.instructions.split("\n");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe("Step 1");
    expect(steps[1]).toBe("Step 2");
    expect(steps[2]).toBe("Step 3");
  });

  it("handles instructions as string array", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeInstructions": ["Mix", "Bake", "Serve"]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.instructions).toBe("Mix\nBake\nServe");
  });

  it("handles image as object with url", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "image": {
          "url": "https://example.com/image.jpg"
        }
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.image).toBe("https://example.com/image.jpg");
  });

  it("handles image as array", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "image": ["https://example.com/img1.jpg", "https://example.com/img2.jpg"]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.image).toBe("https://example.com/img1.jpg");
  });

  it("handles recipeYield as number", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeYield": 4
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.yield).toBe(4);
  });

  it("handles recipeYield as string array", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeYield": ["4 servings", "8 portions"]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.yield).toBe("4 servings");
  });

  it("handles ingredients as string (single ingredient)", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeIngredient": "1 cup flour"
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.ingredients).toEqual(["1 cup flour"]);
  });

  it("falls back to ingredients when recipeIngredient missing", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "ingredients": ["1 cup milk", "2 eggs"]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.ingredients).toEqual(["1 cup milk", "2 eggs"]);
  });

  it("handles recipeCategory as comma-separated string", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeCategory": "Dinner, Main Course"
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.categories).toContain("Dinner");
    expect(result.recipe.categories).toContain("Main Course");
  });

  it("handles recipeCategory as object with name", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeCategory": { "name": "Dessert" }
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.categories).toContain("Dessert");
  });

  it("handles invalid JSON gracefully", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      { invalid json }
    </script>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Valid Recipe"
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.title).toBe("Valid Recipe");
  });

  it("handles empty instructions", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeInstructions": ""
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.instructions).toBe("");
  });

  it("handles instructions as single object with text", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeInstructions": {
          "text": "Single instruction step"
        }
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.instructions).toBe("Single instruction step");
  });

  it("handles recipeTypeMatches with non-string, non-array @type", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": 123,
        "name": "Not a recipe"
      }
    </script>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Valid Recipe",
        "recipeIngredient": ["1 cup flour"]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.title).toBe("Valid Recipe");
  });

  it("handles findRecipeNode with array at root level", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      [
        {
          "@type": "Article",
          "name": "Not a recipe"
        },
        {
          "@type": "Recipe",
          "name": "Array Root Recipe",
          "recipeIngredient": ["1 cup sugar"]
        }
      ]
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.title).toBe("Array Root Recipe");
  });

  it("handles instructions array with non-object entries", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeInstructions": [
          { "@type": "HowToStep", "text": "Step 1" },
          "String entry",
          { "@type": "HowToStep", "text": "Step 2" },
          null,
          { "@type": "HowToStep", "text": "Step 3" }
        ]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    const steps = result.recipe.instructions.split("\n").filter(Boolean);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps).toContain("Step 1");
    expect(steps).toContain("Step 2");
    expect(steps).toContain("Step 3");
    // String entries are also included
    expect(steps).toContain("String entry");
  });

  it("handles instructions array with object entries missing text", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "recipeInstructions": [
          { "@type": "HowToStep", "text": "Step 1" },
          { "@type": "HowToStep", "name": "No text property" },
          { "@type": "HowToStep", "text": "Step 2" }
        ]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    const steps = result.recipe.instructions.split("\n").filter(Boolean);
    expect(steps).toContain("Step 1");
    expect(steps).toContain("Step 2");
  });

  it("handles image object with non-string url", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "image": {
          "url": 123
        }
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.image).toBeUndefined();
  });

  it("handles image array with mixed types", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Test",
        "image": [
          "https://example.com/img1.jpg",
          { "url": "https://example.com/img2.jpg" },
          null,
          123
        ]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.image).toBe("https://example.com/img1.jpg");
  });

  it("handles nested @graph with multiple levels", () => {
    const html = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Article",
            "name": "Not a recipe"
          },
          {
            "@type": "WebPage",
            "@graph": [
              {
                "@type": "Recipe",
                "name": "Deeply Nested Recipe",
                "recipeIngredient": ["1 cup flour"]
              }
            ]
          }
        ]
      }
    </script>
  </head>
</html>
    `;

    const result = extractRecipeFromHtml(html, "https://example.com");
    expect(result.recipe.title).toBe("Deeply Nested Recipe");
  });
});
