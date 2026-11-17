/**
 * The remote half of the Linux proof: every command runs on the OrbStack machine `ubuntu-sandbox`
 * through `orb run`, so nothing is installed on this Mac. That machine shares no filesystem with the
 * host, so the slice under proof is streamed in as a tar and unpacked at `REMOTE_DIR`.
 * `ubuntu-sandbox` is the only machine this file names: `ubuntu` and `fedora` are the user's own.
 */
import { resolve } from "node:path";

/** The one OrbStack machine this proof may touch. */
export const MACHINE = "ubuntu-sandbox";

/**
 * Where the slice lands on that machine. Under the login user's home, because `/work` is not
 * writable without sudo and the proof needs no root to run — only the install does.
 */
export const REMOTE_DIR = '"$HOME/crust"';

const REPO_ROOT = resolve(import.meta.dir, "../..");

/**
 * The slice: the platform layer with its tests, every script (the smoke imports the shared harness,
 * so a partial copy would break on a missing module), and the config files that make `@/…` resolve.
 * A whole-repo copy would drag this Mac's `node_modules` across the wire to prove nothing.
 */
const SLICE = ["src", "scripts", "package.json", "tsconfig.json", "bunfig.toml"];

/**
 * The exact apt line, quoted in the report, so the install is reproducible and auditable. `libc6-dev` is not a runtime library: `cc()` links the shim against libc, so the `libc.so` linker script it ships is required, and GTK plus WebKitGTK alone leave `library c not found`.
 */
export const APT_LINE =
	"sudo apt-get install -y --no-install-recommends libgtk-3-0t64 libwebkit2gtk-4.1-0 libc6-dev xvfb curl unzip";

/** Bun, installed inside the machine: the Linux arm64 build, never the host's binary. */
export const BUN_LINE = "curl -fsSL https://bun.sh/install | bash";

/** Bun's installer writes to `~/.bun/bin`, which is not on the non-interactive PATH. */
const PATH_PREFIX = 'export PATH="$HOME/.bun/bin:$PATH"; ';

export interface Exec {
	code: number | null;
	stdout: string;
	stderr: string;
}

/** Run one shell command on the machine, with optional stdin (the tar stream). */
export async function exec(command: string, input?: Uint8Array): Promise<Exec> {
	const child = Bun.spawn({
		cmd: ["orb", "run", "-m", MACHINE, "bash", "-lc", command],
		cwd: REPO_ROOT,
		stdin: input === undefined ? "ignore" : "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	if (input !== undefined && child.stdin) {
		child.stdin.write(input);
		await child.stdin.end();
	}
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout, stderr };
}

/** Run a command with Bun on PATH, the way every proof step after the install needs it. */
export function execWithBun(command: string): Promise<Exec> {
	return exec(PATH_PREFIX + command);
}

/** One command inside the synced slice, bounded by a real deadline so a hang is a verdict. */
export function runInSlice(suffix: string, seconds: number, command: string): Promise<Exec> {
	return execWithBun(`cd ${REMOTE_DIR} && ${suffix} timeout ${seconds} ${command}`);
}

