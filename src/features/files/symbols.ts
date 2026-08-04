// Workspace symbol helpers (TASK-M4-06): pure extraction of jump targets
// from `/find/symbol` results plus the QuickOpen `#` mode detection. LSP
// positions are 0-based, so hits carry a 1-based target line for the
// viewer's data-line tags (same convention as the SearchPanel hits).

import type { Symbol } from "../../services/find.js";

export interface SymbolHit {
  name: string;
  /** LSP SymbolKind number (5 class, 6 method, 11 interface, 12 function,
   *  13 variable, 14 constant). */
  kind: number;
  /** Workspace path derived from the location URI. */
  path: string;
  /** 1-based target line (the LSP start line is 0-based). */
  line: number;
}

/** True when the query opens the symbol mode: a `#` plus at least one more
 *  character ("#f" searches symbols, "#" alone still searches files). */
export function isSymbolQuery(value: string): boolean {
  return value.startsWith("#") && value.trim().length > 1;
}

/** Strips the `#` trigger to the term the server searches for. */
export function symbolQueryOf(value: string): string {
  return value.slice(1).trim();
}

/** Glyph for an LSP SymbolKind; a neutral dot for unmapped kinds. */
export function symbolKindIcon(kind: number): string {
  switch (kind) {
    case 5:
      return "◇"; // class
    case 6:
      return "m"; // method
    case 11:
      return "i"; // interface
    case 12:
      return "ƒ"; // function
    case 13:
      return "v"; // variable
    case 14:
      return "c"; // constant
    default:
      return "•";
  }
}

/** Workspace-relative path for a symbol location URI: strips the `file://`
 *  scheme and the project directory prefix, falling back to the bare
 *  pathname when no directory is known. */
export function symbolPath(uri: string, directory?: string): string {
  const pathname = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
  const root = directory?.replace(/\/+$/, "") ?? "";
  if (root !== "" && pathname.startsWith(root)) {
    return pathname.slice(root.length).replace(/^\/+/, "");
  }
  return pathname.replace(/^\/+/, "");
}

/** Maps one raw Symbol into a jumpable hit (0-based start line -> 1-based). */
export function symbolHitOf(symbol: Symbol, directory?: string): SymbolHit {
  return {
    name: symbol.name,
    kind: symbol.kind,
    path: symbolPath(symbol.location.uri, directory),
    line: symbol.location.range.start.line + 1,
  };
}
