// p6.ts — hazards actually observed, each in its own bounded block:
//   a) wrong mode string: does the pump block, or silently no-op?
//   b) blocking JavaScript: does a pump still return, and what happens to ticks?
//   c) re-entrant pump: cost of a pump issued while one is in flight.
//   d) tick gap across a synchronous block.
import { loadAppKit, sharedApp, callI, callV, makeMode, cf, stat } from "./ffi";

const out: Record<string, any> = {};
loadAppKit();
const app = sharedApp();
const pol = callI(app, "activationPolicy");
out.policy = pol.ok ? pol.value : pol.reason;
callV(app, "finishLaunching");

const right = makeMode("kCFRunLoopDefaultMode");
const wrong = makeMode("NSDefaultRunLoopMode");

// (a) wrong mode: measure cost and return code.
{
	const times: number[] = [];
	const rets: number[] = [];
	for (let i = 0; i < 50; i++) {
		const t = performance.now();
		rets.push(cf.CFRunLoopRunInMode(wrong, 0.004, true));
		times.push(performance.now() - t);
	}
	out.wrongMode = { ...stat(times), rets: [...new Set(rets)] };
}
{
	const times: number[] = [];
	const rets: number[] = [];
	for (let i = 0; i < 50; i++) {
		const t = performance.now();
		rets.push(cf.CFRunLoopRunInMode(right, 0.004, true));
		times.push(performance.now() - t);
	}
	out.rightMode = { ...stat(times), rets: [...new Set(rets)] };
}

// (c) re-entrant: pump called from inside a JS timer that the outer loop is
// waiting on is not possible; instead measure a pump issued from a callback
// invoked *by* a pump. Use a CFRunLoopTimer is out of scope, so measure the
// observable version: two pumps back to back with nothing between.
{
	const a = performance.now();
	cf.CFRunLoopRunInMode(right, 0.004, true);
	const mid = performance.now();
	cf.CFRunLoopRunInMode(right, 0.004, true);
	const b = performance.now();
	out.backToBack = { first: +(mid - a).toFixed(3), second: +(b - mid).toFixed(3) };
}

// (d) a blocking JS section, then ticks either side.
{
	const stamps: number[] = [];
	const h = setInterval(() => stamps.push(performance.now()), 16);
	await Bun.sleep(400);
	// block the JS thread synchronously
	const blockStart = performance.now();
	while (performance.now() - blockStart < 300) {
		/* spin */
	}
	const blockEnd = performance.now();
	await Bun.sleep(400);
	clearInterval(h);
	const gaps: number[] = [];
	for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
	const worst = Math.max(...gaps);
	out.blockingJs = {
		blockMs: +(blockEnd - blockStart).toFixed(1),
		ticks: stamps.length,
		gapMedian: stat(gaps).median,
		gapP99: stat(gaps).p99,
		gapMax: stat(gaps).max,
		worstGap: +worst.toFixed(1),
	};
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);