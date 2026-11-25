/** Window-open arm. A runtime-created window's page never reaches
    window.crust.ready in this in-process scaffold, so its own first-rAF mark
    cannot arrive. What remains observable is the create command's round trip
    from the parent page; the review labels it as a proxy, not first paint. */

async function armWindowOpen(n) {
	const times = [];
	for (let i = 0; i < n; i += 1) {
		const t0 = Date.now();
		const answer = await window.crust.invoke("window", "create", {
			label: `lat${i}`,
			url: `/second.html?i=${i}`,
			width: 480,
			height: 320,
		});
		if (answer && answer.ok === true) times.push(Date.now() - t0);
	}
	await sleep(500);
	for (let i = 0; i < n; i += 1) {
		await window.crust.invoke("window", "close", { label: `lat${i}` });
	}
	return { createAck: stats(times) };
}
