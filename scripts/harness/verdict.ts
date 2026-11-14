/**
 * One PASS/FAIL line per assertion, and the one exit code a run reports — kept apart from the process plumbing so a script that only prints verdicts does not drag the probe in.
 */

const LABEL_WIDTH = 14;

export interface Assertion {
	name: string;
	ok: boolean;
	detail: string;
}

/**
 * Assertions in the order they are known, printed the moment each resolves so a
 * log shows where a run stopped rather than only how it ended.
 */
export class Verdict {
	readonly assertions: Assertion[] = [];
	private readonly started = performance.now();

	check(name: string, ok: boolean, detail: string): boolean {
		this.assertions.push({ name, ok, detail });
		console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(LABEL_WIDTH)}  ${detail}`);
		return ok;
	}

	/** Print the one summary line (and every gap) and return the exit code. */
	report(label: string): number {
		const gaps = this.assertions.filter((assertion) => !assertion.ok);
		const seconds = ((performance.now() - this.started) / 1000).toFixed(1);
		const total = this.assertions.length;
		if (gaps.length === 0) {
			console.log(`${label}: PASS  ${total}/${total} assertions  ${seconds}s`);
			return 0;
		}
		for (const gap of gaps) {
			console.log(`  ${gap.name}: ${gap.detail}`);
		}
		console.log(`${label}: FAIL  ${gaps.length} of ${total} assertions  ${seconds}s`);
		return 1;
	}
}

export interface RunResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

/** Run a command, capture both streams, never throw on a non-zero exit. */
export async function runCommand(command: string[], cwd: string): Promise<RunResult> {
	const child = Bun.spawn({
		cmd: command,
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout, stderr };
}
