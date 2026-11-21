/**
 * Page-side client proofs. The bootstrap is the injected source evaluated in a stub target, so
 * these exercise the exact bytes the served document carries, not a parallel copy of the client.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { definePlugin } from "../plugins/define";
import { bootstrapSource, installCrust, installInvoke } from "./client";
import { installPage } from "./client/fixtures.ts";
import { startBridge, type BridgeHandle } from "./server";
import { PNG } from "./server/fixtures.ts";

const testPlugin = definePlugin({
	name: "test",
	commands: {
		echo: (args: unknown) => args,
		boom: () => {
			throw new Error("page saw the handler throw");
		},
		png: () => ({ ok: true, png: PNG }),
	},
});

const running: BridgeHandle[] = [];

afterEach(async () => {
	while (running.length > 0) await running.pop()?.stop();
});

function start(): BridgeHandle {
	const bridge = startBridge({ handlers: [testPlugin] });
	running.push(bridge);
	return bridge;
}

describe("bootstrap", () => {
	test("installs window.crust with invoke, listen, once and ready", () => {
		const bridge = start();
		const { api } = installPage(bridge);
		expect(typeof api.invoke).toBe("function");
		expect(typeof api.listen).toBe("function");
		expect(typeof api.once).toBe("function");
		expect(api.ready).toBeInstanceOf(Promise);
		expect(api.token).toBe(bridge.token);
	});

	test("the installed source is self-contained and names the invoke route", () => {
		const bridge = start();
		const { api } = installPage(bridge);
		expect(api.baseUrl).toBe(bridge.url);
		// The page is given two serialised halves; both the route and the stream live in the invoke
		// half, because which transport carries the credential is the invoke half's business.
		expect(installInvoke.toString()).toContain("/_crust/invoke");
		expect(installInvoke.toString()).toContain("EventSource");
		expect(installCrust.toString()).toContain("crustInvoke");
		expect(bootstrapSource({ baseUrl: "", token: "t" })).toContain("/_crust/invoke");
	});
});

describe("invoke", () => {
	test("round-trips a command through the page client", async () => {
		const bridge = start();
		const { api } = installPage(bridge);
		const result = await api.invoke("test", "echo", { page: "hello" });
		expect(result).toEqual({ page: "hello" });
	});

	test("a handler throw rejects with its code and message", async () => {
		const bridge = start();
		const { api } = installPage(bridge);
		await expect(api.invoke("test", "boom")).rejects.toMatchObject({
			code: "handler-error",
			message: expect.stringContaining("page saw the handler throw"),
		});
	});

	test("a binary result arrives as bytes, not as an object of indices", async () => {
		const bridge = start();
		const { api } = installPage(bridge);
		const result = (await api.invoke("test", "png")) as { ok: boolean; png: Uint8Array };
		expect(result.ok).toBe(true);
		expect(result.png).toBeInstanceOf(Uint8Array);
		expect(Array.from(result.png)).toEqual(Array.from(PNG));
	});

	test("a wrong token rejects unauthorized", async () => {
		const bridge = start();
		const { api } = installPage(bridge, { config: { token: "not-the-token" } });
		await expect(api.invoke("test", "echo", {})).rejects.toMatchObject({
			code: "unauthorized",
		});
	});

	test("a 401 refusal rejects ready with the status and the bridge's reason", async () => {
		const bridge = start();
		const { api } = installPage(bridge, { config: { token: "not-the-token" } });
		await expect(api.invoke("test", "echo", {})).rejects.toMatchObject({
			code: "unauthorized",
		});
		await expect(api.ready).rejects.toMatchObject({
			code: "bridge-refused",
			name: "CrustInvokeError",
			status: 401,
			message: expect.stringContaining("missing or bad bearer token"),
		});
	});
});

describe("events", () => {
	test("ready resolves on the first handshake frame", async () => {
		const bridge = start();
		const { api, source } = installPage(bridge);
		expect(source?.url).toContain("/_crust/events?token=");
		source?.dispatch("crust:ready", { port: bridge.port, protocol: 1 });
		await api.ready;
		expect(bridge.port).toBeGreaterThan(0);
	});

	test("listen delivers payloads until unsubscribed, and once resolves", async () => {
		const bridge = start();
		const { api, source } = installPage(bridge);
		const seen: number[] = [];
		const off = api.listen<number>("tick", (n) => seen.push(n));
		source?.dispatch("tick", 1);
		source?.dispatch("tick", 2);
		expect(seen).toEqual([1, 2]);

		const next = api.once<number>("tick");
		source?.dispatch("tick", 3);
		expect(await next).toBe(3);

		off();
		source?.dispatch("tick", 4);
		expect(seen).toEqual([1, 2, 3]);
	});

	test("once rejects with a named timeout and leaves no waiter behind", async () => {
		const bridge = start();
		const { api, source } = installPage(bridge);
		await expect(api.once("never-fires", 20)).rejects.toMatchObject({
			code: "once-timeout",
			event: "never-fires",
			timeoutMs: 20,
			message: expect.stringContaining("never-fires"),
		});
		// The stale resolver must not consume a later event; a fresh waiter still settles.
		source?.dispatch("never-fires", { late: true });
		const next = api.once("tick", 500);
		source?.dispatch("tick", 9);
		expect(await next).toBe(9);
	});

	test("without EventSource, ready resolves after the first invoke", async () => {
		const bridge = start();
		const { api } = installPage(bridge, { stream: false });
		const result = await api.invoke("test", "echo", { fallback: true });
		expect(result).toEqual({ fallback: true });
		await api.ready;
	});
});
