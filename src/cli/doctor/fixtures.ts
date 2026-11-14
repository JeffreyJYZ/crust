/**
 * Fixtures shared by the `crust doctor` tests: a scratch project, a minimal
 * config, a page file, and the one way these tests run the real command.
 */

import { afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrustConfig } from "@/config";

const roots: string[] = [];

export async function project(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-cli-doctor-"));
	roots.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

export function config(build?: CrustConfig["build"]): CrustConfig {
	return {
		app: { id: "dev.crust.doctor", name: "Test", version: "0.1.0" },
		windows: [{ label: "main" }],
		build,
	};
}

export async function page(dir: string, file = "index.html"): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, file), "<!doctype html><p>hi</p>", "utf8");
}

export interface Run {
	stdout: string;
	stderr: string;
	code: number;
}

export async function runDoctor(dir: string, ...args: string[]): Promise<Run> {
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			"run",
			join(import.meta.dir, "..", "index.ts"),
			"doctor",
			"--dir",
			dir,
			...args,
		],
		cwd: dir,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, code };
}
