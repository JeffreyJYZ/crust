// p7.ts — re-entrancy: can an Objective-C callback run *inside* a pump, and
// what does that cost the JS tick loop?
//
// Builds a runtime class whose method IMP is a JSCallback, sends it directly, and
// then sends it from inside a CFRunLoopRunInMode pump by posting it through
// `performSelectorOnMainThread` (a run-loop source, so it fires inside a pump).
//
// One attempt. If the callback mechanism is unusable, record that and stop.
import { loadAppKit, sharedApp, callI, callV, makeMode, cf, stat, sel, RT, msg, cls, P, B, V, I } from "./ffi";

const out: Record<string, any> = {};
loadAppKit();
const app = sharedApp();
callV(app, "finishLaunching");
const mode = makeMode("kCFRunLoopDefaultMode");
const pol = callI(app, "activationPolicy");
out.policy = pol.ok ? pol.value : pol.reason;

// --- runtime class with a JS-implemented method ---------------------------
const { JSCallback } = await import("bun:ffi");

let calls = 0;
const log: number[] = [];
const cb = new JSCallback((self: any, _cmd: any, tag: number) => {
	calls++;
	log.push(performance.now());
	return tag + 1;
}, { args: [P, P, I], returns: I });

const name = "CrustProbeDelegate";
const superCls = RT.objc_getClass("NSObject");
const created = (RT as any).objc_allocateClassPair
	? null
	: null;
// objc_allocateClassPair is not declared in ffi.ts; add it here.
const rt = (await import("bun:ffi")).dlopen("/usr/lib/libobjc.A.dylib", {
	objc_allocateClassPair: { args: [P, P, I], returns: P },
	objc_registerClassPair: { args: [P], returns: V },
	class_addMethod: { args: [P, P, P, P], returns: B },
}).symbols;

const nameBuf = new TextEncoder().encode(name + "\0");
const myCls = rt.objc_allocateClassPair(superCls, nameBuf, 0);
const enc = new TextEncoder().encode("i@:i\0");
const added = rt.class_addMethod(myCls, sel("bump:"), cb, enc);
rt.objc_registerClassPair(myCls);
out.classCreated = myCls !== 0;
out.methodAdded = added;

const obj = rt.class_addMethod ? msg(1, P)(myCls, sel("alloc"), 0) : 0;
const inst = obj ? msg(0, P)(obj, sel("init"), 0) : 0;
out.instance = !!inst;

// direct call
try {
	const r = msg(2, I)(inst, sel("bump:"), 41);
	out.directCall = r;
} catch (e) {
	out.directCall = "threw: " + String(e).slice(0, 80);
}
out.callsAfterDirect = calls;

// --- fire it from inside a pump -------------------------------------------
// performSelectorOnMainThread:waitUntilDone: is a run-loop source, so the
// callback runs inside CFRunLoopRunInMode.
const selPerform = sel("performSelectorOnMainThread:withObject:waitUntilDone:");
const selBump = sel("bump:");
const selNum = sel("numberWithInt:");
const numCls = cls("NSNumber");
const arg = msg(2, P)(numCls, selNum, 7);

calls = 0;
let delivered = false;
// schedule, then pump
msg(4, V)(inst, selPerform, selBump, arg, 1);
const pumpTimes: number[] = [];
for (let i = 0; i < 50; i++) {
	const t = performance.now();
	cf.CFRunLoopRunInMode(mode, 0.004, true);
	pumpTimes.push(performance.now() - t);
	if (calls > 0) delivered = true;
}
out.deliveredInsidePump = delivered;
out.callsInsidePump = calls;
out.pumpWhileDelivering = stat(pumpTimes);

// tick loop fidelity while a pump fires callbacks
{
	const stamps: number[] = [];
	let stop = false;
	const h = setInterval(() => { if (!stop) stamps.push(performance.now()); }, 16);
	const start = performance.now();
	while (performance.now() - start < 1500) {
		msg(4, V)(inst, selPerform, selBump, arg, 1);
		cf.CFRunLoopRunInMode(mode, 0.004, true);
		await Bun.sleep(0);
	}
	stop = true;
	clearInterval(h);
	const gaps: number[] = [];
	for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
	out.tickDuringCallbackPump = { ticks: stamps.length, ...stat(gaps) };
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);