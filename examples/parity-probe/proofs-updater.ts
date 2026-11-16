/**
 * The updater proof: a manifest served by a real loopback server, a real Ed25519 key pinned for this
 * instance, and a real sha256-verified swap between two temp bundles. The adapter is the shipped node
 * one with `download` widened to land a directory, because `Bun.write` writes one file while
 * `install` accepts only an `.app` directory — the plugin's own "extract it first" case.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUpdaterPlugin, nodeUpdaterAdapter, type UpdaterAdapter } from "crust/plugin";
import { mark, reason } from "./proofs.ts";

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleName</key><string>Parity probe</string></dict></plist>`;

const NEW_MARKER = "new-bundle-marker";
const OLD_MARKER = "old-bundle-marker";
const CURRENT = "0.1.0";
const NEXT = "9.9.9";

/** A real `.app` on disk: the directory plus an `Info.plist`, which is all a bundle is. */
async function bundle(parent: string, name: string, marker: string): Promise<string> {
	const path = join(parent, `${name}.app`);
	await mkdir(join(path, "Contents"), { recursive: true });
	await writeFile(join(path, "Contents", "Info.plist"), PLIST, "utf8");
	await writeFile(join(path, "marker.txt"), marker, "utf8");
	return path;
}

/** Bytes on disk under a path, so the adapter's answer is a real size rather than a placeholder. */
async function treeBytes(path: string): Promise<number> {
	const info = await stat(path);
	if (!info.isDirectory()) return info.size;
	let total = 0;
	for (const entry of await readdir(path)) total += await treeBytes(join(path, entry));
	return total;
}

/**
 * The shipped adapter, with `download` able to land a directory: a bundle artefact is a tree, and
 * `Bun.write` can only write one file. Every digest, receipt and rename below is the real one.
 */
function directoryAdapter(): UpdaterAdapter {
	const node = nodeUpdaterAdapter();
	return {
		...node,
		async download(url, directory) {
			const source = fileURLToPath(url);
			const target = join(directory, basename(source));
			await cp(source, target, { recursive: true });
			return { path: target, bytes: await treeBytes(target) };
		},
	};
}

/**
 * `check` reads the manifest over loopback, `download` verifies the sha256 and an Ed25519 signature
 * with the pinned key alone, `install` refuses a bundle no download verified and then swaps the one
 * that was verified. The line carries all three facts.
 */
export async function proveUpdater(): Promise<boolean> {
	let root: string | undefined;
	let server: ReturnType<typeof Bun.serve> | undefined;
	try {
		root = await mkdtemp(join(tmpdir(), "crust-parity-update-"));
		const appPath = await bundle(root, "Old", OLD_MARKER);
		const fresh = await bundle(root, "New", NEW_MARKER);
		const node = nodeUpdaterAdapter();
		const treeDigest = await node.sha256(fresh);

		// A real key pair, pinned for this instance: the signature verifies with it and no other.
		const { publicKey, privateKey } = generateKeyPairSync("ed25519");
		const raw = (publicKey.export({ format: "jwk" }) as { x: string }).x;
		const pinned = Buffer.from(raw, "base64url").toString("base64");
		const payload = join(root, "payload.txt");
		await writeFile(payload, `parity update ${NEXT}\n`, "utf8");
		const signature = sign(null, await readFile(payload), privateKey).toString("base64");
		const digest = await node.sha256(payload);

		server = Bun.serve({
			port: 0,
			fetch: () =>
				Response.json({
					version: NEXT,
					url: `file://${fresh}`,
					sha256: treeDigest,
					signature,
					pubkey: pinned,
					notes: "parity probe",
				}),
		});

		const updater = createUpdaterPlugin(
			directoryAdapter(),
			{ allowFileUrl: true, pubkey: pinned },
			// `install` only replaces the bundle this process runs from, so the probe names the temp
			// bundle as its own — the third argument exists for exactly that. Nothing real is touched.
			join(appPath, "Contents", "MacOS", "Old"),
		);
		const found = await updater.commands.check({
			endpoint: server.url.href,
			currentVersion: CURRENT,
		});
		const announced =
			found.available === true && found.version === NEXT && found.sha256 === treeDigest;
		if (!announced) console.log(`updater   check refused: ${JSON.stringify(found)}`);

		const signed = await updater.commands.download({
			url: `file://${payload}`,
			sha256: digest,
			signature,
			pubkey: pinned,
		});
		const verified = signed.ok === true && signed.signer === pinned;

		const fetched = await updater.commands.download({
			url: `file://${fresh}`,
			sha256: treeDigest,
		});
		if (fetched.ok !== true) {
			console.log(`updater   download refused: ${JSON.stringify(fetched)}`);
			return mark("updater", false);
		}
		const bare = await updater.commands.install({ path: fresh, appPath });
		const refused = bare.ok === false && bare.code === "unverified-artifact";
		const installed = await updater.commands.install({ path: fetched.path, appPath });
		const parked = await readFile(join(`${appPath}.old`, "marker.txt"), "utf8").catch(() => "");
		const live = await readFile(join(appPath, "marker.txt"), "utf8").catch(() => "");
		const swapped = installed.ok === true && parked === OLD_MARKER && live === NEW_MARKER;

		console.log(
			`updater   signed=${verified} swapped=${swapped} unverified=${refused ? "refused" : "accepted"}`,
		);
		return mark("updater", announced && verified && refused && swapped);
	} catch (error) {
		console.log(`updater   failed: ${reason(error)}`);
		return mark("updater", false);
	} finally {
		server?.stop(true);
		if (root !== undefined) {
			await rm(root, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}
