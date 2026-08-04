// L1 tests for the command-palette result builder (TASK-M8-02): pins the
// fixed section order (Sessions / Files / Symbols / Commands / Settings /
// Servers), the empty-section dropping, the synchronous local filtering
// (sessions by title/slug, commands by name/description, settings by
// label/hint, servers by name/url), the files/symbols pass-through rules
// (hidden for an empty query, shown as-is otherwise), the store-order
// session listing, and the active-session gating (no Commands section and
// no diff action without an open session).

import { describe, expect, it } from "vitest";
import { buildPaletteItems, SETTING_ACTIONS, type PaletteBuildInput } from "./paletteItems.js";
import type { Session } from "../../services/session.js";
import type { Command } from "../../services/command.js";
import type { ServerEntry } from "../../services/servers.js";
import type { RankedEntry } from "../../features/files/rankResults.js";
import type { SymbolHit } from "../../features/files/symbols.js";
import type { PaletteItem } from "./paletteItems.js";

/** Narrow a mixed item list to one variant (the builder types items as
 *  the full union, so tests narrow before touching variant fields). */
function narrow<T extends PaletteItem["kind"]>(
  items: PaletteItem[],
  kind: T,
): Array<Extract<PaletteItem, { kind: T }>> {
  return items.filter((item): item is Extract<PaletteItem, { kind: T }> => item.kind === kind);
}

function session(id: string, title: string, slug = id): Session {
  return {
    id,
    slug,
    title,
    projectID: "project-1",
    directory: "/mock/projects/demo",
    version: "1.18.11",
    time: { created: 1, updated: 1 },
  } as Session;
}

function command(name: string, description: string): Command {
  return { name, description, template: "", hints: [] } as Command;
}

function server(id: string, name: string, url: string): ServerEntry {
  return { id, name, url, createdAt: 1 };
}

function file(path: string): RankedEntry {
  return { path, bucket: 0, recentIndex: -1 };
}

function symbol(name: string, path = "src/a.ts", line = 1): SymbolHit {
  return { name, kind: 12, path, line };
}

function input(overrides: Partial<PaletteBuildInput>): PaletteBuildInput {
  return {
    query: "",
    sessions: [],
    files: [],
    symbols: [],
    commands: [],
    servers: [],
    hasActiveSession: true,
    ...overrides,
  };
}

function sections(overrides: Partial<PaletteBuildInput>): string[] {
  return buildPaletteItems(input(overrides)).map((group) => group.section);
}

describe("buildPaletteItems section ordering", () => {
  it("renders every section in the fixed order when all sources match", () => {
    const groups = buildPaletteItems(
      input({
        query: "s",
        sessions: [session("s1", "Sessions test")],
        files: [file("src/a.ts")],
        symbols: [symbol("setup")],
        commands: [command("start", "Server start")],
        servers: [server("sv1", "Alpha", "http://srv.local:14096")],
      }),
    );
    expect(groups.map((group) => group.section)).toEqual([
      "sessions",
      "files",
      "symbols",
      "commands",
      "settings",
      "servers",
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Sessions",
      "Files",
      "Symbols",
      "Commands",
      "Settings",
      "Servers",
    ]);
  });

  it("shows the action overview (sessions/commands/settings/servers) for an empty query", () => {
    expect(
      sections(
        input({
          sessions: [session("s1", "Fix the bug")],
          files: [file("src/a.ts")],
          symbols: [symbol("setup")],
          commands: [command("init", "Initialize")],
          servers: [server("sv1", "Alpha", "http://a.local:14096")],
        }),
      ),
    ).toEqual(["sessions", "commands", "settings", "servers"]);
  });

  it("hides every empty section", () => {
    expect(
      sections(
        input({
          query: "zzz-no-match",
          sessions: [session("s1", "Fix the bug")],
          commands: [command("init", "Initialize")],
          servers: [server("sv1", "Alpha", "http://a.local:14096")],
        }),
      ),
    ).toEqual([]);
  });

  it("keeps the store's session order (most recently updated first)", () => {
    const groups = buildPaletteItems(
      input({ sessions: [session("s1", "First", "s1"), session("s2", "Second", "s2")] }),
    );
    expect(narrow(groups[0].items, "session").map((item) => item.sessionId)).toEqual(["s1", "s2"]);
  });
});

