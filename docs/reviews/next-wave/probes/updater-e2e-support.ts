/**
 * Support for `updater-end-to-end.ts`: the adapter whose verification halves are real
 * and whose destructive halves are recorded, the release-guide openssl cross-check,
 * and a small PASS/FAIL reporter. Split out so both files stay under the 200-line cap.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { UpdaterAdapter } from "../../../../src/plugins/updater.ts";
import { nodeUpdaterAdapter } from "../../../../src/plugins/updater-node.ts";
import { verifyEd25519 } from "../../../../src/plugins/updater-signature.ts";

export interface Swap {
	source: string;
	target: string;
	backup: string;
}

/** Mutable probe state: the published zip bytes and where the fake download wrote them. */
export interface ProbeState {
	dir: string;
	zip: Uint8Array;
	zipPath: string;
}

export interface Reporter {
	failed: boolean;
	verify(name: string, ok: boolean, detail?: string): void;
	requireOk(name: string, ok: boolean, detail?: string): void;
}

export function reporter(): Reporter {
	const r: Reporter = {
		failed: false,
		verify(name, ok, detail = "") {
			if (ok) {
				console.log(`PASS  ${name}`);
			} else {
				r.failed = true;
				console.log(`FAIL  ${name}${detail ? `: ${detail}` : ""}`);
			}
		},
		requireOk(name, ok, detail = "") {
			r.verify(name, ok, detail);
			if (!ok) throw new Error(name);
		},
	};
	return r;
}

/**
 * Verification stays real — sha256, readBytes, extractZip, isAppBundle, makeTempDir — so the chain
 * runs on real bytes. Only `replaceBundle` and `relaunch` are recorded, never executed: those are
 * the destructive, irreversible halves the probe must stop before.
 */
export function makeAdapter(
	state: ProbeState,
	manifest: unknown,
): { adapter: UpdaterAdapter; swaps: Swap[]; launches: string[] } {
	const real = nodeUpdaterAdapter();
	const swaps: Swap[] = [];
	const launches: string[] = [];
	const adapter: UpdaterAdapter = {
		...real,
		fetchJson: async () => manifest,
		download: async (_url, directory) => {
			state.zipPath = join(directory, "Notes.app.zip");
			await writeFile(state.zipPath, state.zip);
			return { path: state.zipPath, bytes: state.zip.byteLength };
		},
		replaceBundle: async (source, target, backup) => {
			swaps.push({ source, target, backup });
		},
		relaunch: async (appPath) => {
			launches.push(appPath);
		},
	};
	return { adapter, swaps, launches };
}

/** The release guide's publisher recipe, run for real with openssl 3/4 when available. */
export async function opensslRecipe(state: ProbeState): Promise<boolean | "skipped"> {
	try {
		const keyPath = join(state.dir, "key.pem");
		const gen = Bun.spawn(["openssl", "genpkey", "-algorithm", "ed25519", "-out", keyPath], {
			stderr: "ignore",
		});
		if ((await gen.exited) !== 0) return "skipped";
		const pub = Bun.spawn(["openssl", "pkey", "-in", keyPath, "-pubout", "-outform", "DER"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const [der, pubCode] = await Promise.all([
			new Response(pub.stdout).arrayBuffer(),
			pub.exited,
		]);
		if (pubCode !== 0 || der.byteLength < 32) return "skipped";
		const pubkey = Buffer.from(new Uint8Array(der).slice(-32)).toString("base64");
		const sig = Bun.spawn(
			["openssl", "pkeyutl", "-sign", "-inkey", keyPath, "-rawin", "-in", state.zipPath],
			{ stdout: "pipe", stderr: "ignore" },
		);
		const [raw, sigCode] = await Promise.all([
			new Response(sig.stdout).arrayBuffer(),
			sig.exited,
		]);
		if (sigCode !== 0) return "skipped";
		const signature = Buffer.from(new Uint8Array(raw)).toString("base64");
		return await verifyEd25519(pubkey, signature, state.zip);
	} catch {
		return "skipped";
	}
}
