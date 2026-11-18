/**
 * Probe (Lane C4, updater-end-to-end): publish a fake "second version" and drive the
 * whole updater chain with real bytes and real Ed25519 — check finds it, download
 * verifies sha256 + signature and extracts the zip, install stages it, relaunch would
 * exec it — then STOP at the one irreversible step: renaming a running .app bundle.
 *
 * Run:  bun docs/reviews/next-wave/probes/updater-end-to-end.ts
 * Exit 0 = every assertion passed; non-zero = at least one FAIL line.
 * Support (adapter, openssl recipe, reporter): ./updater-e2e-support.ts
 */
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
	createUpdaterPlugin,
	type CheckResult,
	type DownloadResult,
} from "../../../../src/plugins/updater.ts";
import {
	bundle,
	executableOf,
	scratch,
	signer,
	UPDATE_URL,
} from "../../../../src/plugins/updater-fake.ts";
import { bundleZip } from "../../../../src/plugins/updater-zip-fixture.ts";
import { makeAdapter, opensslRecipe, reporter, type ProbeState } from "./updater-e2e-support.ts";

const r = reporter();
const dir = await scratch();
const state: ProbeState = { dir, zip: new Uint8Array(), zipPath: "" };

try {
	// v1 is the "running" app; v2 is the fake update an author published.
	const appPath = await bundle(dir, "Notes.app", "1.0.0");
	const execPath = executableOf(appPath);
	const marker = join(appPath, "Contents", "marker.txt");

	const key = await signer(); // base64 Ed25519, the shape updater.pubkey pins
	state.zip = bundleZip("Notes.app", "2.0.0"); // a real signed zip, not a `.app` tree
	const sha256 = createHash("sha256").update(state.zip).digest("hex");
	const signature = await key.sign(state.zip);
	const manifest = {
		version: "2.0.0",
		url: UPDATE_URL,
		notes: "second version",
		sha256,
		signature,
		pubkey: key.pubkey,
	};
	const endpoint = "https://updates.example.test/2.0.0.json";

	const happy = makeAdapter(state, manifest);
	const commands = createUpdaterPlugin(
		happy.adapter,
		{ endpoint, pubkey: key.pubkey },
		execPath,
		"darwin",
	).commands;

	const cfg = await commands.config();
	r.requireOk("config pins the documented key", cfg.pubkey === key.pubkey, String(cfg.pubkey));

	const found = (await commands.check({ endpoint, currentVersion: "1.0.0" })) as CheckResult;
	r.requireOk(
		"check finds the second version",
		found.available === true && found.version === "2.0.0",
		JSON.stringify(found),
	);
	r.requireOk(
		"check passes the documented manifest through",
		found.sha256 === sha256 && found.signature === signature && found.pubkey === key.pubkey,
		JSON.stringify(found),
	);

	const file = await commands.download({
		url: UPDATE_URL,
		sha256,
		signature,
		pubkey: key.pubkey,
	});
	r.requireOk(
		"download verifies sha256 + signature and extracts the zip",
		file.ok === true &&
			"signer" in file &&
			file.signer === key.pubkey &&
			"archive" in file &&
			file.archive?.sha256 === sha256,
		JSON.stringify(file),
	);
	if (!file.ok) throw new Error("download refused the update");
	const downloaded = file as DownloadResult;
	r.requireOk(
		"download returns an extracted .app",
		downloaded.path.endsWith(".app"),
		downloaded.path,
	);

	const installed = await commands.install({ path: downloaded.path, appPath, relaunch: true });
	r.requireOk(
		"install stages the verified bundle and would relaunch",
		installed.ok === true && installed.backup === `${appPath}.old`,
		JSON.stringify(installed),
	);
	const swap = happy.swaps[0];
	r.requireOk(
		"swap operands: verified source, own bundle, .old backup",
		happy.swaps.length === 1 &&
			swap?.source === downloaded.path &&
			swap.target === appPath &&
			swap.backup === `${appPath}.old`,
		JSON.stringify(happy.swaps),
	);
	r.requireOk(
		"relaunch would exec this app's own bundle",
		happy.launches.length === 1 && happy.launches[0] === appPath,
		JSON.stringify(happy.launches),
	);
	r.requireOk(
		"the running bundle is untouched",
		(await readFile(marker, "utf8")) === "1.0.0",
		"marker changed",
	);

	console.log(
		`STOP  at adapter.replaceBundle(${downloaded.path}, ${appPath}, ${appPath}.old): the recorded ` +
			"rename is the destructive swap of a running .app. Not executed — replacing a running " +
			"bundle is irreversible and is exactly the step this probe must not take. Every earlier " +
			"stage ran on real bytes, real sha256 and real Ed25519.",
	);

	const recipe = await opensslRecipe(state);
	if (recipe === "skipped")
		console.log("SKIP  openssl publisher recipe cross-check (openssl unavailable)");
	else r.verify("release guide's openssl recipe verifies with crust's verifier", recipe === true);

	// Red case: a manifest with a bad signature must be refused; nothing is staged.
	try {
		const tampered = Uint8Array.from(state.zip);
		tampered[0] = (tampered[0] ?? 0) ^ 0xff;
		const badSignature = await key.sign(tampered);
		const bad = makeAdapter(state, { ...manifest, signature: badSignature });
		const badCommands = createUpdaterPlugin(
			bad.adapter,
			{ endpoint, pubkey: key.pubkey },
			execPath,
			"darwin",
		).commands;
		const badFound = (await badCommands.check({
			endpoint,
			currentVersion: "1.0.0",
		})) as CheckResult;
		r.verify(
			"red: check still reports the version (check does not verify)",
			badFound.available === true,
			JSON.stringify(badFound),
		);
		const refused = await badCommands.download({
			url: UPDATE_URL,
			sha256,
			signature: badSignature,
			pubkey: key.pubkey,
		});
		r.verify(
			"red: a bad signature is refused",
			refused.ok === false && refused.code === "signature-mismatch",
			JSON.stringify(refused),
		);
		const invented = await badCommands.install({ path: state.zipPath, appPath });
		r.verify(
			"red: no receipt exists, so install refuses",
			invented.ok === false && invented.code === "unverified-artifact",
			JSON.stringify(invented),
		);
		r.verify(
			"red: nothing was staged or launched",
			bad.swaps.length === 0 && bad.launches.length === 0,
			JSON.stringify({ swaps: bad.swaps, launches: bad.launches }),
		);
		r.verify(
			"red: the running bundle is untouched",
			(await readFile(marker, "utf8")) === "1.0.0",
			"marker changed",
		);
	} catch (error) {
		r.failed = true;
		console.log(
			`FAIL  red case threw: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
} catch (error) {
	r.failed = true;
	console.log(
		`FAIL  happy path aborted: ${error instanceof Error ? error.message : String(error)}`,
	);
} finally {
	await rm(dir, { recursive: true, force: true });
}

console.log(r.failed ? "RESULT  FAIL" : "RESULT  PASS");
process.exit(r.failed ? 1 : 0);
