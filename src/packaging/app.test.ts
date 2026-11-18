import { describe, expect, test } from "bun:test";
import { bundlesApp } from "./app";

/**
 * A real Windows build cannot run here (this machine is darwin), so the honest proof that a
 * non-darwin build assembles no `.app` is the pure decision `buildApp` gates on: same call,
 * host platform passed in. Windows CI exercises the compile end to end; this pins the branch.
 */
describe("bundlesApp", () => {
	test("darwin assembles an .app bundle", () => {
		expect(bundlesApp("darwin")).toBe(true);
	});

	test("windows and linux ship the flat binary, not a bundle", () => {
		expect(bundlesApp("win32")).toBe(false);
		expect(bundlesApp("linux")).toBe(false);
	});

	test("other platforms are flat too", () => {
		expect(bundlesApp("freebsd")).toBe(false);
		expect(bundlesApp("android")).toBe(false);
	});
});
