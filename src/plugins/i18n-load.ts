/**
 * `crust:i18n`'s disk loader: a directory of `*.json` files, each named for the locale it holds,
 * becomes the catalogue an app hands to `createI18nPlugin({ messages })` — no hand-written imports.
 * A file that is not valid JSON, or holds a non-object, is refused by path rather than skipped, so a
 * broken catalogue fails at load time instead of surfacing as a missing translation at runtime.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CrustError } from "../bridge/errors";
import type { MessageCatalogue, MessageTable } from "./i18n-types";

const suffix = (cause: unknown): string => (cause instanceof Error ? `: ${cause.message}` : "");

/** Read every `*.json` in `directory`; each basename is a locale and each document a message table. */
export function loadCatalogue(directory: string): MessageCatalogue {
	if (typeof directory !== "string" || directory.length === 0) {
		throw new CrustError("bad-request", 'i18n.load: "directory" must be a non-empty string');
	}
	let files: string[];
	try {
		files = readdirSync(directory).filter((name) => name.endsWith(".json"));
	} catch (cause) {
		throw new CrustError("bad-request", `i18n.load: cannot read ${directory}${suffix(cause)}`);
	}
	const catalogue: MessageCatalogue = {};
	for (const file of files) {
		const path = join(directory, file);
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(path, "utf8"));
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
		catalogue[file.slice(0, -".json".length)] = parsed as MessageTable;
	}
	return catalogue;
}
