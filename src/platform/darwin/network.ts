/**
 * The macOS half of `crust:network`: the adapter over the runtime `WKURLSchemeHandler` the C unit
 * builds (`network-ffi.ts` compiles it, `shim/110_network.c` + `shim/113_network_serve.c` hold it).
 * **The seam.** The handler's two IMPs are C. Two `JSCallback`s answer it: one decides (1 serve, 0
 * block) and one fills the body and content-type buffers, because WebKit has no pass-through and
 * `+[NSData dataWithContentsOfURL:]` answers nil for a custom scheme (measured 2026-11-16), so the
 * bytes must come from the rule set. Neither callback carries an object, and the URL is read back as
 * a byte range, never a `cstring` return.
 * **The precondition.** WebKit only accepts a scheme handler on a `WKWebViewConfiguration` no
 * webview has used yet, and a send to a used one raises — a SIGABRT with no JavaScript error. So
 * the caller supplies the configuration and this module never guesses one.
 */

import { FFIType, JSCallback, ptr, toArrayBuffer } from "bun:ffi";

import type { NetworkAdapter, NetworkDecision, NetworkInstall } from "@/plugins/network";
import { NETWORK_DEFAULT_TYPE, NETWORK_URL_LIMIT } from "@/plugins/network";
import { networkUnit, type NetworkUnit } from "./network-ffi.ts";

export { networkSource, networkUnit, type NetworkUnit } from "./network-ffi.ts";

const P = FFIType.ptr;
const I32 = FFIType.i32;

/** The first buffer size for a URL; anything longer is re-read at its exact length. */
/**
 * The read buffer for the URL, and it must cover the native buffer whole. `net_copy` in
 * `shim/110_network.c` keeps at most `NET_TEXT - 1` bytes, so a read of exactly
 * `NETWORK_URL_LIMIT + 1` sees every byte the handler still has — one read, no growth loop. The
 * loop it replaces could never grow: `net_url` answers the bytes it copied, not the URL's true
 * length, so a 1024-byte buffer truncated every URL to 1023 and the plugin's fail-closed bound
 * could never be reached (measured 2026-11-16).
 */
export const URL_CHUNK = NETWORK_URL_LIMIT + 1;

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	if (typeof raw === "number") return raw;
	if (typeof raw === "bigint") return Number(raw);
	throw new Error("crust: JSCallback exposed no usable pointer");
}

/** The URL as a byte range. Whatever it decodes to is either the whole URL or one the plugin refuses. */
function readUrl(call: (into: Uint8Array) => number): string {
	const buffer = new Uint8Array(URL_CHUNK);
	const length = call(buffer);
	if (length <= 0) return "";
	return new TextDecoder().decode(buffer.subarray(0, Math.min(length, buffer.length - 1)));
}

export interface DarwinNetworkOptions {
	/**
	 * The `WKWebViewConfiguration` a window is built from, before the webview exists. Absent means
	 * nothing can be intercepted, and `install` says so instead of sending into WebKit.
	 */
	configuration?: () => number | undefined;
}

export function darwinNetworkAdapter(options: DarwinNetworkOptions = {}): NetworkAdapter {
	const unit = (): NetworkUnit => networkUnit();
	let action: JSCallback | undefined;
	let fill: JSCallback | undefined;
	/** The decision the two callbacks share: `decide` sets it, `fill` reads it, in that order. */
	let reply: NetworkDecision = { action: "block" };

	const ensure = (decide: (url: string) => NetworkDecision): void => {
		if (action !== undefined && fill !== undefined) return;
		const symbols = unit().symbols;
		action = new JSCallback(
			() => {
				reply = decide(readUrl((into) => Number(symbols.net_url(ptr(into), into.length))));
				return reply.action === "allow" ? 1 : 0;
			},
			{ args: [], returns: I32 },
		);
		// The handler is synchronous, so the body is written during the same call it decided in.
		// A body over the buffer is refused (a negative length) rather than truncated.
		fill = new JSCallback(
			(body: number, bodyCap: number, mime: number, mimeCap: number) => {
				if (reply.action !== "allow") return -1;
				const encoder = new TextEncoder();
				const bytes = encoder.encode(reply.body ?? "");
				const type = encoder.encode(reply.type ?? NETWORK_DEFAULT_TYPE);
				if (bytes.length > bodyCap || type.length > mimeCap - 1) return -1;
				new Uint8Array(toArrayBuffer(body, 0, bytes.length)).set(bytes);
				new Uint8Array(toArrayBuffer(mime, 0, type.length)).set(type);
				return bytes.length;
			},
			{ args: [P, I32, P, I32], returns: I32 },
		);
	};

	return {
		install(scheme, decide): NetworkInstall {
			const configuration = options.configuration?.();
			if (!configuration) {
				return {
					ok: false,
					reason: "network.install needs the WKWebViewConfiguration a window is built from: pass { configuration } to darwinNetworkAdapter, and build the webview with -initWithFrame:configuration:.",
				};
			}
			ensure(decide);
			const bytes = new TextEncoder().encode(scheme);
			const registered = Number(
				unit().symbols.net_install(
					configuration,
					ptr(bytes),
					bytes.length,
					callbackPointer(action as JSCallback),
					callbackPointer(fill as JSCallback),
				) ?? 0,
			);
			if (registered === 1) return { ok: true, reason: "registered" };
			return { ok: false, reason: "setURLSchemeHandler:forURLScheme: refused the scheme" };
		},
	};
}

/** How many bytes this process has delivered through the scheme, and how many tasks answered. */
export function networkServed(): { bytes: number; tasks: number } {
	const symbols = networkUnit().symbols;
	return { bytes: Number(symbols.net_served() ?? 0), tasks: Number(symbols.net_tasks() ?? 0) };
}
