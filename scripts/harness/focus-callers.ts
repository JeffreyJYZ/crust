/**
 * The classification the caller test asserts: which scripts under `scripts/` can put a window (or a browser) on the human's screen, and why each of the others cannot.
 * It lives beside the test so the list is data, not prose — a new suite is a one-line addition here, and the test refuses to pass until it is either armed or exempted with a reason.
 */

/** Every script that launches or activates a GUI app, so every one must call `guardFocus()`. */
export const LAUNCHERS = [
	"demo.ts",
	"e2e-capability.ts",
	"e2e-dev-binary.ts",
	"e2e-dev-react.ts",
	"e2e-dev.ts",
	"e2e-dogear.ts",
	"e2e-native.ts",
	"e2e-notes.ts",
	"e2e-notify.ts",
	"e2e-parity.ts",
	"e2e-single.ts",
	"e2e-window.ts",
	"e2e.ts",
	"first-run.ts",
	"probe-tray.ts",
];

/** Why a script under `scripts/` cannot take the screen. Every remaining `.ts` must appear here. */
export const EXEMPT: { reason: string; files: string[] }[] = [
	{
		reason: "another platform's suite: it runs a Linux or Windows binary and never a macOS window",
		files: [
			"e2e-appimage.ts",
			"e2e-linux.ts",
			"e2e-package-nsis.ts",
			"linux-gtk-quit.ts",
			"linux-smoke.ts",
			"windows-smoke.ts",
		],
	},
	{
		reason: "builds or packages only: a bundle, a dmg or an extension is produced, never launched",
		files: ["build-standalone.ts", "e2e-package.ts", "native-extensions.ts"],
	},
	{
		reason: "reads a registry, a tarball, a page or the tree; it launches no app",
		files: [
			"check-links.ts",
			"check-parity.ts",
			"check-skips.ts",
			"e2e-parity-patterns.ts",
			"line-cap.ts",
			"release.ts",
			"skill.ts",
			"verify-cellar.ts",
			"verify-package.ts",
			"verify-release.ts",
		],
	},
	{
		reason: "a module or a unit test, imported rather than run as a suite",
		files: [
			"butter-sweep-commands.ts",
			"butter-sweep-helpers.ts",
			"docs-reference.test.ts",
			"e2e-detail.test.ts",
			"e2e-harness.ts",
			"e2e-parity-patterns.test.ts",
		],
	},
	{
		reason: "a unit test that drives a GUI child: its own `finally` restores that child's focus, and arming a process-wide exit handler inside the shared `bun test` runner would activate an app at the end of every run",
		files: ["butter-sweep.test.ts"],
	},
];

/** The names an `import { … } from "./e2e-harness"` in a caller brings in. */
export function harnessImports(text: string): string[] {
	const names: string[] = [];
	for (const match of text.matchAll(
		/import\s*\{([^}]*)\}\s*from\s*"\.\/e2e-harness(?:\.ts)?"/g,
	)) {
		for (const name of (match[1] ?? "").split(",")) names.push(name.trim());
	}
	return names;
}
