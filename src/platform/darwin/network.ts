/**
 * The macOS half of `crust:network`: the adapter over the runtime `WKURLSchemeHandler` the C unit
 * builds (`network-ffi.ts` compiles it, `shim/110_network.c` holds it).
 * **The seam.** The handler's two IMPs are C; the rule decision is one `JSCallback` that answers
 * `1` or `0`, and the URL it was asked about is read back as a C string, so no object crosses.
 * **The precondition.** WebKit only accepts a scheme handler on a `WKWebViewConfiguration` no
 * webview has used yet, and a send to a used one raises — a SIGABRT with no JavaScript error. So
 * the caller supplies the configuration and this module never guesses one.
 */

import { FFIType, JSCallback, ptr } from "bun:ffi";

import type { NetworkAction, NetworkAdapter, NetworkInstall } from "@/plugins/network";
import { networkUnit } from "./network-ffi.ts";

export { networkSource, networkUnit, type NetworkUnit } from "./network-ffi.ts";

// A strong reference for the duration of one send: bun:ffi reads the bytes during the call.
let pinned: Uint8Array | undefined;

function bytesOf(text: string): { address: number; length: number } {
	const bytes = new TextEncoder().encode(text);
	pinned = bytes;
	return { address: ptr(bytes), length: bytes.length };
}

function pointerOf(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	if (typeof raw === "number") return raw;
	if (typeof raw === "bigint") return Number(raw);
	throw new Error("crust: JSCallback exposed no usable pointer");
}

export interface DarwinNetworkOptions {
	/**
	 * The `WKWebViewConfiguration` a window is built from, before the webview exists. Absent means
	 * nothing can be intercepted, and `install` says so instead of sending into WebKit.
	 */
	configuration?: () => number | undefined;
}

export function darwinNetworkAdapter(options: DarwinNetworkOptions = {}): NetworkAdapter {
	let channel: JSCallback | undefined;

	const ensure = (decide: (url: string) => NetworkAction): JSCallback => {
		if (channel !== undefined) return channel;
		const unit = networkUnit();
		// WebKit's handler is synchronous, so the decision is read here and answered as an int.
		channel = new JSCallback(
			() => (decide(String(unit.symbols.net_url() ?? "")) === "allow" ? 1 : 0),
			{ args: [], returns: FFIType.i32 },
		);
		return channel;
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
			const { address, length } = bytesOf(scheme);
			const registered = Number(
				networkUnit().symbols.net_install(
					configuration,
					address,
					length,
					pointerOf(ensure(decide)),
				) ?? 0,
			);
			if (registered === 1) return { ok: true, reason: "registered" };
			return { ok: false, reason: "setURLSchemeHandler:forURLScheme: refused the scheme" };
		},
	};
}
