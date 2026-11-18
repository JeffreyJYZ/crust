/**
 * The disk half every login-item mechanism shares: one absolute path, an atomic write so a crash
 * leaves the previous entry intact, and a read-back. `autostart.ts` picks which OS's mechanism a
 * call gets; nothing here knows what the file means to the OS that reads it.
 */

import { rename, stat, writeFile } from "node:fs/promises";

/** One OS's login item: where it lives, how to arm it, and how to read what is really there. */
export interface AutostartMechanism {
	/** Absolute path of the entry file, for the typed answer and for a refusal to name. */
	path: string;
	/** Arm login start for this app path. Throws; the caller turns that into `handler-error`. */
	write(appPath: string): Promise<void>;
	/** Read the mechanism back. Never the state a previous `write` asked for. */
	enabled(): Promise<boolean>;
	/** Remove the entry. Throws; the caller turns that into `handler-error`. */
	remove(): Promise<void>;
}

export function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function exists(path: string): Promise<boolean> {
	return await stat(path).then(
		() => true,
		() => false,
	);
}

/** Write beside the target then rename, so the entry is either absent or complete. */
export async function writeAtomic(target: string, contents: string): Promise<void> {
	const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temp, contents, { encoding: "utf8", mode: 0o644 });
	await rename(temp, target);
}
