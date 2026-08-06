// L1 tests for the provider-add patch builder (TASK-S1-02): the pure
// `buildProviderPatch` shape that registers a dynamic provider through the
// Config PATCH family (provider.<id> with name? + options.baseURL/apiKey —
// empty fields omitted) and the provider-id slug validation.

import { describe, expect, it } from "vitest";
import { buildProviderPatch, isValidProviderId } from "./addProvider";

describe("buildProviderPatch", () => {
  it("yields a bare provider entry for an id only", () => {
    expect(buildProviderPatch("myllm", { id: "myllm" })).toEqual({
      provider: { myllm: {} },
    });
  });

  it("includes the display name when given", () => {
    expect(buildProviderPatch("myllm", { id: "myllm", name: "My LLM" })).toEqual({
      provider: { myllm: { name: "My LLM" } },
    });
  });

  it("includes options.baseURL and options.apiKey when given", () => {
    expect(
      buildProviderPatch("myllm", {
        id: "myllm",
        baseURL: "https://myllm.example/v1",
        apiKey: "sk-test",
      }),
    ).toEqual({
      provider: { myllm: { options: { baseURL: "https://myllm.example/v1", apiKey: "sk-test" } } },
    });
  });

  it("omits the options object when neither baseURL nor apiKey is set", () => {
    expect(buildProviderPatch("myllm", { id: "myllm", name: "My LLM" })).toEqual({
      provider: { myllm: { name: "My LLM" } },
    });
  });

  it("omits each empty field individually (apiKey without baseURL stays valid)", () => {
    expect(buildProviderPatch("myllm", { id: "myllm", baseURL: "", apiKey: "sk-test" })).toEqual({
      provider: { myllm: { options: { apiKey: "sk-test" } } },
    });
  });

  it("trims id, name, baseURL and apiKey", () => {
    expect(
      buildProviderPatch("  myllm  ", {
        id: "  myllm  ",
        name: "  My LLM ",
        baseURL: " https://x ",
      }),
    ).toEqual({
      provider: { myllm: { name: "My LLM", options: { baseURL: "https://x" } } },
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