describe("buildPaletteItems local filtering", () => {
  it("filters sessions by title and slug, case-insensitively", () => {
    const groups = buildPaletteItems(
      input({
        query: "fix",
        sessions: [
          session("s1", "Fix the bug"),
          session("s2", "Build the app"),
          session("s3", "Other work", "slug-with-fix"),
        ],
      }),
    );
    expect(narrow(groups[0].items, "session").map((item) => item.sessionId)).toEqual(["s1", "s3"]);
    expect(narrow(groups[0].items, "session")[0]).toMatchObject({
      kind: "session",
      title: "Fix the bug",
    });
  });

  it("falls back to the slug for the row title when the title is empty", () => {
    const groups = buildPaletteItems(input({ sessions: [session("s1", "", "untitled-slug")] }));
    expect(narrow(groups[0].items, "session")[0].title).toBe("untitled-slug");
  });

  it("filters commands by name and description", () => {
    const groups = buildPaletteItems(
      input({
        query: "deep",
        commands: [command("think", "Think deeply about a topic"), command("init", "Initialize")],
      }),
    );
    expect(groups[0].items.map((item) => item.key)).toEqual(["think"]);
  });

  it("lists every command for an empty query", () => {
    const groups = buildPaletteItems(
      input({ commands: [command("init", "Initialize"), command("think", "Think")] }),
    );
    expect(groups[0].items.map((item) => item.key)).toEqual(["init", "think"]);
  });

  it("filters settings by label and hint", () => {
    const groups = buildPaletteItems(input({ query: "sidebar" }));
    expect(narrow(groups[0].items, "setting").map((item) => item.settingId)).toEqual([
      "toggle-sidebar",
    ]);
  });

  it("filters servers by name and url", () => {
    const groups = buildPaletteItems(
      input({
        query: "beta",
        servers: [
          server("s1", "Alpha", "http://alpha.local:14096"),
          server("s2", "Gamma", "http://beta.local:14096"),
        ],
      }),
    );
    expect(narrow(groups[0].items, "server").map((item) => item.serverId)).toEqual(["s2"]);
  });
});

describe("buildPaletteItems files and symbols", () => {
  it("passes files through for a non-empty query with the ranked order", () => {
    const groups = buildPaletteItems(
      input({
        query: "rea",
        files: [file("src/readme.md"), file("README.txt")],
      }),
    );
    expect(groups[0].items).toEqual([
      { section: "files", kind: "file", key: "src/readme.md", path: "src/readme.md" },
      { section: "files", kind: "file", key: "README.txt", path: "README.txt" },
    ]);
  });

  it("passes symbols through with their jump fields", () => {
    const groups = buildPaletteItems(
      input({
        query: "#pro",
        symbols: [symbol("PromptBox", "src/sessions/PromptBox.tsx", 69)],
      }),
    );
    expect(groups[0].items[0]).toEqual({
      section: "symbols",
      kind: "symbol",
      key: "PromptBox:src/sessions/PromptBox.tsx:69",
      name: "PromptBox",
      symbolKind: 12,
      path: "src/sessions/PromptBox.tsx",
      line: 69,
    });
  });

  it("stays hidden for an empty query even when rows are provided", () => {
    expect(
      sections(input({ files: [file("src/a.ts")], symbols: [symbol("setup")] })),
    ).not.toContain("files");
    expect(
      sections(input({ files: [file("src/a.ts")], symbols: [symbol("setup")] })),
    ).not.toContain("symbols");
  });
});

describe("buildPaletteItems active-session gating", () => {
  it("drops the Commands section and the diff action without an open session", () => {
    const groups = buildPaletteItems(
      input({
        hasActiveSession: false,
        commands: [command("init", "Initialize")],
      }),
    );
    expect(groups.map((group) => group.section)).not.toContain("commands");
    const settings = groups.find((group) => group.section === "settings");
    expect(narrow(settings?.items ?? [], "setting").map((item) => item.settingId)).toEqual(
      SETTING_ACTIONS.filter((action) => action.id !== "open-diff").map((action) => action.id),
    );
  });

  it("includes the diff action with an open session", () => {
    const groups = buildPaletteItems(input({}));
    const settings = groups.find((group) => group.section === "settings");
    expect(narrow(settings?.items ?? [], "setting").map((item) => item.settingId)).toContain(
      "open-diff",
    );
  });
});
