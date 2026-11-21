/** Smaller config sections, split out to keep `types.ts` under the 200-line cap. */

/**
 * `crust:browser` — the `http(s)` origins an embedded surface may load. Absent still registers the
 * plugin, with nothing allowed, so no URL loads until one is named here.
 */
export interface BrowserConfig {
	/** An origin is scheme and host only: `https://example.com`, never a path. */
	origins?: string[];
}

/** Names the single-instance lock so a probe can run beside the user's copy of the app. */
export interface SingleInstanceConfig {
	/** A single file-name token; overrides the app-id-and-project-derived default. */
	id?: string;
}
