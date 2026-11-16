/**
 * The link seam: `cc()` is handed options no test can observe on macOS, so the inputs are pinned
 * here, and the shim's own source is checked for the mistake that cost a CI run.
 *
 * What failed on `windows-latest` (2026-11-16): the libraries were passed as `-luser32 …` inside
 * `flags`. TinyCC's option parser sends `-l` to `args_parser_add_file`, which only appends the name
 * to `state->files` — a queue the tcc CLI walks and an embedded libtcc never does — so every flag
 * was dropped with no error at all, and each user32, ole32 and WebView2Loader call failed later as
 * `unresolved reference to '…'`. kernel32 was the only one that resolved, because TinyCC's PE
 * runtime adds that library itself through `tcc_add_library`. The fix is the documented `library`
 * option, which reaches `tcc_add_library` and fails loudly when a name cannot be found.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SHIM_CC_OPTIONS,
	SHIM_LIBRARIES,
	linkReport,
	shimFlags,
	shimLink,
	systemDirectory,
	tccCommand,
} from "./ffi.ts";
import { PREFLIGHT } from "./preflight.ts";

const DIR = import.meta.dir;
const SYSTEM = "C:\\Windows\\System32";

describe("the libraries the shim links", () => {
	test("are the Win32 and COM libraries the C unit calls", () => {
		expect([...SHIM_LIBRARIES]).toEqual(["user32", "ole32", "kernel32"]);
	});

	test("never reach TinyCC as -l flags, which it drops without an error", () => {
		const { flags, library } = shimLink(SYSTEM);
		expect(flags.filter((flag) => flag.startsWith("-l"))).toEqual([]);
		// The library list is the only route to the linker: `cc()` passes it to `tcc_add_library`.
		expect(library).toEqual([...SHIM_LIBRARIES]);
	});

	test("the system directory is on the search path, and a path with a space is skipped", () => {
		expect(shimFlags(SYSTEM)).toEqual([`-L${SYSTEM}`]);
		// The option string is whitespace-split, so `-L` with a space would arrive as two flags;
		// TinyCC already puts the system directory on its own library path.
		expect(shimFlags("C:\\Program Files\\Windows\\System32")).toEqual([]);
	});

	test("the system directory comes from the environment, with a Windows default", () => {
		expect(systemDirectory({ SystemRoot: "D:\\Win" })).toBe(join("D:\\Win", "System32"));
		expect(systemDirectory({ windir: "E:\\Windows" })).toBe(join("E:\\Windows", "System32"));
		expect(systemDirectory({})).toBe(join("C:\\Windows", "System32"));
	});

	/**
	 * Every module the preflight probes has to be reachable: linked, or resolved at runtime. A new
	 * preflight entry for a module nothing links is a check that passes on a machine where the call
	 * still cannot be made.
	 */
	test("every preflighted module is linked or resolved at runtime", () => {
		const linked = new Set(SHIM_LIBRARIES.map((name) => `${name}.dll`));
		// `32_env.c` reaches this one with LoadLibraryW + GetProcAddress, so it is never linked.
		const runtime = new Set(["WebView2Loader.dll"]);
		const unlinked = PREFLIGHT.map((entry) => entry.module).filter(
			(module) => !linked.has(module) && !runtime.has(module),
		);
		expect([...new Set(unlinked)]).toEqual([]);
	});
});

describe("the command line a failure prints", () => {
	const source = "C:\\Temp\\crust-windows-shim-abc123.c";

	test("names the source, the search path and every library", () => {
		const command = tccCommand(source, SYSTEM);
		expect(command.startsWith("tcc ")).toBe(true);
		expect(command).toContain(SHIM_CC_OPTIONS);
		expect(command).toContain(`-L${SYSTEM}`);
		expect(command).toContain(source);
		for (const library of SHIM_LIBRARIES) expect(command).toContain(`-l${library}`);
	});

	// The exact shape the next `gate (windows)` failure is read from, so a change to it is visible.
	test("is the equivalent tcc invocation, in one fixed shape", () => {
		expect(tccCommand(source, SYSTEM)).toBe(
			`tcc ${SHIM_CC_OPTIONS} -L${SYSTEM} ${source} -luser32 -lole32 -lkernel32`,
		);
	});
});

describe("the link report", () => {
	test("names the file TinyCC would open, in its own search order", () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-link-"));
		try {
			writeFileSync(join(dir, "user32.dll"), "");
			writeFileSync(join(dir, "libkernel32.a"), "");
			const lines = linkReport(dir);
			expect(lines).toHaveLength(SHIM_LIBRARIES.length);
			expect(lines[0]).toContain("user32.dll");
			// ole32 has no file here, so the line names every name it looked for instead.
			expect(lines[1]).toContain("not found");
			expect(lines[1]).toContain("ole32.dll");
			expect(lines[2]).toContain("libkernel32.a");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("WebView2Loader is a runtime dependency, not a link one", () => {
	const env = readFileSync(join(DIR, "shim", "32_env.c"), "utf8");
	const prelude = readFileSync(join(DIR, "shim", "10_prelude.c"), "utf8");
	const binding = readFileSync(join(DIR, "ffi.ts"), "utf8");

	test("the one export is resolved with LoadLibraryW and GetProcAddress", () => {
		expect(env).toContain("LoadLibraryW(name)");
		expect(env).toContain('GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions")');
		expect(prelude).toContain("extern shim_h LoadLibraryW(const shim_wchar *name);");
		expect(prelude).toContain("extern void *GetProcAddress(shim_h module, const char *name);");
	});

	/**
	 * A surviving extern would put the symbol back in the link, where it can only resolve if the
	 * loader's directory happens to be on TinyCC's library path — the machine-specific failure this
	 * fallback exists to avoid.
	 */
	test("no extern for the loader export survives, and it is not a link input", () => {
		expect(env).not.toMatch(/extern[^;]*CreateCoreWebView2EnvironmentWithOptions\s*\(/);
		expect([...SHIM_LIBRARIES]).not.toContain("WebView2Loader");
	});

	test("the binding hands the libraries to cc() as `library`, never as a flag", () => {
		expect(binding).toContain("flags: link.flags");
		expect(binding).toContain("library: link.library");
	});
});
