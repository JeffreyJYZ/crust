// p13.ts — the decision-relevant sweep: pump timeout vs tick fidelity and CPU.
//
// DESIGN.md §3 claims a 4 ms interval "costs almost nothing". That is testable:
// with a 4 ms *blocking* timeout, the pump holds the thread for the whole
// timeout on every call, so the timer duty cycle matters. Sweep the timeout and
// measure ticks delivered, jitter, and CPU burned.
//
// Policy stays 2 (prohibited): no activation, no Dock icon, no window.
import { loadAppKit, sharedApp, callI, callV, makeMode, cf, stat } from "./ffi";

const out: Record<string, any> = {};
out.appkitLoadMs = loadAppKit();
const app = sharedApp();
const pol = callI(app, "activationPolicy");
out.policy = pol.ok ? pol.value : pol.reason;
callV(app, "finishLaunching");
const mode = makeMode("kCFRunLoopDefaultMode");

const TICK_MS = 16;
const RUN_MS = 3000;

async function trial(pumpTimeoutMs: number | null, pumpEveryMs: number): Promise<any> {
	const stamps: number[] = [];
	const pumpTimes: number[] = [];
	let stop = false;
	const tick = setInterval(() => {
		if (stop) return;
		stamps.push(performance.now());
	}, TICK_MS);
	let pump = pumpEveryMs > 0 ? setInterval(() => {
		const t = performance.now();
		cf.CFRunLoopRunInMode(mode, (pumpTimeoutMs ?? 0) / 1000, true);
		pumpTimes.push(performance.now() - t);
	}, pumpEveryMs) : null;

	const cpu0 = process.cpuUsage();
	const start = performance.now();
	while (performance.now() - start < RUN_MS) await Bun.sleep(2);
	const elapsed = performance.now() - start;
	const cpu = process.cpuUsage(cpu0);
	stop = true;
	clearInterval(tick);
	if (pump) clearInterval(pump);

	const gaps: number[] = [];
	for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
	const g = stat(gaps);
	const p = stat(pumpTimes);
	return {
		pumpTimeoutMs: pumpTimeoutMs,
		pumpEveryMs,
		ticks: stamps.length,
		expected: Math.floor(elapsed / TICK_MS),
		deliveredPct: +((stamps.length / Math.floor(elapsed / TICK_MS)) * 100).toFixed(1),
		gapMedian: g.median,
		gapP99: g.p99,
		gapMax: g.max,
		pumps: p.n,
		pumpMean: p.mean,
		cpuPercent: +(((cpu.user + cpu.system) / 1000 / elapsed) * 100).toFixed(1),
	};
}

const rows: any[] = [];
rows.push(await trial(null, 0)); // baseline: no pump
for (const t of [0.25, 0.5, 1, 2, 4]) rows.push(await trial(t, t));
out.rows = rows;

for (const r of rows) {
	const label = r.pumpTimeoutMs === null ? "no pump" : `pump ${r.pumpTimeoutMs}ms`;
	console.log(
		`${label}: ticks ${r.ticks}/${r.expected} (${r.deliveredPct}%), gap median ${r.gapMedian} p99 ${r.gapP99} max ${r.gapMax}, pump n=${r.pumps} mean=${r.pumpMean}ms, cpu ${r.cpuPercent}%`,
	);
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);