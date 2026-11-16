/**
 * The traps `site/app/docs/design/page.mdx` records as fatal, found in the app's own source.
 * Each is named when it is hit, with the line that hit it: a user who copied a
 * snippet that passed a JS string into C needs to see why the process died with
 * no JavaScript error, not a generic "window did not open".
 *
 * Only an app directory is scanned. Without a `crust.config.ts` there is no app,
 * so the working directory is reported as unscanned rather than walked: doing
 * that from the framework repo counted the framework's own shim as 39 failures.
 */

import { extname, join } from "node:path";
import type { Check } from "./check.ts";
import { projectSources, stripComments } from "./sources.ts";

const MAX_SCANNED_BYTES = 512 * 1024;
const C_EXTENSIONS = new Set([".c", ".m"]);

export function notScanned(): Check {
	return {
		name: "source",
		status: "note",
		detail: "not scanned — no crust.config.ts here, so this is not an app directory",
	};
}

/** The source section: the traps, or the one line saying there is nothing to scan. */
export async function sourceSection(dir: string, appDirectory: boolean): Promise<Check[]> {
	return appDirectory ? await scanTraps(dir) : [notScanned()];
}

export async function scanTraps(dir: string): Promise<Check[]> {
	const checks: Check[] = [];
	const files = await projectSources(dir);

	for (const relative of files) {
		const path = join(dir, relative);
		const info = await Bun.file(path)
			.stat()
			.catch(() => undefined);
		if (!info?.isFile() || info.size > MAX_SCANNED_BYTES) continue;
		const raw = await Bun.file(path)
			.text()
			.catch(() => "");
		if (raw.includes("\u0000")) continue;
		const text = stripComments(raw);
		const lines = text.split("\n");
		const inC = C_EXTENSIONS.has(extname(relative).toLowerCase());

		// [[NSWindow alloc] init] is not a valid initializer: AppKit aborts the
		// process from its own thread, so this one is precise enough to fail.
		const allocInit = lines.findIndex((source) =>
			/\[\s*[A-Za-z_]\w*\s+alloc\s*\]\s*init\b/.test(source),
		);
		if (allocInit !== -1) {
			checks.push({
				name: "trap",
				status: "fail",
				detail:
					`${relative}:${allocInit + 1} sends init to an allocated NSWindow — ` +
					"[[NSWindow alloc] init] aborts the process from AppKit's own thread; " +
					"build the rect in C and call initWithContentRect: instead",
			});
		}

		// The same pair written as two message sends is a hint, not a failure: a
		// fixed-prototype send helper registers both selectors and is correct, and
		// a static scan cannot tell the two apart.
		const looseAlloc = lines.findIndex(
			(source) =>
				/\balloc\b/.test(source) &&
				/\binit\b/.test(source) &&
				/sel_registerName|objc_msgSend/.test(source),
		);
		if (looseAlloc !== -1) {
			checks.push({
				name: "trap",
				status: "note",
				detail:
					`${relative}:${looseAlloc + 1} registers or sends both alloc and init — ` +
					"correct only when the send uses a fixed prototype and the object stays in C; " +
					"a static scan cannot see that, so check it by hand",
			});
		}

		// Building an NSString in C is what the shim must do — the trap is one
		// leaving C, which a static scan cannot see. In JavaScript there is no
		// boundary to cross, so a JS string reaching it is the fatal case.
		const stringSend = lines.findIndex(
			(source) =>
				/\bstringWithUTF8String\s*:/.test(source) ||
				(/\bNSString\b/.test(source) && /\bcstring\b|\bptr\(/.test(source)),
		);
		if (stringSend !== -1) {
			checks.push({
				name: "trap",
				status: inC ? "note" : "fail",
				detail: inC
					? `${relative}:${stringSend + 1} builds an NSString in C — a short ASCII one is a ` +
						"tagged pointer that cannot cross bun:ffi, so it must never leave C; a static " +
						"scan cannot see that boundary, so this is a hint, not a failure"
					: `${relative}:${stringSend + 1} builds or passes a short ASCII NSString from ` +
						"JavaScript — it is a tagged pointer and cannot cross bun:ffi; keep the " +
						"string in C behind a handle",
			});
		}

		if (text.includes("FFIType.cstring")) {
			const literalCall = lines.findIndex(
				(source) =>
					/\.\w+\(\s*(["'])[^"'`\n]*\1\s*\)/.test(source) &&
					!/TextEncoder|new Uint8Array|Buffer\.from/.test(source),
			);
			if (literalCall !== -1) {
				checks.push({
					name: "trap",
					status: "note",
					detail:
						`${relative}:${literalCall + 1} may pass a JavaScript string where the ` +
						"shim expects const char * — a JS string cannot cross into compiled C; " +
						"pass ptr(new TextEncoder().encode(value))",
				});
			}
		}
	}

	if (checks.length === 0) {
		const plural = files.length === 1 ? "" : "s";
		checks.push({
			name: "source",
			status: "ok",
			detail: `scanned ${files.length} file${plural}, no traps`,
		});
	}
	return checks;
}
