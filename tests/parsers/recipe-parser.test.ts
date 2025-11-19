import { describe, expect, it } from "bun:test";
import {
  computeTimeMinutes,
  formatMinutesLabel,
  formatRecipeTime,
  parseDurationMinutes,
  parseServings,
} from "../../src/parsers/recipe-parser.js";

describe("parseServings", () => {
  it("parses numeric servings", () => {
    expect(parseServings(4)).toBe(4);
    expect(parseServings(6.5)).toBe(6.5);
  });

  it("parses string servings", () => {
    expect(parseServings("4 servings")).toBe(4);
    expect(parseServings("Serves 6")).toBe(6);
    expect(parseServings("8")).toBe(8);
  });

  it("returns null for invalid input", () => {
    expect(parseServings("serves many")).toBeNull();
    expect(parseServings(undefined)).toBeNull();
    expect(parseServings(null as unknown as undefined)).toBeNull();
  });
});

describe("parseDurationMinutes", () => {
  it("parses ISO 8601 duration", () => {
    expect(parseDurationMinutes("PT30M")).toBe(30);
    expect(parseDurationMinutes("PT1H30M")).toBe(90);
    // P1DT2H30M = 1 day (1440 min) + 2 hours (120 min) + 30 minutes = 1590 minutes
    expect(parseDurationMinutes("P1DT2H30M")).toBe(1590);
  });

  it("parses text duration", () => {
    expect(parseDurationMinutes("30 minutes")).toBe(30);
    expect(parseDurationMinutes("1 hour 30 minutes")).toBe(90);
    expect(parseDurationMinutes("2 hours")).toBe(120);
  });

  it("parses numeric duration (assumed minutes)", () => {
    expect(parseDurationMinutes("30")).toBe(30);
    expect(parseDurationMinutes("45")).toBe(45);
  });

  it("returns null for invalid input", () => {
    expect(parseDurationMinutes("invalid")).toBeNull();
    expect(parseDurationMinutes("")).toBeNull();
    expect(parseDurationMinutes(undefined)).toBeNull();
  });
});

describe("formatMinutesLabel", () => {
  it("formats minutes less than 60", () => {
    expect(formatMinutesLabel(30)).toBe("30 min");
    expect(formatMinutesLabel(45)).toBe("45 min");
    expect(formatMinutesLabel(0)).toBe("Under 1 min");
  });

  it("formats hours without remainder", () => {
    expect(formatMinutesLabel(60)).toBe("1 h");
    expect(formatMinutesLabel(120)).toBe("2 h");
  });

  it("formats hours with remainder", () => {
    expect(formatMinutesLabel(90)).toBe("1 h 30 min");
    expect(formatMinutesLabel(150)).toBe("2 h 30 min");
  });
});

describe("computeTimeMinutes", () => {
  it("uses total time when available", () => {
    const result = computeTimeMinutes({
      total: "PT30M",
      prep: "PT10M",
      cook: "PT20M",
    });
    expect(result.minutes).toBe(30);
    expect(result.fallback).toBeUndefined();
  });

  it("combines prep and cook time when total unavailable", () => {
    const result = computeTimeMinutes({
      prep: "PT10M",
      cook: "PT20M",
    });
    expect(result.minutes).toBe(30);
  });

  it("uses prep time alone when cook unavailable", () => {
    const result = computeTimeMinutes({
      prep: "PT15M",
    });
    expect(result.minutes).toBe(15);
  });

  it("uses cook time alone when prep unavailable", () => {
    const result = computeTimeMinutes({
      cook: "PT25M",
    });
    expect(result.minutes).toBe(25);
  });

  it("returns fallback when no parseable time", () => {
    const result = computeTimeMinutes({
      total: "some time",
    });
    expect(result.minutes).toBeNull();
    expect(result.fallback).toBe("some time");
  });

  it("returns null for undefined time", () => {
    const result = computeTimeMinutes(undefined);
    expect(result.minutes).toBeNull();
    expect(result.fallback).toBeUndefined();
  });
});

describe("formatRecipeTime", () => {
  it("formats parseable time", () => {
    expect(formatRecipeTime({ total: "PT30M" })).toBe("30 min");
    expect(formatRecipeTime({ total: "PT1H30M" })).toBe("1 h 30 min");
  });

  it("falls back to raw string when not parseable", () => {
    expect(formatRecipeTime({ total: "some time" })).toBe("some time");
  });

  it("returns null for undefined time", () => {
    expect(formatRecipeTime(undefined)).toBeNull();
  });
});
