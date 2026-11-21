import { describe, expect, test } from "bun:test";
import { ConfigError, validateConfig, type CrustConfig } from "@/config";

const base = {
	app: { id: "dev.crust.features", name: "Features", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function issue(section: Record<string, unknown>): { path: string; expected: string } | undefined {
	try {
		validateConfig({ ...base, ...section });
		return undefined;
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		return (error as ConfigError).issues[0];
	}
}

describe("pty, preview and browser sections", () => {
	test("each section is optional, so an app that declares none validates unchanged", () => {
		const config = validateConfig(base) as CrustConfig;
		expect(config.pty).toBe(undefined);
		expect(config.preview).toBe(undefined);
		expect(config.browser).toBe(undefined);
	});

	test("an empty section is valid, because the section itself is the opt-in", () => {
		const config = validateConfig({ ...base, pty: {}, preview: {}, browser: {} });
		expect(config).toMatchObject({ pty: {}, preview: {}, browser: {} });
	});

	test("pty.shell must be a non-empty string and the message names the key", () => {
		expect(issue({ pty: { shell: "/bin/zsh" } })).toBe(undefined);
		expect(issue({ pty: { shell: "" } })?.path).toBe("pty.shell");
		expect(issue({ pty: { shell: 42 } })?.path).toBe("pty.shell");
	});

	test("a non-object pty names pty", () => {
		expect(issue({ pty: "/bin/zsh" })?.path).toBe("pty");
	});

	test("an unknown key inside pty is refused by its own name", () => {
		expect(issue({ pty: { sh: "zsh" } })?.path).toBe("pty.sh");
	});

	test("preview dimensions are positive integers, each named by key", () => {
		expect(issue({ preview: { width: 640, height: 480 } })).toBe(undefined);
		expect(issue({ preview: { width: 0 } })?.path).toBe("preview.width");
		expect(issue({ preview: { height: "480" } })?.path).toBe("preview.height");
		expect(issue({ preview: { w: 640 } })?.path).toBe("preview.w");
	});

	test("browser.origins must be an array, named by key", () => {
		expect(issue({ browser: { origins: ["https://example.com"] } })).toBe(undefined);
		expect(issue({ browser: { origins: "https://example.com" } })?.path).toBe(
			"browser.origins",
		);
		expect(issue({ browser: { origin: ["https://example.com"] } })?.path).toBe(
			"browser.origin",
		);
	});

	test("an origin that is not http(s) is refused by index", () => {
		expect(issue({ browser: { origins: ["file:///etc"] } })?.path).toBe("browser.origins[0]");
		expect(issue({ browser: { origins: ["example.com"] } })?.path).toBe("browser.origins[0]");
		expect(issue({ browser: { origins: [42] } })?.path).toBe("browser.origins[0]");
	});

	test("an origin carrying a path is refused rather than authorising nothing", () => {
		expect(issue({ browser: { origins: ["https://example.com/app"] } })?.path).toBe(
			"browser.origins[0]",
		);
	});

	test("http origins and a trailing slash are carried through", () => {
		const config = validateConfig({
			...base,
			browser: { origins: ["https://example.com", "http://localhost:4321/"] },
		}) as CrustConfig;
		expect(config.browser?.origins).toEqual(["https://example.com", "http://localhost:4321/"]);
	});
});
