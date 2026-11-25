/**
 * Shared page-side helpers. Classic script on purpose: the top-level `var`s are
 * visible to arms.js and main.js with no module boundary. Every timestamp comes
 * from this page's own clock (performance.now for intervals, Date.now for the
 * cross-window wall clock). No backend clock is used in any latency number.
 */
var state = {
	status: "starting",
	marks: [],
	result: null,
	done: false,
	error: null,
	readyAt: null,
	firstRafAt: null,
};

// Launch-to-interactive anchors, taken as early as this document allows.
if (document.readyState === "complete") state.readyAt = Date.now();
else window.addEventListener("load", () => void (state.readyAt = Date.now()), { once: true });
requestAnimationFrame(() => void (state.firstRafAt = Date.now()));

// Keep the compositor ticking. WebKit only paints when a frame is requested;
// without this loop a window.capture taken after a DOM change waits for a
// paint that never happens in a non-frontmost probe window. Dev-only scaffold.
(function keepPainting(now) {
	const tick = (time) => {
		const dot = document.getElementById("dot");
		if (dot) dot.style.background = Math.floor(time / 16) % 2 === 0 ? "#222" : "#333";
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
})(performance.now());

var percentile = (values, p) => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};
var stats = (values) => ({
	n: values.length,
	p50: percentile(values, 0.5),
	p95: percentile(values, 0.95),
	max: values.length ? Math.max(...values) : null,
	min: values.length ? Math.min(...values) : null,
});

var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var waitFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
var busy = (ms) => {
	const until = performance.now() + ms;
	while (performance.now() < until) {
		// Deliberate main-thread block, used only as a labelled control arm.
	}
};

/** window.capture is the only paint proof here: never an OS screenshot, never activation. */
var capture = async (label) => {
	try {
		const shot = await window.crust.invoke("window", "capture", { label: label || "main" });
		return shot && shot.ok && typeof shot.png === "string" ? shot.png : null;
	} catch {
		return null;
	}
};
var report = async (json) => {
	await window.crust.invoke("latency", "report", { json: JSON.stringify(json) });
};
var setStatus = (text) => {
	state.status = text;
	const node = document.getElementById("status");
	if (node) node.textContent = text;
};
