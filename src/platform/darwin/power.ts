/**
 * The macOS power half behind `crust:power`: battery state, idle time and a sleep assertion. The C
 * boundary is `power-ffi.ts`; this file is the adapter the plugin takes structurally.
 * Two rules it enforces: every value crosses as a number (no object, no struct), and an assertion id
 * lives in the C unit's static storage so a release can always find it. The adapter also releases on
 * process exit, because an assertion outliving its process is the one failure this feature must not
 * have — the OS drops it with the process, but an explicit release is the proof.
 */

import { bytesOf, powerUnit, stateOut, type PowerUnit } from "./power-ffi.ts";

export {
	bytesOf,
	POWER_SYMBOL_NAMES,
	powerSource,
	powerUnit,
	powerUnitStatus,
} from "./power-ffi.ts";
export type { PowerUnit } from "./power-ffi.ts";

/** What the machine reports right now. */
export interface PowerState {
	onAc: boolean;
	/** 0–100, or null when the machine has no battery (a desktop is on wall power). */
	batteryPercent: number | null;
	lowPowerMode: boolean;
	/** False when the native read never reached the OS; the fields above are placeholders. */
	available?: boolean;
	/** Why the read failed, present when `available` is false. */
	reason?: string;
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

/** The native half as this module hands it out; `crust:power` takes it structurally. */
export interface DarwinPowerAdapter {
	state(): PowerState;
	idleSeconds(): number | { available: false; reason: string };
	preventSleep(reason: string): SleepAssertion;
	allowSleep(): SleepRelease;
}

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** The unit, or the reason it could not be compiled — a compile failure is a refusal, not a throw. */
function compiled(): PowerUnit | string {
	try {
		return powerUnit();
	} catch (error) {
		return `the power C unit did not compile: ${message(error)}`;
	}
}

/** The C unit's own reason, so a refusal names the step instead of a status number. */
function reasonOf(unit: PowerUnit, fallback: string): string {
	const reason = String(unit.symbols.crust_power_reason() ?? "");
	return reason.length > 0 ? reason : fallback;
}

/** A desktop answers no battery, and that reads as wall power with no percentage. */
function readState(unit: PowerUnit): PowerState {
	const out = stateOut();
	const answered = Number(unit.symbols.crust_power_state(out.address) ?? 0);
	const [onAc, percent, lowPower] = Array.from(out.values);
	return {
		onAc: answered === 1 && onAc === 1,
		batteryPercent:
			Number.isFinite(percent) && (percent as number) >= 0
				? Math.round(percent as number)
				: null,
		lowPowerMode: lowPower === 1,
	};
}

/** Registered only once an assertion exists, so a process that never asserts carries no handler. */
let exitHooked = false;

function releaseOnExit(): void {
	if (exitHooked) return;
	exitHooked = true;
	process.on("exit", () => {
		try {
			powerUnit().symbols.crust_power_allow_sleep();
		} catch {
			// An exit handler cannot report anything; the OS drops the assertion with the process.
		}
	});
}

/**
 * The native half of `crust:power`. `preventSleep` answers the assertion id it holds, and
 * `allowSleep` releases it — 0 when nothing was held, which the plugin reports as `released: false`
 * rather than an error.
 */
export function darwinPowerAdapter(): DarwinPowerAdapter {
	return {
		state: () => {
			const unit = compiled();
			if (typeof unit === "string") {
				// Fabricated readings are worse than a refusal: a machine on wall power would be
				// reported as running on battery, and a caller has no way to tell the two apart.
				return {
					onAc: false,
					batteryPercent: null,
					lowPowerMode: false,
					available: false,
					reason: unit,
				};
			}
			return readState(unit);
		},
		idleSeconds: () => {
			const unit = compiled();
			if (typeof unit === "string") return { available: false, reason: unit };
			const seconds = Number(unit.symbols.crust_power_idle_seconds() ?? 0);
			return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
		},
		preventSleep: (reason) => {
			const unit = compiled();
			if (typeof unit === "string") return { ok: false, id: 0, reason: unit };
			const { address, length } = bytesOf(reason);
			const id = Number(unit.symbols.crust_power_prevent_sleep(address, length) ?? -1);
			if (id <= 0) return { ok: false, id: 0, reason: reasonOf(unit, "no id came back") };
			releaseOnExit();
			return { ok: true, id, reason: reasonOf(unit, "assertion held") };
		},
		allowSleep: () => {
			const unit = compiled();
			if (typeof unit === "string") return { ok: false, released: false, reason: unit };
			const answer = Number(unit.symbols.crust_power_allow_sleep() ?? -1);
			return {
				ok: answer >= 0,
				released: answer === 1,
				reason: reasonOf(unit, answer === 0 ? "no assertion is held" : "release refused"),
			};
		},
	};
}

/** The id the C unit holds, for a probe that wants proof nothing leaked. */
export function heldAssertion(): number {
	return Number(powerUnit().symbols.crust_power_held() ?? 0);
}
