/**
 * The real preview proof: a shell preview handler created for a file and hosted in a child HWND of the
 * app window. Nothing else in this tree can prove it — the COM sequence, the registry lookup and the
 * child window only exist on Windows, and every other test drives a fake shim.
 *
 * What is asserted, and what that means: the host HWND exists (`IsWindow`), it moves on a resize, and
 * it is gone after `hide`. A file type with no registered handler must answer `no-handler` rather than
 * an empty window, and a path that is not a file must answer `not-a-file` without a COM call.
 *
 * The image handler is *printed, not asserted*: a runner image may not register one, and that is a
 * fact about the image rather than a defect in this host. The text handler is part of Windows and is
 * the one the plan names first, so that is the verdict.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeWindowsShim } from "../../src/platform/windows/active-shim.ts";
import { type PreviewOutcome, windowsPreviewHost } from "../../src/platform/windows/preview.ts";

export interface PreviewCheck {
	name: string;
	ok: boolean;
	detail: string;
}

/** The image handler's answer is printed rather than returned: a runner image may not register one. */
function printImageOutcome(image: PreviewOutcome): void {
	console.log(
		image.ok
			? `preview   image handler: host HWND ${image.hwnd} for pixel.png`
			: `preview   image handler: ${image.reason} — ${image.detail}`,
	);
}

/** A 1×1 PNG: the smallest file the image handler can be expected to accept. */
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

/** Three files in one temp folder: a previewable text file, an image, and an extension with no handler. */
export function preparePreviewFiles(): {
	text: string;
	image: string;
	none: string;
	absent: string;
} {
	const dir = join(tmpdir(), "crust-smoke-preview");
	mkdirSync(dir, { recursive: true });
	const text = join(dir, "notes.txt");
	const image = join(dir, "pixel.png");
	const none = join(dir, "sample.crustnopreview");
	writeFileSync(text, "crust preview host: a line of text for the shell's text handler.\n");
	writeFileSync(image, PNG);
	writeFileSync(none, "a file whose extension no handler is registered for\n");
	return { text, image, none, absent: join(dir, "absent.txt") };
}

export function provePreview(parent: number): PreviewCheck[] {
	const files = preparePreviewFiles();
	const host = windowsPreviewHost();
	const shim = activeWindowsShim();
	const open = (hwnd: number): boolean => Number(shim?.shim_window_is_open(hwnd) ?? 0) === 1;
	const checks: PreviewCheck[] = [];
	const rect = { x: 8, y: 8, width: 320, height: 200 };

	const shown = host.show({ path: files.text, parent, ...rect });
	if (!shown.ok) {
		checks.push({ name: "preview", ok: false, detail: `${shown.reason}: ${shown.detail}` });
		return checks;
	}
	checks.push({
		name: "preview",
		ok: open(shown.hwnd) && host.hwnd() === shown.hwnd,
		detail: `host HWND ${shown.hwnd} inside ${parent} for notes.txt, DoPreview answered`,
	});

	const moved = host.size({ x: 8, y: 8, width: 240, height: 160 });
	checks.push({
		name: "preview:resize",
		ok: moved && open(shown.hwnd),
		detail: moved
			? `host HWND ${shown.hwnd} moved to 240x160`
			: "the host refused SetWindowPos",
	});

	host.hide();
	checks.push({
		name: "preview:hide",
		ok: !open(shown.hwnd) && host.hwnd() === 0,
		detail: `host HWND ${shown.hwnd} is gone after hide`,
	});

	const noHandler = host.show({ path: files.none, parent, ...rect });
	checks.push({
		name: "preview:no-handler",
		ok: !noHandler.ok && noHandler.reason === "no-handler",
		detail: noHandler.ok ? "a handler exists for .crustnopreview" : noHandler.detail,
	});

	const notAFile = host.show({ path: files.absent, parent, ...rect });
	checks.push({
		name: "preview:not-a-file",
		ok: !notAFile.ok && notAFile.reason === "not-a-file",
		detail: notAFile.ok ? "a missing path was previewed" : notAFile.detail,
	});

	// Diagnostic only: an image handler is not guaranteed on a server image, and its absence is a fact
	// about that image rather than a defect here.
	printImageOutcome(host.show({ path: files.image, parent, ...rect }));
	host.hide();
	return checks;
}
