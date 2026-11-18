/**
 * `security.capabilities` and `security.grants` are validated by name: an empty action list, a
 * duplicate capability name, a dotted action and a grant naming nothing are each a launch failure
 * that points at the offending key.
 */

import { describe, expect, test } from "bun:test";

import { ConfigError, validateConfig } from "@/config";

const base = {
	app: { id: "dev.crust.caps", name: "Caps", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function withSecurity(security: unknown): unknown {
	return { ...base, security };
}

describe("security capabilities config", () => {
	test("accepts a capability and a grant that names it", () => {
		const config = validateConfig(
			withSecurity({
				capabilities: [{ name: "panels", actions: ["dialog:*"] }],
				grants: { main: ["panels"] },
			}),
		);
		expect(config.security?.capabilities).toEqual([{ name: "panels", actions: ["dialog:*"] }]);
		expect(config.security?.grants).toEqual({ main: ["panels"] });
	});

	test("an empty security section still validates", () => {
		expect(validateConfig(withSecurity({})).security).toEqual({});
	});

	test("refuses a capability with no actions, by name", () => {
		expect(() =>
			validateConfig(withSecurity({ capabilities: [{ name: "panels", actions: [] }] })),
		).toThrow(/security\.capabilities\[0\]\.actions/);
	});

	test("refuses a duplicate capability name, because grants would be ambiguous", () => {
		expect(() =>
			validateConfig(
				withSecurity({
					capabilities: [
						{ name: "panels", actions: ["dialog:*"] },
						{ name: "panels", actions: ["fs:read*"] },
					],
				}),
			),
		).toThrow(/security\.capabilities\[1\]\.name/);
	});

	test("refuses the dotted spelling rather than accepting two spellings for one action", () => {
		expect(() =>
			validateConfig(
				withSecurity({
					capabilities: [{ name: "shell", actions: ["shell.spawn"] }],
				}),
			),
		).toThrow(/security\.capabilities\[0\]\.actions\[0\]/);
	});

	test("accepts app:notes.save so one app command can be granted on its own", () => {
		// The colon makes this a `plugin:command` action, not the refused dotted `notes.save`
		// spelling. The dotted command name is the app.command name, not a second key spelling.
		const config = validateConfig(
			withSecurity({
				capabilities: [{ name: "save", actions: ["app:notes.save"] }],
				grants: { main: ["save"] },
			}),
		);
		expect(config.security?.capabilities).toEqual([
			{ name: "save", actions: ["app:notes.save"] },
		]);
	});

	test("refuses a grant naming a capability that does not exist", () => {
		expect(() =>
			validateConfig(
				withSecurity({
					capabilities: [{ name: "panels", actions: ["dialog:*"] }],
					grants: { main: ["nope"] },
				}),
			),
		).toThrow(/security\.grants\.main\[0\]/);
	});

	test("refuses an unknown key inside security", () => {
		expect(() => validateConfig(withSecurity({ csp: "x", nope: 1 }))).toThrow(ConfigError);
	});
});
