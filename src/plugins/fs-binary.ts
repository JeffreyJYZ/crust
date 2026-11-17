/**
 * Binary read/write and `mkdir` for `crust:fs`, split from `fs.ts` so the text half stays under the
 * file cap. Wired into the same `commands` table, so a page sees one `fs` namespace.
 *
 * Bytes cross the bridge through the documented `__crustBytes` escape: a `Uint8Array` result is
 * tagged by the server and revived by the page client, so `readBinary` just returns real bytes.
 * The reverse trip is not automatic — JSON.stringify turns a page's `Uint8Array` argument into an
 * object of numeric keys — so `writeBinary` accepts either real bytes (in-process or the bridge's
 * binary route) or the same `{ __crustBytes: base64 }` tag a page can put in a JSON argument.
 * Both commands reuse the plugin's `scoped` helper, so containment is one rule, never two.
 */

import { mkdir as mkdirPath } from "node:fs/promises";
import { resolve } from "node:path";

import { CrustError } from "../bridge/errors";

const BYTES_KEY = "__crustBytes";

export interface ReadBinaryArgs {
	path: string;
}

export interface WriteBinaryArgs {
	path: string;
	/** Real bytes, or the bridge's tagged base64 form from a JSON argument. */
	bytes: Uint8Array | { [BYTES_KEY]: string };
}

export interface WriteBinaryResult {
	/** Bytes actually written, as `Bun.write` reports them. */
	bytes: number;
}

export interface MkdirArgs {
	path: string;
}

export interface MkdirResult {
	path: string;
	/** False when the directory (or the whole nested chain) already existed. */
	created: boolean;
}

/** Validate and decode a tagged base64 payload; `Buffer.from` alone silently accepts garbage. */
function fromTagged(value: { [BYTES_KEY]: string }, command: string): Uint8Array | undefined {
	const text = value[BYTES_KEY];
	if (typeof text !== "string" || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
		return undefined;
	}
	return Uint8Array.from(Buffer.from(text, "base64"));
}

/** Whatever the wire delivered, become real bytes or a named bad-request. */
function toBytes(value: unknown, command: string): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (
		value !== null &&
		typeof value === "object" &&
		typeof (value as Record<string, unknown>)[BYTES_KEY] === "string"
	) {
		const decoded = fromTagged(value as { [BYTES_KEY]: string }, command);
		if (decoded) return decoded;
		throw new CrustError("bad-request", `fs.${command}: "${BYTES_KEY}" is not valid base64`);
	}
	throw new CrustError(
		"bad-request",
		`fs.${command}: "bytes" must be bytes or a ${BYTES_KEY} tag`,
	);
}

/** The three commands, addressed by the plugin that spreads them into its own table. */
export function binaryCommands(scoped: (value: unknown) => Promise<string>) {
	return {
		readBinary: async ({ path }: ReadBinaryArgs): Promise<Uint8Array> => {
			const file = await scoped(path);
			const handle = Bun.file(file);
			if (!(await handle.exists())) {
				throw new CrustError("not-found", `fs.readBinary: no file at ${file}`);
			}
			return new Uint8Array(await handle.arrayBuffer());
		},

		writeBinary: async ({ path, bytes }: WriteBinaryArgs): Promise<WriteBinaryResult> => {
			const file = await scoped(path);
			const data = toBytes(bytes, "writeBinary");
			const written = await Bun.write(file, data);
			return { bytes: written };
		},

		mkdir: async ({ path }: MkdirArgs): Promise<MkdirResult> => {
			const dir = await scoped(path);
			// Recursive mkdir returns the first path it created, or undefined if the whole chain
			// existed — so the verdict is measured, not guessed from a prior stat.
			const first = await mkdirPath(dir, { recursive: true });
			return { path: resolve(dir), created: first !== undefined };
		},
	};
}
