/**
 * Two fake windows and three recording natives, so a test can prove which window a command
 * reached without compiling anything or opening a window. `MAIN` and `PREFS` are pointer-shaped
 * stand-ins: the value is never dereferenced, only compared.
 */

import type { DownloadsUnit } from "./downloads-ffi.ts";
import { FIND_STATUS, type FindNative } from "./find-unit.ts";
import { NAVIGATION_STATUS, type NavigationNative } from "./navigation-unit.ts";
import type { WebviewWindows } from "./webview-target.ts";

export const MAIN = 0x1000;
export const PREFS = 0x2000;

/** Two tracked windows, in creation order: `main` first, so "the first window" is observable. */
export function twoWindows(): WebviewWindows {
	const views = new Map([
		["main", MAIN],
		["prefs", PREFS],
	]);
	return {
		windowLabels: () => [...views.keys()],
		webview: (label) => views.get(label),
	};
}

export function fakeNavigation() {
	const seen: number[] = [];
	const symbols: NavigationNative = {
		crust_nav_set_sink: () => {},
		crust_nav_install: (web) => {
			seen.push(web);
			return NAVIGATION_STATUS.installed;
		},
		crust_nav_uninstall: (web) => {
			seen.push(web);
			return 1;
		},
		crust_nav_url: () => 0,
		crust_nav_title: () => 0,
		crust_nav_error: () => 0,
		crust_nav_loading: () => 0,
		crust_nav_can_go_back: () => 0,
		crust_nav_can_go_forward: () => 0,
		crust_nav_reload: (web) => {
			seen.push(web);
			return 1;
		},
		crust_nav_go_back: (web) => {
			seen.push(web);
			return 1;
		},
		crust_nav_go_forward: (web) => {
			seen.push(web);
			return 1;
		},
		crust_nav_webview: () => 0,
		crust_nav_class_ready: () => 31,
	};
	return { seen, symbols };
}

export function fakeFind() {
	const seen: number[] = [];
	// A status other than `started` rejects the promise at once, so an assertion is about the
	// webview the send named rather than about waiting out the completion timeout.
	const symbols: FindNative = {
		crust_find_set_sink: () => {},
		crust_find_available: () => 1,
		crust_find_search: (web) => {
			seen.push(web);
			return FIND_STATUS.unavailable;
		},
		crust_find_repeat: (web) => {
			seen.push(web);
			return FIND_STATUS.unavailable;
		},
		crust_find_block_ready: () => 1,
	};
	return { seen, symbols };
}

export function fakeDownloads() {
	const seen: number[] = [];
	const unit: DownloadsUnit = {
		symbols: {
			dl_abi: () => 1,
			dl_install: () => 1,
			dl_start: (web) => {
				seen.push(web);
				return 7;
			},
			dl_cancel: () => 1,
			dl_forget: () => {},
			dl_progress: () => 0.5,
			dl_answer: () => {},
			dl_text_copy: () => "",
			dl_last_token_get: () => 0,
		},
	};
	return { seen, unit };
}

/** The error a synchronous throw raised, or undefined when nothing was thrown. */
export function thrown(act: () => unknown): unknown {
	try {
		act();
		return undefined;
	} catch (error) {
		return error;
	}
}
