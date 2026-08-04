// @-menu skill reference helpers (TASK-M5-08): pure composition of the
// skills group the @-reference menu shows above its file results. Skills
// are filtered client-side by the query after `@` (the list is small and
// cached per mount); selecting one inserts a plain `@name` text reference —
// the server resolves `@name` mentions into AgentPartInput parts in the
// echoed message, exactly like `@path` file references resolve into file
// parts (no client-side part mapping needed).

import type { Skill } from "../../services/skill.js";

/** A skill row in the @-reference menu. */
export interface AtSkillEntry {
  kind: "skill";
  name: string;
  description?: string;
}

/** A file row in the @-reference menu (the TASK-M3-08 path insert). */
export interface AtFileEntry {
  kind: "file";
  path: string;
}

export type AtEntry = AtSkillEntry | AtFileEntry;

/** Case-insensitive substring match against the skill name. */
export function skillMatches(skill: Skill, query: string): boolean {
  return skill.name.toLowerCase().includes(query.toLowerCase());
}

/**
 * Composes the @-menu rows for a query: matching skills first (the new
 * skills group), then matching files. Skills without a match are omitted —
 * the group renders only while it has rows.
 */
export function atEntriesFor(
  skills: readonly Skill[],
  files: readonly string[],
  query: string,
): AtEntry[] {
  const skillRows: AtSkillEntry[] = skills
    .filter((skill) => skillMatches(skill, query))
    .map((skill) => ({
      kind: "skill",
      name: skill.name,
      ...(skill.description === undefined ? {} : { description: skill.description }),
    }));
  const fileRows: AtFileEntry[] = files.map((path) => ({ kind: "file", path }));
  return [...skillRows, ...fileRows];
}

/** The text an @-menu selection inserts: `@skillName` or `@path`. */
export function atInsertText(entry: AtEntry): string {
  return `@${entry.kind === "skill" ? entry.name : entry.path}`;
}
