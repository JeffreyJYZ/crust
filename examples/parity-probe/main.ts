/**
 * The runtime parity probe: four surfaces the matrix used to mark "same" on compile evidence
 * alone, each proved by a real round trip and printed as one line, then one `parity:` summary.
 * It opens a 1x1 shell window for the runtime plus one 240x160 probe window, and both are gone
 * before it exits. The proofs live in `proofs.ts`; this file owns the run and the verdict.
 */
import { app } from "crust";
import { attempt, proofs, proveClipboard, proveMenu } from "./proofs.ts";
import { proveChrome, proveShortcut } from "./proofs-window.ts";

async function main(): Promise<void> {
	await app.run();
	console.log("windows   a 1x1 runtime shell plus one 240x160 probe window, closed before exit");
	attempt("menu", proveMenu);
	attempt("clipboard", proveClipboard);
	attempt("chrome", proveChrome);
	attempt("shortcut", proveShortcut);
	const passed = proofs.filter((proof) => proof.ok).length;
	const verdict = passed === proofs.length ? "PASS" : "FAIL";
	console.log(`parity: ${verdict} ${passed}/${proofs.length}`);
	process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((error: unknown) => {
	const why = error instanceof Error ? error.message : String(error);
	console.log(`parity: FAIL 0/0 — ${why}`);
	process.exit(1);
});
