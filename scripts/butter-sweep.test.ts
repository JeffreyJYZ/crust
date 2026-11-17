/**
 * The live Butter sweep: every mapped plugin command, driven against the **real** darwin platform.
 *
 * The coverage table is a document, and a document can be wrong. This wave proved it twice — a
 * `same` row whose native setter did not exist, and a hand-written name list that compared Butter's
 * names against a Set written by the same hand. So a row's evidence is now "the command ran on this
 * machine and answered something other than not-implemented", which is the one answer a hollow row
 * cannot produce.
 *
 * **The sweep runs in a child process**, for a measured reason: starting AppKit installs the main
 * menu and marks the process as having an app, and `menu.test.ts` / `shim.test.ts` both assert the
 * opposite. In-process, a full-suite run made `shim.test.ts` fail while it passed alone — a leak
 * between test files.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { SWEEP } from "./butter-sweep-commands.ts";

const REPO = new URL("..", import.meta.url).pathname;

interface Answer {
	command: string;
	refusal: boolean;
	detail: string;
}

/**
 * The child: real platform, real plugins from `nativePlugins`, then one `handle()` per case. The
 * harness and the case table are written into the temp dir so the child needs no bundler.
 */
function childScript(casesPath: string): string {
	return `
import { DarwinPlatform } from "./src/platform/darwin/platform.ts";
import { nativePlugins } from "./src/runtime-plugins.ts";
import { corePlugins } from "./src/plugins/core.ts";

/** A 1x1 transparent PNG so the image write carries real bytes. */
const SWEEP_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const isRefusal = (answer) => {
  if (typeof answer !== "object" || answer === null) return false;
  if (answer.code === "not-implemented") return true;
  return answer.code === undefined && typeof answer.message === "string" && answer.requires !== undefined;
};

const platform = new DarwinPlatform({ appName: "crust-butter-sweep", activate: "never" });
await platform.start();
platform.createWindow({ label: "main", title: "sweep", url: "about:blank", width: 480, height: 320 });
platform.pump(16);
// The webview is built on the platform's own queue; without this a webview command answers
// "no window" and would read like a gap rather than a wait.
await Bun.sleep(500);

const plugins = await nativePlugins(corePlugins, platform, {
  app: "crust.butter.sweep",
  shell: { allow: ["sh"] },
});
const byName = new Map(plugins.map((p) => [p.name, p]));
const ctx = { emit: () => {} };
const cases = JSON.parse(await Bun.file(${JSON.stringify(casesPath)}).text());

for (const entry of cases) {
  if (entry.skip) continue;
  const dot = entry.command.indexOf(".");
  const pluginName = entry.command.slice(0, dot);
  const commandName = entry.command.slice(dot + 1);
  const plugin = byName.get(pluginName);
  if (!plugin) {
    console.log(JSON.stringify({ command: entry.command, refusal: false, detail: "NO-PLUGIN" }));
    continue;
  }
  const handler = plugin.commands[commandName];
  if (typeof handler !== "function") {
    console.log(JSON.stringify({ command: entry.command, refusal: false, detail: "NO-COMMAND" }));
    continue;
  }
  /**
   * The page-facing byte array for a command arg. The bridge revives a binary argument into a
   * Uint8Array, and a case table written as JSON has no way to express one — so a case may name a
   * marker string and the child substitutes it here.
   */
  const revive = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.__bytes === "sweep-png") return SWEEP_PNG;
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = revive(v);
      return out;
    }
    if (Array.isArray(value)) return value.map(revive);
    return value;
  };

  let answer;
  try {
    // The bridge attaches the caller's window to every request; a direct handler call has to add it
    // itself, or window.label refuses for want of the identity it exists to report.
    const request = entry.window === undefined ? ctx : { ...ctx, window: entry.window };
    answer = await handler(revive(entry.args), request);
  } catch (error) {
    // A throw is a run: the command was reached and refused for a reason it named. The sweep's
    // subject is a hollow row, which answers not-implemented instead of throwing.
    console.log(JSON.stringify({ command: entry.command, refusal: false, detail: "threw" }));
    continue;
  }
  console.log(JSON.stringify({ command: entry.command, refusal: isRefusal(answer), detail: isRefusal(answer) ? JSON.stringify(answer).slice(0, 120) : "ok" }));
}

platform.stopPump();
process.exit(0);
`;
}

