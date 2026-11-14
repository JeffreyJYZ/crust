/**
 * One file as a crust app — `crust dev app.tsx` and `crust build app.tsx`. With no `crust.config.ts` and no `main.ts`, this detects the shape, builds the config in memory and bundles the page; the only writes are `<dir>/.crust/single` in dev and `<dir>/dist/single` in a build.
 * The convention is the whole contract: a source containing `export default` is a React component mounted into `#root` from its own `node_modules`, anything else is loaded for its side effects. The backend is the framework (`info`, `echo`), so `invoke("info")` proves the round trip with no second file. Stages: `single-detect.ts`, `single-page.ts`, `single-build.ts`, `single-runner.ts`.
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
