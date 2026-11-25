/** The CLI body of `runtime.ts`, split so the entry file stays under the line cap. */

import { parseRuntimeArgs, registerShutdownSignals } from "./runtime-process.ts";
import { startApp } from "./runtime.ts";

/** Run `crust dev`'s backend from the command line. `runtime.ts` owns the `import.meta.main` gate. */
export function runRuntimeCli(): void {
	const args = parseRuntimeArgs(process.argv.slice(2));
	// `crust dev` restarts by killing this process, and a window closing kills it from the
	// platform side; both should end the process cleanly, not 130/143.
	registerShutdownSignals();
	startApp(args).catch((error: unknown) => {
		const text = error instanceof Error ? error.message : String(error);
		console.error(`crust: ${text}`);
		process.exitCode = 1;
	});
}
