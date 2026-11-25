/** The measured arms. Every interval uses the page clock; cross-window uses Date.now. */

/** Control: the cost of one paint probe, so a poll-quantized number has a stated floor. */
async function armCapture(n) {
	const times = [];
	for (let i = 0; i < n; i += 1) {
		const t = performance.now();
		await capture();
		times.push(performance.now() - t);
	}
	return stats(times);
}

/**
 * 1. Keystroke to painted glyph. A window.capture PNG diff is the paint proof:
 * the baseline is taken with the glyph empty, the key is dispatched from the
 * page, and the first capture that differs proves the glyph was presented.
 */
async function armKeystroke(n) {
	const glyph = document.getElementById("glyph");
	const input = document.getElementById("key");
	const domTimes = [];
	const paintProof = [];
	const polls = [];
	for (let i = 0; i < n; i += 1) {
		glyph.textContent = "";
		input.value = "";
		await sleep(15);
		const baseline = await capture();
		const t0 = performance.now();
		input.dispatchEvent(new KeyboardEvent("keydown", { key: String.fromCharCode(65 + (i % 26)), bubbles: true }));
		domTimes.push(performance.now() - t0);
		let png = baseline;
		let count = 0;
		const from = performance.now();
		while (performance.now() - from < 1000) {
			png = await capture();
			count += 1;
			if (png !== null && png !== baseline) break;
			await sleep(2);
		}
		polls.push(count);
		paintProof.push(performance.now() - t0);
		if (i % 10 === 9 && state.result) {
			await report({ ...state.result, progress: { keystroke: i + 1, lastMs: paintProof[i] } });
		}
	}
	return {
		domArrival: stats(domTimes),
		painted: stats(paintProof),
		capturePolls: stats(polls),
	};
}

/** 2. Click to handler. Synthetic and page-dispatched: a floor, not OS delivery. */
async function armClick(n) {
	const btn = document.getElementById("btn");
	let handlerAt = 0;
	const listener = () => void (handlerAt = performance.now());
	btn.addEventListener("click", listener);
	const gaps = [];
	const blocked = [];
	for (let i = 0; i < n; i += 1) {
		handlerAt = 0;
		const t0 = performance.now();
		btn.click();
		gaps.push(handlerAt - t0);
		handlerAt = 0;
		const b0 = performance.now();
		busy(20); // labelled control: a main thread held 20 ms before dispatch
		btn.click();
		blocked.push(handlerAt - b0);
	}
	btn.removeEventListener("click", listener);
	return { synthetic: stats(gaps), blocked20ms: stats(blocked) };
}

/** 3. Scroll a tall list for 3 s; count drawn frames and long frames. */
async function armScroll(ms) {
	const list = document.getElementById("list");
	for (let i = 0; i < 400; i += 1) {
		const row = document.createElement("div");
		row.textContent = `row ${i}`;
		list.append(row);
	}
	list.scrollTop = 0;
	const before = await capture();
	const deltas = [];
	let frames = 0;
	let last = 0;
	const start = performance.now();
	await Promise.race([
		new Promise((resolve) => {
			const tick = (now) => {
				if (last !== 0) deltas.push(now - last);
				last = now;
				frames += 1;
				list.scrollTop += 7;
				if (performance.now() - start < ms) requestAnimationFrame(tick);
				else resolve(undefined);
			};
			requestAnimationFrame(tick);
		}),
		sleep(ms + 1500),
	]);
	const durationMs = performance.now() - start;
	const after = await capture();
	return {
		durationMs,
		frames,
		expectedFrames: Math.round((durationMs / 1000) * 60),
		droppedFrames: Math.round((durationMs / 1000) * 60) - frames,
		fps: frames / (durationMs / 1000),
		frame: stats(deltas),
		longFrames: deltas.filter((delta) => delta > 50).length,
		painted: before !== null && after !== null && before !== after,
	};
}

/** 5. A 20-step window resize; each step is one bridge call to the native window. */
async function armResize(steps) {
	const deltas = [];
	const paintCost = [];
	let frames = 0;
	let last = 0;
	let running = true;
	const tick = (now) => {
		if (!running) return;
		if (last !== 0) deltas.push(now - last);
		last = now;
		frames += 1;
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	for (let i = 0; i < steps; i += 1) {
		const t = performance.now();
		const width = 420 + (i % 2 === 0 ? 60 : 0);
		await window.crust.invoke("window", "setSize", { label: "main", width, height: 320 });
		paintCost.push(performance.now() - t);
		await sleep(25);
	}
	running = false;
	return {
		steps,
		frames,
		frame: stats(deltas),
		longFrames: deltas.filter((delta) => delta > 50).length,
		setSizeCost: stats(paintCost),
	};
}
