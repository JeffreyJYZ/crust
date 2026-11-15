/**
 * `crust:menu`'s spec grammar: the item tree and the accelerator text, parsed into the plan an adapter builds. Pure — no adapter, no AppKit — so every refusal is testable without opening a menu, and the plugin keeps only the command surface.
 */

export type MenuModifier = "command" | "control" | "option" | "shift";

/** One row of a spec. `label` is required unless `separator`; `id` defaults to it. */
export interface MenuItemSpec {
	label: string;
	id?: string;
	accelerator?: string;
	separator?: boolean;
	submenu?: readonly MenuItemSpec[];
}

/** A row after parsing: the id a selection carries, and the accelerator split. */
export interface MenuItemPlan {
	label: string;
	id: string;
	key: string;
	modifiers: readonly MenuModifier[];
	separator: boolean;
	/** Present only on a container; a leaf has none. */
	submenu?: readonly MenuItemPlan[];
}

/** Why a menu command could not answer. */
export type MenuFailureCode =
	"bad-items" | "bad-accelerator" | "bad-coordinates" | "unknown-adapter" | "handler-error";

/** A spec the plugin refuses; `code` is the failure it becomes, `part` the token. */
export class MenuSpecError extends Error {
	readonly code: MenuFailureCode;
	readonly part?: string;

	constructor(code: MenuFailureCode, message: string, part?: string) {
		super(message);
		this.name = "MenuSpecError";
		this.code = code;
		if (part !== undefined) this.part = part;
	}
}

/** The four accepted modifier spellings, and the order a canonical name uses. */
const MODIFIERS = new Map<string, MenuModifier>([
	["cmd", "command"],
	["ctrl", "control"],
	["alt", "option"],
	["shift", "shift"],
]);

const ORDER: readonly MenuModifier[] = ["command", "control", "option", "shift"];

/**
 * `Cmd/Ctrl/Alt/Shift+<key>` only: at least one modifier, one printable ASCII key. A bare key would swallow ordinary typing in the webview, and a wider spelling (`CommandOrControl`, `Super`) has no single AppKit mask, so both are refused with the token that broke.
 */
export function parseAccelerator(text: string): {
	key: string;
	modifiers: readonly MenuModifier[];
} {
	if (typeof text !== "string" || text.length === 0) {
		throw new MenuSpecError(
			"bad-accelerator",
			'menu: "accelerator" must be a non-empty string',
			"accelerator",
		);
	}
	const parts = text.split("+").map((part) => part.trim());
	const keyToken = parts[parts.length - 1] ?? "";
	const seen: MenuModifier[] = [];
	for (const part of parts.slice(0, -1)) {
		const modifier = MODIFIERS.get(part.toLowerCase());
		if (modifier === undefined) {
			throw new MenuSpecError(
				"bad-accelerator",
				`menu: "${text}" has an unknown modifier "${part}" — only Cmd, Ctrl, Alt and Shift are accepted`,
				part,
			);
		}
		if (seen.includes(modifier)) {
			throw new MenuSpecError(
				"bad-accelerator",
				`menu: "${text}" repeats the modifier "${part}"`,
				part,
			);
		}
		seen.push(modifier);
	}
	if (seen.length === 0) {
		throw new MenuSpecError(
			"bad-accelerator",
			`menu: "${text}" needs one of Cmd, Ctrl, Alt or Shift before the key`,
			text,
		);
	}
	if (!/^[!-~]$/.test(keyToken)) {
		throw new MenuSpecError(
			"bad-accelerator",
			`menu: "${text}" has an unknown key "${keyToken}" — one printable ASCII character`,
			keyToken,
		);
	}
	return {
		key: keyToken.toLowerCase(),
		modifiers: ORDER.filter((modifier) => seen.includes(modifier)),
	};
}

/** One row, parsed. Structural problems are `bad-items`; an accelerator keeps its own code. */
export function planRow(entry: unknown, where: string, ids: Set<string>): MenuItemPlan {
	if (typeof entry !== "object" || entry === null) {
		throw new MenuSpecError("bad-items", `menu: ${where} must be an object`);
	}
	const raw = entry as Record<string, unknown>;
	if (raw.separator === true) {
		if (raw.submenu !== undefined) {
			throw new MenuSpecError(
				"bad-items",
				`menu: ${where} is a separator and cannot carry a submenu`,
			);
		}
		return { label: "", id: "", key: "", modifiers: [], separator: true };
	}
	const label = raw.label;
	if (typeof label !== "string" || label.length === 0) {
		throw new MenuSpecError("bad-items", `menu: ${where} needs a non-empty label`);
	}
	const id = raw.id ?? label;
	if (typeof id !== "string" || id.length === 0) {
		throw new MenuSpecError(
			"bad-items",
			`menu: ${where}.id must be a non-empty string when given`,
		);
	}
	const container = raw.submenu !== undefined;
	if (!container && ids.has(id)) {
		throw new MenuSpecError(
			"bad-items",
			`menu: ${where}.id "${id}" is used twice, so a selection could not say which row it was`,
		);
	}
	if (!container) ids.add(id);
	let key = "";
	let modifiers: readonly MenuModifier[] = [];
	if (raw.accelerator !== undefined) {
		if (typeof raw.accelerator !== "string") {
			throw new MenuSpecError(
				"bad-accelerator",
				`menu: ${where}.accelerator must be a string`,
				"accelerator",
			);
		}
		const parsed = parseAccelerator(raw.accelerator);
		key = parsed.key;
		modifiers = parsed.modifiers;
	}
	if (!container) return { label, id, key, modifiers, separator: false };
	if (!Array.isArray(raw.submenu)) {
		throw new MenuSpecError("bad-items", `menu: ${where}.submenu must be an array`);
	}
	const submenu = raw.submenu.map((child, index) =>
		planRow(child, `${where}.submenu[${index}]`, ids),
	);
	return { label, id, key, modifiers, separator: false, submenu };
}

/** Selectable rows in a tree: separators and container entries are not selectable. */
export function leafCount(items: readonly MenuItemPlan[]): number {
	let total = 0;
	for (const item of items) {
		if (item.separator) continue;
		total += item.submenu === undefined ? 1 : leafCount(item.submenu);
	}
	return total;
}

/** The context menu's point: page CSS pixels, both finite, refused by name otherwise. */
export function readPoint(args: unknown): { x: number; y: number } {
	const raw = args as { x?: unknown; y?: unknown } | null;
	const x = raw?.x;
	const y = raw?.y;
	if (
		typeof x !== "number" ||
		typeof y !== "number" ||
		!Number.isFinite(x) ||
		!Number.isFinite(y)
	) {
		throw new MenuSpecError(
			"bad-coordinates",
			"menu.showContext needs { x, y } with finite numbers, in page pixels",
		);
	}
	return { x, y };
}
