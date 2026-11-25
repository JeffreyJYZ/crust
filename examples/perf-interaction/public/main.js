/** Drives the arms selected by ?mode= and reports through the crust bridge. */
async function main() {
	await window.crust.ready;
	// A synthetic keydown does not perform the browser's default action, so the
	// page supplies the visible result itself. That keeps the measured interval
	// from event dispatch to the glyph being in the DOM and painted.
	document.getElementById("key").addEventListener("keydown", (event) => {
		document.getElementById("glyph").textContent = event.key;
	});
	const mode = new URLSearchParams(location.search).get("mode") || "core";
	setStatus(`measuring ${mode}`);
	const result = {
		at: new Date().toISOString(),
		mode,
		visibilityState: document.visibilityState,
		userAgent: navigator.userAgent,
		launchAnchors: { readyAt: state.readyAt, firstRafAt: state.firstRafAt },
		captureControl: null,
		arms: {},
	};
	state.result = result;
	await report(result);
	try {
		if (mode === "launch") {
			// Anchors were taken in core.js at load; nothing else to do.
		} else if (mode === "windows") {
			setStatus("window open");
			result.arms.windowOpen = await armWindowOpen(25);
		} else if (mode === "paint") {
			setStatus("scroll");
			result.arms.scroll = await armScroll(3000);
			await report(result);
			setStatus("resize");
			result.arms.resize = await armResize(20);
		} else {
			setStatus("capture control");
			result.captureControl = await armCapture(4);
			await report(result);
			setStatus("keystroke");
			result.arms.keystroke = await armKeystroke(10);
			await report(result);
			setStatus("click");
			result.arms.click = await armClick(60);
		}
		state.result = result;
		await report({ ...result, final: true });
		setStatus("done");
		state.done = true;
	} catch (error) {
		state.error = String((error && error.stack) || error);
		setStatus(`FAILED: ${String((error && error.message) || error)}`);
		await report({ ...result, error: state.error, final: true }).catch(() => undefined);
	} finally {
		await window.crust.invoke("latency", "quit").catch(() => undefined);
	}
}
main().catch((error) => {
	state.error = String((error && error.stack) || error);
	setStatus(`FAILED: ${state.error}`);
});
