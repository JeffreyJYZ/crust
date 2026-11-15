/**
 * `crust:opener` — hand a path or a URL to the OS. `NSWorkspace` is AppKit and this module owns none: macOS supplies `darwinOpenerAdapter()` and a platform without a workspace keeps answering a typed `NotImplemented`.
 * The rule this file enforces: **every command answers a plain object, and nothing throws.** A bad argument is `{ ok: false, code: "bad-request" }`, a path the OS cannot see is `not-found`, and an adapter that throws becomes `handler-error` rather than a rejected invoke.
 */

import { isAbsolute, resolve } from "node:path";
import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

/** `bad-request` and `not-found` are the bridge's own codes; `handler-error` is a refused send. */
export type OpenerErrorCode = "bad-request" | "not-found" | "handler-error";

export interface OpenerFailure {
	ok: false;
	code: OpenerErrorCode;
	message: string;
}

export interface OpenerPathArgs {
	/** Absolute, or relative to the process working directory. */
	path: string;
}

export interface OpenerUrlArgs {
	/** A URL with a scheme, e.g. `https://crust.dev`. */
	url: string;
}

export interface OpenerPathResult {
	ok: true;
	/** The absolute path that was handed to the OS. */
	path: string;
}

export interface OpenerUrlResult {
	ok: true;
	url: string;
}

export interface OpenerRevealResult {
	ok: true;
	path: string;
	/** Always true: the reveal send has no answer, so reaching this object is the evidence. */
	revealed: true;
}

/**
 * What an adapter reports. `status` is the OS's own answer, not the adapter's optimism, and
 * `reason` always names which step ran and what it said.
 */
export interface OpenerOutcome {
	status: number;
	reason: string;
}

/**
 * The native half of `crust:opener`. `status` values are `OPENER_STATUS` in
 * `platform/darwin/opener.ts`: `0` opened, `1` nothing at that path, `2` the send was refused.
 */
export interface OpenerAdapter {
	openPath(path: string): OpenerOutcome | Promise<OpenerOutcome>;
	openUrl(url: string): OpenerOutcome | Promise<OpenerOutcome>;
	revealItem(path: string): OpenerOutcome | Promise<OpenerOutcome>;
}

/** `OPENER_STATUS.opened` — the only value that means the OS took the request. */
const OPENED_STATUS = 0;
/** `OPENER_STATUS.notFound` — refused before any AppKit send. */
const NOT_FOUND_STATUS = 1;
/** An adapter that threw: no OS status at all. */
const THREW_STATUS = -1;

function failure(code: OpenerErrorCode, message: string): OpenerFailure {
	return { ok: false, code, message };
}

function requireText(value: unknown, command: string, field: string): string | OpenerFailure {
	if (typeof value !== "string" || value.length === 0) {
		return failure("bad-request", `opener.${command}: "${field}" must be a non-empty string`);
	}
	return value;
}

/** Absolute form, so a relative path is resolved against this process and never against AppKit. */
function absolute(path: string): string {
	return isAbsolute(path) ? path : resolve(path);
}

/** A scheme is what makes a string a URL; without one `-openURL:` would answer NO anyway. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** An adapter that throws is a typed failure, never a rejected invoke. */
async function answered(
	call: () => OpenerOutcome | Promise<OpenerOutcome>,
): Promise<OpenerOutcome> {
	try {
		return await call();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: THREW_STATUS, reason: message };
	}
}

function codeFor(status: number): OpenerErrorCode {
	return status === NOT_FOUND_STATUS ? "not-found" : "handler-error";
}

export function createOpenerPlugin(adapter?: OpenerAdapter): PluginDefinition<
	"opener",
	{
		openPath: (
			args: OpenerPathArgs,
		) => Promise<OpenerPathResult | OpenerFailure | NotImplemented>;
		openUrl: (args: OpenerUrlArgs) => Promise<OpenerUrlResult | OpenerFailure | NotImplemented>;
		revealItem: (
			args: OpenerPathArgs,
		) => Promise<OpenerRevealResult | OpenerFailure | NotImplemented>;
	}
> {
	const native = adapter;
	const missing = (command: string) =>
		notImplemented(
			`opener.${command} needs NSWorkspace, which only AppKit provides. Pass an OpenerAdapter to createOpenerPlugin on a platform that has no workspace.`,
			"NSWorkspace",
		);

	return definePlugin({
		name: "opener",
		commands: {
			/** Open a file or folder in whatever app owns its type, the way a double-click would. */
			openPath: async (
				args: OpenerPathArgs,
			): Promise<OpenerPathResult | OpenerFailure | NotImplemented> => {
				if (!native) return missing("openPath");
				const path = requireText(args?.path, "openPath", "path");
				if (typeof path !== "string") return path;
				const target = absolute(path);
				const outcome = await answered(() => native.openPath(target));
				if (outcome.status !== OPENED_STATUS) {
					return failure(codeFor(outcome.status), outcome.reason);
				}
				return { ok: true, path: target };
			},
			/** Open a URL in the default handler for its scheme: https in the browser, mailto in Mail. */
			openUrl: async (
				args: OpenerUrlArgs,
			): Promise<OpenerUrlResult | OpenerFailure | NotImplemented> => {
				if (!native) return missing("openUrl");
				const url = requireText(args?.url, "openUrl", "url");
				if (typeof url !== "string") return url;
				if (!SCHEME.test(url)) {
					return failure(
						"bad-request",
						`opener.openUrl: "${url}" has no scheme, so it is not a URL`,
					);
				}
				const outcome = await answered(() => native.openUrl(url));
				if (outcome.status !== OPENED_STATUS) {
					return failure(codeFor(outcome.status), outcome.reason);
				}
				return { ok: true, url };
			},
			/** Select the item in a Finder window, creating one if the folder is not already open. */
			revealItem: async (
				args: OpenerPathArgs,
			): Promise<OpenerRevealResult | OpenerFailure | NotImplemented> => {
				if (!native) return missing("revealItem");
				const path = requireText(args?.path, "revealItem", "path");
				if (typeof path !== "string") return path;
				const target = absolute(path);
				const outcome = await answered(() => native.revealItem(target));
				if (outcome.status !== OPENED_STATUS) {
					return failure(codeFor(outcome.status), outcome.reason);
				}
				return { ok: true, path: target, revealed: true };
			},
		},
	});
}

/** The default registration: honest about the missing framework. */
export const openerPlugin = createOpenerPlugin();
