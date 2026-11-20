/**
 * The runner half of `POST /_crust/invoke`: resolve `plugin.command` against the registry, apply the
 * capability gate, time the handler and write one `bridge.invoke` record. The request body, the two
 * payload kinds and the response live in `invoke-request.ts`; this file answers "what happened to
 * this call" and takes its answer from the same call.
 */

import type { PluginContext } from "../../plugins/define";
import { type CommandHandler, isNotImplemented } from "../../plugins/define";
import { CrustError, toCrustError } from "../errors";
import { logEvent } from "@/logging/logger";
import { invokeRecord, platformRecord, refuseRecord } from "@/logging/records";
import { candidateActions, effectiveAction } from "./actions.ts";
import { byteLengthOf } from "./body.ts";
import {
	type CompiledCapabilities,
	compileCapabilities,
	forbiddenMessage,
} from "./capabilities.ts";

export { MAX_BODY_BYTES } from "./body.ts";
export { invokeRequest } from "./invoke-request.ts";

export type Run = (
	plugin: string,
	command: string,
	args: unknown,
	/** The page-supplied label. Routing only: it decides `ctx.window`, never the capability grant. */
	routing?: string,
	/** The label bound to the bearer token when its document was served. The sole authority. */
	authority?: string,
	/** Raw body bytes, so the record can say how big the request was. */
	bytesIn?: number,
) => Promise<unknown>;

/**
 * Resolve `plugin.command` against the registry, with structured failures.
 *
 * `capabilities` is checked here, before the handler runs, so both payload kinds and every plugin
 * share one gate: a plugin that forgets, or a third-party one, cannot open a hole. The in-process
 * `app.invoke` path does not go through this runner, because that is the app calling itself.
 *
 * The gate reads `authority` — the label the bridge bound to the credential — not `routing`. A page
 * that writes `"window":"admin"` into its own body can still address the admin window, but it cannot
 * inherit the admin window's grants: those belong to the token the bridge gave that window's document.
 */
export function createRunner(
	handlers: Map<string, CommandHandler>,
	ctx: PluginContext,
	capabilities: CompiledCapabilities = compileCapabilities(undefined),
): Run {
	return async function run(plugin, command, args, routing, authority, bytesIn) {
		const key = `${plugin}.${command}`;
		const started = performance.now();
		// The authoritative label is what a failure is attributable to; the page's own hint is logged
		// beside it when it differs, because a mismatched hint is the interesting case.
		const window = authority ?? routing;
		const hint = routing !== undefined && routing !== window ? routing : undefined;
		const sizeIn = bytesIn ?? byteLengthOf(args);
		try {
			const handler: CommandHandler | undefined = handlers.get(key);
			if (!handler) {
				throw new CrustError("unknown-command", key);
			}
			// A dispatcher such as `app.invoke` names its real action in the arguments. Check every
			// candidate: a narrow `app:notes.save` grant scopes one command, while the legacy flat
			// `app:invoke` grant keeps reaching all of them. The refusal names the finest action.
			const action = effectiveAction(plugin, command, args);
			const allowed = candidateActions(plugin, command, args).some((candidate) =>
				capabilities.allows(authority, candidate),
			);
			if (!allowed) {
				logEvent(
					refuseRecord({
						reason: "capability",
						window,
						ns: plugin,
						cmd: command,
						detail: action,
					}),
				);
				throw new CrustError(
					"forbidden",
					forbiddenMessage(action, authority, capabilities),
				);
			}
			// The calling window rides on the request, never in the handler's own arguments: it is a
			// routing hint `window.label` answers, so no command can mistake it for a label it was given.
			const request = routing === undefined ? ctx : { ...ctx, window: routing };
			let result: unknown;
			try {
				result = await handler(args, request);
			} catch (error) {
				// Keep the code, status and `requires` the handler's error carried; only the text grows.
				// Without the key and this origin note the page sees a bare failure with no clue whether
				// the plugin refused, the bridge refused, or a command simply died.
				const failure = toCrustError(error);
				throw new CrustError(
					failure.code,
					`${key} plugin handler threw: ${failure.message} (the error came from the handler, not the bridge)`,
					{ requires: failure.requires, status: failure.status },
				);
			}
			if (isNotImplemented(result)) {
				throw new CrustError("not-implemented", result.message, {
					requires: result.requires,
				});
			}
			const value = result === undefined ? null : result;
			logEvent(
				invokeRecord({
					window,
					hint,
					ns: plugin,
					cmd: command,
					durMs: performance.now() - started,
					ok: true,
					bytesIn: sizeIn,
					bytesOut: byteLengthOf(value),
				}),
			);
			return value;
		} catch (error) {
			const failure = toCrustError(error);
			logEvent(
				invokeRecord({
					window,
					hint,
					ns: plugin,
					cmd: command,
					durMs: performance.now() - started,
					ok: false,
					code: failure.code,
					bytesIn: sizeIn,
					detail: failure.message,
				}),
			);
			// A `not-implemented` is a platform refusal whatever returned it, and its `requires` names
			// the API; record it as `platform.refuse` too so its own field set is queryable.
			if (failure.code === "not-implemented") {
				logEvent(
					platformRecord({
						api: failure.requires ?? key,
						code: failure.code,
						detail: failure.message,
					}),
				);
			}
			throw error;
		}
	};
}
