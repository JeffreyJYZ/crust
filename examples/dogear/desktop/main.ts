/**
 * Dogear's backend: the three things a page cannot do for itself.
 *
 * Every note operation — list, stat, read, write, rename, remove — belongs to
 * the `fs` plugin, and the page calls it directly. What is left here is the one
 * directory `fs` cannot create (it has no mkdir), a line of text printed where
 * a terminal can see it, and the process exit behind the menu-bar item.
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { app } from "crust";
import { fsPlugin } from "crust/plugin";

/** Where page lines are appended once `boot` has told us the notes directory. */
let logFile: string | undefined;

const SEED = `# Welcome to Dogear

A note is a markdown file on disk. This one lives where the app keeps its notes.

- **Save** writes the editor through \`fs.writeTextFile\`, from the page.
- **Rename** and **Delete** are \`fs.rename\` and \`fs.remove\`.
- **Open folder…** asks AppKit for a directory with \`dialog.openPanel\`.
- **Save as…** asks it for a file with \`dialog.savePanel\`, then writes there.
- **Quit** is a menu-bar item; a click arrives as a \`tray:click\` event.
- The window title is rewritten with \`window.setTitle\` on every switch.
`;

/**
 * Where the notes live.
 *
 * `DOGEAR_NOTES_DIR` exists so a scripted run can point the app at a scratch
 * directory instead of the real `~/Documents`; it must be absolute, because a
 * built app runs with `/` as its working directory.
 */
function notesDir(): string {
	const override = process.env.DOGEAR_NOTES_DIR;
	if (override !== undefined && override.startsWith("/")) return override;
	return join(homedir(), "Documents", "Dogear");
}

app.command("boot", async () => {
	const dir = notesDir();
	await mkdir(dir, { recursive: true });
	// A click is the one thing no script can produce, so the app keeps its own log: a
	// LaunchServices launch has no terminal, and shell redirection is lost the moment a
	// second instance is already running. Every page line lands here as well as on stdout.
	logFile = join(dir, "dogear.log");
	// The seed goes through the same plugin the page uses, so a first run
	// exercises the write path instead of a second filesystem implementation.
	const { entries } = await fsPlugin.commands.list({ path: dir });
	const first = entries.find((entry) => !entry.directory && entry.name.endsWith(".md"));
	if (first === undefined) {
		await fsPlugin.commands.writeTextFile({ path: join(dir, "welcome.md"), contents: SEED });
	}
	// `DOGEAR_SELFCHECK=1` tells the page to prove its own surfaces on load.
	return { dir, selfcheck: process.env.DOGEAR_SELFCHECK === "1" };
});

/** The page's line reaches the terminal, which is where a scripted run reads it. */
app.command("log", async (args) => {
	const line = typeof args.line === "string" ? args.line : "";
	console.log(`  page      ${line}`);
	if (logFile !== undefined) {
		// Append, never truncate: this file exists to prove what a human did, and a second
		// click must not erase the first.
		try {
			const existing = await Bun.file(logFile)
				.text()
				.catch(() => "");
			await Bun.write(logFile, `${existing}${new Date().toISOString()}  ${line}\n`);
		} catch {
			// A log that cannot be written must not break the app.
		}
	}
	return "printed";
});

app.command("quit", () => {
	// The reply has to leave the bridge before quit() stops the run loop.
	setTimeout(() => app.quit(), 80);
	return "quitting";
});

app.on("ready", () => {
	console.log(`  dogear    notes live in ${notesDir()}`);
});

await app.run();
