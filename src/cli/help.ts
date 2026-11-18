/**
 * The single home for help wording. `index.ts` registers these strings with cac
 * (command descriptions, option descriptions and examples) and lets cac render
 * both help screens; nothing here slices a prose block any more.
 */

import type { CommandName } from "./commands.ts";

/** Leads the first example; cac itself prints only the bare command name above. */
export const TAGLINE = "crust — a Bun-native desktop app framework. No Rust. Just crust.";

/**
 * Genuine invocations. Each trailing comment is that command's precise usage:
 * it keeps the contract's pinned lowercase `usage:` string without printing a
 * second, lowercase Usage section (cac already renders the canonical one).
 */
export const BASIC_EXAMPLES =
	`${TAGLINE}\n\n` +
	"  $ crust init my-app    # usage: crust init <dir>\n" +
	"  $ crust dev            # usage: crust dev [file]\n" +
	"  $ crust build          # usage: crust build [file]";

/** The one-line descriptions registered with cac, keyed by the command table. */
export const COMMAND_DESCRIPTIONS: Record<CommandName, string> = {
	init: "scaffold an app in an empty directory",
	dev: "watch the backend, restart on change, follow the frontend URL",
	build: "compile the binary and assemble X.app (ad-hoc signed)",
	sign: "Developer ID signing (needs a certificate)",
	dmg: "build a drag-to-Applications disk image",
	package: "build release artefacts; --format is repeatable, defaults to dmg",
	notarize: "submit the signed bundle to notarytool, then staple the ticket",
	doctor: "report why the app did not open",
};

/** Option descriptions registered with cac and printed by the full help. */
export const OPTION_DESCRIPTIONS = {
	dir: "project directory (default: current directory)",
	config: "config file, relative to --dir",
	entry: "backend entry, relative to --dir (default: src/main.ts, then main.ts)",
	format: "package only: dmg, appimage or nsis; repeat for several",
	react: "init only: copy the React + Vite template",
	next: "init only: copy the Next.js template (static export)",
	svelte: "init only: copy the Svelte + Vite template",
	vue: "init only: copy the Vue + Vite template",
} as const;

/** Leading newline survives cac's "\n" example join as a blank separator. */
export const NOTARIZE_CREDENTIALS = `\nnotarize credentials come from the environment, never from argv:
  CRUST_SIGNING_IDENTITY      "Developer ID Application: Name (TEAMID)"
  CRUST_NOTARY_PROFILE        a notarytool store-credentials profile, or
  CRUST_NOTARY_APPLE_ID       an Apple ID with CRUST_NOTARY_PASSWORD and
  CRUST_NOTARY_TEAM_ID        the team id it belongs to`;

/** Leading newline survives cac's "\n" example join as a blank separator. */
export const PUBLISHED_LIMITS =
	"\nThe published limits: ~85 MiB per app (Bun ships its runtime), macOS arm64 only, " +
	"and no Developer ID signature yet, so Gatekeeper refuses builds on other machines.";
