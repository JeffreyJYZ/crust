/**
 * `window.crust` as the page sees it, either served by the bridge in a built
 * app or injected by `crust/vite` in dev. The template declares only the three
 * members the demo uses; `a11y` is also there at runtime when the client was
 * installed with its DOM view.
 */
export {};

declare global {
	interface Window {
		crust: {
			/** Resolves after the first handshake, so an invoke never races the bridge. */
			readonly ready: Promise<void>;
			/** One backend command; args and the answer are plain JSON. */
			invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
			/** Subscribe to a pushed event; the returned function unsubscribes. */
			listen<T = unknown>(event: string, fn: (payload: T) => void): () => void;
		};
	}
}
