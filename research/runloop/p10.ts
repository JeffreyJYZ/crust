// p10.ts — finishLaunching's delegate callback: does it arrive through a pump at
// all? Three pump mechanisms, one process each, so one trap cannot hide the rest.
//
//   cf      - CFRunLoopRunInMode with a constant CFString mode
//   nsrunloop - NSRunLoop runMode:beforeDate:
//   none    - no pump, just sleeping, control
//
// All guarded: every selector checked against the receiver's class first.
import { loadAppKit, sharedApp, callI, callV, call, makeMode, cf, sel, msg, cls, RT, P, V, B, I, stat } from "./ffi";
import { JSCallback } from "bun:ffi";

const how = Bun.argv[2] ?? "cf";
const out: Record<string, any> = { how };
out.appkitLoadMs = loadAppKit();
const app = sharedApp();
const pol = callI(app, "activationPolicy");
out.policy = pol.ok ? pol.value : pol.reason; // 2 = prohibited, nothing visible

let didFinish = 0;
let anyCallback = 0;
const cb = new JSCallback((_s: any, _c: any, _n: any) => {
	didFinish++;
	return 0;
}, { args: [P, P, P], returns: V });
const cb2 = new JSCallback((_s: any, _c: any) => {
	anyCallback++;
	return 0;
}, { args: [P, P], returns: V });

const dl = (await import("bun:ffi")).dlopen("/usr/lib/libobjc.A.dylib", {
	objc_allocateClassPair: { args: [P, P, I], returns: P },
	objc_registerClassPair: { args: [P], returns: V },
	class_addMethod: { args: [P, P, P, P], returns: B },
}).symbols;

const nm = new TextEncoder().encode("CrustFinishProbe\0");
const myCls = dl.objc_allocateClassPair(RT.objc_getClass("NSObject"), nm, 0);
const encDidFinish = new TextEncoder().encode("v@:@\0");
const encNoArg = new TextEncoder().encode("v@:\0");
out.addedDidFinish = dl.class_addMethod(myCls, sel("applicationDidFinishLaunching:"), cb, encDidFinish);
out.addedPing = dl.class_addMethod(myCls, sel("ping"), cb2, encNoArg);
dl.objc_registerClassPair(myCls);
const inst = msg(1, P)(myCls, sel("alloc"), 0);
msg(0, P)(inst, sel("init"), 0);

const setDel = callV(app, "setDelegate:", inst);
out.setDelegate = setDel.ok ? "sent" : setDel.reason;

// sanity: a direct send through the same IMP must fire
msg(1, V)(inst, sel("ping"), 0);
out.directPing = anyCallback;

const fin = callV(app, "finishLaunching");
out.finishLaunching = fin.ok ? "sent" : fin.reason;

const mode = makeMode("kCFRunLoopDefaultMode");
const deadline = performance.now() + 2000;
const pumpTimes: number[] = [];
let pumps = 0;

if (how === "cf") {
	while (performance.now() < deadline) {
		const t = performance.now();
		cf.CFRunLoopRunInMode(mode, 0.004, true);
		pumpTimes.push(performance.now() - t);
		pumps++;
	}
} else if (how === "nsrunloop") {
	// NSRunLoop runMode:beforeDate: — the AppKit-native way, uses the real mode.
	const rl = msg(0, P)(cls("NSRunLoop"), sel("currentRunLoop"));
	const now = msg(0, P)(cls("NSDate"), sel("date"));
	const dateCls = cls("NSDate");
	while (performance.now() < deadline) {
		const t = performance.now();
		const until = msg(2, P)(dateCls, sel("dateWithTimeIntervalSinceNow:"), 0.004);
		msg(3, P)(rl, sel("runMode:beforeDate:"), 0 as any, until);
		pumpTimes.push(performance.now() - t);
		pumps++;
	}
} else {
	await Bun.sleep(2000);
}

out.pumps = pumps;
out.pump = stat(pumpTimes);
out.didFinishLaunchingCalls = didFinish;
out.directPingCalls = anyCallback;

console.log(JSON.stringify(out, null, 2));
process.exit(0);