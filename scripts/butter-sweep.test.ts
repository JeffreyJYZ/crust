/**
 * The live Butter sweep: every mapped plugin command, driven against the **real** darwin platform.
 * A row's evidence is "the command ran here and did not refuse", which is what a hollow row cannot
 * produce — the coverage table has been wrong twice, so the table is not the proof.
 *
 * The sweep runs in a child process: starting AppKit installs the main menu, and `menu.test.ts` /
 * `shim.test.ts` both assert a process without one. In-process, a full-suite run made `shim.test.ts`
 * fail while it passed alone — a leak between test files.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { SWEEP } from "./butter-sweep-commands.ts";
import { childScript } from "./butter-sweep-helpers.ts";
import { captureFrontmost, restoreFocus } from "./harness/focus.ts";

const REPO = new URL("..", import.meta.url).pathname;

interface Answer {
	command: string;
	refusal: boolean;
	detail: string;
	/** Set only when AX could not list windows after the child re-activated and retried. */
	frontmostLost?: boolean;
	/** The AX refusal text behind a frontmost-lost report, so the run says what actually answered. */
	report?: string;
}

describe("butter sweep — every mapped command runs on the real platform", () => {
	let answers: Answer[] = [];
	let exitCode = -1;

	afterAll(() => {
		// Focus is restored in the spawn test's finally, which also covers a child crash.
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

		// The child starts a real AppKit platform with activate: "always", so it takes focus.
		// Capture before it launches; the parent restores after it exits, because the child is a
		// separate process and cannot hand focus back for itself (not even on a crash).
		const frontmost = await captureFrontmost();
		console.log(`frontmost before sweep child: ${frontmost ?? "(none)"}`);
		let out = "";
		let err = "";
		try {
			const child = Bun.spawn(["bun", "-e", childScript(casesPath)], {
				cwd: REPO,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					CRUST_TEST_CHILD: "1",
					CRUST_DATA_DIR: dir,
					CRUST_SIDECARS_DIR: dir,
				},
			});
			out = await new Response(child.stdout).text();
			err = await new Response(child.stderr).text();
			await child.exited;
			exitCode = child.exitCode ?? -1;
		} finally {
			await restoreFocus(frontmost);
			// `open -a` returns before activation settles; let the app come forward, then read it back.
			await Bun.sleep(200);
			const after = await captureFrontmost();
			console.log(`frontmost after sweep child:  ${after ?? "(none)"}`);
		}

		answers = out
			.split("\n")
			.filter((line) => line.startsWith("{"))
			.map((line) => JSON.parse(line) as Answer);

		const driven = SWEEP.filter((entry) => entry.skip === undefined).map(
			(entry) => entry.command,
		);
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

	test("a frontmost-lost AX answer is reported, never silently counted as a pass", () => {
		const lost = answers.filter((answer) => answer.frontmostLost);
		for (const answer of lost) {
			expect(answer.command).toBe("accessibility.elementCount");
			expect(answer.detail).toBe("frontmost-lost");
			// The report carries the refusal text, so a red run names what AX actually answered.
			expect((answer.report ?? "").includes("AX listed no windows")).toBe(true);
			expect(answer.refusal).toBe(false);
		}
		// An unmarked no-windows refusal would otherwise read as an ordinary refusal and get lost in
		// the count, so demand that every one of them carries the environment marker.
		expect(
			answers
				.filter((a) => !a.frontmostLost && a.detail.includes("AX listed no windows"))
				.map((a) => a.command),
		).toEqual([]);
		// Re-activation is a retry, not an excuse: the row is proven only when a count came back.
		const count = answers.find((answer) => answer.command === "accessibility.elementCount");
		expect({ detail: count?.detail, lost: count?.frontmostLost ?? false }).toEqual({
			detail: "ok",
			lost: false,
		});
	});

	test("no driven command is missing from the runtime, and no command is missing from the table", () => {
		expect(
			answers.filter(
				(answer) => answer.detail === "NO-PLUGIN" || answer.detail === "NO-COMMAND",
			),
		).toEqual([]);
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
