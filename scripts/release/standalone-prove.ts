/**
 * The host-only half of `build-standalone`: drive the compiled binary the way a user does.
 * Split out so the release-artefact and argument path stays short; the measured reasons for
 * these checks live here beside them. Only a binary for this machine can be executed.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "./targets.ts";

/** The bare environment a user's machine has, so nothing leaks in from this one. */
const BARE_ENV = {
	PATH: process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin",
};

/**
 * The doctor lines this platform's binary must satisfy. `doctor` is a macOS command today:
 * `platform`, `shim` and `window` refuse every other OS by design (`doctor/environment.ts`
 * prints `macOS only — this is linux`), so elsewhere `templates` is the only claim a binary
 * can meet — and the one that proves the templates are inside the executable.
 */
const DOCTOR_CHECKS: readonly string[] =
	process.platform === "darwin" ? ["shim", "templates", "window", "platform"] : ["templates"];

export interface ProveReport {
	pass(label: string, detail: string): void;
	fail(label: string, detail: string): void;
}

/** The scaffold counts live in `build-standalone.ts` so `init.test.ts` can read the literals. */
export type ScaffoldCounts = readonly (readonly [flag: string, count: number])[];

/** Drive the compiled binary the way a user does. Only possible for the host's own target. */
export async function proveStandalone(
	outfile: string,
	report: ProveReport,
	counts: ScaffoldCounts,
): Promise<void> {
	const { pass, fail } = report;

	// 1. It starts, and knows its version with no package.json beside it.
	const version = Bun.spawnSync([outfile, "--version"], { env: BARE_ENV });
	const printed = version.stdout.toString().trim();
	if (version.exitCode === 0 && printed === VERSION)
		pass("version", `${printed} with PATH=/usr/bin:/bin`);
	else
		fail(
			"version",
			`exited ${version.exitCode}, printed ${JSON.stringify(printed)}, wanted ${VERSION}`,
		);

	// 2. It scaffolds, which means the templates are inside the executable.
	const workspace = await mkdtemp(join(tmpdir(), "crust-standalone-"));
	try {
		for (const [flag, count] of counts) {
			const name = `app${flag === "" ? "-plain" : flag}`;
			const target = join(workspace, name);
			const args = [outfile, "init", target, ...(flag === "" ? [] : [flag])];
			const init = Bun.spawnSync(args, { cwd: workspace, env: BARE_ENV });
			// The glob misses dotfiles, so .gitignore is checked separately — the file a scaffold most often loses.
			const listed = [...new Bun.Glob("**/*").scanSync({ cwd: target, onlyFiles: true })];
			const ignore = Bun.file(join(target, ".gitignore")).size > 0;
			if (init.exitCode === 0 && listed.length === count && ignore)
				pass("init", `${flag || "(no flag)"} wrote ${listed.length + 1} files`);
			else
				fail(
					"init",
					`${flag || "(no flag)"} exited ${init.exitCode} with ${listed.length} files ` +
						`and .gitignore ${ignore ? "present" : "missing"}: ` +
						init.stderr.toString().trim().slice(0, 120),
				);
		}

		// 3. Doctor reaches the shim, the platform and the templates from inside the
		// binary. It is allowed to fail on the frontend checks — nothing is built yet.
		const scaffold = join(workspace, "app-next");
		const doctor = Bun.spawnSync([outfile, "doctor", "--dir", scaffold], {
			cwd: workspace,
			env: BARE_ENV,
		});
		const text = `${doctor.stdout.toString()}${doctor.stderr.toString()}`;
		for (const check of DOCTOR_CHECKS) {
			const line = text.split("\n").find((row) => row.trim().startsWith(check));
			if (line?.includes("[ok]")) pass(`doctor ${check}`, line.trim().slice(0, 80));
			else fail(`doctor ${check}`, line?.trim() ?? "no line printed");
		}
		// Said out loud: on a non-macOS host doctor exits 1 on those checks; the binary is not the reason.
		const skipped = ["shim", "window", "platform"].filter(
			(check) => !DOCTOR_CHECKS.includes(check),
		);
		if (skipped.length > 0)
			console.log(
				`  SKIP  doctor            ${skipped.join(", ")} are macOS-only checks on ${process.platform}`,
			);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
}
