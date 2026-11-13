/**
 * The end-to-end proof for `crust:window` — the surface a user touches first.
 *
 * `window.test.ts` proves the plugin against fakes: every command resolves a
 * value, an unknown label is a typed failure, a platform with no adapter says
 * `not-implemented`. None of that proves the adapter, the AppKit window behind
 * it, or what a page actually receives. This script does, through the real path:
 * a project is written to a scratch directory, `crust build` compiles and
 * ad-hoc signs it, and the binary inside the bundle is launched directly — never
 * `open`, which routes through LaunchServices and hides which process ran.
 *
 * The app has two windows, so "a different label" is a real second window and
 * not the same one under another name. `other` runs the driver page and `main`
 * is the spare: `create` reusing a closed label needs the platform to drop its
 * stale entry, and that is proved on `main` while the driver stays alive. The
 * page calls every command through `window.crust.invoke` and reports each answer
 * to the backend, which prints it: one stream then holds the page's observables
 * and this process's own lines, and the count of those report lines is an
 * assertion — a page that never ran cannot pass by exiting 0 with an empty log.
 *
 * What the page sees is asserted as measured, not as intended. An unknown label
 * is a *resolved* `{ ok: false, code: "unknown-window" }`, because the plugin
 * converts the adapter's throw; a *rejected* invoke is what an unknown command
 * produces. Both shapes are pinned below, so the difference cannot drift
 * silently.
 *
 * `create` is proved from both ends. The page that asks for a window only sees
 * the plugin's answer, so the created windows load a document that runs the
 * same `app.js` in its own page context and reports back: its own URL and the
 * answer its own `invoke` got. That is what turns "a second NSWindow exists"
 * into an observation, and it is also how URL resolution is checked — the
 * relative request is resolved against the document the platform recorded for
 * an open window (`/spare/idle.html`, not this page's `/`), so the child must
 * land on `/spare/child/…`; an absolute one must load exactly as given. The
 * driver waits for those reports through a backend command (`seen`), so a
 * window that never loaded its page fails here instead of racing the close.
 *
 * Usage:
 *   bun scripts/e2e-window.ts    # or `bun run e2e:window` once package.json defines it
 *
 * Two facts this script is built around:
 *
 *   - the runtime compiles `src/platform/darwin/shim.c` at launch, so a windowed
 *     run needs an Aqua session and a hard deadline with a `SIGTERM` to its
 *     process group; macOS ships no `timeout(1)`, so `e2e-harness.ts` owns that;
 *   - a built app runs with `/` as its working directory, which is what a
 *     double-clicked bundle gets, and the only claim about exiting that counts is
 *     the app ending itself: `window.close` on the last window must reach
 *     `window-all-closed`, print, and leave with code 0.
 */

import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearSurvivors, probe, runCommand, survivorsOf, Verdict } from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src/cli/index.ts");

/** `CFBundleExecutable` that `crust build` pins. Same constant as `e2e.ts`. */
const BINARY_NAME = "crust-app";

/** `app.name` in the generated config; also the bundle's name. */
const APP_NAME = "Window crust";

/**
 * The example imports `crust`, which resolves through this package's own exports
 * map inside the checkout. A scratch copy has no install, so one symlink to the
 * checkout stands in for it — and it is also what `projectCrustRoot` realpaths,
 * so the compiled binary carries exactly one copy of the framework.
 * (`e2e-package.ts` uses the same trick for the same reason.)
 */
const FALLBACK_DEPENDENCY = REPO_ROOT;

/**
 * The two configured windows, and which one drives the page.
 *
 * `other` serves the driver and `main` is a spare. Two windows is the point:
 * `focus` on a different label must reach a different `NSWindow`, not the same
 * one renamed. The driver must never sit in the window `create` is tested
 * against — closing it kills the page mid-proof — so the spare goes first in the
 * list, which is also the order `window-all-closed` checks: it calls
 * `platform.window(label)` per configured label and stops at the first open one,
 * so `main` is examined (and a closed `main` pruned) while the driver is alive.
 *
 * `main` loads `/spare/idle.html` rather than `/idle.html` on purpose, and it is
 * the only reason for that subdirectory: `create` with a relative URL resolves
 * against the document the platform recorded for an open window, and `main` is
 * the first of the two, so a path-relative request must land under `/spare/`.
 * At `/` the recorded base and this page's own `/` would coincide and the
 * resolution would be unobservable.
 */
const CONFIG_SOURCE = `import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.e2e-window", name: ${JSON.stringify(APP_NAME)}, version: "0.1.0" },
	windows: [
		{ label: "main", url: "/spare/idle.html", width: 420, height: 280, title: "Spare" },
		{ label: "other", url: "/", width: 900, height: 640, title: ${JSON.stringify(APP_NAME)} },
	],
} satisfies CrustConfig;
`;

/**
 * The backend. `report` is the page's channel: one line per window answer, on
 * this process's stdout, which is the log the proof reads. `seen` hands the tags
 * recorded so far back to the page, so the driver can wait for a *created*
 * window's page to report before closing the window it is proving.
 * `window-all-closed` is what must run after the page closes the second window.
 */
const MAIN_SOURCE = `import { app } from "crust";

const reported = [];

app.command("report", (args) => {
	const line = typeof args.line === "string" ? args.line : "";
	const tag = line.split(" ")[0];
	if (tag) reported.push(tag);
	console.log(\`  page      \${line}\`);
	return "printed";
});

app.command("seen", () => [...reported]);

app.on("window-all-closed", () => {
	console.log("  window    every window closed; quitting");
});

await app.run();
`;

const INDEX_SOURCE = `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>${APP_NAME}</title>
	</head>
	<body>
		<main>
			<h1>${APP_NAME}</h1>
			<p id="status">driving the window plugin…</p>
		</main>
		<script src="/app.js"></script>
	</body>
</html>
`;

/**
 * The spare window's page: served from `/spare/`, alive, and deliberately
 * script-free, so a window created with `url: "/spare/idle.html"` runs nothing
 * and cannot report twice. Its path is what a relative `create` URL is resolved
 * against; see `CONFIG_SOURCE`.
 */
const IDLE_SOURCE = `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>Idle</title>
	</head>
	<body>
		<p>a second window, so a different label is a different NSWindow</p>
	</body>
</html>
`;

