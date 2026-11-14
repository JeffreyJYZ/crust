/**
 * `window.create`, the one command whose native half is optional.
 *
 * Split out of `window.ts` because it carries its own ordering rules: ask
 * whether the adapter can create at all before validating arguments, refuse a
 * label the platform still holds, and read the platform's list back rather than
 * trusting the call it just made.
 */

import type { NotImplemented } from "./define";
import { duplicateLabel, failure, missingWindow, parseCreate } from "./window-args.ts";
import type {
	WindowCreateArgs,
	WindowCreateOptions,
	WindowCreateResult,
	WindowFailure,
	WindowNative,
} from "./window-types.ts";

/**
 * The missing-window case this exists for: with five commands a page could
 * close its only window and never open another, so an app that wanted a reopen
 * had to keep a hidden window alive. Creation is a command like any other —
 * typed args, typed failure, and the label tracked by the platform afterwards,
 * so `list`, `isOpen`, `close` and `setTitle` all find the new window on the
 * next call.
 */
export function createWindowCommand(
	adapter: WindowNative | undefined,
	args: WindowCreateArgs,
): WindowCreateResult | WindowFailure | NotImplemented {
	if (!adapter) return missingWindow("create");
	const native = adapter;
	// The member is optional in the contract, so it is read through a
	// partial view: an adapter written before `create` still type-checks.
	const create = (native as Partial<WindowNative>).create;
	// Asked before the arguments: a platform that cannot create at all
	// should say so rather than answer a validation error about a request
	// it would never have run.
	if (typeof create !== "function") {
		return {
			ok: false as const,
			code: "unknown-adapter" as const,
			message:
				"crust: this window adapter does not implement create. On macOS " +
				"darwinWindowAdapter(platform) must delegate it to " +
				"DarwinPlatform.createWindow(options).",
		};
	}
	const parsed = parseCreate(args);
	if (!parsed.ok) return parsed.failure;
	const options: WindowCreateOptions = parsed.options;
	// Only the adapter can tell a closed-but-tracked label from a free
	// one; this check covers what `list` reports, and the adapter throws
	// `duplicate-label` for the rest.
	try {
		if (native.list().includes(options.label)) return duplicateLabel(options.label);
		create.call(native, options);
		// A create that answers without tracking would turn every later
		// command into `unknown-window`; read the platform's own list back
		// rather than trusting the call.
		if (!native.list().includes(options.label)) {
			return {
				ok: false as const,
				code: "handler-error" as const,
				message:
					`crust: window.create reported ${JSON.stringify(options.label)} ` +
					"created, but the adapter does not list it",
				label: options.label,
			};
		}
	} catch (error) {
		return failure(error, options.label);
	}
	return { ok: true as const, label: options.label, created: true as const };
}
