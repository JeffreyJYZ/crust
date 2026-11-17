import { describe, expect, test } from "bun:test";
import { pgrepLiteral } from "./extension-pattern";

describe("pgrepLiteral", () => {
	test("escape every metacharacter a repo path can contain", () => {
		expect(pgrepLiteral("/Users/jyz/dev/crust/examples/native/crust.config.ts")).toBe(
			"/Users/jyz/dev/crust/examples/native/crust\\.config\\.ts",
		);
		expect(pgrepLiteral("a+b(c)[d]{e}|f$g^h\\i")).toBe(
			"a\\+b\\(c\\)\\[d\\]\\{e\\}\\|f\\$g\\^h\\\\i",
		);
	});

	test("an escaped pattern matches only the literal text", () => {
		// The defect: `crust.config.ts` as a regex also matches `crustXconfig-ts`, so cleanup kills an
		// unrelated process. The escaped form matches the one path it names.
		const raw = new RegExp("/crust/examples/native/crust.config.ts");
		const literal = new RegExp(pgrepLiteral("/crust/examples/native/crust.config.ts"));
		expect(raw.test("/crust/examples/native/crustXconfig-ts")).toBe(true);
		expect(literal.test("/crust/examples/native/crustXconfig-ts")).toBe(false);
		expect(literal.test("/crust/examples/native/crust.config.ts")).toBe(true);
	});

	test("a pattern with no metacharacter is unchanged", () => {
		expect(pgrepLiteral("crust dev")).toBe("crust dev");
		expect(pgrepLiteral("")).toBe("");
	});

	test("the native e2e routes every survivor pattern through it", async () => {
		// The helper existing proves nothing if the script still hands `pgrep` a raw path; the call sites
		// are the fix, so they are asserted too.
		const source = await Bun.file(
			new URL("../../scripts/e2e-native.ts", import.meta.url),
		).text();
		expect(source).toContain(
			'const SURVIVOR_PATTERNS = [pgrepLiteral(CONFIG), pgrepLiteral("dev --dir examples/native")];',
		);
		expect(source).not.toContain("const SURVIVOR_PATTERNS = [CONFIG,");
	});
});