/** A title AppKit can apply; the adapter reads it back and only then says ok. */
const APPLIED_TITLE = "Renamed by the page";

/**
 * A title that cannot be applied: the shim builds the NSString with
 * `initWithBytes:length:strlen(bytes)`, so the NUL truncates it to "x" and the
 * adapter's own read-back disagrees with what was asked for. That turns a silent
 * partial title into an error, which is the behaviour under test.
 */
const IMPOSSIBLE_TITLE = "x\u0000y";

/**
 * The driver. Every answer is normalised to one of two shapes — `resolved` with
 * the value, or `rejected` with the page-side error's own fields — because the
 * difference between a typed failure and a rejected invoke is exactly what this
 * proof documents.
 */
const PAGE_SOURCE = `var APPLIED = ${JSON.stringify(APPLIED_TITLE)};
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
}

async function main() {
	await report("list0", await ask("window", "list"));
	await report("main0", await ask("window", "isOpen", { label: "main" }));
	await report("other0", await ask("window", "isOpen", { label: "other" }));
	await report("ghost", await ask("window", "isOpen", { label: "ghost" }));
	await report("title", await ask("window", "setTitle", { label: "main", title: APPLIED }));
	await report("titlebad", await ask("window", "setTitle", { label: "main", title: IMPOSSIBLE }));
	await report("focus1", await ask("window", "focus", { label: "main" }));
	await report("focus2", await ask("window", "focus", { label: "main" }));
	await report("focusother", await ask("window", "focus", { label: "other" }));
	await report("focusghost", await ask("window", "focus", { label: "ghost" }));
	await report("list1", await ask("window", "list"));
	await report("unknown", await ask("window", "doesNotExist", {}));
	await report("badlabel", await ask("window", "isOpen", { label: 42 }));
	await report("alive", await ask("window", "list"));

	// ---- a created window is a real second NSWindow ----------------------
	// Every create below runs while the pump is ticking: a page's invoke is
	// delivered by that pump, so an answer here has already crossed it.
	//
	// "child/relative" has no leading slash on purpose. The adapter resolves a
	// relative url against the document the platform recorded for an open window
	// — /spare/idle.html, not this page's / — so it must land on
	// /spare/child/relative and not /child/relative. A relative string handed to
	// NSURL unchanged becomes about:blank, so a window made from one would run no
	// page at all.
	await report(
		"createrel",
		await ask("window", "create", {
			label: "relative",
			title: "Relative child",
			width: 460,
			height: 300,
			url: "child/relative",
		}),
	);
	// An absolute url is handed through as given: the same origin, a path no
	// resolver could have invented from this page's own location.
	await report(
		"createabs",
		await ask("window", "create", {
			label: "absolute",
			title: "Absolute child",
			width: 460,
			height: 300,
			url: location.origin + "/spare/child/absolute",
		}),
	);
	// Each child page reports on its own time; these two polls are the bound on
	// that, and a window that never loaded its document answers false here
	// rather than passing on the create's own ok.
	await report("sawrelative", { how: "resolved", value: await appeared("child.relative", 5000) });
	await report("sawabsolute", { how: "resolved", value: await appeared("child.absolute", 5000) });
	await report("lists2", await ask("window", "list"));
	await report("childopen", await ask("window", "isOpen", { label: "relative" }));
	await report(
		"childtitle",
		await ask("window", "setTitle", { label: "relative", title: "Relative titled" }),
	);
	await report("childclose", await ask("window", "close", { label: "relative" }));
	await report("childgone", await ask("window", "isOpen", { label: "relative" }));
	await report("absclose", await ask("window", "close", { label: "absolute" }));
	await report("absgone", await ask("window", "isOpen", { label: "absolute" }));
	await report("tidied", await ask("window", "list"));

	// A closed window, then the same label again: the release the adapter's
	// create depends on. Only the spare may be closed here — the driver's own
	// window is closed last, because after that this page is gone.
	await report("closemain", await ask("window", "close", { label: "main" }));
	await report("mainafter", await ask("window", "isOpen", { label: "main" }));
	await report("otherstill", await ask("window", "isOpen", { label: "other" }));
	await report("released", await released("main", 2000));
	await report(
		"recreate",
		await ask("window", "create", {
			label: "main",
			title: "Reopened main",
			width: 520,
			height: 300,
			url: "/spare/child/main",
		}),
	);
	// The re-created label loads its document again, and that page says so from
	// its own context: same label, a window that is open again, a fresh page.
	await report("sawreopen", { how: "resolved", value: await appeared("child.main", 5000) });
	await report("relist", await ask("window", "list"));
	await report("reopenopen", await ask("window", "isOpen", { label: "main" }));
	await report(
		"reopenset",
		await ask("window", "setTitle", { label: "main", title: "Reopened and titled" }),
	);

	// A live label is refused, and nothing is released to make room for it.
	await report("dup", await ask("window", "create", { label: "main", url: "/spare/idle.html" }));
	await report("duplist", await ask("window", "list"));
	await report("dupafter", await ask("window", "isOpen", { label: "main" }));

	// A label that never existed: created, found by every other command, closed.
	await report(
		"create",
		await ask("window", "create", {
			label: "spawn",
			title: "Spawned by the page",
			width: 500,
			height: 320,
			url: "/spare/idle.html",
		}),
	);
	await report("lists", await ask("window", "list"));
	await report("spawnopen", await ask("window", "isOpen", { label: "spawn" }));
	await report("spawnset", await ask("window", "setTitle", { label: "spawn", title: "Spawn titled" }));
	await report("spawnclose", await ask("window", "close", { label: "spawn" }));
	await report("spawngone", await ask("window", "isOpen", { label: "spawn" }));

	// Refused arguments, not clamped or coerced: no window is built for any of
	// them. A fractional size is the case a cast would silently round, so it gets
	// its own answer; the list afterwards proves no refusal left one behind.
	await report("badsize", await ask("window", "create", { label: "tiny", width: 0 }));
	await report("badfraction", await ask("window", "create", { label: "fraction", width: 12.5 }));
	await report("badurl", await ask("window", "create", { label: "nowhere", url: "" }));
	await report("reflist", await ask("window", "list"));

	await report("closeagain", await ask("window", "close", { label: "main" }));
	await report("maingone", await ask("window", "isOpen", { label: "main" }));
	await report("closing", { how: "resolved", value: "close other" });
	await ask("window", "close", { label: "other" });
}

// The driver is served at "/" and runs the whole sequence. A window created with
// a /child/<label> document runs this same script in *its own* page context and
// takes the probe branch instead — that is what makes "the child's own invoke
// answers" an observation rather than an assumption.
var CHILD = location.pathname.indexOf("/child/") !== -1;

(CHILD ? child() : main()).catch(function (error) {
	// A page that throws must not look like a quiet pass: one more line, and the
	// tag assertion fails with this reason beside it.
	report("crash", { how: "threw", message: String((error && error.message) || error) });
});
`;

