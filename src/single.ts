/**
 * One file as a crust app — `crust dev app.tsx` and `crust build app.tsx`.
 *
 * A single-file app has no `crust.config.ts` and no `main.ts`. This module
 * detects that shape, builds the config in memory, and bundles the page with
 * `Bun.build`; `dev.ts` owns the window/reload loop and `build.ts` owns the
 * `.app`. Nothing here writes into the project except the bundle directory
 * (`<dir>/.crust/single` in dev, `<dir>/dist/single` in a build).
 *
 * The page convention, stated once because it is the whole contract:
 *
 *   - a file whose source contains `export default` is a React component; crust
 *     mounts it into `#root` with `react-dom/client`, resolved from the file's
 *     own `node_modules`;
 *   - any other file is loaded for its own side effects and is expected to
 *     render itself.
 *
 * The backend is the framework, not the file: `app` answers `info` and `echo`,
 * so `window.crust.invoke("info")` proves the round trip with no second file.
 * `docs/single-file.md` is the user-facing version of all of this.
 *
 * The work is split by stage — `single-detect.ts` (shape and config),
 * `single-page.ts` (the mount and the document), `single-build.ts` (the bundle)
 * and `single-runner.ts` (the dev runner) — and this path re-exports all of it,
 * because `cli/dev.ts`, `cli/build.ts` and `cli/doctor.ts` import from here.
 */
import type { App } from "./app.ts";

export {
	detectSingle,
	isFile,
	type SingleApp,
	type SingleDetection,
	SINGLE_EXTENSIONS,
	SINGLE_WINDOW,
} from "./single-detect.ts";
export { buildPage } from "./single-build.ts";
export {
	documentSource,
	hasDefaultExport,
	mountSource,
	PAGE_ENTRY,
	type PageBuild,
	RELOAD_FILE,
	requireReact,
	resolveFromProject,
} from "./single-page.ts";
export { devRunnerSource, PACKAGE_ROOT } from "./single-runner.ts";

/**
 * The commands a single file gets from the framework, because there is no
 * backend module to register its own. `info` is the round-trip proof; `echo`
 * proves the payload arrives unchanged.
 */
export function registerSingleCommands(app: App, info: { file: string; name: string }): void {
	app.command("info", () => {
		const answer = { app: info.name, file: info.file, single: true };
		console.log(`  info      ${info.name} answered the page`);
		return answer;
	});
	app.command("echo", (args) => {
		console.log(`  echo      ${JSON.stringify(args)}`);
		return args;
	});
}
