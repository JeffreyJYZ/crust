/**
 * The recording ports the Windows browser adapter's tests share. Kept out of the test file so that file
 * stays under the cap and reads as the assertions rather than as the fixture.
 */
import type { BrowserBounds, BrowserState } from "@/plugins/browser";
import type { WindowsBrowserPorts } from "./browser-ports";

export const STATE: BrowserState = {
	url: "http://127.0.0.1:4321/",
	title: "Remote Title",
	loading: false,
	canGoBack: false,
	canGoForward: false,
};

/** Every native call, recorded in order so the adapter's sequence is the assertion. */
export class FakePorts implements WindowsBrowserPorts {
	calls: string[] = [];
	handle = 1;
	watchRefused = false;
	popupRefused = false;

	shim(): never {
		throw new Error("a fake never hands out a real symbol table");
	}
	owner(label?: string) {
		return label === "missing" ? undefined : { label: label ?? "main", hwnd: 0x200 };
	}
	windowOpen(label: string): boolean {
		return label === "main";
	}
	child(parent: number, bounds: BrowserBounds) {
		this.calls.push(
			`child:${parent.toString(16)}:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`,
		);
		return 0x300;
	}
	move(child: number, bounds: BrowserBounds) {
		this.calls.push(
			`move:${child.toString(16)}:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`,
		);
		return 1;
	}
	surface(child: number, url: string) {
		this.calls.push(`surface:${child.toString(16)}:${url}`);
		return url.includes("refuse") ? -1 : this.handle;
	}
	navigate(handle: number, url: string) {
		this.calls.push(`navigate:${handle}:${url}`);
		return !url.includes("refuse");
	}
	webPointer(handle: number) {
		return 0x900 + handle;
	}
	watch(handle: number) {
		this.calls.push(`watch:${handle}`);
		return !this.watchRefused;
	}
	refusePopups(handle: number) {
		this.calls.push(`popups:${handle}`);
		return !this.popupRefused;
	}
	state() {
		return STATE;
	}
	opener(url: string) {
		return {
			status: url.includes("bad") ? 2 : 0,
			reason: "ShellExecuteW refused",
		};
	}
	sink(pointer: number) {
		this.calls.push(`sink:${pointer > 0 ? "set" : "unset"}`);
	}
	popupUrl() {
		return "http://127.0.0.1:4321/popup";
	}
	release(child: number) {
		this.calls.push(`release:${child.toString(16)}`);
	}
}
