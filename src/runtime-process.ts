/**
 * `runtime.ts`'s process-level pieces: the shutdown signals and the one argument parser both it and the CLI accept, split out so `runtime.ts` reads as the startup sequence it is and re-exported so paths stay stable.
 */

let signalsRegistered = false;

/**
 * SIGINT/SIGTERM must end the process wherever `startApp` runs, including inside
 * a compiled binary where `import.meta.main` never fires. Guarded, so a second
 * call cannot install the handlers twice.
 */
export function registerShutdownSignals(): void {
	if (signalsRegistered) return;
	signalsRegistered = true;
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => process.exit(0));
	}
}

/** The one argument parser both this module and the CLI accept. */
export function parseRuntimeArgs(argv: readonly string[]): { configPath?: string; entry?: string } {
	const parsed: { configPath?: string; entry?: string } = {};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--config") parsed.configPath = argv[++index];
		else if (arg === "--entry") parsed.entry = argv[++index];
	}
	return parsed;
}
