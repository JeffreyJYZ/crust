/**
 * The two native layers doctor can only test by doing the thing the runtime
 * does: compile the C shim with TinyCC, and load the window module.
 */

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cc, FFIType } from "bun:ffi";
import { readAsset } from "../assets.ts";
import { SHIM_PART_NAMES } from "../../platform/darwin/shim-source.ts";
import { inExecutable } from "../framework.ts";
import { crustRoot, exists } from "../util.ts";
import { type Check, inline } from "./check.ts";

/**
 * `cc()` the shipped shim once, exactly as the platform does at launch — the check a user cannot do by reading the project, since TinyCC compiling C with four frameworks linked is what fails when the toolchain is missing or the shim was edited into something C cannot parse. No side effects: no window, no application activation.
 */
export async function checkShim(): Promise<Check> {
	// The shim is one translation unit assembled from numbered parts, so the check
	// composes the same list the runtime does — reading whichever half this process
	// can see. Checking a single file would silently test a fragment.
	const dir = resolve(crustRoot, "src/platform/darwin/shim");
	let text: string;
	let label: string;

	if (!inExecutable() && (await exists(join(dir, SHIM_PART_NAMES[0] ?? "")))) {
		const parts = await Promise.all(
			SHIM_PART_NAMES.map(async (name) => await Bun.file(join(dir, name)).text()),
		);
		text = parts.join("\n");
		label = dir;
	} else {
		// A compiled executable carries the parts as text, and `cc()` cannot read the
		// embedded tree — TinyCC opens the path itself and the vfs is not a path it
		// can open. Materialise what this process can read and compile that.
		const parts: string[] = [];
		for (const name of SHIM_PART_NAMES) {
			const part = await readAsset(`src/platform/darwin/shim/${name}`);
			if (part === undefined) {
				return {
					name: "shim",
					status: "fail",
					detail: `missing ${join(dir, name)}, and not embedded in this executable`,
				};
			}
			parts.push(new TextDecoder().decode(part));
		}
		text = parts.join("\n");
		label = "embedded src/platform/darwin/shim/*.c";
	}

	// `cc()` takes a path, not a source string, so the composed unit is written out —
	// the same materialise-then-compile step the embedded branch always needed.
	const temporary = join(tmpdir(), `crust-doctor-${process.pid}-shim.c`);
	await Bun.write(temporary, text);

	try {
		cc({
			source: temporary,
			flags: [
				"-framework",
				"AppKit",
				"-framework",
				"Foundation",
				"-framework",
				"WebKit",
				"-framework",
				"CoreFoundation",
			],
			symbols: {
				shim_app_load: { args: [], returns: FFIType.i32 },
				shim_window_new: {
					args: [FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64],
					returns: FFIType.ptr,
				},
			},
		});
		return { name: "shim", status: "ok", detail: `${label} compiles with cc()` };
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		return {
			name: "shim",
			status: "fail",
			detail: `${label} does not compile — ${inline(text)}`,
		};
	} finally {
		if (temporary) await rm(temporary, { force: true });
	}
}

/** The window layer: importing it is the whole check. */
export async function checkWindow(): Promise<Check> {
	// A compiled executable carries the module and has no file on disk to stat, so
	// a path check would report a failure for a build that works.
	try {
		const platform = await import("@/platform/darwin");
		return {
			name: "window",
			status: "ok",
			detail: `platform module loaded, ${platform.PREFLIGHT.length} preflight entries`,
		};
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		return {
			name: "window",
			status: "fail",
			detail: `the macOS platform layer did not load — ${inline(text)}`,
		};
	}
}
