import { describe, expect, test } from "bun:test";
import { ConfigError, validateConfig } from "@/config";

const base = {
	app: { id: "dev.crust.minsize", name: "MinSize", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function withWindow(window: Record<string, unknown>): unknown {
	return { ...base, windows: [window] };
}

describe("window minimums in config", () => {
	test("minHeight is accepted as a positive integer and carried through", () => {
		const config = validateConfig(withWindow({ label: "main", minHeight: 480 }));
		expect(config.windows[0]?.minHeight).toBe(480);
	});

	test("minWidth is still validated and carried through", () => {
		const config = validateConfig(withWindow({ label: "main", minWidth: 640 }));
		expect(config.windows[0]?.minWidth).toBe(640);
	});

	test("both absent stays absent, so the platform default decides", () => {
		const config = validateConfig(base);
		expect(config.windows[0]?.minWidth).toBeUndefined();
		expect(config.windows[0]?.minHeight).toBeUndefined();
	});

	test("an invalid minHeight is refused and names the key", () => {
		for (const bad of [0, -1, 1.5, "480", null, true]) {
			try {
				validateConfig(withWindow({ label: "main", minHeight: bad }));
				throw new Error("expected a ConfigError");
			} catch (error) {
				expect(error).toBeInstanceOf(ConfigError);
				expect((error as ConfigError).issues[0]?.path).toBe("windows[0].minHeight");
			}
		}
	});
});
