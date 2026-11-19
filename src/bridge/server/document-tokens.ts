/**
 * The ledger of document tokens the bridge has issued. Every mint used to add a UUID to
 * `labels` forever: a create/close cycle grew the map without bound, and a credential copied
 * from a closed window's history kept its authority for the bridge's whole life. Issuing past
 * the cap revokes the oldest token first.
 */

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
