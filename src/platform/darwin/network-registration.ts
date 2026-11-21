/**
 * The one place `crust-net` is registered on the process's `WKWebViewConfiguration`. WebKit copies a
 * configuration when a webview is built, so registration must happen on the configuration *before*
 * the first window — `webview-configuration.ts` calls `primeNetwork` at creation, and the plugin's
 * later `install` only swaps in the real decision callback and observes the registration that is
 * already there. The two JSCallbacks are created once because C keeps one function pointer per IMP.
 */

import { FFIType, JSCallback, ptr, toArrayBuffer } from "bun:ffi";

import { NETWORK_DEFAULT_TYPE, NETWORK_URL_LIMIT } from "@/plugins/network";
import type { NetworkDecision, NetworkInstall } from "@/plugins/network-types";
import { networkUnit } from "./network-ffi.ts";

const P = FFIType.ptr;
const I32 = FFIType.i32;

/** The native URL buffer is `NET_TEXT - 1` bytes; read one more to see every byte it kept. */
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

/** Until the plugin installs, a task is allowed with an empty body rather than blocking the page. */
let decide: (url: string) => NetworkDecision = () => ({ action: "allow" });
let action: JSCallback | undefined;
let fill: JSCallback | undefined;
/** One configuration may carry several schemes, but a scheme may be set only once on it. */
const registered = new Set<string>();

function ensure(): void {
	if (action !== undefined && fill !== undefined) return;
	const symbols = networkUnit().symbols;
	action = new JSCallback(
		() => {
			last = decide(readUrl((into) => Number(symbols.net_url(ptr(into), into.length))));
			return last.action === "allow" ? 1 : 0;
		},
		{ args: [], returns: I32 },
	);
	// The handler is synchronous, so the body is written during the same call it decided in.
	// A body over the buffer is refused (a negative length) rather than truncated.
	fill = new JSCallback(
		(body: number, bodyCap: number, mime: number, mimeCap: number) => {
			const answer = last;
			if (answer.action !== "allow") return -1;
			const encoder = new TextEncoder();
			const bytes = encoder.encode(answer.body ?? "");
			const type = encoder.encode(answer.type ?? NETWORK_DEFAULT_TYPE);
			if (bytes.length > bodyCap || type.length > mimeCap - 1) return -1;
			new Uint8Array(toArrayBuffer(body, 0, bytes.length)).set(bytes);
			new Uint8Array(toArrayBuffer(mime, 0, type.length)).set(type);
			return bytes.length;
		},
		{ args: [P, I32, P, I32], returns: I32 },
	);
}

/** The decision the two callbacks share: `action` sets it, `fill` reads it, in that order. */
let last: NetworkDecision = { action: "block" };

/**
 * Have the process's configuration carry `scheme` now, while no webview has copied it. Repeated
 * calls with the same configuration and scheme are a no-op, so the plugin's lazy `install` cannot
 * register a second handler and abort WebKit; it only replaces the decision callback.
 */
export function installNetwork(configuration: number, scheme: string, onDecide?: (url: string) => NetworkDecision): NetworkInstall {
	if (!configuration) {
		return { ok: false, reason: "network needs the WKWebViewConfiguration a window is built from" };
	}
	if (onDecide !== undefined) decide = onDecide;
	ensure();
	const key = `${configuration}:${scheme}`;
	if (!registered.has(key)) {
		const bytes = new TextEncoder().encode(scheme);
		const landed = Number(
			networkUnit().symbols.net_install(
				configuration,
				ptr(bytes),
				bytes.length,
				callbackPointer(action as JSCallback),
				callbackPointer(fill as JSCallback),
			) ?? 0,
		);
		if (landed !== 1) {
			return { ok: false, reason: "setURLSchemeHandler:forURLScheme: refused the scheme" };
		}
		registered.add(key);
	}
	return { ok: true, reason: "registered" };
}

/** Called by `webviewConfiguration` before any webview exists; the real callback arrives later. */
export function primeNetwork(configuration: number, scheme: string): NetworkInstall {
	return installNetwork(configuration, scheme);
}
