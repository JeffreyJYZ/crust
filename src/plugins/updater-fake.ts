/**
 * The updater suite's fixtures: an offline adapter, a scratch directory, a real `.app` bundle, and
 * downloads that materialise their artifact inside the plugin's own temp dir so `install` has a
 * receipt to check. Every proof runs on real files through the default `node:fs` adapter, and only
 * the network half is faked, because a test must never reach an endpoint or open a bundle.
 */

import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createUpdaterPlugin, type UpdaterAdapter, type UpdaterOptions } from "@/plugins/updater";
import { nodeUpdaterAdapter } from "@/plugins/updater-node";
import type { DownloadResult } from "@/plugins/updater-types";

/** An https artifact URL: the only scheme `download` fetches unless the config opts in. */
export const UPDATE_URL = "https://example.test/Notes.app.zip";

export function offlineAdapter(overrides: Partial<UpdaterAdapter> = {}): UpdaterAdapter {
	const no = () => Promise.reject(new Error("a test tried to reach the network"));
	const fake = { ...nodeUpdaterAdapter(), fetchJson: no, download: no, relaunch: no };
	return { ...fake, ...overrides };
}

export function plugin(
	adapter: UpdaterAdapter,
	options: UpdaterOptions = {},
	/** The fake executable path `relaunch` derives this app's own bundle from. */
	execPath: string = process.execPath,
) {
	return createUpdaterPlugin(adapter, options, execPath).commands;
}

export async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-updater-"));
}

export async function bundle(dir: string, name: string, marker: string): Promise<string> {
	const path = join(dir, name);
	await mkdir(join(path, "Contents"), { recursive: true });
	await writeFile(join(path, "Contents", "marker.txt"), marker, "utf8");
	return path;
}

/** The digest the node adapter computes for a file or a bundle tree, which is what `download` wants. */
export async function digestOf(path: string): Promise<string> {
	return await nodeUpdaterAdapter().sha256(path);
}

/** The executable inside a bundle: the shape `install` and `relaunch` derive their own bundle from. */
export function executableOf(bundlePath: string): string {
	return join(bundlePath, "Contents", "MacOS", "Notes");
}

/**
 * The artifact `install` accepts: a download on the instance it returns, with this app's own bundle
 * pinned to `execPath`, because install replaces that bundle and nothing else.
 */
export async function verifiedDownload(
	source: string,
	execPath: string,
): Promise<{ commands: ReturnType<typeof plugin>; file: DownloadResult }> {
	const commands = plugin(delivering(source), {}, execPath);
	const sha256 = await digestOf(source);
	const file = (await commands.download({ url: UPDATE_URL, sha256 })) as DownloadResult;
	return { commands, file };
}

/** A download that writes `payload` into the temp dir, the way the node adapter writes a response. */
export function writing(payload: string): UpdaterAdapter {
	return offlineAdapter({
		download: async (_url, directory) => {
			const path = join(directory, "Notes.app.zip");
			await writeFile(path, payload);
			return { path, bytes: payload.length };
		},
	});
}

/**
 * A download that writes real archive bytes into the temp dir, so `download` and `install` run
 * against the artifact an author actually ships: a zip the node adapter reads and extracts itself.
 */
export function shipping(bytes: Uint8Array): UpdaterAdapter {
	return offlineAdapter({
		download: async (_url, directory) => {
			const path = join(directory, "Notes.app.zip");
			await writeFile(path, bytes);
			return { path, bytes: bytes.length };
		},
	});
}

/** A download that delivers an already-extracted bundle, so a receipt exists for a real `.app`. */
export function delivering(
	source: string,
	overrides: Partial<UpdaterAdapter> = {},
): UpdaterAdapter {
	return offlineAdapter({
		download: async (_url, directory) => {
			const path = join(directory, "Notes.app");
			await cp(source, path, { recursive: true });
			return { path, bytes: 0 };
		},
		...overrides,
	});
}

/** A real Ed25519 pair from WebCrypto: the same primitive the plugin verifies with. */
export async function signer(): Promise<{
	pubkey: string;
	/** Sign the exact bytes a manifest's signature covers: text, or a zip's own bytes. */
	sign: (payload: string | Uint8Array) => Promise<string>;
}> {
	const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
		"sign",
		"verify",
	])) as unknown as CryptoKeyPair;
	const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
	const pubkey = Buffer.from(raw).toString("base64");
	return {
		pubkey,
		sign: async (payload) => {
			const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
			const signature = await crypto.subtle.sign(
				{ name: "Ed25519" },
				pair.privateKey,
				new Uint8Array(bytes),
			);
			return Buffer.from(signature).toString("base64");
		},
	};
}
