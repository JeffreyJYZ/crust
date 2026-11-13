// p12.ts — claim 6, cleanly: what does `finishLaunching` change that a pump can
// observe, and is there a cheaper pump than a 4 ms blocking one?
//
//   A. ret codes for N pumps before finishLaunching
//   B. ret codes for N pumps after finishLaunching
//   C. a zero-timeout pump: cost and CPU cost over 1 s
import { loadAppKit, sharedApp, callI, callV, makeMode, cf, stat } from "./ffi";

const out: Record<string, any> = {};
out.appkitLoadMs = loadAppKit();
const app = sharedApp();
const pol = callI(app, "activationPolicy");
out.policy = pol.ok ? pol.value : pol.reason;
out.policyMeaning = "2 = prohibited (background), 0 = regular (Dock icon)";
const mode = makeMode("kCFRunLoopDefaultMode");
out.modeName = "kCFRunLoopDefaultMode (CFString, content-equal to the constant)";

function runPumps(n: number, timeoutSec: number) {
	const rets: number[] = [];
	const times: number[] = [];
	for (let i = 0; i < n; i++) {
		const t = performance.now();
		rets.push(cf.CFRunLoopRunInMode(mode, timeoutSec, true));
		times.push(performance.now() - t);
	}
	const counts: Record<string, number> = {};
	for (const r of rets) counts[String(r)] = (counts[String(r)] ?? 0) + 1;
	return { ...stat(times), totalMs: +times.reduce((a, b) => a + b, 0).toFixed(1), rets: counts };
}

out.beforeFinish = runPumps(100, 0.004);
const fin = callV(app, "finishLaunching");
out.finishLaunching = fin.ok ? "sent" : fin.reason;
out.afterFinish = runPumps(100, 0.004);

// C. zero-timeout pump: cost per call, and CPU burned over one second.
{
	const times: number[] = [];
	for (let i = 0; i < 1000; i++) {
		const t = performance.now();
		cf.CFRunLoopRunInMode(mode, 0, true);
		times.push(performance.now() - t);
	}
	out.pumpZeroTimeout = { ...stat(times), totalMs: +times.reduce((a, b) => a + b, 0).toFixed(2) };
}
{
	const cpu0 = process.cpuUsage();
	const t0 = performance.now();
	let n = 0;
	while (performance.now() - t0 < 1000) {
		cf.CFRunLoopRunInMode(mode, 0, true);
		n++;
	}
	const cpu = process.cpuUsage(cpu0);
	const wall = performance.now() - t0;
	out.pumpZeroTimeoutSpin = {
		calls: n,
		wallMs: +wall.toFixed(0),
		cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(0),
		cpuPercent: +(((cpu.user + cpu.system) / 1000 / wall) * 100).toFixed(1),
	};
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);