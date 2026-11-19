/**
 * The ledger of document tokens the bridge has issued. Every mint used to add a UUID to
 * `labels` forever: a create/close cycle grew the map without bound, and a credential copied
 * from a closed window's history kept its authority for the bridge's whole life. Issuing past
 * the cap revokes the oldest token first.
 */

import { DEFAULT_WINDOW_LABEL } from "../window-identity.ts";

/** Cap on live document tokens. The process token is never counted or evicted. */
export const MAX_DOCUMENT_TOKENS = 256;

export interface DocumentTokenLedger {
	/** Bind a token to a label and revoke the oldest document token when the cap is exceeded. */
	remember(token: string, label: string | undefined): void;
}

export function createDocumentTokenLedger(
	labels: Map<string, string | undefined>,
	cap: number = MAX_DOCUMENT_TOKENS,
): DocumentTokenLedger {
	const issued: string[] = [];
	return {
		remember(token, label) {
			labels.set(token, label);
			issued.push(token);
			while (issued.length > cap) {
				const oldest = issued.shift();
				if (oldest !== undefined) labels.delete(oldest);
			}
		},
	};
}

/**
 * Issue a document token bound to `label`, or the main window when no label is given.
 *
 * This is the one mint, shared by the document route (a seed token navigating) and by the runtime
 * (minting once for the dev page at the point the bridge is bound). A token minted here is a real
 * credential for invoke but is never a seed, so its holder cannot mint a document for a label of
 * its choosing.
 */
export function mintDocumentToken(
	ledger: DocumentTokenLedger,
	label: string | undefined = DEFAULT_WINDOW_LABEL,
): string {
	const token = crypto.randomUUID();
	ledger.remember(token, label);
	return token;
}
