import { afterEach, describe, expect, test } from "bun:test";
import { type WindowMaterial, ConfigError, validateConfig } from "@/config";

const base = {
	app: { id: "dev.crust.material", name: "Material", version: "0.0.0" },
	windows: [{ label: "main" }],
};

const real = process.platform;
/** Validation reads `process.platform`, so pretend to be another OS for one call. */
function asPlatform(name: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value: name, configurable: true });
}
afterEach(() => asPlatform(real));

function accept(...windows: Array<Record<string, unknown>>): void {
	for (const window of windows)
		expect(validateConfig({ ...base, windows: [window] }).windows[0]?.material).toBe(
			window.material as WindowMaterial | undefined,
		);
}

function refuse(material: unknown, platform: NodeJS.Platform): void {
	asPlatform(platform);
	try {
		validateConfig({ ...base, windows: [{ label: "main", material }] });
		throw new Error("expected a ConfigError");
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		expect((error as ConfigError).issues[0]?.path).toBe("windows[0].material");
		expect((error as ConfigError).issues[0]?.expected).toContain(platform);
	}
}

describe("window material in config", () => {
	test("each platform accepts its own backdrops and none", () => {
		asPlatform("darwin");
		accept({ label: "main", material: "vibrancy" }, { label: "main", material: "none" });
		asPlatform("win32");
		accept(
			{ label: "main", material: "mica" },
			{ label: "main", material: "acrylic" },
			{ label: "main", material: "tabbed" },
			{ label: "main", material: "none" },
		);
		asPlatform("linux");
		accept({ label: "main", material: "none" });
	});

	test("linux refuses a named material by name, not silently", () => {
		refuse("vibrancy", "linux");
		refuse("mica", "linux");
		refuse("acrylic", "linux");
	});

	test("a platform rejects the other platform's material", () => {
		refuse("mica", "darwin");
		refuse("vibrancy", "win32");
		refuse("tabbed", "darwin");
	});

	test("an unknown value or wrong type is refused", () => {
		refuse("glass", "darwin");
		refuse(7, "win32");
	});

	test("absent material stays absent", () => {
		asPlatform("linux");
		expect(validateConfig(base).windows[0]?.material).toBeUndefined();
	});
});
