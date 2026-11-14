#!/usr/bin/env bun
/**
 * Does a built app actually deliver a notification?
 *
 * This is the only proof of that surface a machine can make: `notification.notify` posts
 * through `UNUserNotificationCenter`, and the OS either schedules the request or refuses it
 * with `UNErrorDomain code 1`. Nothing here fakes delivery — the assertion is the OS's own
 * completion handler reporting no error.
 *
 * The app identifier is randomised per run **on purpose**. macOS caches notification
 * authorization per bundle identifier and never re-asks after a denial, so a fixed id would
 * pass once and then fail forever on that machine (measured 2026-11-14: the same id refused
 * an ad-hoc build, an Apple Development build, a LaunchServices launch and a copy in
 * `~/Applications`, while a fresh id delivered under every one of those).
 *
 *   bun run e2e:notify              # build with the crust on PATH
 *   bun run e2e:notify --crust ./src/cli/index.ts
 *
 * A window appears for a few seconds, so this is not in the automatic gate.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { clearSurvivors, runCommand, survivorsOf, Verdict } from "./e2e-harness";

const argv = Bun.argv.slice(2);
const crustIndex = argv.indexOf("--crust");
const crust = crustIndex >= 0 ? resolve(argv[crustIndex + 1] ?? "crust") : "crust";
const repo = resolve(import.meta.dir, "..");

const page = `<!doctype html>
<title>notify e2e</title>
<p>notify e2e
<script type="module">
	const wait = setInterval(async () => {
		if (!window.crust) return;
		clearInterval(wait);
		let text;
		try {
			const answer = await window.crust.invoke("notification", "notify", {
				title: "crust e2e",
				body: "delivery is asserted, not assumed",
				waitMs: 60000,
			});
			text = JSON.stringify(answer);
		} catch (error) {
			text = \`THREW \${error && error.message ? error.message : String(error)}\`;
		}
		await window.crust.invoke("report", { text });
	}, 100);
</script>
`;

const entry = `import { app } from "crust";

app.command("report", ({ text }) => {
	console.log(\`  page      \${typeof text === "string" ? text : JSON.stringify(text)}\`);
	// Quit from the app rather than from the harness: the run then ends on the app's own
	// terms, and an app that never answers is a timeout rather than a hang.
	setTimeout(() => app.quit(), 100);
	return { ok: true };
});

await app.run();
`;

async function main(): Promise<number> {
	const verdict = new Verdict();
	// One stable identifier, not a random one. macOS remembers an authorization decision
	// per bundle identifier, so a stable id means a person clicks Allow **once ever** and
	// every later run is unattended; a fresh id asks again every time, which made this
	// suite need a human on each run (measured 2026-11-14). `--fresh-id` exists for the
	// opposite case: proving a brand-new identifier still gets asked, or working around
	// an identifier that has been recorded as denied.
	const id = argv.includes("--fresh-id")
		? `land.jyz.crust-notify-e2e-${Math.random().toString(36).slice(2, 10)}`
		: "land.jyz.crust-notify-e2e";
	// Built under `~/.cache`, **not** `os.tmpdir()`. Measured 2026-11-14: the identical bundle
	// with a fresh identifier delivers from `~/dev` and answers code 1 from `/var/folders/…T`,
	// twice each way. A notification-gated app has to live outside the system temp directory.
	const cache = join(homedir(), ".cache");
	await mkdir(cache, { recursive: true });
	const root = await mkdtemp(join(cache, "crust-e2e-notify-"));
	const appDir = join(root, "app");
	const name = "Notify e2e";
	const builtBinary = join(appDir, "dist", `${name}.app`, "Contents", "MacOS", "crust-app");

	try {
		await mkdir(join(appDir, "public"), { recursive: true });
		await mkdir(join(appDir, "node_modules"), { recursive: true });
		await symlink(repo, join(appDir, "node_modules", "crust"), "dir");
		await writeFile(
			join(appDir, "package.json"),
			`{"name":"crust-e2e-notify","private":true,"type":"module"}\n`,
			"utf8",
		);
		await writeFile(join(appDir, "public", "index.html"), page, "utf8");
		await writeFile(join(appDir, "main.ts"), entry, "utf8");
		await writeFile(
			join(appDir, "crust.config.ts"),
			`import type { CrustConfig } from "crust";

export default {
	app: { id: "${id}", name: "${name}", version: "0.0.0" },
	windows: [{ label: "main", url: "/", width: 360, height: 200, title: "${name}" }],
} satisfies CrustConfig;
`,
			"utf8",
		);

		const install = await runCommand(["bun", "install"], appDir);
		verdict.check(
			"install",
			install.code === 0,
			install.code === 0
				? "bun install — exit 0"
				: `exit ${install.code}\n${install.stderr.slice(-400)}`,
		);

		const build = await runCommand([crust, "build"], appDir);
		verdict.check(
			"build",
			build.code === 0,
			build.code === 0
				? `${crust} build — exit 0`
				: `exit ${build.code}\n${build.stderr.slice(-400)}`,
		);
		if (build.code !== 0) return verdict.report("e2e-notify");

		await clearSurvivors(builtBinary);
		const child = Bun.spawn([builtBinary], { stdout: "pipe", stderr: "pipe" });
		const stdout = new Response(child.stdout).text();
		const stderr = new Response(child.stderr).text();

		// Bounded by hand: macOS ships no timeout(1), and a hung app must fail as a deadline.
		let timedOut = false;
		const deadline = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, 90_000);
		const code = await child.exited;
		clearTimeout(deadline);
		const out = await stdout;
		const err = await stderr;

		verdict.check(
			"exit 0",
			code === 0 && !timedOut,
			timedOut ? "killed at the 90 s deadline" : `exited ${code}`,
		);
		const reported =
			out
				.split("\n")
				.find((line) => line.includes("page      "))
				?.trim() ?? "";
		verdict.check(
			"reported",
			reported !== "",
			reported || `no page line in ${out.slice(-300)}${err.slice(-200)}`,
		);
		// Three outcomes and they are different findings. `delivered:true` is the OS
		// scheduling it; a refusal names a cause; "has not answered yet" means macOS is
		// showing a prompt for this brand-new identifier and no person clicked it — a
		// machine cannot answer that, so the run proves nothing either way.
		const delivered = reported.includes('"delivered":true');
		const unproven = !delivered && reported.includes("has not answered yet");
		const denied = reported.includes("recorded as denied");
		verdict.check(
			"delivered",
			delivered,
			delivered
				? `the OS scheduled it: ${reported}`
				: unproven
					? "UNPROVEN — macOS is showing a permission prompt for this identifier; click Allow and run again (once only)"
					: denied
						? `${reported}\n          the stable identifier was refused on this machine; re-run with --fresh-id`
						: `the OS refused: ${reported || "no answer"}`,
		);

		verdict.check(
			"no survivors",
			(await survivorsOf(builtBinary)).length === 0,
			"no process matches the binary path",
		);

		return verdict.report("e2e-notify");
	} finally {
		await clearSurvivors(builtBinary);
		await rm(root, { recursive: true, force: true });
	}
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-notify: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
