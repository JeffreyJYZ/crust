/**
 * The deep-link packaging proofs, against a real bundle: `assembleApp` is what writes `Info.plist`, so the scheme is checked in the file on disk rather than in a string that only resembles it. No app is launched here.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleApp, type AssembledApp, type AssembleAppOptions } from "./app.ts";
import { infoPlist } from "./plist.ts";

/** A directory with a stand-in executable, removed after each case. */
async function bundle(
	options: Partial<AssembleAppOptions> = {},
): Promise<{ app: AssembledApp; plist: string; done: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "crust-deeplink-"));
	const binary = join(dir, "example");
	await writeFile(binary, "#!/bin/sh\nexit 0\n", "utf8");
	const app = await assembleApp({
		id: "land.jyz.example",
		name: "Example",
		version: "0.1.0",
		binary,
		minimumSystemVersion: "13.0",
		outDir: dir,
		...options,
	});
	const plist = await readFile(join(app.appPath, "Contents", "Info.plist"), "utf8");
	return { app, plist, done: () => rm(dir, { recursive: true, force: true }) };
}

describe("assembleApp writes the scheme it was given", () => {
	test("a scheme reaches CFBundleURLTypes, named by the bundle identifier", async () => {
		const { plist, done } = await bundle({ urlScheme: "crust" });
		try {
			expect(plist).toContain("<key>CFBundleURLTypes</key>");
			expect(plist).toContain("<key>CFBundleURLSchemes</key>");
			expect(plist).toContain("<string>crust</string>");
			expect(plist).toContain("<string>land.jyz.example</string>");
			// One top-level dict closes last; the key has to be inside it, not after.
			expect(plist.indexOf("<key>CFBundleURLTypes</key>")).toBeLessThan(
				plist.lastIndexOf("</dict>"),
			);
			expect(plist.match(/<\/plist>/g)?.length).toBe(1);
		} finally {
			await done();
		}
	});

	test("no scheme means no key at all, not an empty claim on nothing", async () => {
		const { plist, done } = await bundle();
		try {
			expect(plist).not.toContain("CFBundleURLTypes");
			expect(plist).toBe(
				infoPlist({
					executableName: "example",
					name: "Example",
					id: "land.jyz.example",
					version: "0.1.0",
					minimumSystemVersion: "13.0",
					hasIcon: false,
				}),
			);
		} finally {
			await done();
		}
	});

	test("a reserved scheme is refused before the plist is written", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-deeplink-"));
		try {
			const binary = join(dir, "example");
			await writeFile(binary, "#!/bin/sh\nexit 0\n", "utf8");
			await expect(
				assembleApp({
					id: "land.jyz.example",
					name: "Example",
					version: "0.1.0",
					binary,
					minimumSystemVersion: "13.0",
					outDir: dir,
					urlScheme: "https",
				}),
			).rejects.toThrow(/reserved/);
			const written = readFile(join(dir, "Example.app", "Contents", "Info.plist"), "utf8");
			await expect(written).rejects.toThrow();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("merges beside the icon key when the bundle has one", () => {
		// A PNG would need `sips`, so the icon case is proven on the plist body.
		const plist = infoPlist({
			executableName: "example",
			name: "Example",
			id: "land.jyz.example",
			version: "0.1.0",
			minimumSystemVersion: "13.0",
			hasIcon: true,
			urlScheme: "my-app",
		});
		expect(plist.indexOf("<key>CFBundleIconFile</key>")).toBeLessThan(
			plist.indexOf("<key>CFBundleURLTypes</key>"),
		);
		expect(plist).toContain("<string>my-app</string>");
	});
});
