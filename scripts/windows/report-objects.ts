/**
 * The object and handler readbacks: what Windows sees when it reads a COM object this layer built.
 * Split from `report.ts` at the line cap, along the seam that file already names — `report.ts` is the
 * sequence and the numbers around a call, and this is the objects a call is made on.
 */
import type { WindowsShim } from "../../src/platform/windows/backend.ts";
import { objectStateName } from "../../src/platform/windows/platform-config.ts";
import { addr, hex } from "./report.ts";

/** The first four 32-bit words of an object, which is enough to recognise ASCII, a small int or a table. */
export function words(shim: WindowsShim, obj: number): string {
	const out = new Uint32Array(4);
	const count = Number(shim.shim_object_bytes(obj, out, 4));
	if (count === 0) return "unreadable";
	return Array.from(out.subarray(0, count), (word) => hex(word)).join(" ");
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

/** The ICoreWebView2 object at one surface, before `Navigate` is called on it. */
export function webReport(shim: WindowsShim, handle: number): void {
	const web = shim.shim_webview_handle(handle);
	console.log(
		`stage     webview read ${addr(web)} ${objectStateName(shim.shim_object_state(web))} ` +
			`first ${addr(shim.shim_webview_vtbl(handle))}`,
	);
	console.log(`stage     webview bytes ${words(shim, web)}`);
	const slots = [3, 4, 5, 6].map(
		(index) => `${index}:${addr(shim.shim_webview_slot(handle, index))}`,
	);
	console.log(
		`stage     webview entries ${slots.join(" ")} bad_slot ${shim.shim_bad_slot()} bad_object ${shim.shim_bad_object()}`,
	);
}
