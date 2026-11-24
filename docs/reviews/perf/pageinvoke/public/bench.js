/**
 * Page-owned instrumentation for the invoke/event split. Loaded as an external same-origin script
 * in <head>, so it runs before the bridge's injected bootstrap; every `crust` reference is lazy.
 * All timings come from this page's `performance.now()` and its own rAF deltas.
 */
(function () {
	var ROWS = 60, RECTS = 200;
	var deltas = [], last = 0, on = false, longTasks = [], observed = false;
	var invTimer = null, invokes = 0, errors = 0, lastFrameAt = 0;
	try {
		var po = new PerformanceObserver(function (list) {
			for (var i = 0; i < list.getEntries().length; i++) longTasks.push(list.getEntries()[i].duration);
		});
		po.observe({ entryTypes: ["longtask"] });
		observed = true;
	} catch (error) { observed = false; }
	var status = document.getElementById("status");
	var rowHost = document.createElement("div");
	rowHost.id = "rows";
	document.body.appendChild(rowHost);
	var cells = [];
	for (var r = 0; r < ROWS; r++) {
		var cell = document.createElement("span");
		cell.textContent = String(r);
		rowHost.appendChild(cell);
		cells.push(cell);
	}
	var canvas = document.getElementById("paint");
	var paint = canvas.getContext("2d");
	function frame(now) {
		if (!on) return;
		if (last !== 0) deltas.push(now - last);
		last = now;
		lastFrameAt = now;
		var tick = Math.floor(now / 16) % 1000;
		for (var i = 0; i < ROWS; i++) cells[i].textContent = i + ":" + tick;
		paint.clearRect(0, 0, canvas.width, canvas.height);
		for (var j = 0; j < RECTS; j++) {
			paint.fillStyle = (j + tick) % 2 === 0 ? "#3a6ea5" : "#a53a6e";
			paint.fillRect((j * 17 + tick) % canvas.width, (j * 13) % canvas.height, 12, 8);
		}
		requestAnimationFrame(frame);
	}
	function pct(values, p) {
		if (values.length === 0) return null;
		var sorted = values.slice().sort(function (a, b) { return a - b; });
		return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
	}
	function stats(values) {
		return {
			n: values.length,
			p50: values.length ? pct(values, 0.5) : null,
			p95: values.length ? pct(values, 0.95) : null,
			worst: values.length ? Math.max.apply(null, values) : null,
		};
	}
	function stopInvoke() {
		if (invTimer !== null) { clearInterval(invTimer); invTimer = null; }
	}
	function pumpInvoke(hz) {
		stopInvoke();
		if (!hz) return;
		invTimer = setInterval(function () {
			window.crust.invoke("pagei", "ping").then(
				function () { invokes++; },
				function () { errors++; },
			);
		}, Math.max(1, Math.round(1000 / hz)));
	}
	window.__bench = {
		ready: function () { return typeof window.crust === "object" && window.crust !== null; },
		start: function () {
			deltas = []; last = 0; longTasks = []; invokes = 0; errors = 0; on = true;
			requestAnimationFrame(frame);
			return "started";
		},
		invoke: function (hz) { pumpInvoke(hz); return "invoke:" + hz; },
		stop: function () {
			on = false;
			stopInvoke();
			return JSON.stringify({
				frames: deltas.length,
				frameDeltas: deltas,
				p50: pct(deltas, 0.5),
				p95: pct(deltas, 0.95),
				worst: deltas.length ? Math.max.apply(null, deltas) : null,
				longFrames: deltas.filter(function (d) { return d > 50; }).length,
				longTasks: longTasks.length,
				longTaskSupported: observed,
				invokes: invokes,
				errors: errors,
				visibility: document.visibilityState,
				lastFrameAgeMs: performance.now() - lastFrameAt,
			});
		},
		payload: function (kind, n) {
			window.__payloadTimes = [];
			window.__payloadDone = false;
			var pending = n;
			for (var i = 0; i < n; i++) {
				var t = performance.now();
				window.crust.invoke("pagei", "payload", { kind: kind }).then(
					function () {
						window.__payloadTimes.push(performance.now() - t);
						if (--pending === 0) window.__payloadDone = true;
					},
					function () {
						if (--pending === 0) window.__payloadDone = true;
					},
				);
			}
			return "started";
		},
		payloadResult: function () {
			return JSON.stringify({
				done: window.__payloadDone === true,
				roundTrip: stats(window.__payloadTimes || []),
			});
		},
		micro: function (n) {
			var small = { ok: true, v: true };
			var medium = { items: [] };
			for (var i = 0; i < 200; i++) medium.items.push({ name: "field-" + i, value: "x".repeat(16) });
			var binary = "A".repeat(1024 * 1024);
			var parse = { small: [], medium: [], binary: [] };
			for (var k = 0; k < n; k++) {
				var t;
				t = performance.now(); JSON.parse(JSON.stringify(small)); parse.small.push(performance.now() - t);
				t = performance.now(); JSON.parse(JSON.stringify(medium)); parse.medium.push(performance.now() - t);
				t = performance.now(); JSON.parse(JSON.stringify({ __crustBytes: binary })); parse.binary.push(performance.now() - t);
			}
			var listeners = [];
			for (var l = 0; l < 10; l++) {
				var fn = function () {};
				listeners.push(fn);
				document.addEventListener("bench:noop", fn);
			}
			var dispatch = [];
			for (var d = 0; d < n; d++) {
				var t2 = performance.now();
				document.dispatchEvent(new CustomEvent("bench:noop", { detail: "{}" }));
				dispatch.push(performance.now() - t2);
			}
			for (var u = 0; u < listeners.length; u++) document.removeEventListener("bench:noop", listeners[u]);
			return JSON.stringify({
				parse: { small: stats(parse.small), medium: stats(parse.medium), binary: stats(parse.binary) },
				dispatch10: stats(dispatch),
			});
		},
	};
	status.textContent = "bench installed";
})();
