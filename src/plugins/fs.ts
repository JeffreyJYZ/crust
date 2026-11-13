/**
 * `crust:fs` — text file read and write.
 *
 * Every failure carries a structured code: a missing file is `not-found`, a bad
 * argument is `bad-request`. Nothing here is synchronous, because one blocking
 * handler stalls every other invoke on the bridge (research/bridge.md
 * §Concurrency).
 */

import { CrustError } from "../bridge/errors";
import { definePlugin } from "./define";

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

function requirePath(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new CrustError("bad-request", 'fs: "path" must be a non-empty string');
	}
	return value;
}

export const fsPlugin = definePlugin({
	name: "fs",
	commands: {
		readTextFile: async ({ path }: ReadTextFileArgs): Promise<string> => {
			const file = requirePath(path);
			const handle = Bun.file(file);
			if (!(await handle.exists())) {
				throw new CrustError("not-found", `fs.readTextFile: no file at ${file}`);
			}
			return handle.text();
		},
		writeTextFile: async ({
			path,
			contents,
		}: WriteTextFileArgs): Promise<WriteTextFileResult> => {
			const file = requirePath(path);
			if (typeof contents !== "string") {
				throw new CrustError(
					"bad-request",
					'fs.writeTextFile: "contents" must be a string',
				);
			}
			const bytes = await Bun.write(file, contents);
			return { bytes };
		},
	},
});
