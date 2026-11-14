/**
 * The release script's shell: one place that spawns a command, one place that
 * counts a failure, and the identities both git and `gh` push as.
 */
export const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
export const TAP_DIR =
	process.env.CRUST_TAP ??
	"~/dev/worktrees/homebrew-tap/main".replace("~", process.env.HOME ?? "~");
export const ASKPASS = "/Users/jyz/dev/bin/git-askpass-gh";
export const REMOTE = "https://github.com/JeffreyJYZ/crust.git";
export const TAP_REMOTE = "bot";

let failures = 0;

export function step(label: string, detail: string): void {
	console.log(`  ${label.padEnd(10)}${detail}`);
}

export function fail(label: string, detail: string): void {
	failures++;
	console.log(`  FAIL ${label.padEnd(6)}${detail}`);
}

/** How many steps have failed so far, so a caller can stop before writing. */
export function failureCount(): number {
	return failures;
}

/** Run a command and return trimmed stdout, throwing with its stderr on failure. */
export async function sh(
	cmd: string[],
	cwd = REPO,
	env: Record<string, string> = {},
): Promise<string> {
	const proc = Bun.spawn(cmd, {
		cwd,
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}: ${err.trim() || out.trim()}`);
	return out.trim();
}

/** Same as `sh`, but stdout and stderr together: `bun test` prints its totals to stderr. */
export async function shAll(cmd: string[], cwd = REPO): Promise<string> {
	const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}: ${err.trim() || out.trim()}`);
	return `${out}${err}`;
}

export function nextVersion(current: string, kind: string): string {
	const [major = 0, minor = 0, patch = 0] = current.split(".").map((part) => Number(part));
	if (kind === "major") return `${major + 1}.0.0`;
	if (kind === "minor") return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
}

/** The tap identity that may push: `main` is protected and the review is the point. */
const token = (await sh(["gh", "auth", "token", "--user", "jyzbot"])).trim();
export const gitEnv = { GH_TOKEN: token, GIT_ASKPASS: ASKPASS, GIT_TERMINAL_PROMPT: "0" };
