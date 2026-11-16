/**
 * The event-stream step, which the invoke step cannot prove: an invoke has one answer per call,
 * while an event is pushed with no caller waiting. It lives beside `proof-steps.ts` rather than in
 * it because the two are different questions, and the file cap is the same reason the rest of this
 * harness is split.
 */
import type { LinuxProofShim } from "../../src/platform/linux/shim-ffi.ts";
import { evaluate } from "./proof-eval.ts";
import type { Step } from "./proof-steps.ts";
import { EVENTS_PENDING, HELLO, type HeldEvents, type ProofPage, TICK } from "./proof-page.ts";

/** One script's round trip; the deadline is a hang guard, not the normal path. */
const EVAL_MS = 5_000;

/** A stream frame is a network round trip, so the poll is bounded the same way an invoke is. */
const EVENTS_POLLS = 40;

/** The page's own record of the stream, read back as one JSON document. */
const READ_EVENTS = "JSON.stringify(window.__crustEvents)";

/** The two halves of the event proof: the frames a page listener saw, and the connect frame. */
export interface EventProof {
	stream: Step;
	ready: Step;
}

/** Read the page's event record, or `undefined` when it answered something else. */
function parseHeld(text: string): HeldEvents | undefined {
	try {
		const value = JSON.parse(text) as HeldEvents;
		return typeof value === "object" && value !== null ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The stream in both directions. The page subscribed from inside its own document, and the host
 * pushed through the plugin's `ctx.emit` from a command the page asked for, so both frames travel
 * the app's own path rather than one the harness opened beside it. `crust:ready` rides the same
 * stream and is checked against the bridge's bound port, which no invoke answer could produce, so a
 * frame from anywhere else cannot stand in for it.
 */
export async function eventsStep(
	shim: LinuxProofShim,
	web: bigint,
	page: ProofPage | undefined,
	pageError: string,
): Promise<EventProof> {
	if (page === undefined) {
		const detail = `NOT PROVEN — the bridge could not start: ${pageError}`;
		return { stream: { ok: false, detail }, ready: { ok: false, detail } };
	}
	let held: HeldEvents = { listen: EVENTS_PENDING, once: EVENTS_PENDING, ready: "", frame: "" };
	for (let poll = 0; poll < EVENTS_POLLS; poll++) {
		const answer = await evaluate(shim, web, READ_EVENTS, EVAL_MS);
		const parsed = parseHeld(answer.text);
		if (parsed !== undefined) held = parsed;
		if (!answer.ok || parsed === undefined) break;
		if (held.listen !== EVENTS_PENDING && held.once !== EVENTS_PENDING) break;
		// A stream the bridge refused is settled: nothing more is coming, so say so now.
		if (held.stream !== undefined && held.stream !== "" && held.stream !== "200 open") break;
		await Bun.sleep(25);
	}

	const listened = held.listen === JSON.stringify(TICK);
	const once = held.once === JSON.stringify(HELLO);
	const reason = held.error ? `, the broadcast invoke failed: ${held.error}` : "";
	const stream: Step = {
		ok: listened && once,
		detail:
			listened && once
				? `listen received ${held.listen} after once received ${held.once}`
				: `listen held ${held.listen}, once held ${held.once}, crust.ready ${held.ready || "pending"}; ` +
					`the stream GET answered ${held.stream || "(no answer)"}${reason}`,
	};

	const expected = JSON.stringify({ port: page.port, protocol: 1 });
	const ready: Step = {
		ok: held.frame === expected,
		detail:
			held.frame === expected
				? `crust:ready arrived on the stream carrying ${held.frame}`
				: held.frame === ""
					? `no crust:ready frame reached a page listener; the stream GET answered ${held.stream || "(no answer)"}`
					: `crust:ready carried ${held.frame}, expected ${expected}`,
	};
	return { stream, ready };
}
