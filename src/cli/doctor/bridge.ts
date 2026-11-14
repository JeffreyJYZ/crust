/**
 * The loopback bridge, bound the way the runtime binds it: the port derived
 * from the app id, walking upward when it is taken, falling back to the OS's
 * choice last.
 */

import { startBridge } from "@/bridge/server.ts";
import type { Check } from "./check.ts";

/**
 * The port `startApp` will prefer for an app id.
 *
 * This is the same FNV-1a derivation `preferredPortFor` uses in `src/runtime.ts`
 * (`45000 + hash % 4000`), and it is duplicated here because doctor must know
 * the *preferred* port to tell "stable" from "the app walked upward". The pair
 * is pinned by a test that starts the real runtime and compares the port it
 * binds, so a change there fails the suite instead of silently making this
 * stale.
 */
export function preferredPort(appId: string): number {
	let hash = 2166136261;
	for (let index = 0; index < appId.length; index++) {
		hash ^= appId.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return 45000 + ((hash >>> 0) % 4000);
}

interface BoundBridge {
	bridge: ReturnType<typeof startBridge>;
	/** The port derived from the app id, absent when there is no id to derive from. */
	preferred?: number;
	/** How many ports above the preferred one were taken before this bind. */
	drift: number;
}

const PORT_ATTEMPTS = 20;
const DOCTOR_HANDLERS = { "__doctor.ping": () => "pong" };

/**
 * Bind the bridge the way the runtime does: the port derived from the app id,
 * walking upward when it is taken, and falling back to the OS's choice last.
 *
 * Doctor used to bind `0` only, which proves the bridge works but not the thing
 * that changed: an app whose derived port is occupied still opens, on a
 * different origin, and loses everything origin-scoped. Binding the same port
 * here is what lets that be reported instead of hidden.
 */
function bindBridge(appId: string | undefined): BoundBridge | undefined {
	const preferred = appId === undefined ? undefined : preferredPort(appId);
	const attempts = preferred === undefined ? 1 : PORT_ATTEMPTS + 1;
	for (let offset = 0; offset < attempts; offset++) {
		const port = preferred === undefined || offset === PORT_ATTEMPTS ? 0 : preferred + offset;
		try {
			return {
				bridge: startBridge({ handlers: DOCTOR_HANDLERS, port }),
				preferred,
				drift: offset,
			};
		} catch (error) {
			// Only a taken port is retried; anything else is doctor's to report.
			const text = error instanceof Error ? error.message : String(error);
			if (!/EADDRINUSE|in use/i.test(text)) throw error;
		}
	}
	return undefined;
}

/**
 * Bind the app's own port and answer one invoke through it.
 *
 * The port is released before doctor returns, so this leaves nothing running.
 */
export async function checkBridge(appId: string | undefined): Promise<Check> {
	const bound = bindBridge(appId);
	if (!bound) {
		return {
			name: "bridge",
			status: "fail",
			detail: "could not bind any port — the OS refused every attempt, so the window has no bridge",
		};
	}
	const { bridge, preferred, drift } = bound;
	try {
		const response = await fetch(`${bridge.url}/_crust/invoke`, {
			method: "POST",
			headers: {
				origin: `http://127.0.0.1:${bridge.port}`,
				authorization: `Bearer ${bridge.token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ plugin: "__doctor", command: "ping", args: null }),
		});
		const text = await response.text();
		if (response.status !== 200 || !text.includes("pong")) {
			return {
				name: "bridge",
				status: "fail",
				detail: `bound ${bridge.url} but invoke answered ${response.status}: ${text.slice(0, 160)}`,
			};
		}
		if (preferred === undefined) {
			return {
				name: "bridge",
				status: "ok",
				detail: `${bridge.url} answered "pong" (ephemeral — no app.id was read, so the stable port is not tested)`,
			};
		}
		if (drift === 0) {
			return {
				name: "bridge",
				status: "ok",
				detail: `${bridge.url} answered "pong" (stable port for ${appId})`,
			};
		}
		return {
			name: "bridge",
			status: "note",
			detail:
				`port ${preferred} is busy, so this launch binds ${bridge.port}; the page origin changes ` +
				"and localStorage/IndexedDB from the previous origin do not carry over — close the app " +
				"holding that port",
		};
	} finally {
		await bridge.stop();
	}
}
