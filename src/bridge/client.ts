/**
 * The page-side half of the bridge. The client body is `client/install.ts`, injected sources `client/bootstrap.ts`, shapes `client/types.ts` — a size boundary only. The served document takes `installCrust`'s own source (`Function.prototype.toString`), so page and server share one implementation; the hard constraint is that it stays self-contained and references nothing from module scope.
 * Measured on Bun 1.4.4: a round-trip is median 0.119 ms / p99 1.276 ms over 200 calls against a 0.0005 ms same-process floor, so the socket is 99.6%; a reused connection costs 0.045 ms, which is why the page's keep-alive `fetch` makes the per-call budget ~0.05 ms (`research/bridge.md` §2).
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
