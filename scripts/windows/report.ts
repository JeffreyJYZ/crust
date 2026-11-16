/**
 * The diagnostic lines the Windows probe prints — slots, handler layout, threads, affinity, and the two
 * objects a vtable call is made on. Split out of `stages.ts` so that file is the *sequence* and this one
 * is the *numbers*: the sequence keeps growing and the line cap does not.
 *
 * Everything here is printed *before* the call it describes, because the point is that the next run
 * names the call that died.
 */
import { join } from "node:path";
import type { WindowsShim } from "../../src/platform/windows/backend.ts";

/**
 * A pointer or an HRESULT as hex, because both are read as bit patterns.
 *
 * `bun:ffi` returns an `i64` as a **bigint**, and `>>>` is not defined on one: the probe died with
 * "BigInt does not support >>> operator" exactly where it was about to print the apartment HRESULT,
 * which is the line that would have named the next defect (measured 2026-11-16). Pointers arrive as
 * numbers, HRESULTs from an `i64` export as bigints, so both are handled here instead of at every
 * call site — a probe that cannot format a number is worse than no probe.
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

/** The handler object as Windows reads it, and the last slot a call refused. */
export function handlerReport(shim: WindowsShim): void {
	console.log(`stage     handler_prepare ok ${shim.shim_handler_prepare()}`);
	console.log(
		`stage     handler vtbl ${hex(shim.shim_handler_vtbl_addr())} object ${hex(
			shim.shim_handler_object_addr(),
		)} first ${hex(shim.shim_handler_first_field())}`,
	);
	const entries: string[] = [];
	for (let index = 0; index < 8; index++) entries.push(hex(shim.shim_handler_entry(index)));
	console.log(`stage     handler entries ${entries.join(" ")}`);
}

/** Which thread each step ran on. `UI_E_WRONG_THREAD` is exactly what a mismatch here looks like. */
export function threadReport(shim: WindowsShim): void {
	const names = ["com", "env_call", "env_callback", "ctrl_call", "ctrl_callback"];
	const seen = names.map((name, index) => `${name} ${shim.shim_thread_at(index)}`);
	console.log(`stage     threads ${seen.join(" ")} now ${shim.shim_thread_id()}`);
}

/**
 * Affinity, as numbers: the thread that owns the window, the thread the controller call ran on, and the
 * apartment this thread is in. Printed *before* the controller call, because that is the stage that has
 * been killing the child.
 *
 * `apartment` is 0 STA, 1 MTA, 2 neutral, 3 main STA, -1 when the call failed — and `1` is MTA, so a
 * reader who takes it for STA inverts the verdict. `bound 0` means the symbol never resolved, which is
 * a different answer from `hresult 0x800401f0` (CO_E_NOTINITIALIZED).
 */
export function affinityReport(shim: WindowsShim, hwnd: number): void {
	console.log(
		`stage     window_thread ${shim.shim_window_thread(hwnd)} controller_thread ${shim.shim_thread_at(3)}`,
	);
	console.log(
		`stage     apartment ${shim.shim_apartment_type()} hresult ${hex(
			shim.shim_apartment_hresult(),
		)} bound ${shim.shim_apartment_bound()}`,
	);
}

/**
 * The controller object, before any method is called on it. A jump to `0xffffffffffffffff` is a vtable
 * read past its end or an object that is not the one it claims, and both are visible here: the
 * controller's vtable must not be the handler table, the controller must not be the environment, and
 * `25` must be a code address with `26` past the end of the list.
 */
export function objectReport(shim: WindowsShim): void {
	const controller = shim.shim_controller_addr();
	const environment = shim.shim_environment_addr();
	const vtbl = shim.shim_controller_vtbl();
	const handler = shim.shim_handler_vtbl_addr();
	const flags: string[] = [];
	if (controller !== 0 && controller === environment) flags.push("SAME-AS-ENVIRONMENT");
	if (vtbl !== 0 && vtbl === handler) flags.push("HANDLER-OBJECT");
	console.log(
		`stage     objects controller ${hex(controller)} environment ${hex(environment)}` +
			(flags.length > 0 ? ` ${flags.join(" ")}` : ""),
	);
	console.log(`stage     vtable controller ${hex(vtbl)} handler ${hex(handler)}`);
	const slots = [0, 6, 24, 25, 26].map(
		(index) => `${index}:${hex(shim.shim_controller_slot(index))}`,
	);
	console.log(`stage     entries ${slots.join(" ")} bad_slot ${shim.shim_bad_slot()}`);
}

/** The ICoreWebView2 object, before `Navigate` is called on it. */
export function webReport(shim: WindowsShim): void {
	console.log(
		`stage     webview ${hex(shim.shim_webview_handle())} vtable ${hex(
			shim.shim_webview_vtbl(),
		)}`,
	);
	const slots = [3, 4, 5, 6].map((index) => `${index}:${hex(shim.shim_webview_slot(index))}`);
	console.log(`stage     webview entries ${slots.join(" ")} bad_slot ${shim.shim_bad_slot()}`);
}
