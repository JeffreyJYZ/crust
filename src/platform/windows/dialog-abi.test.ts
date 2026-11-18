/**
 * The return width of every Win32 entry point the dialog parts declare, read off their own source.
 *
 * `abi-width.test.ts` classifies the pointers in `10_prelude.c`; the panels are resolved apart from
 * that table, so their pointers are declared in `48_dialog.c` and get the same verdict here. The
 * trap is the one that audit exists for: a pointer declared wider than the real function reads an
 * undefined top half of RAX, so `GetOpenFileNameW`'s `BOOL` must be `int`, and `CommDlgExtendedError`
 * must stay the 32-bit `DWORD` it is.
 */
import { describe, expect, test } from "bun:test";
import { readShimPart } from "./shim-source.ts";

const PART = readShimPart("48_dialog.c");

/** `static <ret> (*Name)(` — the return type with its line breaks collapsed to single spaces. */
function declaredReturns(): Map<string, string> {
	const returns = new Map<string, string>();
	for (const match of PART.matchAll(/^static ([^;]*?)\(\*([A-Za-z_]\w*)\)\(/gm)) {
		returns.set(match[2] ?? "", (match[1] ?? "").replace(/\s+/g, " ").trim());
	}
	return returns;
}

/** A 32-bit return: `BOOL`, `int`, `DWORD`, `UINT`. */
const THIRTY_TWO: Record<string, string> = {
	GetOpenFileNameW: "int", // BOOL
	GetSaveFileNameW: "int", // BOOL
	SHGetPathFromIDListW: "int", // BOOL
	CommDlgExtendedError: "unsigned int", // DWORD
};

/** A pointer return: `LPITEMIDLIST`. */
const SIXTY_FOUR: Record<string, string> = {
	SHBrowseForFolderW: "void *", // LPITEMIDLIST
};

/** No return at all, so no width to get wrong. */
const VOID: Record<string, string> = {
	CoTaskMemFree: "void",
};

const TABLES = [THIRTY_TWO, SIXTY_FOUR, VOID];

describe("the return width of every dialog entry point", () => {
	test("a 32-bit return is declared 32-bit", () => {
		const returns = declaredReturns();
		for (const [name, type] of Object.entries(THIRTY_TWO)) {
			expect({ [name]: returns.get(name) }).toEqual({ [name]: type });
		}
	});

	test("a pointer return stays a pointer", () => {
		const returns = declaredReturns();
		for (const [name, type] of Object.entries(SIXTY_FOUR)) {
			expect({ [name]: returns.get(name) }).toEqual({ [name]: type });
		}
	});

	test("a void return is declared void", () => {
		const returns = declaredReturns();
		for (const [name, type] of Object.entries(VOID)) {
			expect({ [name]: returns.get(name) }).toEqual({ [name]: type });
		}
	});

	/**
	 * The exhaustive half: a new pointer in this part cannot arrive without someone deciding its
	 * width, and a verdict for a pointer the part no longer declares fails too.
	 */
	test("every declared pointer is classified, and every classification is declared", () => {
		const classified = TABLES.flatMap((table) => Object.keys(table)).sort();
		expect([...declaredReturns().keys()].sort()).toEqual(classified);
	});
});
