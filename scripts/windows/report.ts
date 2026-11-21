/**
 * The diagnostic lines the Windows probe prints — slots, handler layout, threads, affinity, and what the
 * two objects actually are. Split out of `stages.ts` so that file is the *sequence* and this one is the
 * *numbers*: the sequence keeps growing and the line cap does not.
 *
 * Everything here is printed *before* the call it describes, because the point is that the next run
 * names the call that died — or, as the last run showed, that the object it was about to be called on
 * is not a COM object at all.
 */
import { join } from "node:path";
import type { WindowsShim } from "../../src/platform/windows/backend.ts";

/**
 * An HRESULT as hex. `bun:ffi` returns an `i64` as a **bigint** and `>>>` is not defined on one, so both
 * shapes are handled here instead of at every call site.
 */
export function hex(value: number | bigint): string {
	if (typeof value === "bigint") {
		const pattern = BigInt.asUintN(64, value);
		return `0x${pattern.toString(16).padStart(pattern > 0xffffffffn ? 16 : 8, "0")}`;
	}
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The slot index each call uses, read out of the prelude beside the method it belongs to — so a wrong
 * index is a printed number next to its method name rather than something inferred from a crash.
 */
export async function slotReport(): Promise<void> {
	const path = join(import.meta.dir, "../../src/platform/windows/shim/10_prelude.c");
	const text = await Bun.file(path).text();
	const found = [...text.matchAll(/#define (SHIM_SLOT_\w+) (\d+)/g)];
	console.log(`stage     slots ${found.map((match) => `${match[1]}=${match[2]}`).join(" ")}`);
}

/**
 * A pointer as hex, in full. `>>> 0` truncates to 32 bits, which is why a run printed an environment
 * handle of `0x00004410` — the low half of a real pointer — and made a good object look like garbage.
 */
export function addr(value: number): string {
	if (!Number.isFinite(value)) return String(value);
	const text = Math.trunc(Math.abs(value)).toString(16).padStart(8, "0");
	return `${value < 0 ? "-" : ""}0x${text}`;
}

/** Which thread each step ran on. `UI_E_WRONG_THREAD` is exactly what a mismatch here looks like. */
export function threadReport(shim: WindowsShim): void {
	const names = ["com", "env_call", "env_callback", "ctrl_call", "ctrl_callback"];
	const seen = names.map((name, index) => `${name} ${shim.shim_thread_at(index)}`);
	console.log(`stage     threads ${seen.join(" ")} now ${shim.shim_thread_id()}`);
}

/**
 * Affinity: the thread that owns the window, the thread the controller call ran on, and the apartment.
 * Printed *before* the controller call, because that is the stage that has been killing the child.
 *
 * `apartment` is 0 STA, 1 MTA, 2 neutral, 3 main STA, -1 when the call failed — and `1` is MTA. The
 * qualifier is printed beside it because the out-param is not optional: a NULL qualifier answered
 * `E_INVALIDARG` (0x80070057) for two runs and read as "not initialised".
 */
export function affinityReport(shim: WindowsShim, hwnd: number): void {
	console.log(
		`stage     window_thread ${shim.shim_window_thread(hwnd)} controller_thread ${shim.shim_thread_at(3)}`,
	);
	console.log(
		`stage     apartment type ${shim.shim_apartment_type()} qualifier ${shim.shim_apartment_qualifier()}` +
			` hresult ${hex(shim.shim_apartment_hresult())} bound ${shim.shim_apartment_bound()}`,
	);
}

/** Print the call about to be made, then its answer. A crash leaves the first half as the last line. */
export function stage(name: string, call: () => number): number {
	console.log(`stage     ${name} …`);
	const value = Number(call());
	console.log(`stage     ${name} ok ${value}`);
	return value;
}

/**
 * An HRESULT stage. Printed raw *and* as hex, because a reader has to be able to decode it, and scored
 * by the sign of its low 32 bits: `0x802A000C` arrives zero-extended as `2150236172`, which a plain
 * `< 0` reads as a pass — that is how a failing `controller_begin` was once counted as a success.
 */
export function stageHr(name: string, call: () => number): boolean {
	console.log(`stage     ${name} …`);
	const value = Number(call());
	console.log(`stage     ${name} ok ${value} (${hex(value)})`);
	return (value | 0) < 0;
}

/** What this smoke does not prove, printed once at the end so an absence is never silent. */
export const NOT_PROVEN =
	"not proven here: a loaded document, page JS, invoke — the window loads about:blank.";

/** One line that says why the rest of the run is missing, so an absence is never silent. */
export function skipped(reason: string): void {
	console.log(`stage     skipped: ${reason}`);
}
