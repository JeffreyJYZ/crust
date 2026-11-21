import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findAppBundle, findBuildArtifact } from "@/cli/util";

async function project(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-find-bundle-"));
}

/** A complete-looking bundle: the lookup now refuses one without a plist and executable. */
async function bundle(dir: string, name: string, outDir = "dist"): Promise<void> {
	const contents = join(dir, outDir, name, "Contents");
	await mkdir(join(contents, "MacOS"), { recursive: true });
	await writeFile(join(contents, "Info.plist"), "<plist/>");
	await writeFile(join(contents, "MacOS", "crust-app"), "binary");
}

describe("findAppBundle", () => {
	test("a stale .app in the same dist is never chosen over the configured name", async () => {
		const dir = await project();
		try {
			// The stale bundle was written first, so a readdir-order scan returns it first.
			await bundle(dir, "OldName.app");
			await bundle(dir, "FreshName.app");
			expect(await findAppBundle(dir, { appName: "FreshName" })).toBe(
				join(dir, "dist", "FreshName.app"),
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a missing expected bundle never falls back to a stale one that is present", async () => {
		const dir = await project();
		try {
			await bundle(dir, "OldName.app");
			// No `Current.app` exists. The old scan would have returned `OldName.app`.
			expect(await findAppBundle(dir, { appName: "Current" })).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("reads a custom outDir, not dist", async () => {
		const dir = await project();
		try {
			await bundle(dir, "MyApp.app", "build-out");
			expect(await findAppBundle(dir, { appName: "MyApp", outDir: "build-out" })).toBe(
				join(dir, "build-out", "MyApp.app"),
			);
			expect(await findAppBundle(dir, { appName: "MyApp" })).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a name already ending in .app is not doubled", async () => {
		const dir = await project();
		try {
			await bundle(dir, "Already.app");
			expect(await findAppBundle(dir, { appName: "Already.app" })).toBe(
				join(dir, "dist", "Already.app"),
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("findBuildArtifact", () => {
	test("darwin returns the configured .app", async () => {
		const dir = await project();
		try {
			await bundle(dir, "MyApp.app");
			expect(await findBuildArtifact(dir, { appName: "MyApp", platform: "darwin" })).toBe(
				join(dir, "dist", "MyApp.app"),
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("linux returns the flat binary, never a .app", async () => {
		const dir = await project();
		try {
			await mkdir(join(dir, "dist", "MyApp.app"), { recursive: true });
			await writeFile(join(dir, "dist", "crust-app"), "binary");
			expect(await findBuildArtifact(dir, { appName: "MyApp", platform: "linux" })).toBe(
				join(dir, "dist", "crust-app"),
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("win32 prefers the .exe", async () => {
		const dir = await project();
		try {
			await mkdir(join(dir, "dist"), { recursive: true });
			await writeFile(join(dir, "dist", "crust-app.exe"), "binary");
			expect(await findBuildArtifact(dir, { platform: "win32" })).toBe(
				join(dir, "dist", "crust-app.exe"),
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
