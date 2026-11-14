/**
 * Shared server-side fixtures: one test plugin, the running-handle list, the
 * request helpers, and an SSE frame reader. Every test file registers its own
 * `afterEach(stopAll)` so a stopped bridge can never leak a mounted port.
 */

import { definePlugin } from "../../plugins/define";
import { fsPlugin } from "../../plugins/fs";
import { startBridge, type BridgeHandle } from "../server.ts";

export const SECRET = "SECRET-FILE-CONTENTS-THAT-MUST-NOT-LEAK";

export const testPlugin = definePlugin({
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

export function start(
	options: Parameters<typeof startBridge>[0] = { handlers: [testPlugin, fsPlugin] },
): BridgeHandle {
	const bridge = startBridge(options);
	running.push(bridge);
	return bridge;
}

export async function stopAll(): Promise<void> {
	while (running.length > 0) await running.pop()?.stop();
}

/** Register a handle started by hand so the file's `afterEach` stops it. */
export function track(bridge: BridgeHandle): BridgeHandle {
	running.push(bridge);
	return bridge;
}

export function ownOrigin(bridge: BridgeHandle): string {
	return `http://127.0.0.1:${bridge.port}`;
}

export function headers(
	bridge: BridgeHandle,
	extra: Record<string, string> = {},
): Record<string, string> {
	return { "content-type": "application/json", origin: ownOrigin(bridge), ...extra };
}

export function invoke(
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

export async function readJson(response: Response): Promise<any> {
	return (await response.json()) as any;
}

interface ChunkReader {
	read(): Promise<{ done: boolean; value?: Uint8Array }>;
	cancel(): Promise<void>;
}

export class SseReader {
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
