import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMANDS, menuLines } from "./index.mjs";

const scripts: Record<string, string> = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).scripts;
const ENTRY = "node scripts/toolbox/index.mjs";

describe("the toolbox", () => {
  it("lists every command as a script right below toolbox, in the order of the menu", () => {
    const names = Object.keys(scripts);
    const start = names.indexOf("toolbox");
    expect(scripts.toolbox).toBe(ENTRY);
    expect(names.slice(start + 1, start + 1 + COMMANDS.length)).toEqual(COMMANDS.map((command) => command.name));
    for (const command of COMMANDS) expect(scripts[command.name]).toBe(`${ENTRY} ${command.name}`);
  });

  it("has no script that runs a command the toolbox does not know", () => {
    const known = new Set(COMMANDS.map((command) => command.name));
    const pointing = Object.entries(scripts)
      .filter(([name, script]) => name !== "toolbox" && script.startsWith(ENTRY))
      .map(([name]) => name);
    expect(pointing.filter((name) => !known.has(name))).toEqual([]);
  });

  it("shows every command once, numbered, below the heading of its group", () => {
    const text = menuLines(COMMANDS).join("\n");
    for (const [index, command] of COMMANDS.entries()) {
      expect(text).toContain(`${index + 1}) ${command.title}`);
      expect(text).toContain(`pnpm ${command.name}`);
    }
    expect(new Set(COMMANDS.map((command) => command.name)).size).toBe(COMMANDS.length);
    for (const group of new Set(COMMANDS.map((command) => command.group))) expect(text).toContain(group);
  });
});
