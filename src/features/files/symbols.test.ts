// L1 tests for the symbol helpers (TASK-M4-06): `#` mode detection strips
// the trigger correctly, the kind icon map covers the fixture kinds, the
// file:// URI becomes a workspace path under the active directory, and
// symbol hits convert the 0-based LSP start line to the viewer's 1-based
// target line.

import { describe, expect, it } from "vitest";
import type { Symbol } from "../../services/find.js";
import {
  isSymbolQuery,
  symbolHitOf,
  symbolKindIcon,
  symbolPath,
  symbolQueryOf,
} from "./symbols.js";

const DIRECTORY = "/mock/projects/opencode-demo";

describe("isSymbolQuery", () => {
  it("is true for a #-prefixed query with a term", () => {
    expect(isSymbolQuery("#PromptBox")).toBe(true);
    expect(isSymbolQuery("#p")).toBe(true);
  });

  it("is false for bare #, plain text and empty input", () => {
    expect(isSymbolQuery("#")).toBe(false);
    expect(isSymbolQuery("# ")).toBe(false);
    expect(isSymbolQuery("PromptBox")).toBe(false);
    expect(isSymbolQuery("")).toBe(false);
    expect(isSymbolQuery(" #PromptBox")).toBe(false);
  });
});

describe("symbolQueryOf", () => {
  it("strips the trigger and trims the term", () => {
    expect(symbolQueryOf("#PromptBox")).toBe("PromptBox");
    expect(symbolQueryOf("# buildTree ")).toBe("buildTree");
    expect(symbolQueryOf("#")).toBe("");
  });
});

describe("symbolKindIcon", () => {
  it("maps the LSP kinds to their glyphs", () => {
    expect(symbolKindIcon(5)).toBe("◇");
    expect(symbolKindIcon(6)).toBe("m");
    expect(symbolKindIcon(11)).toBe("i");
    expect(symbolKindIcon(12)).toBe("ƒ");
    expect(symbolKindIcon(13)).toBe("v");
    expect(symbolKindIcon(14)).toBe("c");
  });

  it("falls back to a neutral dot for unknown kinds", () => {
    expect(symbolKindIcon(99)).toBe("•");
  });
});

describe("symbolPath", () => {
  it("strips the file:// scheme and the directory prefix", () => {
    const uri = "file:///mock/projects/opencode-demo/src/features/sessions/PromptBox.tsx";
    expect(symbolPath(uri, DIRECTORY)).toBe("src/features/sessions/PromptBox.tsx");
  });

  it("falls back to the bare pathname without a directory", () => {
    const uri = "file:///mock/projects/opencode-demo/src/features/sessions/PromptBox.tsx";
    expect(symbolPath(uri)).toBe("mock/projects/opencode-demo/src/features/sessions/PromptBox.tsx");
  });

  it("tolerates a trailing slash on the directory", () => {
    const uri = "file:///mock/projects/opencode-demo/src/main.ts";
    expect(symbolPath(uri, `${DIRECTORY}/`)).toBe("src/main.ts");
  });
});

describe("symbolHitOf", () => {
  const symbol: Symbol = {
    name: "buildTree",
    kind: 6,
    location: {
      uri: "file:///mock/projects/opencode-demo/src/features/files/FileTree.tsx",
      range: {
        start: { line: 34, character: 10 },
        end: { line: 34, character: 19 },
      },
    },
  };

  it("converts the 0-based start line to a 1-based target line", () => {
    expect(symbolHitOf(symbol, DIRECTORY).line).toBe(35);
  });

  it("keeps name and kind and derives the workspace path", () => {
    expect(symbolHitOf(symbol, DIRECTORY)).toEqual({
      name: "buildTree",
      kind: 6,
      path: "src/features/files/FileTree.tsx",
      line: 35,
    });
  });
});
