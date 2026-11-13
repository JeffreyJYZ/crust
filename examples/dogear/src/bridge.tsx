/**
 * The page-side bridge, typed just enough for this app.
 *
 * `window.crust` arrives from `crust/vite` in dev and from the bridge's own
 * bootstrap in a built app. The package ships no ambient declaration for it, so
 * this file is the one place that says what the app actually uses.
 */
export interface Bridge {
	readonly baseUrl: string;
	readonly token: string;
	readonly ready: Promise<void>;
	/** Three arguments is a plugin call. */
	invoke<T = unknown>(plugin: string, command: string, args?: unknown): Promise<T>;
	/** Two arguments is an app command, registered in `desktop/main.ts`. */
	invoke<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
	listen<T = unknown>(event: string, fn: (payload: T) => void): () => void;
}

declare global {
	interface Window {
		crust: Bridge;
	}
}

export interface CallFailure extends Error {
	code?: string;
	status?: number;
	requires?: string;
}

/**
 * Read late on purpose: a document served without the handshake must surface as
 * a named error in the UI, not as a blank page from a module that threw at
 * import time.
 */
export function bridge(): Bridge {
	const client = (window as unknown as { crust?: Bridge }).crust;
	if (!client || typeof client.invoke !== "function") {
		throw new Error(
			"window.crust is missing — this document was served without the bridge " +
				"handshake (crust/vite injects it in dev; the bridge injects it in a built app)",
		);
	}
	return client;
}

export function appCommand<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
	return bridge().invoke<T>(name, args);
}

export function plugin<T = unknown>(name: string, command: string, args?: unknown): Promise<T> {
	return bridge().invoke<T>(name, command, args);
}

/** One line, with the bridge's own fields, for the status bar and the log. */
export function describe(error: unknown): string {
	if (error === null || typeof error !== "object") return String(error);
	const failure = error as CallFailure;
	const parts = [failure.message ?? String(error)];
	if (failure.code) parts.push(`code=${failure.code}`);
	if (typeof failure.status === "number" && failure.status !== 0) {
		parts.push(`status=${failure.status}`);
	}
	if (failure.requires) parts.push(`requires=${failure.requires}`);
	return parts.join(" · ");
}

/** What the status bar shows without making a failed handshake a render crash. */
export function bridgeInfo(): { url: string; connected: boolean } {
	try {
		return { url: bridge().baseUrl, connected: true };
	} catch {
		return { url: "", connected: false };
	}
}
