/**
 * Page-side test doubles: a fake `EventSource`, and a helper that evaluates the *injected* source
 * in a stub `window`/`location`, so a test exercises the bytes a page receives rather than a
 * parallel copy of the client. Imported only by tests, like `plugins/window-fake.ts`.
 */

import { bootstrapSource, pageClientSource } from "../client.ts";
import type { CrustApi, CrustConfig } from "../client.ts";
import type { BridgeHandle } from "../server.ts";

export class FakeEventSource {
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

export interface PageOptions {
	/** The page's own URL query, as `location.search` reports it. */
	search?: string;
	/** Fields the bridge would have injected, or a deliberately wrong token. */
	config?: Partial<CrustConfig>;
	/** `"served"` is the bridge's document snippet; `"dev"` is the one `crust/vite` injects. */
	source?: "served" | "dev";
	stream?: boolean;
}

export interface Installed {
	api: CrustApi;
	source: FakeEventSource | null;
}

/**
 * Install the page client exactly as a page receives it. The fetch wrapper adds the `Origin`
 * header a browser adds itself and Bun's `fetch` does not, so the bridge's origin gate is the same
 * one a real page meets.
 */
export function installPage(bridge: BridgeHandle, options: PageOptions = {}): Installed {
	const target: Record<string, any> = {
		// A browser resolves a relative request against the document's own URL; Bun's `fetch` does
		// not, so the wrapper does it here. It also adds the `Origin` header a browser adds itself.
		fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const resolved =
				typeof input === "string" && input.startsWith("/")
					? `${bridge.url}${input}`
					: input;
			return fetch(resolved, {
				...init,
				headers: {
					...((init?.headers ?? {}) as Record<string, string>),
					origin: bridge.url,
				},
			});
		},
	};
	if (options.stream !== false) {
		FakeEventSource.last = null;
		target.EventSource = FakeEventSource;
	}
	if (options.source === "dev") {
		target.__CRUST__ = { url: bridge.url, token: options.config?.token ?? bridge.token };
	}
	const config = {
		baseUrl: bridge.url,
		token: bridge.token,
		port: bridge.port,
		...options.config,
	};
	// A bridge-served page is only ever loaded from a URL that carries `?token=` — the document
	// route refuses a request without it — so the stub's `location.search` carries it too, exactly
	// as `windowUrl` builds it. Without this the client would install with no credential, which is
	// the state a real page can never be in.
	const search =
		options.source === "dev"
			? (options.search ?? "")
			: appendToken(options.search ?? "", bridge.token);
	const snippet =
		options.source === "dev" ? pageClientSource() : bootstrapSource(config as CrustConfig);
	const factory = new Function("window", "location", `return ${snippet};`) as (
		scope: Record<string, any>,
		location: { search: string },
	) => CrustApi;
	const api = factory(target, { search });
	return { api, source: FakeEventSource.last };
}

/** Add `token=` to a query unless it already names one, the way the document URL does. */
function appendToken(search: string, token: string): string {
	const query = search.replace(/^\?/, "");
	const kept = query.split("&").filter((pair) => pair.length > 0 && !pair.startsWith("token="));
	kept.push(`token=${encodeURIComponent(token)}`);
	return `?${kept.join("&")}`;
}
