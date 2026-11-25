/** The state one bridge server carries, split so the request handler stays under the line cap. */

import { type DocumentTokenLedger } from "./document-tokens.ts";
import type { Events } from "./events.ts";
import type { Run } from "./invoke.ts";
import type { StartBridgeOptions } from "./types.ts";

export interface BridgeState {
	options: StartBridgeOptions;
	/** A config-supplied policy; absent means `defaultCsp(nonce)` is built per document. */
	csp: string | undefined;
	token: string;
	devOrigins: readonly string[];
	events: Events;
	/**
	 * token -> the label it was issued for. The process token is bound to the default label for the
	 * dev-server path; each served document gets a fresh token bound to its own `?window=`. Both the
	 * document route and the invoke route accept only tokens in this map, and capability authority
	 * comes from the bound label — never from a request field.
	 */
	labels: Map<string, string | undefined>;
	/** The single document-token ledger, shared with the runtime's one-shot dev-page mint. */
	ledger: DocumentTokenLedger;
	/**
	 * Tokens allowed to seed a document. Only the host's process token by default — a document
	 * token can re-serve its own page but can never choose a different label.
	 */
	seedTokens?: ReadonlySet<string>;
	/** The bound port. An ephemeral bind only knows it after `serve` returns. */
	port(): number;
	run: Run;
}
