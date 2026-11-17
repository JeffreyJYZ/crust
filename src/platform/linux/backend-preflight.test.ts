import { describe, expect, test } from "bun:test";
import { createGtkBackend } from "./backend.ts";
import type { LinuxShim } from "./shim-ffi.ts";

/** The launch guard is the subject here, so the symbol table only records calls. */
function fakeSymbols() {
	const calls: string[] = [];
	const symbols: LinuxShim = {
		shim_lib_open: () => {
			calls.push("lib_open");
			return 1;
		},
		shim_lib_error_text: () => "",
		shim_gtk_init: () => {
			calls.push("gtk_init");
			return 1;
		},
		shim_pump: () => 1,
		shim_window_new: () => 100,
		shim_window_attach: () => 1,
		shim_window_show: () => {},
		shim_window_destroy: () => {},
		shim_window_alive: () => 1,
		shim_webview_new: () => 101,
		shim_webview_load: () => 1,
	};
	return { symbols, calls };
}

describe("launch preflight", () => {
	test("load runs the probe first and never opens libraries that failed it", () => {
		const { symbols, calls } = fakeSymbols();
		let probes = 0;
		const missing = "libgtk-3.so.0 not loadable (gtk_window_new unresolved)";
		const backend = createGtkBackend(
			() => symbols,
			() => {
				probes++;
				return [missing];
			},
		);
		expect(() => backend.load()).toThrow("gtk_window_new unresolved");
		expect(probes).toBe(1);
		// The C dlopen path was never reached: the named symbol is the whole error.
		expect(calls).toEqual([]);
	});

	test("a failed load can succeed on retry once the probe passes", () => {
		const { symbols, calls } = fakeSymbols();
		let attempts = 0;
		const backend = createGtkBackend(
			() => symbols,
			() => (attempts++ === 0 ? ["libgtk-3.so.0 not loadable"] : []),
		);
		expect(() => backend.load()).toThrow("not loadable");
		backend.load();
		expect(calls).toEqual(["lib_open", "gtk_init"]);
	});
});
