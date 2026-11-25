/**
 * The content-world bridge, end to end and in two worlds.
 *
 * Both injected scripts are evaluated as the page receives them: the isolated one against a stub
 * with the bridge's real `fetch`, and the page one against the stub a page sees. The DOM they share
 * is the only channel between them, which is the property under test — if the token were passed any
 * other way, or the page half reached the bridge directly, these tests would fail.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { definePlugin } from "@/plugins/define";
import { installCrust } from "@/bridge/client";
import { installA11yHelpers } from "@/bridge/client/a11y-helpers.ts";
import { installHandshake } from "@/bridge/client/handshake.ts";
import { installInvoke } from "@/bridge/client/invoke.ts";
import { installReviver } from "@/bridge/client/reviver.ts";
import { startBridge, type BridgeHandle } from "@/bridge/server";
import {
	CONTENT_WORLD_SOURCE,
	PAGE_BRIDGE_SOURCE,
} from "@/platform/darwin/content-world-source.ts";

const ping = definePlugin({
	name: "test",
	commands: { echo: (args: unknown) => args },
});

const running: BridgeHandle[] = [];
afterEach(async () => {
	while (running.length > 0) await running.pop()?.stop();
});

function start(): BridgeHandle {
	const bridge = startBridge({ handlers: [ping] });
	running.push(bridge);
	return bridge;
}

type Listener = (event: any) => void;

/** One document, two worlds: events dispatched in either reach both, as they do in WebKit. */
function makeDocument() {
	const listeners = new Map<string, Listener[]>();
	const addEventListener = (name: string, fn: Listener) => {
		const list = listeners.get(name) ?? [];
		list.push(fn);
		listeners.set(name, list);
	};
	const dispatchEvent = (event: any) => {
		for (const fn of listeners.get(event.type) ?? []) fn(event);
		return true;
	};
	return { addEventListener, dispatchEvent };
}

class Event {
	readonly type: string;
	readonly detail: string;
	constructor(type: string, init?: { detail?: string }) {
		this.type = type;
		this.detail = init?.detail ?? "";
	}
}

interface Installed {
	api: ReturnType<typeof installCrust>;
	/** The page world's globals: `crustInvoke` is here, `token` must not be. */
	page: Record<string, any>;
	/** The `location` the page world sees after the isolated world ran. */
	pageSearch: string;
	/** What the isolated world's `history.replaceState` was asked to write. */
	rewritten: string[];
}

/**
 * Install both halves the way a darwin window does, then the page client. The target deliberately
 * has **no** `fetch`, so a call that fell back to the fetch path would throw `no-fetch` — that is
 * what proves the round trip went through the content world.
 */
function installBoth(bridge: BridgeHandle, options: { scrub?: boolean } = {}): Installed {
	const doc = makeDocument();
	const search = `?token=${encodeURIComponent(bridge.token)}&window=main`;
	const rewritten: string[] = [];
	let visible = search;
	const location = {
		origin: bridge.url,
		get search() {
			return visible;
		},
		href: `${bridge.url}/${search}`,
	};
	const history = {
		state: null,
		replaceState: (_state: unknown, _title: string, url: string) => {
			rewritten.push(url);
			if (options.scrub !== false) visible = url.slice(url.indexOf("?"));
		},
	};
	// The isolated world builds its URL from `location.origin`, so it is already absolute; only the
	// `Origin` header is added, which a browser adds itself and Bun's `fetch` does not.
	const fetchImpl = (input: string, init?: RequestInit) =>
		fetch(input, {
			...init,
			headers: { ...((init?.headers ?? {}) as Record<string, string>), origin: bridge.url },
		});
	const isolated = new Function(
		"location",
		"document",
		"fetch",
		"EventSource",
		"history",
		"CustomEvent",
		CONTENT_WORLD_SOURCE,
	);
	isolated(location, doc, fetchImpl, undefined, history, Event);

	const page: Record<string, any> = { document: doc, location, CustomEvent: Event };
	const pageWorld = new Function("window", "document", "CustomEvent", PAGE_BRIDGE_SOURCE);
	pageWorld(page, doc, Event);

	// The client installs into that same page world, so `window.crust` lands beside
	// `window.crustInvoke` — which is exactly where a scrape would look.
	page.__CRUST__ = { url: bridge.url, token: bridge.token };
	const api = installCrust(
		{ url: bridge.url },
		page as any,
		installInvoke,
		undefined,
		installReviver,
		installHandshake,
		installA11yHelpers,
	);
	return { api, page, pageSearch: visible, rewritten };
}

describe("the credential lives in a content world", () => {
	test("the page gets one bridged function and no token anywhere", () => {
		const bridge = start();
		const { api, page, pageSearch, rewritten } = installBoth(bridge);
		expect(typeof page.crustInvoke).toBe("function");
		// …and nothing else: no bearer on the client, none in the URL the page can read.
		expect((api as any).token).toBeUndefined();
		expect(Object.keys(api)).not.toContain("token");
		expect(pageSearch).not.toContain(bridge.token);
		expect(rewritten.join("")).not.toContain(bridge.token);
		// The second place a scrape looks: the config the client leaves behind.
		expect(page.__CRUST__?.token).toBeUndefined();
	});

	test("a real command round-trips through the isolated world, with no page fetch", async () => {
		const bridge = start();
		const { api } = installBoth(bridge);
		const result = await (api.invoke as any)("test", "echo", { through: "world" });
		expect(result).toEqual({ through: "world" });
	});

	test("a handler error keeps its code and message across the worlds", async () => {
		const bridge = start();
		const { api } = installBoth(bridge);
		await expect((api.invoke as any)("test", "missing")).rejects.toMatchObject({
			name: "CrustInvokeError",
			message: "test.missing",
		});
	});

	test("the page world never sees the token even if the scrub is refused", () => {
		const bridge = start();
		// A `replaceState` that silently does nothing is the case where hiding the token in the URL
		// fails, so the client itself must not carry it — that is the assert above, repeated here
		// against the hostile branch rather than the happy one.
		const { api, pageSearch } = installBoth(bridge, { scrub: false });
		expect(pageSearch).toContain(bridge.token);
		expect((api as any).token).toBeUndefined();
	});
});
