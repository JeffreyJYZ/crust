// p5.ts — claim 7: can JS shut the app down cleanly, and with what exit code?
//
// Runs four child scenarios, each in its own process, and reports the exit code
// the shell saw. A probe that crashes is a result, not a retry: one attempt each.
//
//   stop-pump     - [NSApp stop:] then pump, expect the pump to return and exit 0
//   terminate     - [NSApp terminate:] directly
//   stop-only     - [NSApp stop:] and no pump
//   hide-then-stop- [NSApp hide:] then stop:
import { loadAppKit, sharedApp, callI, callV, call, makeMode, cf, stat } from "./ffi";

const scenario = Bun.argv[2] ?? "stop-pump";
const out: Record<string, any> = { scenario };
out.appkitLoadMs = loadAppKit();
const app = sharedApp();
out.app = !!app;

const pol = callI(app, "activationPolicy");
out.policy = pol.ok ? pol.value : pol.reason; // 2 = prohibited, nothing visible

const mode = makeMode();
const fin = callV(app, "finishLaunching");
out.finishLaunching = fin.ok ? "sent" : fin.reason;

// A background timer that counts ticks, so we can prove JS kept running.
let ticks = 0;
const tick = setInterval(() => { ticks++; }, 16);

// Pump in a loop for a bounded time; stop when asked.
const deadline = performance.now() + 1500;
const pumpTimes: number[] = [];
let pumps = 0;
let stopSentAt = -1;
let returnedAfterStop = false;

while (performance.now() < deadline) {
	if (scenario === "stop-pump" && stopSentAt < 0 && performance.now() > deadline - 1200) {
		const r = callV(app, "stop:");
		stopSentAt = performance.now();
		out.stop = r.ok ? "sent" : r.reason;
	}
	const t = performance.now();
	const ret = cf.CFRunLoopRunInMode(mode, 0.004, true);
	pumpTimes.push(performance.now() - t);
	pumps++;
	if (stopSentAt > 0 && pumps > 0) {
		// stop: makes the *next* CFRunLoopRunInMode return immediately with
		// kCFRunLoopRunStopped (2). Record the first one after the stop.
		if (ret === 2 && !returnedAfterStop) {
			returnedAfterStop = true;
			out.pumpReturnedStoppedAfterStop = true;
			out.msFromStopToStoppedPump = +(performance.now() - stopSentAt).toFixed(3);
		}
	}
	await Bun.sleep(0);
}
clearInterval(tick);

out.ticks = ticks;
out.pumps = pumps;
out.pump = stat(pumpTimes);

if (scenario === "terminate") {
	// terminate: calls exit() inside AppKit; nothing after it runs.
	out.note = "calling terminate: now; nothing after this line should print";
	console.log(JSON.stringify(out, null, 2));
	const r = callV(app, "terminate:", 0);
	out.terminate = r.ok ? "sent" : r.reason;
	console.log("AFTER TERMINATE (should not appear)");
	process.exit(0);
}

if (scenario === "stop-only") {
	const r = callV(app, "stop:");
	out.stop = r.ok ? "sent" : r.reason;
}

if (scenario === "hide-then-stop") {
	const h = callV(app, "hide:", 0);
	out.hide = h.ok ? "sent" : h.reason;
	const r = callV(app, "stop:");
	out.stop = r.ok ? "sent" : r.reason;
}

out.returnedAfterStop = returnedAfterStop;
console.log(JSON.stringify(out, null, 2));
process.exit(0);