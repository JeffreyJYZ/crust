import { describe, expect, test } from "bun:test";
import { createGtkBackend } from "./backend.ts";
import { fakeShim } from "./backend-shim-fake.ts";

/**
 * The seam an embedded surface needs: one positioned container per window, the app's own webview as
 * its main child, and a rectangle in points for anything placed over it. No GTK is touched — the
 * symbol table records exactly what C would receive, which is the part a fake can prove and a Mac
 * cannot.
 */
const URL = "http://127.0.0.1:4123/";

function backend() {
	const { symbols, calls, args, boxes } = fakeShim();
	return {
		calls,
		args,
		boxes,
		backend: createGtkBackend(
			() => symbols,
			() => [],
		),
	};
}

describe("the window's container", () => {
	test("is created before the webview is attached, and the window reports it", () => {
		const { calls, backend: gtk } = backend();
		gtk.load();
		const created = gtk.createWindow({ label: "main", title: "main" }, URL);
		expect(calls.indexOf("window_container")).toBeLessThan(calls.indexOf("window_attach"));
		expect(created.box).not.toBe(0n);
		expect(created.box).not.toBe(created.win);
		expect(created.box).not.toBe(created.web);
	});

	test("is one per window: a second window gets its own, and the first keeps its box", () => {
		const { backend: gtk } = backend();
		gtk.load();
		const first = gtk.createWindow({ label: "one" }, URL);
		const second = gtk.createWindow({ label: "two" }, URL);
		expect(first.box).not.toBe(second.box);
		expect(gtk.createWindow({ label: "three" }, URL).box).not.toBe(first.box);
	});

	test("the app's own webview is attached through the window, not as a surface", () => {
		const { args, backend: gtk } = backend();
		gtk.load();
		const created = gtk.createWindow({ label: "main" }, URL);
		// The C side routes this into the container's main child, so the window and its own page are
		// what the attach carries — a surface is placed, never attached.
		expect(args.window_attach).toEqual([created.win, created.web]);
	});
});

describe("placing a surface", () => {
	test("a rectangle crosses as four ints after the box and the view", () => {
		const { args, backend: gtk } = backend();
		gtk.load();
		const created = gtk.createWindow({ label: "main" }, URL);
		const surface = 900n;
		const placed = gtk.placeWebview(created.box, surface, {
			x: 24.4,
			y: 15.6,
			width: 219.5,
			height: 120,
		});
		expect(placed).toBe(true);
		// Rounded, not truncated: GTK takes points as ints and a half point is closer to the next.
		expect(args.webview_place).toEqual([created.box, surface, 24, 16, 220, 120]);
	});

	test("a bound that is not a finite number is refused before C sees it", () => {
		const { calls, backend: gtk } = backend();
		gtk.load();
		const created = gtk.createWindow({ label: "main" }, URL);
		const rect = { x: Number.NaN, y: 0, width: 100, height: 100 };
		expect(() => gtk.placeWebview(created.box, 900n, rect)).toThrow("finite numbers");
		expect(calls).not.toContain("webview_place");
	});

	test("GTK's refusal is false, never a success that leaves the surface where it was", () => {
		const { backend: gtk } = backend();
		gtk.load();
		// A box this process never minted: the fake answers 0, which is what a C shim answers when the
		// container or its entry points are absent.
		expect(gtk.placeWebview(42n, 900n, { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
	});

	test("placing before load throws instead of calling a null entry point", () => {
		const { backend: gtk } = backend();
		expect(() => gtk.placeWebview(1n, 2n, { x: 0, y: 0, width: 1, height: 1 })).toThrow(
			"before load",
		);
	});
});
