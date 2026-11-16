/**
 * Process helpers shared by the packaging modules. Everything shells out to a tool macOS ships: `bun build`, `codesign`, `spctl`, `hdiutil`, `sips` and `iconutil` are the whole toolchain, with no dependency added.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface RunOptions {
	cwd?: string;
}

/** Run a command, capture both streams, never throw on a non-zero exit. */
export async function run(command: string[], options: RunOptions = {}): Promise<RunResult> {
	const proc = Bun.spawn(command, {
		cwd: options.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

/** Run a command and fail with its own output when it exits non-zero. */
export async function runOrThrow(command: string[], options: RunOptions = {}): Promise<RunResult> {
	const result = await run(command, options);
	if (result.code !== 0) {
		const detail = (result.stderr.trim() || result.stdout.trim() || "no output")
			.split("\n")
			.join(" | ");
		throw new Error(`${command.join(" ")} failed (exit ${result.code}): ${detail}`);
	}
	return result;
}

/**
 * Allocated size in KiB, the way the packaging probe measured it: `du -sk` reports allocated blocks, so this is the figure `research/packaging.md` quotes (86,580 KiB for the 85 MiB binary plus metadata). Deliberately not a sum of logical sizes — those differ by one block per file.
 * Windows has no `du` on the PATH a Bun process sees, and `Bun.spawn` throws `ENOENT` rather than answering, so that host falls back to the logical sum instead of failing a build over a size figure.
 */
export async function allocatedKiB(path: string): Promise<number> {
	const result = await run(["du", "-sk", path]).catch(() => undefined);
	const kib = Number.parseInt(result?.stdout.trim().split(/\s+/)[0] ?? "", 10);
	if (result?.code === 0 && Number.isFinite(kib)) return kib;

	const bytes = await logicalBytes(path);
	if (bytes === 0) {
		throw new Error(
			`no size for ${path}: du printed ${result?.stdout.trim() || "nothing"} and the tree holds no files`,
		);
	}
	return Math.ceil(bytes / 1024);
}

/** Sum of file sizes, the fallback for a host with no `du`. */
async function logicalBytes(path: string): Promise<number> {
	const info = await stat(path).catch(() => undefined);
	if (info === undefined) return 0;
	if (info.isFile()) return info.size;

	let total = 0;
	for (const entry of await readdir(path, { withFileTypes: true })) {
		total += await logicalBytes(join(path, entry.name));
	}
	return total;
}
