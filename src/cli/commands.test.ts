import { describe, expect, test } from "bun:test";
import { COMMANDS, isCommand } from "./commands";
import { USAGE } from "./usage";

describe("the command table", () => {
	test("every command has a line in --help", () => {
		for (const name of Object.keys(COMMANDS)) expect(USAGE).toContain(`crust ${name} `);
	});

	test("isCommand accepts the table and nothing else", () => {
		for (const name of Object.keys(COMMANDS)) expect(isCommand(name)).toBe(true);
		expect(isCommand("nope")).toBe(false);
		// Inherited object members must not read as commands.
		expect(isCommand("toString")).toBe(false);
	});
});
