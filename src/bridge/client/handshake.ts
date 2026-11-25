/**
 * Readiness settlement, split out of `installCrust` for the 200-line cap. The factory is injected
 * as source, so it closes only over its arguments — never over module scope.
 */

/** The one callback the invoke half needs to report an HTTP exchange. */
export type HandshakeSink = (status: number, reason?: string) => void;

export function installHandshake(
	resolve: () => void,
	reject: (reason?: unknown) => void,
): HandshakeSink {
	let handshaken = false;
	// Only a completed 2xx exchange is readiness. A 4xx is the bridge refusing this page — a stale
	// token, a bad origin, no route — and rejects with its status and reason, so the page can tell a
	// refusal from "no bridge". A 5xx is a handler that threw; the bridge is reachable, so it counts.
	return (status: number, reason?: string) => {
		if (handshaken) return;
		handshaken = true;
		if (status < 400 || status >= 500) {
			resolve();
			return;
		}
		const error = new Error(
			`crust: bridge refused (${status})${reason ? `: ${reason}` : ""}`,
		) as Error & { name: string; code: string; status: number };
		error.name = "CrustInvokeError";
		error.code = "bridge-refused";
		error.status = status;
		reject(error);
	};
}
