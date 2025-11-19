import { describe, expect, it } from "bun:test";
import { ReviewQueue } from "../../src/services/review-queue.js";
import type {
  FoodMatchCandidate,
  ParsedIngredient,
  ReviewQueueGateway,
  ReviewQueueItem,
} from "../../src/types.js";

const createIngredient = (name: string): ParsedIngredient => ({
  raw: `1 cup ${name}`,
  qty: 1,
  unit: "cup",
  name,
});

describe("ReviewQueue", () => {
  it("enqueues ingredients", async () => {
    const queue = new ReviewQueue();
    const ingredient = createIngredient("parsley");

    queue.enqueue(ingredient);

    const flushed = await queue.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.ingredient.name).toBe("parsley");
  });

  it("enqueues ingredients with candidates", async () => {
    const queue = new ReviewQueue();
    const ingredient = createIngredient("parsley");
    const candidate: FoodMatchCandidate = {
      food: { id: "food-1", name: "Parsley, fresh" },
      confidence: 75,
      reasons: [],
    };

    queue.enqueue(ingredient, candidate);

    const flushed = await queue.flush();
    expect(flushed[0]?.candidate).toBe(candidate);
  });

  it("clears queue after flush", async () => {
    const queue = new ReviewQueue();
    queue.enqueue(createIngredient("item1"));
    queue.enqueue(createIngredient("item2"));

    await queue.flush();
    const secondFlush = await queue.flush();

    expect(secondFlush).toHaveLength(0);
  });

  it("persists to gateway when provided", async () => {
    const persistedItems: ReviewQueueItem[] = [];
    const gateway: ReviewQueueGateway = {
      persist: (items: ReviewQueueItem[]) => {
        persistedItems.push(...items);
        return Promise.resolve();
      },
    };

    const queue = new ReviewQueue(gateway);
    queue.enqueue(createIngredient("item1"));
    queue.enqueue(createIngredient("item2"));

    await queue.flush();

    expect(persistedItems).toHaveLength(2);
    expect(persistedItems[0]?.ingredient.name).toBe("item1");
    expect(persistedItems[1]?.ingredient.name).toBe("item2");
  });

  it("does not persist when gateway not provided", async () => {
    const queue = new ReviewQueue();
    queue.enqueue(createIngredient("item1"));

    const flushed = await queue.flush();

    expect(flushed).toHaveLength(1);
  });

  it("handles null candidate", async () => {
    const queue = new ReviewQueue();
    const ingredient = createIngredient("unknown");

    queue.enqueue(ingredient, null);

    const flushed = await queue.flush();
    expect(flushed[0]?.candidate).toBeNull();
  });
});
