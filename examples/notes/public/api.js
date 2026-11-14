/**
 * The bridge half: the status line, and the one place that unwraps a command's
 * envelope.
 *
 * Every command answers with `{ ok: true, value }` or `{ ok: false, code,
 * message }`, so a refused name is data the page can show, not an exception that
 * loses its reason.
 */

/** The status line under the toolbar: one message, one tone class. */
export function createStatus(statusEl) {
	function show(text, tone) {
		statusEl.textContent = text || "";
		statusEl.className = "status" + (tone ? " " + tone : "");
	}

	function report(prefix, error) {
		var code = error && error.code ? " (" + error.code + ")" : "";
		show(
			prefix + ": " + (error && error.message ? error.message : String(error)) + code,
			"error",
		);
	}

	return { show: show, report: report };
}

/** Call an app command and answer with its value, keeping a failure's code. */
export function invoke(name, args) {
	return window.crust.invoke(name, args || {}).then(function (reply) {
		if (!reply || typeof reply !== "object") {
			throw new Error(name + ": the bridge returned no result");
		}
		if (!reply.ok) {
			var error = new Error(reply.message || reply.code || name + " failed");
			error.code = reply.code;
			throw error;
		}
		return reply.value;
	});
}
