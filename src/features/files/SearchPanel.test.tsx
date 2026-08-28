// L2 tests for the full-text search panel (TASK-M4-05): typing debounces
// 300ms then fetches /find (rapid keystrokes collapse, stale in-flight
// responses are dropped), Enter runs the search immediately, results
// render grouped by file with the hit spans highlighted from the server's
// submatches, a click opens the viewer tab and targets the hit line, the
// regex toggle validates the pattern client-side (an invalid one never
// fetches) and passes the mock-only regex=true flag, and the idle /
// loading / no-matches / error states render. Clearing the query returns
// to idle and cancels pending + in-flight work.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { resetServer as resetViewer, viewer } from "../../stores/viewer";
import { resetServer as resetProjects, setCurrent } from "../../stores/project";
import { setActiveServer } from "../../stores/registry";
import type { FindMatch } from "../../services/find";
import SearchPanel from "./SearchPanel";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-search";
const DEBOUNCE_MS = 300;

function match(path: string, line: string, lineNumber: number, hit: string): FindMatch {
  const start = line.indexOf(hit);
  return {
    path: { text: path },
    lines: { text: line },
    line_number: lineNumber,
    absolute_offset: 0,
    submatches: start === -1 ? [] : [{ match: { text: hit }, start, end: start + hit.length }],
  };
}

function searchFixture(): FindMatch[] {
  return [
    match("src/a.ts", "const createSignal = 1;", 4, "createSignal"),
    match("src/a.ts", "call createSignal(2);", 9, "createSignal"),
    match("README.md", "# Demo", 1, "Demo"),
  ];
}

/** A client whose `get` is a controllable mock resolving to match arrays. */
function mockClient() {
  const client = {
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => []),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

function input(): HTMLInputElement {
  return screen.getByTestId("search-input") as HTMLInputElement;
}

function toggle(): HTMLButtonElement {
  return screen.getByTestId("search-regex-toggle") as HTMLButtonElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetViewer(SERVER);
  getApiClientMock.mockReset();
  mockClient();
});

afterEach(() => {
  vi.useRealTimers();
  resetViewer(SERVER);
  resetProjects(SERVER);
});

