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
	/** The decision each surface carries, keyed by label; what a platform would install on commit. */
	decisions = new Map<string, (url: string) => boolean>();
	/** Every URL a navigation tried to commit, allowed or refused, in order. */
	attempts: Array<{ label: string; url: string; allowed: boolean }> = [];

	open(input: BrowserOpenInput) {
		this.opened.push(input);
		if (input.onNavigate) this.decisions.set(input.label, input.onNavigate);
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

	/**
	 * What a platform delegate does with a navigation or a redirect hop: ask the surface's decision,
	 * commit only when it allows, and leave the reported URL where it stopped. Returns the URL that
	 * actually committed (the last allowed one), so a test can prove a chain stopped at the foreign hop.
	 */
	commit(label: string, url: string): string | undefined {
		const decide = this.decisions.get(label);
		const allowed = decide === undefined ? false : decide(url);
		this.attempts.push({ label, url, allowed });
		if (!allowed) return undefined;
		const state = this.state_[label];
		if (state) state.url = url;
		return url;
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
