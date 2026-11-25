import { describe, expect, test } from "bun:test";
import { JIT_ENTITLEMENT_PLIST, signApp, signCommand } from "./sign";
import { hardenedEntitlements } from "./entitlements";

/**
 * A hardened-runtime bundle without these keys is a *silent* failure: the app
 * launches, creates no page and prints nothing, with exit status 0. Measured on
 * 2026-11-14 with an Apple Development identity, so both keys are asserted here
 * rather than trusted to a comment.
 */
describe("hardened runtime entitlements", () => {
	test("seals allow-jit", () => {
		expect(JIT_ENTITLEMENT_PLIST).toContain("<key>com.apple.security.cs.allow-jit</key>");
	});

	test("seals unsigned executable memory, which TinyCC needs", () => {
		expect(JIT_ENTITLEMENT_PLIST).toContain(
			"<key>com.apple.security.cs.allow-unsigned-executable-memory</key>",
		);
	});

	test("is a plist with one dict and a trailing newline", () => {
		expect(JIT_ENTITLEMENT_PLIST.startsWith('<?xml version="1.0"')).toBe(true);
		expect(JIT_ENTITLEMENT_PLIST.endsWith("</plist>\n")).toBe(true);
		expect(JIT_ENTITLEMENT_PLIST.match(/<dict>/g)?.length).toBe(1);
	});
});

/**
 * `security.microphone` is the only opt-in: an app that captures nothing keeps the measured
 * two-key set exactly, and the microphone entitlement is a third `<true/>` in the same dict.
 */
describe("microphone entitlement", () => {
	test("defaults to the same bytes as the measured JIT plist", () => {
		expect(hardenedEntitlements()).toBe(JIT_ENTITLEMENT_PLIST);
	});

	test("adds audio-input only when asked", () => {
		const plist = hardenedEntitlements({ microphone: true });
		expect(plist).toContain("<key>com.apple.security.device.audio-input</key>");
		expect(plist).toContain("<key>com.apple.security.cs.allow-jit</key>");
		expect(plist).toContain(
			"<key>com.apple.security.cs.allow-unsigned-executable-memory</key>",
		);
		expect(plist.match(/<dict>/g)?.length).toBe(1);
		expect(plist.match(/<true\/>/g)?.length).toBe(3);
	});

	test("an explicit false is the two-key set", () => {
		expect(hardenedEntitlements({ microphone: false })).not.toContain(
			"com.apple.security.device.audio-input",
		);
	});
});

const IDENTITY = "Developer ID Application: Crust (ABCDE12345)";
const APP = "/dist/Crust.app";
const SIDECARS = [
	"/dist/Crust.app/Contents/MacOS/bin/tool.sh",
	"/dist/Crust.app/Contents/MacOS/tools/helper",
] as const;

/** No certificate exists here, so the recorded argv is the only honest proof. */
function recorder() {
	const calls: string[][] = [];
	const exec = async (args: string[]): Promise<void> => {
		calls.push(args);
	};
	return { calls, exec };
}

function withoutPlist(argv: string[]): string[] {
	const at = argv.indexOf("--entitlements");
	return at < 0 ? argv : [...argv.slice(0, at + 1), "<plist>", ...argv.slice(at + 2)];
}

describe("signApp argv", () => {
	test("ad-hoc stays byte-identical: --timestamp=none, no secure timestamp", async () => {
		const fake = recorder();
		await signApp({ appPath: APP, exec: fake.exec });
		expect(fake.calls).toEqual([
			["codesign", "--force", "--sign", "-", "--timestamp=none", APP],
		]);
	});

	test("Developer ID re-signs both sidecars before the app, deepest first", async () => {
		const fake = recorder();
		await signApp({
			appPath: APP,
			mode: "developer-id",
			identity: IDENTITY,
			hardenedRuntime: true,
			sidecars: SIDECARS,
			exec: fake.exec,
		});
		expect(fake.calls.map((argv) => argv.at(-1))).toEqual([...SIDECARS, APP]);
		expect(fake.calls.map(withoutPlist)).toEqual([
			[
				"codesign",
				"--force",
				"--sign",
				IDENTITY,
				"--timestamp",
				"--options",
				"runtime",
				"--entitlements",
				"<plist>",
				SIDECARS[0],
			],
			[
				"codesign",
				"--force",
				"--sign",
				IDENTITY,
				"--timestamp",
				"--options",
				"runtime",
				"--entitlements",
				"<plist>",
				SIDECARS[1],
			],
			[
				"codesign",
				"--force",
				"--sign",
				IDENTITY,
				"--timestamp",
				"--options",
				"runtime",
				"--entitlements",
				"<plist>",
				APP,
			],
		]);
		expect(fake.calls.every((argv) => argv.includes("--timestamp"))).toBe(true);
		expect(fake.calls.some((argv) => argv.includes("--timestamp=none"))).toBe(false);
	});

	test("signCommand adds --timestamp only on the Developer ID path", () => {
		expect(signCommand(APP, { identity: "-", mode: "adhoc" })).toEqual([
			"codesign",
			"--force",
			"--sign",
			"-",
			"--timestamp=none",
			APP,
		]);
		expect(signCommand(APP, { identity: IDENTITY, mode: "developer-id" })).toEqual([
			"codesign",
			"--force",
			"--sign",
			IDENTITY,
			"--timestamp",
			APP,
		]);
	});
});
