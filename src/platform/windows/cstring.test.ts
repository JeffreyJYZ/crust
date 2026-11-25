import { describe, expect, test } from "bun:test";
import { cstring } from "./cstring.ts";
import type { WindowsBackend, WindowsShim } from "./backend.ts";
import { fakeShim } from "./fake-shim.ts";
import { createPlatform } from "./platform.ts";

/**
 * A symbol table that records the raw arguments it was handed. This is the only way to prove the
 * argument encoding on a machine with no user32: the defect it guards against is a JavaScript
 * string reaching an `FFIType.cstring` argument, which bun:ffi throws on before C ever runs —
 * measured on Linux against real GTK, where the throw arrived at `createWindow`.
 */
function recordingBackend(): { backend: WindowsBackend; args: Record<string, unknown[]> } {
	const args: Record<string, unknown[]> = {};
	const open = new Set<number>();
	let next = 100;
	const shim: WindowsShim = {
		...fakeShim(),
		shim_register_class: (name) => {
			args.register_class = [name];
			return 1;
		},
		shim_pump: () => 0,
		shim_post_quit: () => {},
		shim_window_new: (title, width, height, className) => {
			args.window_new = [title, width, height, className];
			const hwnd = next++;
			open.add(hwnd);
			return hwnd;
		},
		shim_window_is_open: (hwnd) => (open.has(Number(hwnd)) ? 1 : 0),
		shim_window_set_title: (hwnd, title) => {
			args.set_title = [hwnd, title];
			return 1;
		},
		shim_window_destroy: () => 1,
		shim_window_client_num: (_hwnd, component) => (component === 2 ? 800 : 600),
		shim_webview_new: (hwnd, url, userData) => {
			args.webview_new = [hwnd, url, userData];
			return 1;
		},
		shim_webview_put_bounds: () => 1,
		shim_webview_close: () => {},
	};
	return {
		args,
		backend: {
			probe: () => ({ buildNumber: "10.0.22631", loader: true, coreVersion: "120.0" }),
			load: () => shim,
			exit: () => {},
		},
	};
}

/** The string a `cstring` argument carried, decoded from the bytes C receives. */
function decode(value: unknown): string {
	if (!(value instanceof Uint8Array)) throw new Error(`not a byte buffer: ${typeof value}`);
	return new TextDecoder().decode(value);
}

/** A NUL-terminated buffer whose bytes are exactly `value`. */
function expectCString(value: unknown, expected: string): void {
	expect(value).toBeInstanceOf(Uint8Array);
	const bytes = value as Uint8Array;
	expect(bytes.at(-1)).toBe(0);
	expect(bytes.length).toBe(Buffer.byteLength(expected, "utf8") + 1);
	expect(decode(bytes)).toBe(`${expected}\u0000`);
}

const URL = "http://127.0.0.1:4123/";

describe("FFI argument encoding", () => {
	test("an embedded NUL is refused, not truncated at the Win32 boundary", () => {
		expect(() => cstring("secret\0hidden")).toThrow(/contains an embedded NUL/);
		expect(() => cstring("plain")).not.toThrow();
	});

	test("the class name is a NUL-terminated buffer, never a JavaScript string", async () => {
		const { backend, args } = recordingBackend();
		const platform = createPlatform({ appName: "crust-test" }, backend);
		await platform.start();
		expectCString(args.register_class?.[0], "crust-test");
	});

	test("the window title and class arrive as buffers, and the numbers stay numbers", async () => {
		const { backend, args } = recordingBackend();
		const platform = createPlatform({ appName: "crust-test" }, backend);
		await platform.start();
		platform.createWindow({ label: "main", title: "crust café", width: 900, height: 640 });
		expectCString(args.window_new?.[0], "crust café");
		expect(args.window_new?.[1]).toBe(900);
		expect(args.window_new?.[2]).toBe(640);
		expectCString(args.window_new?.[3], "crust-test");
	});

	test("the URL reaches the webview as the URL the window was created with", async () => {
		const { backend, args } = recordingBackend();
		const platform = createPlatform({ appName: "crust-test" }, backend);
		await platform.start();
		platform.createWindow({ label: "main", url: URL });
		expectCString(args.webview_new?.[1], URL);
		expect(platform.windowUrl("main")).toBe(URL);
	});

	test("an empty title and an empty user-data folder are one NUL byte, not an empty string", async () => {
		const { backend, args } = recordingBackend();
		const platform = createPlatform({ appName: "crust-test" }, backend);
		await platform.start();
		platform.createWindow({ label: "main", title: "" });
		const title = args.window_new?.[0] as Uint8Array;
		expect(title).toBeInstanceOf(Uint8Array);
		expect(title.length).toBe(1);
		expect(decode(title)).toBe("\u0000");
		// An empty userData means "let WebView2 pick its own folder", which C reads as a zero
		// first byte — so the buffer must exist and be empty-after-NUL, never omitted.
		expectCString(args.webview_new?.[2], "");
	});

	test("no argument anywhere in the call path crosses as a JavaScript string", async () => {
		const { backend, args } = recordingBackend();
		const platform = createPlatform({ appName: "crust-test" }, backend);
		await platform.start();
		platform.createWindow({ label: "main", title: "crust", url: URL });
		const handed = Object.values(args).flat();
		expect(handed.length).toBeGreaterThan(0);
		for (const value of handed) {
			// bun:ffi throws on a string at a `cstring` or `ptr` argument, so one here is the
			// whole defect back again.
			expect(typeof value).not.toBe("string");
			expect(value instanceof Uint8Array || typeof value === "number").toBe(true);
		}
	});
});
