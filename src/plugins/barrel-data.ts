/**
 * The plugins that read and write something on disk: the scoped filesystem, the key-value
 * store, the sealed store, and the spawn surface that runs a program against them.
 *
 * Re-exports only, so `index.ts` stays a map of the plugin surface rather than the surface itself.
 */

export {
	createFsPlugin,
	fsPlugin,
	type FsScopeOptions,
	type ReadTextFileArgs,
	type WriteTextFileArgs,
	type WriteTextFileResult,
} from "./fs";
export {
	createStrongholdPlugin,
	KDF_ITERATIONS,
	KDF_NAME,
	SALT_BYTES,
	STORE_FILE,
	STORE_VERSION,
	strongholdPlugin,
	type CloseResult,
	type GetResult,
	type KeysResult,
	type OpenArgs,
	type OpenResult,
	type Sealed,
	type SetArgs,
	type SetResult,
	type StrongholdEntry,
	type StrongholdErrorCode,
	type StrongholdFailure,
	type StrongholdFile,
	type StrongholdOptions,
} from "./stronghold";
export {
	createShellPlugin,
	SHELL_OUTPUT_LINES,
	type ShellCommands,
	type ShellOptions,
	type SpawnOutcome,
} from "./shell";
export { createStorePlugin, defaultStoreRoot, type StoreAdapter, storePlugin } from "./store";
export {
	createDatabasePlugin,
	DATABASE_SUFFIX,
	databaseFile,
	databasePlugin,
	databaseRoot,
	ensureDatabaseFile,
	type DatabaseCommands,
	type DatabasePathOptions,
} from "./database";
export type {
	CloseResult as DatabaseCloseResult,
	ExecResult as DatabaseExecResult,
	GetResult as DatabaseGetResult,
	OpenArgs as DatabaseOpenArgs,
	OpenResult as DatabaseOpenResult,
	QueryResult as DatabaseQueryResult,
	SqlArgs,
	SqlFailure,
	SqlOutcome,
	SqlRow,
} from "./database-types";
export { createDownloadsPlugin, downloadsPlugin } from "./downloads";
export {
	type DownloadEntry,
	type DownloadList,
	type DownloadStatus,
	type DownloadsAdapter,
	type DownloadsCommands,
	type DownloadsOptions,
} from "./downloads-types";