/**
 * Every answer the page sends, in order. The count is the guard against a
 * silent no-op: a page that never ran, or died half way, cannot reach it.
 */
const EXPECTED_TAGS = [
	"list0",
	"main0",
	"other0",
	"ghost",
	"title",
	"titlebad",
	"focus1",
	"focus2",
	"focusother",
	"focusghost",
	"list1",
	"unknown",
	"badlabel",
	"alive",
	"createrel",
	"createabs",
	"sawrelative",
	"child.relative",
	"sawabsolute",
	"child.absolute",
	"lists2",
	"childopen",
	"childtitle",
	"childclose",
	"childgone",
	"absclose",
	"absgone",
	"tidied",
	"closemain",
	"mainafter",
	"otherstill",
	"released",
	"recreate",
	"sawreopen",
	"child.main",
	"relist",
	"reopenopen",
	"reopenset",
	"dup",
	"duplist",
	"dupafter",
	"create",
	"lists",
	"spawnopen",
	"spawnset",
	"spawnclose",
	"spawngone",
	"badsize",
	"badfraction",
	"badurl",
	"reflist",
	"closeagain",
	"maingone",
	"closing",
] as const;

/**
 * The assertions that read those answers, in one place: a build that never ran
 * must report each of them as unchecked, and a drifted name must not silently
 * vanish from that list.
 */
const WINDOW_CHECKS = [
	"list open",
	"isOpen main",
	"isOpen other",
	"ghost absent",
	"isOpen ghost",
	"setTitle",
	"setTitle bad",
	"focus",
	"focus twice",
	"focus other",
	"focus ghost",
	"after focus",
	"unknown cmd",
	"bad label",
	"alive after",
	"create relative",
	"child relative",
	"create absolute",
	"child absolute",
	"child waited",
	"list children",
	"child open",
	"child title",
	"child close",
	"child gone",
	"absolute close",
	"absolute gone",
	"tidy",
	"close main",
	"isOpen closed",
	"other still",
	"released",
	"recreate",
	"reopen loads",
	"relist",
	"reopen open",
	"reopen title",
	"duplicate",
	"duplicate list",
	"duplicate kept",
	"create",
	"list after create",
	"spawn open",
	"spawn title",
	"spawn close",
	"spawn gone",
	"bad size",
	"bad fraction",
	"bad url",
	"refused nothing",
	"close again",
	"close again gone",
	"all closed",
	"exit 0",
	"no survivors",
] as const;

/** The backend's own line once every window is closed. */
const ALL_CLOSED = /window\s+every window closed; quitting/;

/**
 * Nothing. The app ends itself, so the probe must not stop it on a line:
 * anything that matched would get a SIGTERM, and `exit 0` would then be a fact
 * about the harness rather than about `window-all-closed`. `(?!)/` can never
 * match, so `probe` waits for the child's own exit — and a hung app still fails
 * on the deadline below. (A regex like `/$^/` is not a safe choice here: it
 * matches an empty string, and an empty first chunk would end the probe early.)
 */
const WAIT_FOR_EXIT = /(?!)/;

/**
 * Two windows plus WebKit's web processes, four created windows and the shim
 * compile; measured ~3 s. The headroom covers the pages' own report waits, which
 * only run long when something is already broken.
 */
const APP_TIMEOUT_MS = 40_000;

function seconds(ms: number | null): string {
	return ms === null ? "no exit" : `${(ms / 1000).toFixed(2)} s`;
}

/** The last non-empty line of a captured stream, for a failure detail. */
function lastLine(text: string): string {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	return lines.at(-1)?.trim() ?? "";
}

/** A page answer, as either shape above. `value` stays unknown until narrowed. */
interface PageAnswer {
	how?: string;
	value?: unknown;
	name?: string;
	code?: string;
	status?: number;
	message?: string;
}

/** Every `  page      <tag> <json>` line, in order. */
function pageLines(text: string): { tag: string; answer: PageAnswer }[] {
	const found: { tag: string; answer: PageAnswer }[] = [];
	for (const line of text.split("\n")) {
		const match = /^\s+page\s+(\S+)\s+(\{.*\})\s*$/.exec(line);
		const tag = match?.[1];
		const json = match?.[2];
		if (tag === undefined || json === undefined) continue;
		// A truncated answer is still counted; only its fields are missing.
		found.push({ tag, answer: JSON.parse(json) as PageAnswer });
	}
	return found;
}

