// L2 tests for the quick open dialog (TASK-M4-04 / TASK-M4-06): opens with
// the search input focused, an empty query shows the per-server recent
// files, typing debounces 150ms and fetches /find/file (rapid keystrokes
// collapse into one request, stale in-flight responses are dropped), ↑↓
// wrap and Enter opens (viewer tab + recent memory + callbacks) while Esc
// closes, a click opens the same way, and the loading / no-matches /
// no-recent states render. Reopening resets the query and cancels pending
// searches. A `#`-prefixed query switches to the symbol mode (TASK-M4-06):
// it fetches /find/symbol with the stripped term, renders rows with a kind
// glyph + path, Enter jumps to the file and the 1-based line, removing the
// `#` falls back to the file search, and an empty LSP response shows the
// no-symbols state — with the same debounce / stale-drop guarantees.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { resetServer as resetProject, setCurrent } from "../../stores/project";
import { setActiveServer } from "../../stores/registry";
import { resetServer as resetViewer, viewer } from "../../stores/viewer";
import QuickOpen from "./QuickOpen";
import { readRecentFiles } from "./recentFiles";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-quick";
const DEBOUNCE_MS = 150;
const DIRECTORY = "/mock/projects/opencode-demo";

/** /find/symbol fixture rows in the LSP Symbol shape (0-based positions). */
const SYMBOL_ROWS = [
  {
    name: "PromptBox",
    kind: 12,
    location: {
      uri: "file:///mock/projects/opencode-demo/src/features/sessions/PromptBox.tsx",
      range: {
        start: { line: 68, character: 15 },
        end: { line: 68, character: 24 },
      },
    },
  },
  {
    name: "buildTree",
    kind: 6,
    location: {
      uri: "file:///mock/projects/opencode-demo/src/features/files/FileTree.tsx",
      range: {
        start: { line: 91, character: 10 },
        end: { line: 91, character: 19 },
      },
    },
  },
];

/** A client whose `get` is a controllable mock resolving to path arrays. */
function mockClient() {
  const client = {
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => []),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

function input(): HTMLInputElement {
  return screen.getByTestId("quick-open-input") as HTMLInputElement;
}

function rows(): HTMLElement[] {
  return screen.getAllByRole("option");
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetViewer(SERVER);
  resetProject(SERVER);
  setActiveServer(SERVER);
  setCurrent(SERVER, DIRECTORY);
  getApiClientMock.mockReset();
  mockClient();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  resetViewer(SERVER);
  resetProject(SERVER);
  setActiveServer(null);
});

