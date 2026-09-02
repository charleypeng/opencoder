// L1 tests for the provider-add patch builder (TASK-S1-02): the pure
// `buildProviderPatch` shape that registers a dynamic provider through the
// Config PATCH family (provider.<id> with SDK package, model, name? and
// options.baseURL/apiKey) and the provider-id slug validation.

import { describe, expect, it } from "vitest";
import { buildProviderPatch, isValidProviderId } from "./addProvider";

describe("buildProviderPatch", () => {
  it("includes the default SDK package and model declaration", () => {
    expect(buildProviderPatch("myllm", { id: "myllm", modelID: "my-model" })).toEqual({
      provider: {
        myllm: {
          npm: "@ai-sdk/openai-compatible",
          models: { "my-model": { name: "my-model" } },
        },
      },
    });
  });

  it("includes the display name when given", () => {
    expect(
      buildProviderPatch("myllm", {
        id: "myllm",
        name: "My LLM",
        modelID: "my-model",
        modelName: "My Model",
      }),
    ).toEqual({
      provider: {
        myllm: {
          name: "My LLM",
          npm: "@ai-sdk/openai-compatible",
          models: { "my-model": { name: "My Model" } },
        },
      },
    });
  });

  it("includes options.baseURL and options.apiKey when given", () => {
    expect(
      buildProviderPatch("myllm", {
        id: "myllm",
        baseURL: "https://myllm.example/v1",
        apiKey: "sk-test",
        modelID: "my-model",
      }),
    ).toEqual({
      provider: {
        myllm: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "https://myllm.example/v1", apiKey: "sk-test" },
          models: { "my-model": { name: "my-model" } },
        },
      },
    });
  });

  it("omits the options object when neither baseURL nor apiKey is set", () => {
    expect(
      buildProviderPatch("myllm", { id: "myllm", name: "My LLM", modelID: "my-model" }),
    ).toEqual({
      provider: {
        myllm: {
          name: "My LLM",
          npm: "@ai-sdk/openai-compatible",
          models: { "my-model": { name: "my-model" } },
        },
      },
    });
  });

  it("omits each empty field individually (apiKey without baseURL stays valid)", () => {
    expect(
      buildProviderPatch("myllm", {
        id: "myllm",
        baseURL: "",
        apiKey: "sk-test",
        modelID: "my-model",
      }),
    ).toEqual({
      provider: {
        myllm: {
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "sk-test" },
          models: { "my-model": { name: "my-model" } },
        },
      },
    });
  });

  it("trims id, name, package, model and endpoint fields", () => {
    expect(
      buildProviderPatch("  myllm  ", {
        id: "  myllm  ",
        name: "  My LLM ",
        npm: " @ai-sdk/openai-compatible ",
        modelID: " my-model ",
        modelName: " My Model ",
        baseURL: " https://x ",
      }),
    ).toEqual({
      provider: {
        myllm: {
          name: "My LLM",
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "https://x" },
          models: { "my-model": { name: "My Model" } },
        },
      },
    });
  });
});

describe("isValidProviderId", () => {
  it("accepts letters, digits, dashes and underscores", () => {
    for (const id of ["openai", "my-provider", "my_provider", "MyProvider", "123"]) {
      expect(isValidProviderId(id)).toBe(true);
    }
  });

  it("rejects empty ids and ids with other characters", () => {
    for (const id of ["", "my provider", "my.provider", "my/provider", "my provider2"]) {
      expect(isValidProviderId(id)).toBe(false);
    }
  });
});
