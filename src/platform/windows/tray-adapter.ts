/**
 * The native half of `crust:tray` on Windows: a notification-area icon with a popup menu.
 *
 * **`setTitle` refuses by name.** A Windows notification-area icon is an icon and a tooltip; Windows
 * 11 has no text label beside one, and `NOTIFYICONDATAW` carries no title field. Applying the text
 * somewhere else (the tooltip) and answering `{ ok: true, text }` would claim a label nobody can see,
 * so it throws and the plugin turns that into a typed failure. `setTooltip` is the member that does
 * carry text, and it is the honest one to reach for.
 *
 * **Clicks arrive by poll, not by callback.** The hidden window records the row the human chose, and
 * `pollClick()` reads it — a Win32 message is not a JavaScript call, and firing a `JSCallback` from
 * inside the pump would need a callback whose prototype matches `WNDPROC` exactly. The registry line
 * that wires this adapter therefore owes one extra call in the pump; until it lands, a menu click is
 * recorded and never relayed.
 *
 * UNPROVEN ON WINDOWS, like the C unit behind it: the tests drive `notify-tray-fake.ts`.
 */
import { TrayAdapterError, type TrayMenuItem, type TrayNative } from "@/plugins/tray";
import { cstring } from "./cstring.ts";
import { type WindowsNotifyTrayShim, notifyTrayShim } from "./notify-tray-ffi.ts";

/** `SHIM_TRAY_MAX` in `61_tray.c`: rows past this are refused, never silently dropped. */
export const TRAY_MAX_ITEMS = 12;

/** The adapter plus the pump-facing half the plugin contract has no member for. */
export interface WindowsTrayAdapter extends TrayNative {
	/** The row clicked since the last call, or -1. Fires its `onClick` and the plugin's event. */
	pollClick(): number;
}

export interface WindowsTrayOptions {
	/** The unit to call; defaults to compiling the shipped one on first use. */
	shim?: () => WindowsNotifyTrayShim | undefined;
}

export function windowsTrayAdapter(options: WindowsTrayOptions = {}): WindowsTrayAdapter {
	const shimOf =
		options.shim ??
		(() => {
			try {
				return notifyTrayShim();
			} catch {
				return undefined;
			}
		});

	/** The unit, or the refusal that names what is missing. */
	const require = (command: string): WindowsNotifyTrayShim => {
		const shim = shimOf();
		if (shim === undefined) {
			throw new TrayAdapterError(
				"handler-error",
				`crust: tray.${command} needs the notification C unit, which could not be compiled`,
			);
		}
		return shim;
	};

	/** A 0 from C is a refusal: the reason it recorded is the whole message. */
	const applied = (shim: WindowsNotifyTrayShim, ok: number, command: string): void => {
		if (ok === 1) return;
		const said = String(shim.shim_notify_reason() ?? "");
		const missing = String(shim.shim_notify_missing() ?? "");
		const why = missing.length > 0 ? `${missing} did not resolve` : said || "the shell refused";
		throw new TrayAdapterError(
			"handler-error",
			`crust: tray.${command} was not applied — ${why}`,
		);
	};

	let items: readonly TrayMenuItem[] = [];

	return {
		setTitle(text: string): void {
			throw new TrayAdapterError(
				"handler-error",
				`crust: tray.setTitle cannot apply ${JSON.stringify(text)} — a Windows notification-area ` +
					"icon has no text label; call tray.setTooltip for the text it can show",
			);
		},

		setTooltip(text: string): void {
			const shim = require("setTooltip");
			applied(shim, Number(shim.shim_tray_tooltip(cstring(text)) ?? 0), "setTooltip");
		},

		setMenu(next: readonly TrayMenuItem[]): void {
			const shim = require("setMenu");
			if (next.length > TRAY_MAX_ITEMS) {
				throw new TrayAdapterError(
					"invalid-menu",
					`crust: tray.setMenu accepts at most ${TRAY_MAX_ITEMS} rows on Windows, got ${next.length}`,
				);
			}
			// Rows travel to C separated by `\n`, and the C half splits on every one of them
			// while ignoring the row count. A newline inside a label makes extra native rows,
			// so every real row after it answers an index one too high and fires the next
			// item's handler. Linux already refuses this; Windows carried the same transport
			// without the guard.
			const bad = next.findIndex((item) => item.label.includes("\n"));
			if (bad >= 0) {
				throw new TrayAdapterError(
					"invalid-menu",
					`crust: tray.setMenu item ${bad} contains a newline; the Windows menu transport ` +
						"uses \\n to separate rows and cannot carry one inside a label",
				);
			}
			const joined = next.map((item) => item.label).join("\n");
			applied(
				shim,
				Number(shim.shim_tray_menu(cstring(joined), next.length) ?? 0),
				"setMenu",
			);
			items = next;
		},

		show(): void {
			const shim = require("show");
			applied(shim, Number(shim.shim_tray_show() ?? 0), "show");
		},

		hide(): void {
			const shim = require("hide");
			applied(shim, Number(shim.shim_tray_hide() ?? 0), "hide");
		},

		destroy(): void {
			const shim = require("destroy");
			applied(shim, Number(shim.shim_tray_destroy() ?? 0), "destroy");
			items = [];
		},

		/**
		 * One recorded click, handed to the plugin's own wiring. An index with no row is dropped: the
		 * C and the menu were replaced between the click and the poll, and a stale index would fire
		 * the wrong handler.
		 */
		pollClick(): number {
			const shim = shimOf();
			if (shim === undefined) return -1;
			const index = Number(shim.shim_tray_click() ?? -1);
			const row = index >= 0 ? items[index] : undefined;
			if (row === undefined) return -1;
			try {
				row.onClick?.();
			} catch {
				// A page handler must not turn one click into a broken pump slice.
			}
			return index;
		},
	};
}
