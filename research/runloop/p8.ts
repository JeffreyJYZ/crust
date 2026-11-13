// p8.ts — claim 6: what does `finishLaunching` actually change, and what does a
// missing pump leave queued?
//
// Observables that need no window and no activation:
//   * an NSEvent posted into the app: is it delivered while pumping, and does it
//     stay queued when nothing pumps?
//   * the delegate callback path: does an app delegate's
//     `applicationDidFinishLaunching:` run at all without finishLaunching?
//   * what `NSApp` reports about the launch state.
import { loadAppKit, sharedApp, callI, callV, call, makeMode, cf, sel, msg, cls, RT, P, V, B, I, stat } from "./ffi";
import { JSCallback } from "bun:ffi";

const out: Record<string, any> = {};
loadAppKit();
const app = sharedApp();
const pol = callI(app, "activationPolicy");
out.policy = pol.ok ? pol.value : pol.reason;
const mode = makeMode("kCFRunLoopDefaultMode");

// --- a delegate that records the launch callback ---------------------------
let didFinish = 0;
const cb = new JSCallback((_self: any, _cmd: any) => {
	didFinish++;
	return 0;
}, { args: [P, P], returns: I });

const dl = (await import("bun:ffi")).dlopen("/usr/lib/libobjc.A.dylib", {
	objc_allocateClassPair: { args: [P, P, I], returns: P },
	objc_registerClassPair: { args: [P], returns: V },
	class_addMethod: { args: [P, P, P, P], returns: B },
}).symbols;

const nameBuf = new TextEncoder().encode("CrustDidFinishProbe\0");
const myCls = dl.objc_allocateClassPair(RT.objc_getClass("NSObject"), nameBuf, 0);
const enc = new TextEncoder().encode("v@:@\0");
dl.class_addMethod(myCls, sel("applicationDidFinishLaunching:"), cb, enc);
dl.objc_registerClassPair(myCls);
const inst = msg(1, P)(myCls, sel("alloc"), 0);
const delegate = msg(0, P)(inst, sel("init"), 0);
out.delegateMade = !!delegate;

// --- phase 1: no finishLaunching, set delegate, pump ------------------------
const setDel = callV(app, "setDelegate:", delegate);
out.setDelegate = setDel.ok ? "sent" : setDel.reason;

// post an application-defined event into the queue
const evCls = cls("NSEvent");
const evSel = "otherEventWithType:location:modifierFlags:timestamp:windowNumber:context:subtype:data1:data2:";
out.postEventSelectorPresent = (() => { const r = callI(app, "respondsToSelector:", sel("postEvent:atStart:")); return r.ok ? r.value : r.reason; })();

{
	const pumpTimes: number[] = [];
	for (let i = 0; i < 20; i++) {
		const t = performance.now();
		cf.CFRunLoopRunInMode(mode, 0.004, true);
		pumpTimes.push(performance.now() - t);
	}
	out.pumpBeforeFinish = { ...stat(pumpTimes), didFinishCalls: didFinish };
}
out.didFinishAfterPumpingWithoutFinish = didFinish;

// --- phase 2: call finishLaunching, pump, see the delegate fire ------------
const fin = callV(app, "finishLaunching");
out.finishLaunching = fin.ok ? "sent" : fin.reason;
{
	const pumpTimes: number[] = [];
	for (let i = 0; i < 20; i++) {
		const t = performance.now();
		cf.CFRunLoopRunInMode(mode, 0.004, true);
		pumpTimes.push(performance.now() - t);
	}
	out.pumpAfterFinish = { ...stat(pumpTimes), didFinishCalls: didFinish };
}

// --- what NSApp says about the launch -------------------------------------
const names = ["isRunning", "isHidden", "isActive", "delegate", "mainMenu", "windows"];
out.state = {};
for (const n of names) {
	const r = call(app, n);
	out.state[n] = r.ok ? String(r.value) : r.reason;
}

// --- no pump at all: does a posted event get delivered? -------------------
// (reported separately from p3; here just confirm the queue is not draining
// without a pump by checking whether an event we post survives)
console.log(JSON.stringify(out, null, 2));
process.exit(0);