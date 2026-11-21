/**
 * E2E for `crust:browser` on macOS: a real second WKWebView inside a real window, a local
 * `Bun.serve` page it loads, and the app's own page driving the plugin as an app would.
 *
 * Five facts are proved here and nowhere else: `state` reads the remote document's title; a
 * `window.capture` sees the surface before and after `setBounds`; an origin outside `browser.origins`
 * is refused by name; `window.open` creates no second webview and its URL reaches the opener; and the
 * capture denial stops `getUserMedia` before it can raise TCC (the remote page reports it by title).
 *
 * The app is launched as the runtime itself, from the scratch project in `browser/fixture.ts`, so
 * nothing is built and the code under test is the checkout.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { guardFocus, probe, restoreFocus, Verdict } from "./e2e-harness.ts";
import {
	configSource,
	MAIN_SOURCE,
	pageSource,
	POPUP_PAGE,
	REMOTE_PAGE,
} from "./browser/fixture.ts";

const REPO = resolve(import.meta.dir, "..");
const RUNTIME = join(REPO, "src/runtime.ts");
const APP_TIMEOUT_MS = 30_000;

/** The value a page-reported line carries after its tag: `page  capture first 60000` → `60000`. */
function value(stdout: string, tag: string): string | undefined {
	const prefix = `${tag} `;
	const line = stdout
		.split("\n")
		.map((entry) => entry.replace(/^\s*page\s+/, ""))
		.find((entry) => entry.startsWith(prefix));
	return line?.slice(prefix.length).trim();
}

function count(text: string | undefined): number {
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : 0;
}

/** `1200x840 57424` → `[1200, 840]`. */
function shotSize(text: string): [number, number] {
	const match = text.match(/^(\d+)x(\d+)/);
	return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(`e2e-browser: SKIP  the surface is macOS-only; running ${process.platform}`);
		return 1;
	}
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			const body = path === "/popup" ? POPUP_PAGE : path === "/" ? REMOTE_PAGE : undefined;
			return body === undefined
				? new Response("not found", { status: 404 })
				: new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
		},
	});
	const origin = `http://127.0.0.1:${server.port}`;
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-browser-"));
	const frontmost = guardFocus();
	const verdict = new Verdict();
	try {
		await mkdir(join(scratch, "public"), { recursive: true });
		// The example imports `crust`, which resolves through the checkout's exports map; a scratch
		// copy has no install, so one symlink stands in — `scripts/window/sandbox.ts` does the same.
		await mkdir(join(scratch, "node_modules"), { recursive: true });
		await symlink(REPO, join(scratch, "node_modules", "crust"), "dir");
		await writeFile(join(scratch, "crust.config.ts"), configSource(origin), "utf8");
		await writeFile(join(scratch, "main.ts"), MAIN_SOURCE, "utf8");
		await writeFile(join(scratch, "public", "index.html"), pageSource(origin), "utf8");

		const run = await probe({
			command: [
				process.execPath,
				RUNTIME,
				"--config",
				"crust.config.ts",
				"--entry",
				"main.ts",
			],
			cwd: scratch,
			match: /page\s+done/,
			timeoutMs: APP_TIMEOUT_MS,
		});
		if (run.matched === null) console.log(`${run.stdout}\n${run.stderr}`);
		const stdout = run.stdout;

		const open = value(stdout, "open");
		verdict.check(
			"open",
			open?.includes('"ok":true') === true,
			`browser.open → ${open ?? "no answer"}`,
		);
		verdict.check(
			"state title",
			value(stdout, "state") === "Remote Title",
			`title = ${value(stdout, "state") ?? "none"}`,
		);
		const first = count(value(stdout, "capture first"));
		const second = count(value(stdout, "capture second"));
		const shot1 = value(stdout, "shot first") ?? "";
		const shot2 = value(stdout, "shot second") ?? "";
		const [w1, h1] = shotSize(shot1);
		const [w2, h2] = shotSize(shot2);
		verdict.check(
			"setBounds moved",
			w1 > w2 && h1 > h2 && w2 > 0 && shot1 !== shot2,
			`browser.capture ${shot1} → ${shot2}; window.capture png ${first} → ${second}`,
		);
		const refused = value(stdout, "refused") ?? "";
		verdict.check(
			"origin refused",
			refused.includes('"code":"bad-request"') && refused.includes("not-allowed.test"),
			`foreign origin → ${refused || "no answer"}`,
		);
		verdict.check(
			"capture denied",
			(value(stdout, "capture-denied") ?? "").includes("NotAllowedError"),
			`getUserMedia → ${value(stdout, "capture-denied") ?? "no answer"}`,
		);
		const popup = value(stdout, "popup") ?? "";
		verdict.check(
			"popup to opener",
			popup.includes('"handedToOpener":true') && popup.includes("/popup"),
			`window.open → ${popup || "no event"}`,
		);
		const windows = value(stdout, "windows") ?? "0";
		verdict.check("one window", windows === "1", `window.list length ${windows}`);
		verdict.check(
			"close",
			(value(stdout, "close") ?? "").includes('"closed":true'),
			`browser.close → ${value(stdout, "close") ?? "no answer"}`,
		);
		verdict.check("done", run.matched !== null, run.matched ?? `no proving line; ${run.ended}`);
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
		server.stop(true);
		await restoreFocus(frontmost);
	}
	return verdict.report("e2e-browser");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-browser: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