/** The value of a resolved answer, when it is the object a window command answers. */
function resolved(answer: PageAnswer | undefined): Record<string, unknown> | undefined {
	if (answer?.how !== "resolved") return undefined;
	const value = answer.value;
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

/** A resolved `list` answer's labels, or undefined when it is not one. */
function labelsOf(answer: PageAnswer | undefined): string[] | undefined {
	const labels = resolved(answer)?.labels;
	if (!Array.isArray(labels)) return undefined;
	return labels.every((label) => typeof label === "string") ? (labels as string[]) : undefined;
}

/** Whether `list` answered exactly this set of labels. */
function sameLabels(answer: PageAnswer | undefined, expected: readonly string[]): boolean {
	const labels = labelsOf(answer);
	if (labels === undefined || labels.length !== expected.length) return false;
	return [...labels].sort().join("\n") === [...expected].sort().join("\n");
}

/** The origin of an absolute URL, or undefined when it is not one. */
function originOf(href: string): string | undefined {
	try {
		return new URL(href).origin;
	} catch {
		return undefined;
	}
}

/**
 * What a created window's own page reported: the document it loaded, and the
 * answer its own `invoke` got. Absent means that page never ran, which is the
 * first thing the child checks below fail on.
 */
interface ChildReport {
	href: string;
	open?: PageAnswer;
}

function childReport(answer: PageAnswer | undefined): ChildReport | undefined {
	// `resolved` already unwraps the answer's `value`, which is the object the
	// child page built: `{ href, open }`.
	const value = resolved(answer);
	if (typeof value !== "object" || value === null) return undefined;
	const bag = value as { href?: unknown; open?: unknown };
	if (typeof bag.href !== "string") return undefined;
	const open =
		typeof bag.open === "object" && bag.open !== null ? (bag.open as PageAnswer) : undefined;
	return { href: bag.href, open };
}

/**
 * Whether the page was told the window is gone.
 *
 * Measured, and it is the only truthful answer today: the platform reports only
 * the windows AppKit still holds, so a closed label is absent from `list`, and
 * the plugin's own existence check answers `unknown-window` before `isOpen` can
 * report `open: false`. That branch is unreachable from a page — `window.test.ts`'s
 * fake still models the older "closed but listed, number 0" platform, which is why
 * the unit test sees `open: false` and this proof cannot.
 */
function goneAnswer(answer: PageAnswer | undefined): boolean {
	const value = resolved(answer);
	return value?.ok === false && value?.code === "unknown-window";
}

/** A short, single-line form of anything, for a verdict detail. */
function show(value: unknown): string {
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value) ?? String(value);
		} catch {
			text = String(value);
		}
	}
	return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-window: SKIP  this proof builds a macOS .app and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-window-"));
	let binary: string | undefined;
	try {
		binary = await proof(verdict, scratch);
	} finally {
		// A leaked bundle carries the scratch path in its argv, so it is clearable,
		// and the tree goes either way — a throw is not a reason to leave both.
		if (binary !== undefined) await clearSurvivors(binary).catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}

	const gone = await stat(scratch)
		.then(() => false)
		.catch(() => true);
	verdict.check("scratch gone", gone, gone ? `removed ${scratch}` : `${scratch} still exists`);

	return verdict.report("e2e-window");
}

/** Write the project and its page, then return the binary path the probe runs. */
async function sandbox(scratch: string): Promise<string> {
	await mkdir(join(scratch, "node_modules"), { recursive: true });
	await symlink(FALLBACK_DEPENDENCY, join(scratch, "node_modules", "crust"), "dir");
	await mkdir(join(scratch, "public"), { recursive: true });
	await mkdir(join(scratch, "public", "spare"), { recursive: true });
	await writeFile(join(scratch, "crust.config.ts"), CONFIG_SOURCE, "utf8");
	await writeFile(join(scratch, "main.ts"), MAIN_SOURCE, "utf8");
	await writeFile(join(scratch, "public", "index.html"), INDEX_SOURCE, "utf8");
	await writeFile(join(scratch, "public", "app.js"), PAGE_SOURCE, "utf8");
	await writeFile(join(scratch, "public", "spare", "idle.html"), IDLE_SOURCE, "utf8");
	return join(scratch, "dist", `${APP_NAME}.app`, "Contents", "MacOS", BINARY_NAME);
}

