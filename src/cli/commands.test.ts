import { describe, expect, test } from "bun:test";
import { COMMANDS, isCommand } from "./commands";
// cac now owns the command list; index.ts exports the built instance without
// running main (guarded by import.meta.main), so the test reads the real thing.
import { cli } from "./index";

describe("the command table", () => {
	test("every command is registered with cac", () => {
		const registered = cli.commands.map((command) => command.name);
		// Both loops below derive their work from the tables under test; without this floor an
		// empty COMMANDS makes the whole suite vacuously green.
		expect(registered.length).toBeGreaterThan(0);
		expect(Object.keys(COMMANDS).length).toBeGreaterThan(0);
		for (const name of Object.keys(COMMANDS)) expect(registered).toContain(name);
		expect(registered.length).toBe(Object.keys(COMMANDS).length);
	});

	test("every registered command has a description", () => {
		for (const command of cli.commands) expect(command.description.length).toBeGreaterThan(0);
	});

	test("isCommand accepts the table and nothing else", () => {
		for (const name of Object.keys(COMMANDS)) expect(isCommand(name)).toBe(true);
		// A literal command, not one read from the table: an empty table must not pass.
		expect(isCommand("init")).toBe(true);
		expect(isCommand("nope")).toBe(false);
		// Inherited object members must not read as commands.
		expect(isCommand("toString")).toBe(false);
	});
});
