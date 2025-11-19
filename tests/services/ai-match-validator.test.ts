import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  type AiMatchValidatorOptions,
  validateAliasesWithAi,
  validateMatchWithAi,
} from "../../src/services/ai-match-validator.js";
import type { FoodMatchCandidate, ParsedIngredient } from "../../src/types.js";

const mockIngredient: ParsedIngredient = {
  raw: "1 cup salt",
  qty: 1,
  unit: "cup",
  name: "salt",
  descriptors: [],
  normalizedTokens: ["salt"],
};

const mockCandidate: FoodMatchCandidate = {
  food: {
    id: "food-1",
    name: "Table Salt",
  },
  confidence: 85,
  reasons: [
    { type: "token-overlap", score: 0.9 },
    { type: "exact-name", score: 1.0 },
  ],
};

describe("validateMatchWithAi", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    isValid: true,
                    confidence: 0.95,
                    reason: "Good match",
                  }),
                },
              },
            ],
          }),
      } as Response)
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("returns null when AI validation is disabled", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "false";

    const result = await validateMatchWithAi(mockIngredient, mockCandidate);

    expect(result).toBeNull();
  });

  it("returns null when enabled but no API key provided", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = undefined;

    const result = await validateMatchWithAi(mockIngredient, mockCandidate);

    expect(result).toBeNull();
  });

  it("uses API key from options when provided", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = undefined;

    const options: AiMatchValidatorOptions = {
      enabled: true,
      apiKey: "test-api-key",
    };

    await validateMatchWithAi(mockIngredient, mockCandidate, options);

    expect(global.fetch).toHaveBeenCalled();
    const fetchMock = global.fetch as unknown as ReturnType<typeof mock>;
    const calls = fetchMock.mock.calls;
    expect(calls[0]).toBeDefined();
    if (calls[0]?.[1]) {
      expect(calls[0][0]).toContain("/chat/completions");
      const body = JSON.parse(calls[0][1].body as string);
      expect(body).toBeDefined();
    }
  });

  it("validates match successfully when enabled and API key provided", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    const result = await validateMatchWithAi(mockIngredient, mockCandidate);

    expect(result).not.toBeNull();
    expect(result?.isValid).toBe(true);
    expect(result?.confidence).toBe(0.95);
    expect(result?.reason).toBe("Good match");
  });

  it("uses custom model from options", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    const options: AiMatchValidatorOptions = {
      enabled: true,
      model: "gpt-4",
    };

    await validateMatchWithAi(mockIngredient, mockCandidate, options);

    const fetchMock = global.fetch as unknown as ReturnType<typeof mock>;
    const calls = fetchMock.mock.calls;
    if (calls[0]?.[1]) {
      const body = JSON.parse(calls[0][1].body as string);
      expect(body.model).toBe("gpt-4");
    }
  });

  it("uses custom baseUrl from options", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    const options: AiMatchValidatorOptions = {
      enabled: true,
      baseUrl: "https://custom-api.example.com/v1",
    };

    await validateMatchWithAi(mockIngredient, mockCandidate, options);

    const fetchMock = global.fetch as unknown as ReturnType<typeof mock>;
    const calls = fetchMock.mock.calls;
    if (calls[0]) {
      expect(calls[0][0]).toContain("https://custom-api.example.com/v1");
    }
  });

  it("handles API errors gracefully", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      } as Response)
    ) as unknown as typeof fetch;

    const result = await validateMatchWithAi(mockIngredient, mockCandidate);

    expect(result).toBeNull();
  });

  it("handles network errors gracefully", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    global.fetch = mock(() =>
      Promise.reject(new Error("Network error"))
    ) as unknown as typeof fetch;

    const result = await validateMatchWithAi(mockIngredient, mockCandidate);

    expect(result).toBeNull();
  });

  it("handles invalid JSON response", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: "invalid json",
                },
              },
            ],
          }),
      } as Response)
    ) as unknown as typeof fetch;

    const result = await validateMatchWithAi(mockIngredient, mockCandidate);

    expect(result).toBeNull();
  });

  it("handles missing content in response", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{}],
          }),
      } as Response)
    ) as unknown as typeof fetch;

    const result = await validateMatchWithAi(mockIngredient, mockCandidate);

    expect(result).toBeNull();
  });

  it("includes ingredient and candidate info in request", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    await validateMatchWithAi(mockIngredient, mockCandidate);

    const fetchMock = global.fetch as unknown as ReturnType<typeof mock>;
    const calls = fetchMock.mock.calls;
    if (calls[0]?.[1]) {
      const body = JSON.parse(calls[0][1].body as string);
      const userMessage = body.messages.find(
        (m: { role: string }) => m.role === "user"
      );
      expect(userMessage.content).toContain('"salt"');
      expect(userMessage.content).toContain('"Table Salt"');
      expect(userMessage.content).toContain("85");
    }
  });
});

