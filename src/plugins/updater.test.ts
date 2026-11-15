import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type CheckArgs,
	type CheckResult,
	createUpdaterPlugin,
	type DownloadResult,
	type InstallResult,
	nodeUpdaterAdapter,
	type UpdaterAdapter,
	type UpdaterFailure,
} from "@/plugins/updater";
import { compareVersions, isNewer, parseManifest } from "@/plugins/updater-args";

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-updater-"));
}

function offlineAdapter(overrides: Partial<UpdaterAdapter> = {}): UpdaterAdapter {
	const offline = () => {
		throw new Error("a test tried to reach the network");
	};
	return { ...nodeUpdaterAdapter(), fetchJson: offline, download: offline, ...overrides };
}

function plugin(adapter: UpdaterAdapter) {
	return createUpdaterPlugin(adapter).commands;
}

async function check(manifest: unknown, currentVersion: string): Promise<CheckResult> {
	const adapter = offlineAdapter({ fetchJson: async () => manifest });
	return await plugin(adapter).check({ endpoint: "e", currentVersion });
}

function writing(payload: string): UpdaterAdapter {
	return offlineAdapter({
		download: async (_url, directory) => {
			const path = join(directory, "Notes.app");
			await writeFile(path, payload);
			return { path, bytes: payload.length };
		},
	});
}

async function install(path: string, appPath: string): Promise<InstallResult | UpdaterFailure> {
	return await plugin(offlineAdapter()).install({ path, appPath });
}

async function bundle(dir: string, name: string, marker: string): Promise<string> {
	const path = join(dir, name);
	await mkdir(join(path, "Contents"), { recursive: true });
	await writeFile(join(path, "Contents", "marker.txt"), marker, "utf8");
	return path;
}

describe("compareVersions", () => {
	test("compares segments numerically, and a pre-release sorts below its release", () => {
		const cases: Array<[string, string, number]> = [
			["0.10.0", "0.9.0", 1],
			["0.9.0", "0.10.0", -1],
			["1.99.99", "2.0.0", -1],
			["1.2", "1.2.0", 0],
			["v1.2.3", "1.2.3", 0],
			["1.0.0", "1.0.0-beta.1", 1],
			["1.0.0-alpha", "1.0.0-beta", -1],
		];
		for (const [left, right, order] of cases) expect(compareVersions(left, right)).toBe(order);
		expect(isNewer("1.2.1", "1.2")).toBe(true);
		expect(isNewer("1.2", "1.2.0")).toBe(false);
	});
});

describe("parseManifest", () => {
	test("reads a full manifest and refuses one without version, url or a good sha256", () => {
		const digest = "AB".repeat(32);
		const source = { version: "1.4.0", notes: "x", url: "u", sha256: digest };
		const parsed = parseManifest(source);
		expect(parsed).toEqual({ ok: true, manifest: { ...source, sha256: digest.toLowerCase() } });
		expect(parseManifest({ url: "u.app" })).toMatchObject({ ok: false });
		expect(parseManifest({ version: "1.0.0" })).toMatchObject({ ok: false });
		expect(parseManifest(null)).toMatchObject({ ok: false });
		expect(parseManifest({ version: "1", url: "u", sha256: "nope" })).toMatchObject({
			ok: false,
			reason: '"sha256" must be 64 hex characters',
		});
	});
});

describe("updater.check", () => {
	test("0.10.0 is available over 0.9.0, and the manifest is passed through", async () => {
		const result = await check({ version: "0.10.0", notes: "faster", url: "u.app" }, "0.9.0");
		const expected = { available: true, version: "0.10.0", url: "u.app", notes: "faster" };
		expect(result).toEqual(expected);
	});

	test("the same or an older version is not available, and that is not an error", async () => {
		expect(await check({ version: "1.4.0", url: "u.app" }, "1.4.0")).toEqual({
			available: false,
			version: "1.4.0",
		});
		expect(await check({ version: "1.4.0", url: "u.app" }, "1.5.0")).toMatchObject({
			available: false,
		});
	});

	test("a failed fetch and a non-manifest payload are values, never throws", async () => {
		const down = offlineAdapter({
			fetchJson: async () => {
				throw new Error("ENOTFOUND");
			},
		});
		expect(await plugin(down).check({ endpoint: "e", currentVersion: "1.0.0" })).toMatchObject({
			available: false,
			error: { code: "check-failed", message: "ENOTFOUND" },
		});
		expect(await check({ hello: "world" }, "1.0.0")).toMatchObject({
			available: false,
			error: { code: "bad-manifest" },
		});
		const noArgs = await plugin(offlineAdapter()).check({} as CheckArgs);
		expect(noArgs).toMatchObject({ available: false, error: { code: "invalid-arguments" } });
	});
});

describe("updater.download", () => {
	const payload = "bundle-bytes";
	const digest = createHash("sha256").update(payload).digest("hex");

	test("writes into a temp dir, verifies a given digest, and refuses a mismatch", async () => {
		const hashed = { url: "u.app", sha256: digest };
		const result = (await plugin(writing(payload)).download(hashed)) as DownloadResult;
		expect(result).toMatchObject({ ok: true, bytes: payload.length, sha256: digest });
		expect(result.path.startsWith(tmpdir())).toBe(true);
		expect(await readFile(result.path, "utf8")).toBe(payload);

		const plain = (await plugin(writing(payload)).download({ url: "u.app" })) as DownloadResult;
		expect(plain.sha256).toBeUndefined();

		const wrong = (await plugin(writing(payload)).download({
			url: "u.app",
			sha256: "0".repeat(64),
		})) as UpdaterFailure;
		expect(wrong).toMatchObject({ ok: false, code: "hash-mismatch" });
		expect(wrong.path?.endsWith("Notes.app")).toBe(true);
	});
});

describe("updater.install", () => {
	test("renames the new bundle into place and keeps the old one aside", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			expect(await install(source, appPath)).toMatchObject({
				ok: true,
				backup: `${appPath}.old`,
			});
			const marker = join("Contents", "marker.txt");
			expect(await readFile(join(appPath, marker), "utf8")).toBe("new");
			expect(await readFile(join(`${appPath}.old`, marker), "utf8")).toBe("old");
			await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("refuses a target or a download that is not an .app directory, replacing nothing", async () => {
		const dir = await scratch();
		try {
			const notAnApp = await bundle(dir, "Notes", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const target = await bundle(dir, "Other.app", "old");
			const loose = join(dir, "loose");
			const file = join(dir, "Loose.app");
			await mkdir(loose);
			await writeFile(file, "not a bundle", "utf8");
			for (const [path, appPath] of [
				[source, notAnApp],
				[source, file],
				[loose, target],
			] as const) {
				expect(await install(path, appPath)).toMatchObject({
					ok: false,
					code: "not-an-app-bundle",
				});
			}
			expect(await readFile(join(notAnApp, "Contents", "marker.txt"), "utf8")).toBe("old");
			expect(await readFile(join(target, "Contents", "marker.txt"), "utf8")).toBe("old");
			await expect(stat(source)).resolves.toBeDefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
