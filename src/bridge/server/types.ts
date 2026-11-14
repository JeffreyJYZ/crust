/**
 * The bridge's public shapes. `server.ts` re-exports them, so importers keep
 * using `@/bridge/server.ts`.
 */

import type { HandlerSource } from "../../plugins/registry";

export type AssetTable = Record<string, string | Uint8Array | ArrayBuffer | Blob>;

export interface StartBridgeOptions {
	/** Plugins, a registry, or a flat `"plugin.command"` handler table. */
	handlers: HandlerSource;
	/** Override the policy. Defaults to `DEFAULT_CSP`. */
	csp?: string;
	/** Origins allowed to call from another origin (`crust dev` / Vite). */
	devOrigin?: string | readonly string[] | null;
	/** Built frontend embedded in the binary: request path -> body. */
	assets?: AssetTable;
	/** Built frontend on disk, for development and for `crust build` output. */
	root?: string;
	/** Explicit document, ahead of `assets["/index.html"]` and `root/index.html`. */
	indexHtml?: string;
	/** Bind port. `0` (the default) asks the OS for an ephemeral one. */
	port?: number;
}

export interface BridgeHandle {
	readonly port: number;
	readonly token: string;
	readonly url: string;
	/** Push an event to every connected page. */
	emit(event: string, data: unknown): void;
	stop(): Promise<void>;
	readonly server: ReturnType<typeof Bun.serve>;
}
