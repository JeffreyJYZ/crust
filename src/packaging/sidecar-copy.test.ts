import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SIDECAR_MANIFEST } from "@/plugins/sidecar";
import { copySidecars } from "./build";

let project: string;
let bundle: string;

beforeEach(async () => {
	project = await mkdtemp(join(tmpdir(), "crust-sidecar-project-"));
	bundle = await mkdtemp(join(tmpdir(), "crust-sidecar-bundle-"));
	await writeFile(join(project, "ffmpeg.sh"), "#!/bin/sh\necho ok\n", { mode: 0o644 });
});

afterEach(async () => {
	await rm(project, { recursive: true, force: true });
	await rm(bundle, { recursive: true, force: true });
});

describe("copySidecars", () => {
	test("copies each binary into the bundle with mode 0755 and writes the manifest", async () => {
		await copySidecars({ names: ["ffmpeg.sh"], projectDir: project, targetDir: bundle });
		const target = join(bundle, "ffmpeg.sh");
		expect((await stat(target)).mode & 0o777).toBe(0o755);
		expect(await readFile(target, "utf8")).toContain("echo ok");
		expect(JSON.parse(await readFile(join(bundle, SIDECAR_MANIFEST), "utf8"))).toEqual([
			"ffmpeg.sh",
		]);
	});

	test("an empty declaration still writes an empty manifest", async () => {
		await copySidecars({ names: [], projectDir: project, targetDir: bundle });
		expect(JSON.parse(await readFile(join(bundle, SIDECAR_MANIFEST), "utf8"))).toEqual([]);
	});

	/**
	 * The bug CI found: a JSON document in `Contents/MacOS` is nested code to codesign, so the
	 * ad-hoc sign failed on every packaged build with "code object is not signed at all" naming
	 * `crust-sidecars.json`. macOS therefore writes the manifest to `Contents/Resources` while the
	 * binaries still land beside the executable, which is where the plugin resolves them.
	 */
	test("a manifestDir keeps the sidecar beside the binary and the manifest in Resources", async () => {
		const resources = join(bundle, "..", "Resources");
		await copySidecars({
			names: ["ffmpeg.sh"],
			projectDir: project,
			targetDir: bundle,
			manifestDir: resources,
		});
		expect((await stat(join(bundle, "ffmpeg.sh"))).isFile()).toBe(true);
		expect(JSON.parse(await readFile(join(resources, SIDECAR_MANIFEST), "utf8"))).toEqual([
			"ffmpeg.sh",
		]);
		// And nothing named like the manifest sits beside the executable.
		expect(await stat(join(bundle, SIDECAR_MANIFEST)).catch(() => undefined)).toBeUndefined();
	});

	test("a declared binary missing on disk fails by name", async () => {
		try {
			await copySidecars({ names: ["gone"], projectDir: project, targetDir: bundle });
			throw new Error("expected a failure");
		} catch (error) {
			expect((error as Error).message).toContain("gone");
		}
	});
});
