/**
 * `crust/native/<platform>` is the supported way for an app that mounts its own native set to get
 * that platform's adapter factories. Three proofs: the package maps one subpath per platform, each
 * subpath re-exports only its own platform statically (no computed load, no other platform), and
 * a `bun build --compile` consumer actually embeds and loads the factories — the trace that used
 * to end in `Cannot find package 'crust' imported from /$bunfs`.
 *
 * The compiled consumer prints type names and exits; it opens no panel and creates no window,
 * so this runs on a dev machine. On a non-darwin runner the compile still proves the bundler
 * embedded the module; only the darwin run is host-specific.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const REPO = resolve(import.meta.dir, "..", "..", "..");

interface NativeEntry {
	subpath: string;
	platform: "darwin" | "windows" | "linux";
	adapters: readonly string[];
}

const DARWIN = [
	"darwinDialogAdapter",
	"darwinMenuAdapter",
	"darwinNotificationAdapter",
	"darwinKeychainAdapter",
	"createStatusBar",
	"darwinShortcutsAdapter",
	"darwinDockAdapter",
	"darwinThemeAdapter",
	"listScreens",
	"darwinPowerAdapter",
	"darwinAccessibilityAdapter",
	"darwinNavigationAdapter",
	"darwinFindAdapter",
	"darwinDownloadsAdapter",
	"darwinOpenerAdapter",
	"darwinOsAdapter",
];

const WINDOWS = [
	"windowsDialogAdapter",
	"windowsNotificationAdapter",
	"windowsKeychainAdapter",
	"windowsTrayAdapter",
	"windowsClipboardAdapter",
	"windowsOpenerAdapter",
	"windowsOsAdapter",
	"windowsScreenAdapter",
	"windowsWindowWorkAreas",
	"windowsBrowserAdapter",
	"windowsWindowAdapter",
];

const LINUX = [
	"linuxDialogAdapter",
	"linuxNotificationAdapter",
	"linuxKeychainAdapter",
	"linuxTrayAdapter",
	"linuxClipboardAdapter",
	"linuxOpenerAdapter",
	"linuxOsAdapter",
	"linuxScreenAdapter",
	"linuxWindowWorkAreas",
	"linuxBrowserAdapter",
	"linuxWindowAdapter",
];

const ENTRIES: readonly NativeEntry[] = [
	{ subpath: "./native/darwin", platform: "darwin", adapters: DARWIN },
	{ subpath: "./native/windows", platform: "windows", adapters: WINDOWS },
	{ subpath: "./native/linux", platform: "linux", adapters: LINUX },
];

const others = (platform: string): string[] =>
	["darwin", "windows", "linux"].filter((name) => name !== platform);

describe("crust/native/<platform>", () => {
	test("one subpath per platform, each re-exporting only its own modules statically", async () => {
		const manifest = JSON.parse(await Bun.file(join(REPO, "package.json")).text()) as {
			exports: Record<string, string>;
		};
		// No bare entry: a Windows binary must never resolve a module that imports AppKit.
		expect(manifest.exports["./native"]).toBeUndefined();
		for (const entry of ENTRIES) {
			expect(manifest.exports[entry.subpath]).toBe(`./src/native/${entry.platform}.ts`);
			const raw = await Bun.file(join(REPO, "src", "native", `${entry.platform}.ts`)).text();
			const source = raw.replace(/\/\*[\s\S]*?\*\//g, "");
			for (const name of entry.adapters) {
				expect(new RegExp(`\\b${name}\\b`).test(source)).toBe(true);
			}
			expect(source).toContain(`../platform/${entry.platform}/`);
			for (const foreign of others(entry.platform)) {
				expect(source).not.toContain(foreign);
			}
			// The failure class: a runtime loader that resolves a package or a computed path.
			expect(source).not.toContain("import.meta.resolve");
			expect(source).not.toContain("require(");
			expect(source).not.toContain("await import(");
		}
	});

	test("a compiled consumer embeds every adapter, and no foreign platform is reachable", () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-native-entry-"));
		try {
			mkdirSync(join(dir, "node_modules"), { recursive: true });
			symlinkSync(REPO, join(dir, "node_modules", "crust"), "dir");
			for (const entry of ENTRIES) {
				const names = entry.adapters.join(", ");
				const source = [
					`import { ${names} } from "crust${entry.subpath.slice(1)}";`,
					`const fns = [${names}];`,
					'console.log("native-count=" + fns.length);',
					'console.log("native-types=" + fns.map((f) => typeof f).join(","));',
					"",
				].join("\n");
				const file = join(dir, `${entry.platform}.ts`);
				const binary = join(dir, `${entry.platform}-app`);
				writeFileSync(file, source, "utf8");

				const built = Bun.spawnSync(
					["bun", "build", "--compile", "--trim", "--outfile", binary, file],
					{ cwd: dir, stdout: "pipe", stderr: "pipe" },
				);
				expect(built.exitCode).toBe(0);
				expect(existsSync(binary)).toBe(true);

				// A plain bundle is text we can inspect: the Windows/Linux entries must carry no
				// darwin module, and vice versa. A foreign platform in here means it was pulled in.
				const js = join(dir, `${entry.platform}.js`);
				const bundled = Bun.spawnSync(
					["bun", "build", "--target=bun", "--outfile", js, file],
					{ cwd: dir, stdout: "pipe", stderr: "pipe" },
				);
				expect(bundled.exitCode).toBe(0);
				const text = new TextDecoder().decode(readFileSync(js));
				for (const foreign of others(entry.platform)) {
					expect(text).not.toContain(`platform/${foreign}/`);
				}

				if (entry.platform !== process.platform) continue;
				const run = Bun.spawnSync([binary], {
					cwd: dir,
					stdout: "pipe",
					stderr: "pipe",
					timeout: 30_000,
				});
				const out = new TextDecoder().decode(run.stdout);
				expect(run.exitCode).toBe(0);
				expect(out).toContain(`native-count=${entry.adapters.length}`);
				expect(out).toContain(
					`native-types=${Array(entry.adapters.length).fill("function").join(",")}`,
				);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
