// p2.ts — claims 2, 3, 4.
//
// The app stays on the **prohibited** activation policy (2): a non-activating
// background process, no Dock icon and no menu bar. Nothing here activates, and
// nothing here opens a window.
import { loadAppKit, sharedApp, callI, makeMode, cf, stat, cfStringBytes } from "./ffi";

const mode = makeMode();
const out: Record<string, any> = { mode: Number(mode), modeName: cfStringBytes(mode) };
out.appkitLoadMs = loadAppKit();
const app = sharedApp();
const pol = callI(app, "activationPolicy");
out.policy = pol.ok ? pol.value : pol.reason;
out.policyNote = "2 = prohibited: background process, no Dock icon, no menu bar";

// --- claim 2: cost of 1000 pumps, no events pending -------------------------
{
	const times: number[] = [];
	const t0 = performance.now();
	for (let i = 0; i < 1000; i++) {
		const t = performance.now();
		cf.CFRunLoopRunInMode(mode, 0.004, true);
		times.push(performance.now() - t);
	}
	out.pump1000 = { ...stat(times), totalMs: +(performance.now() - t0).toFixed(2) };
}

// --- claims 3 and 4: tick fidelity ----------------------------------------
// Each run uses exactly one timer for ticks, plus optionally one timer that
// pumps. A tick is a bare timestamp; the pump is a separate concern.
const RUN_MS = 3000;
const TICK_MS = 16;

type Run = {
	label: string;
	ticks: number;
	gaps: { median: number; p99: number; max: number; mean: number };
	pump: { n: number; mean: number; p99: number; max: number };
	expectedTicks: number;
};

async function measure(label: string, kind: "interval" | "timeout", pumpEveryMs: number | null): Promise<Run> {
	const stamps: number[] = [];
	const pumpTimes: number[] = [];
	let stop = false;

	// one timer only
	if (kind === "interval") {
		const h = setInterval(() => {
			if (stop) return;
			stamps.push(performance.now());
		}, TICK_MS);
		var tickHandle: any = h;
	} else {
		let h: any;
		const loop = () => {
			if (stop) return;
			stamps.push(performance.now());
			h = setTimeout(loop, TICK_MS);
		};
		h = setTimeout(loop, TICK_MS);
		var tickHandle: any = h;
	}

	let pumpHandle: any = null;
	if (pumpEveryMs !== null) {
		pumpHandle = setInterval(() => {
			const t = performance.now();
			cf.CFRunLoopRunInMode(mode, pumpEveryMs / 1000, true);
			pumpTimes.push(performance.now() - t);
		}, pumpEveryMs);
	}

	const start = performance.now();
	while (performance.now() - start < RUN_MS) await Bun.sleep(2);
	const elapsed = performance.now() - start;
	stop = true;
	clearInterval(tickHandle);
	clearTimeout(tickHandle);
	if (pumpHandle) {
		clearInterval(pumpHandle);
		clearTimeout(pumpHandle);
	}

	const gaps: number[] = [];
	for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
	const g = stat(gaps);
	const p = stat(pumpTimes);
	return {
		label,
		ticks: stamps.length,
		gaps: { mean: g.mean, median: g.median, p99: g.p99, max: g.max },
		pump: { n: p.n, mean: p.mean, p99: p.p99, max: p.max },
		expectedTicks: Math.floor(elapsed / TICK_MS),
	};
}

const runs: Run[] = [];
runs.push(await measure("no pump, setInterval 16", "interval", null));
runs.push(await measure("no pump, setTimeout chain 16", "timeout", null));
runs.push(await measure("pump 4ms timer, setInterval 16", "interval", 4));
runs.push(await measure("pump 4ms timer, setTimeout chain 16", "timeout", 4));
out.runs = runs;

console.log(JSON.stringify(out, null, 2));
process.exit(0);