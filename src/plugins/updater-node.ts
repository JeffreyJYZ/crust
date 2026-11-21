/**
 * The updater's default adapter: `fetch`, `node:fs` and `open`, the tools Bun and macOS already have, so an update needs no dependency added.
 * Each member is a seam a test replaces, which is why the plugin never reaches past it.
 */

import { createHash, type Hash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { isZip, readArchive, type Archive } from "./updater-archive";
import { fileNameFor, UpdaterAdapterError } from "./updater-args";
import { fetchFollowing, readBounded } from "./updater-fetch";
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
		// The name is the path relative to the bundle root, never the basename: `X/a.txt` and
		// `Y/a.txt` are different files, and hashing only `a.txt` let one tree digest stand for
		// both, so a verified bundle could be rearranged between directories undetected.
		for (const entry of (await readdir(path)).sort()) {
			const relative = name === "" ? entry : `${name}/${entry}`;
			await digestTree(hash, join(path, entry), relative);
		}
		return;
	}
	hash.update(`f ${name}\n`);
	hash.update(await readFile(path));
}

/**
 * How many bytes one artifact may be, and the redirect policy: both live in `updater-fetch` so the
 * adapter stays a thin seam.
 */

export function nodeUpdaterAdapter(): UpdaterAdapter {
	return {
		async fetchJson(url) {
			// A feed on GitHub Releases answers 302 to the object store, so the manifest follows the
			// same bounded https-only hops `download` does instead of failing on the normal host.
			const response = await fetchFollowing(url, { headers: { accept: "application/json" } });
			if (!response.ok) {
				throw new UpdaterAdapterError("check-failed", `updater: ${url} ${response.status}`);
			}
			return await response.json();
		},
		async download(url, directory) {
			const response = await fetchFollowing(url);
			if (!response.ok) {
				throw new UpdaterAdapterError(
					"download-failed",
					`updater: ${url} ${response.status}`,
				);
			}
			const bytes = await readBounded(response, url);
			const path = join(directory, fileNameFor(url));
			await writeFile(path, bytes);
			return { path, bytes: bytes.byteLength };
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
		// Bun reads tar and no zip, and its tar extraction drops the unix mode, so a zip is read
		// here. `readArchive` has already refused every escaping name, and the mode is applied so
		// the bundle's executable stays executable.
		async extractZip(archive) {
			const bytes = new Uint8Array(await readFile(archive));
			if (!isZip(bytes)) return undefined;
			let parsed: Archive;
			try {
				parsed = readArchive(bytes);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				throw new UpdaterAdapterError(
					"invalid-archive",
					`updater: the archive ${archive} ${reason}`,
				);
			}
			const directory = await mkdtemp(join(tmpdir(), "crust-extract-"));
			for (const entry of parsed.entries) {
				const path = join(directory, entry.name);
				if (entry.kind === "directory") {
					// A directory the owner cannot traverse is not extractable, so the execute bits
					// are forced on while the archive's group and other bits are kept.
					await mkdir(path, { recursive: true, mode: (entry.mode || 0o755) | 0o700 });
					continue;
				}
				await mkdir(dirname(path), { recursive: true });
				if (entry.kind === "symlink") {
					await symlink(entry.target ?? "", path);
					continue;
				}
				const mode = entry.mode || 0o644;
				await writeFile(path, entry.bytes ?? new Uint8Array(), { mode });
			}
			return { path: join(directory, parsed.root), entries: parsed.entries.length };
		},
		async isAppBundle(path) {
			if (!path.endsWith(".app")) return false;
			const info = await stat(path).catch(() => undefined);
			return info?.isDirectory() === true;
		},
		// One rename on one volume is atomic, and the temp dir shares the boot volume with
		// `/Applications`. A cross-volume EXDEV is a real install error, not a case to paper
		// over with a copy that is no longer atomic.
		// A symlink to this app's bundle is that bundle, so the swap lands on what the link
		// resolves to: renaming the link itself leaves the real bundle stale and the update
		// installed nowhere.
		async replaceBundle(source, target, backup) {
			await rm(backup, { recursive: true, force: true });
			const real = await realpath(target).catch(() => target);
			await rename(real, backup);
			try {
				await rename(source, real);
			} catch (error) {
				await rename(backup, real).catch(() => undefined);
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