describe("SearchPanel search flow", () => {
  it("shows the idle hint with an empty query and never fetches", () => {
    const client = mockClient();
    render(() => <SearchPanel serverId={SERVER} />);

    expect(screen.getByTestId("search-idle")).toBeInTheDocument();
    fireEvent.input(input(), { target: { value: "" } });
    expect(client.get).not.toHaveBeenCalled();
  });

  it("debounces typing by 300ms then fetches and renders grouped results", async () => {
    const client = mockClient();
    client.get.mockResolvedValue(searchFixture());
    render(() => <SearchPanel serverId={SERVER} />);

    fireEvent.input(input(), { target: { value: "createSignal" } });
    expect(client.get).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(client.get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(client.get).toHaveBeenCalledWith("/find", {
      query: { pattern: "createSignal" },
    });
    // Grouped by file in first-seen order with counts per group.
    expect(screen.getByTestId("search-group-src/a.ts")).toBeInTheDocument();
    expect(screen.getByTestId("search-group-README.md")).toBeInTheDocument();
    expect(screen.getByTestId("search-group-src/a.ts")).toHaveTextContent("2");
    expect(screen.getByTestId("search-hit-src/a.ts-4")).toBeInTheDocument();
    expect(screen.getByTestId("search-hit-src/a.ts-9")).toBeInTheDocument();
    // The hit spans highlight the matched text.
    const marks = screen.getAllByTestId("search-hit-mark");
    expect(marks.map((mark) => mark.textContent)).toEqual(["createSignal", "createSignal", "Demo"]);
  });

  it("collapses rapid keystrokes into a single fetch", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([]);
    render(() => <SearchPanel serverId={SERVER} />);

    fireEvent.input(input(), { target: { value: "a" } });
    fireEvent.input(input(), { target: { value: "ab" } });
    fireEvent.input(input(), { target: { value: "abc" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith("/find", { query: { pattern: "abc" } });
  });

  it("drops a stale in-flight response", async () => {
    const client = mockClient();
    const pending: Array<(value: FindMatch[]) => void> = [];
    client.get.mockImplementation(
      () => new Promise<FindMatch[]>((resolve) => pending.push(resolve)),
    );
    render(() => <SearchPanel serverId={SERVER} />);

    fireEvent.input(input(), { target: { value: "a" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pending).toHaveLength(1);

    fireEvent.input(input(), { target: { value: "ab" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pending).toHaveLength(2);

    // The newer query resolves first, then the stale one comes back late.
    pending[1]([match("src/new.ts", "new ab", 1, "ab")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("search-hit-src/new.ts-1")).toBeInTheDocument();

    pending[0]([match("src/stale.ts", "old a", 2, "a")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByTestId("search-hit-src/stale.ts-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("search-hit-src/new.ts-1")).toBeInTheDocument();
  });

  it("Enter runs the search immediately without waiting for the debounce", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([]);
    render(() => <SearchPanel serverId={SERVER} />);

    fireEvent.input(input(), { target: { value: "sig" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await vi.advanceTimersByTimeAsync(0);

    expect(client.get).toHaveBeenCalledTimes(1);
    // No second fetch fires when the debounce would have elapsed.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it("clearing the query returns to idle and cancels pending + in-flight work", async () => {
    const client = mockClient();
    const pending: Array<(value: FindMatch[]) => void> = [];
    client.get.mockImplementation(
      () => new Promise<FindMatch[]>((resolve) => pending.push(resolve)),
    );
    render(() => <SearchPanel serverId={SERVER} />);

    fireEvent.input(input(), { target: { value: "sig" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pending).toHaveLength(1);

    fireEvent.input(input(), { target: { value: "" } });
    expect(screen.getByTestId("search-idle")).toBeInTheDocument();

    // The debounce timer is cancelled and the stale response is dropped.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    pending[0](searchFixture());
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByTestId("search-hit-src/a.ts-4")).not.toBeInTheDocument();
  });
});

describe("SearchPanel states", () => {
  it("shows a loading row while the first fetch is in flight", async () => {
    const client = mockClient();
    client.get.mockImplementation(() => new Promise(() => {}));
    render(() => <SearchPanel serverId={SERVER} />);

    fireEvent.input(input(), { target: { value: "sig" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(screen.getByTestId("search-loading")).toBeInTheDocument();
  });

  it("shows the no-matches state when nothing matches", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([]);
    render(() => <SearchPanel serverId={SERVER} />);

    fireEvent.input(input(), { target: { value: "zzz" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    // Without an active directory the plain no-matches copy renders.
    expect(screen.getByTestId("search-empty")).toBeInTheDocument();
    expect(screen.getByTestId("search-empty")).toHaveTextContent("No matches");
  });

  it("names the searched directory in the no-matches state (audit §3)", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([]);
    setActiveServer(SERVER);
    setCurrent(SERVER, "/mock/projects/demo");
    try {
      render(() => <SearchPanel serverId={SERVER} />);

      fireEvent.input(input(), { target: { value: "zzz" } });
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

      expect(screen.getByTestId("search-empty")).toHaveTextContent(
        "No matches in /mock/projects/demo",
      );
    } finally {
      setCurrent(SERVER, null);
      setActiveServer(null);
    }
  });

  it("shows an inline error when the search fails", async () => {
    const client = mockClient();
    client.get.mockRejectedValue(new Error("boom"));
    render(() => <SearchPanel serverId={SERVER} />);

    fireEvent.input(input(), { target: { value: "sig" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(screen.getByTestId("search-error")).toBeInTheDocument();
    expect(screen.getByTestId("search-error")).toHaveTextContent("boom");
  });
});

describe("SearchPanel regex mode", () => {
  it("toggles the mode and re-runs the current query with the regex flag", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([match("src/a.ts", "const createSignal = 1;", 4, "createSignal")]);
    render(() => <SearchPanel serverId={SERVER} />);

    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    fireEvent.input(input(), { target: { value: "createSignal" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(client.get).toHaveBeenCalledWith("/find", { query: { pattern: "createSignal" } });

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    await vi.advanceTimersByTimeAsync(0);

    expect(client.get).toHaveBeenLastCalledWith("/find", {
      query: { pattern: "createSignal", regex: "true" },
    });
  });

  it("shows an error hint for an invalid regex and never fetches", async () => {
    const client = mockClient();
    render(() => <SearchPanel serverId={SERVER} />);

    fireEvent.click(toggle());
    fireEvent.input(input(), { target: { value: "((" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(client.get).not.toHaveBeenCalled();
    expect(screen.getByTestId("search-regex-error")).toBeInTheDocument();
    expect(screen.getByTestId("search-regex-error")).toHaveTextContent(
      "Invalid regular expression",
    );
  });

  it("searches again once a valid regex replaces the invalid one", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([match("src/a.ts", "const createSignal = 1;", 4, "createSignal")]);
    render(() => <SearchPanel serverId={SERVER} />);

    fireEvent.click(toggle());
    fireEvent.input(input(), { target: { value: "((" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(client.get).not.toHaveBeenCalled();

    fireEvent.input(input(), { target: { value: "create\\w+" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(client.get).toHaveBeenCalledWith("/find", {
      query: { pattern: "create\\w+", regex: "true" },
    });
    expect(screen.queryByTestId("search-regex-error")).not.toBeInTheDocument();
  });
});

describe("SearchPanel hit navigation", () => {
  it("a click opens the tab and targets the hit line", async () => {
    const client = mockClient();
    const onOpenHit = vi.fn();
    client.get.mockResolvedValue(searchFixture());
    render(() => <SearchPanel serverId={SERVER} onOpenHit={onOpenHit} />);

    fireEvent.input(input(), { target: { value: "createSignal" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    fireEvent.click(screen.getByTestId("search-hit-src/a.ts-9"));
    expect(viewer[SERVER]?.tabs.map((tab) => tab.path)).toEqual(["src/a.ts"]);
    expect(viewer[SERVER]?.activePath).toBe("src/a.ts");
    expect(viewer[SERVER]?.activeLine).toEqual({ path: "src/a.ts", line: 9 });
    expect(onOpenHit).toHaveBeenCalledWith("src/a.ts");

    // The panel keeps its results for the round trip to the viewer.
    expect(screen.getByTestId("search-hit-src/a.ts-4")).toBeInTheDocument();
  });
});
