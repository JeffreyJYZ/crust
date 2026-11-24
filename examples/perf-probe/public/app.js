/**
 * Drives the three measured windows and reports through the crust bridge. The
 * fixed workload lives in workload.js; this file owns no DOM setup or paint.
 */
async function start(activity, onEvent, onInvoke) {
	if (activity === "none") return async () => {};
	if (activity === "one") {
		const id = setInterval(onInvoke, 1000);
		return async () => clearInterval(id);
	}
	await window.crust.invoke("perf", "stream", { hz: 30 });
	const unsubscribe = window.crust.listen("perf:tick", onEvent);
	const id = setInterval(onInvoke, 16);
	return async () => {
		clearInterval(id);
		unsubscribe();
	};
}

async function measure(name, activity) {
	deltas = [];
	longTasks = [];
	lastFrame = 0;
	const heapStartBytes = heap();
	const rafStart = rafCount;
	let invokeCount = 0;
	let eventCount = 0;
	let errorCount = 0;
	const onInvoke = () =>
		window.crust
			.invoke("perf", "ping")
			.then(() => void (invokeCount += 1))
			.catch(() => void (errorCount += 1));
	const stop = await start(activity, () => eventCount++, onInvoke);
	const startAt = performance.now();
	if (activity === "sustained-invoke") {
		manualDrive = true;
		while (performance.now() - startAt < LEVEL_MS) {
			workDirect(performance.now());
			await window.crust
				.invoke("perf", "pace", { ms: 16 })
				.then(() => {
					invokeCount += 1;
				})
				.catch(() => {
					errorCount += 1;
				});
		}
	} else {
		while (performance.now() - startAt < LEVEL_MS) await sleep(25);
	}
	manualDrive = false;
	const durationMs = performance.now() - startAt;
	const stopped = await Promise.race([stop().then(() => true), sleep(1500).then(() => false)]);
	console.error(`perf probe: ${name} stopped=${stopped}`);
	if (!stopped) stop().catch(() => undefined);
	const heapEndBytes = heap();
	const row = {
		name,
		activity,
		stopped,
		eventHz: activity === "sustained-invoke" ? 30 : 0,
		eventStream: activity === "sustained-invoke" ? "active SSE" : "not used",
		driver:
			activity === "sustained-invoke"
				? "backend-paced-invoke"
				: rafCount === rafStart
					? "timer-16ms"
					: "requestAnimationFrame",
		rafFrames: rafCount - rafStart,
		durationMs,
		frames: deltas.length,
		fps: deltas.length / (durationMs / 1000),
		frameP50Ms: percentile(deltas, 0.5),
		frameP95Ms: percentile(deltas, 0.95),
		longTasks: longTasks.length,
		longTaskP95Ms: percentile(longTasks, 0.95),
		longTaskSupported,
		longFrames: deltas.filter((delta) => delta > 50).length,
		heapStartBytes,
		heapEndBytes,
		invokeCount,
		eventCount,
		errorCount,
	};
	console.error(
		`perf probe: ${name} done driver=${row.driver} frames=${row.frames} ` +
			`fps=${row.fps.toFixed(1)} events=${eventCount} invokes=${invokeCount}`,
	);
	return row;
}

async function main() {
	await window.crust.ready;
	status.textContent = "measuring";
	const levels = [];
	for (const [name, activity] of [
		["none", "none"],
		["one-invoke-per-second", "one"],
		["sustained-invoke-only", "sustained-invoke"],
	]) {
		levels.push(await measure(name, activity));
		await window.crust.invoke("perf", "report", { json: JSON.stringify({ levels }) });
		status.textContent = `level ${levels.length}/3 done`;
	}
	let capture = { ok: false, reason: "not attempted" };
	try {
		const shot = await Promise.race([
			window.crust.invoke("window", "capture", { label: "main" }),
			sleep(2000).then(() => ({ ok: false, reason: "capture deadline" })),
		]);
		capture = {
			ok: shot.ok !== false,
			width: shot.width,
			height: shot.height,
			scale: shot.scale,
			pngBytes: typeof shot.png === "string" ? shot.png.length : 0,
		};
	} catch (error) {
		capture = { ok: false, reason: String(error && error.message ? error.message : error) };
	}
	const report = {
		at: new Date().toISOString(),
		visibilityState: document.visibilityState,
		userAgent: navigator.userAgent,
		workload: { rows: ROWS, rects: RECTS, levelMs: LEVEL_MS },
		capture,
		levels,
	};
	result.textContent = JSON.stringify(report);
	await window.crust.invoke("perf", "report", { json: JSON.stringify(report), final: true });
	status.textContent = "reported";
	await window.crust.invoke("perf", "quit");
}

main().catch((error) => {
	console.error(`perf probe: FAILED ${String(error && error.stack ? error.stack : error)}`);
	status.textContent = `FAILED: ${String(error && error.message ? error.message : error)}`;
	result.textContent = status.textContent;
});
