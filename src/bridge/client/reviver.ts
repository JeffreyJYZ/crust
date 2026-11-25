/**
 * The byte-tagging reviver, split out of `installInvoke` for the 200-line cap. Like every client
 * half it is injected with `Function.prototype.toString()`, so all runtime code stays in this
 * function and nothing is read from module scope.
 */

/** Revive one tagged result one level deep, keeping reserved keys as own data fields. */
export type Revive = (value: any, depth: number) => any;

export function installReviver(_scope: Record<string, any>): Revive {
	// A binary result arrives tagged `{ __crustBytes: base64 }`, revived one level deep; a data
	// object that carried a tag key arrives as `{ __crustLiteral: … }` and is handed back whole.
	const put = (out: any, key: string, value: any) => {
		Object.defineProperty(out, key, {
			value,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	};
	const revive = (value: any, depth: number): any => {
		if (depth > 1 || value === null || typeof value !== "object") return value;
		if (
			typeof value.__crustLiteral === "object" &&
			value.__crustLiteral !== null &&
			!Array.isArray(value.__crustLiteral)
		) {
			// Real data that merely carried a tag key. Walk its *values* one level down, so the
			// object itself is never read as a tag while a genuine binary inside it still revives.
			const literal = value.__crustLiteral;
			const out: any = {};
			for (const key of Object.keys(literal)) put(out, key, revive(literal[key], depth + 1));
			return out;
		}
		if (typeof value.__crustBytes === "string") {
			return Uint8Array.from(atob(value.__crustBytes), (char) => char.charCodeAt(0));
		}
		const out: any = Array.isArray(value) ? [] : {};
		for (const key of Object.keys(value)) put(out, key, revive(value[key], depth + 1));
		return out;
	};
	return revive;
}
