/** hunt-21 security gates: the effective CSP3 directive and the shell execution-capable class. */

import { describe, expect, spyOn, test } from "bun:test";

import { ConfigError, validateConfig } from "@/config";

const base = {
	app: { id: "dev.crust.hunt21", name: "Hunt21", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function cspIssue(csp: string): { path: string; expected: string } | undefined {
	try {
		validateConfig({ ...base, security: { csp } });
		return undefined;
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		return (error as ConfigError).issues[0];
	}
}

describe("CSP3 inline-script resolution", () => {
	test("script-src-elem governs the inline bootstrap and overrides script-src", () => {
		const found = cspIssue("script-src 'unsafe-inline'; script-src-elem 'self'");
		expect(found?.path).toBe("security.csp");
		expect(found?.expected).toContain("script-src-elem");
		expect(found?.expected).toContain("'unsafe-inline'");
		expect(found?.expected).toContain("window.crust");
	});

	test("script-src-elem overrides a loose default-src", () => {
		const found = cspIssue("default-src 'unsafe-inline'; script-src-elem 'none'");
		expect(found?.expected).toContain("script-src-elem");
	});

	test("a strict standalone script-src-elem is named", () => {
		expect(cspIssue("script-src-elem 'self'")?.expected).toContain("script-src-elem");
	});

	test("a loose script-src-elem wins over a strict script-src, as a browser resolves it", () => {
		expect(
			cspIssue("script-src 'none'; script-src-elem 'self' 'unsafe-inline'"),
		).toBeUndefined();
	});

	test("script-src-attr governs event handlers, not the inline <script> bootstrap", () => {
		expect(
			cspIssue("script-src-attr 'none'; script-src 'self' 'unsafe-inline'"),
		).toBeUndefined();
	});
});

describe("shell.allow execution-capable binaries", () => {
	function said(allow: string[]): string[] {
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			validateConfig({ ...base, shell: { allow } });
			return warn.mock.calls.map((call) => String(call[0]));
		} finally {
			warn.mockRestore();
		}
	}

	test("warns for every program whose argv can execute a command", () => {
		const programs = [
			"awk",
			"gawk",
			"sed",
			"find",
			"xargs",
			"tar",
			"git",
			"busybox",
			"npx",
			"npm",
			"make",
			"sudo",
			"powershell.exe",
			"cmd.exe",
			"python3.12",
			"node20",
		];
		const warned = said(programs);
		expect(warned.length).toBe(programs.length);
		programs.forEach((program, index) => {
			expect(warned[index]).toContain(`shell.allow[${index}]`);
			expect(warned[index]).toContain("no longer bounds what runs");
		});
	});

	test("says nothing for a tool with no execution primitive", () => {
		expect(said(["echo", "ls", "cat", "printf"])).toEqual([]);
	});
});
