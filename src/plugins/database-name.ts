/**
 * `crust:database`'s name rule: a page asks for a **name**, and the name resolves inside the app's
 * data directory. `../`, an absolute path, a separator or a drive letter is refused by name, so a
 * page cannot describe a second escape shape the way Butter's `join(dir, name)` allows.
 *
 * The containment test is `fs-scope-path.ts` — `canonical` then `contains` — so one rule serves
 * `fs` and `database` and neither can drift from the other.
 */

import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";

import { CrustError } from "../bridge/errors";
import { canonical, contains } from "./fs-scope-path.ts";
import { defaultStateRoot } from "./window-persist-store.ts";

/** The suffix a name carries once it is a file; `notes` and `notes.sqlite` are the same database. */
export const DATABASE_SUFFIX = ".sqlite";

/** Names are a token, not a path: letters, digits, `_`, `-` and one dot for the suffix. */
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export interface DatabasePathOptions {
	/** Data directory the database file sits under. Defaults to the app's Application Support. */
	root?: string;
	/** App id naming the default root. */
	app?: string;
}

/** The data directory a name resolves inside. */
export function databaseRoot(options: DatabasePathOptions = {}): string {
	return options.root ?? defaultStateRoot(options.app ?? "crust");
}

/**
 * The absolute file a name refers to, or `bad-request` naming what about it is not a name.
 * Everything is checked before the file is created, so a refused name leaves nothing behind.
 */
export function databaseFile(name: unknown, options: DatabasePathOptions = {}): string {
	if (typeof name !== "string" || name.trim() === "") {
		throw new CrustError("bad-request", 'database.open: "name" must be a non-empty string');
	}
	if (isAbsolute(name) || name.includes(sep) || name.includes("/") || name.includes("\\")) {
		throw new CrustError(
			"bad-request",
			`database.open: ${name} is a path, not a name — a name resolves inside the app's data directory`,
		);
	}
	if (name === "." || name === ".." || name.startsWith("..") || name.includes("..")) {
		throw new CrustError(
			"bad-request",
			`database.open: ${name} may not walk out of the app's data directory`,
		);
	}
	if (!NAME.test(name)) {
		throw new CrustError(
			"bad-request",
			`database.open: ${name} is not a database name — letters, digits, "_", "-" and "." only`,
		);
	}
	return join(
		databaseRoot(options),
		name.endsWith(DATABASE_SUFFIX) ? name : `${name}${DATABASE_SUFFIX}`,
	);
}

/**
 * The file, created with its directory, after the canonical path is proved inside the root. The
 * canonical check runs on the resolved form, so a symlink already sitting in the data directory
 * cannot carry the open outside it.
 */
export async function ensureDatabaseFile(
	name: unknown,
	options: DatabasePathOptions = {},
): Promise<string> {
	const file = databaseFile(name, options);
	const root = await canonical(databaseRoot(options));
	await mkdir(dirname(file), { recursive: true });
	const target = await canonical(file);
	if (!contains(root, target)) {
		throw new CrustError(
			"bad-request",
			`database.open: ${file} resolves outside the app's data directory`,
		);
	}
	return file;
}
