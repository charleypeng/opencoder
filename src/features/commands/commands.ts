// Pure slash-command helpers (TASK-M5-03): the template a `/` menu
// selection fills into the composer (command name plus the first argument
// hint as editable placeholder text) and the submit-time classifier that
// decides whether a message starting with `/` runs a known command or
// falls back to a plain prompt.

import type { Command } from "../../services/command.js";

/**
 * The input template a menu selection fills: `/{name}` plus the first
 * argument hint as editable placeholder text when the command declares
 * hints (e.g. `/init A summary of the codebase`).
 */
export function commandTemplate(command: Command): string {
  const hint = command.hints[0];
  return hint === undefined ? `/${command.name}` : `/${command.name} ${hint}`;
}

export interface CommandMatch {
  command: Command;
  /** Everything after the command name, trimmed (may be empty). */
  args: string;
}

/**
 * Classifies submitted text: `/{name} [args...]` resolves when the name
 * matches a known command (case-insensitive), so `/init` runs the command
 * while `/does-not-exist anything` stays a plain prompt.
 */
export function matchCommand(text: string, commands: readonly Command[]): CommandMatch | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (match === null) return null;
  const name = match[1].toLowerCase();
  const command = commands.find((candidate) => candidate.name.toLowerCase() === name);
  return command === undefined ? null : { command, args: (match[2] ?? "").trim() };
}