async function proof(verdict: Verdict, scratch: string): Promise<string | undefined> {
	const binary = await sandbox(scratch);
	const bundle = join(scratch, "dist", `${APP_NAME}.app`);

	// ---- 1. build through the CLI, as a user runs it ------------------------
	const build = await runCommand([CLI, "build", "--dir", scratch], REPO_ROOT);
	const namedBundle = build.stdout.includes(bundle);
	const built = build.code === 0;
	const buildOk = verdict.check(
		"build",
		built && namedBundle,
		built
			? namedBundle
				? "crust build exited 0 and named the bundle"
				: `crust build exited 0 but never printed ${bundle}`
			: `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`,
	);
	if (!buildOk) {
		const why = "not checked — crust build failed";
		for (const name of ["bundle", "binary", "codesign", "page lines", ...WINDOW_CHECKS]) {
			verdict.check(name, false, why);
		}
		if (!built) console.log(build.stdout + build.stderr);
		return undefined;
	}

	// ---- 2. the bundle is where a recipient would find it -------------------
	const bundleStat = await stat(bundle).catch(() => undefined);
	verdict.check(
		"bundle",
		bundleStat?.isDirectory() === true,
		bundleStat?.isDirectory() === true ? bundle : `${bundle} is not a directory`,
	);

	const binaryStat = await stat(binary).catch(() => undefined);
	const executable = binaryStat?.isFile() === true && (binaryStat.mode & 0o111) !== 0;
	verdict.check(
		"binary",
		executable,
		binaryStat?.isFile() === true
			? `${binary} (${binaryStat.size} bytes${executable ? "" : ", not executable"})`
			: `${binary} is missing`,
	);

	// ---- 3. ad-hoc signed, which is what `crust build` promises -------------
	const signature = await runCommand(["codesign", "-dv", "--verbose=4", bundle], REPO_ROOT);
	const signatureText = `${signature.stderr}${signature.stdout}`;
	const adhoc = signature.code === 0 && /^Signature=adhoc$/m.test(signatureText);
	verdict.check(
		"codesign",
		adhoc,
		adhoc
			? "codesign -dv reports Signature=adhoc"
			: lastLine(signatureText) || "codesign -dv printed nothing",
	);

	// ---- 4. run it from `/`, as a launched bundle does ----------------------
	await clearSurvivors(binary);
	const run = await probe({
		command: [binary],
		cwd: "/",
		match: WAIT_FOR_EXIT,
		timeoutMs: APP_TIMEOUT_MS,
	});

	const answers = pageLines(run.stdout);
	const byTag = new Map(answers.map((entry) => [entry.tag, entry.answer]));

	// The app ends itself, so an exit before the last answer is possible and is
	// sometimes the *cause* of it; both are reported by the two assertions below.
	// A hang is not: the probe's deadline kills it, and `timedOut` says so.
	const exitLine = run.timedOut
		? `still running after ${APP_TIMEOUT_MS / 1000} s`
		: `exited ${run.code ?? "null"}${run.signal ? ` (${String(run.signal)})` : ""} ` +
			`after ${seconds(run.exitMs)}`;

	// ---- 5. the page reported every step -----------------------------------
	// This is the guard the whole proof rests on: a window that closed early, or a
	// page that never loaded, leaves fewer lines and cannot pass on an exit alone.
	// The count is exact in both directions, so a document that loaded twice — a
	// child page reporting its create a second time — fails here too.
	const missing = EXPECTED_TAGS.filter((tag) => !byTag.has(tag));
	const extra = answers.filter(
		(entry) => !(EXPECTED_TAGS as readonly string[]).includes(entry.tag),
	);
	const repeated = answers.length - byTag.size;
	const complete = missing.length === 0 && extra.length === 0 && repeated === 0;
	const countOk = verdict.check(
		"page lines",
		complete,
		complete
			? `${answers.length} answers, one per step, from ${EXPECTED_TAGS.length} steps`
			: `${answers.length} page answers — ` +
					`${missing.length > 0 ? `missing ${missing.join(", ")}` : "none missing"}` +
					`${extra.length > 0 ? `, unexpected ${extra.map((entry) => entry.tag).join(", ")}` : ""}` +
					`${repeated > 0 ? `, ${repeated} reported twice` : ""}` +
					` — ${exitLine}`,
	);
	if (!countOk) {
		const why = `not checked — the page did not report every step (${exitLine})`;
		for (const name of WINDOW_CHECKS) {
			verdict.check(name, false, why);
		}
		if (answers.length === 0) console.log(run.stdout + run.stderr);
		return binary;
	}

	// ---- 6. list and isOpen tell the truth about the open windows ----------
	const list0 = resolved(byTag.get("list0"));
	const labels0 = list0?.labels;
	const bothListed =
		Array.isArray(labels0) &&
		labels0.length === 2 &&
		labels0.includes("main") &&
		labels0.includes("other");
	verdict.check(
		"list open",
		bothListed,
		bothListed ? `labels ${show(labels0)}` : `list answered ${show(byTag.get("list0"))}`,
	);

	const main0 = resolved(byTag.get("main0"));
	verdict.check(
		"isOpen main",
		main0?.open === true,
		main0?.open === true ? "main reports open: true" : `answered ${show(byTag.get("main0"))}`,
	);

	const other0 = resolved(byTag.get("other0"));
	verdict.check(
		"isOpen other",
		other0?.open === true,
		other0?.open === true
			? "other reports open: true"
			: `answered ${show(byTag.get("other0"))}`,
	);

	// ---- 7. a label that does not exist: not listed, and a typed failure ----
	// The shape is the measured one: the plugin converts the adapter's throw, so
	// the page's promise *resolves* with a failure value. A rejected invoke is a
	// different path, asserted in step 10, and conflating the two would hide which
	// one a page has to handle.
	const ghostListed = Array.isArray(labels0) && labels0.includes("ghost");
	verdict.check(
		"ghost absent",
		!ghostListed,
		ghostListed ? `list answered ${show(labels0)}` : "no window labelled ghost is listed",
	);

	const ghost = byTag.get("ghost");
	const ghostOk = ghost?.how === "resolved" && resolved(ghost)?.code === "unknown-window";
	verdict.check(
		"isOpen ghost",
		ghostOk,
		ghostOk
			? `resolved { ok: false, code: "unknown-window" } for the missing label`
			: `page saw ${show(ghost)}`,
	);

	// ---- 8. setTitle applies, and an impossible title is an error ----------
	// The adapter reads the title back from AppKit and only then answers ok, so a
	// resolved `{ ok: true, title }` is the read-back proof; a title the window
	// cannot hold must not resolve ok.
	const title = resolved(byTag.get("title"));
	const titleOk = title?.ok === true && title?.title === APPLIED_TITLE;
	verdict.check(
		"setTitle",
		titleOk,
		titleOk
			? `applied and read back ${JSON.stringify(title?.title)}`
			: `answered ${show(byTag.get("title"))}`,
	);

	const titleBad = byTag.get("titlebad");
	const titleFailure = resolved(titleBad);
	const titleBadOk = titleFailure?.ok === false && titleFailure?.code === "handler-error";
	verdict.check(
		"setTitle bad",
		titleBadOk,
		titleBadOk
			? `a NUL title answered ${show(titleFailure)} — an error, not a silent success`
			: `page saw ${show(titleBad)}`,
	);

	// ---- 9. focus: a no-op that answers ok, twice the same -----------------
	const focus1 = resolved(byTag.get("focus1"));
	const focus2 = resolved(byTag.get("focus2"));
	const focusOk = focus1?.focused === true && focus1?.label === "main";
	verdict.check(
		"focus",
		focusOk,
		focusOk ? `answered ${show(focus1)}` : `answered ${show(byTag.get("focus1"))}`,
	);

	// The observable, not the intent: a page cannot see which window is key, so
	// what is assertable is that the second call answers exactly what the first
	// did — no state machine, no drift, no error on a repeat.
	const sameTwice = focusOk && show(focus1) === show(focus2);
	verdict.check(
		"focus twice",
		sameTwice,
		sameTwice
			? "second focus answered identically"
			: `first ${show(focus1)} / second ${show(byTag.get("focus2"))}`,
	);

	// A different label is a different NSWindow: the call must reach it and answer
	// ok. That both windows survive is asserted after the second list.
	const focusOther = resolved(byTag.get("focusother"));
	const focusOtherOk = focusOther?.focused === true && focusOther?.label === "other";
	verdict.check(
		"focus other",
		focusOtherOk,
		focusOtherOk
			? `answered ${show(focusOther)} for the second window`
			: `answered ${show(byTag.get("focusother"))}`,
	);

	const focusGhost = byTag.get("focusghost");
	const ghostFocusOk =
		focusGhost?.how === "resolved" && resolved(focusGhost)?.code === "unknown-window";
	verdict.check(
		"focus ghost",
		ghostFocusOk,
		ghostFocusOk
			? "a label that does not exist answered the typed failure"
			: `page saw ${show(focusGhost)}`,
	);

	const list1 = resolved(byTag.get("list1"));
	const labels1 = list1?.labels;
	const stillTwo =
		Array.isArray(labels1) &&
		labels1.length === 2 &&
		labels1.includes("main") &&
		labels1.includes("other");
	verdict.check(
		"after focus",
		stillTwo,
		stillTwo
			? `labels unchanged: ${show(labels1)}`
			: `list answered ${show(byTag.get("list1"))}`,
	);

	// ---- 10. negatives: unknown command and a non-string label -------------
	// Two different shapes on purpose. An unknown command is a *rejected* invoke
	// (the bridge's `unknown-command`, status 404); a bad label is a resolved
	// `invalid-label` failure the plugin builds before any selector is sent.
	const unknown = byTag.get("unknown");
	const unknownOk =
		unknown?.how === "rejected" &&
		unknown?.code === "unknown-command" &&
		unknown?.status === 404;
	verdict.check(
		"unknown cmd",
		unknownOk,
		unknownOk
			? `rejected ${show({ code: unknown?.code, status: unknown?.status, name: unknown?.name })}`
			: `page saw ${show(unknown)}`,
	);

	const badLabel = byTag.get("badlabel");
	const badOk = badLabel?.how === "resolved" && resolved(badLabel)?.code === "invalid-label";
	verdict.check(
		"bad label",
		badOk,
		badOk ? `resolved ${show(resolved(badLabel))} with a code` : `page saw ${show(badLabel)}`,
	);

	// The backend is still there after both: a further command answers normally.
	const alive = resolved(byTag.get("alive"));
	const aliveOk = alive?.ok === true && Array.isArray(alive?.labels) && alive.labels.length === 2;
	verdict.check(
		"alive after",
		aliveOk,
		aliveOk
			? "the backend answered a further list after both failures"
			: `answered ${show(byTag.get("alive"))}`,
	);

	// ---- 10b. create: a real second NSWindow, and a document that runs ------
	// The page that asked only sees the plugin's answer, so the created windows
	// load a document that runs this same script in its own context and reports
	// what it found: its URL, and the answer its *own* invoke got. A window whose
	// webview never loaded the bridge document has no page to report with, and
	// every check below fails together — which is the point: the plugin's `ok` is
	// not evidence that an NSWindow exists.
	const createRel = resolved(byTag.get("createrel"));
	const createRelOk =
		createRel?.ok === true && createRel?.created === true && createRel?.label === "relative";
	verdict.check(
		"create relative",
		createRelOk,
		createRelOk ? `answered ${show(createRel)}` : `page saw ${show(byTag.get("createrel"))}`,
	);

	const relativeChild = childReport(byTag.get("child.relative"));
	const relativeOrigin = relativeChild === undefined ? undefined : originOf(relativeChild.href);
	const relativeOpen = resolved(relativeChild?.open);
	// The resolved URL, not the request: the base is the document `main` recorded
	// (`/spare/idle.html`), so `/spare/` is in the answer and `/` would mean the
	// request had been resolved against this page instead.
	const relativePath = relativeChild?.href === `${relativeOrigin}/spare/child/relative`;
	const relativeAsk =
		relativeOpen?.ok === true &&
		relativeOpen?.label === "relative" &&
		relativeOpen?.open === true;
	const relativeOk = relativeOrigin !== undefined && relativePath && relativeAsk;
	verdict.check(
		"child relative",
		relativeOk,
		relativeOk
			? `a second window loaded ${JSON.stringify(relativeChild?.href)} and its own invoke ` +
					`answered ${show(relativeOpen)}`
			: `href ${show(relativeChild?.href)} (resolved path ${relativePath}) from ` +
					`${show(byTag.get("child.relative"))}, invoke ${show(relativeOpen)}`,
	);

	const createAbs = resolved(byTag.get("createabs"));
	const createAbsOk =
		createAbs?.ok === true && createAbs?.created === true && createAbs?.label === "absolute";
	verdict.check(
		"create absolute",
		createAbsOk,
		createAbsOk ? `answered ${show(createAbs)}` : `page saw ${show(byTag.get("createabs"))}`,
	);

	// An absolute URL loads as given: the exact document the page named, at the
	// same origin as the resolved one. (A page cannot distinguish "passed through"
	// from "resolved to the same absolute string", so what is asserted here is the
	// load itself; `window.test.ts` pins the pass-through ordering against a
	// platform double, where both candidates are visible.)
	const absoluteChild = childReport(byTag.get("child.absolute"));
	const absoluteOpen = resolved(absoluteChild?.open);
	const absoluteOk =
		relativeOrigin !== undefined &&
		absoluteChild?.href === `${relativeOrigin}/spare/child/absolute` &&
		absoluteOpen?.ok === true &&
		absoluteOpen?.label === "absolute" &&
		absoluteOpen?.open === true;
	verdict.check(
		"child absolute",
		absoluteOk,
		absoluteOk
			? `loaded ${JSON.stringify(absoluteChild?.href)} and its own invoke answered ` +
					`${show(absoluteOpen)}`
			: `page saw ${show(byTag.get("child.absolute"))}`,
	);

	const sawRelative = byTag.get("sawrelative");
	const sawAbsolute = byTag.get("sawabsolute");
	const waitedOk =
		sawRelative?.how === "resolved" &&
		sawRelative?.value === true &&
		sawAbsolute?.how === "resolved" &&
		sawAbsolute?.value === true;
	verdict.check(
		"child waited",
		waitedOk,
		waitedOk
			? "both created windows' pages reported before the driver went on"
			: `waits answered ${show(sawRelative)} / ${show(sawAbsolute)}`,
	);

	// Both are tracked where every other command looks, which is what makes a
	// created window usable rather than only open.
	const lists2Ok = sameLabels(byTag.get("lists2"), ["main", "other", "relative", "absolute"]);
	verdict.check(
		"list children",
		lists2Ok,
		lists2Ok
			? `labels ${show(labelsOf(byTag.get("lists2")))}`
			: `list answered ${show(byTag.get("lists2"))}`,
	);

	const childOpen = resolved(byTag.get("childopen"));
	verdict.check(
		"child open",
		childOpen?.open === true,
		childOpen?.open === true
			? "the created window reports open: true"
			: `answered ${show(byTag.get("childopen"))}`,
	);

	const childTitle = resolved(byTag.get("childtitle"));
	const childTitleOk = childTitle?.ok === true && childTitle?.title === "Relative titled";
	verdict.check(
		"child title",
		childTitleOk,
		childTitleOk
			? `applied and read back ${JSON.stringify(childTitle?.title)}`
			: `answered ${show(byTag.get("childtitle"))}`,
	);

	const childClose = resolved(byTag.get("childclose"));
	const childCloseOk = childClose?.ok === true && childClose?.closed === true;
	verdict.check(
		"child close",
		childCloseOk,
		childCloseOk ? `answered ${show(childClose)}` : `answered ${show(byTag.get("childclose"))}`,
	);

	const childGone = goneAnswer(byTag.get("childgone"));
	verdict.check(
		"child gone",
		childGone,
		childGone
			? `answered ${show(resolved(byTag.get("childgone")))}`
			: `answered ${show(byTag.get("childgone"))}`,
	);

	const absClose = resolved(byTag.get("absclose"));
	const absCloseOk = absClose?.ok === true && absClose?.closed === true;
	verdict.check(
		"absolute close",
		absCloseOk,
		absCloseOk ? `answered ${show(absClose)}` : `answered ${show(byTag.get("absclose"))}`,
	);

	const absGone = goneAnswer(byTag.get("absgone"));
	verdict.check(
		"absolute gone",
		absGone,
		absGone
			? `answered ${show(resolved(byTag.get("absgone")))}`
			: `answered ${show(byTag.get("absgone"))}`,
	);

	// Closed is closed: the two windows the app was configured with are all that
	// is left, so a created window does not linger in the platform's map.
	const tidiedOk = sameLabels(byTag.get("tidied"), ["main", "other"]);
	verdict.check(
		"tidy",
		tidiedOk,
		tidiedOk
			? `labels ${show(labelsOf(byTag.get("tidied")))} after both children closed`
			: `list answered ${show(byTag.get("tidied"))}`,
	);

	// ---- 11. close: state changes, and the last close ends the app ---------
	const closeMain = resolved(byTag.get("closemain"));
	const closed = closeMain?.ok === true && closeMain?.closed === true;
	verdict.check(
		"close main",
		closed,
		closed ? `answered ${show(closeMain)}` : `answered ${show(byTag.get("closemain"))}`,
	);

	// The platform reports only windows AppKit still holds, so a closed label is
	// already out of `list` — and the plugin answers from `list` first. The page's
	// observable is therefore the typed failure, not `open: false`.
	const mainAfter = byTag.get("mainafter");
	const notOpen = goneAnswer(mainAfter);
	verdict.check(
		"isOpen closed",
		notOpen,
		notOpen ? `answered ${show(resolved(mainAfter))}` : `answered ${show(mainAfter)}`,
	);

	// Closing one window is not "all closed": the other one keeps the app up, which
	// is what makes the next close the thing that ends it.
	const otherStill = resolved(byTag.get("otherstill"));
	const otherUp = otherStill?.open === true;
	verdict.check(
		"other still",
		otherUp,
		otherUp
			? "other still reports open: true while main is closed"
			: `answered ${show(byTag.get("otherstill"))}`,
	);

	// ---- 12. create: a released label comes back, a live one is refused -----
	// `list` stops reporting a closed label immediately, so the page only has to
	// confirm it: the label is reusable, and `create` is what drops the platform's
	// stale entry for it (a tracked-but-closed label makes `createWindow` throw
	// "already exists"). A label still open is refused instead — nothing released.
	const released = byTag.get("released");
	const releasedOk = released?.how === "resolved" && released?.value === true;
	verdict.check(
		"released",
		releasedOk,
		releasedOk
			? "the closed label left the platform's list before create"
			: `page saw ${show(released)}`,
	);

	const recreated = resolved(byTag.get("recreate"));
	const recreateOk =
		recreated?.ok === true && recreated?.created === true && recreated?.label === "main";
	verdict.check(
		"recreate",
		recreateOk,
		recreateOk
			? `answered ${show(recreated)} — the released label was reusable`
			: `page saw ${show(byTag.get("recreate"))}`,
	);

	// The re-created label loads its document again: the window's own page ran,
	// and its own invoke found the window open under the same label. Without a
	// fresh page there would be no `child.main` report at all.
	const reopenChild = childReport(byTag.get("child.main"));
	const reopenOrigin = reopenChild === undefined ? undefined : originOf(reopenChild.href);
	const reopenPage = resolved(reopenChild?.open);
	const reopenLoadsOk =
		reopenOrigin !== undefined &&
		reopenChild?.href === `${reopenOrigin}/spare/child/main` &&
		reopenPage?.ok === true &&
		reopenPage?.label === "main" &&
		reopenPage?.open === true;
	verdict.check(
		"reopen loads",
		reopenLoadsOk,
		reopenLoadsOk
			? `the reused label loaded ${JSON.stringify(reopenChild?.href)} and its page invokes ` +
					`back ${show(reopenPage)}`
			: `page saw ${show(byTag.get("child.main"))}`,
	);

	const relist = resolved(byTag.get("relist"));
	const relabels = relist?.labels;
	const relistOk =
		Array.isArray(relabels) &&
		relabels.length === 2 &&
		relabels.includes("main") &&
		relabels.includes("other");
	verdict.check(
		"relist",
		relistOk,
		relistOk ? `labels ${show(relabels)}` : `list answered ${show(byTag.get("relist"))}`,
	);

	const reopenOpen = resolved(byTag.get("reopenopen"));
	verdict.check(
		"reopen open",
		reopenOpen?.open === true,
		reopenOpen?.open === true
			? "the re-created window reports open: true"
			: `answered ${show(byTag.get("reopenopen"))}`,
	);

	const reopenTitle = resolved(byTag.get("reopenset"));
	const reopenTitleOk = reopenTitle?.ok === true && reopenTitle?.title === "Reopened and titled";
	verdict.check(
		"reopen title",
		reopenTitleOk,
		reopenTitleOk
			? `applied and read back ${JSON.stringify(reopenTitle?.title)}`
			: `answered ${show(byTag.get("reopenset"))}`,
	);

	// A live label is refused before anything is released, so the window a page
	// already holds cannot be replaced behind its back.
	const duplicate = resolved(byTag.get("dup"));
	const duplicateOk = duplicate?.ok === false && duplicate?.code === "duplicate-label";
	verdict.check(
		"duplicate",
		duplicateOk,
		duplicateOk
			? `create on a live label answered ${show(duplicate)}`
			: `page saw ${show(byTag.get("dup"))}`,
	);

	// Nothing was created either: a refused create must not leave an entry behind
	// under the label it was refused for.
	const dupListOk = sameLabels(byTag.get("duplist"), ["main", "other"]);
	verdict.check(
		"duplicate list",
		dupListOk,
		dupListOk
			? `labels ${show(labelsOf(byTag.get("duplist")))} — unchanged`
			: `list answered ${show(byTag.get("duplist"))}`,
	);

	const dupAfter = resolved(byTag.get("dupafter"));
	verdict.check(
		"duplicate kept",
		dupAfter?.open === true,
		dupAfter?.open === true
			? "the refused label's window is still open — nothing was released"
			: `answered ${show(byTag.get("dupafter"))}`,
	);

	// A label that never existed: created, found by `list`/`isOpen`, titled, closed.
	const created = resolved(byTag.get("create"));
	const createOk =
		created?.ok === true && created?.created === true && created?.label === "spawn";
	verdict.check(
		"create",
		createOk,
		createOk ? `answered ${show(created)}` : `page saw ${show(byTag.get("create"))}`,
	);

	const lists = resolved(byTag.get("lists"));
	const spawnLabels = lists?.labels;
	const listsOk =
		Array.isArray(spawnLabels) &&
		spawnLabels.length === 3 &&
		spawnLabels.includes("main") &&
		spawnLabels.includes("other") &&
		spawnLabels.includes("spawn");
	verdict.check(
		"list after create",
		listsOk,
		listsOk ? `labels ${show(spawnLabels)}` : `list answered ${show(byTag.get("lists"))}`,
	);

	const spawnOpen = resolved(byTag.get("spawnopen"));
	verdict.check(
		"spawn open",
		spawnOpen?.open === true,
		spawnOpen?.open === true
			? "the created window reports open: true"
			: `answered ${show(byTag.get("spawnopen"))}`,
	);

	const spawnTitle = resolved(byTag.get("spawnset"));
	const spawnTitleOk = spawnTitle?.ok === true && spawnTitle?.title === "Spawn titled";
	verdict.check(
		"spawn title",
		spawnTitleOk,
		spawnTitleOk
			? `applied and read back ${JSON.stringify(spawnTitle?.title)}`
			: `answered ${show(byTag.get("spawnset"))}`,
	);

	const spawnClose = resolved(byTag.get("spawnclose"));
	const spawnCloseOk = spawnClose?.ok === true && spawnClose?.closed === true;
	verdict.check(
		"spawn close",
		spawnCloseOk,
		spawnCloseOk ? `answered ${show(spawnClose)}` : `answered ${show(byTag.get("spawnclose"))}`,
	);

	const spawnGone = goneAnswer(byTag.get("spawngone"));
	verdict.check(
		"spawn gone",
		spawnGone,
		spawnGone
			? `answered ${show(resolved(byTag.get("spawngone")))}`
			: `answered ${show(byTag.get("spawngone"))}`,
	);

	// Refused arguments, not clamped or coerced: no window is built for either, so
	// neither label is in the platform's map afterwards.
	const badSize = resolved(byTag.get("badsize"));
	const badSizeOk = badSize?.ok === false && badSize?.code === "invalid-size";
	verdict.check(
		"bad size",
		badSizeOk,
		badSizeOk ? `answered ${show(badSize)}` : `page saw ${show(byTag.get("badsize"))}`,
	);

	// A size a cast would have rounded is refused too, not turned into a window.
	const badFraction = resolved(byTag.get("badfraction"));
	const badFractionOk = badFraction?.ok === false && badFraction?.code === "invalid-size";
	verdict.check(
		"bad fraction",
		badFractionOk,
		badFractionOk
			? `answered ${show(badFraction)}`
			: `page saw ${show(byTag.get("badfraction"))}`,
	);

	const badUrl = resolved(byTag.get("badurl"));
	const badUrlOk = badUrl?.ok === false && badUrl?.code === "invalid-url";
	verdict.check(
		"bad url",
		badUrlOk,
		badUrlOk ? `answered ${show(badUrl)}` : `page saw ${show(byTag.get("badurl"))}`,
	);

	// Every refused label was refused before a window existed: none of the three
	// is in the platform's map, and the two configured labels are untouched.
	const refusedList = labelsOf(byTag.get("reflist"));
	const refusedOk =
		sameLabels(byTag.get("reflist"), ["main", "other"]) &&
		refusedList !== undefined &&
		!refusedList.includes("tiny") &&
		!refusedList.includes("fraction") &&
		!refusedList.includes("nowhere");
	verdict.check(
		"refused nothing",
		refusedOk,
		refusedOk
			? `labels ${show(refusedList)} — no window was built for a refused argument`
			: `list answered ${show(byTag.get("reflist"))}`,
	);

	const closeAgain = resolved(byTag.get("closeagain"));
	const closeAgainOk = closeAgain?.ok === true && closeAgain?.closed === true;
	verdict.check(
		"close again",
		closeAgainOk,
		closeAgainOk ? `answered ${show(closeAgain)}` : `answered ${show(byTag.get("closeagain"))}`,
	);

	const mainGone = goneAnswer(byTag.get("maingone"));
	verdict.check(
		"close again gone",
		mainGone,
		mainGone
			? `answered ${show(resolved(byTag.get("maingone")))}`
			: `answered ${show(byTag.get("maingone"))}`,
	);

	// ---- 13. the app ended itself, having run window-all-closed -------------
	const closedLine = run.stdout.match(ALL_CLOSED)?.[0] ?? null;
	verdict.check(
		"all closed",
		closedLine !== null,
		closedLine !== null
			? `the backend printed ${JSON.stringify(closedLine.trim())}`
			: `window-all-closed never ran — ${exitLine}`,
	);

	const cleanExit = run.ended === "exit" && run.code === 0 && !run.timedOut;
	verdict.check(
		"exit 0",
		cleanExit,
		cleanExit
			? `the app exited 0 on its own after ${seconds(run.exitMs)}`
			: `${exitLine}${run.ended === "match" ? `, stopped on ${JSON.stringify(run.matched)}` : ""}`,
	);

	// ---- 14. nothing is left running ---------------------------------------
	const survivors = await survivorsOf(binary);
	verdict.check(
		"no survivors",
		survivors.length === 0,
		survivors.length === 0
			? "no process matches the binary path"
			: `pid ${survivors.join(", ")} still running`,
	);

	return binary;
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the scratch tree is removed in `main`, and the
	// reason is printed rather than buried in a stack trace.
	console.log(`e2e-window: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
