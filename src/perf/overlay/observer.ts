/**
 * The `PerformanceObserver` seam. A constructor is usable only when its static entry types name
 * `longtask` and its prototype really has `observe`/`disconnect`; reading the static member once
 * also avoids two getter evaluations for the same value.
 */

export interface Observer {
	observe(args: { type: string }): void;
	disconnect(): void;
}

export type ObserverCtor = new (
	cb: (list: { getEntries(): Array<{ startTime: number }> }) => void,
) => Observer;

export function observerCtor(value: unknown): ObserverCtor | undefined {
	if (typeof value !== "function") return undefined;
	const types = (value as { supportedEntryTypes?: unknown }).supportedEntryTypes;
	if (
		!Array.isArray(types) ||
		!types.includes("longtask") ||
		!types.every((entry: unknown) => typeof entry === "string")
	)
		return undefined;
	const prototype = (value as { prototype?: unknown }).prototype;
	if (typeof prototype !== "object" || prototype === null) return undefined;
	const methods = prototype as { observe?: unknown; disconnect?: unknown };
	if (typeof methods.observe !== "function" || typeof methods.disconnect !== "function")
		return undefined;
	return value as ObserverCtor;
}
