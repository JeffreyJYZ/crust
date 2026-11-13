// p16.ts — claim 4: repeating setInterval vs self-re-arming setTimeout chain.
//
// Both at the same tick (16 ms) and the same pump (0.25 ms, the tightest pump
// that still delivered 99.5% of ticks in p13). Ten seconds each, alternating, so
// any thermal or load drift hits both equally.
//
// Policy 2 (prohibited): no activation, no window.
import { loadAppKit, sharedApp, callI, callV, makeMode, cf, stat } from "./ffi";

const out: Record<string, any> = {};
out.appkitLoadMs = loadAppKit();
const app = sharedApp();
const pol = callI(app, "activationPolicy");
out.policy = pol.ok ? pol.value : pol.reason;
callV(app, "finishLaunching");
const mode = makeMode("kCFRunLoopDefaultMode");

const TICK = 16;
const RUN = 10000;

async function trial(kind: "interval" | "timeout", pumpMs: number): Promise<any> {
	const stamps: number[] = [];
	const pumpTimes: number[] = [];
	let stop = false;
	let h: any = null;

	const tick = () => {
		if (stop) return;
		stamps.push(performance.now());
		if (kind === "timeout") h = setTimeout(tick, TICK);
	};
	if (kind === "interval") h = setInterval(() => { if (!stop) stamps.push(performance.now()); }, TICK);
	else h = setTimeout(tick, TICK);

	const pump = setInterval(() => {
		const t = performance.now();
		cf.CFRunLoopRunInMode(mode, pumpMs / 1000, true);
		pumpTimes.push(performance.now() - t);
	}, pumpMs);

	const cpu0 = process.cpuUsage();
	const start = performance.now();
	while (performance.now() - start < RUN) await Bun.sleep(2);
	const elapsed = performance.now() - start;
	const cpu = process.cpuUsage(cpu0);
	stop = true;
	clearInterval(h);
	clearTimeout(h);
	clearInterval(pump);
	clearTimeout(pump);

	const gaps: number[] = [];
	for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
	const g = stat(gaps);
	return {
		kind,
		pumpMs,
		ticks: stamps.length,
		expected: Math.floor(elapsed / TICK),
		deliveredPct: +((stamps.length / Math.floor(elapsed / TICK)) * 100).toFixed(1),
		gapMean: g.mean,
		gapMedian: g.median,
		gapP95: g.p95,
		gapP99: g.p99,
		gapMax: g.max,
		pumps: pumpTimes.length,
		cpuPercent: +(((cpu.user + cpu.system) / 1000 / elapsed) * 100).toFixed(1),
	};
}

const rows: any[] = [];
for (let round = 0; round < 2; round++) {
	rows.push(await trial("interval", 0.25));
	rows.push(await trial("timeout", 0.25));
}
out.rows = rows;
for (const r of rows) {
	console.log(
		`${r.kind.padEnd(8)} round ticks ${r.ticks}/${r.expected} (${r.deliveredPct}%) | gap mean ${r.gapMean} median ${r.gapMedian} p95 ${r.gapP95} p99 ${r.gapP99} max ${r.gapMax} | cpu ${r.cpuPercent}%`,
	);
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);