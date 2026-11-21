/**
 * `startApp`'s host questions — which port to bind, which document to serve, which entry module to import — none of which needs the app instance, so they live beside `runtime.ts` rather than inside it.
 */

import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AssetTable, BridgeHandle } from "@/bridge/server.ts";
import { DEFAULT_WINDOW_LABEL } from "@/bridge/window-identity.ts";
import { devHandshakePath } from "./dev-handshake-path.ts";
import { BRIDGE_TOKEN_VAR, BRIDGE_URL_VAR } from "@/vite.ts";

/** The origin a dev server serves from, or undefined when the URL is unusable. */
export function originOf(url: string): string | undefined {
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}

/**
 * A stable port for an app, derived from its id. The bridge used to bind `0`, which changes the page's origin every launch and discards localStorage, IndexedDB, service workers and per-origin caches; the caller walks upward when the port is taken and falls back to ephemeral rather than failing.
 */
export function preferredPortFor(appId: string): number {
	let hash = 2166136261;
	for (let index = 0; index < appId.length; index++) {
		hash ^= appId.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return 45000 + ((hash >>> 0) % 4000);
}

/**
 * The message when every bridge bind fails. The loop in `startApp` tries the app's
 * preferred port and the 19 above it, then an OS-assigned port; naming the range
 * and the two next actions turns the failure into something the author can fix.
 */
export function bridgeBindFailure(preferred: number, cause?: unknown): Error {
	const reason =
		cause instanceof Error ? cause.message : cause === undefined ? "" : String(cause);
	return new Error(
		`crust: the bridge could not bind a port — tried ${preferred}-${preferred + 19} ` +
			`and an OS-assigned port${reason ? ` (last error: ${reason})` : ""}. ` +
			`Free the port or use another one: check what holds ${preferred} with ` +
			`\`lsof -nP -iTCP:${preferred}\`, or change app.id in crust.config.ts to shift the preferred port`,
	);
}

/** The narrow bridge shape the handshake needs: its address and the one-shot document-token mint. */
export interface DevBridge {
	readonly url: string;
	mintPageToken(label?: string): string;
}

/** Handshakes this process still owes a removal, drained on every normal exit path. */
const exitCleanups = new Map<string, () => void>();
let exitHooked = false;

/** Remove this project's dev handshake, so no later page can inject a dead or foreign token. */
export function removeDevHandshake(projectDir: string): void {
	const handshake = devHandshakePath(projectDir);
	rmSync(handshake, { force: true });
	exitCleanups.delete(handshake);
}

/**
 * Publish the dev handshake the Vite plugin reads, once, at the moment the bridge is bound.
 *
 * The runtime mints a document token here — never the seed — and writes that where the dev server
 * reads it, so the page can invoke but cannot mint a document for a label of its choosing, and the
 * mint cannot race the bridge bind. Any failure is fatal: a dev run whose page has no client is
 * exactly the failure this path exists to prevent.
 */
export function publishDevHandshake(
	projectDir: string,
	bridge: DevBridge,
	labels: readonly string[] = [DEFAULT_WINDOW_LABEL],
): string {
	let reason: string;
	try {
		// One token per configured label: a dev-server page never reaches the document
		// route that mints a labelled token, so the handshake must carry them all and the
		// Vite plugin must pick the one matching its own `?window=`.
		const tokens: Record<string, string> = {};
		for (const label of labels.length === 0 ? [DEFAULT_WINDOW_LABEL] : labels) {
			const token = bridge.mintPageToken(label);
			if (token.length === 0)
				throw new Error(`the bridge minted an empty token for ${label}`);
			tokens[label] = token;
		}
		const pageToken = tokens[DEFAULT_WINDOW_LABEL] ?? Object.values(tokens)[0] ?? "";
		// Outside the served project root: no page can fetch a token it was not given.
		const handshake = devHandshakePath(projectDir);
		// 0600: the file carries bearer credentials, and without an explicit mode a 0644 umask
		// lets every local account drive the bridge. chmod also tightens a pre-existing file.
		writeFileSync(handshake, JSON.stringify({ url: bridge.url, token: pageToken, tokens }), {
			mode: 0o600,
		});
		chmodSync(handshake, 0o600);
		process.env.CRUST_DEV_FILE = handshake;
		process.env[BRIDGE_URL_VAR] = bridge.url;
		process.env[BRIDGE_TOKEN_VAR] = pageToken;
		exitCleanups.set(handshake, () => rmSync(handshake, { force: true }));
		if (!exitHooked) {
			exitHooked = true;
			process.once("exit", () => {
				for (const cleanup of exitCleanups.values()) cleanup();
				exitCleanups.clear();
			});
		}
		return handshake;
	} catch (error) {
		reason = error instanceof Error ? error.message : String(error);
	}
	throw new Error(
		`crust: the dev page cannot get its client — minting or publishing its document token ` +
			`failed (${reason}). No page will be served without window.crust`,
	);
}

/**
 * The stop half of the dev handshake lifecycle. Removing it here means a restart,
 * an entry that throws and a normal shutdown all clear the file, so no later page
 * can inject a dead or foreign token.
 */
export function withHandshakeCleanup(handle: BridgeHandle, projectDir: string): BridgeHandle {
	return {
		...handle,
		async stop() {
			try {
				await handle.stop();
			} finally {
				removeDevHandshake(projectDir);
			}
		},
	};
}

export async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await Bun.file(path).stat()).isDirectory();
	} catch {
		return false;
	}
}

/**
 * The backend entry: an explicit path must exist; otherwise `src/main.ts` then
 * `main.ts`, matching the CLI's rule so both entry points agree.
 */
export async function resolveEntry(explicit: string | undefined): Promise<string | undefined> {
	if (explicit) {
		const path = resolve(explicit);
		return (await Bun.file(path).exists()) ? path : undefined;
	}
	for (const candidate of ["src/main.ts", "main.ts"]) {
		const path = resolve(candidate);
		if (await Bun.file(path).exists()) return path;
	}
	return undefined;
}

/** The document the bridge will serve, from the binary's assets or from disk. */
export async function readIndex(
	root: string | undefined,
	assets?: AssetTable,
): Promise<string | undefined> {
	const embedded = assets?.["/index.html"];
	if (typeof embedded === "string") return embedded;
	if (!root) return undefined;
	const file = Bun.file(join(root, "index.html"));
	return (await file.exists()) ? await file.text() : undefined;
}
