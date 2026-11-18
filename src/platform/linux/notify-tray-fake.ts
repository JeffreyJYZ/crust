/**
 * The notification + tray symbol table a test drives: every export of `LinuxNotifyTrayShim`,
 * recording into a call log instead of reaching libnotify or GTK.
 *
 * Imported only by tests. Product code never reads it, and neither adapter knows it exists — which
 * is why the tests run on macOS, where neither library is loadable.
 */
import type { LinuxNotifyTrayShim } from "./notify-tray-ffi.ts";

export interface FakeNotifyTrayOptions {
	/** What `shim_notify_load` answers: 1 ready, 0 with `missing` named. */
	notifyReady?: number;
	/** What `shim_tray_ready` answers. */
	trayReady?: number;
	/** The library or entry point the C would have named as absent. */
	missing?: string;
	/** The line `shim_notify_reason` carries. */
	reason?: string;
	/** What `shim_notify_post` answers: 0 accepted, 2 missing, 3 refused. */
	postStatus?: number;
	closeResult?: number;
	tooltipResult?: number;
	menuResult?: number;
	showResult?: number;
	hideResult?: number;
	destroyResult?: number;
	/** The clicks `shim_tray_click` hands out, in order; then -1 forever. */
	clicks?: number[];
}

/** A recording fake, with the last menu labels readable from a test. */
export interface FakeNotifyTray extends LinuxNotifyTrayShim {
	calls: string[];
	/** The labels the adapter sent, one per line, as C would have split them. */
	labels: string;
}

/** UTF-8 out of a `cstring` argument, minus its terminator. */
function text(value: Uint8Array): string {
	return Buffer.from(value).toString("utf8").replace(/\0$/, "");
}

export function fakeNotifyTray(
	options: FakeNotifyTrayOptions = {},
	calls: string[] = [],
): FakeNotifyTray {
	const clicks = [...(options.clicks ?? [])];
	const fake: FakeNotifyTray = {
		calls,
		labels: "",
		shim_notify_load: () => {
			calls.push("notify_load");
			return options.notifyReady ?? 1;
		},
		shim_notify_ready: () => options.notifyReady ?? 1,
		shim_notify_missing: () => options.missing ?? "",
		shim_notify_reason: () => options.reason ?? "the daemon accepted it",
		shim_notify_post: (title, body) => {
			calls.push(`post:${text(title)}:${text(body)}`);
			return options.postStatus ?? 0;
		},
		shim_notify_close: () => {
			calls.push("notify_close");
			return options.closeResult ?? 1;
		},
		shim_tray_ready: () => {
			calls.push("tray_ready");
			return options.trayReady ?? 1;
		},
		shim_tray_menu: (joined, count) => {
			fake.labels = text(joined);
			calls.push(`menu:${count}:${fake.labels}`);
			return options.menuResult ?? 1;
		},
		shim_tray_tooltip: (value) => {
			calls.push(`tooltip:${text(value)}`);
			return options.tooltipResult ?? 1;
		},
		shim_tray_show: () => {
			calls.push("show");
			return options.showResult ?? 1;
		},
		shim_tray_hide: () => {
			calls.push("hide");
			return options.hideResult ?? 1;
		},
		shim_tray_destroy: () => {
			calls.push("destroy");
			return options.destroyResult ?? 1;
		},
		shim_tray_click: () => {
			const next = clicks.shift();
			calls.push(`click:${next ?? -1}`);
			return next ?? -1;
		},
	};
	return fake;
}
