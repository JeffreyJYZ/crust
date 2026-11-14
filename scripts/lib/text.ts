/**
 * The small text and timing helpers every e2e script needs.
 *
 * They were copied into each script while the scripts were separate files; the
 * copies are identical, so they live here once. Nothing here knows about crust.
 */
import type { Verdict } from "../e2e-harness.ts";

export function delay(ms: number): Promise<"delay"> {
	return new Promise((resolve) => setTimeout(() => resolve("delay"), ms));
}

/** The last non-empty line of a captured stream, for a failure detail. */
export function lastLine(text: string): string {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	return lines.at(-1)?.trim() ?? "";
}

/** A duration as a human reads it, or `no exit` when the child never left. */
export function seconds(ms: number | null): string {
	return ms === null ? "no exit" : `${(ms / 1000).toFixed(2)} s`;
}

/** Mark every listed assertion failed when an earlier step made them unknowable. */
export function skip(verdict: Verdict, names: readonly string[], why: string): void {
	for (const name of names) verdict.check(name, false, why);
}

/** Every match count of `pattern` in `text`, for "did it happen twice" checks. */
export function count(text: string, pattern: RegExp): number {
	const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
	return [...text.matchAll(new RegExp(pattern.source, flags))].length;
}

/** The whole line holding the `which`th (1-based) match of `pattern`. */
export function nthLine(text: string, pattern: RegExp, which: number): string | null {
	const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
	const found = [...text.matchAll(new RegExp(pattern.source, flags))][which - 1];
	if (!found || found.index === undefined) return null;
	const start = text.lastIndexOf("\n", found.index) + 1;
	const end = text.indexOf("\n", found.index);
	return text.slice(start, end === -1 ? undefined : end).trim();
}
