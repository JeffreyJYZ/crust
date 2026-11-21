/**
 * The native half of `crust:tray` on Linux: a `GtkStatusIcon` and its `GtkMenu`, in `81_tray.c`.
 *
 * **`setTitle` refuses by name.** A `GtkStatusIcon` is an icon and a tooltip; GTK has no text label
 * beside a status icon, and `gtk_status_icon_set_tooltip_text` is the member that does carry text.
 * Applying the title to the tooltip and answering `{ ok: true, text }` would claim a label nobody can
 * see, so it throws and the plugin turns that into a typed failure.
 *
 * **Clicks arrive by poll.** GTK's `activate` signal records the row; `pollClick()` reads it. The
 * plugin's own wiring is what turns it into `tray:click`, and the GTK main context the window shim
 * already iterates is what delivers the signal — no second loop, and no callback crossing bun:ffi.
 *
 * UNPROVEN ON LINUX, like the C unit behind it: the tests drive `notify-tray-fake.ts`.
 */
import { TrayAdapterError, type TrayMenuItem, type TrayNative } from "@/plugins/tray";
import { cstring } from "./cstring.ts";
import { type LinuxNotifyTrayShim, notifyTrayShim } from "./notify-tray-ffi.ts";

/** `SHIM_TRAY_MAX` in `81_tray.c`: rows past this are refused, never silently dropped. */
export const TRAY_MAX_ITEMS = 12;

/** The adapter plus the pump-facing half the plugin contract has no member for. */
export interface LinuxTrayAdapter extends TrayNative {
	/** The row clicked since the last call, or -1. Fires its `onClick` and the plugin's event. */
	pollClick(): number;
}

export interface LinuxTrayOptions {
	/** The unit to call; defaults to compiling the shipped one on first use. */
	shim?: () => LinuxNotifyTrayShim | undefined;
}

export function linuxTrayAdapter(options: LinuxTrayOptions = {}): LinuxTrayAdapter {
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
	const require = (command: string): LinuxNotifyTrayShim => {
		const shim = shimOf();
		if (shim === undefined) {
			throw new TrayAdapterError(
				"handler-error",
				`crust: tray.${command} needs the notification C unit, which could not be compiled`,
			);
		}
		return shim;
	};

	/** A 0 from C is a refusal: the library or symbol it recorded is the whole message. */
	const applied = (shim: LinuxNotifyTrayShim, ok: number, command: string): void => {
		if (ok === 1) return;
		const missing = String(shim.shim_notify_missing() ?? "");
		const said = String(shim.shim_notify_reason() ?? "");
		const why = missing.length > 0 ? `${missing} did not resolve` : said || "GTK refused";
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
				`crust: tray.setTitle cannot apply ${JSON.stringify(text)} — a GtkStatusIcon has no ` +
					"text label; call tray.setTooltip for the text it can show",
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
					`crust: tray.setMenu accepts at most ${TRAY_MAX_ITEMS} rows on Linux, got ${next.length}`,
				);
			}
			// Rows travel to C separated by `\n`. A label containing one would split into two
			// native rows, so a click would index the wrong item or no item at all.
			const bad = next.findIndex((item) => item.label.includes("\n"));
			if (bad >= 0) {
				throw new TrayAdapterError(
					"invalid-menu",
					`crust: tray.setMenu item ${bad} contains a newline; the Linux menu transport ` +
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
		 * menu was replaced between the click and the poll, and a stale index would fire the wrong row.
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
