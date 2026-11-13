/**
 * Server-side bridge proofs.
 *
 * Every rejection rule here is one research/bridge.md measured, and each test
 * states the measured answer it holds.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { definePlugin } from "../plugins/define";
import { fsPlugin } from "../plugins/fs";
import { startBridge, type BridgeHandle } from "./server";

const SECRET = "SECRET-FILE-CONTENTS-THAT-MUST-NOT-LEAK";

const testPlugin = definePlugin({
	name: "test",
	commands: {
		echo: (args: unknown) => args,
		secret: () => SECRET,
		boom: () => {
			throw new Error("handler blew up");
		},
		measureBytes: (args: unknown) => ({ bytes: (args as Uint8Array).byteLength }),
	},
});

const running: BridgeHandle[] = [];

function start(
	options: Parameters<typeof startBridge>[0] = { handlers: [testPlugin, fsPlugin] },
): BridgeHandle {
	const bridge = startBridge(options);
	running.push(bridge);
	return bridge;
}

afterEach(async () => {
	while (running.length > 0) await running.pop()?.stop();
});

function ownOrigin(bridge: BridgeHandle): string {
	return `http://127.0.0.1:${bridge.port}`;
}

function headers(bridge: BridgeHandle, extra: Record<string, string> = {}): Record<string, string> {
	return { "content-type": "application/json", origin: ownOrigin(bridge), ...extra };
}

function invoke(
	bridge: BridgeHandle,
	requestHeaders: Record<string, string>,
	body: unknown = { plugin: "test", command: "echo", args: { hello: "world" } },
): Promise<Response> {
	return fetch(`${bridge.url}/_crust/invoke`, {
		method: "POST",
		headers: requestHeaders,
		body: JSON.stringify(body),
	});
}

async function readJson(response: Response): Promise<any> {
	return (await response.json()) as any;
}

describe("token gate", () => {
	test("missing token answers 401 unauthorized", async () => {
		const bridge = start();
		const response = await invoke(bridge, headers(bridge));
		expect(response.status).toBe(401);
		const body = await readJson(response);
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe("unauthorized");
	});

	test("wrong token answers 401 with the same body as no token", async () => {
		const bridge = start();
		const response = await invoke(bridge, headers(bridge, { authorization: "Bearer wrong" }));
		expect(response.status).toBe(401);
		const body = await readJson(response);
		expect(body.error.code).toBe("unauthorized");
	});

	test("a plugin command cannot be reached without a token", async () => {
		const bridge = start();
		const response = await invoke(bridge, headers(bridge), {
			plugin: "test",
			command: "secret",
			args: {},
		});
		expect(response.status).toBe(401);
		expect(await response.text()).not.toContain(SECRET);
	});
});

describe("origin gate", () => {
	test("own origin with the right token answers 200", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
		);
		expect(response.status).toBe(200);
		const body = await readJson(response);
		expect(body.ok).toBe(true);
		expect(body.result).toEqual({ hello: "world" });
	});

	test("an absent Origin is refused 403, not treated as same-origin", async () => {
		const bridge = start();
		const response = await invoke(bridge, {
			"content-type": "application/json",
			authorization: `Bearer ${bridge.token}`,
		});
		expect(response.status).toBe(403);
		const body = await readJson(response);
		expect(body.error.code).toBe("bad-origin");
	});

	test("a foreign origin is refused 403", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, {
				authorization: `Bearer ${bridge.token}`,
				origin: "http://127.0.0.2:1",
			}),
		);
		expect(response.status).toBe(403);
	});
});

describe("invoke", () => {
	test("round-trips a plugin command and its args", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{
				plugin: "test",
				command: "echo",
				args: { nested: { n: 7 }, list: [1, 2, 3] },
			},
		);
		const body = await readJson(response);
		expect(body.result).toEqual({ nested: { n: 7 }, list: [1, 2, 3] });
	});

	test("an unknown command is a structured 404", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{
				plugin: "test",
				command: "nope",
			},
		);
		expect(response.status).toBe(404);
		const body = await readJson(response);
		expect(body.error.code).toBe("unknown-command");
	});

	test("a throwing handler is a structured handler-error", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{
				plugin: "test",
				command: "boom",
			},
		);
		expect(response.status).toBe(500);
		const body = await readJson(response);
		expect(body.error.code).toBe("handler-error");
		expect(body.error.message).toBe("handler blew up");
	});
});

describe("document", () => {
	test("the document is served without a token and carries the CSP", async () => {
		const bridge = start({
			handlers: [testPlugin],
			indexHtml: "<!doctype html><html><head><title>x</title></head><body></body></html>",
		});
		const response = await fetch(`${bridge.url}/`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		const csp = response.headers.get("content-security-policy") ?? "";
		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("connect-src 'self'");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	});

	test("the token is injected into index.html and nowhere else", async () => {
		const bridge = start({
			handlers: [testPlugin],
			indexHtml: "<!doctype html><html><head></head><body><h1>app</h1></body></html>",
			assets: { "/assets/app.js": "export const answer = 42;" },
		});
		const document = await (await fetch(`${bridge.url}/`)).text();
		expect(document).toContain("__CRUST__");
		expect(document).toContain("/_crust/invoke");
		expect(document).toContain(bridge.token);
		expect(document).toContain("baseUrl");

		const assetResponse = await fetch(`${bridge.url}/assets/app.js`);
		expect(assetResponse.status).toBe(200);
		expect(assetResponse.headers.get("content-type")).toContain("text/javascript");
		const asset = await assetResponse.text();
		expect(asset).toBe("export const answer = 42;");
		expect(asset).not.toContain(bridge.token);
	});

	test("a custom csp replaces the measured default", async () => {
		const bridge = start({ handlers: [testPlugin], csp: "default-src 'none'" });
		const response = await fetch(`${bridge.url}/`);
		expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
	});

	test("an unknown path is a structured 404", async () => {
		const bridge = start();
		const response = await fetch(`${bridge.url}/nope`, {
			headers: { origin: ownOrigin(bridge), authorization: `Bearer ${bridge.token}` },
		});
		expect(response.status).toBe(404);
		const body = await readJson(response);
		expect(body.error.code).toBe("not-found");
	});
});

const DEV_ORIGIN = "http://localhost:5173";

describe("dev origin", () => {
	test("preflight answers 204 with the measured CORS headers", async () => {
		const bridge = start({ handlers: [testPlugin], devOrigin: DEV_ORIGIN });
		const response = await fetch(`${bridge.url}/_crust/invoke`, {
			method: "OPTIONS",
			headers: { origin: DEV_ORIGIN },
		});
		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe(DEV_ORIGIN);
		expect(response.headers.get("access-control-allow-methods")).toBe("POST, GET, OPTIONS");
		expect(response.headers.get("access-control-allow-headers")).toBe(
			"authorization, content-type",
		);
		expect(response.headers.get("access-control-max-age")).toBe("600");
		expect(response.headers.get("vary")).toBe("origin");
	});

	test("a configured dev origin may call, and its response echoes the origin", async () => {
		const bridge = start({ handlers: [testPlugin], devOrigin: DEV_ORIGIN });
		const response = await invoke(bridge, {
			"content-type": "application/json",
			origin: DEV_ORIGIN,
			authorization: `Bearer ${bridge.token}`,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe(DEV_ORIGIN);
		expect(response.headers.get("vary")).toBe("origin");
	});

	test("a foreign origin stays 403 even with a dev origin configured", async () => {
		const bridge = start({ handlers: [testPlugin], devOrigin: DEV_ORIGIN });
		const response = await invoke(bridge, {
			"content-type": "application/json",
			origin: "http://127.0.0.2:1",
			authorization: `Bearer ${bridge.token}`,
		});
		expect(response.status).toBe(403);
	});

	test("the served page still gets no CORS header with a dev origin configured", async () => {
		const bridge = start({ handlers: [testPlugin], devOrigin: DEV_ORIGIN });
		const response = await fetch(`${bridge.url}/`, { headers: { origin: ownOrigin(bridge) } });
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});
});

describe("events", () => {
	test("20 pushes arrive in order after the ready frame", async () => {
		const bridge = start();
		const response = await fetch(
			`${bridge.url}/_crust/events?token=${encodeURIComponent(bridge.token)}`,
			{
				headers: { origin: ownOrigin(bridge) },
			},
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");

		const reader = new SseReader(response.body as ReadableStream<Uint8Array>);
		const ready = await reader.next();
		expect(ready?.event).toBe("crust:ready");

		for (let n = 1; n <= 20; n++) bridge.emit("tick", { n });
		const seen: number[] = [];
		for (let i = 0; i < 20; i++) {
			const frame = await reader.next();
			expect(frame?.event).toBe("tick");
			seen.push(JSON.parse(frame?.data ?? "null").n);
		}
		expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
		await reader.close();
	});

	test("the stream needs a token too", async () => {
		const bridge = start();
		const response = await fetch(`${bridge.url}/_crust/events`, {
			headers: { origin: ownOrigin(bridge) },
		});
		expect(response.status).toBe(401);
	});
});

describe("payloads", () => {
	test("a 1 MB JSON body round-trips", async () => {
		const bridge = start();
		const blob = "x".repeat(1024 * 1024);
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{
				plugin: "test",
				command: "echo",
				args: { blob },
			},
		);
		expect(response.status).toBe(200);
		const body = await readJson(response);
		expect(body.result.blob.length).toBe(1024 * 1024);
	});

	test("a 1 MB binary body arrives whole", async () => {
		const bridge = start();
		const bytes = new Uint8Array(1024 * 1024);
		bytes.fill(7);
		const response = await fetch(
			`${bridge.url}/_crust/invoke?plugin=test&command=measureBytes`,
			{
				method: "POST",
				headers: {
					origin: ownOrigin(bridge),
					authorization: `Bearer ${bridge.token}`,
					"content-type": "application/octet-stream",
				},
				body: bytes,
			},
		);
		expect(response.status).toBe(200);
		const body = await readJson(response);
		expect(body.result.bytes).toBe(1024 * 1024);
	});
});

describe("lifecycle", () => {
	test("a stopped bridge releases its port and a new one rebinds it", async () => {
		const first = startBridge({ handlers: [testPlugin] });
		const port = first.port;
		await first.stop();

		const second = startBridge({ handlers: [testPlugin], port });
		running.push(second);
		expect(second.port).toBe(port);

		const response = await invoke(
			second,
			headers(second, { authorization: `Bearer ${second.token}` }),
			{
				plugin: "test",
				command: "echo",
				args: "after-rebind",
			},
		);
		expect(response.status).toBe(200);
		expect((await readJson(response)).result).toBe("after-rebind");
	});
});

interface ChunkReader {
	read(): Promise<{ done: boolean; value?: Uint8Array }>;
	cancel(): Promise<void>;
}

class SseReader {
	private readonly reader: ChunkReader;
	private buffer = "";
	private readonly decoder = new TextDecoder();

	constructor(body: { getReader(): ChunkReader }) {
		this.reader = body.getReader();
	}

	async next(): Promise<{ event: string; data: string } | null> {
		while (true) {
			const boundary = this.buffer.indexOf("\n\n");
			if (boundary !== -1) {
				const frame = this.buffer.slice(0, boundary);
				this.buffer = this.buffer.slice(boundary + 2);
				const event = /event: (.+)/.exec(frame)?.[1];
				const data = /data: (.+)/.exec(frame)?.[1] ?? "";
				if (event) return { event, data };
				continue;
			}
			const chunk = await this.reader.read();
			if (chunk.done) return null;
			this.buffer += this.decoder.decode(chunk.value, { stream: true });
		}
	}

	async close(): Promise<void> {
		await this.reader.cancel().catch(() => {});
	}
}
