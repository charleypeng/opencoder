// L1 tests for the model-picker helpers (TASK-M5-05): the capability
// badge filter, the cost and context-limit hint formatters, the model
// reference key, and the favorites list (pure toggle plus the
// localStorage load/save round-trip with garbage tolerance).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Model } from "../../services/provider.js";
import {
  capabilityBadges,
  FAVORITES_STORAGE_KEY,
  formatContextLimit,
  formatCost,
  isFavorite,
  loadFavorites,
  modelName,
  modelRefKey,
  saveFavorites,
  toggleFavorite,
} from "./models.js";

function model(overrides: Partial<Model> = {}): Model {
  return {
    id: "gpt-5",
    providerID: "openai",
    name: "GPT-5",
    api: { id: "gpt-5", url: "https://example.com/v1", npm: "@ai-sdk/openai" },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1.25, output: 10, cache: { read: 0.625, write: 1.25 } },
    limit: { context: 400000, output: 128000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-08-07",
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("modelName", () => {
  it("prefers the display name and falls back to the id", () => {
    expect(modelName(model())).toBe("GPT-5");
    expect(modelName(model({ name: undefined }))).toBe("gpt-5");
  });
});

describe("capabilityBadges", () => {
  it("lists tools, vision and reasoning only when the capability is true", () => {
    expect(capabilityBadges(model())).toEqual(["tools", "vision", "reasoning"]);
    expect(
      capabilityBadges(
        model({
          capabilities: {
            ...model().capabilities!,
            reasoning: false,
            input: { ...model().capabilities!.input, image: false },
          },
        }),
      ),
    ).toEqual(["tools"]);
  });

  it("returns an empty list without any capability", () => {
    expect(
      capabilityBadges(
        model({
          capabilities: {
            ...model().capabilities!,
            toolcall: false,
            reasoning: false,
            input: { ...model().capabilities!.input, image: false },
          },
        }),
      ),
    ).toEqual([]);
  });

  it("treats a missing capabilities field as no badges", () => {
    expect(capabilityBadges(model({ capabilities: undefined }))).toEqual([]);
  });
});

describe("formatCost", () => {
  it("formats the per-million input/output prices", () => {
    expect(formatCost(model())).toBe("$1.25/M in · $10/M out");
    expect(
      formatCost(model({ cost: { input: 0.15, output: 0.6, cache: { read: 0.1, write: 0.15 } } })),
    ).toBe("$0.15/M in · $0.60/M out");
  });

  it("returns null without a usable cost", () => {
    expect(formatCost(model({ cost: undefined }))).toBeNull();
    const partialCost = {
      input: undefined,
      output: 1,
      cache: { read: 0, write: 0 },
    } as unknown as Model["cost"];
    expect(formatCost(model({ cost: partialCost }))).toBeNull();
  });
});

describe("formatContextLimit", () => {
  it("formats tokens as a K-rounded hint", () => {
    expect(formatContextLimit(model())).toBe("400K context");
    expect(formatContextLimit(model({ limit: { context: 200000, output: 8192 } }))).toBe(
      "200K context",
    );
  });

  it("returns null without a context limit", () => {
    expect(formatContextLimit(model({ limit: undefined }))).toBeNull();
  });
});

describe("modelRefKey", () => {
  it("joins provider id and model id with a colon", () => {
    expect(modelRefKey("openai", "gpt-5")).toBe("openai:gpt-5");
  });
});

describe("favorites", () => {
  it("toggles a key on and off without mutating the input", () => {
    const base: string[] = [];
    const added = toggleFavorite(base, "openai:gpt-5");
    expect(added).toEqual(["openai:gpt-5"]);
    expect(base).toEqual([]);
    expect(toggleFavorite(added, "openai:gpt-5")).toEqual([]);
    expect(isFavorite(added, "openai:gpt-5")).toBe(true);
  });

  it("persists through saveFavorites/loadFavorites", () => {
    saveFavorites(["openai:gpt-5", "anthropic:claude-sonnet-4-5"]);
    expect(loadFavorites()).toEqual(["openai:gpt-5", "anthropic:claude-sonnet-4-5"]);
  });

  it("returns an empty list without a stored value", () => {
    expect(loadFavorites()).toEqual([]);
  });

  it("tolerates corrupted storage", () => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, "{not json");
    expect(loadFavorites()).toEqual([]);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(["a", 7, null]));
    expect(loadFavorites()).toEqual(["a"]);
  });
});
