/**
 * The event stream: one subscriber set, one frame format, one teardown.
 *
 * Frames are pushed in call order and never coalesced — 20 of 20 arrived in
 * order at a 20.38 ms median gap in the measurement (research/bridge.md).
 */

interface Subscriber {
	enqueue(frame: string): void;
}

export function sseFrame(event: string, data: unknown): string {
	let payload: string;
	try {
		payload = data === undefined ? "null" : JSON.stringify(data);
	} catch {
		payload = JSON.stringify(String(data));
	}
	return `event: ${event}\ndata: ${payload}\n\n`;
}

export class Events {
	private readonly subscribers = new Set<Subscriber>();
	private readonly cleanups = new Set<() => void>();

	emit(event: string, data: unknown): void {
		const frame = sseFrame(event, data);
		for (const subscriber of this.subscribers) {
			try {
				subscriber.enqueue(frame);
			} catch {
				this.subscribers.delete(subscriber);
			}
		}
	}

	/** The SSE response for one connected page, ready frame included. */
	stream(port: number, cors?: Record<string, string>): Response {
		let detached: () => void = () => {};
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				const encoder = new TextEncoder();
				const subscriber: Subscriber = {
					enqueue(frame: string) {
						controller.enqueue(encoder.encode(frame));
					},
				};
				this.subscribers.add(subscriber);
				subscriber.enqueue(sseFrame("crust:ready", { port, protocol: 1 }));
				detached = () => {
					this.subscribers.delete(subscriber);
					try {
						controller.close();
					} catch {
						// already closed
					}
				};
				this.cleanups.add(detached);
			},
			cancel: () => {
				detached();
			},
		});
		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
				connection: "keep-alive",
				...(cors ?? {}),
			},
		});
	}

	/** Close every open stream; a stopped bridge holds nothing back. */
	stop(): void {
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups.clear();
		this.subscribers.clear();
	}
}
