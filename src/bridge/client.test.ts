/**
 * Page-side client proofs.
 *
 * The bootstrap is `installCrust.toString()` evaluated in a stub target, so
 * these tests exercise the exact source the served document carries, not a
 * parallel copy of it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { definePlugin } from "../plugins/define";
import { type CrustApi, installCrust } from "./client";
import { startBridge, type BridgeHandle } from "./server";

const testPlugin = definePlugin({
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
});

class FakeEventSource {
	static last: FakeEventSource | null = null;

	readonly url: string;
	onerror: ((event: unknown) => void) | null = null;
	private readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();

	constructor(url: string) {
		this.url = url;
		FakeEventSource.last = this;
	}

	addEventListener(name: string, fn: (event: { data: string }) => void): void {
		const list = this.listeners.get(name) ?? [];
		list.push(fn);
		this.listeners.set(name, list);
	}

	dispatch(name: string, data: unknown): void {
		for (const fn of this.listeners.get(name) ?? []) fn({ data: JSON.stringify(data) });
	}

	close(): void {}
}

function start(): BridgeHandle {
	const bridge = startBridge({ handlers: [testPlugin] });
	running.push(bridge);
	return bridge;
}

interface Installed {
	api: CrustApi;
	source: FakeEventSource | null;
}

/**
 * Evaluate the real bootstrap source in a stub target. The fetch wrapper adds
 * the `Origin` header a browser adds itself and Bun's `fetch` does not.
 */
function install(
	bridge: BridgeHandle,
	options: { token?: string; stream?: boolean } = {},
): Installed {
	const target: Record<string, unknown> = {
		fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
			fetch(input, {
				...init,
				headers: {
					...((init?.headers ?? {}) as Record<string, string>),
					origin: bridge.url,
				},
			}),
	};
	if (options.stream !== false) {
		FakeEventSource.last = null;
		target.EventSource = FakeEventSource;
	}
	const config = { baseUrl: bridge.url, token: options.token ?? bridge.token, port: bridge.port };
	const factory = new Function(`return (${installCrust.toString()})`)() as (
		config: { baseUrl: string; token: string; port: number },
		target: Record<string, unknown>,
	) => CrustApi;
	const api = factory(config, target);
	return { api, source: FakeEventSource.last };
}

describe("bootstrap", () => {
	test("installs window.crust with invoke, listen, once and ready", () => {
		const bridge = start();
		const { api } = install(bridge);
		expect(typeof api.invoke).toBe("function");
		expect(typeof api.listen).toBe("function");
		expect(typeof api.once).toBe("function");
		expect(api.ready).toBeInstanceOf(Promise);
		expect(api.token).toBe(bridge.token);
	});

	test("the installed source is self-contained and names the invoke route", () => {
		const bridge = start();
		const { api } = install(bridge);
		expect(api.baseUrl).toBe(bridge.url);
		expect(installCrust.toString()).toContain("/_crust/invoke");
		expect(installCrust.toString()).toContain("EventSource");
	});
});

describe("invoke", () => {
	test("round-trips a command through the page client", async () => {
		const bridge = start();
		const { api } = install(bridge);
		const result = await api.invoke("test", "echo", { page: "hello" });
		expect(result).toEqual({ page: "hello" });
	});

	test("a handler throw rejects with its code and message", async () => {
		const bridge = start();
		const { api } = install(bridge);
		await expect(api.invoke("test", "boom")).rejects.toMatchObject({
			code: "handler-error",
			message: "page saw the handler throw",
		});
	});

	test("a wrong token rejects unauthorized", async () => {
		const bridge = start();
		const { api } = install(bridge, { token: "not-the-token" });
		await expect(api.invoke("test", "echo", {})).rejects.toMatchObject({
			code: "unauthorized",
		});
	});
});

describe("events", () => {
	test("ready resolves on the first handshake frame", async () => {
		const bridge = start();
		const { api, source } = install(bridge);
		expect(source?.url).toContain("/_crust/events?token=");
		source?.dispatch("crust:ready", { port: bridge.port, protocol: 1 });
		await api.ready;
		expect(bridge.port).toBeGreaterThan(0);
	});

	test("listen delivers payloads until unsubscribed, and once resolves", async () => {
		const bridge = start();
		const { api, source } = install(bridge);
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

	test("without EventSource, ready resolves after the first invoke", async () => {
		const bridge = start();
		const { api } = install(bridge, { stream: false });
		const result = await api.invoke("test", "echo", { fallback: true });
		expect(result).toEqual({ fallback: true });
		await api.ready;
	});
});
