/**
 * Reading the page's answers: one line per window command, in the two shapes a
 * promise can settle in. Everything here is about a captured log, not a run.
 */

/** A page answer, as either shape above. `value` stays unknown until narrowed. */
export interface PageAnswer {
	how?: string;
	value?: unknown;
	name?: string;
	code?: string;
	status?: number;
	message?: string;
}

/** Every `  page      <tag> <json>` line, in order. */
export function pageLines(text: string): { tag: string; answer: PageAnswer }[] {
	const found: { tag: string; answer: PageAnswer }[] = [];
	for (const line of text.split("\n")) {
		const match = /^\s+page\s+(\S+)\s+(\{.*\})\s*$/.exec(line);
		const tag = match?.[1];
		const json = match?.[2];
		if (tag === undefined || json === undefined) continue;
		// A truncated answer is still counted; only its fields are missing.
		found.push({ tag, answer: JSON.parse(json) as PageAnswer });
	}
	return found;
}

/** The value of a resolved answer, when it is the object a window command answers. */
export function resolved(answer: PageAnswer | undefined): Record<string, unknown> | undefined {
	if (answer?.how !== "resolved") return undefined;
	const value = answer.value;
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

/** A resolved `list` answer's labels, or undefined when it is not one. */
export function labelsOf(answer: PageAnswer | undefined): string[] | undefined {
	const labels = resolved(answer)?.labels;
	if (!Array.isArray(labels)) return undefined;
	return labels.every((label) => typeof label === "string") ? (labels as string[]) : undefined;
}

/** Whether `list` answered exactly this set of labels. */
export function sameLabels(answer: PageAnswer | undefined, expected: readonly string[]): boolean {
	const labels = labelsOf(answer);
	if (labels === undefined || labels.length !== expected.length) return false;
	return [...labels].sort().join("\n") === [...expected].sort().join("\n");
}

/** The origin of an absolute URL, or undefined when it is not one. */
export function originOf(href: string): string | undefined {
	try {
		return new URL(href).origin;
	} catch {
		return undefined;
	}
}

/**
 * What a created window's own page reported: the document it loaded, and the
 * answer its own `invoke` got. Absent means that page never ran, which is the
 * first thing the child checks fail on.
 */
export interface ChildReport {
	href: string;
	open?: PageAnswer;
}

export function childReport(answer: PageAnswer | undefined): ChildReport | undefined {
	// `resolved` already unwraps the answer's `value`, which is the object the
	// child page built: `{ href, open }`.
	const value = resolved(answer);
	if (typeof value !== "object" || value === null) return undefined;
	const bag = value as { href?: unknown; open?: unknown };
	if (typeof bag.href !== "string") return undefined;
	const open =
		typeof bag.open === "object" && bag.open !== null ? (bag.open as PageAnswer) : undefined;
	return { href: bag.href, open };
}

/**
 * Whether the page was told the window is gone. Measured, and the only truthful answer: the platform reports only the windows AppKit still holds, so a closed label is absent from `list`, and the plugin's existence check answers `unknown-window` first. That branch is unreachable from a page — `window.test.ts`'s fake still models the older "closed but listed, number 0" platform, which is why it sees `open: false` and this proof cannot.
 */
export function goneAnswer(answer: PageAnswer | undefined): boolean {
	const value = resolved(answer);
	return value?.ok === false && value?.code === "unknown-window";
}

/** A short, single-line form of anything, for a verdict detail. */
export function show(value: unknown): string {
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value) ?? String(value);
		} catch {
			text = String(value);
		}
	}
	return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}
