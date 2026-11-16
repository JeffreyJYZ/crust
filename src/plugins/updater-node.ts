/**
 * The updater's default adapter: `fetch`, `node:fs` and `open`, the tools Bun and macOS already have, so an update needs no dependency added.
 * Each member is a seam a test replaces, which is why the plugin never reaches past it.
 */

import { createHash, type Hash } from "node:crypto";
import { mkdtemp, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileNameFor, UpdaterAdapterError } from "./updater-args";
import type { UpdaterAdapter } from "./updater-types";

/**
 * A directory artifact's digest: relative names and file bytes in sorted order, so an `.app` bundle
 * is verifiable the same way a downloaded file is. `install` re-runs this against the digest
 * `download` recorded, so a bundle swapped in afterwards is caught. A plain file keeps the plain
 * sha256 of its bytes, which is the value a manifest publishes.
 */
async function digestTree(hash: Hash, path: string, name: string): Promise<void> {
	const info = await stat(path);
	if (info.isDirectory()) {
		hash.update(`d ${name}\n`);
		for (const entry of (await readdir(path)).sort()) {
			await digestTree(hash, join(path, entry), entry);
		}
		return;
	}
	hash.update(`f ${name}\n`);
	hash.update(await readFile(path));
}

export function nodeUpdaterAdapter(): UpdaterAdapter {
	return {
		async fetchJson(url) {
			const response = await fetch(url, { headers: { accept: "application/json" } });
			if (!response.ok) {
				throw new UpdaterAdapterError("check-failed", `updater: ${url} ${response.status}`);
			}
			return await response.json();
		},
		async download(url, directory) {
			const response = await fetch(url);
			if (!response.ok) {
				throw new UpdaterAdapterError(
					"download-failed",
					`updater: ${url} ${response.status}`,
				);
			}
			const path = join(directory, fileNameFor(url));
			await Bun.write(path, response);
			return { path, bytes: (await stat(path)).size };
		},
		async sha256(path) {
			const hash = createHash("sha256");
			if ((await stat(path)).isDirectory()) {
				await digestTree(hash, path, "");
			} else {
				hash.update(await readFile(path));
			}
			return hash.digest("hex");
		},
		async readBytes(path) {
			return new Uint8Array(await readFile(path));
		},
		async makeTempDir() {
			return await mkdtemp(join(tmpdir(), "crust-update-"));
		},
		async isAppBundle(path) {
			if (!path.endsWith(".app")) return false;
			const info = await stat(path).catch(() => undefined);
			return info?.isDirectory() === true;
		},
		// One rename on one volume is atomic, and the temp dir shares the boot volume with
		// `/Applications`. A cross-volume EXDEV is a real install error, not a case to paper
		// over with a copy that is no longer atomic.
		async replaceBundle(source, target, backup) {
			await rm(backup, { recursive: true, force: true });
			await rename(target, backup);
			try {
				await rename(source, target);
			} catch (error) {
				await rename(backup, target).catch(() => undefined);
				throw error;
			}
		},
		// `open -n` takes the bundle by path and asks for a new instance, so a copy still running
		// cannot answer the launch in place of the bundle that just replaced it.
		async relaunch(appPath) {
			const proc = Bun.spawn(["open", "-n", appPath], { stdout: "ignore", stderr: "pipe" });
			const [stderr, code] = await Promise.all([
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			if (code === 0) return;
			throw new UpdaterAdapterError(
				"relaunch-failed",
				`updater: open ${appPath}: ${stderr.trim() || `exit ${code}`}`,
			);
		},
	};
}
