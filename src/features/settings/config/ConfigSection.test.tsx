// L2 tests for the Config settings section (TASK-M9-05): the project /
// global scope tabs loading GET /config and GET /global/config, the
// formified common fields (model / default_agent / share / autoupdate /
// permission) with dirty tracking and PATCH-on-save, the form-driven
// provider+model dual select (provider changes re-list the models and the
// picked pair saves as provider/model), the dirty-form scope-switch
// discard confirmation, the stale-save guard when the scope flips mid-
// save, the advanced JSON editor (parse validation, unknown-key hints,
// merge-patch save, failure rollback) and the instance-dispose danger
// zone (confirm panel, POST /instance/dispose, failure inline). The HTTP
// layer runs through the mocked Tauri invoke transport with in-memory
// config state, mirroring the mock server's merge semantics.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import ConfigSection, { configModelString, modelRefOf } from "./ConfigSection.js";
import type { Provider } from "../../../services/provider.js";
import type { Model } from "../../../services/provider.js";
import { clearToasts, toasts } from "../../../stores/toasts.js";
import { resetServer as resetModels } from "../../../stores/models.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const SERVER = "srv-config";

function model(id: string, name: string): Model {
  return {
    id,
    providerID: "openai",
    name,
    api: { id, url: "https://example.com/v1", npm: "@ai-sdk/openai" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1.25, output: 10, cache: { read: 0.625, write: 1.25 } },
    limit: { context: 400000, output: 128000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-08-07",
  };
}

function provider(id: string, name: string, models: Model[]): Provider {
  const record: Record<string, Model> = {};
  for (const entry of models) record[entry.id] = entry;
  return { id, name, source: "env", env: [], options: {}, models: record };
}

const OPENAI = provider("openai", "OpenAI", [model("gpt-5", "GPT-5"), model("gpt-4.1", "GPT-4.1")]);
const ANTHROPIC = provider("anthropic", "Anthropic", [
  model("claude-sonnet-4-5", "Claude Sonnet 4.5"),
  model("claude-opus-4-1", "Claude Opus 4.1"),
]);

const PROJECT_CONFIG = {
  $schema: "https://opencode.ai/config.json",
  model: "gpt-5",
  default_agent: "build",
  share: "manual",
  autoupdate: true,
  permission: "ask",
  logLevel: "INFO",
};

const GLOBAL_CONFIG = {
  $schema: "https://opencode.ai/config.json",
  model: "claude-sonnet-4-5",
  default_agent: "build",
  share: "auto",
  autoupdate: "notify",
  permission: "ask",
};

let projectConfig: Record<string, unknown>;
let globalConfig: Record<string, unknown>;

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(current: JsonRecord, patch: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isJsonRecord(out[key]) && isJsonRecord(value) ? deepMerge(out[key], value) : value;
  }
  return out;
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

beforeEach(() => {
  resetModels(SERVER);
  projectConfig = { ...PROJECT_CONFIG };
  globalConfig = { ...GLOBAL_CONFIG };
  invokeMock.mockReset();
  invokeMock.mockImplementation(
    (cmd: string, args?: { request?: { method?: string; path?: string; body?: unknown } }) => {
      if (cmd !== "http_request") return Promise.resolve(undefined);
      const { method = "GET", path = "", body } = args?.request ?? {};
      if (method === "GET" && path === "/config")
        return Promise.resolve(httpResponse(projectConfig));
      if (method === "PATCH" && path === "/config") {
        projectConfig = deepMerge(projectConfig, body as Record<string, unknown>);
        return Promise.resolve(httpResponse(projectConfig));
      }
      if (method === "GET" && path === "/global/config")
        return Promise.resolve(httpResponse(globalConfig));
      if (method === "PATCH" && path === "/global/config") {
        globalConfig = deepMerge(globalConfig, body as Record<string, unknown>);
        return Promise.resolve(httpResponse(globalConfig));
      }
      if (method === "POST" && path === "/instance/dispose")
        return Promise.resolve(httpResponse(true));
      if (method === "GET" && path === "/agent") {
        return Promise.resolve(
          httpResponse([
            { name: "build", mode: "primary" },
            { name: "plan", mode: "primary" },
          ]),
        );
      }
      if (method === "GET" && path === "/provider") {
        return Promise.resolve(
          httpResponse({
            all: [OPENAI, ANTHROPIC],
            default: { openai: "gpt-5" },
            connected: ["openai", "anthropic"],
          }),
        );
      }
      if (method === "GET" && path === "/config/providers") {
        return Promise.resolve(
          httpResponse({ providers: [OPENAI, ANTHROPIC], default: { openai: "gpt-5" } }),
        );
      }
      return Promise.resolve(httpResponse([]));
    },
  );
});

afterEach(() => {
  resetModels(SERVER);
  clearToasts();
  vi.clearAllMocks();
});

describe("modelRefOf / configModelString", () => {
  it("resolves a bare model id from the catalog", () => {
    expect(modelRefOf("gpt-5", [OPENAI, ANTHROPIC])).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    });
  });

  it("resolves a provider-qualified model id", () => {
    expect(modelRefOf("anthropic/claude-sonnet-4-5", [OPENAI, ANTHROPIC])).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
    });
  });

  it("returns null for empty or unknown models", () => {
    expect(modelRefOf(undefined, [OPENAI])).toBeNull();
    expect(modelRefOf("", [OPENAI])).toBeNull();
    expect(modelRefOf("gpt-99", [OPENAI])).toBeNull();
    expect(modelRefOf("missing/gpt-5", [OPENAI])).toBeNull();
  });

  it("writes the provider-qualified string back", () => {
    expect(configModelString({ providerID: "openai", modelID: "gpt-5" })).toBe("openai/gpt-5");
  });
});

