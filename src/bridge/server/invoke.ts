/**
 * `POST /_crust/invoke`: one route, two payload kinds (JSON and a binary body
 * with the command in the query string), one structured error for every
 * failure.
 */

import type { PluginContext } from "../../plugins/define";
import { type CommandHandler, isNotImplemented } from "../../plugins/define";
import { CrustError, toCrustError } from "../errors";
import { errorResponse, jsonResponse } from "./http.ts";

/** Bodies over this size are refused before parsing, as the probe measured. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export type Run = (plugin: string, command: string, args: unknown) => Promise<unknown>;

/** Resolve `plugin.command` against the registry, with structured failures. */
export function createRunner(handlers: Map<string, CommandHandler>, ctx: PluginContext): Run {
	return async function run(plugin, command, args) {
		const handler: CommandHandler | undefined = handlers.get(`${plugin}.${command}`);
		if (!handler) {
			throw new CrustError("unknown-command", `${plugin}.${command}`);
		}
		let result: unknown;
		try {
			result = await handler(args, ctx);
		} catch (error) {
			throw toCrustError(error);
		}
		if (isNotImplemented(result)) {
			throw new CrustError("not-implemented", result.message, { requires: result.requires });
		}
		return result === undefined ? null : result;
	};
}

export async function invokeRequest(
	request: Request,
	url: URL,
	run: Run,
	cors?: Record<string, string>,
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
			const bytes = new Uint8Array(await request.arrayBuffer());
			if (bytes.byteLength > MAX_BODY_BYTES) {
				throw new CrustError("too-large", "payload too large");
			}
			return jsonResponse({ ok: true, result: await run(plugin, command, bytes) }, 200, cors);
		}

		const text = await request.text();
		if (text.length > MAX_BODY_BYTES) {
			throw new CrustError("too-large", "payload too large");
		}
		let parsed: { plugin?: unknown; command?: unknown; args?: unknown };
		try {
			parsed = JSON.parse(text) as {
				plugin?: unknown;
				command?: unknown;
				args?: unknown;
			};
		} catch {
			throw new CrustError("bad-json", "body is not json");
		}
		if (typeof parsed.plugin !== "string" || typeof parsed.command !== "string") {
			throw new CrustError("bad-request", "body needs { plugin, command, args }");
		}
		return jsonResponse(
			{ ok: true, result: await run(parsed.plugin, parsed.command, parsed.args) },
			200,
			cors,
		);
	} catch (error) {
		return errorResponse(error, cors);
	}
}
