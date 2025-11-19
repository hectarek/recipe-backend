import type {
  FoodMatchCandidate,
  ParsedIngredient,
  ReviewQueueGateway,
  ReviewQueueItem,
} from "../types.js";

export class ReviewQueue {
  private readonly items: ReviewQueueItem[] = [];
  private readonly gateway?: ReviewQueueGateway;

  constructor(gateway?: ReviewQueueGateway) {
    this.gateway = gateway;
  }

  enqueue(ingredient: ParsedIngredient, candidate?: FoodMatchCandidate | null) {
    this.items.push({
      ingredient,
      candidate: candidate ?? null,
    });
  }

  async flush(): Promise<ReviewQueueItem[]> {
    const snapshot = [...this.items];
    this.items.length = 0;

    if (this.gateway && snapshot.length > 0) {
      await this.gateway.persist(snapshot);
    }

    return snapshot;
  }
}
