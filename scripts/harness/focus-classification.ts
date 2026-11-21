/**
 * Which scripts under `scripts/` a GUI-launch classification owes: the ones that can put a window
 * on the human's screen (`LAUNCHERS`, every one of which must arm `guardFocus()`), and every other
 * top-level script with the reason it cannot. Split out of `focus-callers.ts` when that file hit the
 * 200-line cap; the detector and the arming rules stay there.
 */

/** Every script that launches or activates a GUI app, so every one must call `guardFocus()`. */
export const LAUNCHERS = [
	"demo.ts",
	"e2e-capability.ts",
	"e2e-browser.ts",
	"e2e-dev-binary.ts",
	"e2e-dev-react.ts",
	"e2e-dev-size.ts",
	"e2e-dev.ts",
	"e2e-dogear.ts",
	"e2e-fullscreen.ts",
	"e2e-logs.ts",
	"e2e-media.ts",
	"e2e-native.ts",
	"e2e-notes.ts",
	"e2e-notify.ts",
	"e2e-parity.ts",
	"e2e-single.ts",
	"e2e-window.ts",
	"e2e.ts",
	"first-run.ts",
	"probe-focus-control.ts",
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
			"docs-coverage.ts",
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
		reason: "drives a pty and a shell process only: no window or app is launched, so nothing takes the screen",
		files: ["e2e-pty.ts"],
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
