/**
 * notes — a real two-pane app on crust: list on the left, editor on the right,
 * plain files on disk.
 *
 * What it proves beyond `hello`: a plugin used from code (not only from the
 * page), a typed result that survives the bridge for every command, user input
 * that reaches the filesystem only after it passes a containment check, and a
 * frontend made of three plain files that a built app embeds.
 *
 * Run it with `bun run src/cli/index.ts dev --dir examples/notes` from the
 * repository root. Notes are written to `notes/` in the directory crust runs
 * from, created on `ready`.
 */
import { lstat, mkdir, readdir, unlink } from "node:fs/promises";
import { app } from "crust";
import { fsPlugin } from "crust/plugin";
import { NOTES_DIR, NOTE_EXTENSION, resolveNotePath } from "./paths.ts";

/** A command that fails returns this instead of throwing, so the page keeps the code. */
type FailureCode = "bad-name" | "bad-text" | "not-found" | "io-error";

type Failure = { ok: false; code: FailureCode; message: string };
type Ok<T> = { ok: true; value: T };

const MAX_BODY_BYTES = 256 * 1024;

function fail(code: FailureCode, message: string): Failure {
	return { ok: false, code, message };
}

/** The fs plugin's structured errors arrive with a `code`; keep the useful half. */
function pluginFailure(command: string, error: unknown): Failure {
	const code = (error as { code?: unknown } | null)?.code;
	const message = error instanceof Error ? error.message : String(error);
	if (code === "not-found") return fail("not-found", message);
	return fail("io-error", `${command}: ${message}`);
}

/**
 * Refuse to touch anything at `path` that is not a regular file: a symlink in
 * `notes/` could otherwise point anywhere, and following it would defeat the
 * name check. A missing file is fine, because both write and read-create need
 * one to start from.
 */
async function guardFile(path: string): Promise<Failure | undefined> {
	try {
		const stats = await lstat(path);
		if (stats.isSymbolicLink()) {
			return fail("bad-name", `${path} is a symlink; refusing to follow it`);
		}
		if (!stats.isFile()) {
			return fail("bad-name", `${path} is not a regular file`);
		}
		return undefined;
	} catch (error) {
		if ((error as { code?: unknown }).code === "ENOENT") return undefined;
		return fail("io-error", `notes: ${error instanceof Error ? error.message : String(error)}`);
	}
}

app.command("notes.list", async (): Promise<Ok<{ names: string[] }> | Failure> => {
	try {
		const entries = await readdir(NOTES_DIR, { withFileTypes: true });
		const names = entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(NOTE_EXTENSION))
			.map((entry) => entry.name.slice(0, -NOTE_EXTENSION.length))
			.sort((left, right) => left.localeCompare(right));
		// The page calls this on load, so the line proves a built app served its
		// own JS and the answer reached a window. It prints only past the readdir
		// and the checks above: a failure below this point cannot look like this.
		console.log(`  notes     listed ${names.length} (page call answered)`);
		return { ok: true, value: { names } };
	} catch (error) {
		return fail(
			"io-error",
			`notes.list: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
});

app.command("notes.read", async (args): Promise<Ok<{ name: string; text: string }> | Failure> => {
	const target = resolveNotePath(args.name);
	if (!target.ok) return target;

	const blocked = await guardFile(target.path);
	if (blocked) return blocked;

	try {
		// The fs plugin's own command, called from code. Its read is async, which
		// matters: one blocking handler stalls every other invoke on the bridge.
		const text = await fsPlugin.commands.readTextFile({ path: target.path });
		return { ok: true, value: { name: target.name, text } };
	} catch (error) {
		return pluginFailure("notes.read", error);
	}
});

app.command("notes.write", async (args): Promise<Ok<{ name: string; bytes: number }> | Failure> => {
	const target = resolveNotePath(args.name);
	if (!target.ok) return target;

	const text = args.text;
	if (typeof text !== "string") {
		return fail("bad-text", 'notes.write: "text" must be a string');
	}
	if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
		return fail("bad-text", `notes.write: the note is larger than ${MAX_BODY_BYTES} bytes`);
	}

	const blocked = await guardFile(target.path);
	if (blocked) return blocked;

	try {
		const { bytes } = await fsPlugin.commands.writeTextFile({
			path: target.path,
			contents: text,
		});
		return { ok: true, value: { name: target.name, bytes } };
	} catch (error) {
		return pluginFailure("notes.write", error);
	}
});

app.command("notes.remove", async (args): Promise<Ok<{ name: string }> | Failure> => {
	const target = resolveNotePath(args.name);
	if (!target.ok) return target;

	const blocked = await guardFile(target.path);
	if (blocked) return blocked;

	try {
		// `crust:fs` has no remove command in v1, and the plugin is the framework's
		// file, not this example's. Node's `unlink` is the honest gap-filler; the
		// name check above already ran, so the path is known to be inside notes/.
		await unlink(target.path);
		return { ok: true, value: { name: target.name } };
	} catch (error) {
		if ((error as { code?: unknown }).code === "ENOENT") {
			return fail("not-found", `notes.remove: no note named ${JSON.stringify(target.name)}`);
		}
		return fail(
			"io-error",
			`notes.remove: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
});

app.on("ready", async () => {
	await mkdir(NOTES_DIR, { recursive: true });
	console.log(`  notes     ${NOTES_DIR}`);
});

app.on("window-all-closed", () => {
	console.log("  window    closed; quitting");
});

await app.run();
