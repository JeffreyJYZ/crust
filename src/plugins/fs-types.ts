/**
 * The argument and answer shapes of `crust:fs`. Types only, split from `fs.ts` at the 200-line cap
 * so the command file stays readable; the plugin re-exports them for the barrel.
 */

export interface ReadTextFileArgs {
	/** Absolute or cwd-relative path. */
	path: string;
}

export interface WriteTextFileArgs {
	path: string;
	contents: string;
}

export interface WriteTextFileResult {
	/** Bytes actually written, as `Bun.write` reports them. */
	bytes: number;
}

export interface ListArgs {
	path: string;
}

export interface ListEntry {
	/** Basename, never a path. */
	name: string;
	/** Absolute path, so a page never has to join strings. */
	path: string;
	directory: boolean;
	/** Bytes for a file; 0 for a directory. */
	size: number;
}

export interface ListResult {
	entries: ListEntry[];
}

export interface StatArgs {
	path: string;
}

export interface StatResult {
	path: string;
	directory: boolean;
	size: number;
	/** Milliseconds since the epoch, as `fs.stat` reports it. */
	modified: number;
}

export interface RemoveArgs {
	path: string;
	/** Remove a directory and everything under it. Refused for a non-empty one otherwise. */
	recursive?: boolean;
}

export interface RemoveResult {
	removed: boolean;
	path: string;
}

export interface RenameArgs {
	from: string;
	to: string;
}

export interface RenameResult {
	path: string;
}
