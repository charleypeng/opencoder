// Pure command-palette result building (TASK-M8-02): consumes the six raw
// sources — the per-server sessions, ranked `/find/file` rows, `/find/
// symbol` hits, the slash-command catalog, the static settings actions and
// the server registry — plus the query, and produces the display groups in
// fixed section order (Sessions / Files / Symbols / Commands / Settings /
// Servers) with every empty section dropped. Local sources (sessions,
// commands, settings, servers) are filtered here; files and symbols arrive
// pre-filtered from the server and pass through unchanged (both stay
// hidden for an empty query, which shows the action overview instead).
// Pure so the L1 tests can pin the grouping, ordering and filtering
// without rendering the dialog.

import type { Session } from "../../services/session.js";
import type { Command } from "../../services/command.js";
import type { ServerEntry } from "../../services/servers.js";
import type { RankedEntry } from "../../features/files/rankResults.js";
import type { SymbolHit } from "../../features/files/symbols.js";

export type PaletteKind = "session" | "file" | "symbol" | "command" | "setting" | "server";

export type PaletteSectionId =
  "sessions" | "files" | "symbols" | "commands" | "settings" | "servers";

export type PaletteItem =
  | { section: "sessions"; kind: "session"; key: string; sessionId: string; title: string }
  | { section: "files"; kind: "file"; key: string; path: string }
  | {
      section: "symbols";
      kind: "symbol";
      key: string;
      name: string;
      symbolKind: number;
      path: string;
      line: number;
    }
  | { section: "commands"; kind: "command"; key: string; name: string; description: string }
  | {
      section: "settings";
      kind: "setting";
      key: string;
      settingId: string;
      label: string;
      hint: string;
    }
  | {
      section: "servers";
      kind: "server";
      key: string;
      serverId: string;
      name: string;
      url: string;
    };

export interface PaletteGroup {
  section: PaletteSectionId;
  label: string;
  items: PaletteItem[];
}

/** A static Settings-section action. */
export interface SettingAction {
  id: string;
  label: string;
  hint: string;
}

/**
 * The settings section catalog. Theme toggling is owned by M9-03 and is
 * deliberately absent here until that task lands.
 */
export const SETTING_ACTIONS: SettingAction[] = [
  { id: "new-session", label: "New session", hint: "Start a new chat session" },
  { id: "open-settings", label: "Open settings", hint: "Open the settings view" },
  { id: "toggle-sidebar", label: "Toggle sidebar", hint: "Show or hide the sidebar" },
  { id: "open-terminal", label: "Open terminal", hint: "Open the terminal view" },
  { id: "open-diff", label: "Open session diff", hint: "Review the active session's changes" },
];

export interface PaletteBuildInput {
  /** The trimmed palette query. */
  query: string;
  /** The per-server sessions in store order (most recently updated first). */
  sessions: Session[];
  /** Ranked `/find/file` rows (hidden for an empty query). */
  files: RankedEntry[];
  /** `/find/symbol` hits (hidden for an empty query). */
  symbols: SymbolHit[];
  /** The slash-command catalog (all listed for an empty query). */
  commands: Command[];
  /** The server registry rows for the Servers section. */
  servers: ServerEntry[];
  /** Gates the Commands section and the diff action on an open session. */
  hasActiveSession: boolean;
}

/** Whether any of the fields contains the (already-lowercased) query. */
function matches(fields: string[], query: string): boolean {
  return fields.some((field) => field.toLowerCase().includes(query));
}

/**
 * Builds the palette groups for the given sources and query. Sections
 * follow the fixed order; empty sections are dropped. The pure builder
 * never performs side effects — execution happens in the dialog.
 */
export function buildPaletteItems(input: PaletteBuildInput): PaletteGroup[] {
  const q = input.query.trim().toLowerCase();
  const groups: PaletteGroup[] = [];

  const sessions = input.sessions
    .filter((session) => q === "" || matches([session.title, session.slug], q))
    .map((session): PaletteItem => ({
      section: "sessions",
      kind: "session",
      key: session.id,
      sessionId: session.id,
      title: session.title || session.slug || session.id,
    }));
  if (sessions.length > 0) {
    groups.push({ section: "sessions", label: "Sessions", items: sessions });
  }

  if (q !== "" && input.files.length > 0) {
    groups.push({
      section: "files",
      label: "Files",
      items: input.files.map((entry): PaletteItem => ({
        section: "files",
        kind: "file",
        key: entry.path,
        path: entry.path,
      })),
    });
  }

  if (q !== "" && input.symbols.length > 0) {
    groups.push({
      section: "symbols",
      label: "Symbols",
      items: input.symbols.map((hit): PaletteItem => ({
        section: "symbols",
        kind: "symbol",
        key: `${hit.name}:${hit.path}:${hit.line}`,
        name: hit.name,
        symbolKind: hit.kind,
        path: hit.path,
        line: hit.line,
      })),
    });
  }

  if (input.hasActiveSession && input.commands.length > 0) {
    const commands = input.commands
      .filter((command) => q === "" || matches([command.name, command.description ?? ""], q))
      .map((command): PaletteItem => ({
        section: "commands",
        kind: "command",
        key: command.name,
        name: command.name,
        description: command.description ?? "",
      }));
    if (commands.length > 0) {
      groups.push({ section: "commands", label: "Commands", items: commands });
    }
  }

  const settings = SETTING_ACTIONS.filter(
    (action) => action.id !== "open-diff" || input.hasActiveSession,
  )
    .filter((action) => q === "" || matches([action.label, action.hint], q))
    .map((action): PaletteItem => ({
      section: "settings",
      kind: "setting",
      key: action.id,
      settingId: action.id,
      label: action.label,
      hint: action.hint,
    }));
  if (settings.length > 0) {
    groups.push({ section: "settings", label: "Settings", items: settings });
  }

  const servers = input.servers
    .filter((server) => q === "" || matches([server.name, server.url], q))
    .map((server): PaletteItem => ({
      section: "servers",
      kind: "server",
      key: server.id,
      serverId: server.id,
      name: server.name,
      url: server.url,
    }));
  if (servers.length > 0) {
    groups.push({ section: "servers", label: "Servers", items: servers });
  }

  return groups;
}
