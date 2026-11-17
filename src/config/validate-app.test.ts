import { describe, expect, test } from "bun:test";

import { validateConfig } from "@/config";

const base = { windows: [{ label: "main" }] };

function withApp(app: unknown): unknown {
	return { ...base, app };
}

describe("app config", () => {
	test("accepts a dotted reverse-domain id", () => {
		const app = { id: "dev.crust.shell", name: "Shell", version: "0.0.0" };
		expect(validateConfig(withApp(app)).app).toEqual(app);
	});

	test("refuses an id with a path separator or a dot token", () => {
		for (const id of ["../../evil", "..", ".", "a/b", "a\\b", "/etc", "C:\\evil"]) {
			expect(() => validateConfig(withApp({ id, name: "Shell", version: "0.0.0" }))).toThrow(
				/app\.id/,
			);
		}
	});
});
