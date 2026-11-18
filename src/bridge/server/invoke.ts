/**
 * `POST /_crust/invoke`: one route, two payload kinds (JSON and a binary body
 * with the command in the query string), one structured error for every
 * failure.
 */

import type { PluginContext } from "../../plugins/define";
import { type CommandHandler, isNotImplemented } from "../../plugins/define";
import { asWindowLabel } from "../window-identity.ts";
import { CrustError, toCrustError } from "../errors";
import { candidateActions, effectiveAction } from "./actions.ts";
import { encodeResult } from "./bytes.ts";
import { resultStatus } from "./failure-status.ts";
import {
	type CompiledCapabilities,
	compileCapabilities,
	forbiddenMessage,
} from "./capabilities.ts";
import { errorResponse, jsonResponse } from "./http.ts";

/** Bodies over this size are refused before parsing, as the probe measured. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export type Run = (
	plugin: string,
	command: string,
	args: unknown,
	/** The page-supplied label. Routing only: it decides `ctx.window`, never the capability grant. */
	routing?: string,
	/** The label bound to the bearer token when its document was served. The sole authority. */
	authority?: string,
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
	return async function run(plugin, command, args, routing, authority) {
		const key = `${plugin}.${command}`;
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
			throw new CrustError("forbidden", forbiddenMessage(action, authority, capabilities));
		}
		// The calling window rides on the request, never in the handler's own arguments: it is a
		// routing hint `window.label` answers, so no command can mistake it for a label it was given.
		const request = routing === undefined ? ctx : { ...ctx, window: routing };
		let result: unknown;
		try {
			result = await handler(args, request);
		} catch (error) {
			throw toCrustError(error);
		}
		if (isNotImplemented(result)) {
			throw new CrustError("not-implemented", result.message, { requires: result.requires });
		}
		return result === undefined ? null : result;
	};
}

/**
 * Buffer a body with a running byte count. `content-length` is only a client claim: a chunked POST
 * omits it, so the cap has to be applied while streaming or the whole body is buffered first.
 * Counting raw bytes also catches the multibyte case a UTF-16 `text.length` check misses.
 */
async function readCappedBody(request: Request): Promise<Uint8Array> {
	const body = request.body;
	if (!body) return new Uint8Array(0);
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_BODY_BYTES) {
				await reader.cancel();
				throw new CrustError("too-large", "payload too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export async function invokeRequest(
	request: Request,
	url: URL,
	run: Run,
	cors?: Record<string, string>,
	/** The label bound to the presented credential, from the document route. */
	authority?: string,
): Promise<Response> {
	try {
		const declared = Number(request.headers.get("content-length") ?? "0");
		if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
			throw new CrustError("too-large", "payload too large");
		}

		const contentType = request.headers.get("content-type") ?? "";
		const isBinary = contentType.length > 0 && !contentType.includes("json");

		if (isBinary) {
			// Binary form: the body is the argument, the command rides in the
			// query string. One route carries both payload kinds, and the
			// 1 MB binary path measured 1.8 ms.
			const plugin = url.searchParams.get("plugin");
			const command = url.searchParams.get("command");
			if (plugin === null || command === null) {
				throw new CrustError("bad-request", "binary invoke needs ?plugin= and ?command=");
			}
			const bytes = await readCappedBody(request);
			// The binary form has no JSON body to carry a field, so the routing hint rides in the query.
			const routing = asWindowLabel(url.searchParams.get("window"));
			const result = await run(plugin, command, bytes, routing, authority);
			return jsonResponse(
				{ ok: true, result: encodeResult(result) },
				resultStatus(result),
				cors,
			);
		}

		const text = new TextDecoder().decode(await readCappedBody(request));
		let parsed: { plugin?: unknown; command?: unknown; args?: unknown; window?: unknown };
		try {
			parsed = JSON.parse(text) as {
				plugin?: unknown;
				command?: unknown;
				args?: unknown;
				window?: unknown;
			};
		} catch {
			throw new CrustError("bad-json", "body is not json");
		}
		if (typeof parsed.plugin !== "string" || typeof parsed.command !== "string") {
			throw new CrustError("bad-request", "body needs { plugin, command, args }");
		}
		const result = await run(
			parsed.plugin,
			parsed.command,
			parsed.args,
			asWindowLabel(parsed.window),
			authority,
		);
		return jsonResponse({ ok: true, result: encodeResult(result) }, resultStatus(result), cors);
	} catch (error) {
		return errorResponse(error, cors);
	}
}
