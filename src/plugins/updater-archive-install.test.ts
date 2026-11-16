import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DownloadResult, InstallResult, UpdaterFailure } from "@/plugins/updater";
import {
	bundle,
	executableOf,
	offlineAdapter,
	plugin,
	scratch,
	shipping,
	signer,
	UPDATE_URL,
	writing,
} from "@/plugins/updater-fake";
import { buildZip, bundleZip } from "@/plugins/updater-zip-fixture";

const MARKER = join("Contents", "marker.txt");

function digestOf(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

describe("updater with a signed archive", () => {
	test("a real zip is verified, extracted, and installed over this app's bundle", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const zip = bundleZip("Notes.app", "new");
			const archive = digestOf(zip);
			const key = await signer();
			const commands = plugin(shipping(zip), { pubkey: key.pubkey }, executableOf(appPath));
			const download = (await commands.download({
				url: UPDATE_URL,
				sha256: archive,
				signature: await key.sign(zip),
			})) as DownloadResult;
			// The receipt names both halves: the archive that was signed, the tree that installs.
			expect(download).toMatchObject({ ok: true, signer: key.pubkey });
			expect(download.archive).toMatchObject({ sha256: archive });
			expect(download.archive?.path.endsWith("Notes.app.zip")).toBe(true);
			expect(download.path.endsWith("Notes.app")).toBe(true);
			expect(download.sha256).not.toBe(archive);
			const executable = join(download.path, "Contents", "MacOS", "Notes");
			expect(((await stat(executable)).mode & 0o111) !== 0).toBe(true);
			expect(await readFile(join(download.path, MARKER), "utf8")).toBe("new");

			const installed = (await commands.install({
				path: download.path,
				appPath,
			})) as InstallResult;
			expect(installed).toMatchObject({ ok: true, backup: `${appPath}.old` });
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("new");
			expect(await readFile(join(`${appPath}.old`, MARKER), "utf8")).toBe("old");
			// The extracted executable is installed, still executable, and byte-identical.
			const installedExecutable = join(appPath, "Contents", "MacOS", "Notes");
			expect(((await stat(installedExecutable)).mode & 0o111) !== 0).toBe(true);
			expect(await readFile(installedExecutable, "utf8")).toBe("#!/bin/sh\n");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a tampered archive is refused, and nothing is extracted or installed", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const key = await signer();
			const signed = bundleZip("Notes.app", "new");
			const swapped = bundleZip("Notes.app", "evil");
			const commands = plugin(
				shipping(swapped),
				{ pubkey: key.pubkey },
				executableOf(appPath),
			);
			const result = (await commands.download({
				url: UPDATE_URL,
				sha256: digestOf(swapped),
				signature: await key.sign(signed),
			})) as UpdaterFailure;
			expect(result).toMatchObject({ ok: false, code: "signature-mismatch" });
			expect(result.path?.endsWith("Notes.app.zip")).toBe(true);
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("old");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a tree that changed after download is refused, naming the tree digest it expected", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const zip = bundleZip();
			const commands = plugin(shipping(zip), {}, executableOf(appPath));
			const download = (await commands.download({
				url: UPDATE_URL,
				sha256: digestOf(zip),
			})) as DownloadResult;
			await writeFile(join(download.path, MARKER), "swapped", "utf8");
			const result = (await commands.install({
				path: download.path,
				appPath,
			})) as UpdaterFailure;
			expect(result).toMatchObject({ ok: false, code: "hash-mismatch", path: download.path });
			expect(result.message).toContain(`verified ${download.sha256}`);
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("old");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("the archive half of the receipt is re-checked, so a rewritten zip is refused", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const zip = bundleZip();
			const commands = plugin(shipping(zip), {}, executableOf(appPath));
			const download = (await commands.download({
				url: UPDATE_URL,
				sha256: digestOf(zip),
			})) as DownloadResult;
			const archive = download.archive?.path ?? "";
			await writeFile(archive, buildZip([{ name: "Notes.app/", mode: 0o755 }]));
			const result = (await commands.install({
				path: download.path,
				appPath,
			})) as UpdaterFailure;
			expect(result).toMatchObject({ ok: false, code: "hash-mismatch", path: archive });
			expect(result.message).toContain("the archive");
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("old");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a zip-slip entry is refused by name, before anything is written", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const slip = buildZip([
				{ name: "Notes.app/", mode: 0o755 },
				{ name: "Notes.app/Contents/marker.txt", body: "new" },
				{ name: "../evil.txt", body: "pwned" },
			]);
			const commands = plugin(shipping(slip), {}, executableOf(appPath));
			const result = (await commands.download({
				url: UPDATE_URL,
				sha256: digestOf(slip),
			})) as UpdaterFailure;
			expect(result).toMatchObject({ ok: false, code: "invalid-archive" });
			expect(result.message).toContain('"../evil.txt" that climbs out with ".."');
			expect(result.message).toContain("Notes.app.zip");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a bundle no download produced is still unverified-artifact", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const dropped = await bundle(dir, "Notes-new.app", "new");
			const result = (await plugin(offlineAdapter(), {}, executableOf(appPath)).install({
				path: dropped,
				appPath,
			})) as UpdaterFailure;
			expect(result).toMatchObject({ ok: false, code: "unverified-artifact", path: dropped });
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("old");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a .zip-named file that is not a zip keeps the file path it always had", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const payload = "not a zip at all";
			const commands = plugin(writing(payload), {}, executableOf(appPath));
			const result = (await commands.download({
				url: UPDATE_URL,
				sha256: createHash("sha256").update(payload).digest("hex"),
			})) as DownloadResult;
			expect(result.archive).toBeUndefined();
			expect(result.path.endsWith("Notes.app.zip")).toBe(true);
			expect(await commands.install({ path: result.path, appPath })).toMatchObject({
				ok: false,
				code: "not-an-app-bundle",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
