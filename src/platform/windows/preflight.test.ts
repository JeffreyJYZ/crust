import { describe, expect, test } from "bun:test";
import { defaultBackend } from "./backend-default.ts";
import {
	missingEntryPoints,
	PREFLIGHT,
	preflightError,
	WEBVIEW2_BOOTSTRAPPER_URL,
} from "./preflight.ts";
import { readShimSource } from "./shim-source.ts";

const READY = { buildNumber: "10.0.22631", loader: true, coreVersion: "120.0.2210.91" };

describe("preflightError", () => {
	test("a ready machine has nothing to say", () => {
		expect(preflightError(READY)).toBeUndefined();
	});

	/**
	 * The loader and the runtime are separate facts: the DLL can ship beside the binary while the
	 * Evergreen runtime behind it is absent, and only the bootstrapper fixes that one.
	 */
	test("a missing runtime names the runtime, the build and the download", () => {
		const text = preflightError({
			buildNumber: "10.0.19045",
			loader: false,
			coreVersion: undefined,
		});
		expect(text ?? "").toContain("WebView2Loader.dll");
		expect(text ?? "").toContain("Microsoft.Web.WebView2.Core");
		expect(text ?? "").toContain("Windows build 10.0.19045");
		expect(text ?? "").toContain(
			`Install the Evergreen Bootstrapper: ${WEBVIEW2_BOOTSTRAPPER_URL}`,
		);
	});

	test("a loader with no runtime behind it still names the runtime", () => {
		const text = preflightError({ buildNumber: "10.0.22631", loader: true });
		expect(text ?? "").not.toContain("WebView2Loader.dll");
		expect(text ?? "").toContain("Microsoft.Web.WebView2.Core");
	});

	test("one remedy line, never one per missing piece", () => {
		const text = preflightError({ buildNumber: "10.0.22631", loader: false }) ?? "";
		expect(text.split(WEBVIEW2_BOOTSTRAPPER_URL)).toHaveLength(2);
	});

	test("unresolved entry points are counted, then listed by name", () => {
		const text =
			preflightError({
				...READY,
				missing: ["user32.dll!PeekMessageW", "ole32.dll!CoInitializeEx"],
			}) ?? "";
		expect(text).toContain("2 entry point(s) did not resolve");
		expect(text).toContain("user32.dll!PeekMessageW");
		expect(text).toContain("ole32.dll!CoInitializeEx");
		expect(text).not.toContain(WEBVIEW2_BOOTSTRAPPER_URL);
	});

	test("a runtime gap and unresolved symbols both appear", () => {
		const text =
			preflightError({ buildNumber: "10.0.22631", loader: false, missing: ["a!b"] }) ?? "";
		expect(text).toContain(WEBVIEW2_BOOTSTRAPPER_URL);
		expect(text).toContain("a!b");
	});
});

describe("PREFLIGHT", () => {
	// Derive the set from the shim itself: a hard-coded list goes stale the moment a bind is added.
	const source = readShimSource();
	const bound = [...source.matchAll(/SHIM_BIND\(g_\w+,\s*([A-Za-z_]\w*)\)/g)].map(
		(match) => match[1] ?? "",
	);
	const loader = /GetProcAddress\(loader,\s*"([A-Za-z_]\w*)"\)/.exec(source)?.[1];
	const expected = [...bound, ...(loader ? [loader] : [])].sort();

	// Guards the list itself: a shim call added without a preflight entry is a crash with no error.
	test("covers every entry point the shim calls", () => {
		expect(expected.length).toBeGreaterThanOrEqual(26);
		expect(PREFLIGHT.map((entry) => entry.symbol).sort()).toEqual(expected);
	});

	test("every entry says what breaks without it", () => {
		for (const entry of PREFLIGHT) expect(entry.breaks.length).toBeGreaterThan(0);
	});
});

describe("probing entry points", () => {
	test("names every unresolved entry in table order", () => {
		const bad = new Set(["user32.dll!PeekMessageW", "kernel32.dll!VirtualQuery"]);
		const names = missingEntryPoints(
			PREFLIGHT,
			(module, symbol) => !bad.has(`${module}!${symbol}`),
		);
		expect(names).toEqual(["user32.dll!PeekMessageW", "kernel32.dll!VirtualQuery"]);
	});

	test("the real backend runs the table, not an empty report", () => {
		expect(defaultBackend(() => false).probe().missing?.length).toBe(PREFLIGHT.length);
		expect(defaultBackend(() => true).probe().missing).toEqual([]);
	});
});
