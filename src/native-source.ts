/**
 * Private cache for C sources that `cc()` compiles at launch. The filename is a hash of shipped
 * source, so it is predictable to any local user; writing it to a shared /tmp and asking `existsSync`
 * let that user pre-create a symlink or a foreign file and have its C compiled into the process.
 *
 * The cache lives under the user's own XDG cache dir, is created 0700, and every existing entry is
 * checked with `lstat` (never `stat`), so neither a symlink nor another user's file is compiled.
 * A complete file is published by rename, so a crashed write cannot leave a truncated entry behind.
 */
import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** What `lstat` saw for one cached source, in the shape the ownership gate needs. */
export interface SourceFileInfo {
	symlink: boolean;
	regular: boolean;
	uid: number;
	mode: number;
}

/** The uid every cached source must belong to; refuse to guess on a platform without one. */
export function sourceOwner(): number {
	const uid = typeof process.getuid === "function" ? process.getuid() : -1;
	if (uid < 0) throw new Error("crust: native source ownership cannot be verified here");
	return uid;
}

/** Refuse anything but a private, regular file owned by this user. */
export function assertPrivateSource(
	path: string,
	info: SourceFileInfo,
	uid = sourceOwner(),
): void {
	if (info.symlink) throw new Error(`crust: refusing symlinked native source ${path}`);
	if (!info.regular) throw new Error(`crust: refusing non-file native source ${path}`);
	if (info.uid !== uid)
		throw new Error(`crust: native source ${path} belongs to uid ${info.uid}, not ${uid}`);
	if ((info.mode & 0o022) !== 0)
		throw new Error(`crust: native source ${path} is writable by group or others`);
}

/** The per-user cache root, overridable by the standard XDG variable. */
export function nativeSourceDir(): string {
	const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
	return join(base, "crust", "native");
}

/** Verify the directory itself: a symlink planted ahead of us must not redirect the cache. */
function privateDir(dir: string): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const stat = lstatSync(dir);
	if (stat.isSymbolicLink() || !stat.isDirectory())
		throw new Error(`crust: native source directory ${dir} is not a directory`);
	if (stat.uid !== sourceOwner() || (stat.mode & 0o077) !== 0)
		throw new Error(`crust: native source directory ${dir} is not private to this user`);
}

/** The content-hashed path a source compiles from. Exposed so a test can plant a hostile file. */
export function nativeSourcePath(name: string, source: string, dir = nativeSourceDir()): string {
	const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
	return join(dir, `${name}-${hash}.c`);
}

/**
 * Return a private, verified path holding exactly `source`. An existing entry is never overwritten:
 * a different byte count or a foreign owner is refused by name instead of being compiled.
 */
export function materialiseNativeSource(
	name: string,
	source: string,
	dir = nativeSourceDir(),
): string {
	privateDir(dir);
	const path = nativeSourcePath(name, source, dir);
	try {
		const stat = lstatSync(path);
		assertPrivateSource(path, {
			symlink: stat.isSymbolicLink(),
			regular: stat.isFile(),
			uid: stat.uid,
			mode: stat.mode,
		});
		if (readFileSync(path, "utf8") !== source)
			throw new Error(
				`crust: native source ${path} does not match the shipped source; refusing to compile it`,
			);
		return path;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	// Write the whole file privately, then publish by rename. A second launcher may race; both
	// write identical bytes, and neither ever compiles a partially written file.
	const temp = join(dir, `${name}-${randomUUID()}.tmp`);
	const fd = openSync(temp, "wx", 0o600);
	try {
		writeSync(fd, source, 0, "utf8");
	} finally {
		closeSync(fd);
	}
	renameSync(temp, path);
	return path;
}