describe("ConfigSection", () => {
  it("loads the project config by default and formifies the common fields", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-row-model")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("config-model-provider")).toHaveValue("openai"));
    expect(screen.getByTestId("config-model-model")).toHaveValue("gpt-5");
    await waitFor(() => expect(screen.getByTestId("config-agent")).toHaveValue("build"));
    expect(screen.getByTestId("config-share")).toHaveValue("manual");
    expect(screen.getByTestId("config-autoupdate")).toHaveValue("true");
    expect(screen.getByTestId("config-permission")).toHaveValue("ask");
    expect(screen.getByTestId("config-scope-project")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("config-save")).toBeDisabled();
  });

  it("switches to the global scope and loads the global config", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-row-model")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("config-scope-global"));
    await waitFor(() =>
      expect(screen.getByTestId("config-model-provider")).toHaveValue("anthropic"),
    );
    expect(screen.getByTestId("config-model-model")).toHaveValue("claude-sonnet-4-5");
    expect(screen.getByTestId("config-share")).toHaveValue("auto");
    expect(screen.getByTestId("config-autoupdate")).toHaveValue("notify");
    expect(screen.getByTestId("config-scope-global")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the AI generated title toggle in the global scope only, default ON", async () => {
    localStorage.clear();
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-row-model")).toBeInTheDocument());

    // Project scope: no toggle (it is a client preference, global only).
    expect(screen.queryByTestId("config-auto-title")).toBeNull();

    fireEvent.click(screen.getByTestId("config-scope-global"));
    const toggle = await screen.findByTestId("config-auto-title");
    expect(toggle).toBeChecked();

    // The toggle persists to localStorage (never to opencode.json).
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem("oc-autotitle")).toBe("0");
    fireEvent.click(toggle);
    expect(localStorage.getItem("oc-autotitle")).toBe("1");
  });

  it("marks the form dirty on change and PATCHes the merge patch on save", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-share")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("config-share"), { target: { value: "auto" } });
    expect(screen.getByTestId("config-dirty")).toBeInTheDocument();
    expect(screen.getByTestId("config-save")).toBeEnabled();

    fireEvent.click(screen.getByTestId("config-save"));
    await waitFor(() => expect(screen.queryByTestId("config-dirty")).not.toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith(
      "http_request",
      expect.objectContaining({
        request: expect.objectContaining({
          method: "PATCH",
          path: "/config",
          body: expect.objectContaining({ share: "auto" }),
        }),
      }),
    );
    expect(projectConfig.share).toBe("auto");
    expect(screen.getByTestId("config-save")).toBeDisabled();
    await waitFor(() => expect(toasts.some((toast) => toast.kind === "success")).toBe(true));
  });

  it("saves the model selection as a provider-qualified string", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-model-model")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("config-model-model"), { target: { value: "gpt-4.1" } });
    fireEvent.click(screen.getByTestId("config-save"));
    await waitFor(() => expect(projectConfig.model).toBe("openai/gpt-4.1"));
  });

  it("switches the model list with the provider and saves the picked pair", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-model-provider")).toHaveValue("openai"));
    expect(screen.getByTestId("config-model-model")).toHaveValue("gpt-5");

    // A provider change must drive the model select immediately — the
    // selects used to re-render from the baseline, keeping the old
    // provider's model list and writing the old provider id on save.
    fireEvent.change(screen.getByTestId("config-model-provider"), {
      target: { value: "anthropic" },
    });
    expect(screen.getByTestId("config-model-provider")).toHaveValue("anthropic");
    await waitFor(() =>
      expect(screen.getByTestId("config-model-model")).toHaveValue("claude-sonnet-4-5"),
    );
    expect(
      Array.from(
        screen.getByTestId("config-model-model").querySelectorAll("option"),
        (option) => option.value,
      ),
    ).toEqual(["claude-sonnet-4-5", "claude-opus-4-1"]);

    fireEvent.change(screen.getByTestId("config-model-model"), {
      target: { value: "claude-opus-4-1" },
    });
    fireEvent.click(screen.getByTestId("config-save"));
    await waitFor(() => expect(projectConfig.model).toBe("anthropic/claude-opus-4-1"));
  });

  it("asks before discarding a dirty form on a scope switch", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-share")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("config-share"), { target: { value: "disabled" } });
    fireEvent.click(screen.getByTestId("config-scope-global"));
    expect(screen.getByTestId("config-discard-dialog")).toBeInTheDocument();
    // The switch is deferred until confirmed.
    expect(screen.getByTestId("config-scope-project")).toHaveAttribute("aria-pressed", "true");

    // Cancel keeps the scope and the dirty form.
    fireEvent.click(screen.getByTestId("config-discard-cancel"));
    expect(screen.queryByTestId("config-discard-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("config-dirty")).toBeInTheDocument();
    expect(screen.getByTestId("config-scope-project")).toHaveAttribute("aria-pressed", "true");

    // Confirming discards and switches.
    fireEvent.click(screen.getByTestId("config-scope-global"));
    fireEvent.click(screen.getByTestId("config-discard-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("config-model-provider")).toHaveValue("anthropic"),
    );
    expect(screen.queryByTestId("config-discard-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("config-dirty")).not.toBeInTheDocument();
    expect(projectConfig.share).toBe("manual");
  });

  it("ignores a stale save response when the scope switched mid-save", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-share")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("config-share"), { target: { value: "disabled" } });

    // Gate the project PATCH so the scope can flip while it is in flight.
    let resolvePatch: (value: unknown) => void = () => undefined;
    const patchGate = new Promise((resolve) => {
      resolvePatch = resolve;
    });
    invokeMock.mockImplementation(
      (cmd: string, args?: { request?: { method?: string; path?: string } }) => {
        const { method = "GET", path = "" } = args?.request ?? {};
        if (cmd !== "http_request") return Promise.resolve(undefined);
        if (method === "PATCH" && path === "/config")
          return patchGate.then(() => httpResponse(projectConfig));
        if (method === "GET" && path === "/global/config")
          return Promise.resolve(httpResponse(globalConfig));
        return Promise.resolve(httpResponse({}));
      },
    );

    fireEvent.click(screen.getByTestId("config-save"));
    fireEvent.click(screen.getByTestId("config-scope-global"));
    fireEvent.click(screen.getByTestId("config-discard-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("config-model-provider")).toHaveValue("anthropic"),
    );

    // Let the stale project PATCH land — it must not overwrite the global
    // baseline nor toast into it.
    resolvePatch(httpResponse(projectConfig));
    await waitFor(() => expect(screen.getByTestId("config-save")).toHaveTextContent("Save"));
    expect(screen.getByTestId("config-model-provider")).toHaveValue("anthropic");
    expect(screen.getByTestId("config-model-model")).toHaveValue("claude-sonnet-4-5");
    expect(screen.queryByTestId("config-save-error")).not.toBeInTheDocument();
    expect(toasts.some((toast) => toast.kind === "success")).toBe(false);
  });

  it("keeps the form and surfaces the error when the save fails", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-share")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("config-share"), { target: { value: "disabled" } });
    invokeMock.mockImplementation(
      (cmd: string, args?: { request?: { method?: string; path?: string } }) => {
        if (
          cmd === "http_request" &&
          args?.request?.method === "PATCH" &&
          args?.request?.path === "/config"
        ) {
          return Promise.reject({
            status: 400,
            code: "http",
            message: "invalid config patch",
            retriable: false,
          });
        }
        return Promise.resolve(httpResponse({}));
      },
    );

    fireEvent.click(screen.getByTestId("config-save"));
    await waitFor(() => expect(screen.getByTestId("config-save-error")).toBeInTheDocument());
    expect(screen.getByTestId("config-save-error")).toHaveTextContent("invalid config patch");
    expect(screen.getByTestId("config-dirty")).toBeInTheDocument();
    expect(screen.getByTestId("config-share")).toHaveValue("disabled");
  });

  it("renders a note instead of the permission select for per-tool rules", async () => {
    projectConfig = { ...PROJECT_CONFIG, permission: { bash: "allow" } };
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-permission-object")).toBeInTheDocument());
    expect(screen.queryByTestId("config-permission")).not.toBeInTheDocument();
  });

  it("shows the JSON view and validates the edited JSON before saving", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-json-view")).toBeInTheDocument());
    expect(screen.getByTestId("config-json-view")).toHaveTextContent('"model": "gpt-5"');

    fireEvent.click(screen.getByTestId("config-json-edit"));
    const textarea = screen.getByTestId("config-json-textarea");
    expect(textarea).toHaveValue(JSON.stringify(PROJECT_CONFIG, null, 2));

    fireEvent.input(textarea, { target: { value: "{ broken" } });
    expect(screen.getByTestId("config-json-parse-error")).toBeInTheDocument();
    expect(screen.getByTestId("config-json-save")).toBeDisabled();

    const withUnknown = `{\n  "model": "gpt-4.1",\n  "theme": "dark"\n}`;
    fireEvent.input(textarea, { target: { value: withUnknown } });
    expect(screen.queryByTestId("config-json-parse-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("config-json-unknown-keys")).toBeInTheDocument();
    expect(screen.getByTestId("config-json-unknown-keys")).toHaveTextContent("theme");
    expect(screen.getByTestId("config-json-save")).toBeEnabled();

    fireEvent.click(screen.getByTestId("config-json-save"));
    await waitFor(() => expect(projectConfig.model).toBe("gpt-4.1"));
    expect(projectConfig.theme).toBe("dark");
    await waitFor(() =>
      expect(screen.queryByTestId("config-json-textarea")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("config-json-view")).toHaveTextContent('"model": "gpt-4.1"');
  });

  it("rolls the textarea back to the last-saved config on a failed JSON save", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-json-edit")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("config-json-edit"));

    fireEvent.input(screen.getByTestId("config-json-textarea"), {
      target: { value: '{\n  "model": "gpt-99"\n}' },
    });
    invokeMock.mockImplementation(
      (cmd: string, args?: { request?: { method?: string; path?: string } }) => {
        if (
          cmd === "http_request" &&
          args?.request?.method === "PATCH" &&
          args?.request?.path === "/config"
        ) {
          return Promise.reject({
            status: 400,
            code: "http",
            message: "unknown key: model",
            retriable: false,
          });
        }
        return Promise.resolve(httpResponse({}));
      },
    );

    fireEvent.click(screen.getByTestId("config-json-save"));
    await waitFor(() => expect(screen.getByTestId("config-json-save-error")).toBeInTheDocument());
    expect(screen.getByTestId("config-json-save-error")).toHaveTextContent("unknown key: model");
    expect(screen.getByTestId("config-json-textarea")).toHaveValue(
      JSON.stringify(PROJECT_CONFIG, null, 2),
    );
  });

  it("cancels the JSON edit without applying", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-json-edit")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("config-json-edit"));
    fireEvent.input(screen.getByTestId("config-json-textarea"), {
      target: { value: '{\n  "model": "gpt-99"\n}' },
    });
    fireEvent.click(screen.getByTestId("config-json-cancel"));
    expect(screen.queryByTestId("config-json-textarea")).not.toBeInTheDocument();
    expect(screen.getByTestId("config-json-view")).toHaveTextContent('"model": "gpt-5"');
    expect(projectConfig.model).toBe("gpt-5");
  });

  it("disposes the instance only after the confirm panel", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-dispose")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("config-dispose"));
    expect(screen.getByTestId("config-dispose-panel")).toBeInTheDocument();
    expect(screen.getByTestId("config-dispose-panel")).toHaveTextContent("shuts down");

    fireEvent.click(screen.getByTestId("config-dispose-cancel"));
    expect(screen.queryByTestId("config-dispose-panel")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "http_request",
      expect.objectContaining({
        request: expect.objectContaining({ method: "POST", path: "/instance/dispose" }),
      }),
    );

    fireEvent.click(screen.getByTestId("config-dispose"));
    fireEvent.click(screen.getByTestId("config-dispose-confirm"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "http_request",
        expect.objectContaining({
          request: expect.objectContaining({ method: "POST", path: "/instance/dispose" }),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        toasts.some((toast) => toast.kind === "success" && toast.message.includes("disposed")),
      ).toBe(true),
    );
  });

  it("surfaces a dispose failure inline and keeps the panel", async () => {
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-dispose")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("config-dispose"));

    invokeMock.mockImplementation(
      (cmd: string, args?: { request?: { method?: string; path?: string } }) => {
        if (
          cmd === "http_request" &&
          args?.request?.method === "POST" &&
          args?.request?.path === "/instance/dispose"
        ) {
          return Promise.reject({
            status: 500,
            code: "http",
            message: "dispose boom",
            retriable: true,
          });
        }
        return Promise.resolve(httpResponse({}));
      },
    );

    fireEvent.click(screen.getByTestId("config-dispose-confirm"));
    await waitFor(() => expect(screen.getByTestId("config-dispose-error")).toBeInTheDocument());
    expect(screen.getByTestId("config-dispose-error")).toHaveTextContent("dispose boom");
    expect(screen.getByTestId("config-dispose-panel")).toBeInTheDocument();
  });

  it("shows the load error with retry when the config fetch fails", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "http_request"
        ? Promise.reject({ status: 500, code: "http", message: "config down", retriable: true })
        : Promise.resolve(undefined),
    );
    render(() => <ConfigSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("config-load-error")).toBeInTheDocument());
    expect(screen.getByTestId("config-load-error")).toHaveTextContent("config down");

    invokeMock.mockImplementation((cmd: string) =>
      cmd === "http_request"
        ? Promise.resolve(httpResponse(projectConfig))
        : Promise.resolve(undefined),
    );
    fireEvent.click(screen.getByTestId("config-retry"));
    await waitFor(() => expect(screen.getByTestId("config-row-model")).toBeInTheDocument());
  });
});
