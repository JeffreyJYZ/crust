/**
 * The preview host's numbers, decoded out of the C: the four interface GUIDs and the category the
 * association lookup is asked for, then the status and step codes `preview.ts` names.
 *
 * This is the check a Mac can make about a Windows ABI. A GUID written in the wrong byte order still
 * compiles and still runs; it answers `E_NOINTERFACE` on a real machine and looks exactly like "this
 * handler has no such initialiser", which is a supported path. Same for a step number that drifts: the
 * sentence a user reads would name the wrong call. Both are pinned here.
 */
import { describe, expect, test } from "bun:test";
import { PREVIEW_STATUS, PREVIEW_STEP } from "./preview.ts";
import { readShimPart } from "./shim-source.ts";

const IDS = readShimPart("12_preview_ids.c");
const HOST = readShimPart("54_preview.c");

/** The 16 bytes of one `unsigned char NAME[16] = { … }`, in memory order. */
function bytesOf(name: string): number[] {
	const body = new RegExp(`${name}\\[16\\]\\s*=\\s*\\{([^}]*)\\}`).exec(IDS)?.[1] ?? "";
	return body
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.map(Number);
}

/** The printed GUID from those bytes: Data1/2/3 little-endian, Data4 in printed order. */
function guid(name: string): string {
	const bytes = bytesOf(name);
	expect(bytes).toHaveLength(16);
	const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
	const flip = (slice: string) => (slice.match(/../g) ?? []).reverse().join("");
	return [
		flip(hex.slice(0, 8)),
		flip(hex.slice(8, 12)),
		flip(hex.slice(12, 16)),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join("-");
}

/** `SHIM_PREVIEW_CATEGORY` as text: the shell-extension category the association lookup wants. */
function category(): string {
	const body = /SHIM_PREVIEW_CATEGORY\[\]\s*=\s*\{([\s\S]*?)\};/.exec(IDS)?.[1] ?? "";
	const codes = body
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.map((part) => {
			const single = /^'(.)'$/.exec(part);
			return single ? (single[1]?.codePointAt(0) ?? 0) : Number(part);
		})
		.filter((code) => code !== 0);
	return String.fromCharCode(...codes);
}

describe("the interface ids COM is handed", () => {
	// Values from the Windows SDK's `ShObjIdl_core.idl` and `Propsys.idl`.
	test("IPreviewHandler", () => {
		expect(guid("SHIM_IID_PREVIEW")).toBe("8895b1c6-b41f-4c1c-a562-0d564250836f");
	});

	test("IInitializeWithFile", () => {
		expect(guid("SHIM_IID_INIT_FILE")).toBe("b7d14566-0509-4cce-a71f-0a554233bd9b");
	});

	test("IInitializeWithStream", () => {
		expect(guid("SHIM_IID_INIT_STREAM")).toBe("b824b49d-22ac-4161-ac8a-9916e8fa3f7f");
	});

	test("IInitializeWithItem", () => {
		expect(guid("SHIM_IID_INIT_ITEM")).toBe("7f73be3f-fb79-493c-a6c7-7ee14e245841");
	});

	test("IShellItem", () => {
		expect(guid("SHIM_IID_SHELL_ITEM")).toBe("43826d1e-e718-42ee-bc55-a1e261c37bfe");
	});

	/**
	 * The registry key a preview handler is registered under *is* `IID_IPreviewHandler`'s GUID, so the
	 * wide literal and the byte array must say the same thing. One of them wrong is a lookup that
	 * answers "no handler" for every file type.
	 */
	test("the shell-extension category is that same GUID, as text", () => {
		expect(category()).toBe("{8895b1c6-b41f-4c1c-a562-0d564250836f}");
		expect(category().slice(1, -1)).toBe(guid("SHIM_IID_PREVIEW"));
	});
});

describe("the codes the module names", () => {
	const defines = [
		...HOST.matchAll(/^#define SHIM_PREVIEW_(STEP_[A-Z_]+|SHOWN|NO_HANDLER|FAILED)\s+(\d+)$/gm),
	];

	test("the three statuses are the three the module maps", () => {
		const names: Record<string, keyof typeof PREVIEW_STATUS> = {
			SHOWN: "shown",
			NO_HANDLER: "noHandler",
			FAILED: "failed",
		};
		for (const [, suffix = "", value = ""] of defines) {
			const key = names[suffix];
			if (key === undefined) continue;
			const actual: Record<string, number> = { [suffix]: PREVIEW_STATUS[key] };
			expect(actual).toEqual({ [suffix]: Number(value) });
		}
		expect(defines.filter(([, suffix = ""]) => suffix in names)).toHaveLength(3);
	});

	test("every step is at the index the module prints for it", () => {
		let counted = 0;
		for (const [, suffix = "", value = ""] of defines) {
			if (!suffix.startsWith("STEP_")) continue;
			const name = suffix.slice("STEP_".length).toLowerCase().replace(/_/g, "-");
			expect(String(PREVIEW_STEP[Number(value)])).toBe(name);
			counted++;
		}
		expect(counted).toBe(PREVIEW_STEP.length);
	});
});

describe("the order that keeps one preview on screen", () => {
	/**
	 * A second `show` must clear the first before anything else is created, and the handler must be
	 * resolved before it is created — reversed, two hosts stack over one window.
	 */
	test("clear, then resolve, then create", () => {
		const show = HOST.slice(HOST.indexOf("int shim_preview_show("));
		const clear = show.indexOf("preview_clear();");
		const resolve = show.indexOf("preview_resolve(");
		const create = show.indexOf("CoCreateInstance(");
		expect(clear).toBeGreaterThan(-1);
		expect(clear).toBeLessThan(resolve);
		expect(resolve).toBeLessThan(create);
	});
});
