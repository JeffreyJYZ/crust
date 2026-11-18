/**
 * `crust:keychain` — a secret the operating system protects, not a file the app protects.
 * `stronghold` is the other half: an AES-256-GCM file under a password the app supplies, so a lost
 * password loses the data and a leaked password leaks it. A keychain entry is unlocked by the login
 * session, has no app-held password to lose, and appears in Keychain Access or Credential Manager
 * where a user can revoke it.
 *
 * **Never a shell.** Butter shells out to `security add-generic-password -w …`, which puts the secret
 * in the process list on every write; macOS answers `SecItemAdd`/`SecItemCopyMatching`/`SecItemDelete`
 * in-process, and Windows answers `CredWriteW`/`CredReadW`/`CredDeleteW`.
 *
 * **A missing credential is `{ found: false }`, not an error.** "You have not stored this" is a normal
 * answer, and a refusal that a caller must catch would make a first launch look broken.
 *
 * A platform with no adapter refuses by name rather than writing a plaintext file and calling it
 * secure. macOS, Windows and Linux (libsecret's synchronous API) each supply a real adapter.
 */

import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";
import {
	type KeychainAdapter,
	type KeychainDeleteResult,
	type KeychainFailure,
	type KeychainGetResult,
	type KeychainKeyArgs,
	type KeychainListResult,
	type KeychainSetArgs,
	type KeychainSetResult,
} from "./keychain-types";

export * from "./keychain-types";

/** The commands in the order this plugin declares them. */
export const KEYCHAIN_COMMANDS = ["set", "get", "delete", "list"] as const;

/**
 * What a refusal names, per platform. These are the fallbacks when no adapter is passed; the three
 * supported platforms supply one. libsecret's `*_sync` API creates its own main loop, so Linux needs
 * no loop from crust — only libsecret and a Secret Service provider on the session bus.
 */
const REQUIRES: Record<string, string> = {
	darwin: "SecItemAdd, SecItemCopyMatching and SecItemDelete in Security.framework",
	win32: "CredWriteW, CredReadW and CredDeleteW in advapi32",
	linux: "libsecret-1.so.0 and a Secret Service provider (libsecret-1-0 and gnome-keyring) on the session bus",
};

/**
 * The enumeration API `list` needs, per platform, so its refusal never names the wrong OS. The real
 * darwin and Windows halves bind theirs; only `linux` is still a live refusal, the others are the
 * named fallback for a caller-supplied adapter that omits `list`.
 */
const REQUIRES_LIST: Record<string, string> = {
	darwin: "SecItemCopyMatching in Security.framework",
	win32: "CredEnumerateW in advapi32",
	linux: "secret_service_search_sync in libsecret",
};

function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * A service or account that names one credential: a non-empty string with no NUL. A NUL would
 * truncate the name inside the C string every platform half hands the OS, so two different
 * credentials could collapse onto one entry.
 */
function nameOf(value: unknown, label: string): string | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;
	if (value.includes("\0")) return undefined;
	return value;
}

function badRequest(message: string): KeychainFailure {
	return { ok: false, code: "bad-request", message };
}

/**
 * `platform` is injectable so a refusal can be pinned on any OS: the real caller uses the host, and a
 * test on macOS can still assert what Windows and Linux name without a CI matrix.
 */
export function createKeychainPlugin(
	adapter?: KeychainAdapter,
	platform: string = process.platform,
): PluginDefinition<
	"keychain",
	{
		set: (args?: KeychainSetArgs) => KeychainSetResult | KeychainFailure | NotImplemented;
		get: (args?: KeychainKeyArgs) => KeychainGetResult | KeychainFailure | NotImplemented;
		delete: (args?: KeychainKeyArgs) => KeychainDeleteResult | KeychainFailure | NotImplemented;
		list: (args?: {
			service?: string;
		}) => KeychainListResult | KeychainFailure | NotImplemented;
	}
> {
	const requires = REQUIRES[platform] ?? "an OS credential store";

	const missing = (command: string): NotImplemented =>
		notImplemented(
			`keychain.${command} needs ${requires}. This platform has no adapter for it: pass a ` +
				"KeychainAdapter to createKeychainPlugin when one is reachable.",
			requires,
		);

	/** Read the two names every command needs, or the refusal that says which one is wrong. */
	const keys = (
		command: string,
		args: KeychainKeyArgs | undefined,
	): { service: string; account: string } | KeychainFailure => {
		const service = nameOf(args?.service, "service");
		if (service === undefined) {
			return badRequest(`keychain.${command}: "service" must be a non-empty string`);
		}
		const account = nameOf(args?.account, "account");
		if (account === undefined) {
			return badRequest(`keychain.${command}: "account" must be a non-empty string`);
		}
		return { service, account };
	};

	return definePlugin({
		name: "keychain",
		commands: {
			set: (args?: KeychainSetArgs): KeychainSetResult | KeychainFailure | NotImplemented => {
				if (adapter === undefined) return missing("set");
				const names = keys("set", args);
				if ("ok" in names) return names;
				// The empty string is a real secret — a token can legitimately be empty in a test —
				// so only a non-string is refused.
				if (typeof args?.secret !== "string") {
					return badRequest('keychain.set: "secret" must be a string');
				}
				try {
					adapter.set(names.service, names.account, args.secret);
					return { ok: true, stored: true };
				} catch (error) {
					return { ok: false, code: "handler-error", message: reasonOf(error) };
				}
			},

			get: (args?: KeychainKeyArgs): KeychainGetResult | KeychainFailure | NotImplemented => {
				if (adapter === undefined) return missing("get");
				const names = keys("get", args);
				if ("ok" in names) return names;
				try {
					const secret = adapter.get(names.service, names.account);
					return secret === null
						? { ok: true, found: false }
						: { ok: true, found: true, secret };
				} catch (error) {
					return { ok: false, code: "handler-error", message: reasonOf(error) };
				}
			},

			delete: (
				args?: KeychainKeyArgs,
			): KeychainDeleteResult | KeychainFailure | NotImplemented => {
				if (adapter === undefined) return missing("delete");
				const names = keys("delete", args);
				if ("ok" in names) return names;
				try {
					return { ok: true, deleted: adapter.delete(names.service, names.account) };
				} catch (error) {
					return { ok: false, code: "handler-error", message: reasonOf(error) };
				}
			},

			list: (args?: {
				service?: string;
			}): KeychainListResult | KeychainFailure | NotImplemented => {
				if (adapter === undefined) return missing("list");
				const service = nameOf(args?.service, "service");
				if (service === undefined) {
					return badRequest('keychain.list: "service" must be a non-empty string');
				}
				// A platform half without `list` says so: an empty array would read as
				// "nothing is stored", which is the one answer a credential store must never
				// invent. Windows now binds `CredEnumerateW` and supplies list; only Linux's
				// secret_service_search_sync remains unbound, so that is the one live refusal.
				if (typeof adapter.list !== "function") {
					const needs = REQUIRES_LIST[platform] ?? "a credential enumeration API";
					return notImplemented(
						`keychain.list needs ${needs}, which this platform half does not bind. ` +
							"get, set and delete work; enumerate from the app's own index instead.",
						needs,
					);
				}
				try {
					return { ok: true, accounts: adapter.list(service) };
				} catch (error) {
					return { ok: false, code: "handler-error", message: reasonOf(error) };
				}
			},
		},
	});
}

/** The default registration: honest about the missing platform half, naming that platform's own API. */
export const keychainPlugin = createKeychainPlugin();
