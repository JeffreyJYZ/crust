/**
 * The `dev.url` port: which port a URL names, who is holding it, and whether
 * that state is launchable. A busy port is not a broken project — only a
 * holder that answers nothing on that URL is fatal.
 */

import { type Check, shellOutput } from "./check.ts";

/** Hostnames whose ports are this machine's to report on. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export type DevUrlTarget = { hostname: string; port: number } | "remote" | "unreadable";

/**
 * The port a `dev.url` names, when that URL is a loopback name doctor can probe.
 *
 * A remote URL's port belongs to that host, so there is nothing local to check,
 * and `new URL` rejects strings a config can still carry. Both are told apart
 * from a real target so each gets its own one-line note rather than a failure.
 */
export function devUrlTarget(url: string): DevUrlTarget {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return "unreadable";
	}
	if (!LOOPBACK_HOSTNAMES.has(target.hostname.toLowerCase())) return "remote";
	const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
	return Number.isInteger(port) && port > 0 ? { hostname: target.hostname, port } : "unreadable";
}

/**
 * Whether a TCP connection to `hostname:port` is accepted.
 *
 * This is the client half of "is that port free": a refused connection answers
 * in a millisecond on loopback, and the timeout only bounds a host that drops.
 */
async function portAccepts(hostname: string, port: number): Promise<boolean> {
	const connect = Bun.connect({
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
	return await Promise.race([connect, Bun.sleep(750).then(() => false)]);
}

/** The pid holding a listening TCP port, from `lsof`; absent when unreadable. */
async function portHolder(port: number): Promise<number | undefined> {
	const text = await shellOutput(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
	const first = text?.split("\n")[0]?.trim();
	if (first === undefined || first.length === 0) return undefined;
	const pid = Number.parseInt(first, 10);
	return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export interface DevPortFacts {
	url: string;
	port: number;
	/** A TCP connection to the port was accepted. */
	listening: boolean;
	/** An HTTP request to `url` answered, with any status. */
	answered: boolean;
	/** The listening pid, when `lsof` could read it. */
	holder?: number;
}

/**
 * Turn the port probe into one line.
 *
 * A busy port is not a broken project: a dev server the user already has open
 * is exactly what `dev.url` describes. Only a holder that answers nothing on
 * that URL is fatal, because `strictPort` then refuses to start and `crust dev`
 * waits 30 s for a page nothing will serve.
 */
export function classifyDevPort(facts: DevPortFacts): Check {
	const { url, port, listening, answered, holder } = facts;
	const who =
		holder === undefined ? "a process lsof cannot read (another user)" : `pid ${holder}`;
	if (!listening && !answered) {
		return { name: "dev port", status: "ok", detail: `port ${port} is free for ${url}` };
	}
	if (listening && answered) {
		return {
			name: "dev port",
			status: "note",
			detail:
				`port ${port} is held by ${who} and already answers ${url} — an existing dev server is fine; ` +
				"free it or change dev.url to run a second one",
		};
	}
	if (listening) {
		return {
			name: "dev port",
			status: "fail",
			detail:
				`port ${port} is held by ${who}, which does not answer ${url} — a strictPort dev server cannot ` +
				"start there, and crust dev would wait 30 s for a page nothing serves; free the port or change dev.url",
		};
	}
	return {
		name: "dev port",
		status: "note",
		detail: `${url} answers but nothing is listening on port ${port} locally — a proxy or a remote host is serving it`,
	};
}

/**
 * The port and URL lines for one `dev.url`.
 *
 * The port is checked first because it is the failure a `strictPort` server
 * reports from its own command, after crust has already handed it the terminal.
 */
export async function checkDevServer(url: string): Promise<Check[]> {
	const checks: Check[] = [];
	const target = devUrlTarget(url);
	const listening =
		target === "remote" || target === "unreadable"
			? false
			: await portAccepts(target.hostname, target.port);
	const holder =
		target !== "remote" && target !== "unreadable" && listening
			? await portHolder(target.port)
			: undefined;
	const response = await fetch(url, { signal: AbortSignal.timeout(1500) }).catch(() => null);
	if (target === "unreadable") {
		checks.push({
			name: "dev port",
			status: "note",
			detail: `dev.url ${url} is not a URL, so it names no port to check`,
		});
	} else if (target === "remote") {
		checks.push({
			name: "dev port",
			status: "note",
			detail: `${url} is not loopback, so its port belongs to that host — nothing local to check`,
		});
	} else {
		checks.push(
			classifyDevPort({
				url,
				port: target.port,
				listening,
				answered: response !== null,
				holder,
			}),
		);
	}
	if (response)
		checks.push({
			name: "dev url",
			status: "ok",
			detail: `${url} answered ${response.status}`,
		});
	else
		checks.push({
			name: "dev url",
			status: "fail",
			detail: `${url} did not answer — is the frontend dev server running?`,
		});
	return checks;
}
