import { describe } from "./issues.ts";
import type { ConfigIssue } from "./types.ts";

export type Dict = Record<string, unknown>;

export function isDict(value: unknown): value is Dict {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Collects every issue rather than throwing on the first, so one run reports the
 * whole config. Each check takes the path of the object it reads from.
 */
export class Validator {
	readonly issues: ConfigIssue[] = [];

	fail(path: string, expected: string, value: unknown): void {
		this.issues.push({ path, expected, received: describe(value) });
	}

	object(path: string, value: unknown): Dict | undefined {
		if (!isDict(value)) {
			this.fail(path, "an object", value);
			return undefined;
		}
		return value;
	}

	only(obj: Dict, path: string, allowed: readonly string[]): void {
		for (const key of Object.keys(obj)) {
			if (!allowed.includes(key)) {
				this.fail(
					path ? `${path}.${key}` : key,
					`one of ${allowed.map((name) => `"${name}"`).join(", ")}`,
					obj[key],
				);
			}
		}
	}

	string(obj: Dict, key: string, path: string, required: boolean): string | undefined {
		const value = obj[key];
		if (value === undefined) {
			if (required) this.fail(`${path}.${key}`, "a non-empty string", value);
			return undefined;
		}
		if (typeof value !== "string" || value.trim() === "") {
			this.fail(`${path}.${key}`, "a non-empty string", value);
			return undefined;
		}
		return value;
	}

	positiveInteger(obj: Dict, key: string, path: string): number | undefined {
		const value = obj[key];
		if (value === undefined) return undefined;
		if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
			this.fail(`${path}.${key}`, "a positive integer", value);
			return undefined;
		}
		return value;
	}

	stringArray(obj: Dict, key: string, path: string): string[] | undefined {
		const value = obj[key];
		if (value === undefined) return undefined;
		if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
			this.fail(`${path}.${key}`, "an array of strings", value);
			return undefined;
		}
		return value as string[];
	}
}
