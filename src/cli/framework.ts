import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { sourceOwner } from "../native-source.ts";
import { listAssets, readAsset } from "./assets.ts";
import { FRAMEWORK_MARKER, frameworkStamp, type FrameworkEntry } from "./framework-stamp.ts";
import { crustRoot, exists, VERSION } from "./util.ts";

let cached: string | undefined;

/**
 * True when this code runs inside a compiled executable rather than a checkout. The embedded tree is mounted at `/$bunfs` and this process can read it, but a child `bun build` cannot — so `exists()` is not the test: it says yes inside a binary and the child then fails with `Could not resolve: "/$bunfs/root/src/runtime.ts"`.
 */
function inExecutable(): boolean {
	return import.meta.dir.includes("/$bunfs");
}

/** True when runtime paths live inside a compiled executable rather than a checkout. */
export { inExecutable };

/**
 * The crust package the project itself depends on, when it has one. Everything the project runs must come from the same module instance its `import "crust"` resolves to, or two copies exist — the CLI's and the project's — each with its own `app` singleton: `app.run()` in a built entry never sees the wrapper's config, and under `crust dev` a command registered by `main.ts` is invisible to the runtime, which answers `crust: unknown command "greet"`.
 * A checkout hides this because `link:` makes both specifiers one realpath; an installed crust exposes it, which is why this resolves by realpath rather than by string.
 */
export async function projectCrustRoot(dir: string): Promise<string> {
	const candidate = join(dir, "node_modules", "crust");
	try {
		const manifest = (await Bun.file(join(candidate, "package.json")).json()) as {
			name?: unknown;
		};
		if (manifest.name === "crust" && (await exists(join(candidate, "src", "runtime.ts"))))
			return await realpath(candidate);
	} catch {
		// No usable dependency: fall back to the framework this CLI carries.
	}
	return await frameworkRoot();
}

/**
 * A real directory holding crust's own sources, for the code `dev` and `build` generate. In a checkout that is the checkout; in a compiled executable the embedded tree is written to this user's cache once and the generated entry imports from there.
 */
export async function frameworkRoot(): Promise<string> {
	if (!inExecutable() && (await exists(join(crustRoot, "src", "runtime.ts")))) return crustRoot;
	if (cached !== undefined) return cached;
	cached = await materialiseFramework();
	return cached;
}

/**
 * The per-user cache root, overridable by the standard XDG variable. The old `$TMPDIR` path was
 * predictable and shared, so any local user could plant a tree and have the generated entry import
 * it instead of the sources this executable carries.
 */
export function frameworkCacheRoot(): string {
	const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
	return join(base, "crust", "framework");
}

/** The version-keyed tree. Exposed so a test can plant a hostile cache at the exact path. */
export function frameworkCacheDir(root = frameworkCacheRoot()): string {
	return join(root, VERSION);
}

/** Refuse a planted symlink, a foreign owner or a directory another user can write. */
async function privateDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const info = await lstat(dir);
	if (info.isSymbolicLink() || !info.isDirectory())
		throw new Error(`crust: framework cache directory ${dir} is not a directory`);
	if (info.uid !== sourceOwner() || (info.mode & 0o077) !== 0)
		throw new Error(`crust: framework cache directory ${dir} is not private to this user`);
}

/** Every shipped byte the generated tree must hold, plus the config that defines its `@/` alias. */
async function frameworkEntries(): Promise<FrameworkEntry[]> {
	const sources = await listAssets("src");
	if (sources.length === 0)
		throw new Error(
			"this crust build carries no framework sources — it was compiled without --asset=src, " +
				"so dev and build cannot generate an entry",
		);
	// `listAssets("src")` reports paths relative to `src`; the generated tree keeps that prefix.
	const entries: FrameworkEntry[] = sources.map((asset) => ({
		relative: `src/${asset.relative}`,
		bytes: asset.bytes,
	}));
	for (const name of ["tsconfig.json", "package.json"]) {
		const bytes = await readAsset(name);
		if (bytes) entries.push({ relative: name, bytes: async () => bytes });
	}
	return entries;
}

/**
 * True when the tree was published with the matching marker and every cached file still holds the
 * shipped bytes. A missing marker means an interrupted publish, which is rebuilt; a present marker
 * with changed or missing content is a planted tree and is refused by name.
 */
async function verifyFramework(
	target: string,
	entries: readonly FrameworkEntry[],
	stamp: string,
): Promise<boolean> {
	let marker: string;
	try {
		marker = await readFile(join(target, FRAMEWORK_MARKER), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
	if (marker !== stamp)
		throw new Error(
			`crust: framework marker ${join(target, FRAMEWORK_MARKER)} does not match this executable; ` +
				`remove ${target} and retry`,
		);
	for (const entry of entries) {
		const path = join(target, entry.relative);
		let info;
		try {
			info = await lstat(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw new Error(
					`crust: framework cache ${target} is incomplete; remove it and retry`,
				);
			throw error;
		}
		if (info.isSymbolicLink())
			throw new Error(`crust: refusing symlinked framework source ${path}`);
		if (!info.isFile() || info.uid !== sourceOwner())
			throw new Error(`crust: framework source ${path} is not a private file`);
		const cached = await readFile(path);
		if (!cached.equals(await entry.bytes()))
			throw new Error(
				`crust: framework source ${entry.relative} does not match the shipped sources; ` +
					`remove ${target} and retry`,
			);
	}
	return true;
}

/**
 * Publish a verified tree into a private per-user directory by rename, so a crashed write cannot
 * leave a truncated tree that a later launch trusts. An existing complete tree is reused; an
 * existing hostile tree is refused rather than overwritten or imported.
 */
export async function materialiseFramework(root = frameworkCacheRoot()): Promise<string> {
	await privateDir(root);
	const target = frameworkCacheDir(root);
	const entries = await frameworkEntries();
	const stamp = await frameworkStamp(entries);

	try {
		if (await verifyFramework(target, entries, stamp)) return target;
		// No marker: an interrupted publish left a partial tree. It is ours to replace.
		await privateDir(target);
		await rm(target, { recursive: true, force: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	const staged = join(root, `.tmp-${randomUUID()}`);
	await mkdir(staged, { mode: 0o700 });
	for (const entry of entries) {
		const path = join(staged, entry.relative);
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		await writeFile(path, await entry.bytes(), { mode: 0o600 });
	}
	await writeFile(join(staged, FRAMEWORK_MARKER), stamp, { mode: 0o600 });
	try {
		await rename(staged, target);
	} catch {
		await rm(staged, { recursive: true, force: true });
		// A concurrent launcher won: its tree must be the same verified content.
		if (!(await verifyFramework(target, entries, stamp)))
			throw new Error(`crust: framework cache ${target} could not be published`);
	}
	return target;
}
