/**
 * The tap formula's Linux digests must name THIS tag's binaries. A tag push creates the
 * release first and CI uploads the binaries afterwards, so the release script waits for
 * both assets and reads the digests GitHub already stored on them — no download, no
 * recompute, and no "refresh the hashes by hand" instruction in the tap PR.
 */

export type LinuxArch = "arm64" | "x64";

export interface LinuxDigests {
	arm64: string;
	x64: string;
}

const ARCHES: readonly LinuxArch[] = ["arm64", "x64"];

/** One line per asset: `<name><TAB><digest>`, with GitHub's `sha256:` prefix intact. */
export const RELEASE_ASSETS_QUERY =
	'.assets[] | select(.name | test("linux-(arm64|x64)$")) | [.name, .digest] | @tsv';

export function linuxAssetName(version: string, arch: LinuxArch): string {
	return `crust-${version}-linux-${arch}`;
}

/** Only this version's assets count: a previous tag's binary would install with a wrong hash. */
export function parseLinuxDigests(output: string, version: string): Partial<LinuxDigests> {
	const found: Partial<LinuxDigests> = {};
	for (const row of output.split("\n")) {
		const [name, digest] = row.trim().split(/\s+/);
		if (!name || !digest) continue;
		const asset = /^crust-([0-9]+\.[0-9]+\.[0-9]+)-linux-(arm64|x64)$/.exec(name);
		const hash = /^sha256:([0-9a-f]{64})$/.exec(digest);
		if (!asset || !hash || asset[1] !== version) continue;
		found[asset[2] as LinuxArch] = hash[1];
	}
	return found;
}

export interface WaitOptions {
	tag: string;
	version: string;
	/** `gh release view … --json assets`; injected so the poll is testable without a release. */
	look: () => Promise<string>;
	/** Called once per attempt with the reason the wait is still going. */
	note?: (detail: string) => void;
	attempts?: number;
	delayMs?: number;
}

/** Bounded by default at five minutes; every attempt prints why it is still waiting. */
export async function waitForLinuxDigests(options: WaitOptions): Promise<LinuxDigests> {
	const attempts = options.attempts ?? 60;
	const delayMs = options.delayMs ?? 5_000;
	let lastReason = "no release query yet";
	for (let attempt = 1; attempt <= attempts; attempt++) {
		let output = "";
		let reason = "";
		try {
			output = await options.look();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			reason = `release query failed: ${message.split("\n")[0]}`;
		}
		const digests = parseLinuxDigests(output, options.version);
		const missing = ARCHES.filter((arch) => digests[arch] === undefined);
		if (missing.length === 0) return digests as LinuxDigests;
		if (reason === "") {
			reason = `missing ${missing.map((arch) => linuxAssetName(options.version, arch)).join(", ")}`;
		}
		lastReason = reason;
		if (attempt < attempts) {
			options.note?.(
				`waiting ${attempt}/${attempts} (~${Math.round((attempts * delayMs) / 1000)}s cap): ${lastReason}; CI uploads on the ${options.tag} tag push`,
			);
			await Bun.sleep(delayMs);
		}
	}
	throw new Error(
		`${options.tag} Linux assets did not appear after ${attempts} attempts ` +
			`(~${Math.round((attempts * delayMs) / 1000)}s): ${lastReason}. ` +
			"CI attaches them on the tag push and flags a failed build as a draft; no tap PR was opened.",
	);
}
