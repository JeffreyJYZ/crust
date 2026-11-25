/**
 * `crust:i18n`'s disk loader: a directory of `*.json` files, each named for the locale it holds,
 * becomes the catalogue an app hands to `createI18nPlugin({ messages })` — no hand-written imports.
 * A file that is not valid JSON, or holds a non-object, is refused by path rather than skipped, so a
 * broken catalogue fails at load time instead of surfacing as a missing translation at runtime.
 * Reads are async so the bridge's pump never stalls on disk I/O while a page loads a catalogue.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CrustError } from "../bridge/errors";
import type { MessageCatalogue, MessageTable } from "./i18n-types";

const suffix = (cause: unknown): string => (cause instanceof Error ? `: ${cause.message}` : "");

/** Read every `*.json` in `directory`; each basename is a locale and each document a message table. */
export async function loadCatalogue(directory: string): Promise<MessageCatalogue> {
	if (typeof directory !== "string" || directory.length === 0) {
		throw new CrustError("bad-request", 'i18n.load: "directory" must be a non-empty string');
	}
	let files: string[];
	try {
		files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
	} catch (cause) {
		throw new CrustError("bad-request", `i18n.load: cannot read ${directory}${suffix(cause)}`);
	}
	const catalogue: MessageCatalogue = {};
	for (const file of files) {
		const path = join(directory, file);
		let parsed: unknown;
		try {
			parsed = JSON.parse(await readFile(path, "utf8"));
		} catch (cause) {
			throw new CrustError(
				"bad-request",
				`i18n.load: ${path} is not valid JSON${suffix(cause)}`,
			);
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new CrustError(
				"bad-request",
				`i18n.load: ${path} must hold an object of messages`,
			);
		}
		// A file named `__proto__.json` would otherwise hit the inherited setter and replace the
		// catalogue's prototype instead of adding a locale, which `Object.keys` hides.
		const locale = file.slice(0, -".json".length);
		if (locale === "__proto__" || locale === "constructor") continue;
		Object.defineProperty(catalogue, locale, {
			value: parsed as MessageTable,
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return catalogue;
}
