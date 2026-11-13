// p5b.ts — claim 7, tightened: what does a pump return right after [NSApp stop:]?
// And what does [NSApp terminate:] do to the JS process?
//
// One scenario per process, one attempt each, exit code recorded by the shell.
import { loadAppKit, sharedApp, callI, callV, makeMode, cf } from "./ffi";

const scenario = Bun.argv[2] ?? "stop-then-pump";
const mode = makeMode();
loadAppKit();
const app = sharedApp();
const pol = callI(app, "activationPolicy");
callV(app, "finishLaunching");

console.log(JSON.stringify({ scenario, app: !!app, policy: pol.ok ? pol.value : pol.reason }));

if (scenario === "stop-then-pump") {
	const before = cf.CFRunLoopRunInMode(mode, 0.004, true);
	const r = callV(app, "stop:");
	const after: number[] = [];
	for (let i = 0; i < 5; i++) after.push(cf.CFRunLoopRunInMode(mode, 0.004, true));
	console.log(JSON.stringify({ before, stop: r.ok ? "sent" : r.reason, after, meaning: "2 = kCFRunLoopRunStopped, 3 = kCFRunLoopRunTimedOut" }));
	process.exit(0);
}

if (scenario === "stop-inside-callback") {
	// stop: delivered while a pump is in flight, then that pump must return 2.
	const r = callV(app, "stop:");
	const rets: number[] = [];
	for (let i = 0; i < 3; i++) rets.push(cf.CFRunLoopRunInMode(mode, 0.004, true));
	console.log(JSON.stringify({ stop: r.ok ? "sent" : r.reason, rets }));
	process.exit(0);
}

if (scenario === "terminate") {
	console.log("BEFORE TERMINATE — this is the last line that can print");
	const r = callV(app, "terminate:", 0);
	console.log("AFTER TERMINATE: " + (r.ok ? "sent" : r.reason));
	process.exit(0);
}

if (scenario === "stop-then-terminate") {
	const s = callV(app, "stop:");
	const t = callV(app, "terminate:", 0);
	console.log(JSON.stringify({ stop: s.ok ? "sent" : s.reason, terminate: t.ok ? "sent" : t.reason }));
	process.exit(0);
}

console.log("unknown scenario");
process.exit(2);