/**
 * The matcher on its own: `*` is the only metacharacter, the colon is the plugin/command separator
 * so `dialog:*` cannot reach a plugin merely named `dialogx`, and a grant naming an unknown
 * capability is dropped rather than widened.
 */

import { describe, expect, test } from "bun:test";
import { actionOf, compileCapabilities } from "./server/capabilities.ts";

function compiledWith(actions: string[], grants: Record<string, string[]>) {
	return compileCapabilities({ capabilities: [{ name: "grant", actions }], grants });
}

describe("capability matching", () => {
	test("`dialog:*` matches `dialog.openPanel`", () => {
		const compiled = compiledWith(["dialog:*"], { main: ["grant"] });
		expect(compiled.allows("main", actionOf("dialog", "openPanel"))).toBe(true);
	});

	test("`dialog:*` does not match `dialogx.openPanel`, because the colon is the separator", () => {
		const compiled = compiledWith(["dialog:*"], { main: ["grant"] });
		expect(compiled.allows("main", actionOf("dialogx", "openPanel"))).toBe(false);
	});

	test("`fs:read*` covers read commands and not a write", () => {
		const compiled = compiledWith(["fs:read*"], { main: ["grant"] });
		expect(compiled.allows("main", actionOf("fs", "readTextFile"))).toBe(true);
		expect(compiled.allows("main", actionOf("fs", "writeTextFile"))).toBe(false);
	});

	test("an exact action matches only itself", () => {
		const compiled = compiledWith(["shell:spawn"], { main: ["grant"] });
		expect(compiled.allows("main", actionOf("shell", "spawn"))).toBe(true);
		expect(compiled.allows("main", actionOf("shell", "kill"))).toBe(false);
		expect(compiled.allows("main", actionOf("shellspawn", "x"))).toBe(false);
	});

	test("a grant naming an unknown capability is dropped, never widened", () => {
		const compiled = compiledWith(["shell:spawn"], { main: ["nope"] });
		expect(compiled.allows("main", actionOf("shell", "spawn"))).toBe(false);
	});

	test("the refusal names the capability that would have allowed it", () => {
		const compiled = compiledWith(["shell:*"], { main: ["nothing"] });
		expect(compiled.covering("/missing")).toBe(undefined);
		expect(compiled.covering(actionOf("shell", "spawn"))).toBe("grant");
	});
});
