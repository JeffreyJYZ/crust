/**
 * The fake adapter and event collector the `crust:browser` tests share. Kept out of the test files
 * so the popup group and the command group each read on their own, and so neither file crosses the
 * 200-line cap.
 */
import type {
	BrowserAdapter,
	BrowserBounds,
	BrowserExternalOutcome,
	BrowserOpenInput,
	BrowserState,
} from "./browser-types";

export const ALLOWED = "http://127.0.0.1:4321";
export const BOUNDS: BrowserBounds = { x: 10, y: 20, width: 640, height: 400 };

export class FakeBrowser implements BrowserAdapter {
	opened: BrowserOpenInput[] = [];
	extended: string[] = [];
	state_: Record<string, BrowserState> = {};
	frames: Array<{ label: string; bounds: BrowserBounds }> = [];
	closed: string[] = [];
	externalAnswer: BrowserExternalOutcome = { opened: true };

	open(input: BrowserOpenInput) {
		this.opened.push(input);
		this.state_[input.label] = {
			url: input.url,
			title: "Remote Title",
			loading: false,
			canGoBack: false,
			canGoForward: false,
		};
		return { ok: true as const, label: input.label };
	}
	navigate(label: string, url: string) {
		const state = this.state_[label];
		if (state) state.url = url;
		return { ok: true as const, loaded: true };
	}
	state(label: string) {
		const state = this.state_[label];
		return state === undefined ? null : { ok: true as const, ...state };
	}
	setBounds(label: string, bounds: BrowserBounds) {
		this.frames.push({ label, bounds });
		return { ok: true as const };
	}
	close(label: string) {
		this.closed.push(label);
		delete this.state_[label];
		return { ok: true as const, closed: true as const };
	}
	async capture(label: string) {
		return { ok: true as const, width: 600, height: 420, scale: 2, png: `shot-${label}` };
	}
	external(url: string) {
		this.extended.push(url);
		return this.externalAnswer;
	}
}

/** A `PluginContext` whose `emit` records instead of pushing to a stream. */
export function collector() {
	const events: Array<{ event: string; data: unknown }> = [];
	return {
		events,
		ctx: { emit: (event: string, data: unknown) => events.push({ event, data }) },
	};
}