/** Tar the slice on the host, then unpack it on the machine in one stream. */
export async function sync(): Promise<Exec> {
	const tar = Bun.spawn({
		// `--no-mac-metadata` and the `._*` exclusion keep macOS AppleDouble sidecars out: copied to
		// Linux they are not TypeScript, and `bun test` loads them as tests and fails on the bytes.
		cmd: ["tar", "--no-mac-metadata", "--exclude", "._*", "-czf", "-", ...SLICE],
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	const archive = new Uint8Array(await new Response(tar.stdout).arrayBuffer());
	const [stderr, code] = await Promise.all([new Response(tar.stderr).text(), tar.exited]);
	if (code !== 0) return { code, stdout: "", stderr };
	const unpack = `rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR} && tar xzf - -C ${REMOTE_DIR}`;
	return exec(unpack, archive);
}

/** What the machine already has, asked of the runtime rather than of the package database. */
export interface Runtime {
	gtk: boolean;
	webkit: boolean;
	xvfb: boolean;
	bun: boolean;
}

/** Probe the four things the proof needs; nothing here installs. */
export async function probeRuntime(): Promise<Runtime> {
	const script = [
		'ldconfig -p | grep -q "libgtk-3\\.so\\.0" && echo gtk=1 || echo gtk=0',
		'ldconfig -p | grep -q "libwebkit2gtk-4\\.1\\.so\\.0" && echo webkit=1 || echo webkit=0',
		"command -v xvfb-run >/dev/null && echo xvfb=1 || echo xvfb=0",
		// Bun installs into `~/.bun/bin`, which a non-interactive shell never has on PATH; the probe
		// asks with the same prefix `execWithBun` uses, or a present Bun reads as absent.
		`PATH="$HOME/.bun/bin:$PATH" command -v bun >/dev/null && echo bun=1 || echo bun=0`,
	].join("; ");
	const result = await exec(script);
	const flag = (name: string): boolean => result.stdout.includes(`${name}=1`);
	return {
		gtk: flag("gtk"),
		webkit: flag("webkit"),
		xvfb: flag("xvfb"),
		bun: flag("bun"),
	};
}

/** Install GTK, WebKitGTK, the libc linker script, Xvfb and archive tools the proof needs. Machine only. */
export function installRuntime(): Promise<Exec> {
	return exec(`sudo apt-get update -qq && ${APT_LINE}`);
}

/** Install Bun inside the machine through its own official script. */
export function installBun(): Promise<Exec> {
	return exec(BUN_LINE);
}

/** Used bytes on the machine's root filesystem, for the disk delta the report quotes. */
export async function diskUsed(): Promise<number | null> {
	const result = await exec("df -B1 --output=used / | tail -1");
	const bytes = Number(result.stdout.trim());
	return Number.isFinite(bytes) ? bytes : null;
}

/** `1.2 GiB`, for a disk delta a human reads rather than a byte count they divide. */
export function gib(bytes: number): string {
	return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

export interface EnsureResult {
	before: Runtime;
	after: Runtime;
	installError: string;
	diskDelta: string | null;
}

/**
 * What the machine had, then only what is missing, then what it has now. The "already present" line
 * is printed before anything is installed, because that answer is the finding a reader needs first.
 */
export async function ensureRuntime(): Promise<EnsureResult> {
	const before = await probeRuntime();
	const yes = (flag: boolean): string => (flag ? "yes" : "no");
	console.log(
		`linux: already present  gtk=${yes(before.gtk)} webkit=${yes(before.webkit)} ` +
			`xvfb=${yes(before.xvfb)} bun=${yes(before.bun)}`,
	);

	const diskBefore = await diskUsed();
	let installError = "";
	if (!before.gtk || !before.webkit || !before.xvfb) {
		console.log(`linux: installing       ${APT_LINE}`);
		const apt = await installRuntime();
		if (apt.code !== 0) {
			installError = `apt exited ${apt.code}: ${tail(apt.stderr) || tail(apt.stdout)}`;
		}
	}
	if (installError === "" && !before.bun) {
		console.log(`linux: installing       ${BUN_LINE}`);
		const bun = await installBun();
		if (bun.code !== 0) {
			installError = `bun install exited ${bun.code}: ${tail(bun.stderr) || tail(bun.stdout)}`;
		}
	}

	const after = await probeRuntime();
	const diskAfter = await diskUsed();
	let diskDelta: string | null = null;
	if (diskBefore !== null && diskAfter !== null) {
		diskDelta = `+${gib(Math.max(0, diskAfter - diskBefore))} on /`;
		console.log(`linux: disk             ${diskDelta}`);
	}
	return { before, after, installError, diskDelta };
}

/** The last non-empty line of a stream, for a one-line failure detail. */
export function lastLine(text: string): string {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	return lines.at(-1)?.trim() ?? "";
}

/** The trailing lines of a stream, for a failure that needs context. */
export function tail(text: string, lines = 15): string {
	return text.trimEnd().split("\n").slice(-lines).join("\n");
}
