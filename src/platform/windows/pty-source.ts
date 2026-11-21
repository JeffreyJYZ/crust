/**
 * The `pty` C unit — ConPTY on Windows — as one compilation unit assembled from four parts.
 *
 * Deliberately NOT in `shim-source.ts`, for the same reason the notification unit is not: it shares
 * nothing with the window shim — no slot table, no COM object, no HWND — and its own `cc()` call is
 * what lets ConPTY land without touching `ffi.ts`, `backend.ts`, `fake-shim.ts` or the shared
 * `PREFLIGHT` table.
 *
 * The parts share statics (the four slots, the ring, the bind table), so the order is load-bearing:
 * `63` declares the API and its structs, `64` resolves and loads, `65` opens, `66` drains and
 * closes. None carries an `#include`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import contract from "./shim/63_pty.c" with { type: "text" };
import binds from "./shim/64_pty_bind.c" with { type: "text" };
import opens from "./shim/65_pty_open.c" with { type: "text" };
import io from "./shim/66_pty_io.c" with { type: "text" };

/** LF, always: a Windows checkout hands back CRLF, and the source assertions match on `\n`. */
export const lf = (text: string): string => text.replace(/\r\n/g, "\n");

/** Repo-relative paths, in the only order that compiles. */
export const PTY_PART_PATHS = [
	"src/platform/windows/shim/63_pty.c",
	"src/platform/windows/shim/64_pty_bind.c",
	"src/platform/windows/shim/65_pty_open.c",
	"src/platform/windows/shim/66_pty_io.c",
] as const;

/** The same list as bare file names. */
export const PTY_PART_NAMES = PTY_PART_PATHS.map((path) => path.slice(path.lastIndexOf("/") + 1));

/** The parts, in the only order that compiles. */
export const PTY_PARTS = [lf(contract), lf(binds), lf(opens), lf(io)] as const;

/** The whole unit, joined on a line boundary so two declarations are never welded together. */
export const ptySource = PTY_PARTS.join("\n");

/** One part from disk, normalised to LF — what a source assertion reads, and what `cc()` compiles. */
export function readPtyPart(name: string): string {
	return lf(readFileSync(join(import.meta.dir, "shim", name), "utf8"));
}
