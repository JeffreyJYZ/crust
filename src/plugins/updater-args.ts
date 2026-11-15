/**
 * `crust:updater`'s vocabulary: the manifest a page's endpoint answers, how two dotted versions compare, and every typed failure the plugin returns.
 * Nothing here touches the network or a filesystem, so each decision is testable without either.
 */

/** Why an updater command could not answer. */
export type UpdaterErrorCode =
	| "invalid-arguments"
	| "check-failed"
	| "bad-manifest"
	| "download-failed"
	| "hash-mismatch"
	| "install-failed"
	| "not-an-app-bundle"
	| "handler-error";

export interface UpdaterError {
	readonly code: UpdaterErrorCode;
	readonly message: string;
}

/** What `download` and `install` answer instead of throwing. */
export interface UpdaterFailure extends UpdaterError {
	readonly ok: false;
	/** The file or bundle the failure is about, when naming one helps. */
	readonly path?: string;
}

/** The JSON an update endpoint answers. `notes` stays unparsed Markdown: rendering it is the page's job. */
export interface UpdateManifest {
	version: string;
	url: string;
	notes?: string;
	/** Lowercase hex. `download` verifies it when the manifest carries one. */
	sha256?: string;
}

/** What `check` answers, and never a throw: a page branches on `available`. */
export interface CheckResult {
	readonly available: boolean;
	readonly version?: string;
	readonly notes?: string;
	readonly url?: string;
	readonly sha256?: string;
	readonly error?: UpdaterError;
}

/** What an adapter throws for a failure it can name; the plugin converts it, the bridge never sees it. */
export class UpdaterAdapterError extends Error {
	readonly code: UpdaterErrorCode;

	constructor(code: UpdaterErrorCode, message: string) {
		super(message);
		this.name = "UpdaterAdapterError";
		this.code = code;
	}
}

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;
export function isSha256Hex(value: unknown): value is string {
	return typeof value === "string" && SHA256_HEX.test(value);
}

/** `1.2.3-beta` is `[1, ""], [2, ""], [3, "beta"]`; a leading `v` is dropped because manifests carry both. */
function segments(version: string): Array<[number, string]> {
	return version
		.trim()
		.replace(/^[vV]/, "")
		.split(".")
		.map((segment) => {
			const match = /^(\d*)(.*)$/.exec(segment);
			const digits = match?.[1] ?? "";
			return [digits === "" ? 0 : Number(digits), (match?.[2] ?? "").toLowerCase()];
		});
}

/**
 * Numeric dotted compare, never text: `0.10.0` beats `0.9.0`, and a missing segment is zero.
 */
export function compareVersions(left: string, right: string): number {
	const a = segments(left);
	const b = segments(right);
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const [aNumber, aTag] = a[index] ?? [0, ""];
		const [bNumber, bTag] = b[index] ?? [0, ""];
		if (aNumber !== bNumber) return aNumber < bNumber ? -1 : 1;
		if (aTag === bTag) continue;
		// A bare segment is the release and any tag sorts below it, so `1.0.0` beats
		// `1.0.0-beta.1` instead of losing to it the way a text compare would.
		if (aTag === "") return 1;
		if (bTag === "") return -1;
		return aTag < bTag ? -1 : 1;
	}
	return 0;
}

/** Whether `candidate` is a version worth installing over `current`. */
export function isNewer(candidate: string, current: string): boolean {
	return compareVersions(candidate, current) > 0;
}

/** A payload preview short enough to read inside one error line. */
export function seen(value: unknown): string {
	const text = JSON.stringify(value) ?? String(value);
	return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** `check`'s failure shape: the reason travels in `error`, never as a throw. */
export function checkFailure(code: UpdaterErrorCode, message: string): CheckResult {
	return { available: false, error: { code, message } };
}

/** Any adapter throw becomes a code and a message; nothing escapes into the bridge. */
export function errorOf(error: unknown, fallback: UpdaterErrorCode): UpdaterError {
	const code = error instanceof UpdaterAdapterError ? error.code : fallback;
	const message = error instanceof Error ? error.message : String(error);
	return { code, message };
}

export function invalidArguments(command: string, detail: string, args: unknown): UpdaterFailure {
	return {
		ok: false,
		code: "invalid-arguments",
		message: `crust: updater.${command} ${detail}, got ${seen(args)}`,
	};
}

/** The same refusal for `check`, whose failure shape has no `ok`. */
export function badCheck(command: string, detail: string, args: unknown): CheckResult {
	const { message } = invalidArguments(command, detail, args);
	return { available: false, error: { code: "invalid-arguments", message } };
}

export function hashMismatch(path: string, actual: string, expected: string): UpdaterFailure {
	const message = `crust: updater.download got sha256 ${actual}, but the manifest says ${expected}`;
	return { ok: false, code: "hash-mismatch", message, path };
}

/** Nothing is replaced unless both the target and the download are real `.app` directories. */
export function notAppBundle(path: string, reason: string): UpdaterFailure {
	const message = `crust: updater.install: ${path} ${reason}`;
	return { ok: false, code: "not-an-app-bundle", message, path };
}

/** A page payload is whatever the bridge parsed, so a reader answers `undefined` rather than throwing. */
export function readString(source: unknown, key: string): string | undefined {
	if (typeof source !== "object" || source === null) return undefined;
	const value = (source as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** `undefined` when absent, `null` when present but not 64 hex characters. */
export function readSha256(source: unknown): string | null | undefined {
	if (typeof source !== "object" || source === null) return undefined;
	const value = (source as Record<string, unknown>).sha256;
	if (value === undefined) return undefined;
	return isSha256Hex(value) ? value.toLowerCase() : null;
}

/**
 * A manifest is `{ version, url }` plus optional `notes` and `sha256`; anything else is refused
 * with the reason, because a manifest half-read would download the wrong file.
 */
export function parseManifest(
	value: unknown,
): { ok: true; manifest: UpdateManifest } | { ok: false; reason: string } {
	const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return fail(`a manifest must be a JSON object, got ${seen(value)}`);
	}
	const source = value as Record<string, unknown>;
	const version = readString(source, "version");
	if (version === undefined) return fail('a manifest needs "version" as a non-empty string');
	const url = readString(source, "url");
	if (url === undefined) return fail('a manifest needs "url" as a non-empty string');
	const manifest: UpdateManifest = { version, url };
	if (source.notes !== undefined) {
		if (typeof source.notes !== "string") return fail('"notes" must be a string when present');
		manifest.notes = source.notes;
	}
	if (source.sha256 !== undefined) {
		if (!isSha256Hex(source.sha256)) return fail('"sha256" must be 64 hex characters');
		manifest.sha256 = source.sha256.toLowerCase();
	}
	return { ok: true, manifest };
}

/** The URL's last path segment kept to `[A-Za-z0-9._-]`, because it becomes a filename in a temp dir. */
export function fileNameFor(url: string, fallback = "update"): string {
	const path = url.split("?")[0]?.split("#")[0] ?? "";
	const safe = path.slice(path.lastIndexOf("/") + 1).replace(/[^A-Za-z0-9._-]/g, "");
	return safe.length > 0 && safe !== "." && safe !== ".." ? safe : fallback;
}
