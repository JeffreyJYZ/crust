/**
 * The types behind `crust:power`, split out so the plugin stays a thin command map. The pull half
 * (battery, idle, assertion) is unchanged; the push half adds the six OS notifications a page can
 * subscribe to. A platform with no such notification omits the adapter method, and the plugin answers
 * `not-implemented` rather than installing a listener that would never fire.
 */

/** What the machine reports right now. */
export interface PowerState {
	onAc: boolean;
	/** 0–100, or null when the machine has no battery (a desktop is on wall power). */
	batteryPercent: number | null;
	lowPowerMode: boolean;
	/** False when the native read never reached the OS; the fields above are then placeholders. */
	available?: boolean;
	/** Why the read failed, present when `available` is false. */
	reason?: string;
}

/** A refused native read, so a fabricated reading never reaches a page as `ok: true`. */
export interface PowerReadFailure {
	available: false;
	reason: string;
}

/** One assertion attempt: the id it holds, or the step that refused it. */
export interface SleepAssertion {
	ok: boolean;
	id: number;
	reason: string;
}

/** One release attempt: `released` is false when nothing was held, which is not a failure. */
export interface SleepRelease {
	ok: boolean;
	released: boolean;
	reason: string;
}

/** The native half of `crust:power`; `platform/darwin/power.ts` implements it. */
export interface PowerAdapter {
	state(): PowerState | Promise<PowerState>;
	/** Seconds, or a refusal when the native clock read never reached the OS. */
	idleSeconds(): number | PowerReadFailure | Promise<number | PowerReadFailure>;
	preventSleep(reason: string): SleepAssertion | Promise<SleepAssertion>;
	allowSleep(): SleepRelease | Promise<SleepRelease>;
	/**
	 * Register a native observer and call `listener` whenever the OS reports the event. Returns
	 * false when the notification is unavailable. Absent on a platform with no such notification,
	 * which is what makes the plugin answer `not-implemented` instead of faking a listener.
	 */
	onSleep?(listener: () => void): boolean | Promise<boolean>;
	onLock?(listener: () => void): boolean | Promise<boolean>;
	onWake?(listener: () => void): boolean | Promise<boolean>;
	onScreenSleep?(listener: () => void): boolean | Promise<boolean>;
	onScreenWake?(listener: () => void): boolean | Promise<boolean>;
	onUnlock?(listener: () => void): boolean | Promise<boolean>;
}

export interface SleepPreventArgs {
	/** Why sleep is being held off; IOKit shows it in `pmset -g assertions`. */
	reason: string;
}

export interface PowerStateResult extends PowerState {
	ok: true;
}

export interface IdleResult {
	ok: true;
	/** Seconds since the last input event in the combined session, fractional. */
	seconds: number;
}

export interface SleepPreventResult {
	ok: true;
	/** The assertion id, for a caller that wants to prove which one it holds. */
	id: number;
}

export interface SleepAllowResult {
	ok: true;
	released: boolean;
}

/** A refusal that is not a missing platform: the OS said no. */
export interface PowerFailure {
	ok: false;
	code: "handler-error";
	message: string;
}

/** The push events, keyed by the name a page listens for. Butter's six, in the same order. */
export const POWER_EVENTS = {
	sleep: "power:sleep",
	lock: "power:lock",
	wake: "power:wake",
	screensleep: "power:screensleep",
	screenwake: "power:screenwake",
	unlock: "power:unlock",
} as const;

export type PowerEventKind = keyof typeof POWER_EVENTS;
export type PowerEventName = (typeof POWER_EVENTS)[PowerEventKind];

/** The payload carried with each event; stable so a page can switch on it. */
export interface PowerEventPayload {
	kind: PowerEventKind;
}

/** The six subscribe commands; each names the adapter method and the event it arms. */
export type PowerSubscribeCommand =
	"onSleep" | "onLock" | "onWake" | "onScreenSleep" | "onScreenWake" | "onUnlock";

/** What a successful subscribe command answers, so the page knows which event was armed. */
export interface PowerSubscribeResult {
	ok: true;
	event: PowerEventName;
}
