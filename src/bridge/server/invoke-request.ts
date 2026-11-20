/**
 * The request half of `POST /_crust/invoke`, split out of `invoke.ts` when one file held two
 * concerns and crossed the line cap: this side reads the body (JSON or binary), names the plugin and
 * command, calls the runner, and turns either into a response. The runner and its log record stay in
 * `invoke.ts`.
 */

import { asWindowLabel } from "../window-identity.ts";
import { CrustError } from "../errors";
import type { Run } from "./invoke.ts";
import { byteLengthOf, MAX_BODY_BYTES, readCappedBody } from "./body.ts";
import { encodeResult } from "./bytes.ts";
import { resultStatus } from "./failure-status.ts";
import { errorResponse, jsonResponse } from "./http.ts";

export { MAX_BODY_BYTES } from "./body.ts";

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
			const result = await run(plugin, command, bytes, routing, authority, bytes.byteLength);
			return jsonResponse(
				{ ok: true, result: encodeResult(result) },
				resultStatus(result),
				cors,
			);
		}

		const text = new TextDecoder().decode(await readCappedBody(request));
		const sizeIn = byteLengthOf(text);
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
			sizeIn,
		);
		return jsonResponse({ ok: true, result: encodeResult(result) }, resultStatus(result), cors);
	} catch (error) {
		return errorResponse(error, cors);
	}
}
