/**
 * The recording ports the Linux browser adapter's tests share. Kept out of the test file so that file
 * stays under the cap and reads as the assertions rather than as the fixture.
 */
import type { BrowserBounds, BrowserState } from "@/plugins/browser";
import type { LinuxBrowserPorts } from "./browser-ports";

export const STATE: BrowserState = {
	url: "http://127.0.0.1:4321/",
	title: "Remote Title",
	loading: false,
	canGoBack: false,
	canGoForward: false,
};

export class FakePorts implements LinuxBrowserPorts {
	calls: string[] = [];
	signalsRefused = false;

	shim(): never {
		throw new Error("a fake never hands out a real symbol table");
	}
	owner(label?: string) {
		return label === "missing"
			? undefined
			: { label: label ?? "main", win: 0x200n, box: 0x250n };
	}
	windowOpen(label: string): boolean {
		return label === "main";
	}
	newView() {
		this.calls.push("new");
		return 0x400n;
	}
	place(box: bigint, web: bigint, bounds: BrowserBounds) {
		this.calls.push(
			`place:${box.toString(16)}:${web.toString(16)}:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`,
		);
		return true;
	}
	load(web: bigint, url: string) {
		this.calls.push(`load:${web.toString(16)}:${url}`);
		return !url.includes("refuse");
	}
	watch(web: bigint) {
		this.calls.push(`watch:${web.toString(16)}`);
		return !this.signalsRefused;
	}
	denyCapture(web: bigint) {
		this.calls.push(`deny:${web.toString(16)}`);
		return true;
	}
	watchNav(web: bigint) {
		this.calls.push(`watch_nav:${web.toString(16)}`);
		return !this.signalsRefused;
	}
	navigate(web: bigint, url: string) {
		this.calls.push(`navigate:${web.toString(16)}:${url}`);
		return true;
	}
	state() {
		return STATE;
	}
	close(web: bigint) {
		this.calls.push(`close:${web.toString(16)}`);
	}
	sink(pointer: number) {
		this.calls.push(`sink:${pointer > 0 ? "set" : "unset"}`);
	}
	decisionSink(pointer: number) {
		this.calls.push(`decision_sink:${pointer > 0 ? "set" : "unset"}`);
	}
	popupUrl() {
		return "http://127.0.0.1:4321/popup";
	}
	opener(url: string) {
		return { status: url.includes("bad") ? 2 : 0, reason: "gio refused" };
	}
}
