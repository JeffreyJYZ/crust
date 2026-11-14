/**
 * The page-side half of the bridge.
 *
 * This file is the module's public surface: the client body lives in
 * `client/install.ts`, the injected sources in `client/bootstrap.ts` and the
 * shapes in `client/types.ts`. The split is a size boundary only — nothing a
 * page or an importer sees has changed.
 *
 * The served document takes `installCrust`'s own source
 * (`Function.prototype.toString`) and calls it with the token, so the page and
 * the server share one implementation rather than two drifting copies. The
 * consequence is a hard constraint: `installCrust` must stay self-contained
 * and reference nothing from module scope. Every helper lives inside it.
 *
 * Cost, measured on Bun 1.4.4: an invoke round-trip is a median 0.119 ms and a
 * p99 1.276 ms over 200 calls, against a same-process floor of 0.0005 ms. The
 * socket is 99.6% of that, and a reused connection costs 0.045 ms, so the page's
 * keep-alive connection - which `fetch` gives for free - is why the per-call
 * budget is about 0.05 ms, not 0.12 ms. research/bridge.md §2.
 */

export { bootstrapSource, pageClientSource } from "./client/bootstrap.ts";
export { installCrust } from "./client/install.ts";
export type {
	CrustApi,
	CrustConfig,
	CrustInvokeError,
	CrustTarget,
	LooseInvoke,
	TypedInvoke,
} from "./client/types.ts";
