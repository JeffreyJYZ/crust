/**
 * The keychain plugin's test double: an in-memory credential store, imported only by tests. `keychain.ts`
 * has no knowledge of it, and it lives apart so the values a test asserts are visible in one place
 * instead of rebuilt in each case — the shape `screen-fake.ts` uses.
 */

import type { KeychainAdapter } from "./keychain-types.ts";

/** One stored credential, keyed the way the OS keychain keys one: a service plus an account. */
function keyOf(service: string, account: string): string {
	return `${service}\0${account}`;
}

export interface FakeKeychain extends KeychainAdapter {
	/** Every call the plugin made, so a test can assert what reached the native half. */
	calls(): string[];
	/** What is stored now, for asserting that a delete really removed one entry. */
	entries(): Map<string, string>;
	/** Make the next call throw, so the `handler-error` path is reachable without a real refusal. */
	fail(message: string): void;
}

/** An adapter over an in-memory map, recording every call it receives. */
export function fakeKeychain(
	initial: ReadonlyArray<readonly [service: string, account: string, secret: string]> = [],
): FakeKeychain {
	const store = new Map<string, string>();
	for (const [service, account, secret] of initial) {
		store.set(keyOf(service, account), secret);
	}
	const log: string[] = [];
	let failure: string | undefined;

	const guard = (call: string): void => {
		log.push(call);
		if (failure !== undefined) throw new Error(failure);
	};

	return {
		platform: "darwin",
		calls: () => [...log],
		entries: () => new Map(store),
		fail: (message) => {
			failure = message;
		},
		set: (service, account, secret) => {
			guard(`set ${service}/${account}`);
			store.set(keyOf(service, account), secret);
		},
		get: (service, account) => {
			guard(`get ${service}/${account}`);
			return store.get(keyOf(service, account)) ?? null;
		},
		delete: (service, account) => {
			guard(`delete ${service}/${account}`);
			return store.delete(keyOf(service, account));
		},
		list: (service) => {
			guard(`list ${service}`);
			const wanted = `${service}\0`;
			// Sorted, so a test can assert the whole array without depending on insertion order.
			return [...store.keys()]
				.filter((key) => key.startsWith(wanted))
				.map((key) => key.slice(wanted.length))
				.sort();
		},
	};
}