describe("QuickOpen open/close lifecycle", () => {
  it("is inert while closed", () => {
    render(() => <QuickOpen serverId={SERVER} open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId("quick-open-dialog")).not.toBeInTheDocument();
  });

  it("opens with the search input focused and the recent view", () => {
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);
    expect(screen.getByTestId("quick-open-dialog")).toBeInTheDocument();
    expect(input()).toHaveFocus();
    expect(screen.getByTestId("quick-open-no-recent")).toBeInTheDocument();
  });

  it("lists recent files for an empty query, most recent first", () => {
    localStorage.setItem("oc-recent-files:srv-quick", JSON.stringify(["src/app.ts", "README.md"]));
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    expect(screen.getByTestId("quick-open-recent-header")).toBeInTheDocument();
    expect(rows().map((row) => row.textContent)).toEqual(["src/app.ts", "README.md"]);
  });

  it("reopening resets the query and cancels a pending debounce", async () => {
    const client = mockClient();
    const [open, setOpen] = createSignal(false);
    const onClose = vi.fn();
    render(() => <QuickOpen serverId={SERVER} open={open()} onClose={onClose} />);

    setOpen(true);
    fireEvent.input(input(), { target: { value: "rea" } });
    setOpen(false);
    setOpen(true);

    expect(input().value).toBe("");
    expect(screen.getByTestId("quick-open-no-recent")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(client.get).not.toHaveBeenCalled();
  });

  it("Esc closes through the dialog", () => {
    const onClose = vi.fn();
    render(() => <QuickOpen serverId={SERVER} open onClose={onClose} />);

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("QuickOpen search", () => {
  it("debounces typing by 150ms then fetches and renders ranked results", async () => {
    const client = mockClient();
    client.get.mockResolvedValue(["src/readme.md", "README.txt", "src/app.ts"]);
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "rea" } });
    expect(client.get).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(client.get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(client.get).toHaveBeenCalledWith("/find/file", { query: { query: "rea" } });
    // Ranked display: prefix matches first (README.txt), then substring
    // (src/readme.md), then the server's other fuzzy match (src/app.ts).
    expect(rows().map((row) => row.textContent)).toEqual([
      "README.txt",
      "src/readme.md",
      "src/app.ts",
    ]);
  });

  it("collapses rapid keystrokes into a single fetch", async () => {
    const client = mockClient();
    client.get.mockResolvedValue(["a.ts"]);
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "a" } });
    fireEvent.input(input(), { target: { value: "ab" } });
    fireEvent.input(input(), { target: { value: "abc" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith("/find/file", { query: { query: "abc" } });
  });

  it("drops a stale in-flight response", async () => {
    const client = mockClient();
    const pending: Array<(value: string[]) => void> = [];
    client.get.mockImplementation(() => new Promise<string[]>((resolve) => pending.push(resolve)));
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "a" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pending).toHaveLength(1);

    fireEvent.input(input(), { target: { value: "ab" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pending).toHaveLength(2);

    // The newer query resolves first, then the stale one comes back late.
    pending[1](["src/new.ts"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(rows().map((row) => row.textContent)).toEqual(["src/new.ts"]);

    pending[0](["zzz-stale.ts"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(rows().map((row) => row.textContent)).toEqual(["src/new.ts"]);
  });

  it("shows a loading row while the first fetch is in flight", async () => {
    const client = mockClient();
    client.get.mockImplementation(() => new Promise(() => {}));
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "rea" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(screen.getByTestId("quick-open-loading")).toBeInTheDocument();
  });

  it("shows the empty state when no files match", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([]);
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "zzz" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(screen.getByTestId("quick-open-empty")).toBeInTheDocument();
  });

  it("shows the empty state when the search fails", async () => {
    const client = mockClient();
    client.get.mockRejectedValue(new Error("boom"));
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "rea" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(screen.getByTestId("quick-open-empty")).toBeInTheDocument();
  });

  it("clearing the query returns to the recent view and cancels in-flight work", async () => {
    const client = mockClient();
    localStorage.setItem("oc-recent-files:srv-quick", JSON.stringify(["README.md"]));
    client.get.mockResolvedValue(["README.md"]);
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "rea" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(rows().map((row) => row.textContent)).toEqual(["README.md"]);

    fireEvent.input(input(), { target: { value: "" } });
    expect(screen.getByTestId("quick-open-recent-header")).toBeInTheDocument();
    expect(rows().map((row) => row.textContent)).toEqual(["README.md"]);
  });
});

describe("QuickOpen keyboard navigation and opening", () => {
  function selectedPath(): string {
    const active = rows().find((row) => row.getAttribute("aria-selected") === "true");
    return active?.textContent ?? "";
  }

  it("↑↓ wrap through the results and Enter opens the selected file", async () => {
    const onClose = vi.fn();
    const onOpenFile = vi.fn();
    const client = mockClient();
    client.get.mockResolvedValue(["a.ts", "b.ts", "c.ts"]);
    render(() => <QuickOpen serverId={SERVER} open onClose={onClose} onOpenFile={onOpenFile} />);
    fireEvent.input(input(), { target: { value: "t" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(selectedPath()).toBe("a.ts");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedPath()).toBe("b.ts");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    // Wrapped past the last row back to the first.
    expect(selectedPath()).toBe("a.ts");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selectedPath()).toBe("c.ts");

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(viewer[SERVER]?.tabs.map((tab) => tab.path)).toEqual(["c.ts"]);
    expect(viewer[SERVER]?.activePath).toBe("c.ts");
    expect(readRecentFiles(SERVER)).toEqual(["c.ts"]);
    expect(onOpenFile).toHaveBeenCalledWith("c.ts");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Enter with no results", async () => {
    const onClose = vi.fn();
    const onOpenFile = vi.fn();
    const client = mockClient();
    client.get.mockResolvedValue([]);
    render(() => <QuickOpen serverId={SERVER} open onClose={onClose} onOpenFile={onOpenFile} />);
    fireEvent.input(input(), { target: { value: "zzz" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("a click opens the file with the same side effects", async () => {
    const onClose = vi.fn();
    const onOpenFile = vi.fn();
    const client = mockClient();
    client.get.mockResolvedValue(["a.ts", "b.ts"]);
    render(() => <QuickOpen serverId={SERVER} open onClose={onClose} onOpenFile={onOpenFile} />);
    fireEvent.input(input(), { target: { value: "t" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    fireEvent.click(screen.getByTestId("quick-open-item-b.ts"));
    expect(viewer[SERVER]?.tabs.map((tab) => tab.path)).toEqual(["b.ts"]);
    expect(readRecentFiles(SERVER)).toEqual(["b.ts"]);
    expect(onOpenFile).toHaveBeenCalledWith("b.ts");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a recent file opens from the empty-query view", async () => {
    localStorage.setItem("oc-recent-files:srv-quick", JSON.stringify(["README.md"]));
    const onClose = vi.fn();
    const onOpenFile = vi.fn();
    render(() => <QuickOpen serverId={SERVER} open onClose={onClose} onOpenFile={onOpenFile} />);

    fireEvent.click(screen.getByTestId("quick-open-item-README.md"));
    expect(viewer[SERVER]?.tabs.map((tab) => tab.path)).toEqual(["README.md"]);
    expect(readRecentFiles(SERVER)).toEqual(["README.md"]);
    expect(onOpenFile).toHaveBeenCalledWith("README.md");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("QuickOpen symbol mode (#)", () => {
  it("fetches /find/symbol with the stripped term and renders kind + name + path", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([SYMBOL_ROWS[0]]);
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "#Pro" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(client.get).toHaveBeenCalledWith("/find/symbol", { query: { query: "Pro" } });
    const row = screen.getByTestId("quick-open-symbol-PromptBox");
    expect(row.textContent).toContain("ƒ");
    expect(row.textContent).toContain("PromptBox");
    expect(row.textContent).toContain("src/features/sessions/PromptBox.tsx");
  });

  it("↑↓ navigate and Enter jumps to the file and its 1-based line", async () => {
    const onClose = vi.fn();
    const onOpenFile = vi.fn();
    const client = mockClient();
    client.get.mockResolvedValue(SYMBOL_ROWS);
    render(() => <QuickOpen serverId={SERVER} open onClose={onClose} onOpenFile={onOpenFile} />);

    fireEvent.input(input(), { target: { value: "#build" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(rows()).toHaveLength(2);

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });

    const path = "src/features/files/FileTree.tsx";
    expect(viewer[SERVER]?.tabs.map((tab) => tab.path)).toEqual([path]);
    expect(viewer[SERVER]?.activeLine).toEqual({ path, line: 92 });
    expect(onOpenFile).toHaveBeenCalledWith(path);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a click jumps to the symbol with the same side effects", async () => {
    const onClose = vi.fn();
    const onOpenFile = vi.fn();
    const client = mockClient();
    client.get.mockResolvedValue(SYMBOL_ROWS);
    render(() => <QuickOpen serverId={SERVER} open onClose={onClose} onOpenFile={onOpenFile} />);

    fireEvent.input(input(), { target: { value: "#Prompt" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    fireEvent.click(screen.getByTestId("quick-open-symbol-PromptBox"));

    const path = "src/features/sessions/PromptBox.tsx";
    expect(viewer[SERVER]?.tabs.map((tab) => tab.path)).toEqual([path]);
    expect(viewer[SERVER]?.activeLine).toEqual({ path, line: 69 });
    expect(onOpenFile).toHaveBeenCalledWith(path);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to the file search when the # trigger is removed", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([]);
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "#zzz" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(screen.getByTestId("quick-open-symbols-empty")).toBeInTheDocument();

    fireEvent.input(input(), { target: { value: "zzz" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(client.get).toHaveBeenLastCalledWith("/find/file", { query: { query: "zzz" } });
    expect(screen.getByTestId("quick-open-empty")).toBeInTheDocument();
  });

  it("shows the no-symbols empty state when the LSP returns nothing", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([]);
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "#build" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(screen.getByTestId("quick-open-symbols-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-open-empty")).not.toBeInTheDocument();
  });

  it("collapses rapid # keystrokes into a single symbol fetch", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([SYMBOL_ROWS[0]]);
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "#" } });
    fireEvent.input(input(), { target: { value: "#P" } });
    fireEvent.input(input(), { target: { value: "#Pr" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith("/find/symbol", { query: { query: "Pr" } });
  });

  it("drops a stale symbol response", async () => {
    const client = mockClient();
    const pending: Array<(value: unknown[]) => void> = [];
    client.get.mockImplementation(() => new Promise<unknown[]>((resolve) => pending.push(resolve)));
    render(() => <QuickOpen serverId={SERVER} open onClose={vi.fn()} />);

    fireEvent.input(input(), { target: { value: "#a" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pending).toHaveLength(1);

    fireEvent.input(input(), { target: { value: "#ab" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pending).toHaveLength(2);

    // The newer query resolves first, then the stale one comes back late.
    pending[1]([SYMBOL_ROWS[0]]);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("quick-open-symbol-PromptBox")).toBeInTheDocument();

    pending[0]([{ ...SYMBOL_ROWS[1] }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByTestId("quick-open-symbol-buildTree")).not.toBeInTheDocument();
    expect(screen.getByTestId("quick-open-symbol-PromptBox")).toBeInTheDocument();
  });
});
