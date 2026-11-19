/**
 * The driver page. Every claim is its own answer: the plugin's fullscreen flag, the page's own
 * viewport against the display, and the backend's read of the live `NSWindow`.
 *
 * A fullscreen request is a flip in AppKit (`-toggleFullScreen:`), so the page asks for a state and
 * then polls both halves of the answer — the style-mask bit the plugin reads and the viewport the
 * page sees — instead of trusting the request. A zoomed window answers the same plugin call with
 * `false` and its viewport stops at the visible frame, which is the difference this pins.
 */
import { COVER_TOLERANCE } from "../expectations.ts";

const PAGE_DRIVER = `var TOLERANCE = ${COVER_TOLERANCE};
var SETTLE_MS = 15000;

function settle(promise) {
	return promise
		.then(function (value) {
			return { how: "resolved", value: value };
		})
		.catch(function (error) {
			return {
				how: "rejected",
				name: error && error.name,
				code: error && error.code,
				status: error && error.status,
				message: error && error.message,
			};
		});
}

function ask(plugin, command, args) {
	return settle(window.crust.invoke(plugin, command, args));
}

function call(command, args) {
	return settle(window.crust.invoke(command, args));
}

function report(tag, answer) {
	return window.crust.invoke("report", { line: tag + " " + JSON.stringify(answer) });
}

function delay(ms) {
	return new Promise(function (resolve) {
		setTimeout(resolve, ms);
	});
}

function viewport() {
	return { width: window.innerWidth, height: window.innerHeight };
}

function display() {
	return { width: screen.width, height: screen.height, availHeight: screen.availHeight };
}

// The display macOS actually gives a fullscreen window: the panel height minus the notch inset,
// which is what screen.availHeight reports once the menu bar and dock are out of the way. Measured
// on this machine: 956 pt panel, 840 pt windowed visible frame, 923 pt in fullscreen — so a zoom is
// 83 pt short and a real transition is 0 short.
function covers(view, size) {
	return view.width >= size.width - TOLERANCE && view.height >= size.availHeight - TOLERANCE;
}

async function fullscreen(want) {
	var started = Date.now();
	var asked = await ask("window", "setFullscreen", { label: "main", value: want });
	if (asked.how !== "resolved") return asked;
	var deadline = started + SETTLE_MS;
	var last = null;
	var lastHeight = -1;
	var stable = 0;
	for (;;) {
		last = await ask("window", "isFullscreen", { label: "main" });
		var flag = last.how === "resolved" && last.value && last.value.fullscreen === true;
		var height = viewport().height;
		// The mask flips before the animation finishes, so the viewport has to stop moving too:
		// three identical reads is the bound on that, not a guessed delay.
		stable = height === lastHeight ? stable + 1 : 0;
		lastHeight = height;
		if (flag === want && stable >= 2) break;
		if (Date.now() > deadline) break;
		await delay(80);
	}
	// A toggle sent into the tail of a transition is ignored, and the tail is longer than the mask
	// flip: measured, an exit sent 800 ms after entering was dropped and the window stayed fullscreen.
	await delay(1500);
	var view = viewport();
	var screenNow = display();
	var final = await ask("window", "isFullscreen", { label: "main" });
	var finalFlag = final.how === "resolved" && final.value && final.value.fullscreen === true;
	var where = covers(view, screenNow);
	return {
		how: "resolved",
		value: {
			asked: asked.value,
			settled: final,
			reached: finalFlag === want && (want ? where : !where),
			viewport: view,
			screen: screenNow,
			elapsedMs: Date.now() - started,
		},
	};
}

// The window is created before the app finishes coming forward, and AppKit only lists a window on the
// active Space once that lands: measured, the launch read answers onActiveSpace 0 with the app already
// active, and one moment later 1. A fullscreen toggle sent before that move is ignored outright, so the
// proof waits for the Space rather than racing it. Bounded, and the wait is reported either way.
async function onActiveSpace(number, timeoutMs) {
	var started = Date.now();
	var reading = null;
	for (;;) {
		reading = await call("probe", { window: number });
		if (reading.how === "resolved" && reading.value && reading.value.onActiveSpace === 1) break;
		if (Date.now() - started > timeoutMs) break;
		await delay(100);
	}
	return { reading: reading, waitedMs: Date.now() - started };
}

async function main() {
	await report("label", await ask("window", "label", {}));

	// The window number from the launch read, so every later probe measures this window even while
	// AppKit's own toolbar overlay shares the list.
	var launch = await call("probe", {});
	var number = launch.how === "resolved" && launch.value ? launch.value.windowNumber : 0;

	var settled = await onActiveSpace(number, 8000);
	await report("probe0", settled.reading);
	await report("space0", { how: "resolved", value: { waitedMs: settled.waitedMs } });
	await report("viewport0", {
		how: "resolved",
		value: { viewport: viewport(), screen: display() },
	});

	await report("fs", await fullscreen(true));
	await report("probe1", await call("probe", { window: number }));
	await report("unfs", await fullscreen(false));
	await report("probe2", await call("probe", { window: number }));
	await report("viewport2", {
		how: "resolved",
		value: { viewport: viewport(), screen: display() },
	});

	// Closing this window ends the app; the report above is the last thing this page says.
	await report("closing", { how: "resolved", value: "close main" });
	await ask("window", "close", { label: "main" });
}

main().catch(function (error) {
	report("crash", { how: "threw", message: String((error && error.message) || error) });
});
`;

export const PAGE_SOURCE = PAGE_DRIVER;
