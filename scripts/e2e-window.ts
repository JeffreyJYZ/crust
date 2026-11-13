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
 * not the same one under another name. The page calls every command through
 * `window.crust.invoke` and reports each answer to the backend, which prints it:
 * one stream then holds the page's observables and this process's own lines, and
 * the count of those report lines is an assertion — a page that never ran cannot
 * pass by exiting 0 with an empty log.
 *
 * What the page sees is asserted as measured, not as intended. An unknown label
 * is a *resolved* `{ ok: false, code: "unknown-window" }`, because the plugin
 * converts the adapter's throw; a *rejected* invoke is what an unknown command
 * produces. Both shapes are pinned below, so the difference cannot drift
 * silently.
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
 * The two windows: `main` serves the driver page, `other` is a second label a
 * page can focus and close. Two windows is the point — `focus` on a different
 * label must reach a different `NSWindow`, not the same one renamed.
 */
const CONFIG_SOURCE = `import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.e2e-window", name: ${JSON.stringify(APP_NAME)}, version: "0.1.0" },
	windows: [
		{ label: "main", url: "/", width: 900, height: 640, title: ${JSON.stringify(APP_NAME)} },
		{ label: "other", url: "/idle.html", width: 420, height: 280, title: "Idle" },
	],
} satisfies CrustConfig;
`;

/**
 * The backend. `report` is the page's channel: one line per window answer, on
 * this process's stdout, which is the log the proof reads. `window-all-closed`
 * is what must run after the page closes the second window.
 */
const MAIN_SOURCE = `import { app } from "crust";

app.command("report", (args) => {
	const line = typeof args.line === "string" ? args.line : "";
	console.log(\`  page      \${line}\`);
	return "printed";
});

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

/** The second window's page: served, alive, and deliberately script-free. */
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
	await report("closemain", await ask("window", "close", { label: "main" }));
	await report("mainafter", await ask("window", "isOpen", { label: "main" }));
	await report("otherstill", await ask("window", "isOpen", { label: "other" }));
	await report("closing", { how: "resolved", value: "close other" });
	await ask("window", "close", { label: "other" });
}

main().catch(function (error) {
	// A driver that throws must not look like a quiet pass: one more line, and
	// the count assertion fails with this reason beside it.
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
	"closemain",
	"mainafter",
	"otherstill",
	"closing",
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

/** Two windows plus WebKit's web processes and the shim compile; measured ~2 s. */
const APP_TIMEOUT_MS = 25_000;

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

/** A short, single-line form of anything, for a verdict detail. */
function show(value: unknown): string {
	let text: string;
	try {
		text = typeof value === "string" ? value : JSON.stringify(value);
	} catch {
		text = String(value);
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
	await writeFile(join(scratch, "crust.config.ts"), CONFIG_SOURCE, "utf8");
	await writeFile(join(scratch, "main.ts"), MAIN_SOURCE, "utf8");
	await writeFile(join(scratch, "public", "index.html"), INDEX_SOURCE, "utf8");
	await writeFile(join(scratch, "public", "app.js"), PAGE_SOURCE, "utf8");
	await writeFile(join(scratch, "public", "idle.html"), IDLE_SOURCE, "utf8");
	return join(scratch, "dist", `${APP_NAME}.app`, "Contents", "MacOS", BINARY_NAME);
}

async function proof(verdict: Verdict, scratch: string): Promise<string | undefined> {
	const binary = await sandbox(scratch);
	const bundle = join(scratch, "dist", `${APP_NAME}.app`);

	// ---- 1. build through the CLI, as a user runs it ------------------------
	const build = await runCommand(["bun", "run", CLI, "build", "--dir", scratch], REPO_ROOT);
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
		for (const name of [
			"bundle",
			"binary",
			"codesign",
			"page lines",
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
			"close main",
			"isOpen closed",
			"other still",
			"all closed",
			"exit 0",
			"no survivors",
		]) {
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
	const missing = EXPECTED_TAGS.filter((tag) => !byTag.has(tag));
	const extra = answers.filter(
		(entry) => !(EXPECTED_TAGS as readonly string[]).includes(entry.tag),
	);
	const complete = missing.length === 0 && extra.length === 0;
	const countOk = verdict.check(
		"page lines",
		complete,
		complete
			? `${answers.length} answers, one per step, from ${EXPECTED_TAGS.length} steps`
			: `${answers.length} page answers — ` +
					`${missing.length > 0 ? `missing ${missing.join(", ")}` : "none missing"}` +
					`${extra.length > 0 ? `, unexpected ${extra.map((entry) => entry.tag).join(", ")}` : ""}` +
					` — ${exitLine}`,
	);
	if (!countOk) {
		const why = `not checked — the page did not report every step (${exitLine})`;
		for (const name of [
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
			"close main",
			"isOpen closed",
			"other still",
			"all closed",
			"exit 0",
			"no survivors",
		]) {
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

	// ---- 11. close: state changes, and the last close ends the app ---------
	const closeMain = resolved(byTag.get("closemain"));
	const closed = closeMain?.ok === true && closeMain?.closed === true;
	verdict.check(
		"close main",
		closed,
		closed ? `answered ${show(closeMain)}` : `answered ${show(byTag.get("closemain"))}`,
	);

	// `window-all-closed` polls every 250 ms and prunes a closed label from the
	// platform's map, so the answer here is either "not open" or "no such window"
	// — both mean closed. The measured shape is recorded rather than assumed; the
	// prune window is sub-millisecond against a 250 ms tick, so `open: false` is
	// what a run normally sees.
	const mainAfter = byTag.get("mainafter");
	const afterValue = resolved(mainAfter);
	const notOpen =
		(afterValue?.ok === true && afterValue?.open === false) ||
		(afterValue?.ok === false && afterValue?.code === "unknown-window");
	verdict.check(
		"isOpen closed",
		notOpen,
		notOpen ? `answered ${show(afterValue)}` : `answered ${show(mainAfter)}`,
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

	// ---- 12. the app ended itself, having run window-all-closed -------------
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

	// ---- 13. nothing is left running ---------------------------------------
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
