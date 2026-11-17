/**
 * The detail line is the verdict a reader sees. These guard the three probes whose detail
 * used to claim a success their assertion had not measured. Each test reads the probe source:
 * the probes launch windows and need an Aqua session, so the detail is the unit-testable edge.
 */
import { expect, test } from "bun:test";

const read = (path: string): Promise<string> => Bun.file(new URL(path, import.meta.url)).text();

const native = await read("./e2e-native.ts");
const notify = await read("./e2e-notify.ts");
const menuProof = await read("../examples/parity-probe/proofs.ts");
const shortcutProof = await read("../examples/parity-probe/proofs-window.ts");

test("direct ffi detail names the printed epochs, not an unmeasured ordering", () => {
	expect(native).not.toContain("before the window opened");
	expect(native).toContain("main.ts printed a direct epoch from both dylibs");
	expect(native).toContain("main.ts printed no direct epoch from");
	// The same booleans drive both the assertion and the detail.
	expect(native).toMatch(/directZig && directRust,\n\s+directZig && directRust\n\s+\?/);
});

test("notify survivor detail follows the survivor count", () => {
	expect(notify).toContain("survivors.length === 0");
	expect(notify).toContain('`pid ${survivors.join(", ")} still running`');
});

test("unavailable menu and shortcut surfaces are marked false", () => {
	expect(menuProof).toMatch(/read unavailable[^\n]*\n\s+return mark\("menu", false\)/);
	expect(shortcutProof).toMatch(/seam unavailable[^\n]*\n\s+return mark\("shortcut", false\)/);
});
