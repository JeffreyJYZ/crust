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
import { objectStateName } from "../../src/platform/windows/platform-config.ts";

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
 * A pointer as hex, in full. `>>> 0` truncates to 32 bits, which is why a run printed an environment
 * handle of `0x00004410` — the low half of a real pointer — and made a good object look like garbage.
 */
export function addr(value: number): string {
	if (!Number.isFinite(value)) return String(value);
	const text = Math.trunc(Math.abs(value)).toString(16).padStart(8, "0");
	return `${value < 0 ? "-" : ""}0x${text}`;
}

/** The first four 32-bit words of an object, which is enough to recognise ASCII, a small int or a table. */
export function words(shim: WindowsShim, obj: number): string {
	const out = new Uint32Array(4);
	const count = Number(shim.shim_object_bytes(obj, out, 4));
	if (count === 0) return "unreadable";
	return Array.from(out.subarray(0, count), (word) => hex(word)).join(" ");
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
		`stage     handler vtbl ${addr(shim.shim_handler_vtbl_addr())} object ${addr(
			shim.shim_handler_object_addr(),
		)} first ${addr(shim.shim_handler_first_field())}`,
	);
	const entries: string[] = [];
	for (let index = 0; index < 8; index++) entries.push(addr(shim.shim_handler_entry(index)));
	console.log(`stage     handler entries ${entries.join(" ")}`);
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

/**
 * What the two objects actually are, one line each: **stored** is what the callback recorded at the
 * moment of the store, **read** is the field now — a difference means something overwrote it after the
 * store, which is a different fix from "WebView2 handed us a non-object".
 *
 * `first` is the object's own first 8 bytes as the vtable pointer Windows would use; `bytes` prints the
 * first four words, so ASCII, a small integer or a duplicate of the handler table each name themselves.
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
		`stage     controller stored ${addr(shim.shim_handler_created(4))} read ${addr(controller)} ` +
			`addref ${shim.shim_handler_addref(4)} ` +
			`${objectStateName(shim.shim_object_state(controller))} first ${addr(vtbl)}` +
			(flags.length > 0 ? ` ${flags.join(" ")}` : ""),
	);
	console.log(
		`stage     environment stored ${addr(shim.shim_handler_created(2))} read ${addr(environment)} ` +
			`addref ${shim.shim_handler_addref(2)} ` +
			`${objectStateName(shim.shim_object_state(environment))}`,
	);
	console.log(`stage     controller bytes ${words(shim, controller)}`);
	console.log(`stage     environment bytes ${words(shim, environment)}`);
	const slots = [0, 6, 24, 25, 26].map(
		(index) => `${index}:${addr(shim.shim_controller_slot(index))}`,
	);
	console.log(
		`stage     entries ${slots.join(" ")} bad_slot ${shim.shim_bad_slot()} bad_object ${shim.shim_bad_object()}`,
	);
}

/**
 * The same two objects, read again at the end of the run. The controller was VTABLE-UNREADABLE with
 * `0xffffffff` where its vtable belongs; if this line shows a readable object, it was not built yet when
 * the earlier line ran, and the fix is the deferral, not the call.
 */
export function lateReport(shim: WindowsShim): void {
	const controller = shim.shim_controller_addr();
	const environment = shim.shim_environment_addr();
	console.log(
		`stage     controller late ${addr(controller)} first ${addr(shim.shim_controller_vtbl())} ` +
			`${objectStateName(shim.shim_object_state(controller))} bytes ${words(shim, controller)}`,
	);
	console.log(
		`stage     environment late ${addr(environment)} ` +
			`${objectStateName(shim.shim_object_state(environment))} bytes ${words(shim, environment)}`,
	);
	console.log(
		`stage     ctrl_from ${shim.shim_ctrl_from()} ctrl_inline ${shim.shim_ctrl_inline()}` +
			" (1 = the controller callback ran inside CreateCoreWebView2Controller)",
	);
}

/** The ICoreWebView2 object, before `Navigate` is called on it. */
export function webReport(shim: WindowsShim): void {
	const web = shim.shim_webview_handle();
	console.log(
		`stage     webview read ${addr(web)} ${objectStateName(shim.shim_object_state(web))} ` +
			`first ${addr(shim.shim_webview_vtbl())}`,
	);
	console.log(`stage     webview bytes ${words(shim, web)}`);
	const slots = [3, 4, 5, 6].map((index) => `${index}:${addr(shim.shim_webview_slot(index))}`);
	console.log(
		`stage     webview entries ${slots.join(" ")} bad_slot ${shim.shim_bad_slot()} bad_object ${shim.shim_bad_object()}`,
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

/** One line that says why the rest of the run is missing, so an absence is never silent. */
export function skipped(reason: string): void {
	console.log(`stage     skipped: ${reason}`);
}
