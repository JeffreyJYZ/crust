/**
 * The shell, store and stronghold proofs: a real child process on an allowlist, a JSON file read
 * back by a second plugin instance on the same root, and a real AES-256-GCM vault whose ciphertext
 * must not carry the plaintext and whose wrong password must refuse. Each temp root is removed.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createOsPlugin,
	createShellPlugin,
	createStorePlugin,
	createStrongholdPlugin,
	STORE_FILE,
} from "crust/plugin";
import { darwinOsAdapter } from "../../src/platform/darwin/os-info.ts";
import config from "./crust.config.ts";
import { mark, reason, skip } from "./proofs.ts";

const STORE_VALUE = '{"n":1}';

/** `echo` answers on the allowlist; `sh` is not on it and must be refused before a process exists. */
export async function proveShell(): Promise<boolean> {
	const { appData } = createOsPlugin({
		...darwinOsAdapter(),
		appId: config.app.id,
	}).commands.paths();
	try {
		mkdirSync(appData, { recursive: true });
	} catch (error) {
		return skip("shell", reason(error));
	}
	const shell = createShellPlugin({ allow: ["echo"], cwdRoot: appData });
	const spawned = await shell.commands.spawn({ program: "echo", args: ["hi"], stdin: "pipe" });
	if (!spawned.ok) {
		console.log(`shell     spawn refused: ${spawned.message}`);
		return mark("shell", false);
	}
	const { id } = spawned;
	// `echo` never reads its stdin, so this write can find the pipe closed; the spawn, the
	// output and the kill are what the surface is judged on.
	const wrote = await shell.commands.write({ id, data: "x" });
	let out = await shell.commands.output({ id });
	// The exit is asynchronous, so the ring is only complete once the child reports one.
	for (let tries = 0; tries < 50 && out.ok && out.exitCode === null; tries++) {
		await Bun.sleep(20);
		out = await shell.commands.output({ id });
	}
	const killed = await shell.commands.kill({ id });
	const stdout = out.ok ? out.stdout : "";
	console.log(`shell echo: ${stdout}`);
	const refused = await shell.commands.spawn({ program: "sh" });
	const denied = refused.ok === false && refused.code === "program-not-allowed";
	console.log(`shell refused: ${denied ? "program-not-allowed" : JSON.stringify(refused)}`);
	const written = wrote.ok || wrote.code === "no-stdin";
	return mark("shell", stdout === "hi" && written && killed.ok && denied);
}

/** A second instance on the same root proves the answer came off the disk, not out of memory. */
export async function proveStore(): Promise<boolean> {
	const root = mkdtempSync(join(tmpdir(), "crust-parity-store-"));
	try {
		const first = createStorePlugin({ root });
		const set = await first.commands.set({ key: "k", value: { n: 1 } });
		const read = await first.commands.get({ key: "k" });
		const keys = await first.commands.keys();
		const second = createStorePlugin({ root });
		const again = await second.commands.get({ key: "k" });
		const value = JSON.stringify(again.value);
		const persisted = value === STORE_VALUE && JSON.stringify(read.value) === STORE_VALUE;
		console.log(`store k=${value} persisted=${persisted}`);
		return mark("store", persisted && keys.keys.includes("k") && set.key === "k");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

/** The raw file is read on disk: neither the value nor the key name may appear in it. */
export async function proveStronghold(): Promise<boolean> {
	const root = mkdtempSync(join(tmpdir(), "crust-parity-stronghold-"));
	const vault = createStrongholdPlugin({ root });
	try {
		const opened = await vault.commands.open({ password: "pw" });
		if (!opened.ok) {
			console.log(`stronghold open refused: ${opened.message}`);
			return mark("stronghold", false);
		}
		const set = await vault.commands.set({ key: "token", value: "s3cret" });
		vault.commands.close();
		const raw = readFileSync(join(root, STORE_FILE), "utf8");
		const encrypted = !raw.includes("s3cret") && !raw.includes("token");
		const wrong = await vault.commands.open({ password: "wrong" });
		const denied = wrong.ok === false && wrong.code === "bad-password";
		console.log(`stronghold encrypted=${encrypted} bad-password=${denied}`);
		return mark("stronghold", encrypted && denied && set.ok);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
