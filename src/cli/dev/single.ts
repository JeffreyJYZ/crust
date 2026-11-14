/**
 * `crust dev app.tsx` — one file, no config, one window. The bundle goes to `<dir>/.crust/single` and is served from disk, so a rebuild replaces files and the window reloads itself while the runtime process is never restarted; a failed build prints and leaves the last good bundle, which is why the window survives a half-typed file.
 * Only the entry file is watched — a file it imports is not, the documented limit of the convenience (`site/app/docs`).
 */

import { watch } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { buildPage, devRunnerSource, type SingleApp } from "@/single";
import { frameworkRoot } from "../framework.ts";
import { line } from "../util.ts";
import { interpreter } from "./interpreter.ts";

export async function devSingle(app: SingleApp): Promise<number> {
	console.log(`crust dev — ${app.file} (one file)`);

	// The first build is the one that can stop the launch: with no good bundle
	// there is nothing to serve, and a window on a broken page is worse than a
	// message naming the error.
	const page = await buildPage(app, { dev: true });

	// The runner imports the framework by absolute path, so the path has to be the
	// one a *child* can read: inside a compiled executable that is the materialised
	// copy in `$TMPDIR`, never `/$bunfs`, which is only mounted in this process.
	const root = await frameworkRoot();
	const temp = await mkdtemp(join(tmpdir(), "crust-single-"));
	const runner = join(temp, "run.ts");
	await writeFile(runner, devRunnerSource(app, page.dir, root), "utf8");

	line("page", join(page.dir, "index.html"));
	line("bundle", `${page.entry} (rebuilt on every change)`);
	line("window", `${app.config.windows[0]?.width}x${app.config.windows[0]?.height}`);
	line("invoke", 'window.crust.invoke("info") answers from the framework');
	console.log("");

	const run = interpreter();
	const child = Bun.spawn({
		cmd: [...run.command, runner],
		cwd: app.dir,
		stdio: ["inherit", "inherit", "inherit"],
		env: { ...process.env, ...run.env },
	});

	let stopping = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let building = false;
	let again = false;

	const rebuild = async (): Promise<void> => {
		if (stopping) return;
		if (building) {
			again = true;
			return;
		}
		building = true;
		try {
			await buildPage(app, { dev: true });
			line("page", "rebuilt — the window reloads itself");
		} catch (error) {
			// The written page is untouched by a failed build, so the window keeps
			// the last good bundle and only this message appears.
			console.error("  page      build failed — the last good page stays");
			const text = error instanceof Error ? error.message : String(error);
			for (const row of text.split("\n")) console.error(`            ${row}`);
		} finally {
			building = false;
			if (again) {
				again = false;
				void rebuild();
			}
		}
	};

	const name = basename(app.file);
	const watcher = watch(app.dir, { recursive: false }, (_event, filename) => {
		if (stopping) return;
		const seen = String(filename ?? "");
		if (seen !== name && !seen.endsWith(`/${name}`)) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			void rebuild();
		}, 120);
	});

	const stop = (): void => {
		stopping = true;
		clearTimeout(timer);
		watcher.close();
		child.kill();
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	const code = await child.exited;
	watcher.close();
	clearTimeout(timer);
	await rm(temp, { recursive: true, force: true }).catch(() => undefined);

	if (code === 0) {
		line("app", "window closed; crust dev stopped");
		return 0;
	}
	line("app", `runtime exited with ${code}`);
	return code ?? 1;
}
