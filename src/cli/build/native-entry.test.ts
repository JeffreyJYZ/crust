/**
 * `crust/native` is the supported way for an app that mounts its own native set to get the
 * platform's adapter factories. Two proofs: the source tree declares every adapter as a static
 * re-export (never a computed load), and a `bun build --compile` consumer actually embeds and
 * loads them — the trace that used to end in `Cannot find package 'crust' imported from /$bunfs`.
 *
 * The compiled consumer prints type names and exits; it opens no panel and creates no window,
 * so this runs on a dev machine. On a non-darwin runner the compile still proves the bundler
 * embedded the module; only the run is host-specific (the darwin adapters need AppKit).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const REPO = resolve(import.meta.dir, "..", "..", "..");

/** The factories a consumer needs for its own native menu, notifications, keychain and reads. */
const ADAPTERS = [
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
] as const;

describe("crust/native", () => {
	test("package exports the entry, and every adapter is a literal static re-export", async () => {
		const manifest = JSON.parse(await Bun.file(join(REPO, "package.json")).text()) as {
			exports: Record<string, string>;
		};
		expect(manifest.exports["./native"]).toBe("./src/native.ts");

		const source = (await Bun.file(join(REPO, "src", "native.ts")).text()).replace(
			/\/\*[\s\S]*?\*\//g,
			"",
		);
		for (const name of ADAPTERS) {
			expect(new RegExp(`\\b${name}\\b`).test(source)).toBe(true);
		}
		// The failure class: a loader that resolves a package or a computed path at runtime.
		expect(source).not.toContain("import.meta.resolve");
		expect(source).not.toContain("require(");
		expect(source).not.toContain("await import(");
	});

	test("a compiled consumer embeds and loads every adapter", () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-native-entry-"));
		try {
			const nodeModules = join(dir, "node_modules");
			mkdirSync(nodeModules, { recursive: true });
			symlinkSync(REPO, join(nodeModules, "crust"), "dir");

			const names = ADAPTERS.join(", ");
			const source = [
				`import { ${names} } from "crust/native";`,
				`const fns = [${names}];`,
				'console.log("native-count=" + fns.length);',
				'console.log("native-types=" + fns.map((f) => typeof f).join(","));',
				"",
			].join("\n");
			const entry = join(dir, "main.ts");
			const binary = join(dir, "native-app");
			writeFileSync(entry, source, "utf8");

			const built = Bun.spawnSync(
				["bun", "build", "--compile", "--trim", "--outfile", binary, entry],
				{ cwd: dir, stdout: "pipe", stderr: "pipe" },
			);
			expect(built.exitCode).toBe(0);
			expect(existsSync(binary)).toBe(true);

			if (process.platform !== "darwin") return;
			const run = Bun.spawnSync([binary], {
				cwd: dir,
				stdout: "pipe",
				stderr: "pipe",
				timeout: 30_000,
			});
			const out = new TextDecoder().decode(run.stdout);
			expect(run.exitCode).toBe(0);
			expect(out).toContain(`native-count=${ADAPTERS.length}`);
			expect(out).toContain(
				`native-types=${Array(ADAPTERS.length).fill("function").join(",")}`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
