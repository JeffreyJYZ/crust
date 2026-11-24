/**
 * Page-owned instrumentation for the invoke/event split. Loaded as an external same-origin script
 * in <head>, so it runs before the bridge's injected bootstrap; every `crust` reference is lazy.
 * All timings come from this page's `performance.now()` and its own rAF deltas.
 */
(function () {
	var ROWS = 60, RECTS = 200;
	var deltas = [], last = 0, on = false, longTasks = [], observed = false;
	var invTimer = null, manualTimer = null, manual = false;
	var invokes = 0, errors = 0, lastFrameAt = 0, events = 0;
	try {
		var po = new PerformanceObserver(function (list) {
			for (var i = 0; i < list.getEntries().length; i++) longTasks.push(list.getEntries()[i].duration);
		});
		po.observe({ entryTypes: ["longtask"] });
		observed = true;
	} catch (error) { observed = false; }
	var status, cells = [], canvas, paint;
	// External script runs in <head>, before <body> exists. Build the DOM view only when parsed.
	document.addEventListener("DOMContentLoaded", function () {
		status = document.getElementById("status");
		var rowHost = document.createElement("div");
		rowHost.id = "rows";
		document.body.appendChild(rowHost);
		for (var r = 0; r < ROWS; r++) {
			var cell = document.createElement("span");
			cell.textContent = String(r);
			rowHost.appendChild(cell);
			cells.push(cell);
		}
		canvas = document.getElementById("paint");
		paint = canvas.getContext("2d");
		if (status) status.textContent = "bench installed";
	});
	function workDirect(now) {
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
	}
	function frame(now) {
		if (!on) return;
		if (!manual) workDirect(now);
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
		if (manualTimer !== null) { clearInterval(manualTimer); manualTimer = null; }
		manual = false;
	}
	function pumpManual(hz, paced) {
		stopInvoke();
		manual = true;
		if (!paced) {
			manualTimer = setInterval(function () {
				window.crust.invoke("pagei", "ping").then(function () {
					invokes++;
					workDirect(performance.now());
				}, function () { errors++; });
			}, Math.max(1, Math.round(1000 / hz)));
			return;
		}
		// Lane A's driver was sequential: one invoke, then the next only after its reply.
		var next = function () {
			if (!manual) return;
			window.crust.invoke("pagei", "pace", { ms: 16 }).then(function () {
				if (!manual) return;
				invokes++;
				workDirect(performance.now());
				next();
			}, function () { errors++; next(); });
		};
		manualTimer = setTimeout(next, 0);
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
		ready: function () { return typeof window.crust === "object" && window.crust !== null && cells.length === ROWS; },
		start: function () {
			deltas = []; last = 0; longTasks = []; invokes = 0; errors = 0; events = 0; on = true;
			requestAnimationFrame(frame);
			return "started";
		},
		invoke: function (hz) { pumpInvoke(hz); return "invoke:" + hz; },
		manual: function (hz, paced) { pumpManual(hz, paced === true); return "manual:" + hz; },
		listenEvents: function () {
			window.crust.listen("pagei:tick", function () { events++; });
			return "listening";
		},
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
				events: events,
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
		micro: function (rounds) {
			// WKWebView clamps performance.now() to whole ms, so time a batch and divide; the result
			// is microseconds per op, the same unit lane B used for its hot-path table.
			var objs = {
				small: { ok: true, v: true },
				medium: { items: [] },
				binary: { __crustBytes: "A".repeat(1024 * 1024) },
			};
			for (var i = 0; i < 200; i++) objs.medium.items.push({ name: "field-" + i, value: "x".repeat(16) });
			var wire = { small: JSON.stringify(objs.small), medium: JSON.stringify(objs.medium), binary: JSON.stringify(objs.binary) };
			function timed(fn, batch) {
				var out = [];
				for (var r = 0; r < rounds; r++) {
					var t = performance.now();
					for (var b = 0; b < batch; b++) fn();
					out.push((performance.now() - t) * 1000 / batch);
				}
				return stats(out);
			}
			var out = { parseUs: {}, stringifyUs: {} };
			for (var k in wire) {
				out.parseUs[k] = timed(function () { JSON.parse(wire[k]); }, 50);
				out.stringifyUs[k] = timed(function () { JSON.stringify(objs[k]); }, 50);
			}
			var listeners = [];
			for (var l = 0; l < 10; l++) {
				var fn = function () {};
				listeners.push(fn);
				document.addEventListener("bench:noop", fn);
			}
			out.dispatch10Us = timed(function () {
				document.dispatchEvent(new CustomEvent("bench:noop", { detail: "{}" }));
			}, 50);
			for (var u = 0; u < listeners.length; u++) document.removeEventListener("bench:noop", listeners[u]);
			return JSON.stringify(out);
		},
	};
})();
