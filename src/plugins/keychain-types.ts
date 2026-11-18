/**
 * The `crust:keychain` contract: what a command answers, what the native half must provide, and the
 * small pure builders both halves share. Kept apart from the commands so a platform half imports the
 * types without dragging the plugin's behaviour in — the shape `clipboard-contract.ts` uses.
 */

/** Why a keychain command could not answer. */
export type KeychainErrorCode = "bad-request" | "not-found" | "access-denied" | "handler-error";

/** The typed failure a command returns instead of throwing. */
export interface KeychainFailure {
	readonly ok: false;
	readonly code: KeychainErrorCode;
	readonly message: string;
}

/** `{ found: true, secret }` or `{ found: false }` — "not stored" is a normal answer, not an error. */
export type KeychainGetResult =
	| { readonly ok: true; readonly found: true; readonly secret: string }
	| { readonly ok: true; readonly found: false };

export interface KeychainSetResult {
	readonly ok: true;
	readonly stored: true;
}

export interface KeychainDeleteResult {
	readonly ok: true;
	/** `false` when nothing was stored, which is the same success: the entry is gone. */
	readonly deleted: boolean;
}

export interface KeychainListResult {
	readonly ok: true;
	/** Every account stored under one service, sorted. Empty is a real answer. */
	readonly accounts: string[];
}

/** A service and an account name a credential. Both must be non-empty. */
export interface KeychainKeyArgs {
	service: string;
	account: string;
}

export interface KeychainSetArgs extends KeychainKeyArgs {
	secret: string;
}

/**
 * The native half of `crust:keychain`. Every method is synchronous and answers a status rather than
 * throwing, because the C half already turned each OS failure into one of these values.
 *
 * `get` answers `null` for "nothing stored", which the plugin turns into `{ found: false }`; a real
 * failure (locked keychain, denied prompt) throws, and the plugin reports it as `handler-error`.
 */
export interface KeychainAdapter {
	/** Which platform answers; only used to word a refusal. */
	readonly platform: "darwin" | "win32" | "linux";
	set(service: string, account: string, secret: string): void;
	/** The secret, or `null` when no such credential is stored. */
	get(service: string, account: string): string | null;
	/** `true` when an entry was removed, `false` when there was none. */
	delete(service: string, account: string): boolean;
	/**
	 * Every account stored under `service`. Optional because Linux's libsecret half does not bind
	 * `secret_service_search_sync`; the darwin and Windows halves bind theirs. Absent answers
	 * `not-implemented` naming the missing API rather than an empty list, which would read as
	 * "nothing is stored".
	 */
	list?(service: string): string[];
}
