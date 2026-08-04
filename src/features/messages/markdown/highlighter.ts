// Shiki highlighter singleton (TASK-M2-07): a lazily created highlighter
// preloaded with a small common language set; other bundled languages load
// on demand via loadLanguage (dynamic imports keep the packs out of the
// initial bundle). The theme is fixed to github-dark for both app themes
// for now; light-theme variants are deferred.
//
// Any failure (unsupported language, load error) rejects and callers fall
// back to a plain, escaped <pre><code> block.

import { getSingletonHighlighter } from "shiki";
import type { BundledLanguage, Highlighter } from "shiki";

const THEME = "github-dark";

const PRELOADED_LANGS: BundledLanguage[] = [
  "bash",
  "shell",
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "css",
  "html",
  "md",
  "markdown",
  "diff",
  "sql",
  "yaml",
  "python",
  "rust",
  "go",
];

let instance: Promise<Highlighter> | undefined;

/** Shared highlighter instance; retries on failure so a transient error
 *  does not permanently disable highlighting. */
export function getHighlighter(): Promise<Highlighter> {
  instance ??= getSingletonHighlighter({ themes: [THEME], langs: PRELOADED_LANGS }).catch(
    (error) => {
      instance = undefined;
      throw error;
    },
  );
  return instance;
}

/**
 * Highlights code with the given language name. Falls back to the plain
 * "text" language when the language is unknown or cannot be loaded, so
 * callers always receive a renderable result.
 */
export async function highlightCode(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  const loaded = highlighter.getLoadedLanguages() as string[];
  let resolved = "text";
  if (lang !== "" && loaded.includes(lang)) {
    resolved = lang;
  } else if (lang !== "") {
    try {
      await highlighter.loadLanguage(lang as BundledLanguage);
      resolved = lang;
    } catch {
      // Unknown language: keep the plain-text fallback.
    }
  }
  return highlighter.codeToHtml(code, { lang: resolved, theme: THEME });
}
