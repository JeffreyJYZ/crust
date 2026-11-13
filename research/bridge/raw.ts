/**
 * Raw-socket bridge probe. Every measurement speaks HTTP/1.1 over a plain TCP
 * socket so the numbers are wire numbers: fetch() hides the connection pool and
 * the byte counts, and a fresh socket per call is what a naive probe measures.
 * fetch() to loopback is not proxied on this machine (`fetch-path.ts` shows the
 * server seeing 127.0.0.1 for a fetch call), so the socket client is the
 * measuring instrument here, not a workaround.
 *
 * Run: bun run /Users/jyz/dev/crust/research/bridge/raw.ts [probe]
 * Prints one PASS/FAIL line per probe, then exits non-zero on any failure.
 */

import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { HOST, TOKEN, startBridge, makeResponse, installProbeCommands } from "./bridge.ts";
import { http, enc, dec } from "./http.ts";

const results: Array<{ id: string; pass: boolean; line: string }> = [];
function report(id: string, pass: boolean, line: string) {
	results.push({ id, pass, line });
	console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${line}`);
}

// ---------------------------------------------------------------- 1. bind
async function probeBind() {
	const t0 = performance.now();
	const h = await startBridge();
	const bindMs = performance.now() - t0;
	const port = h.port;

	const lan = lanIp();
	const lanOk = lan ? await canConnect(lan, port, 900) : false;
	const loopOk = await canConnect(HOST, port, 900);
	const nameOk = await canConnect("localhost", port, 900);
	await h.stop();

	report(
		"1 bind",
		port > 0 && loopOk && !lanOk,
		`port=${port} bind=${bindMs.toFixed(2)}ms loopback-ip=${loopOk} loopback-name=${nameOk} lan(${lan ?? "none"})=${lanOk}`,
	);
}

function lanIp(): string | null {
	const r = Bun.spawnSync(["sh", "-c", "ipconfig getifaddr en0 || ipconfig getifaddr en1 || true"]);
	return r.stdout.toString().trim() || null;
}

/**
 * True when a TCP connect to host:port succeeds. `Bun.connect` returns a
 * promise, so an *expected* refusal (the LAN address) must be caught here or
 * Bun prints its own `error: Failed to connect` into the probe's output.
 */
async function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<false>((resolve) => {
		timer = setTimeout(() => resolve(false), timeoutMs);
	});
	const attempt = Bun.connect({
		hostname: host,
		port,
		socket: { open() {}, data() {}, close() {}, error() {}, drain() {} } as any,
	} as any)
		.then((sock: any) => {
			try {
				sock.end();
			} catch {}
			return true;
		})
		.catch(() => false);
	const ok = await Promise.race([attempt, timeout]);
	clearTimeout(timer);
	return ok === true;
}

// ------------------------------------------------------------- 2. latency
async function probeLatency(h: Awaited<ReturnType<typeof startBridge>>) {
	const auth = { authorization: `Bearer ${TOKEN}`, origin: h.url, "content-type": "application/json" };
	const body = JSON.stringify({ command: "noop" });
	const samples: number[] = [];
	let bad = 0;
	for (let i = 0; i < 200; i++) {
		const r = await http(h.port, "POST", "/_crust/invoke", auth, body);
		if (r.status !== 200 || !r.body.includes("pong")) bad++;
		samples.push(r.ms);
	}
	samples.sort((a, b) => a - b);
	const q = (f: number) => samples[Math.floor(f * samples.length)];

	installProbeCommands();
	const ip: number[] = [];
	for (let i = 0; i < 200; i++) {
		const t = performance.now();
		void makeResponse("pong");
		ip.push(performance.now() - t);
	}
	ip.sort((a, b) => a - b);

	report(
		"2 latency",
		bad === 0,
		`socket n=200 bad=${bad} median=${q(0.5).toFixed(3)}ms p99=${q(0.99).toFixed(3)}ms min=${samples[0].toFixed(3)} max=${samples[samples.length - 1].toFixed(3)} | in-process Response() median=${ip[100].toFixed(4)}ms p99=${ip[198].toFixed(4)}ms`,
	);
}

// --------------------------------------------------------------- 3. token
async function probeToken(h: Awaited<ReturnType<typeof startBridge>>) {
	const base = { origin: h.url, "content-type": "application/json" };
	const body = JSON.stringify({ command: "noop" });
	const noTok = await http(h.port, "POST", "/_crust/invoke", base, body);
	const wrong = await http(h.port, "POST", "/_crust/invoke", { ...base, authorization: "Bearer nope" }, body);
	const right = await http(h.port, "POST", "/_crust/invoke", { ...base, authorization: `Bearer ${TOKEN}` }, body);
	const doc = await http(h.port, "GET", "/", { origin: h.url });
	report(
		"3 token",
		noTok.status === 401 && wrong.status === 401 && right.status === 200 && doc.status === 200,
		`no-token=${noTok.status} wrong-token=${wrong.status} correct=${right.status} (result=${/pong/.test(right.body) ? "pong" : right.body}) document-without-token=${doc.status}`,
	);
}

// -------------------------------------------------------------- 4. origin
async function probeOrigin(h: Awaited<ReturnType<typeof startBridge>>) {
	const body = JSON.stringify({ command: "noop" });
	const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
	const own = await http(h.port, "POST", "/_crust/invoke", { ...auth, origin: h.url }, body);
	const absent = await http(h.port, "POST", "/_crust/invoke", auth, body);
	const foreign = await http(h.port, "POST", "/_crust/invoke", { ...auth, origin: "http://evil.example:1234" }, body);
	const dev = await http(h.port, "POST", "/_crust/invoke", { ...auth, origin: "http://localhost:5173" }, body);

	const h2 = await startBridge({ devOrigins: ["http://localhost:5173"] });
	const devAllowed = await http(h2.port, "POST", "/_crust/invoke", { ...auth, origin: "http://localhost:5173" }, body);
	const foreign2 = await http(h2.port, "POST", "/_crust/invoke", { ...auth, origin: "http://evil.example:1234" }, body);
	await h2.stop();

	report(
		"4 origin",
		own.status === 200 &&
			absent.status === 403 &&
			foreign.status === 403 &&
			dev.status === 403 &&
			devAllowed.status === 200 &&
			foreign2.status === 403,
		`own=${own.status} absent=${absent.status} foreign=${foreign.status} dev-when-off=${dev.status} dev-when-on=${devAllowed.status} foreign-when-dev-on=${foreign2.status} :: absent header is refused, so a check cannot be skipped by omitting it`,
	);
}

// ------------------------------------------------------------------ 5. SSE
async function probeSse(h: Awaited<ReturnType<typeof startBridge>>) {
	const t0 = performance.now();
	let buf = "";
	let ready = false;
	const events: number[] = [];
	let reads = 0;

	const sock = await Bun.connect({
		hostname: HOST,
		port: h.port,
		socket: {
			data(_s: unknown, c: Uint8Array) {
				reads++;
				buf += dec.decode(c);
				let i: number;
				while ((i = buf.indexOf("\n\n")) !== -1) {
					const frame = buf.slice(0, i);
					buf = buf.slice(i + 2);
					if (frame.includes("event: crust:ready")) ready = true;
					if (frame.includes("event: tick")) events.push(performance.now() - t0);
				}
			},
			close() {},
			error() {},
		} as any,
		failure() {},
	} as any);

	sock.write(
		enc.encode(
			`GET /_crust/events?token=${encodeURIComponent(TOKEN)} HTTP/1.1\r\n` +
				`host: ${HOST}:${h.port}\r\n` +
				`origin: ${h.url}\r\n` +
				"accept: text/event-stream\r\n" +
				"connection: close\r\n\r\n",
		),
	);

	const deadline = performance.now() + 8000;
	while (performance.now() < deadline && events.length < 20) await Bun.sleep(5);
	try {
		sock.end();
	} catch {}

	const gaps: number[] = [];
	for (let i = 1; i < events.length; i++) gaps.push(events[i] - events[i - 1]);
	gaps.sort((a, b) => a - b);
	const span = events.length ? events[events.length - 1] - events[0] : 0;

	report(
		"5 sse",
		ready && events.length === 20,
		`ready=${ready} ticks=${events.length}/20 socketReads=${reads} span=${span.toFixed(1)}ms gap median=${(gaps[Math.floor(gaps.length / 2)] ?? 0).toFixed(2)}ms max=${(gaps[gaps.length - 1] ?? 0).toFixed(2)}ms coalesced=${reads < events.length ? "some (" + reads + " reads for " + events.length + " frames)" : "no"}`,
	);
}

// --------------------------------------------------------------- 6. payload
async function probePayload(h: Awaited<ReturnType<typeof startBridge>>) {
	const auth = { authorization: `Bearer ${TOKEN}`, origin: h.url };

	const json = JSON.stringify({ blob: "x".repeat(1024 * 1024) });
	const rJson = await http(h.port, "POST", "/_crust/echo-bytes", { ...auth, "content-type": "application/json" }, json);

	const bin = new Uint8Array(1024 * 1024);
	for (let i = 0; i < bin.length; i++) bin[i] = i & 0xff;
	const rBin = await http(h.port, "POST", "/_crust/echo-bytes", { ...auth, "content-type": "application/octet-stream" }, bin);

	const rBack = await http(
		h.port,
		"POST",
		"/_crust/invoke",
		{ ...auth, "content-type": "application/json" },
		JSON.stringify({ command: "big", args: { kb: 1024 } }),
	);

	const small = JSON.stringify({ blob: "x".repeat(1024) });
	const rSmall = await http(h.port, "POST", "/_crust/echo-bytes", { ...auth, "content-type": "application/json" }, small);

	const jsonBytes = (JSON.parse(rJson.body) as { bytes: number }).bytes;
	const binBytes = (JSON.parse(rBin.body) as { bytes: number }).bytes;
	const pass =
		rJson.status === 200 &&
		rBin.status === 200 &&
		rBack.status === 200 &&
		jsonBytes === Buffer.byteLength(json) &&
		binBytes === bin.length;
	report(
		"6 payload",
		pass,
		`json 1.00MB ${rJson.ms.toFixed(1)}ms (server read ${(jsonBytes / 1048576).toFixed(2)}MB) | binary 1.00MB ${rBin.ms.toFixed(1)}ms (${(binBytes / 1048576).toFixed(2)}MB) | json 1.00MB response ${rBack.ms.toFixed(1)}ms (${(rBack.body.length / 1048576).toFixed(2)}MB back) | 1KB json ${rSmall.ms.toFixed(2)}ms`,
	);
}

// ------------------------------------------------------------ 7. port reuse
async function probePortReuse() {
	const h = await startBridge();
	const port = h.port;
	const url1 = h.url;
	await h.stop();

	// The claim under test is "the bridge can be restarted on the port it just
	// gave up", so the second bind goes through startBridge, not a bare serve.
	let exactOk = false;
	let exactMs = 0;
	let exactServes = false;
	let err = "";
	try {
		const t0 = performance.now();
		const again = await startBridge({ port });
		exactMs = performance.now() - t0;
		exactOk = again.port === port;
		const r = await http(again.port, "POST", "/_crust/invoke", {
			authorization: `Bearer ${TOKEN}`,
			origin: again.url,
			"content-type": "application/json",
		}, JSON.stringify({ command: "noop" }));
		exactServes = r.status === 200 && r.body.includes("pong");
		await again.stop();
	} catch (e) {
		err = e instanceof Error ? e.message : String(e);
	}

	// A stopped bridge must also free the process: a child that starts, stops and
	// returns must exit 0 without anyone calling process.exit().
	const child = join(import.meta.dir, "exit-child.tmp.ts");
	await Bun.write(
		child,
		`import { startBridge } from "./bridge.ts";\nconst h = await startBridge();\nawait h.stop();\nconsole.log("stopped");\n`,
	);
	const tExit = performance.now();
	const proc = Bun.spawnSync(["bun", "run", child], { cwd: import.meta.dir });
	const exitMs = performance.now() - tExit;
	await Bun.file(child).delete().catch(() => {});

	const pass = exactOk && exactServes && proc.exitCode === 0;
	report(
		"7 port-reuse + exit",
		pass,
		`rebind-exact-port=${exactOk} in ${exactMs.toFixed(2)}ms serving=${exactServes} | original=${port} | child-exit=${proc.exitCode} in ${exitMs.toFixed(0)}ms stdout=${JSON.stringify(proc.stdout.toString().trim())}${err ? " err=" + err : ""}`,
	);
}

// -------------------------------------------------------------- 8. headers
const VITE_ORIGIN = "http://localhost:5173";

/**
 * What the served page needs, and what changes when the page is served by Vite
 * on another origin. Three questions: (a) does the document carry the CSP the
 * page needs and no CORS at all, (b) does a same-origin call work with zero
 * CORS headers, (c) does a Vite-origin page get exactly a preflight, a call
 * and a stream, and nothing more when dev origins are off.
 */
async function probeHeaders(h: Awaited<ReturnType<typeof startBridge>>) {
	const doc = await http(h.port, "GET", "/", { origin: h.url });
	const docNoOrigin = await http(h.port, "GET", "/", {});
	const sameCall = await http(
		h.port,
		"POST",
		"/_crust/invoke",
		{ authorization: `Bearer ${TOKEN}`, origin: h.url, "content-type": "application/json" },
		JSON.stringify({ command: "noop" }),
	);

	// Production: the Vite origin is a foreign origin and must be refused on all
	// three paths, not just the invoke call.
	const preProd = await http(h.port, "OPTIONS", "/_crust/invoke", {
		origin: VITE_ORIGIN,
		"access-control-request-method": "POST",
		"access-control-request-headers": "authorization,content-type",
	});
	const callProd = await http(
		h.port,
		"POST",
		"/_crust/invoke",
		{ authorization: `Bearer ${TOKEN}`, origin: VITE_ORIGIN, "content-type": "application/json" },
		JSON.stringify({ command: "noop" }),
	);
	const sseProd = await http(h.port, "GET", `/_crust/events?token=${encodeURIComponent(TOKEN)}`, {
		origin: VITE_ORIGIN,
		accept: "text/event-stream",
	});
	await h.stop();

	// Dev: the same origin is configured, so the page gets a preflight, a call
	// and a stream, each echoing its own origin.
	const h2 = await startBridge({ devOrigins: [VITE_ORIGIN], sseIntervalMs: 5 });
	const preDev = await http(h2.port, "OPTIONS", "/_crust/invoke", {
		origin: VITE_ORIGIN,
		"access-control-request-method": "POST",
		"access-control-request-headers": "authorization,content-type",
	});
	const callDev = await http(
		h2.port,
		"POST",
		"/_crust/invoke",
		{ authorization: `Bearer ${TOKEN}`, origin: VITE_ORIGIN, "content-type": "application/json" },
		JSON.stringify({ command: "noop" }),
	);
	const sseDev = await http(h2.port, "GET", `/_crust/events?token=${encodeURIComponent(TOKEN)}`, {
		origin: VITE_ORIGIN,
		accept: "text/event-stream",
	});
	// The bridge's own page must stay CORS-free even with dev origins enabled:
	// a dev origin may be added, the served page must not be changed by it.
	const sameCallDev = await http(
		h2.port,
		"POST",
		"/_crust/invoke",
		{ authorization: `Bearer ${TOKEN}`, origin: h2.url, "content-type": "application/json" },
		JSON.stringify({ command: "noop" }),
	);
	await h2.stop();

	const acao = (r: { headers: Record<string, string> }) => r.headers["access-control-allow-origin"] ?? "none";
	const pass =
		doc.status === 200 &&
		doc.headers["content-security-policy"] !== undefined &&
		acao(doc) === "none" &&
		docNoOrigin.status === 200 &&
		sameCall.status === 200 &&
		acao(sameCall) === "none" &&
		preProd.status === 403 &&
		callProd.status === 403 &&
		sseProd.status === 403 &&
		preDev.status === 204 &&
		acao(preDev) === VITE_ORIGIN &&
		callDev.status === 200 &&
		acao(callDev) === VITE_ORIGIN &&
		sseDev.status === 200 &&
		acao(sseDev) === VITE_ORIGIN &&
		acao(sameCallDev) === "none";

	report(
		"8 headers",
		pass,
		[
			`doc=${doc.status} acao=${acao(doc)} doc-no-origin=${docNoOrigin.status}`,
			`csp=${doc.headers["content-security-policy"] ?? "none"}`,
			`same-origin-call=${sameCall.status} acao=${acao(sameCall)}`,
			`vite-prod: preflight=${preProd.status} call=${callProd.status} sse=${sseProd.status}`,
			`vite-dev: preflight=${preDev.status} acao=${acao(preDev)} acah=${preDev.headers["access-control-allow-headers"] ?? "none"} acam=${preDev.headers["access-control-allow-methods"] ?? "none"} max-age=${preDev.headers["access-control-max-age"] ?? "none"} vary=${preDev.headers["vary"] ?? "none"} | call=${callDev.status} acao=${acao(callDev)} vary=${callDev.headers["vary"] ?? "none"} | sse=${sseDev.status} acao=${acao(sseDev)}`,
			`own-page-under-dev-config acao=${acao(sameCallDev)}`,
		].join(" | "),
	);
}

// ------------------------------------------------------------------- main
const only = process.argv[2];
const h = await startBridge();

const jobs: Array<[string, () => Promise<void>]> = [
	["bind", () => probeBind()],
	["latency", () => probeLatency(h)],
	["token", () => probeToken(h)],
	["origin", () => probeOrigin(h)],
	["sse", () => probeSse(h)],
	["payload", () => probePayload(h)],
	["headers", () => probeHeaders(h)],
	["reuse", () => probePortReuse()],
];

for (const [name, fn] of jobs) {
	if (only && only !== name) continue;
	try {
		await fn();
	} catch (e) {
		report(name, false, `threw: ${e instanceof Error ? e.message : String(e)}`);
	}
}

await h.stop();
const failed = results.filter((r) => !r.pass).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);