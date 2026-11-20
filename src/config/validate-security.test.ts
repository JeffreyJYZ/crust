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

function cspIssue(csp: unknown): { path: string; expected: string } | undefined {
	try {
		validateConfig(withSecurity({ csp }));
		return undefined;
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		return (error as ConfigError).issues[0];
	}
}

describe("security.csp validation", () => {
	test("accepts a custom policy whose script-src admits inline scripts", () => {
		const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'";
		expect(cspIssue(csp)).toBeUndefined();
		expect(validateConfig(withSecurity({ csp })).security?.csp).toBe(csp);
	});

	test("accepts a policy that restricts scripts by neither directive", () => {
		expect(cspIssue("connect-src 'self'; img-src 'self'")).toBeUndefined();
	});

	test("accepts a default-src that admits inline scripts when script-src is absent", () => {
		expect(cspIssue("default-src 'self' 'unsafe-inline'; connect-src 'self'")).toBeUndefined();
	});

	test("refuses a strict default-src with no script-src, naming default-src", () => {
		const found = cspIssue("default-src 'self'; connect-src 'self'");
		expect(found?.path).toBe("security.csp");
		expect(found?.expected).toContain("default-src");
		expect(found?.expected).toContain("'unsafe-inline'");
		expect(found?.expected).toContain("nonce");
		expect(found?.expected).toContain("window.crust");
	});

	test("script-src wins over a strict default-src", () => {
		expect(cspIssue("default-src 'none'; script-src 'self' 'unsafe-inline'")).toBeUndefined();
	});

	test("refuses a strict script-src even when default-src is loose", () => {
		const found = cspIssue("default-src 'self' 'unsafe-inline'; script-src 'self'");
		expect(found?.path).toBe("security.csp");
		expect(found?.expected).toContain("script-src");
		expect(found?.expected).not.toContain("falls back");
	});

	test("accepts the directive and keyword case-insensitively", () => {
		expect(cspIssue("SCRIPT-SRC 'UNSAFE-INLINE'")).toBeUndefined();
	});

	test("refuses a script-src without 'unsafe-inline', explaining the nonce bootstrap", () => {
		const found = cspIssue("default-src 'self'; script-src 'self'");
		expect(found?.path).toBe("security.csp");
		expect(found?.expected).toContain("'unsafe-inline'");
		expect(found?.expected).toContain("nonce");
		expect(found?.expected).toContain("window.crust");
	});

	test("refuses a script-src relying on a nonce placeholder the bridge does not fill", () => {
		expect(cspIssue("script-src 'self' 'nonce-{{nonce}}'")?.path).toBe("security.csp");
	});

	test("refuses a non-string csp by name", () => {
		expect(cspIssue(42)?.path).toBe("security.csp");
	});
});

describe("security.microphone validation", () => {
	const sentence = "Caps records voice memos you choose to transcribe.";

	test("accepts a sentence and keeps it verbatim", () => {
		expect(validateConfig(withSecurity({ microphone: sentence })).security?.microphone).toBe(
			sentence,
		);
	});

	test("is optional", () => {
		expect(validateConfig(withSecurity({})).security?.microphone).toBeUndefined();
	});

	test("refuses a placeholder, because macOS shows it in the prompt", () => {
		expect(() => validateConfig(withSecurity({ microphone: "mic" }))).toThrow(
			/security\.microphone/,
		);
	});

	test("refuses a sentence with no terminal punctuation", () => {
		expect(() => validateConfig(withSecurity({ microphone: "records voice memos" }))).toThrow(
			/security\.microphone/,
		);
	});

	test("refuses an empty string by name", () => {
		expect(() => validateConfig(withSecurity({ microphone: "  " }))).toThrow(
			/security\.microphone/,
		);
	});
});
