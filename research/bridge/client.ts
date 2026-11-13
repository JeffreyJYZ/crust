/**
 * Minimal bridge client, usable from a page (browser) or from Bun.
 *
 * Browser: `window.crust` shape from the design.
 * Bun: `import { connect } from "./client.ts"` for the probe harness.
 */

export interface InvokeRequest {
	plugin: string;
	command: string;
	args?: unknown;
}

export interface BridgeClientOptions {
	/** Base URL of the bridge, e.g. http://127.0.0.1:54321 */
	baseUrl: string;
	token: string;
	fetchImpl?: typeof fetch;
	events?: {
		onMessage: (event: string, data: unknown) => void;
		onError?: (e: unknown) => void;
	};
}

export class BridgeClient {
	readonly baseUrl: string;
	private token: string;
	private fetchImpl: typeof fetch;
	private events?: BridgeClientOptions["events"];
	private source: EventSource | null = null;
	private seq = 0;

	constructor(o: BridgeClientOptions) {
		this.baseUrl = o.baseUrl.replace(/\/$/, "");
		this.token = o.token;
		this.fetchImpl = o.fetchImpl ?? fetch;
		this.events = o.events;
	}

	private headers(extra?: Record<string, string>): Record<string, string> {
		const h: Record<string, string> = { authorization: `Bearer ${this.token}` };
		if (extra) Object.assign(h, extra);
		return h;
	}

	async invoke<T = unknown>(cmd: {
		plugin?: string;
		command: string;
		args?: unknown;
	}): Promise<T> {
		const body: InvokeRequest = {
			plugin: cmd.plugin ?? "core",
			command: cmd.command,
			args: cmd.args ?? {},
		};
		const r = await this.fetchImpl(`${this.baseUrl}/_crust/invoke`, {
			method: "POST",
			headers: this.headers({ "content-type": "application/json", origin: this.baseUrl }),
			body: JSON.stringify(body),
		});
		const text = await r.text();
		let parsed: any;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new Error(`bridge returned non-json ${r.status}: ${text.slice(0, 200)}`);
		}
		if (!parsed.ok) {
			const err = new Error(parsed.error?.message ?? "invoke failed");
			(err as any).code = parsed.error?.code;
			(err as any).status = r.status;
			throw err;
		}
		return parsed.result as T;
	}

	openEvents(): void {
		if (this.source) return;
		// EventSource cannot set headers, hence the token in the query string.
		const url = `${this.baseUrl}/_crust/events?token=${encodeURIComponent(this.token)}`;
		const src = new EventSource(url);
		this.source = src;
		src.onmessage = () => {};
		const map: Record<string, (ev: MessageEvent) => void> = {
			"crust:ready": (ev) => this.events?.onMessage("ready", safeJson(ev.data)),
			tick: (ev) => this.events?.onMessage("tick", safeJson(ev.data)),
		};
		for (const [name, fn] of Object.entries(map)) {
			src.addEventListener(name, fn as EventListener);
		}
		src.onerror = (e) => this.events?.onError?.(e);
	}

	close(): void {
		this.source?.close();
		this.source = null;
	}

	nextId(): number {
		return ++this.seq;
	}
}

function safeJson(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return s;
	}
}

/** Convenience for the probe harness: one-shot bridge call. */
export async function call(baseUrl: string, token: string, command: string, args?: unknown) {
	const c = new BridgeClient({ baseUrl, token });
	return c.invoke({ command, args });
}