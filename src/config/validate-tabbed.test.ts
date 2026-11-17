import { afterEach, describe, expect, test } from "bun:test";
import { ConfigError, type WindowMaterial, validateConfig } from "@/config";
import { allowedWindowMaterials } from "@/config/validate-windows.ts";

const base = {
	app: { id: "dev.crust.tabbed", name: "Tabbed", version: "0.0.0" },
	windows: [{ label: "main" }],
};

const real = process.platform;
function asPlatform(name: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value: name, configurable: true });
}
afterEach(() => asPlatform(real));

function accept(material: WindowMaterial, platform: NodeJS.Platform): void {
	asPlatform(platform);
	const config = { ...base, windows: [{ label: "main", material }] };
	expect(validateConfig(config).windows[0]?.material).toBe(material);
}

function refuseTabbed(platform: NodeJS.Platform): void {
	asPlatform(platform);
	try {
		validateConfig({ ...base, windows: [{ label: "main", material: "tabbed" }] });
		throw new Error("expected a ConfigError");
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		const issue = (error as ConfigError).issues[0];
		expect(issue?.path).toBe("windows[0].material");
		expect(issue?.received).toBe('"tabbed"');
		expect(issue?.expected).toContain(platform);
		expect(issue?.expected).not.toContain("tabbed");
	}
}

describe("tabbed material in config", () => {
	test("is a Windows 11 backdrop that win32 accepts", () => {
		accept("tabbed", "win32");
		expect(allowedWindowMaterials("win32")).toContain("tabbed");
	});

	test("macOS and Linux refuse tabbed by name, never silently", () => {
		refuseTabbed("darwin");
		refuseTabbed("linux");
	});
});