describe("validateAliasesWithAi", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    valid: ["salt"],
                    rejected: ["pepper"],
                    reasons: { pepper: "Not a valid alias" },
                  }),
                },
              },
            ],
          }),
      } as Response)
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("returns all aliases when AI validation is disabled", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "false";

    const result = await validateAliasesWithAi("Salted Butter", [
      "salt",
      "butter",
    ]);

    expect(result.valid).toEqual(["salt", "butter"]);
    expect(result.rejected).toEqual([]);
  });

  it("returns all aliases when enabled but no API key", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = undefined;

    const result = await validateAliasesWithAi("Salted Butter", [
      "salt",
      "butter",
    ]);

    expect(result.valid).toEqual(["salt", "butter"]);
    expect(result.rejected).toEqual([]);
  });

  it("returns empty arrays when aliases array is empty", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    const result = await validateAliasesWithAi("Food Name", []);

    expect(result.valid).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("validates aliases successfully", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    const result = await validateAliasesWithAi("Table Salt", [
      "salt",
      "pepper",
    ]);

    expect(result.valid).toEqual(["salt"]);
    expect(result.rejected).toEqual(["pepper"]);
  });

  it("handles API errors gracefully", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      } as Response)
    ) as unknown as typeof fetch;

    const result = await validateAliasesWithAi("Food", ["alias1", "alias2"]);

    expect(result.valid).toEqual(["alias1", "alias2"]);
    expect(result.rejected).toEqual([]);
  });

  it("handles network errors gracefully", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    global.fetch = mock(() =>
      Promise.reject(new Error("Network error"))
    ) as unknown as typeof fetch;

    const result = await validateAliasesWithAi("Food", ["alias1"]);

    expect(result.valid).toEqual(["alias1"]);
    expect(result.rejected).toEqual([]);
  });

  it("handles missing content in response", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{}],
          }),
      } as Response)
    ) as unknown as typeof fetch;

    const result = await validateAliasesWithAi("Food", ["alias1"]);

    expect(result.valid).toEqual(["alias1"]);
    expect(result.rejected).toEqual([]);
  });

  it("uses custom model from options", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    const options: AiMatchValidatorOptions = {
      enabled: true,
      model: "custom-model",
    };

    await validateAliasesWithAi("Food", ["alias1"], options);

    const fetchMock = global.fetch as unknown as ReturnType<typeof mock>;
    const calls = fetchMock.mock.calls;
    if (calls[0]?.[1]) {
      const body = JSON.parse(calls[0][1].body as string);
      expect(body.model).toBe("custom-model");
    }
  });

  it("includes food name and aliases in request", async () => {
    process.env.AI_MATCH_VALIDATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    await validateAliasesWithAi("Table Salt", ["salt", "pepper"]);

    const fetchMock = global.fetch as unknown as ReturnType<typeof mock>;
    const calls = fetchMock.mock.calls;
    if (calls[0]?.[1]) {
      const body = JSON.parse(calls[0][1].body as string);
      const userMessage = body.messages.find(
        (m: { role: string }) => m.role === "user"
      );
      expect(userMessage.content).toContain('"Table Salt"');
      expect(userMessage.content).toContain('"salt"');
      expect(userMessage.content).toContain('"pepper"');
    }
  });
});
