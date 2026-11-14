/**
 * The frontend side of `crust dev`: the bridge pair handed to the dev server,
 * and the readiness wait that stops the window racing Vite's first listen.
 */

/**
 * The pair `crust/vite` reads, taken from this process's environment. Both are empty for a `dev.url` app whose runtime has not published a bridge address yet; the caller turns that into one line rather than a page that fails its first invoke with no explanation.
 */
export function bridgeEnv(devUrl: string | undefined): Record<string, string> {
	if (devUrl === undefined) return {};
	const url = process.env.CRUST_BRIDGE_URL?.trim() ?? "";
	const token = process.env.CRUST_BRIDGE_TOKEN?.trim() ?? "";
	if (url.length === 0 || token.length === 0) return {};
	return { CRUST_BRIDGE_URL: url, CRUST_BRIDGE_TOKEN: token };
}

/**
 * Wait until a URL accepts a connection, or the deadline passes. A refused connection fails immediately, so a 100 ms poll costs almost nothing, and any answer counts — including a 404 — because the window only needs the server up. It exists because the window's load is issued exactly once: without the wait, a cold start loses the race against Vite's first listen and the page never appears.
 */
export async function waitForDevServer(url: string, timeoutMs: number): Promise<boolean> {
	const target = new URL(url);
	const hostname = target.hostname;
	const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		// A TCP connect, never an HTTP request: fetching the page would run the dev
		// server's own transforms before `.crust/dev.json` exists, and the Vite client
		// then prints "no window.crust" for a page that is about to be injected properly.
		const up = await Bun.connect({
			hostname,
			port,
			socket: {
				data() {},
				open(socket) {
					socket.end();
				},
			},
		}).then(
			() => true,
			() => false,
		);
		if (up) return true;
		await Bun.sleep(100);
	}
	return false;
}
