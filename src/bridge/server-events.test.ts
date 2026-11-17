/**
 * The event stream, the payload sizes that ride one route, and the bind/unbind
 * lifecycle.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { startBridge } from "./server.ts";
import { Events, sseFrame } from "./server/events.ts";
import {
	headers,
	invoke,
	ownOrigin,
	readJson,
	SseReader,
	start,
	stopAll,
	testPlugin,
	track,
} from "./server/fixtures.ts";

afterEach(stopAll);

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

	test("a GET with no Origin opens the stream, as WebKitGTK's EventSource sends none", async () => {
		const bridge = start();
		const response = await fetch(
			`${bridge.url}/_crust/events?token=${encodeURIComponent(bridge.token)}`,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");

		const reader = new SseReader(response.body as ReadableStream<Uint8Array>);
		const ready = await reader.next();
		expect(ready?.event).toBe("crust:ready");
		expect(JSON.parse(ready?.data ?? "null")).toEqual({ port: bridge.port, protocol: 1 });
		await reader.close();
	});

	test("a foreign Origin is still refused 403", async () => {
		const bridge = start();
		const response = await fetch(
			`${bridge.url}/_crust/events?token=${encodeURIComponent(bridge.token)}`,
			{ headers: { origin: "http://evil.example" } },
		);
		expect(response.status).toBe(403);
		const body = await readJson(response);
		expect(body.error.code).toBe("bad-origin");
	});

	test("the stream needs a token too, even with no Origin", async () => {
		const bridge = start();
		const response = await fetch(`${bridge.url}/_crust/events`);
		expect(response.status).toBe(401);
		const body = await readJson(response);
		expect(body.error.code).toBe("unauthorized");
	});

	test("a disconnect drops its cleanup, so a reloading page does not leak one per stream", async () => {
		const events = new Events();
		for (let i = 0; i < 3; i++) {
			const response = events.stream(1);
			const reader = new SseReader(response.body as ReadableStream<Uint8Array>);
			await reader.next();
			expect(events.retainedCleanups).toBe(1);
			await reader.close();
			expect(events.retainedCleanups).toBe(0);
		}
	});

	test("sseFrame keeps an event name with a newline on one line", () => {
		const frame = sseFrame("tick\ndata: forged\n\nevent: other", { n: 1 });
		expect(frame.split("\n\n")).toHaveLength(2);
		expect(frame).toContain("event: tick data: forged  event: other\n");
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

		const second = track(startBridge({ handlers: [testPlugin], port }));
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
