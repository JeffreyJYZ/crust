/**
 * The three file-backed built-ins share one per-app data root. Split out of `runtime-plugins.ts`
 * at the 200-line cap so `store`, `database` and `stronghold` cannot drift into different
 * directories — the reason they are built here instead of left as bare core registrations.
 */

export interface DataPlugins {
	store: ReturnType<typeof import("@/plugins").createStorePlugin>;
	database: ReturnType<typeof import("@/plugins").createDatabasePlugin>;
	stronghold: ReturnType<typeof import("@/plugins").createStrongholdPlugin>;
}

/** Build the three instances for one app root; the dynamic import keeps non-darwin arms lean. */
export async function dataPlugins(root: string): Promise<DataPlugins> {
	const { createDatabasePlugin, createStorePlugin, createStrongholdPlugin } =
		await import("@/plugins");
	return {
		store: createStorePlugin({ root }),
		database: createDatabasePlugin({ root }),
		stronghold: createStrongholdPlugin({ root }),
	};
}
