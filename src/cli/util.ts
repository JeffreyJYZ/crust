import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import packageJson from "../../package.json";

/**
 * The crust package root, whatever directory the CLI is invoked from. Six ancestors, because the root is the directory holding `templates/` and that is not always two steps up: in a checkout this is `src/cli/util.ts`, in a compiled executable `import.meta.dir` is `/$bunfs/root/src/cli` when the bundler keeps the tree and `/$bunfs/root` when it flattens — where `..` twice would be `/`. Marker discovery answers all three, falling back to the checkout assumption.
 */
function findRoot(start: string): string {
	let dir = start;
	for (let depth = 0; depth < 6; depth++) {
		if (existsSync(join(dir, "templates"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return resolve(start, "..", "..");
}

export const crustRoot = findRoot(import.meta.dir);

export const VERSION: string = packageJson.version;

export interface CliOptions {
	/** Project directory. */
	dir: string;
	/** Explicit config path, relative to `dir`. */
	config?: string;
	/** Backend entry, relative to `dir`. */
	entry?: string;
	/** The positional a `dev`/`build` invocation got; a single-file entry. */
	single?: string;
}

const LABEL_WIDTH = 9;

/** One aligned `crust <command>` detail line. */
export function line(label: string, text: string): void {
	console.log(`  ${label.padEnd(LABEL_WIDTH)} ${text}`);
}

/** Print a command failure and return the process exit code. */
export function fail(command: string, message: string): number {
	console.error(`crust ${command}: ${message}`);
	return 1;
}

/** Quote one path for a `sh -c` command. */
export function quote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function exists(path: string, kind: "file" | "dir" = "file"): Promise<boolean> {
	try {
		const info = await stat(path);
		return kind === "dir" ? info.isDirectory() : info.isFile();
	} catch {
		return false;
	}
}

/** Run a shell command in the project directory with inherited stdio. */
export async function runShell(command: string, cwd: string): Promise<number> {
	const child = Bun.spawn({
		cmd: ["sh", "-c", command],
		cwd,
		stdio: ["inherit", "inherit", "inherit"],
	});
	return await child.exited;
}

/**
 * The backend entry, as the CLI resolves it: an explicit `--entry` must exist,
 * otherwise `src/main.ts` and then `main.ts` are tried. Both are accepted so a
 * minimal app can be three files at the project root (`crust.config.ts`,
 * `main.ts`, `public/`), while a layered app keeps `src/main.ts`.
 */
export async function resolveBackendEntry(
	dir: string,
	entry?: string,
): Promise<{ path: string; explicit: boolean } | undefined> {
	if (entry) {
		const path = resolve(dir, entry);
		return (await exists(path)) ? { path, explicit: true } : undefined;
	}
	for (const candidate of ["src/main.ts", "main.ts"]) {
		const path = resolve(dir, candidate);
		if (await exists(path)) return { path, explicit: false };
	}
	return undefined;
}

/** The first `.app` directory in `<dir>/dist`, if any. */
export async function findAppBundle(dir: string): Promise<string | undefined> {
	const dist = resolve(dir, "dist");
	if (!(await exists(dist, "dir"))) return undefined;
	const entries = await readdir(dist, { withFileTypes: true });
	const bundle = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
	return bundle ? join(dist, bundle.name) : undefined;
}

/**
 * Why `bun install` has not been run here, when that is the state. A declared dependency set with no `node_modules` is what a fresh clone or a `rm -rf` leaves; the frontend command then cannot find its tool locally, and `bun x` silently resolves one from the global cache — vite starts, dies on the missing react, and the user gets a rolldown stack with crust reporting "the frontend build failed", which points at the wrong thing entirely.
 */
export async function missingInstall(dir: string): Promise<string | undefined> {
	const manifest = Bun.file(join(dir, "package.json"));
	if (!(await manifest.exists())) return undefined;

	let declared = 0;
	try {
		const parsed = (await manifest.json()) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		declared =
			Object.keys(parsed.dependencies ?? {}).length +
			Object.keys(parsed.devDependencies ?? {}).length;
	} catch {
		return undefined;
	}
	if (declared === 0) return undefined;
	if (await exists(join(dir, "node_modules"), "dir")) return undefined;
	return (
		`node_modules is missing in ${resolve(dir)} — run \`bun install\` first. ` +
		"Without it the frontend command resolves its tool from a global cache and fails " +
		"on the packages it cannot find"
	);
}
