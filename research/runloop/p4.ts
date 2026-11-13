// p4.ts — claim 6: what must be called before the first pump, and what breaks
// if `finishLaunching` is skipped?
//
// Observable without a window and without activating: whether a single pump
// returns, how long it takes, whether an event posted into the app is drained,
// and what AppKit reports about the menu bar and the responder chain.
import { loadAppKit, sharedApp, call, callI, callV, msg, sel, cls, makeMode, cf, stat } from "./ffi";

const mode = makeMode();
const out: Record<string, any> = {};

// One pump, no finishLaunching yet.
{
	const t = performance.now();
	const r = cf.CFRunLoopRunInMode(mode, 0.004, true);
	out.pumpBeforeFinish = { ms: +(performance.now() - t).toFixed(3), ret: r };
}

const app = sharedApp();
out.mainMenuBefore = (() => { const r = call(app, "mainMenu"); return r.ok ? String(r.value) : r.reason; })();
out.windowsBefore = (() => { const r = call(app, "windows"); return r.ok ? String(r.value) : r.reason; })();

// Does a posted event get drained by a pump, before finishLaunching?
// NSEvent otherEventWithType:... is a long selector; build it by name.
const evSel = "otherEventWithType:location:modifierFlags:timestamp:windowNumber:context:subtype:data1:data2:";
out.respondsToOtherEvent = (() => {
	const r = callI(app, "respondsToSelector:", sel(evSel));
	return r.ok ? r.value : r.reason;
})();

const fin = callV(app, "finishLaunching");
out.finishLaunching = fin.ok ? "sent" : fin.reason;

out.mainMenuAfter = (() => { const r = call(app, "mainMenu"); return r.ok ? String(r.value) : r.reason; })();
out.windowsAfter = (() => { const r = call(app, "windows"); return r.ok ? String(r.value) : r.reason; })();

// Pump after finishLaunching: cost over 100, and does it return?
{
	const times: number[] = [];
	for (let i = 0; i < 100; i++) {
		const t = performance.now();
		cf.CFRunLoopRunInMode(mode, 0.004, true);
		times.push(performance.now() - t);
	}
	out.pumpAfterFinish = { ...stat(times), totalMs: +times.reduce((a, b) => a + b, 0).toFixed(2) };
}

// A second finishLaunching: is it idempotent or does it throw?
const fin2 = callV(app, "finishLaunching");
out.finishLaunchingTwice = fin2.ok ? "sent again, no throw" : fin2.reason;

// Ordering: setActivationPolicy after finishLaunching vs before.
const pol = callI(app, "activationPolicy");
out.policyNow = pol.ok ? pol.value : pol.reason;

console.log(JSON.stringify(out, null, 2));
process.exit(0);