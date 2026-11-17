/**
 * The live sweep: the Butter-mapped plugin commands, driven against the **real** darwin platform,
 * asserting each answers something other than `not-implemented`.
 *
 * The coverage table is a document, and a document can be wrong. This wave proved that twice — a
 * `same` row whose native setter did not exist, and a hand-written name list that re-tested its own
 * assumptions. So the claim here is "the command ran on this machine and did not refuse", which is
 * the one answer a hollow row cannot produce.
 *
 * **The sweep runs in a child process.** Starting AppKit installs the main menu and marks the process
 * as having a running app, and two other suites assert the opposite (`menu.test.ts` wants no menu,
 * `shim.test.ts` wants "nothing yet, no sheet"). Driving it in-process made `shim.test.ts` fail only
 * under a full-suite run — a leak between test files, which is the same defect as module state
 * nobody clears.
 */
import { describe, expect, test } from "bun:test";

const REPO = new URL("..", import.meta.url).pathname;

/** What the child prints per command: one JSON line, `{"command":…,"refusal":bool}`. */
interface Line {
	command: string;
	refusal: boolean;
}

/**
 * The child's own script. It builds the platform, a live window, the tray and the navigation
 * plugins, and prints the answer for every command the coverage table names for those two. The
 * command list comes from `Object.keys(commands)` at run time, so a command added or removed moves
 * the sweep with it.
 */
const SWEEP = `
import { DarwinPlatform } from "./src/platform/darwin/platform.ts";
import { darwinNavigationAdapter } from "./src/platform/darwin/navigation.ts";
import { createStatusBar } from "./src/platform/darwin/status-bar-item.ts";
import { createTrayPlugin } from "./src/plugins/tray.ts";
import { createNavigationPlugin } from "./src/plugins/navigation.ts";

const isRefusal = (answer) => {
  if (typeof answer !== "object" || answer === null) return false;
  if (answer.code === "not-implemented") return true;
  return answer.code === undefined && typeof answer.message === "string" && answer.requires !== undefined;
};

const platform = new DarwinPlatform({ appName: "crust-butter-sweep", activate: "never" });
await platform.start();
platform.createWindow({ label: "main", title: "sweep", url: "about:blank", width: 320, height: 200 });
platform.pump(16);
// The webview is built on the platform's own queue; without this a webview command answers
// "no window" and would read like a gap rather than a wait.
await Bun.sleep(400);

const bar = createStatusBar();
const ctx = { emit: () => {} };
const tray = createTrayPlugin(bar);
const nav = createNavigationPlugin(darwinNavigationAdapter((l) => platform.webview(l ?? "main") ?? null));

const args = {
  setTitle: { text: "sweep" },
  setTooltip: { text: "hover" },
  show: {},
  hide: {},
  start: {},
  state: {},
  loadUrl: { url: "about:blank?native=proof" },
};

for (const [name, handler] of Object.entries(tray.commands)) {
  if (!(name in args)) continue;
  const answer = await handler(args[name]);
  console.log(JSON.stringify({ command: "tray." + name, refusal: isRefusal(answer) }));
}
for (const [name, handler] of Object.entries(nav.commands)) {
  if (!(name in args)) continue;
  const answer = await handler(args[name], ctx);
  console.log(JSON.stringify({ command: "navigation." + name, refusal: isRefusal(answer) }));
}

bar.destroy();
platform.stopPump();
process.exit(0);
`;

describe("butter sweep — the mapped commands run, none refuse", () => {
	test("every tray and navigation command answers without not-implemented", async () => {
		const child = Bun.spawn(["bun", "-e", SWEEP], {
			cwd: REPO,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, CRUST_TEST_CHILD: "1" },
		});
		const out = await new Response(child.stdout).text();
		await child.exited;

		const lines: Line[] = out
			.split("\n")
			.filter((line) => line.startsWith("{"))
			.map((line) => JSON.parse(line) as Line);

		// Every command must have reported, and none may have refused. An empty list would otherwise
		// pass the "no refusals" check by driving nothing.
		expect(lines.map((line) => line.command).sort()).toEqual([
			"navigation.loadUrl",
			"navigation.start",
			"navigation.state",
			"tray.hide",
			"tray.setTitle",
			"tray.setTooltip",
			"tray.show",
		]);
		for (const line of lines) {
			expect({ command: line.command, refusal: line.refusal }).toEqual({
				command: line.command,
				refusal: false,
			});
		}
		expect(child.exitCode).toBe(0);
	}, 40_000);
});
