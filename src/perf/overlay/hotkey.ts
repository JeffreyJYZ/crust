/**
 * Cmd+Shift+P toggles the overlay. The installer returns the exact remover, so `destroy()` cannot
 * leave a handler behind that toggles a dead instance. A document that refuses the listener
 * degrades to the API and returns no remover.
 */

export interface KeyHost {
	addEventListener?: (type: string, fn: (event: unknown) => void) => void;
	removeEventListener?: (type: string, fn: (event: unknown) => void) => void;
}

export function installHotkey(
	host: KeyHost | undefined,
	toggle: () => void,
): (() => void) | undefined {
	const onKeyDown = (event: unknown): void => {
		const e = event as { metaKey?: boolean; shiftKey?: boolean; key?: string };
		if (e.metaKey && e.shiftKey && e.key?.toLowerCase() === "p") toggle();
	};
	try {
		host?.addEventListener?.("keydown", onKeyDown);
	} catch {
		return undefined;
	}
	return () => {
		try {
			host?.removeEventListener?.("keydown", onKeyDown);
		} catch {
			// A document that refuses removal cannot toggle a destroyed instance.
		}
	};
}
