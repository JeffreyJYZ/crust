/**
 * E2E for capability binding, on the real bridge and in a real browser. Two
 * bridge-served documents get different `?window=` labels and therefore
 * different tokens; each page's own script posts an invoke that claims window
 * B's label. A's token must not inherit B's grant; B's must. The pre-fix bridge
 * took the label from the body, so A's spoof answered 200 — this proves it does
 * not. Browser focus is captured before the first launch and restored in finally.
 */
import { captureFrontmost, restoreFocus, Verdict } from "./e2e-harness.ts";
import { close, run, SESSION } from "./capability/browser.ts";
import {
	documentUrl,
	PAGE_PROBE_SOURCE,
	startFixtureBridge,
	type PageProbe,
} from "./capability/fixture.ts";

/** agent-browser prints JSON alone on stdout; take the object even with a warning on stderr. */
function probeOf(text: string): PageProbe {
	const open = text.indexOf("{");
	if (open === -1) throw new Error(`no JSON in eval output: ${text.slice(0, 200)}`);
	return JSON.parse(text.slice(open)) as PageProbe;
}

async function main(): Promise<number> {
	const verdict = new Verdict();
	const frontmost = await captureFrontmost();
	const encoded = Buffer.from(PAGE_PROBE_SOURCE).toString("base64");
	let closed = false;
	try {
		const bridge = startFixtureBridge();
		try {
			verdict.check(
				"bridge token",
				typeof bridge.token === "string" && bridge.token.length > 0,
				`started at ${bridge.url}`,
			);

			// Warm the daemon outside the assertion: its first launch prints a notice,
			// and an EAGAIN here is startup, not a failed proof.
			await run(["open", "about:blank"]);

			const probe = async (label: string): Promise<PageProbe> => {
				await run(["open", documentUrl(bridge, label)]);
				await run(["wait", "--load", "load"]);
				return probeOf(await run(["eval", "-b", encoded]));
			};
			const a = await probe("A");
			const b = await probe("B");

			verdict.check(
				"page A identity",
				a.hasToken && a.label === "A",
				`${a.label}, token ${a.hasToken}, ${a.href}`,
			);
			verdict.check("A own allowed", a.own.status === 200, `A:echo -> ${a.own.status}`);
			verdict.check(
				"A spoof refused",
				a.spoof.status === 403 && a.spoof.code === "forbidden",
				`A claiming B:secret -> ${a.spoof.status} ${a.spoof.code}`,
			);
			verdict.check(
				"page B identity",
				b.hasToken && b.label === "B",
				`${b.label}, token ${b.hasToken}, ${b.href}`,
			);
			verdict.check(
				"distinct documents",
				a.href !== b.href,
				"the two pages carry different document tokens",
			);
			verdict.check(
				"B own allowed",
				b.own.status === 200 && b.own.ok,
				`B:secret -> ${b.own.status}`,
			);
			verdict.check(
				"B spoof allowed",
				b.spoof.status === 200 && b.spoof.ok,
				`B claiming B:secret -> ${b.spoof.status}`,
			);
		} finally {
			// A throw still stops the bridge's port, so a red run leaks no listener.
			await bridge.stop().catch(() => undefined);
		}
	} catch (error) {
		verdict.check(
			"harness",
			false,
			`${error instanceof Error ? error.message : String(error)} (session ${SESSION})`,
		);
	} finally {
		if (!closed) {
			await close().catch(() => undefined);
			closed = true;
		}
		// Last, so a red run does not leave the human looking at the browser.
		await restoreFocus(frontmost);
	}

	return verdict.report("e2e-capability");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-capability: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
