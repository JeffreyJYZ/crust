/**
 * The platform calls faked for the darwin browser adapter tests: a native object that records every
 * call, plus the ports that drive it. No C, no WebKit, no window — the adapter's wiring is what is
 * measured, while the real unit and surface belong to `browser-unit.test.ts` and e2e-browser.
 */
import type { BrowserBounds, BrowserState } from "@/plugins/browser";
import type { BrowserPorts } from "./browser-ports";
import type { BrowserNative } from "./browser-unit";
import { fakeNavigation } from "./webview-target-fixture.ts";

/** Every native export, recording the calls the adapter makes. */
export class FakeNative implements BrowserNative {
	calls: string[] = [];
	uiStatus = 0;
	attachStatus = 1;
	popup = "";
	sink = 0;

	shim_browser_view_new(): number {
		this.calls.push("view_new");
		return 0x100;
	}
	shim_browser_view_set_frame(view: number, x: number, y: number, width: number, height: number) {
		this.calls.push(`frame:${view.toString(16)}:${x},${y},${width},${height}`);
	}
	shim_browser_attach(parent: number, view: number): number {
		this.calls.push(`attach:${parent.toString(16)}:${view.toString(16)}`);
		return this.attachStatus;
	}
	shim_browser_detach(view: number): void {
		this.calls.push(`detach:${view.toString(16)}`);
	}
	shim_browser_view_release(view: number): void {
		this.calls.push(`view-release:${view.toString(16)}`);
	}
	shim_browser_ui_uninstall(web: number): void {
		this.calls.push(`ui-uninstall:${web.toString(16)}`);
	}
	shim_browser_ui_install(web: number): number {
		this.calls.push(`ui:${web.toString(16)}`);
		return this.uiStatus;
	}
	shim_browser_ui_installed(): number {
		return 1;
	}
	shim_browser_set_sink(sink: number): void {
		this.sink = sink;
	}
	shim_browser_popups(): number {
		return 0;
	}
	shim_browser_popup_url(): number {
		return this.popup.length;
	}
	shim_browser_capture_decision(): number {
		return 2;
	}
}

export const state: BrowserState = {
	url: "http://127.0.0.1:4321/",
	title: "Remote Title",
	loading: false,
	canGoBack: false,
	canGoForward: false,
};

export function ports(native: FakeNative): BrowserPorts {
	return {
		native,
		owner: (label) =>
			label === "missing" ? undefined : { label: label ?? "main", win: 0x200 },
		windowOpen: (label) => label === "main",
		contentView: () => 0x300,
		newWebview: () => 0x400,
		addWebview: (host, web) =>
			native.calls.push(`web:${host.toString(16)}:${web.toString(16)}`),
		removeWebview: (web) => native.calls.push(`unweb:${web.toString(16)}`),
		releaseView: (view) => native.shim_browser_view_release(view),
		load: (_web, url) => (url.includes("refuse") ? 0 : 1),
		navNative: () => fakeNavigation().symbols,
		navInstall: () => 0,
		navUninstall: (web) => native.calls.push(`nav-uninstall:${web.toString(16)}`),
		navState: () => state,
		opener: (url) => ({ status: url.includes("bad") ? 2 : 0, reason: "NSWorkspace refused" }),
		snapshot: async () => ({ width: 600, height: 420, scale: 2, png: "cG5n" }),
	};
}

export const bounds: BrowserBounds = { x: 10, y: 20, width: 640, height: 400 };
