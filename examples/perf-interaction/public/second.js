/** Reports this window's own timestamps to the parent's backend as soon as its
    script runs. No await on window.crust.ready: a runtime-created window's page
    has not always completed that handshake before this script executes. */
(async function () {
	try {
		const index = Number(new URLSearchParams(location.search).get("i"));
		await window.crust.invoke("latency", "mark", {
			index,
			readyAt: Date.now(),
			firstRafAt: state.firstRafAt,
		});
	} catch {
		// A missing mark is reported by the harness as an empty distribution.
	}
})();
