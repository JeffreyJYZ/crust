/**
 * Linux's login item: an XDG autostart entry at `$XDG_CONFIG_HOME/autostart/<id>.desktop`, which the
 * desktop environment reads at login. `Hidden=true` is the spec's way to keep an entry but stop it
 * starting, so `enabled` reads it as off rather than on — the file existing is not the whole answer.
 *
 * The `Exec` key has two escaping layers and both are needed: the Desktop Entry spec quotes and
 * backslash-escapes an argument (`"` `` ` `` `$` `\`), and the key-file string escapes a backslash
 * again, so a path holding `$` reaches the shell as `$` rather than as an expansion.
 */

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { type AutostartMechanism, writeAtomic } from "./autostart-mechanism";

/** The characters the `Exec` key must quote, from the spec's reserved set. */
const RESERVED = /[\s"'\\><~|&;$*?#()`]/;

/** Key-file string escaping, applied outside the `Exec` quoting: a backslash doubles before it is read. */
function escapeValue(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("\n", "\\n")
		.replaceAll("\r", "\\r")
		.replaceAll("\t", "\\t");
}

/** One `Exec` argument: quoted when it holds a reserved character, the four escapable ones escaped. */
function execArgument(argument: string): string {
	const escaped = argument.replace(/(["`$\\])/g, "\\$1");
	return RESERVED.test(argument) ? `"${escaped}"` : escaped;
}

export function desktopDocument(name: string, appPath: string): string {
	return [
		"[Desktop Entry]",
		"Type=Application",
		`Name=${escapeValue(name)}`,
		`Exec=${escapeValue(execArgument(appPath))}`,
		// GNOME reads this key; on other desktops the entry's presence is what arms it, so both hold.
		"X-GNOME-Autostart-enabled=true",
		"Terminal=false",
		"",
	].join("\n");
}

/** The `[Desktop Entry]` keys of one entry file; an unreadable file has none. */
function entryKeys(text: string): Map<string, string> {
	const keys = new Map<string, string>();
	let section = "";
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		if (line.startsWith("[") && line.endsWith("]")) {
			section = line.slice(1, -1);
			continue;
		}
		if (section !== "Desktop Entry") continue;
		const equals = line.indexOf("=");
		if (equals > 0) keys.set(line.slice(0, equals).trim(), line.slice(equals + 1).trim());
	}
	return keys;
}

/** A file that exists but is not an `Application` entry, or is hidden, starts nothing at login. */
export async function desktopEnabled(path: string): Promise<boolean> {
	const text = await readFile(path, "utf8").catch(() => undefined);
	if (text === undefined) return false;
	const keys = entryKeys(text);
	if (keys.get("Type") !== "Application") return false;
	if (keys.get("Hidden") === "true") return false;
	return keys.get("X-GNOME-Autostart-enabled") !== "false";
}

/** The entry `configHome` would hold for this id; the caller supplies it so a test writes no real one. */
export function linuxMechanism(configHome: string, name: string): AutostartMechanism {
	const path = join(configHome, "autostart", `${name}.desktop`);
	return {
		path,
		write: async (appPath) => await writeAtomic(path, desktopDocument(name, appPath)),
		enabled: async () => await desktopEnabled(path),
		remove: async () => await rm(path, { force: true }),
	};
}
