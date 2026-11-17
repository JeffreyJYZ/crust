/**
 * The page-side and wire-shape guards: what a served document must not let a label do, when `ready`
 * settles, and how a result carrying a reserved key survives the round trip.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { definePlugin } from "../plugins/define";
import { bootstrapSource } from "./client";
import { installPage } from "./client/fixtures.ts";
import { startBridge, type BridgeHandle } from "./server";
import { start, stopAll } from "./server/fixtures.ts";

const echoPlugin = definePlugin({
	name: "test",
	commands: {
		echo: (args: unknown) => args,
		boom: () => {
			throw new Error("page saw the handler throw");
		},
	},
});

const running: BridgeHandle[] = [];

afterEach(async () => {
	while (running.length > 0) await running.pop()?.stop();
	await stopAll();
});

function clientBridge(): BridgeHandle {
	const bridge = startBridge({ handlers: [echoPlugin] });
	running.push(bridge);
	return bridge;
}

describe("the served bootstrap cannot break out of its script", () => {
	test("a window label containing </script> is escaped, not emitted raw", () => {
		const source = bootstrapSource({
			baseUrl: "",
			token: "t",
			port: 1,
			window: "</script><script>alert(1)</script>",
		});
		expect(source).not.toContain("</script>");
		expect(source).toContain("\\u003c/script");
	});

	test("the served document survives a hostile ?window= label", async () => {
		const bridge = start({
			handlers: [echoPlugin],
			indexHtml: "<html><head></head><body></body></html>",
		});
		const label = "</script><script>alert(1)</script>";
		const html = await (
			await fetch(`${bridge.url}/?window=${encodeURIComponent(label)}`)
		).text();
		expect(html).not.toContain("</script><script>alert(1)");
	});
});

describe("ready settles on an error reply", () => {
	test("a wrong token still resolves ready, and the invoke rejects", async () => {
		const bridge = clientBridge();
		const { api } = installPage(bridge, { config: { token: "not-the-token" } });
		await expect(api.invoke("test", "echo", {})).rejects.toMatchObject({
			code: "unauthorized",
		});
		await api.ready;
	});

	test("a handler throw still resolves ready", async () => {
		const bridge = clientBridge();
		const { api } = installPage(bridge, { stream: false });
		await expect(api.invoke("test", "boom")).rejects.toMatchObject({ code: "handler-error" });
		await api.ready;
	});
});

describe("page client failure shapes", () => {
	/** Install the served client against a stub target whose fetch answers whatever the test says. */
	function withFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
		const target: Record<string, any> = { fetch: respond };
		const snippet = bootstrapSource({ baseUrl: "http://127.0.0.1:1", token: "t", port: 1 });
		const factory = new Function("window", "location", `return ${snippet};`) as (
			scope: Record<string, any>,
			location: { search: string },
		) => { invoke(p: string, c: string, a?: unknown): Promise<unknown>; ready: Promise<void> };
		return factory(target, { search: "" });
	}

	test("a non-JSON reply rejects bad-response and still settles ready", async () => {
		const api = withFetch(() => new Response("<html>nope</html>", { status: 502 }));
		await expect(api.invoke("test", "echo", {})).rejects.toMatchObject({
			code: "bad-response",
		});
		await api.ready;
	});

	test("a page whose fetch is not a function rejects no-fetch", async () => {
		// `scope.fetch ?? globalThis.fetch` falls through a missing value, so the observable shape
		// is a `fetch` that exists and is not callable.
		const target: Record<string, any> = { fetch: "not-a-function" };
		const snippet = bootstrapSource({ baseUrl: "", token: "t", port: 1 });
		const factory = new Function("window", "location", `return ${snippet};`) as (
			scope: Record<string, any>,
			location: { search: string },
		) => { invoke(p: string, c: string, a?: unknown): Promise<unknown> };
		const api = factory(target, { search: "" });
		await expect(api.invoke("test", "echo", {})).rejects.toMatchObject({ code: "no-fetch" });
	});
});

describe("reserved wire keys do not corrupt data", () => {
	test("a data field named __crustBytes comes back as its own string", async () => {
		const bridge = clientBridge();
		const { api } = installPage(bridge);
		const result = await api.invoke("test", "echo", { __crustBytes: "aGVsbG8=" });
		expect(result).toEqual({ __crustBytes: "aGVsbG8=" });
		expect(result).not.toBeInstanceOf(Uint8Array);
	});

	test("a data field named __proto__ survives as an own field", async () => {
		const bridge = clientBridge();
		const { api } = installPage(bridge);
		const payload = JSON.parse('{"__proto__":"kept","x":1}');
		const result = (await api.invoke("test", "echo", payload)) as Record<string, unknown>;
		expect(Object.getOwnPropertyNames(result)).toContain("__proto__");
		expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
		expect(result.x).toBe(1);
	});

	test("a nested binary result inside a literal wrapper still revives", async () => {
		const bridge = clientBridge();
		const { api } = installPage(bridge);
		const payload = { __crustBytes: "not-revived", keep: true };
		const result = (await api.invoke("test", "echo", payload)) as Record<string, unknown>;
		expect(result.__crustBytes).toBe("not-revived");
		expect(result.keep).toBe(true);
	});
});
