/**
 * The fixed workload, kept in its own classic script so the top-level `var`s
 * below are visible to app.js without a module boundary. No bridge calls here.
 */
var ROWS = 60;
var RECTS = 200;
var LEVEL_MS = 3000;
var status = document.getElementById("status");
var result = document.getElementById("result");
var canvas = document.getElementById("paint");
var paint = canvas.getContext("2d");
var cells = [];
for (let i = 0; i < ROWS; i += 1) {
	const cell = document.createElement("span");
	cell.textContent = String(i);
	document.getElementById("rows").append(cell);
	cells.push(cell);
}

var deltas = [];
var lastFrame = 0;
var longTasks = [];
var rafCount = 0;
var longTaskSupported = false;
try {
	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) longTasks.push(entry.duration);
	});
	observer.observe({ entryTypes: ["longtask"] });
	longTaskSupported = true;
} catch {
	longTaskSupported = false;
}

var manualDrive = false;

function workDirect(now) {
	if (lastFrame !== 0) deltas.push(now - lastFrame);
	lastFrame = now;
	const tick = Math.floor(now / 16) % 1000;
	for (let i = 0; i < ROWS; i += 1) cells[i].textContent = `${i}:${tick}`;
	paint.clearRect(0, 0, canvas.width, canvas.height);
	for (let i = 0; i < RECTS; i += 1) {
		paint.fillStyle = (i + tick) % 2 === 0 ? "#3a6ea5" : "#a53a6e";
		paint.fillRect((i * 17 + tick) % canvas.width, (i * 13) % canvas.height, 12, 8);
	}
}

function work(now) {
	if (!manualDrive) workDirect(now);
}

function animationFrame(now) {
	rafCount += 1;
	work(now);
	requestAnimationFrame(animationFrame);
}
requestAnimationFrame(animationFrame);

// A non-activated macOS window gets no animation frames in this webview. A
// 16 ms timer keeps the same workload measurable; every row names its driver.
setInterval(() => {
	if (rafCount === 0) work(performance.now());
}, 16);

var percentile = (values, p) => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};
var heap = () => (performance.memory ? performance.memory.usedJSHeapSize : null);
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
