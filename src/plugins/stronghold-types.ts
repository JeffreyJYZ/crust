/**
 * `stronghold`'s public shapes: the failure codes every command answers as a value, the file layout those codes describe,
 * and the argument and result types a typed client derives from. Kept apart from the crypto and the command wiring so the
 * contract can be read without either in the way.
 */

export type StrongholdErrorCode =
	"locked" | "bad-password" | "bad-request" | "not-found" | "corrupt" | "io-error";

/** Every failure this plugin answers, as a value: nothing here throws at a caller. */
export interface StrongholdFailure {
	ok: false;
	code: StrongholdErrorCode;
	message: string;
}

export function failure(code: StrongholdErrorCode, message: string): StrongholdFailure {
	return { ok: false, code, message };
}

export function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** One AES-256-GCM ciphertext with the IV it was written under; the tag rides at the end of `data`. */
export interface Sealed {
	iv: string;
	data: string;
}

export interface StrongholdEntry {
	name: Sealed;
	value: Sealed;
}

export interface StrongholdFile {
	version: number;
	kdf: { algorithm: string; iterations: number; salt: string };
	check: Sealed;
	/** Keyed by {@link entryId}, never by the name itself. */
	entries: Record<string, StrongholdEntry>;
}

export interface DerivedKeys {
	aes: CryptoKey;
	mac: CryptoKey;
}

export interface OpenedStore {
	file: StrongholdFile;
	keys: DerivedKeys;
}

export interface StrongholdOptions {
	/** Directory holding the store file. Defaults to `defaultStoreRoot(app)`. */
	root?: string;
	/** App name for the default root, usually the config's `app.name`. */
	app?: string;
	/** PBKDF2 rounds; the default is the parameter the file header records. */
	iterations?: number;
}

export interface OpenArgs {
	password: string;
}

export interface OpenResult {
	ok: true;
	opened: true;
}

export interface SetArgs {
	key: string;
	value: string;
}

export interface SetResult {
	ok: true;
	key: string;
}

export interface KeyArgs {
	key: string;
}

export interface GetResult {
	ok: true;
	key: string;
	value: string;
}

export interface DeleteResult {
	ok: true;
	key: string;
	deleted: boolean;
}

export interface KeysResult {
	ok: true;
	keys: string[];
}

export interface CloseResult {
	ok: true;
	closed: true;
}
