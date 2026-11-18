/**
 * The updater example proof, run headlessly against the shipped plugin. This is the regression
 * guard for the `check` URL policy: a loopback http manifest is refused, so the proof uses a
 * `file:` manifest with `updater.allowFileUrl`. Before that fix this test was red.
 *
 * Run with `bun test examples/parity-probe/proofs-updater.test.ts`. No window and no bridge: the
 * proof builds two fake bundles under a temp dir and removes them in its `finally`.
 */
import { expect, test } from "bun:test";
import { proveUpdater } from "./proofs-updater.ts";

test("the updater proof passes with a file: manifest under the check URL policy", async () => {
	expect(await proveUpdater()).toBe(true);
});
