// p3.ts — claim 5: what happens with no pump at all?
//
// Three variants, each measured and then exited:
//   sleep-only   — NSApplication exists, JS sleeps 3 s, no pump ever
//   timer-only   — a 16 ms setInterval runs 3 s, no pump ever
//   control      — neither AppKit nor pump, just a sleep
//
// For each: did the process reach the end, how much CPU did it burn, and did it
// exit by itself?
import { loadAppKit, sharedApp, callI, callV, makeMode, cf } from "./ffi";

const mode = Number(process.env.CRUST_MODE ?? "");

async function measure(label: string, useAppKit: boolean, useTimer: boolean) {
	const cpu0 = process.cpuUsage();
	const t0 = performance.now();
	let ticks = 0;
	const h = useTimer ? setInterval(() => { ticks++; }, 16) : null;
	await Bun.sleep(3000);
	const elapsed = performance.now() - t0;
	if (h) clearInterval(h);
	const cpu = process.cpuUsage(cpu0);
	const cpuMs = (cpu.user + cpu.system) / 1000;
	return {
		label,
		elapsedMs: +elapsed.toFixed(1),
		reachedEnd: true,
		ticks,
		cpuMs: +cpuMs.toFixed(1),
		cpuPercent: +((cpuMs / elapsed) * 100).toFixed(1),
	};
}

const rows: any[] = [];
rows.push(await measure("control: no AppKit, no timer", false, false));

// AppKit, no pump, no timer.
loadAppKit();
const app = sharedApp();
const pol = callI(app, "activationPolicy");
rows.push(await measure("AppKit loaded, no pump, no timer", true, false));
const after = callI(app, "isRunning");

// AppKit, no pump, but a timer.
const h2 = setInterval(() => {}, 16);
rows.push(await measure("AppKit loaded, no pump, 16ms timer", true, true));
clearInterval(h2);

console.log(JSON.stringify({ appNonNull: !!app, policyBefore: pol.ok ? pol.value : pol.reason, isRunningAfter: after.ok ? after.value : after.reason, rows }, null, 2));
process.exit(0);