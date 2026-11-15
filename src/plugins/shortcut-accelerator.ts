/**
 * The accelerator grammar: one text form into a key plus modifiers, with the canonical spelling every other module keys on. `CommandOrControl+Shift+K`, `Cmd+Shift+K` and `command+shift+k` are one registration, so a caller never registers the same hot key twice under two spellings.
 * It lives apart from `shortcuts.ts` because the parser is pure and the plugin is not, and because both halves must stay under the 200-line cap.
 */

import { CrustError } from "@/bridge/errors";

export type ShortcutModifier = "command" | "control" | "option" | "shift";

/** One accelerator, split. */
export interface ParsedAccelerator {
	accelerator: string;
	key: string;
	modifiers: readonly ShortcutModifier[];
}

/** A malformed accelerator. `part` is the token that was refused, verbatim. */
export class AcceleratorError extends CrustError {
	readonly part: string;

	constructor(message: string, part: string) {
		super("bad-request", message);
		this.name = "AcceleratorError";
		this.part = part;
	}
}

/** `<alias>:<canonical>` pairs, so `CommandOrControl` and `Ctrl` need no row each. */
const MODIFIER_TABLE =
	"commandorcontrol:command cmdorctrl:command command:command cmd:command super:command " +
	"meta:command control:control ctrl:control alt:option option:option opt:option shift:shift";

/** Canonical spelling order, so one registration has exactly one name. */
const MODIFIER_ORDER: readonly ShortcutModifier[] = ["command", "control", "option", "shift"];

const KEY_TABLE =
	"esc:escape return:enter delete:backspace del:forwarddelete arrowup:up arrowdown:down " +
	"arrowleft:left arrowright:right pgup:pageup pgdn:pagedown";

/** Every named key, plus the punctuation a key can be spelled as. */
const NAMED_KEYS = new Set(
	(
		"escape tab space enter backspace forwarddelete insert home end pageup pagedown up down " +
		"left right - = [ ] \\ ; ' , . / `"
	).split(" "),
);

function pairs(table: string): Map<string, string> {
	return new Map(
		table.split(" ").map((pair) => {
			const at = pair.indexOf(":");
			return [pair.slice(0, at), pair.slice(at + 1)] as const;
		}),
	);
}

const MODIFIERS = pairs(MODIFIER_TABLE) as Map<string, ShortcutModifier>;
const KEY_ALIASES = pairs(KEY_TABLE);

/** The canonical key name for a token, or `undefined` when the grammar has no such key. */
function canonicalKey(token: string): string | undefined {
	const key = token.toLowerCase();
	if (/^[a-z0-9]$/.test(key)) return key;
	if (/^f([1-9]|1[0-9])$/.test(key)) return key;
	const alias = KEY_ALIASES.get(key) ?? key;
	return NAMED_KEYS.has(alias) ? alias : undefined;
}

/**
 * The key is the last token and every earlier one is a modifier, the order Tauri
 * documents; an empty token is refused by name, so `"Cmd++K"` says which part broke.
 */
export function parseAccelerator(text: string): ParsedAccelerator {
	if (typeof text !== "string" || text.length === 0) {
		throw new AcceleratorError(
			'shortcut: "accelerator" must be a non-empty string',
			"accelerator",
		);
	}
	const parts = text.split("+").map((part) => part.trim());
	if (parts.length > MODIFIER_ORDER.length + 1) {
		throw new AcceleratorError(`shortcut: "${text}" has more parts than a modifier set`, text);
	}
	const seen: ShortcutModifier[] = [];
	for (const part of parts.slice(0, -1)) {
		const modifier = MODIFIERS.get(part.toLowerCase());
		if (modifier === undefined) {
			throw new AcceleratorError(
				`shortcut: "${text}" has an unknown modifier "${part}"`,
				part,
			);
		}
		if (seen.includes(modifier)) {
			throw new AcceleratorError(`shortcut: "${text}" repeats the modifier "${part}"`, part);
		}
		seen.push(modifier);
	}
	const keyToken = parts[parts.length - 1] ?? "";
	const key = canonicalKey(keyToken);
	if (key === undefined) {
		throw new AcceleratorError(
			`shortcut: "${text}" has an unknown key "${keyToken}"`,
			keyToken,
		);
	}
	const modifiers = MODIFIER_ORDER.filter((modifier) => seen.includes(modifier));
	return { accelerator: [...modifiers, key].join("+"), key, modifiers };
}
