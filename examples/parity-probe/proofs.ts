/**
 * The menu and clipboard proofs, plus the verdict state the other proof file records into.
 * Both are real round trips through the framework's own command layer and the real AppKit
 * adapter — never a fake — and each restores what it changed before it returns.
 */
import { createClipboardPlugin } from "crust/plugin";
import { darwinClipboardAdapter } from "../../src/platform/darwin/clipboard.ts";
import { darwinMenuAdapter } from "../../src/platform/darwin/menu-api.ts";
import { createMenuPlugin } from "../../src/plugins/menu.ts";

/** A 1x1 RGBA PNG: real image bytes, so the pasteboard does an image round trip. */
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);
const PNG_MAGIC = "89 50 4e 47 0d 0a 1a 0a";
export const ACCEL = "CommandOrControl+Shift+K";
export const LABEL = "parity-probe";

const MENU = [
	{
		label: "Parity probe",
		submenu: [{ label: "Probe item", accelerator: "Cmd+Shift+K" }, { separator: true }],
	},
];

export const proofs: { name: string; ok: boolean }[] = [];

export function mark(name: string, ok: boolean): boolean {
	proofs.push({ name, ok });
	return ok;
}

/** Name a surface that could not run and record nothing, so the summary counts only proofs that ran. */
export function skip(name: string, why: string): boolean {
	console.log(`${name.padEnd(9)} skipped: ${why}`);
	return true;
}

export function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Titles AppKit holds, flattened; the readback names each row `title`. */
function titlesOf(items: readonly unknown[]): string[] {
	const out: string[] = [];
	for (const entry of items) {
		if (typeof entry !== "object" || entry === null) continue;
		const row = entry as Record<string, unknown>;
		const title = row.title ?? row.label;
		if (typeof title === "string" && title.length > 0) out.push(title);
		const children = row.children ?? row.submenu;
		if (Array.isArray(children)) out.push(...titlesOf(children));
	}
	return out;
}

/** The bar is put back in a `finally`, so the app never leaves its own menu installed. */
export function proveMenu(): boolean {
	const adapter = darwinMenuAdapter({ appName: "Parity probe" });
	const commands = createMenuPlugin(adapter).commands as unknown as Record<
		string,
		((args?: unknown) => unknown) | undefined
	>;
	try {
		const applied = (commands.setAppMenu?.({ items: MENU }) as { ok?: boolean })?.ok === true;
		const read = commands.read;
		if (typeof read !== "function") {
			// Setting the bar is not reading it. Without a readback this surface is unproven.
			console.log("menu      read unavailable — menu.read is not in this tree yet");
			return mark("menu", false);
		}
		const answer = read() as { ok?: boolean; items?: unknown[] };
		if (answer?.ok !== true || !Array.isArray(answer.items)) {
			console.log(`menu      read refused: ${JSON.stringify(answer)}`);
			return mark("menu", false);
		}
		const titles = titlesOf(answer.items);
		console.log(`menu      titles: ${JSON.stringify(titles)}`);
		return mark("menu", applied && titles.includes("Probe item"));
	} finally {
		adapter.reset();
	}
}

/** The user's own text is saved first and put back in a `finally`, always. */
export function proveClipboard(): boolean {
	const clipboard = createClipboardPlugin(darwinClipboardAdapter());
	const saved = clipboard.commands.read() as { ok?: boolean; text?: string };
	if (saved?.ok !== true || typeof saved.text !== "string") {
		console.log(`clipboard save refused: ${JSON.stringify(saved)}`);
		return mark("clipboard", false);
	}
	const before = saved.text;
	// A pasteboard holding only an image has no text to put back, so the image is
	// saved too: restoring "" would wipe it, which is the change this must avoid.
	const held = clipboard.commands.readImage() as { png?: Uint8Array | null };
	const heldImage =
		before.length === 0 && held?.png instanceof Uint8Array && held.png.length > 0
			? held.png
			: null;
	try {
		const wrote = clipboard.commands.writeImage({ png: PNG }) as { ok?: boolean };
		if (wrote?.ok !== true) {
			console.log(`clipboard png write refused: ${JSON.stringify(wrote)}`);
			return mark("clipboard", false);
		}
		const read = clipboard.commands.readImage() as { ok?: boolean; png?: Uint8Array | null };
		const bytes = read?.png instanceof Uint8Array ? read.png : new Uint8Array(0);
		const magic = [...bytes.subarray(0, 8)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(" ");
		console.log(`clipboard png ${bytes.length} bytes, first 8 ${magic}`);
		return mark("clipboard", read?.ok === true && magic === PNG_MAGIC);
	} finally {
		const put =
			heldImage === null
				? (clipboard.commands.write({ text: before }) as { ok?: boolean })
				: (clipboard.commands.writeImage({ png: heldImage }) as { ok?: boolean });
		const after = clipboard.commands.read() as { ok?: boolean; text?: string };
		const kept =
			heldImage === null
				? after?.ok === true && after.text === before
				: (clipboard.commands.readImage() as { png?: Uint8Array | null }).png instanceof
					Uint8Array;
		const restored = put?.ok === true && kept;
		console.log(`clipboard restored: ${restored}`);
		if (!restored) mark("clipboard restored", false);
	}
}

/** One proof's throw must not take the others with it. Async, because two proofs touch the disk and the OS. */
export async function attempt(name: string, body: () => boolean | Promise<boolean>): Promise<void> {
	const before = proofs.length;
	try {
		await body();
	} catch (error) {
		if (proofs.length === before) mark(name, false);
		console.log(`${name.padEnd(9)} threw: ${reason(error)}`);
	}
}
