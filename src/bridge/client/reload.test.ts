/**
 * Plain-HTML dev reload, page side. The listener must live in the *injected* client,
 * so this test evaluates the bytes a served document carries, not a parallel copy.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { bootstrapSource } from "../client.ts";
import { FakeEventSource } from "./fixtures.ts";
import { startBridge, type BridgeHandle } from "../server.ts";
import { stopAll, testPlugin, track } from "../server/fixtures.ts";

afterEach(stopAll);

function installServed(bridge: BridgeHandle, reloads: { n: number }): void {
	const target: Record<string, any> = {
		location: {
			reload: () => {
				reloads.n += 1;
			},
		},
		EventSource: FakeEventSource,
		fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init),
	};
	FakeEventSource.last = null;
	const source = bootstrapSource({ baseUrl: "", token: bridge.token, port: bridge.port });
	new Function("window", "location", `return ${source};`)(target, { search: "" });
}

describe("plain-HTML dev reload", () => {
	test("the served client listens for dev:reload and reloads once per event", () => {
		const bridge = track(startBridge({ handlers: [testPlugin] }));
		const reloads = { n: 0 };
		installServed(bridge, reloads);
		const stream = FakeEventSource.last;
		expect(stream).not.toBeNull();
		stream?.dispatch("dev:reload", { at: 1 });
		expect(reloads.n).toBe(1);
		stream?.dispatch("dev:reload", { at: 2 });
		expect(reloads.n).toBe(2);
	});

	test("another event does not reload the page", () => {
		const bridge = track(startBridge({ handlers: [testPlugin] }));
		const reloads = { n: 0 };
		installServed(bridge, reloads);
		FakeEventSource.last?.dispatch("unrelated", {});
		expect(reloads.n).toBe(0);
	});
});
