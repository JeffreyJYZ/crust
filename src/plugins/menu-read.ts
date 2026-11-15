/**
 * `crust:menu`'s readback shape: what AppKit says the live menu holds, and the flat-to-tree assembly that turns the platform's rows into it. Pure — a platform hands over rows, so the assembly is testable with no menu open.
 */

/** One row as the platform reports it; `parent` is the index of the row it sits in, `-1` at the bar. */
export interface MenuReadRow {
	readonly parent: number;
	readonly title: string;
	readonly enabled: boolean;
	readonly hasSubmenu: boolean;
	readonly keyEquivalent: string;
	readonly modifierMask: number;
}

/** One row of the live menu. `children` is present only on a row that owns a submenu. */
export interface MenuReadItem {
	readonly title: string;
	readonly enabled: boolean;
	readonly hasSubmenu: boolean;
	readonly keyEquivalent: string;
	readonly modifierMask: number;
	readonly children?: readonly MenuReadItem[];
}

export interface MenuReadResult {
	readonly ok: true;
	readonly items: readonly MenuReadItem[];
}

export interface MenuDefaultResult {
	readonly ok: true;
	/** True when the bar is the one crust installed at launch, not one a caller built. */
	readonly isDefault: boolean;
}

/** A row mid-assembly: the same fields, with the children still mutable. */
interface Draft {
	readonly title: string;
	readonly enabled: boolean;
	readonly hasSubmenu: boolean;
	readonly keyEquivalent: string;
	readonly modifierMask: number;
	readonly children: Draft[];
}

function seal(draft: Draft): MenuReadItem {
	const item: MenuReadItem = {
		title: draft.title,
		enabled: draft.enabled,
		hasSubmenu: draft.hasSubmenu,
		keyEquivalent: draft.keyEquivalent,
		modifierMask: draft.modifierMask,
	};
	return draft.children.length === 0 ? item : { ...item, children: draft.children.map(seal) };
}

/**
 * Rebuild the tree from rows a platform flattened in order, each row naming its parent's index. A row whose parent is out of range is kept at the bar rather than dropped: the bar is what a caller can still verify.
 */
export function menuTree(rows: readonly MenuReadRow[]): MenuReadItem[] {
	const drafts: Draft[] = rows.map((row) => ({
		title: row.title,
		enabled: row.enabled,
		hasSubmenu: row.hasSubmenu,
		keyEquivalent: row.keyEquivalent,
		modifierMask: row.modifierMask,
		children: [],
	}));
	const roots: Draft[] = [];
	drafts.forEach((draft, index) => {
		const parent = rows[index]?.parent ?? -1;
		const host = parent < 0 ? undefined : drafts[parent];
		if (host) host.children.push(draft);
		else roots.push(draft);
	});
	return roots.map(seal);
}
