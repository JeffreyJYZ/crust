/**
 * The first half of the driver page: the two titles it uses and the helpers it
 * reports through. `page.ts` appends the step sequence and exports the whole
 * document; this half is split only to keep both files inside the repo's line
 * cap, and the concatenation is byte-identical to one literal.
 */
import { APPLIED_TITLE, IMPOSSIBLE_TITLE } from "./config.ts";

export const PAGE_PRELUDE = `var APPLIED = ${JSON.stringify(APPLIED_TITLE)};
var IMPOSSIBLE = ${JSON.stringify(IMPOSSIBLE_TITLE)};

function ask(plugin, command, args) {
	return window.crust
		.invoke(plugin, command, args)
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

function report(tag, answer) {
	return window.crust.invoke("report", { line: tag + " " + JSON.stringify(answer) });
}

function delay(ms) {
	return new Promise(function (resolve) {
		setTimeout(resolve, ms);
	});
}

// The tags the backend has printed so far. A created window's page reports on
// its own time, so the driver waits on this instead of guessing a delay.
function seen() {
	return window.crust.invoke("seen", {});
}

async function appeared(tag, timeoutMs) {
	var deadline = Date.now() + timeoutMs;
	for (;;) {
		var tags = await seen();
		if (Array.isArray(tags) && tags.indexOf(tag) !== -1) return true;
		if (Date.now() > deadline) return false;
		await delay(50);
	}
}

// The probe a created window's page runs: this script reached a *different*
// page context, so its own invoke is the proof the bridge document loaded there
// with the app's token. Both facts go in one report, so nothing can arrive
// after the window is closed.
async function child() {
	var parts = location.pathname.split("/");
	var label = parts[parts.length - 1];
	var open = await ask("window", "isOpen", { label: label });
	await report("child." + label, {
		how: "resolved",
		value: { href: location.href, open: open },
	});
}

// list() reports only windows AppKit still holds, so a closed label is gone from
// it at once. This poll is the bound on that claim, not a delay: the page waits
// for the label to disappear before asking for it again, and gives up loudly.
async function released(label, timeoutMs) {
	var deadline = Date.now() + timeoutMs;
	for (;;) {
		var answer = await ask("window", "list");
		var labels = answer.how === "resolved" && answer.value && answer.value.labels;
		if (labels && labels.indexOf(label) === -1) return { how: "resolved", value: true };
		if (Date.now() > deadline) return { how: "resolved", value: false };
		await delay(50);
	}
}`;
