import type { ConfigIssue } from "./types.ts";

/** Short form of a received value, for the `got …` half of an issue line. */
export function describe(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	if (Array.isArray(value)) return value.length === 0 ? "an empty array" : "an array";
	if (typeof value === "string") return `"${value}"`;
	return String(value);
}

export class ConfigError extends Error {
	readonly issues: ConfigIssue[];

	constructor(source: string, issues: ConfigIssue[]) {
		super(formatIssues(source, issues));
		this.name = "ConfigError";
		this.issues = issues;
	}
}

function formatIssues(source: string, issues: ConfigIssue[]): string {
	const lines = [`invalid crust config in ${source}:`];
	for (const issue of issues) {
		const received = issue.received === undefined ? "" : `, got ${issue.received}`;
		lines.push(`  ${issue.path || "config"} — expected ${issue.expected}${received}`);
	}
	return lines.join("\n");
}
