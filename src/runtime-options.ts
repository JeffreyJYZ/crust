/**
 * What `startApp` takes: how a launch finds its config, its frontend, and the extensions a generated
 * entry already registered. Split from `runtime.ts` so the runtime keeps room under the line cap.
 */

import type { AssetTable } from "@/bridge/server.ts";
import type { CrustConfig } from "@/config";
import type { PluginRegistry } from "@/plugins";

export interface StartAppOptions {
	/** Config file, relative to the working directory. */
	configPath?: string;
	/** Backend entry, relative to the working directory. Defaults to `src/main.ts`. */
	entry?: string;
	/**
	 * A pre-bundled entry import. A built app's wrapper supplies this, because
	 * `import(<variable>)` cannot be resolved at build time; the wrapper's own
	 * literal `import("<entry>")` is what gets bundled into the binary.
	 */
	entryModule?: () => Promise<unknown>;
	/**
	 * An already-loaded config. A built app must take this path: its config was
	 * embedded at build time and no `crust.config.ts` exists on the user's disk.
	 */
	config?: CrustConfig;
	/** Frontend on disk. Defaults to `<project>/public` when that directory exists. */
	root?: string;
	/** Frontend embedded in the binary, ahead of `root`. */
	assets?: AssetTable;
	/** Skip the platform, for tests and for a headless bridge. */
	attachPlatform?: boolean;
	/** A registry a generated entry already filled with embedded extensions. */
	registry?: PluginRegistry;
}
