/**
 * The navigation and find-in-page proofs: both need a live WKWebView, so each opens its own
 * 240x160 window on a `data:` page and closes it in a `finally`. A second `createPlatform` is used
 * because the runtime's own is private to `startApp`; the runtime's 16 ms pump drives WebKit's
 * delegate and completion callbacks, so waiting here is a `Bun.sleep` loop, never a nested pump.
 */
import { createWindowPlugin } from "crust/plugin";
import { darwinFindAdapter } from "../../src/platform/darwin/find.ts";
import {
	darwinNavigationAdapter,
	darwinNavigationWebview,
} from "../../src/platform/darwin/navigation.ts";
import { createFindInPagePlugin } from "../../src/plugins/findinpage.ts";
import { createNavigationPlugin } from "../../src/plugins/navigation.ts";
import { createPlatform } from "../../src/platform/darwin/platform.ts";
import { darwinWindowAdapter } from "../../src/platform/darwin/window-adapter.ts";
import { mark, reason } from "./proofs.ts";

/** The page both proofs load: the marker is what find searches for. */
const PAGE = "data:text/html,%3Cp%3Eparity-find-marker%3C%2Fp%3E";
const TIMEOUT_MS = 8000;
const POLL_MS = 50;

interface Opened {
	web: number;
	close: () => void;
}

/** A window on `PAGE` whose webview pointer is already resolved, or a throw naming the step. */
function open(label: string): Opened {
	const platform = createPlatform({ appName: "Parity probe" });
	const windows = createWindowPlugin(darwinWindowAdapter(platform));
	const created = windows.commands.create({ label, width: 240, height: 160, url: PAGE });
	if (created.ok !== true) throw new Error(`window.create refused: ${JSON.stringify(created)}`);
	const pointer = platform.nativeWindow(label);
	const web = pointer === undefined ? 0 : darwinNavigationWebview(pointer);
	if (web === 0) {
		windows.commands.close({ label });
		throw new Error("the window has no WKWebView pointer");
	}
	return {
		web,
		close: () => {
			windows.commands.close({ label });
		},
	};
}

/** The webview's own state until the load settles; `null` means it never did. */
async function settled(web: number): Promise<{ url: string } | null> {
	const navigation = darwinNavigationAdapter(() => web);
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		const now = navigation.state();
		if (now !== null && now.url.length > 0 && !now.loading) return now;
		await Bun.sleep(POLL_MS);
	}
	return null;
}

/** The delegate is installed on the probe's own webview, then a reload reports `did-finish`. */
export async function proveNavigation(): Promise<boolean> {
	let opened: Opened;
	try {
		opened = open("parity-navigation");
	} catch (error) {
		console.log(`navigation failed: ${reason(error)}`);
		return mark("navigation", false);
	}
	let finished: { url?: string } | undefined;
	const ctx = {
		emit: (event: string, data: unknown) => {
			if (event === "navigation:did-finish") finished = data as { url?: string };
		},
	};
	const navigation = createNavigationPlugin(darwinNavigationAdapter(() => opened.web));
	try {
		const started = navigation.commands.start(undefined, ctx);
		if (started.ok !== true) {
			console.log(`navigation install refused: ${JSON.stringify(started)}`);
			return mark("navigation", false);
		}
		navigation.commands.reload(undefined, ctx);
		const deadline = Date.now() + TIMEOUT_MS;
		while (finished === undefined && Date.now() < deadline) await Bun.sleep(POLL_MS);
		const url = finished?.url ?? "";
		console.log(`navigation finished=${finished !== undefined} url=${url}`);
		return mark("navigation", finished !== undefined && url.startsWith("data:"));
	} finally {
		navigation.commands.stop(undefined, ctx);
		opened.close();
	}
}

/** The page is searched for its own marker: WebKit answers one BOOL, so one match is the answer. */
export async function proveFindInPage(): Promise<boolean> {
	let opened: Opened;
	try {
		opened = open("parity-find");
	} catch (error) {
		console.log(`findinpage failed: ${reason(error)}`);
		return mark("findinpage", false);
	}
	try {
		if ((await settled(opened.web)) === null) {
			console.log("findinpage failed: the data: page never finished loading");
			return mark("findinpage", false);
		}
		const find = createFindInPagePlugin(darwinFindAdapter(() => opened.web));
		const answer = await find.commands.search({ text: "parity-find-marker" });
		const found = "found" in answer && answer.found === true;
		const matches = "matches" in answer ? answer.matches : 0;
		console.log(`findinpage found=${found} matches=${matches}`);
		return mark("findinpage", found && matches === 1);
	} finally {
		opened.close();
	}
}
