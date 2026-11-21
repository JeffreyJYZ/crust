import { describe, expect, test } from "bun:test";
import { WindowAdapterError } from "@/plugins/window";
import { fakeAdapter } from "./window-adapter-fake.ts";
import { type FakeOptions, openFake } from "./window-fake.ts";

/**
 * The six original commands plus `create`, proved through the fake shim because this machine has no
 * GTK. Every case here is a refusal or a read-back: the adapter's job is to answer what GTK actually
 * did, and a plausible success is the defect these tests exist for.
 */
const URL = "http://127.0.0.1:4123/";

async function adapter(options: FakeOptions = {}) {
	const { shim, platform } = await openFake(options);
	return { shim, platform, native: fakeAdapter(platform, shim.symbols) };
}

/** The code a throw carries, or "no-throw" so a failure names what it got. */
function codeOf(run: () => unknown): string {
	try {
		run();
		return "no-throw";
	} catch (error) {
		return error instanceof WindowAdapterError ? error.code : "untyped";
	}
}

describe("create, list, close", () => {
	test("create tracks the label and list answers it", async () => {
		const { native, platform } = await adapter();
		expect(native.create({ label: "main", url: URL })).toEqual({ label: "main" });
		expect(native.list()).toEqual(["main"]);
		expect(platform.nativeWindow("main")?.url).toBe(URL);
	});

	test("create refuses a label a live window still holds", async () => {
		const { native } = await adapter();
		native.create({ label: "main", url: URL });
		expect(codeOf(() => native.create({ label: "main", url: URL }))).toBe("duplicate-label");
	});

	test("a relative url joins the app's own document", async () => {
		const { native, shim } = await adapter();
		native.create({ label: "main", url: URL });
		native.create({ label: "about", url: "/about" });
		expect(shim.urls).toEqual([URL, `${URL}about`]);
	});

	test("an absolute url is handed through unchanged", async () => {
		const { native, shim } = await adapter();
		native.create({ label: "main", url: "https://example.test/page" });
		expect(shim.urls).toEqual(["https://example.test/page"]);
	});

	test("a first window with no url and no document to resolve against is refused", async () => {
		const { native } = await adapter();
		expect(codeOf(() => native.create({ label: "main" }))).toBe("handler-error");
	});

	test("close destroys the window and drops the label", async () => {
		const { native, platform, shim } = await adapter();
		native.create({ label: "main", url: URL });
		native.close("main");
		expect(shim.calls).toContain("window_destroy");
		expect(native.list()).toEqual([]);
		expect(platform.nativeWindow("main")).toBeUndefined();
	});

	test("close on a label GTK no longer holds is unknown-window, not a silent no-op", async () => {
		const { native } = await adapter();
		native.create({ label: "main", url: URL });
		native.close("main");
		// GTK freed the widget, so there is no closed window left to be idempotent about.
		expect(codeOf(() => native.close("main"))).toBe("unknown-window");
	});
});

describe("focus, setTitle, isOpen", () => {
	test("focus presents the GtkWindow the label names", async () => {
		const { native, platform, shim } = await adapter();
		native.create({ label: "main", url: URL });
		native.focus("main");
		expect(shim.calls).toContain("present");
		expect(platform.nativeWindow("main")?.win).toBe(100n);
	});

	test("setTitle applies through the shim and reads its own write back", async () => {
		const { native, shim } = await adapter();
		native.create({ label: "main", url: URL });
		native.setTitle("main", "crust café");
		expect(shim.titles.get(100)).toBe("crust café");
	});

	test("a GTK that accepted the title and ignored it is handler-error", async () => {
		const { native, shim } = await adapter();
		native.create({ label: "main", url: URL });
		shim.ignoring.add("set_title");
		expect(codeOf(() => native.setTitle("main", "later"))).toBe("handler-error");
	});

	test("isOpen answers true for a live label and unknown-window for one it never held", async () => {
		const { native } = await adapter();
		native.create({ label: "main", url: URL });
		expect(native.isOpen("main")).toBe(true);
		expect(codeOf(() => native.isOpen("ghost"))).toBe("unknown-window");
	});
});

describe("capture", () => {
	test("capture photographs the labelled webview and returns the page PNG", async () => {
		const { native, shim, platform } = await adapter();
		native.create({ label: "main", url: URL });
		const web = platform.nativeWindow("main")?.web;
		const shot = await native.capture?.("main");
		expect(shot).toMatchObject({ width: 320, height: 200, scale: 1 });
		expect(typeof shot?.png).toBe("string");
		expect((shot?.png ?? "").length).toBeGreaterThan(0);
		expect(shim.captures).toEqual([Number(web)]);
	});

	test("capture on a label nobody opened is unknown-window", async () => {
		const { native } = await adapter();
		await expect(native.capture?.("ghost")).rejects.toMatchObject({ code: "unknown-window" });
	});
});

describe("an entry point that did not resolve", () => {
	test("focus refuses by name, quoting the symbol GTK did not carry", async () => {
		const { native } = await adapter({ missing: "gtk_window_present" });
		native.create({ label: "main", url: URL });
		expect(codeOf(() => native.focus("main"))).toBe("unknown-adapter");
		expect(() => native.focus("main")).toThrow("gtk_window_present");
		expect(() => native.focus("main")).toThrow("window.focus");
	});

	test("every command that needs the table refuses, and the refusal names its own member", async () => {
		const { native } = await adapter({ missing: "gtk_window_set_title" });
		native.create({ label: "main", url: URL });
		expect(() => native.setTitle("main", "x")).toThrow("window.setTitle");
		expect(() => native.getSize("main")).toThrow("window.getSize");
		expect(() => native.setDecorations("main", false)).toThrow("window.setDecorations");
	});
});
