// L1 tests for the pure slash-command helpers (TASK-M5-03): the template
// filled into the composer on selection (name + first argument hint) and
// the submit-time classifier (known command vs plain prompt).

import { describe, expect, it } from "vitest";
import type { Command } from "../../services/command.js";
import { commandTemplate, matchCommand } from "./commands.js";

function command(overrides: Partial<Command>): Command {
  return {
    name: "init",
    description: "Initialize a CLAUDE.md file",
    template: "Create a CLAUDE.md file",
    hints: ["A summary of the codebase"],
    ...overrides,
  };
}

describe("commandTemplate", () => {
  it("fills the name plus the first argument hint as editable text", () => {
    expect(commandTemplate(command({ name: "init", hints: ["A summary of the codebase"] }))).toBe(
      "/init A summary of the codebase",
    );
  });

  it("fills the bare name when the command has no hints", () => {
    expect(commandTemplate(command({ name: "compact", hints: [] }))).toBe("/compact");
  });

  it("uses only the first hint", () => {
    expect(commandTemplate(command({ hints: ["one", "two"] }))).toBe("/init one");
  });
});

describe("matchCommand", () => {
  const commands = [command({ name: "init" }), command({ name: "think", hints: [] })];

  it("resolves a known command case-insensitively", () => {
    expect(matchCommand("/INIT", commands)).toEqual({ command: commands[0], args: "" });
  });

  it("extracts the arguments after the name", () => {
    expect(matchCommand("/think think deeply about X", commands)).toEqual({
      command: commands[1],
      args: "think deeply about X",
    });
  });

  it("collapses extra whitespace around the arguments", () => {
    expect(matchCommand("/init   a summary  ", commands)).toEqual({
      command: commands[0],
      args: "a summary",
    });
  });

  it("returns null for an unknown command (plain prompt fallback)", () => {
    expect(matchCommand("/does-not-exist anything", commands)).toBeNull();
  });

  it("returns null when the text does not start with a command name", () => {
    expect(matchCommand("not a command", commands)).toBeNull();
    expect(matchCommand("/", commands)).toBeNull();
  });
});
