/**
 * The argument readers for `crust:pty`, in one place so a malformed payload is a typed refusal and
 * never a throw: the bridge hands over whatever JSON the page sent, and a terminal that opened on
 * garbage is a process the host never agreed to.
 * A size is clamped to a sane window rather than refused, because an absurd terminal size is a page
 * bug that still deserves a working terminal; a program and an id are refused, because each one
 * decides what runs or which process is touched.
 */

import { type PtyFailure, ptyFailure } from "./pty-types";

export const PTY_DEFAULT_COLS = 80;
export const PTY_DEFAULT_ROWS = 24;
/** A real window is far inside these; the clamp keeps a page from asking the kernel for 2^31 cells. */
export const PTY_MAX_COLS = 500;
export const PTY_MAX_ROWS = 200;
/** One keystroke burst; a larger payload is a paste the page should have split itself. */
export const PTY_MAX_WRITE = 64 * 1024;

type Fields = Record<string, unknown>;

function fields(args: unknown): Fields {
	return typeof args === "object" && args !== null ? (args as Fields) : {};
}

/** A positive integer, clamped to `max`; `undefined` when absent, a refusal when it is not a number. */
function size(
	value: unknown,
	fallback: number,
	max: number,
	key: string,
): { ok: true; value: number } | PtyFailure {
	if (value === undefined) return { ok: true, value: fallback };
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
		return ptyFailure(
			"invalid-args",
			`pty: ${JSON.stringify(key)} must be a positive integer, got ${JSON.stringify(value)}`,
		);
	}
	return { ok: true, value: Math.min(value, max) };
}

export interface OpenArgs {
	cols: number;
	rows: number;
	/** The program the page asked for; it must be the host's own `pty.shell`, never a new one. */
	program?: string;
}

export function readOpen(args: unknown): OpenArgs | PtyFailure {
	const raw = fields(args);
	const cols = size(raw.cols, PTY_DEFAULT_COLS, PTY_MAX_COLS, "cols");
	if (!cols.ok) return cols;
	const rows = size(raw.rows, PTY_DEFAULT_ROWS, PTY_MAX_ROWS, "rows");
	if (!rows.ok) return rows;
	if (raw.program !== undefined) {
		if (typeof raw.program !== "string" || raw.program.length === 0) {
			return ptyFailure("invalid-args", 'pty.open: "program" must be a non-empty string');
		}
		return { cols: cols.value, rows: rows.value, program: raw.program };
	}
	return { cols: cols.value, rows: rows.value };
}

/** The handle every command but `open` and `list` names. */
export function readId(args: unknown, command: string): { ok: true; id: string } | PtyFailure {
	const raw = fields(args);
	if (typeof raw.id !== "string" || raw.id.length === 0) {
		return ptyFailure(
			"invalid-args",
			`pty.${command} needs { id } with the handle open answered`,
		);
	}
	return { ok: true, id: raw.id };
}

export interface WriteArgs {
	id: string;
	data: string;
}

export function readWrite(args: unknown): WriteArgs | PtyFailure {
	const id = readId(args, "write");
	if (!id.ok) return id;
	const data = fields(args).data;
	if (typeof data !== "string" || data.length === 0) {
		return ptyFailure("invalid-args", "pty.write needs { id, data } with a non-empty string");
	}
	// The cap is on UTF-8 *bytes* (what the terminal actually receives), not JS string length: 40,000
	// CJK characters are 40,000 code units but 120,000 bytes, three times the documented budget.
	const bytes = Buffer.byteLength(data, "utf8");
	if (bytes > PTY_MAX_WRITE) {
		return ptyFailure(
			"invalid-args",
			`pty.write: ${bytes} bytes is past the ${PTY_MAX_WRITE}-byte limit`,
		);
	}
	return { id: id.id, data };
}

export interface ResizeArgs {
	id: string;
	cols: number;
	rows: number;
}

export function readResize(args: unknown): ResizeArgs | PtyFailure {
	const id = readId(args, "resize");
	if (!id.ok) return id;
	const raw = fields(args);
	const cols = size(raw.cols, PTY_DEFAULT_COLS, PTY_MAX_COLS, "cols");
	if (!cols.ok) return cols;
	const rows = size(raw.rows, PTY_DEFAULT_ROWS, PTY_MAX_ROWS, "rows");
	if (!rows.ok) return rows;
	return { id: id.id, cols: cols.value, rows: rows.value };
}
