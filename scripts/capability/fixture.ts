/**
 * The fixture behind `e2e-capability`: a real bridge with two window grants and
 * the page-side script that tries to cross them. The probe runs *in the page*: it
 * reads its own `?token=` and `?window=` out of `location.search` and posts an
 * invoke body that claims another window's label. Nothing in Node builds the
 * spoofed body — the browser's own script does.
 */
import { definePlugin } from "../../src/plugins/define.ts";
import { startBridge, type BridgeHandle } from "../../src/bridge/server.ts";

/** The two labels the bridge serves, and the command only window B holds. */
export const WINDOW_A = "A";
export const WINDOW_B = "B";
export const SECRET_COMMAND = "secret";
export const ECHO_COMMAND = "echo";

/**
 * A document token is bound to its `?window=` when the bridge serves the page.
 * A holds only `test:echo`; B holds only `test:secret`. A page that holds A's
 * token can still *name* B in its body; configuration decides whether that
 * name carries any authority. Grabs the token from the URL the browser loaded —
 * the exact shape the spoof needs on a platform where the page owns its token.
 */
export function startFixtureBridge(): BridgeHandle {
	const plugin = definePlugin({
		name: "test",
		commands: {
			echo: (args: unknown) => args,
			secret: () => "CLASSIFIED",
		},
	});
	return startBridge({
		handlers: [plugin],
		security: {
			capabilities: [
				{ name: "safe", actions: [`test:${ECHO_COMMAND}`] },
				{ name: "secret", actions: [`test:${SECRET_COMMAND}`] },
			],
			grants: { [WINDOW_A]: ["safe"], [WINDOW_B]: ["secret"] },
		},
	});
}

/** The URL the browser navigates to; the bridge redirects to a per-document token. */
export function documentUrl(bridge: BridgeHandle, label: string): string {
	return `${bridge.url}/?token=${bridge.token}&window=${label}`;
}

export interface CallResult {
	status: number;
	ok: boolean;
	code: string | undefined;
}

export interface PageProbe {
	href: string;
	label: string | null;
	hasToken: boolean;
	own: CallResult;
	spoof: CallResult;
}

/**
 * The script evaluated inside the served document. Both calls claim window B;
 * `own` is the window's legitimate command, `spoof` is B's command. The only
 * difference between window A and window B is the token their document carries.
 * Returned as source so the same bytes run in both pages.
 */
export const PAGE_PROBE_SOURCE = `
(async () => {
  const q = new URLSearchParams(location.search);
  const token = q.get("token");
  const label = q.get("window");
  async function call(command, windowClaim) {
    const r = await fetch(location.origin + "/_crust/invoke", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ plugin: "test", command, window: windowClaim, args: null }),
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, ok: body.ok === true, code: body.error && body.error.code };
  }
  return {
    href: location.href,
    label: label,
    hasToken: typeof token === "string" && token.length > 0,
    own: await call(label === ${JSON.stringify(WINDOW_A)} ? ${JSON.stringify(ECHO_COMMAND)} : ${JSON.stringify(SECRET_COMMAND)}, label),
    spoof: await call(${JSON.stringify(SECRET_COMMAND)}, ${JSON.stringify(WINDOW_B)}),
  };
})()
`;
