/**
 * C3 — a failed build must tell the author what broke, where, and what to change.
 * The packaging layer sits under the CLI, so its messages are the last ones a
 * library caller sees: they name the file, the config key and the fix.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assembleApp } from "./app";
import { buildAppImage } from "./appimage";
import { pngToIcns } from "./icon";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "crust-error-messages-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function failure(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	return "";
}

describe("packaging errors name the file, the key and the fix", () => {
	test("a short icon source names the file and tells the author to supply a real PNG", async () => {
		const source = join(dir, "tiny.png");
		await writeFile(source, "abc");
		const message = await failure(() => pngToIcns({ source, out: join(dir, "icon.icns") }));
		expect(message).toContain(source);
		expect(message).toContain("not a PNG");
		expect(message).toContain("supply a real PNG for app.icon");
	});

	test("a bad PNG signature names the file and the same fix", async () => {
		const source = join(dir, "bad.png");
		await writeFile(source, new Uint8Array(24));
		const message = await failure(() => pngToIcns({ source, out: join(dir, "icon.icns") }));
		expect(message).toContain(source);
		expect(message).toContain("bad signature byte");
		expect(message).toContain("supply a real PNG for app.icon");
	});

	test("a binary path with no filename names the path and what to pass instead", async () => {
		const message = await failure(() =>
			assembleApp({
				id: "land.jyz.example",
				name: "Example",
				version: "1.0.0",
				binary: "/",
				minimumSystemVersion: "13.0",
				outDir: join(dir, "out"),
			}),
		);
		expect(message).toContain("binary path / has no filename");
		expect(message).toContain("pass a path ending in a file name");
	});

	test("a missing mac icon names the path and the config key to fix", async () => {
		const binary = join(dir, "crust-app");
		await writeFile(binary, "binary");
		const icon = join(dir, "missing.png");
		const message = await failure(() =>
			assembleApp({
				id: "land.jyz.example",
				name: "Example",
				version: "1.0.0",
				binary,
				iconPath: icon,
				minimumSystemVersion: "13.0",
				outDir: join(dir, "out"),
			}),
		);
		expect(message).toContain(icon);
		expect(message).toContain("app.icon in crust.config.ts");
	});

	test("a missing AppImage icon names the path and the config key to fix", async () => {
		const appPath = join(dir, "dist");
		await mkdir(appPath);
		await writeFile(join(appPath, "crust-app"), "binary");
		const icon = join(dir, "missing.png");
		const message = await failure(() =>
			buildAppImage({
				appPath,
				binaryName: "crust-app",
				id: "land.jyz.example",
				name: "Example",
				version: "1.0.0",
				iconPath: icon,
			}),
		);
		expect(message).toContain(icon);
		expect(message).toContain("app.icon in crust.config.ts");
	});
});
