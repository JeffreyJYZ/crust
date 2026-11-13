// p9.ts — two things, both guarded, one attempt each:
//
//  A) Does the JSCallback delegate method actually run when sent directly, and
//     does `applicationDidFinishLaunching:` fire after `finishLaunching`?
//  B) The AppKit-native pump that BunKit uses: `nextEventMatchingMask:untilDate:
//     inMode:dequeue:` — cost, and how it compares with CFRunLoopRunInMode.
//
// No activation, no window: policy stays 2.
import { loadAppKit, sharedApp, callI, callV, call, makeMode, cf, sel, msg, cls, RT, P, V, B, I, stat } from "./ffi";
import { JSCallback } from "bun:ffi";

const out: Record<string, any> = {};
loadAppKit();
const app = sharedApp();
const pol = callI(app, "activationPolicy");
out.policy = pol.ok ? pol.value : pol.reason;
callV(app, "finishLaunching");

// --- A: delegate callback -------------------------------------------------
let direct = 0;
let launchCb = 0;
const cb = new JSCallback((_s: any, _c: any) => {
	direct++;
	return 0;
}, { args: [P, P], returns: I });
const cb2 = new JSCallback((_s: any, _c: any, _n: any) => {
	launchCb++;
	return 0;
}, { args: [P, P, P], returns: V });

const dl = (await import("bun:ffi")).dlopen("/usr/lib/libobjc.A.dylib", {
	objc_allocateClassPair: { args: [P, P, I], returns: P },
	objc_registerClassPair: { args: [P], returns: V },
	class_addMethod: { args: [P, P, P, P], returns: B },
	class_getInstanceMethod: { args: [P, P], returns: P },
}).symbols;

const nm = new TextEncoder().encode("CrustCbProbe\0");
const myCls = dl.objc_allocateClassPair(RT.objc_getClass("NSObject"), nm, 0);
out.addBump = dl.class_addMethod(myCls, sel("bump"), cb, new TextEncoder().encode("v@:\0"));
out.addDidFinish = dl.class_addMethod(
	myCls,
	sel("applicationDidFinishLaunching:"),
	cb2,
	new TextEncoder().encode("v@:@\0"),
);
dl.objc_registerClassPair(myCls);
const inst = msg(1, P)(myCls, sel("alloc"), 0);
msg(0, P)(inst, sel("init"), 0);

// direct send: if the callback fires, the IMP plumbing is sound
msg(1, V)(inst, sel("bump"), 0);
out.directBumpCalls = direct;

// set as delegate AFTER finishLaunching, then re-finish, then pump
callV(app, "setDelegate:", inst);
callV(app, "finishLaunching");
const mode = makeMode("kCFRunLoopDefaultMode");
for (let i = 0; i < 30; i++) cf.CFRunLoopRunInMode(mode, 0.004, true);
out.didFinishLaunchingCalls = launchCb;

const WITH_EVENTS = Bun.argv.includes("--with-events");
if (!WITH_EVENTS) {
	console.log(JSON.stringify(out, null, 2));
	process.exit(0);
}

// --- B: nextEventMatchingMask pump ---------------------------------------
const evSel = "nextEventMatchingMask:untilDate:inMode:dequeue:";
const responds = callI(app, "respondsToSelector:", sel(evSel));
out.nextEventSelectorResponded = responds.ok ? responds.value : responds.reason;

// NSDate distantPast
const dateCls = cls("NSDate");
const distantPast = msg(0, P)(dateCls, sel("distantPast"));
const maskAll = 0xffffffff; // NSEventMaskAny is -1 / all bits

if (responds.ok && responds.value === 1) {
	const pumpTimes: number[] = [];
	let drained = 0;
	for (let i = 0; i < 200; i++) {
		const t = performance.now();
		// send as a 4-arg pointer call: the return is an object, so declare P.
		const r = msg(5, P)(app, sel(evSel), maskAll, distantPast, 0 as any, 1);
		pumpTimes.push(performance.now() - t);
		if (r) drained++;
	}
	out.nextEventPump = { ...stat(pumpTimes), nonNullReturns: drained };
}

// Same cost for CFRunLoopRunInMode with the same 4 ms budget, for comparison.
{
	const times: number[] = [];
	for (let i = 0; i < 200; i++) {
		const t = performance.now();
		cf.CFRunLoopRunInMode(mode, 0.004, true);
		times.push(performance.now() - t);
	}
	out.cfPump = stat(times);
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);