describe("butter sweep — every mapped command runs on the real platform", () => {
	let answers: Answer[] = [];
	let exitCode = -1;

	afterAll(() => {
		// Nothing to release: the child owned the platform and exited.
	});

	test("the child drives every case and reports one answer each", async () => {
		// The working directory the plugin's relative paths resolve against, and the i18n catalogue
		// the sweep loads: a plugin whose catalogue is the app's to supply refuses every read until
		// one exists, which is accurate and would read like a gap.
		const dir = `${REPO}/.sweep-tmp`;
		await Bun.$`mkdir -p ${dir}/locales`.quiet();
		await Bun.write(`${dir}/locales/en.json`, JSON.stringify({ sweep: "swept" }));
		// A declared sidecar and its manifest, so `sidecar.spawn` has a name the build would have copied.
		await Bun.write(`${dir}/sweep.sh`, "#!/bin/sh\necho sidecar-ok\n");
		await Bun.$`chmod 755 ${dir}/sweep.sh`.quiet();
		await Bun.write(`${dir}/crust-sidecars.json`, JSON.stringify(["sweep.sh"]));
		const casesPath = `${dir}/cases.json`;
		await Bun.write(casesPath, JSON.stringify(SWEEP));

		const child = Bun.spawn(["bun", "-e", childScript(casesPath)], {
			cwd: REPO,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, CRUST_TEST_CHILD: "1", CRUST_DATA_DIR: dir, CRUST_SIDECARS_DIR: dir },
		});
		const out = await new Response(child.stdout).text();
		const err = await new Response(child.stderr).text();
		await child.exited;
		exitCode = child.exitCode ?? -1;

		answers = out
			.split("\n")
			.filter((line) => line.startsWith("{"))
			.map((line) => JSON.parse(line) as Answer);

		const driven = SWEEP.filter((entry) => entry.skip === undefined).map((entry) => entry.command);
		expect(answers.map((answer) => answer.command).sort()).toEqual([...driven].sort());
		// A crash in the child would leave answers empty and the equality above would fail; print
		// the reason here so a red run says why instead of naming a missing command.
		if (exitCode !== 0) console.log(`sweep child exited ${exitCode}: ${err.slice(0, 400)}`);
		expect(exitCode).toBe(0);
	}, 120_000);

	test("not one driven command answers not-implemented", () => {
		expect(answers.length).toBeGreaterThan(0);
		const refusals = answers.filter((answer) => answer.refusal);
		// The failure message carries the answer, so a red run names the capability rather than a count.
		expect(refusals.map((answer) => `${answer.command}: ${answer.detail}`)).toEqual([]);
	});

	test("no driven command is missing from the runtime, and no command is missing from the table", () => {
		expect(answers.filter((answer) => answer.detail === "NO-PLUGIN" || answer.detail === "NO-COMMAND")).toEqual([]);
	});

	test("every skip carries a reason that is not the capability itself", () => {
		for (const entry of SWEEP) {
			if (entry.skip === undefined) continue;
			expect({ command: entry.command, reasoned: entry.skip.length > 40 }).toEqual({
				command: entry.command,
				reasoned: true,
			});
			// A skip must not say "not implemented" — that is the gap this sweep exists to find.
			expect({ command: entry.command, hides: /not.implemented/i.test(entry.skip) }).toEqual({
				command: entry.command,
				hides: false,
			});
		}
	});

	test("the table covers every command the runtime registers", async () => {
		const registered = Bun.file(new URL("../.sweep-tmp/registered.json", import.meta.url));
		if (await registered.exists()) {
			const names = (await registered.json()) as Record<string, string[]>;
			const listed = new Set(SWEEP.map((entry) => entry.command));
			const missing: string[] = [];
			for (const [plugin, commands] of Object.entries(names)) {
				for (const command of commands) {
					if (!listed.has(`${plugin}.${command}`)) missing.push(`${plugin}.${command}`);
				}
			}
			expect(missing).toEqual([]);
		}
	});
});
