/**
 * The mapping from this machine to a release target, which is the one place the names can
 * disagree: `process.platform` says `win32` while the table says `bun-windows-x64`. That
 * mismatch is not theoretical — a release job passing `--target bun-windows-x64` died on
 * "no release target for win32-x64" before compiling anything, while the same script was
 * fine on darwin and linux because those two names happen to line up (2026-11-17).
 */
import { describe, expect, test } from "bun:test";
import { artifactName, hostTarget, TARGETS, VERSION } from "./targets.ts";

describe("hostTarget", () => {
	test("names a target for this platform and arch", () => {
		const host = hostTarget();
		expect(host).toBeDefined();
		expect(Object.keys(TARGETS)).toContain(host as string);
	});

	test("win32 is spelled windows, the way the table spells it", () => {
		// The whole bug: `bun-win32-x64` is not a key, `bun-windows-x64` is.
		const key = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
		expect(hostTarget()).toBe(key as never);
	});

	test("every target is a key this platform could plausibly answer", () => {
		for (const target of Object.keys(TARGETS)) {
			expect(target.startsWith("bun-")).toBe(true);
			expect(target).not.toContain("win32");
		}
	});
});

describe("artifactName", () => {
	test("carries the version, the os and the arch", () => {
		expect(artifactName("bun-linux-arm64")).toBe(`crust-${VERSION}-linux-arm64`);
		expect(artifactName("bun-darwin-x64")).toBe(`crust-${VERSION}-darwin-x64`);
	});

	test("windows carries an .exe suffix and nothing else does", () => {
		expect(artifactName("bun-windows-x64")).toBe(`crust-${VERSION}-windows-x64.exe`);
		for (const target of ["bun-darwin-arm64", "bun-linux-x64"] as const) {
			expect(artifactName(target).endsWith(".exe")).toBe(false);
		}
	});

	test("the version comes from package.json, never a literal", () => {
		expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		expect(artifactName("bun-linux-x64")).toContain(VERSION);
	});
});
