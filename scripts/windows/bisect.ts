/**
 * The bisect that decided how this layer calls Win32: three one-line C units, each in its own
 * process, because a bad call takes the whole process down and the next experiment has to survive it.
 *
 *   import-kernel32   an `extern GetCurrentProcessId` linked through `library: ["kernel32"]`
 *   import-user32     an `extern GetSystemMetrics` linked through `library: ["user32"]`
 *   dynamic-kernel32  the same kernel32 call resolved with LoadLibraryA + GetProcAddress
 *
 * One run tells the three routes apart. If the two imports crash and the dynamic call answers, the
 * import thunk TinyCC builds for a DLL is the fault and nothing may be linked — which is why the
 * shim resolves every entry point at runtime. If all three answer, the thunk is fine and the crash
 * that started this (`0xFFFFFFFFFFFFFFFF` on the first call, `09dbdf1`) is somewhere else.
 *
 * Diagnostic, not a gate: a FAIL here is a measurement, and the smoke must not go red because an
 * experiment did what it was built to catch. Windows only — the PE target exists in Bun's TinyCC
 * only on Windows, so on macOS every experiment fails at link and measures nothing.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cc, FFIType } from "bun:ffi";

export type Experiment = "import-kernel32" | "import-user32" | "dynamic-kernel32";

/** The three routes, in the order that tells them apart in a single run. */
export const EXPERIMENTS: readonly Experiment[] = [
	"import-kernel32",
	"import-user32",
	"dynamic-kernel32",
];

/** One experiment: the C, the libraries it links, and what a pass looks like. */
function unit(name: Experiment): { source: string; library: string[] } {
	if (name === "import-kernel32") {
		return {
			source: `extern unsigned int GetCurrentProcessId(void);
unsigned int probe(void) { return GetCurrentProcessId(); }
`,
			library: ["kernel32"],
		};
	}
	if (name === "import-user32") {
		return {
			// 0 is SM_CXSCREEN: a screen with a width is the proof the call answered.
			source: `extern int GetSystemMetrics(int index);
int probe(void) { return GetSystemMetrics(0); }
`,
			library: ["user32"],
		};
	}
	return {
		// The route the shim uses: no import at all, one resolved pointer.
		source: `extern void *LoadLibraryA(const char *name);
extern void *GetProcAddress(void *module, const char *name);
typedef unsigned int (*probe_fn)(void);
unsigned int probe(void) {
	void *module = LoadLibraryA("kernel32.dll");
	probe_fn resolved;
	if (!module) return 0;
	resolved = (probe_fn)GetProcAddress(module, "GetCurrentProcessId");
	if (!resolved) return 0;
	return resolved();
}
`,
		library: [],
	};
}

/** Run one experiment in this process. Returns a value on success and throws on a build failure. */
function measure(name: Experiment): number {
	const { source, library } = unit(name);
	const path = join(tmpdir(), `crust-bisect-${name}.c`);
	// Synchronous on purpose: `cc()` reads the path immediately, so a pending write is a race.
	writeFileSync(path, source);
	const options = {
		source: path,
		symbols: { probe: { args: [], returns: FFIType.u32 } },
	};
	const lib = library.length === 0 ? cc(options) : cc({ ...options, library });
	return Number(lib.symbols.probe());
}

export interface ExperimentResult {
	name: Experiment;
	passed: boolean;
	/** What the call returned, or how the process ended when it did not return at all. */
	detail: string;
}

/**
 * Run all three, each in its own process. A segfault in one is reported as that experiment's
 * failure instead of ending the report, which is the whole reason for the child processes.
 */
export async function runBisect(): Promise<ExperimentResult[]> {
	const results: ExperimentResult[] = [];
	for (const name of EXPERIMENTS) {
		const child = Bun.spawn([process.execPath, import.meta.path, name], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		const lines = out.split("\n").filter((line) => line.trim() !== "");
		const verdict = lines.find((line) => line.startsWith("PASS") || line.startsWith("FAIL"));
		results.push({
			name,
			passed: code === 0,
			detail:
				verdict?.replace(/^(PASS|FAIL)\s*/, "") ??
				`process ended with exit ${code}, no verdict printed`,
		});
	}
	return results;
}

/** One line per experiment, in the order above. */
export function formatBisect(results: readonly ExperimentResult[]): string[] {
	return results.map(
		(result) => `${result.name} ${result.passed ? "PASS" : "FAIL"}  ${result.detail}`,
	);
}

/** The child side: one experiment, one verdict, one exit code. */
function main(): number {
	const name = process.argv[2] as Experiment | undefined;
	if (name === undefined || !EXPERIMENTS.includes(name)) {
		console.log(`usage: bun run ${import.meta.path} <${EXPERIMENTS.join("|")}>`);
		return 2;
	}
	try {
		const value = measure(name);
		console.log(`PASS  ${name} returned ${value}`);
		return value === 0 ? 1 : 0;
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		console.log(`FAIL  ${name} did not build: ${text.split("\n")[0] ?? text}`);
		return 1;
	}
}

if (import.meta.main) {
	process.exit(main());
}
